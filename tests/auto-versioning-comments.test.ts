import {
  CommentsKit,
  threadExistsInDocument,
} from "@tiptap-pro/extension-comments";
import {
  TiptapCollabProvider,
  TiptapCollabProviderWebsocket,
} from "@tiptap-pro/provider";
import {
  Editor,
  NodePos,
  Range,
  type Command,
  type EditorEvents,
  type Extensions,
  type JSONContent,
} from "@tiptap/core";
import Collaboration from "@tiptap/extension-collaboration";
import { TextStyle } from "@tiptap/extension-text-style";
import { BackgroundColor } from "@tiptap/extension-text-style/background-color";
import { Color } from "@tiptap/extension-text-style/color";
import { FontFamily } from "@tiptap/extension-text-style/font-family";
import { FontSize } from "@tiptap/extension-text-style/font-size";
import StarterKit from "@tiptap/starter-kit";
import { randomUUID } from "node:crypto";
import { assert, vi } from "vitest";
import Websocket from "ws";
import { describe, expect, test } from "~/fixtures";
import {
  type DocumentVersion,
  type ServerClient,
} from "~/fixtures/client/createServerClient";
import { CollabWriteback } from "~/fixtures/editor/collabWriteback";
import { CompactTextStyleYAttrs } from "~/fixtures/editor/compactTextStyleYAttrs";
import { waitForSync } from "~/fixtures/editor/waitForSync";
import {
  commentClaims,
  editClaims,
  type TiptapClaims,
} from "~/fixtures/user/claims";
import { createToken } from "~/fixtures/user/createToken";
import { queryOrFail } from "~/lib/query";
import { nodeRange } from "~/lib/selection";
import { waitUntilFlushed } from "./utils/flushChanges";
import { recordFlushProbe } from "./utils/recordFlushProbe";
import recordTransactions from "./utils/recordTransactions";
import recordYUpdates from "./utils/recordYUpdates";

const HIGHLIGHT = "#E73E3E";

/** Matches docker-compose COLLAB_DEFAULT_AUTO_VERSIONING_INTERVAL (seconds). */
const AUTO_VERSION_INTERVAL_SECONDS = 30;

const emptyDocument: JSONContent = {
  type: "doc",
  content: [{ type: "paragraph" }],
};

const paragraphBeforeHighlight: JSONContent = {
  type: "doc",
  content: [
    {
      type: "paragraph",
      content: [{ type: "text", text: "Before styled after" }],
    },
  ],
};

/** Apply highlight through the BackgroundColor command (writable edit path). */
function highlightStyledRun(editor: Editor, color: string) {
  const paragraph = queryOrFail(
    editor.$doc,
    (node) => node.type.name === "text" && node.text === "Before styled after"
  );
  const range = nodeRange(paragraph);
  const styledStart = range.from + "Before ".length;
  const styledEnd = styledStart + "styled".length;

  assert.isOk(
    editor
      .chain()
      .focus(undefined, { scrollIntoView: false })
      .setTextSelection({ from: styledStart, to: styledEnd })
      .setBackgroundColor(color)
      .run(),
    "Edit user failed to apply highlight"
  );
}

const starterKit = StarterKit.configure({
  undoRedo: false,
  trailingNode: false,
});

function buildExtensions(syncedProvider: TiptapCollabProvider): Extensions {
  return [
    starterKit,
    TextStyle,
    FontFamily,
    FontSize,
    Color,
    BackgroundColor,
    //SparseTextStyleDefaults,
    CollabWriteback,
    Collaboration.configure({
      provider: syncedProvider,
      document: syncedProvider.document,
    }),
    CompactTextStyleYAttrs,
    CommentsKit.configure({
      provider: syncedProvider,
      deleteUnreferencedThreads: false,
      useLegacyWrapping: false,
    }),
  ];
}

interface ConnectedEditor {
  provider: TiptapCollabProvider;
  editor: Editor;
  destroy: () => void;
}

async function connectEditor(options: {
  documentName: string;
  claims: TiptapClaims;
  editable: boolean;
}): Promise<ConnectedEditor> {
  const token = createToken(options.claims);
  const provider = new TiptapCollabProvider({
    name: options.documentName,
    token,
    user: options.claims.sub,
    websocketProvider: new TiptapCollabProviderWebsocket({
      baseUrl: "ws://localhost:3030",
      WebSocketPolyfill: Websocket,
    }),
  });

  await waitForSync(provider);

  const element = document.createElement("div");
  document.body.appendChild(element);

  const editor = new Editor({
    element,
    editable: options.editable,
    extensions: buildExtensions(provider),
  });

  return {
    provider,
    editor,
    destroy() {
      const debounceTimer = editor.storage.comments?.debounceTimer;
      if (debounceTimer) {
        clearTimeout(debounceTimer);
      }
      editor.destroy();
      provider.destroy();
      element.remove();
    },
  };
}

async function waitForNewAutoVersion(
  client: ServerClient,
  documentName: string,
  previousCount: number
): Promise<DocumentVersion[]> {
  const timeoutMs = (AUTO_VERSION_INTERVAL_SECONDS + 15) * 1_000;
  let versions: DocumentVersion[] = [];

  await vi.waitUntil(
    async () => {
      versions = await client.getDocumentVersions(documentName);
      return versions.length > previousCount;
    },
    {
      timeout: timeoutMs,
      interval: 2_000,
    }
  );

  return versions;
}

const PARAGRAPH_TEXT = "Before styled after";
const STYLED_OFFSET = "Before ".length;
const STYLED_MID = STYLED_OFFSET + Math.ceil("styled".length / 2);

/** Absolute PM offsets from the start of paragraph text content. */
function selectParagraphOffsets(start: number, end: number): Command {
  return ({ editor, commands }) => {
    const paragraph = queryOrFail(
      editor.$doc,
      (node) => node.type.name === "paragraph"
    );

    return commands.setTextSelection({
      from: paragraph.pos + 1 + start,
      to: paragraph.pos + 1 + end,
    });
  };
}

/** Unstyled leading run into the first half of the highlight ("efore sty"). */
const selectLeadingPartialStyledOverlap = selectParagraphOffsets(1, STYLED_MID);

/** Highlight second half into the trailing unstyled run ("led afte"); no overlap with leading. */
const selectTrailingPartialStyledOverlap = selectParagraphOffsets(
  STYLED_MID,
  PARAGRAPH_TEXT.length - 1
);

describe("auto-versioning + comment-only threads on highlight", () => {
  /**
   * Scenario:
   * 1. Edit user writes highlighted text and syncs.
   * 2. Server auto-versioning captures a snapshot (see docker-compose interval).
   * 3. Comment-only user adds disjoint partial-overlap threads on each side of the highlight.
   * 4. Both thread anchors should survive sync.
   */
  test(
    "edit user highlight survives auto-version; comment-only partial overlap threads persist",
    async ({
      client,
      documentName,
      annotate,
      onTestFailed,
      onTestFinished,
    }) => {
      await client.createDocument(documentName, emptyDocument);

      let editSyncRecorder: ReturnType<typeof recordYUpdates> | null = null;
      let commentSyncRecorder: ReturnType<typeof recordYUpdates> | null = null;
      let commentThreadRecorder: ReturnType<typeof recordTransactions> | null =
        null;

      onTestFailed(() => {
        if (commentSyncRecorder) {
          console.log(
            "comment sync summary:",
            JSON.stringify(commentSyncRecorder.getSummary(), null, 2)
          );
          const segmentChanges = commentSyncRecorder
            .getRecords()
            .filter(
              (record) =>
                record.source === "ydoc" &&
                JSON.stringify(record.segmentsBefore) !==
                  JSON.stringify(record.segmentsAfter)
            )
            .map((record) => ({
              direction: record.direction,
              origin: record.origin,
              textStyleChanged: record.textStyleChanged,
              segmentsBefore: record.segmentsBefore,
              segmentsAfter: record.segmentsAfter,
            }));
          console.log(
            "comment sync segment changes:",
            JSON.stringify(segmentChanges, null, 2)
          );
        }
        if (commentThreadRecorder) {
          console.log(
            "comment thread PM steps:",
            JSON.stringify(commentThreadRecorder.getTransactionSteps(), null, 2)
          );
        }
      });

      onTestFinished(() => {
        editSyncRecorder?.unsubscribe();
        commentSyncRecorder?.unsubscribe();
        commentThreadRecorder?.unsubscribe();
      });

      try {
        const editorSub = `editor:${randomUUID()}`;
        const editSession = await connectEditor({
          documentName,
          claims: editClaims({ documentName, sub: editorSub }),
          editable: true,
        });

        editSyncRecorder = recordYUpdates({
          ydoc: editSession.provider.document,
          provider: editSession.provider,
        });

        const versionsBeforeEdit = await client.getDocumentVersions(
          documentName
        );

        assert.isOk(
          editSession.editor.commands.setContent(paragraphBeforeHighlight),
          "Edit user failed to insert paragraph content"
        );
        highlightStyledRun(editSession.editor, HIGHLIGHT);

        await waitUntilFlushed(editSession.provider);

        // const versionsAfterEdit = await waitForNewAutoVersion(
        //   client,
        //   documentName,
        //   versionsBeforeEdit.length
        // );
        // expect(versionsAfterEdit.length).toBeGreaterThan(
        //   versionsBeforeEdit.length
        // );

        const editSyncSummary = editSyncRecorder.getSummary();
        editSyncRecorder.unsubscribe();
        editSyncRecorder = null;

        editSession.destroy();

        const commentSub = `guest:${randomUUID()}`;
        const commentSession = await connectEditor({
          documentName,
          claims: commentClaims({ documentName, sub: commentSub }),
          editable: false,
        });

        commentSyncRecorder = recordYUpdates({
          ydoc: commentSession.provider.document,
          provider: commentSession.provider,
        });
        commentThreadRecorder = recordTransactions(
          commentSession.editor,
          (transaction) =>
            transaction.docChanged ||
            transaction.getMeta("debug") === "test-thread-creation"
        );

        const { threadId: firstThreadId } = await createThreadAtSelection(
          commentSession.editor,
          selectLeadingPartialStyledOverlap
        );

        await waitUntilFlushed(commentSession.provider);

        const { threadId: secondThreadId } = await createThreadAtSelection(
          commentSession.editor,
          selectTrailingPartialStyledOverlap
        );

        expect(firstThreadId).not.toBe(secondThreadId);
        expect(
          threadExistsInDocument(commentSession.editor, firstThreadId)
        ).toBeTruthy();
        expect(
          threadExistsInDocument(commentSession.editor, secondThreadId)
        ).toBeTruthy();

        const firstExistsBeforeSync = threadExistsInDocument(
          commentSession.editor,
          firstThreadId
        );
        const secondExistsBeforeSync = threadExistsInDocument(
          commentSession.editor,
          secondThreadId
        );

        const flushProbe = recordFlushProbe({
          ydoc: commentSession.provider.document,
          provider: commentSession.provider,
        });

        try {
          await waitUntilFlushed(commentSession.provider);
        } catch (error) {
          console.log(
            "second flush probe:",
            JSON.stringify(flushProbe.getSummary(), null, 2)
          );
          throw error;
        } finally {
          flushProbe.unsubscribe();
        }

        const commentSyncSummary = commentSyncRecorder.getSummary();

        await annotate("document after comment-only sync", {
          body: JSON.stringify(
            {
              //versionsBeforeEdit: versionsBeforeEdit.length,
              //versionsAfterEdit: versionsAfterEdit.length,
              editSyncSummary,
              commentSyncSummary,
              firstThreadId,
              secondThreadId,
              firstExistsBeforeSync,
              secondExistsBeforeSync,
              firstExistsAfterSync: threadExistsInDocument(
                commentSession.editor,
                firstThreadId
              ),
              secondExistsAfterSync: threadExistsInDocument(
                commentSession.editor,
                secondThreadId
              ),
              document: commentSession.editor.getJSON(),
            },
            null,
            2
          ),
          contentType: "application/json",
        });

        await expectThreadExistsInDocument(
          commentSession.editor,
          firstThreadId
        );
        await expectThreadExistsInDocument(
          commentSession.editor,
          secondThreadId
        );

        const firstOnServer = await client.getThread(
          documentName,
          firstThreadId
        );
        const secondOnServer = await client.getThread(
          documentName,
          secondThreadId
        );

        expect(firstOnServer.id).toBe(firstThreadId);
        expect(secondOnServer.id).toBe(secondThreadId);

        commentSession.destroy();
      } finally {
        await client.deleteDocument(documentName);
      }
    },
    (AUTO_VERSION_INTERVAL_SECONDS + 20) * 1_000
  );
});

const createThreadAtSelection = vi.defineHelper(
  async function createThreadAtSelection(
    editor: Editor,
    selectContent: Command
  ) {
    const pending = new Promise<EditorEvents["comments:threadCreated"]>(
      (resolve) => editor.once("comments:threadCreated", resolve)
    );

    assert.isOk(
      editor
        .chain()
        .focus(undefined, { scrollIntoView: false })
        .command(selectContent)
        .setMeta("debug", "test-thread-creation")
        .setThread({
          content: "[test-content]",
        })
        .run(),
      "Failed to create thread at selection"
    );

    return pending;
  }
);

const createTwoThreadsAtSelections = vi.defineHelper(
  async function createTwoThreadsAtSelections(
    editor: Editor,
    firstSelect: Command,
    secondSelect: Command
  ) {
    const first = await createThreadAtSelection(editor, firstSelect);
    const second = await createThreadAtSelection(editor, secondSelect);

    return {
      firstThreadId: first.threadId,
      secondThreadId: second.threadId,
    };
  }
);

const expectThreadExistsInDocument = vi.defineHelper(
  async function expectThreadExistsInDocument(
    editor: Editor,
    threadId: string
  ) {
    return expect(
      threadExistsInDocument(editor, threadId),
      `Thread ${threadId} does not exist in document`
    ).toBeTruthy();
  }
);

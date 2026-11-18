import { randomUUID } from "node:crypto";
import { Editor, type Extensions } from "@tiptap/core";
import Collaboration from "@tiptap/extension-collaboration";
import {
  CommentsKit,
  type ThreadStateChangedHandler,
  threadExistsInDocument,
} from "@tiptap-pro/extension-comments";
import {
  TiptapCollabProvider,
  TiptapCollabProviderWebsocket,
} from "@tiptap-pro/provider";
import { onTestFinished, vi } from "vitest";
import Websocket from "ws";
import { describe, expect, test } from "../../fixtures";
import { commentClaims, type TiptapClaims } from "../../utils/claims";
import { createToken } from "../../utils/createToken";
import { paragraph, text } from "../../utils/document";
import { textSchema } from "../../utils/extensionSets";
import { waitUntilFlushed } from "../../utils/flushChanges";
import { queryOrFail } from "../../utils/query";
import {
  nodeRange,
  type Selection,
  TextSelection,
} from "../../utils/selection";
import { createThreadAtSelection } from "../../utils/thread";
import { waitForSync } from "../../utils/waitForSync";

/**
 * From 3.12.2, `resolveThread` removes the thread's anchor from the document
 * and keeps its ranges in the root map `__tiptapcollab__resolvedThreadAnchors`,
 * which `unresolveThread` restores from.
 *
 * - The server undoes a comment-only session's write to that map but keeps the
 *   anchor removal, so a thread a comment-only user resolves can never be
 *   reopened with its text.
 * - A thread that starts a paragraph cannot be reopened by anyone: the kept
 *   ranges do not restore.
 * - Every undo removes the anchor of every resolved thread still in the
 *   document, without keeping its ranges.
 *
 * Every test asserts what 3.12.1 and earlier do. Fixed in 3.12.9, so archived:
 * see docs/archive/resolved-thread-anchor.md.
 */

const TARGET = "[target]";
const SEED = paragraph([text(`[before] ${TARGET} [after]`)]);

type Role = "an editor" | "a comment-only session";

const ROLES: Role[] = ["an editor", "a comment-only session"];

function claimsFor(role: Role, documentName: string): TiptapClaims {
  const sub = `guest:${randomUUID()}`;
  return role === "an editor"
    ? { sub, allowedDocumentNames: [documentName] }
    : commentClaims({ sub, documentName });
}

/** The stock text configuration, optionally with an `onThreadStateChanged`. */
function extensionsFor(
  provider: TiptapCollabProvider,
  onThreadStateChanged?: ThreadStateChangedHandler,
): Extensions {
  return [
    ...textSchema.nodes,
    Collaboration.configure({ provider, document: provider.document }),
    CommentsKit.configure({
      provider,
      deleteUnreferencedThreads: false,
      useLegacyWrapping: false,
      ...(onThreadStateChanged ? { onThreadStateChanged } : {}),
    }),
  ];
}

/** Another connection to the document: another user, or the same after a reload. */
async function openSession(documentName: string, role: Role) {
  const provider = new TiptapCollabProvider({
    name: documentName,
    token: createToken(claimsFor(role, documentName)),
    websocketProvider: new TiptapCollabProviderWebsocket({
      baseUrl: "ws://localhost:3030",
      WebSocketPolyfill: Websocket,
    }),
  });
  await waitForSync(provider);
  const editor = new Editor({
    element: document.body.appendChild(document.createElement("div")),
    editable: false,
    extensions: extensionsFor(provider),
  });
  onTestFinished(() => {
    const debounceTimer = editor.storage.comments?.debounceTimer;
    if (debounceTimer) clearTimeout(debounceTimer);
    editor.destroy();
    provider.destroy();
  });
  await vi.waitUntil(() => editor.state.doc.textContent.includes(TARGET));
  return { provider, editor };
}

/** `[target]`, in the middle of the paragraph. */
const selectTarget = (editor: Editor): Selection => {
  const run = queryOrFail(
    editor.$doc,
    (node) => node.isText && !!node.text?.includes(TARGET),
    `No text run containing ${TARGET}`,
  );
  // biome-ignore lint/style/noNonNullAssertion: queryOrFail matched on `node.text`.
  const from = nodeRange(run).from + run.node.text!.indexOf(TARGET);
  return TextSelection.create(editor.state.doc, from, from + TARGET.length);
};

/** `[before]`, from the paragraph's first character. */
const selectParagraphStart = (editor: Editor): Selection => {
  const { from } = nodeRange(
    queryOrFail(
      editor.$doc,
      (node) => node.type.name === "paragraph",
      "No paragraph",
    ),
  );
  return TextSelection.create(editor.state.doc, from + 1, from + 9);
};

/** Comments on the selection and waits until the server has the thread. */
async function commentOn(
  editor: Editor,
  provider: TiptapCollabProvider,
  select = selectTarget,
) {
  const { threadId } = await createThreadAtSelection(editor, select);
  await waitUntilFlushed(provider);
  expect(
    threadExistsInDocument(editor, threadId),
    `Thread ${threadId} was not anchored after sync`,
  ).toBe(true);
  return threadId;
}

const isResolved = (provider: TiptapCollabProvider, threadId: string) =>
  !!provider
    .getThreads({ types: ["unarchived", "archived"] })
    .find((thread) => thread.id === threadId)?.resolvedAt;

test.override("seedContent", SEED);

describe("resolveThread", () => {
  describe.for<Role>(ROLES)("given %s", (role) => {
    test.override("claims", ({ documentName }) =>
      claimsFor(role, documentName),
    );

    test("keeps the thread anchor", async ({
      editor,
      provider,
      documentName,
    }) => {
      const threadId = await commentOn(editor, provider);

      editor.commands.resolveThread({ id: threadId });
      await waitUntilFlushed(provider);

      const reloaded = await openSession(documentName, role);
      expect(isResolved(reloaded.provider, threadId)).toBe(true);
      expect(
        threadExistsInDocument(reloaded.editor, threadId),
        `Resolving thread ${threadId} removed its anchor`,
      ).toBe(true);
    });

    describe("and an onThreadStateChanged that skips the default handler", () => {
      test.override("extensions", ({ syncedProvider }) =>
        extensionsFor(syncedProvider, () => {}),
      );

      test("keeps the thread anchor", async ({
        editor,
        provider,
        documentName,
      }) => {
        const threadId = await commentOn(editor, provider);

        editor.commands.resolveThread({ id: threadId });
        await waitUntilFlushed(provider);

        const reloaded = await openSession(documentName, role);
        expect(
          threadExistsInDocument(reloaded.editor, threadId),
          `Resolving thread ${threadId} removed its anchor`,
        ).toBe(true);
      });
    });

    test("leaves a thread that can be reopened after a reload, anchor and all", async ({
      editor,
      provider,
      documentName,
    }) => {
      const threadId = await commentOn(editor, provider);
      editor.commands.resolveThread({ id: threadId });
      await waitUntilFlushed(provider);

      const reloaded = await openSession(documentName, role);
      expect(
        reloaded.editor.commands.unresolveThread({ id: threadId }),
        `unresolveThread refused thread ${threadId}`,
      ).toBe(true);
      await waitUntilFlushed(reloaded.provider);

      const after = await openSession(documentName, role);
      expect(isResolved(after.provider, threadId)).toBe(false);
      expect(
        threadExistsInDocument(after.editor, threadId),
        `Reopened thread ${threadId} has no anchor`,
      ).toBe(true);
    });
  });

  describe("given a comment-only session", () => {
    test("leaves a thread an editor can reopen, anchor and all", async ({
      editor,
      provider,
      documentName,
    }) => {
      const threadId = await commentOn(editor, provider);
      editor.commands.resolveThread({ id: threadId });
      await waitUntilFlushed(provider);

      const reviewer = await openSession(documentName, "an editor");
      expect(
        reviewer.editor.commands.unresolveThread({ id: threadId }),
        `unresolveThread refused thread ${threadId}`,
      ).toBe(true);
      await waitUntilFlushed(reviewer.provider);

      const after = await openSession(documentName, "an editor");
      expect(
        threadExistsInDocument(after.editor, threadId),
        `Reopened thread ${threadId} has no anchor`,
      ).toBe(true);
    });
  });
});

describe("unresolveThread", () => {
  describe("given an editor", () => {
    test.override("claims", ({ documentName }) =>
      claimsFor("an editor", documentName),
    );

    test("reopens a thread that starts a paragraph, in the session that resolved it", async ({
      editor,
      provider,
    }) => {
      const threadId = await commentOn(editor, provider, selectParagraphStart);
      editor.commands.resolveThread({ id: threadId });

      expect(
        editor.commands.unresolveThread({ id: threadId }),
        `unresolveThread refused thread ${threadId}`,
      ).toBe(true);
      expect(
        threadExistsInDocument(editor, threadId),
        `Reopened thread ${threadId} has no anchor`,
      ).toBe(true);
    });
  });
});

describe("undo", () => {
  test.override("claims", ({ documentName }) =>
    claimsFor("an editor", documentName),
  );

  test("keeps the anchor of a thread resolved by an earlier client", async ({
    editor,
    provider,
    documentName,
  }) => {
    const threadId = await commentOn(editor, provider);
    // What resolveThread did up to 3.12.1: resolvedAt only, anchor kept.
    provider.updateThread(threadId, { resolvedAt: new Date().toISOString() });
    await waitUntilFlushed(provider);

    const author = await openSession(documentName, "an editor");
    expect(
      threadExistsInDocument(author.editor, threadId),
      `Thread ${threadId} had no anchor before the undo`,
    ).toBe(true);

    // An edit elsewhere in the document, then undone.
    author.editor.commands.insertContentAt(
      author.editor.state.doc.content.size,
      paragraph([text("[unrelated edit]")]),
    );
    await waitUntilFlushed(author.provider);
    expect(author.editor.commands.undo(), "Nothing to undo").toBe(true);
    await waitUntilFlushed(author.provider);

    const reloaded = await openSession(documentName, "an editor");
    expect(reloaded.editor.state.doc.textContent).not.toContain(
      "[unrelated edit]",
    );
    expect(
      threadExistsInDocument(reloaded.editor, threadId),
      `Undoing an unrelated edit removed thread ${threadId}'s anchor`,
    ).toBe(true);
  });
});

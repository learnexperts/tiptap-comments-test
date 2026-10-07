import { randomUUID } from "node:crypto";
import { Editor, type JSONContent } from "@tiptap/core";
import { threadExistsInDocument } from "@tiptap-pro/extension-comments";
import {
  TiptapCollabProvider,
  TiptapCollabProviderWebsocket,
} from "@tiptap-pro/provider";
import { vi } from "vitest";
import Websocket from "ws";
import { describe, expect, test } from "~/tests/fixtures";
import { createToken } from "./createToken";
import { blockSchema, stockExtensionsFor } from "./extensionSets";
import { waitUntilFlushed } from "./flushChanges";
import { query, queryOrFail } from "./query";
import {
  asNodeSelection,
  nodeRange,
  type Selection,
  TextSelection,
} from "./selection";
import { createThreadAtSelection } from "./thread";
import { waitForSync } from "./waitForSync";
import { recordYWrites } from "./yWrites";

// The block-anchor matrix (docs/block-anchor-undone.md): a comment-only
// session anchors a thread on blocks whose stored attributes differ from what
// y-prosemirror rebuilds. tests/block-anchor.test.ts runs it stock and with the
// workaround.
//
// The server's JSON import gives every node of a type the key order of the
// first one it meets, so a seed that fixes an order holds one block of a type.

const TARGET = "[target]";

interface BlockCase {
  label: string;
  seed: JSONContent;
  /** Run in an editor session before the comment. */
  editFirst?: (editor: Editor) => void;
  anchorOn: (editor: Editor) => Selection;
}

const text = (value: string): JSONContent => ({ type: "text", text: value });

const paragraph = (
  attrs: Record<string, unknown>,
  value = TARGET,
): JSONContent => ({ type: "paragraph", attrs, content: [text(value)] });

const codeBlock = (attrs: Record<string, unknown>): JSONContent => ({
  type: "codeBlock",
  attrs,
  content: [text(TARGET)],
});

const doc = (...content: JSONContent[]): JSONContent => ({
  type: "doc",
  content,
});

const BEFORE = paragraph({ marginLeft: 0 }, "[before]");

function targetBlock(editor: Editor, nodeType: string) {
  return queryOrFail(
    editor.$doc,
    (node) => node.type.name === nodeType && node.textContent.includes(TARGET),
    `No ${nodeType} containing ${TARGET}`,
  );
}

const selectBlock =
  (nodeType: string) =>
  (editor: Editor): Selection =>
    asNodeSelection(editor.state.doc, targetBlock(editor, nodeType));

const selectTextIn =
  (nodeType: string) =>
  (editor: Editor): Selection => {
    const { from, to } = nodeRange(targetBlock(editor, nodeType));
    return TextSelection.create(editor.state.doc, from + 1, to - 1);
  };

const atEnd = (editor: Editor) => editor.state.doc.content.size;

const cases: BlockCase[] = [
  {
    label: "a paragraph stored in schema order",
    seed: doc(paragraph({ textAlign: "center", marginLeft: 0 })),
    anchorOn: selectBlock("paragraph"),
  },
  {
    label: "a paragraph stored out of schema order",
    seed: doc(paragraph({ marginLeft: 0, textAlign: "center" })),
    anchorOn: selectBlock("paragraph"),
  },
  {
    label: "a code block stored out of schema order",
    seed: doc(codeBlock({ theme: "dark", language: "javascript" })),
    anchorOn: selectBlock("codeBlock"),
  },
  {
    label: "a paragraph stored without its marginLeft default",
    seed: doc(paragraph({})),
    anchorOn: selectBlock("paragraph"),
  },
  {
    label: "text in a paragraph stored without its marginLeft default",
    seed: doc(paragraph({})),
    anchorOn: selectTextIn("paragraph"),
  },
  {
    label: "a horizontal rule",
    seed: doc(BEFORE, { type: "horizontalRule" }),
    anchorOn: (editor) =>
      asNodeSelection(
        editor.state.doc,
        queryOrFail(editor.$doc, { nodeType: "horizontalRule" }),
      ),
  },
  {
    label: "a paragraph inside a callout",
    seed: doc(BEFORE, {
      type: "callout",
      content: [
        paragraph({ marginLeft: 0 }, "[first]"),
        paragraph({ marginLeft: 0 }),
      ],
    }),
    anchorOn: selectBlock("paragraph"),
  },
  {
    label: "a code block inserted with its language",
    seed: doc(BEFORE),
    editFirst: (editor) => {
      editor
        .chain()
        .insertContentAt(atEnd(editor), {
          type: "codeBlock",
          attrs: { language: "javascript" },
          content: [text(TARGET)],
        })
        .run();
    },
    anchorOn: selectBlock("codeBlock"),
  },
  {
    label: "a code block whose language was picked after insert",
    seed: doc(BEFORE),
    editFirst: (editor) => {
      editor
        .chain()
        .insertContentAt(atEnd(editor), {
          type: "codeBlock",
          content: [text(TARGET)],
        })
        .run();
      editor
        .chain()
        .setTextSelection(nodeRange(targetBlock(editor, "codeBlock")).from + 1)
        .updateAttributes("codeBlock", { language: "javascript" })
        .run();
    },
    anchorOn: selectBlock("codeBlock"),
  },
  {
    label: "a paragraph centred after it was typed",
    seed: doc(BEFORE),
    editFirst: (editor) => {
      editor
        .chain()
        .insertContentAt(atEnd(editor), {
          type: "paragraph",
          content: [text(TARGET)],
        })
        .run();
      editor
        .chain()
        .setTextSelection(nodeRange(targetBlock(editor, "paragraph")).from + 1)
        .updateAttributes("paragraph", { textAlign: "center" })
        .run();
    },
    anchorOn: selectBlock("paragraph"),
  },
];

/**
 * Runs `edit` in a stock editor session, then waits for `commenter` to
 * receive it. CollabWriteback would store the same: it changes only writes
 * that say what is already stored.
 */
async function editAsEditor(
  documentName: string,
  edit: (editor: Editor) => void,
  commenter: Editor,
) {
  const provider = new TiptapCollabProvider({
    name: documentName,
    token: createToken({
      sub: `editor:${randomUUID()}`,
      allowedDocumentNames: [documentName],
    }),
    websocketProvider: new TiptapCollabProviderWebsocket({
      baseUrl: "ws://localhost:3030",
      WebSocketPolyfill: Websocket,
    }),
  });
  await waitForSync(provider);
  const editor = new Editor({
    extensions: stockExtensionsFor(blockSchema)({ syncedProvider: provider }),
  });

  try {
    edit(editor);
    await waitUntilFlushed(provider);
    await vi.waitUntil(
      () =>
        query(commenter.$doc, (node) => node.textContent === TARGET) !== null,
      { timeout: 5_000 },
    );
  } finally {
    editor.destroy();
    provider.destroy();
  }
}

export function describeBlockMatrix() {
  describe("block anchors", () => {
    describe("given a comment-only session", () => {
      describe.for<BlockCase>(cases)(
        "on $label",
        ({ seed, editFirst, anchorOn }) => {
          test.override("seedContent", seed);

          test("keeps the anchor after sync", { timeout: 30_000 }, async ({
            editor,
            provider,
            documentName,
            annotate,
          }) => {
            if (editFirst) {
              await editAsEditor(documentName, editFirst, editor);
            }

            const writes = recordYWrites(provider.document);
            const { threadId } = await createThreadAtSelection(
              editor,
              anchorOn,
            );

            expect(
              threadExistsInDocument(editor, threadId),
              `Thread ${threadId} was not anchored before sync`,
            ).toBe(true);

            await waitUntilFlushed(provider);
            writes.stop();

            await annotate("writes the comment produced", {
              body: writes.lines.join("\n"),
            });

            expect(
              threadExistsInDocument(editor, threadId),
              `Thread ${threadId} lost its anchor during sync`,
            ).toBe(true);
          });
        },
      );
    });
  });
}

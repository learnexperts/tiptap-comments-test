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
import type { Configuration } from "./extensionSets";
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

/**
 * The block-anchor matrix: blocks whose stored attributes differ from what
 * y-prosemirror rebuilds, anchored by a comment-only session.
 *
 * A block anchor wraps the block in `blockThread`. Yjs cannot move an element,
 * so the update deletes the block and inserts a copy rebuilt from the
 * ProseMirror node: attribute keys in schema order, every non-null default
 * present. The server keeps that from a comment-only connection only when the
 * copy matches the stored element, key order included.
 *
 * Seeded cases control the stored order through the seed. The server's JSON
 * import gives every node of a type the key order of the first one it meets,
 * so a seed that fixes an order holds a single block of that type. Authored
 * cases have an editor session build the block first, which is how stored
 * order drifts in practice: a key set after insert is appended.
 *
 * `tests/block-anchor.test.ts` runs it on stock Tiptap and
 * `tests/probes/block-anchor.probe.ts` with the workaround, like the comment
 * matrix (see `docs/adr/0001-tests-are-a-bug-report.md`).
 */

const TARGET = "[target]";

interface BlockCase {
  label: string;
  /** Seeded as the server stores it; attribute order as written here. */
  content: JSONContent;
  /** Edits an editor session makes before the comment, if any. */
  author?: (editor: Editor) => void;
  /** Where the comment-only session anchors its thread. */
  select: (editor: Editor) => Selection;
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

/** Everything before the target block, written as an editor writes it. */
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
    content: doc(paragraph({ textAlign: "center", marginLeft: 0 })),
    select: selectBlock("paragraph"),
  },
  {
    label: "a paragraph stored out of schema order",
    content: doc(paragraph({ marginLeft: 0, textAlign: "center" })),
    select: selectBlock("paragraph"),
  },
  {
    label: "a code block stored out of schema order",
    content: doc(codeBlock({ theme: "dark", language: "javascript" })),
    select: selectBlock("codeBlock"),
  },
  {
    label: "a paragraph stored without its marginLeft default",
    content: doc(paragraph({})),
    select: selectBlock("paragraph"),
  },
  {
    label: "text in a paragraph stored without its marginLeft default",
    content: doc(paragraph({})),
    select: selectTextIn("paragraph"),
  },
  {
    label: "a horizontal rule",
    content: doc(BEFORE, { type: "horizontalRule" }),
    select: (editor) =>
      asNodeSelection(
        editor.state.doc,
        queryOrFail(editor.$doc, { nodeType: "horizontalRule" }),
      ),
  },
  {
    label: "a paragraph inside a callout",
    content: doc(BEFORE, {
      type: "callout",
      content: [
        paragraph({ marginLeft: 0 }, "[first]"),
        paragraph({ marginLeft: 0 }),
      ],
    }),
    select: selectBlock("paragraph"),
  },
  {
    label: "a code block inserted with its language",
    content: doc(BEFORE),
    author: (editor) => {
      editor
        .chain()
        .insertContentAt(atEnd(editor), {
          type: "codeBlock",
          attrs: { language: "javascript" },
          content: [text(TARGET)],
        })
        .run();
    },
    select: selectBlock("codeBlock"),
  },
  {
    label: "a code block whose language was picked after insert",
    content: doc(BEFORE),
    author: (editor) => {
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
    select: selectBlock("codeBlock"),
  },
  {
    label: "a paragraph centred after it was typed",
    content: doc(BEFORE),
    author: (editor) => {
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
    select: selectBlock("paragraph"),
  },
];

/**
 * Runs `author` in an editor session on `documentName`, then waits until the
 * comment-only `editor` has received the result.
 */
async function authorAsEditor(
  documentName: string,
  configuration: Configuration,
  author: (editor: Editor) => void,
  editor: Editor,
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
  const authorEditor = new Editor({
    extensions: configuration({ syncedProvider: provider }),
  });

  try {
    author(authorEditor);
    await waitUntilFlushed(provider);
    await vi.waitUntil(
      () => query(editor.$doc, (node) => node.textContent === TARGET) !== null,
      { timeout: 5_000 },
    );
  } finally {
    authorEditor.destroy();
    provider.destroy();
  }
}

/** Registers the matrix under `label`, every case built from `configuration`. */
export function describeBlockMatrix(
  label: string,
  configuration: Configuration,
) {
  describe("block anchors", () => {
    describe(label, () => {
      test.override("extensions", configuration);

      describe.for<BlockCase>(cases)(
        "on $label",
        ({ content, author, select }) => {
          test.override("seedContent", content);

          test("keeps the anchor after sync", { timeout: 30_000 }, async ({
            editor,
            provider,
            documentName,
            annotate,
          }) => {
            if (author) {
              await authorAsEditor(documentName, configuration, author, editor);
            }

            const writes = recordYWrites(provider.document);
            const { threadId } = await createThreadAtSelection(editor, select);

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

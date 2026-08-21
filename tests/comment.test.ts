import { CommentsKit, threadExistsInDocument } from "@tiptap-pro/extension-comments";
import { TiptapCollabProvider } from "@tiptap-pro/provider";
import {
  NodePos,
  Range,
  type Command,
  type Editor,
  type EditorEvents,
  type JSONContent,
} from "@tiptap/core";
import Collaboration from "@tiptap/extension-collaboration";
import { TextStyle } from "@tiptap/extension-text-style";
import StarterKit from "@tiptap/starter-kit";
import { assert, vi } from "vitest";
import { describe, expect, test } from "~/fixtures";
import recordTransactions from "./utils/recordTransactions";

interface CommentContentCase {
  label: string;
  selectContent: Command;
  seedContent?: JSONContent;
}

const styledInlineSeedContent: JSONContent = {
  type: "doc",
  content: [
    {
      type: "paragraph",
      content: [
        { type: "text", text: "Before " },
        {
          type: "text",
          text: "bold styled",
          marks: [
            { type: "bold" },
            { type: "textStyle", attrs: { fontFamily: "Arial" } },
          ],
        },
        { type: "text", text: " after" },
      ],
    },
  ],
};

const selectStyledInline: Command = ({ editor, commands }) => {
  const nodePos = findNodeOrFail(
    editor.$doc,
    (node) =>
      node.type.name === "text" &&
      node.marks.some((mark) => mark.type.name === "bold") &&
      node.marks.some((mark) => mark.type.name === "textStyle")
  );

  return commands.setTextSelection(getTextRange(nodePos));
};

describe("tiptap comments", () => {
  describe.for<CommentContentCase>([
    {
      label: "block",
      selectContent({ editor, commands }) {
        const node = findNodeOrFail(
          editor.$doc,
          (node) => node.type.name === "paragraph"
        );
        return commands.setNodeSelection(node.pos);
      },
      seedContent: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: "Hello, world!" }],
          },
        ],
      },
    },
    {
      label: "inline",
      selectContent({ editor, commands }) {
        const range = getTextRange(
          findNodeOrFail(editor.$doc, (node) => node.type.name === "text")
        );
        return commands.setTextSelection({
          from: range.from + 1,
          to: range.to - 1,
        });
      },
      seedContent: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: "Hello, world!" }],
          },
        ],
      },
    },
    {
      label: "styled inline (simple)",
      selectContent({ editor, commands }) {
        const nodePos = findNodeOrFail(
          editor.$doc,
          (node) =>
            node.type.name === "text" &&
            node.marks.some((mark) => mark.type.name === "bold")
        );

        return commands.setTextSelection(getTextRange(nodePos));
      },
      seedContent: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              { type: "text", text: "Before " },
              {
                type: "text",
                text: "bold",
                marks: [{ type: "bold" }],
              },
              { type: "text", text: " after" },
            ],
          },
        ],
      },
    },
    {
      label: "styled inline",
      selectContent: selectStyledInline,
      seedContent: styledInlineSeedContent,
    },
  ])("with $label selection", ({ selectContent, seedContent }) => {
    test.override("seedContent", seedContent);

    test("can create thread on selection", async ({ editor }) => {
      const { threadId } = await createThreadAtSelection(editor, selectContent);
      await expectThreadExistsInDocument(editor, threadId);
    });

    test("thread persists after sync", async ({
      editor,
      provider,
      annotate,
      onTestFailed,
      onTestFinished,
    }) => {
      const recorder = recordTransactions(
        editor,
        (transaction) => transaction.getMeta("debug") === "test-thread-creation"
      );

      onTestFailed(() => {
        console.log(
          "transaction steps:",
          JSON.stringify(recorder.getTransactionSteps(), null, 2)
        );
      });

      onTestFinished(() => {
        recorder.unsubscribe();
      });

      const { threadId } = await createThreadAtSelection(editor, selectContent);

      const before = editor.getJSON();
      await flushChanges(provider);
      const after = editor.getJSON();

      await annotate("content after sync", {
        body: JSON.stringify(after, null, 2),
        contentType: "application/json",
      });

      expect.soft(before, "Editor JSON changed during sync").toEqual(after);
      await expectThreadExistsInDocument(editor, threadId);
    });
  });

  /**
   * Documents a client-schema mismatch: TextStyle alone cannot represent
   * fontFamily attrs, so y-prosemirror reconciliation during sync drops the
   * comment-only user's inlineThread mark.
   */
  describe("without FontFamily extension", () => {
    test.override("seedContent", styledInlineSeedContent);
    test.override("extensions", async ({ syncedProvider }) => [
      StarterKit.configure({ undoRedo: false, trailingNode: false }),
      TextStyle,
      Collaboration.configure({
        provider: syncedProvider,
        document: syncedProvider.document,
      }),
      CommentsKit.configure({
        provider: syncedProvider,
        deleteUnreferencedThreads: false,
        useLegacyWrapping: false,
      }),
    ]);

    test("comment-only user loses thread anchor after sync on styled text", async ({
      editor,
      provider,
      annotate,
    }) => {
      const { threadId } = await createThreadAtSelection(
        editor,
        selectStyledInline
      );

      expect(
        threadExistsInDocument(editor, threadId),
        "Thread should exist locally before sync"
      ).toBeTruthy();

      await flushChanges(provider);
      const after = editor.getJSON();

      await annotate("content after sync without FontFamily", {
        body: JSON.stringify(after, null, 2),
        contentType: "application/json",
      });

      expect(
        threadExistsInDocument(editor, threadId),
        "Thread anchor should be lost after sync when FontFamily is missing"
      ).toBeFalsy();
    });
  });
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
        .focus()
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

const flushChanges = vi.defineHelper(async function flushChanges(
  provider: TiptapCollabProvider
) {
  provider.startSync();

  provider.on("synced", () => {
    console.log("synced");
  });

  await vi.waitUntil(() => !provider.hasUnsyncedChanges, {
    timeout: 10_000,
  });
});

function findNode(
  root: NodePos,
  predicate: (node: NodePos["node"], nodePos: NodePos) => boolean
): NodePos | null {
  for (const nodePos of walkNodes(root)) {
    if (predicate(nodePos.node, nodePos)) {
      return nodePos;
    }
  }

  return null;
}

function findNodeOrFail(
  root: NodePos,
  predicate: (node: NodePos["node"], nodePos: NodePos) => boolean
): NodePos {
  const node = findNode(root, predicate);
  if (!node) {
    throw new Error("Node not found");
  }
  return node;
}

function* walkNodes(root: NodePos): Generator<NodePos> {
  if (!root.children || root.children.length === 0) {
    return;
  }

  for (const child of root.children) {
    yield child;
    yield* walkNodes(child);
  }
}

function getTextRange(nodePos: NodePos): Range {
  return {
    from: nodePos.pos - 1,
    to: nodePos.pos + nodePos.size - 1,
  };
}

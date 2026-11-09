import { Editor } from "@tiptap/core";
import Collaboration from "@tiptap/extension-collaboration";
import { afterEach, describe, expect, test } from "vitest";
import * as Y from "yjs";
import { blockAnchors, blockNodes } from "../utils/blockSchema";

/**
 * Issue 5, the mechanism, offline. An author edits; another client then only
 * comments. y-tiptap 3.0.10 writes a position-migration record, to its own
 * root `__tiptap_position_migrations:root:default`, in the same update as the
 * comment:
 *
 * - for every block comment, since wrapping a block is a structural step;
 * - for an inline comment, while the document holds a block that was emptied
 *   of its text, wherever the comment is.
 *
 * A comment-only connection may write only comments, so each case asserts the
 * commenter wrote to `default` alone. See docs/position-migrations.md.
 */

const editors: Editor[] = [];

afterEach(() => {
  while (editors.length) {
    editors.pop()?.destroy();
  }
});

function attach(ydoc: Y.Doc) {
  const editor = new Editor({
    extensions: [
      ...blockNodes,
      ...blockAnchors,
      Collaboration.configure({ document: ydoc }),
    ],
  });
  editors.push(editor);
  return editor;
}

/** An author's editor and a commenter's, on two documents kept in sync. */
function authorAndCommenter() {
  const authored = new Y.Doc();
  const commented = new Y.Doc();
  authored.on("update", (update, origin) => {
    if (origin !== commented) Y.applyUpdate(commented, update, authored);
  });
  commented.on("update", (update, origin) => {
    if (origin !== authored) Y.applyUpdate(authored, update, commented);
  });
  const author = attach(authored);
  author.commands.setContent(
    ["Alpha beta gamma", "Delta epsilon", "Zeta eta theta"].map((text) => ({
      type: "paragraph",
      content: [{ type: "text", text }],
    })),
  );
  return { author, commenter: attach(commented), commented };
}

/** The roots `ydoc` writes to while `act` runs. */
function rootsWritten(ydoc: Y.Doc, act: () => void): string[] {
  const roots = new Set<string>();
  const onTransaction = (transaction: Y.Transaction) => {
    if (!transaction.local) return;
    for (const type of transaction.changed.keys()) {
      let root = type as Y.AbstractType<unknown>;
      while (root._item) root = root._item.parent as Y.AbstractType<unknown>;
      roots.add(Y.findRootTypeKey(root));
    }
  };
  ydoc.on("afterTransaction", onTransaction);
  try {
    act();
  } finally {
    ydoc.off("afterTransaction", onTransaction);
  }
  return [...roots];
}

function positionOf(editor: Editor, text: string): number {
  let found = -1;
  editor.state.doc.descendants((node, pos) => {
    if (found < 0 && node.isText && node.text?.includes(text)) {
      found = pos + node.text.indexOf(text);
    }
  });
  if (found < 0) throw new Error(`No text "${text}"`);
  return found;
}

interface AuthorEdit {
  label: string;
  edit: (author: Editor) => void;
}

const EDITS: AuthorEdit[] = [
  { label: "nothing", edit: () => {} },
  {
    label: "splits a paragraph mid-text",
    edit: (author) =>
      author
        .chain()
        .setTextSelection(positionOf(author, "gamma"))
        .splitBlock()
        .run(),
  },
  {
    label: "merges two paragraphs",
    edit: (author) =>
      author
        .chain()
        .setTextSelection(positionOf(author, "Delta"))
        .joinBackward()
        .run(),
  },
  {
    label: "splits a paragraph at its start",
    edit: (author) =>
      author
        .chain()
        .setTextSelection(positionOf(author, "Delta"))
        .splitBlock()
        .run(),
  },
  {
    label: "deletes a paragraph's text",
    edit: (author) => {
      const from = positionOf(author, "Delta epsilon");
      author.commands.deleteRange({ from, to: from + "Delta epsilon".length });
    },
  },
];

interface Comment {
  label: string;
  comment: (commenter: Editor) => boolean;
}

// Both on the last paragraph, which no edit touches.
const COMMENTS: Comment[] = [
  {
    label: "an inline comment",
    comment: (commenter) => {
      const from = positionOf(commenter, "eta");
      return commenter
        .chain()
        .setTextSelection({ from, to: from + "eta".length })
        .setMark("inlineThread", { "data-thread-id": "thread-1" })
        .run();
    },
  },
  {
    label: "a block comment",
    comment: (commenter) =>
      commenter
        .chain()
        .setNodeSelection(positionOf(commenter, "Zeta") - 1)
        .wrapIn("blockThread", { "data-thread-id": "thread-1" })
        .run(),
  },
];

describe("given an author who edits and then a client who only comments", () => {
  describe.for(EDITS)("when the author $label", ({ edit }) => {
    test.for(COMMENTS)("$label writes only to default", ({ comment }) => {
      const { author, commenter, commented } = authorAndCommenter();
      edit(author);
      expect(commenter.getJSON()).toEqual(author.getJSON());

      const roots = rootsWritten(commented, () => {
        expect(comment(commenter), "failed to comment").toBe(true);
      });

      expect(roots).toEqual(["default"]);
    });
  });
});

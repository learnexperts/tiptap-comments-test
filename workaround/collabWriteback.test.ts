import {
  Editor,
  Extension,
  type Extensions,
  getSchema,
  type JSONContent,
  Node,
} from "@tiptap/core";
import Collaboration from "@tiptap/extension-collaboration";
import { TextStyle } from "@tiptap/extension-text-style";
import { BackgroundColor } from "@tiptap/extension-text-style/background-color";
import { Color } from "@tiptap/extension-text-style/color";
import { FontFamily } from "@tiptap/extension-text-style/font-family";
import { FontSize } from "@tiptap/extension-text-style/font-size";
import StarterKit from "@tiptap/starter-kit";
import { prosemirrorJSONToYDoc } from "@tiptap/y-tiptap";
import { BlockThread, InlineThread } from "@tiptap-pro/extension-comments";
import { afterEach, describe, expect, test } from "vitest";
import * as Y from "yjs";
import { CollabWriteback } from "./collabWriteback";

/**
 * The workaround's own contract, offline: what `CollabWriteback` changes, and
 * that it changes it only for the editor it was added to.
 *
 * Every assertion reads what ends up stored in Yjs, through real editors on
 * real documents — the interface the workaround presents.
 *
 * Self-contained, so it travels with the directory: `workaround/` never
 * imports from `tests/` (ADR 0002).
 */

const plainKit = StarterKit.configure({ undoRedo: false, trailingNode: false });

/** A paragraph with a non-null default, as an indent extension adds. */
const Paragraph = Node.create({
  name: "paragraph",
  priority: 1000,
  group: "block",
  content: "inline*",
  addAttributes: () => ({
    textAlign: { default: null },
    marginLeft: { default: 0 },
  }),
  parseHTML: () => [{ tag: "p" }],
  renderHTML: () => ["p", 0],
});

/** A code block declaring `language` before `theme` (default `"dark"`). */
const CodeBlock = Node.create({
  name: "codeBlock",
  group: "block",
  content: "text*",
  marks: "",
  code: true,
  addAttributes: () => ({
    language: { default: null },
    theme: { default: "dark" },
  }),
  parseHTML: () => [{ tag: "pre" }],
  renderHTML: () => ["pre", ["code", 0]],
});

/** Blocks whose attributes have a schema order and non-null defaults. */
const blockNodes: Extensions = [
  StarterKit.configure({
    undoRedo: false,
    trailingNode: false,
    paragraph: false,
    codeBlock: false,
  }),
  Paragraph,
  CodeBlock,
];

const blockAnchors: Extensions = [BlockThread, InlineThread];

const FIELD = "default";
const TARGET = "[target]";

const editors: Editor[] = [];

afterEach(() => {
  while (editors.length) {
    editors.pop()?.destroy();
  }
});

function attach(ydoc: Y.Doc, extensions: Extensions): Editor {
  const editor = new Editor({
    extensions: [
      ...extensions,
      Collaboration.configure({ document: ydoc, field: FIELD }),
    ],
  });
  editors.push(editor);
  return editor;
}

/** A document whose one block is stored with exactly these attributes, in order. */
function storedBlock(nodeName: string, attrs: Array<[string, unknown]>): Y.Doc {
  const ydoc = new Y.Doc();
  const element = new Y.XmlElement(nodeName);
  for (const [key, value] of attrs) {
    // biome-ignore lint/suspicious/noExplicitAny: Yjs types the value by KV.
    element.setAttribute(key, value as any);
  }
  element.insert(0, [new Y.XmlText(TARGET)]);
  ydoc.getXmlFragment(FIELD).insert(0, [element]);
  return ydoc;
}

/** Each top-level element's attribute keys, in stored order. */
function storedKeyOrder(ydoc: Y.Doc): string[][] {
  const order: string[][] = [];
  const visit = (type: Y.XmlFragment | Y.XmlElement) => {
    for (const child of type.toArray()) {
      if (child instanceof Y.XmlElement) {
        order.push([child.nodeName, ...Object.keys(child.getAttributes())]);
        visit(child);
      }
    }
  };
  visit(ydoc.getXmlFragment(FIELD));
  return order;
}

/** The `textStyle` value of each text run Yjs stores, in document order. */
function storedTextStyles(ydoc: Y.Doc): unknown[] {
  const styles: unknown[] = [];
  const visit = (type: Y.XmlFragment | Y.XmlElement) => {
    for (const child of type.toArray()) {
      if (child instanceof Y.XmlText) {
        for (const op of child.toDelta()) {
          styles.push(op.attributes?.textStyle);
        }
      } else if (child instanceof Y.XmlElement) {
        visit(child);
      }
    }
  };
  visit(ydoc.getXmlFragment(FIELD));
  return styles;
}

/** Types one character at the end of the first block, re-syncing it. */
function editFirstBlock(editor: Editor) {
  editor.commands.insertContentAt(1 + TARGET.length, "!");
}

/** A paragraph whose `marginLeft` defaults to `value`, for a second schema. */
const marginLeftDefault = (value: number) =>
  Extension.create({
    name: "marginLeftDefault",
    addGlobalAttributes: () => [
      { types: ["paragraph"], attributes: { marginLeft: { default: value } } },
    ],
  });

describe("CollabWriteback", () => {
  test("needs Collaboration on the same editor", () => {
    expect(
      () => new Editor({ extensions: [plainKit, CollabWriteback] }),
    ).toThrow(/Collaboration/);
  });

  describe("a default the stored block lacks", () => {
    test("is written by a stock editor", () => {
      const ydoc = storedBlock("paragraph", []);
      editFirstBlock(attach(ydoc, blockNodes));

      expect(storedKeyOrder(ydoc)).toEqual([["paragraph", "marginLeft"]]);
    });

    test("is not written with CollabWriteback", () => {
      const ydoc = storedBlock("paragraph", []);
      editFirstBlock(attach(ydoc, [...blockNodes, CollabWriteback]));

      expect(storedKeyOrder(ydoc)).toEqual([["paragraph"]]);
    });

    test("is still written by a stock editor beside a CollabWriteback one", () => {
      const patched = storedBlock("paragraph", []);
      const stock = storedBlock("paragraph", []);
      attach(patched, [...blockNodes, CollabWriteback]);
      editFirstBlock(attach(stock, blockNodes));

      expect(storedKeyOrder(stock)).toEqual([["paragraph", "marginLeft"]]);
    });

    test("is written again once the CollabWriteback editor is destroyed", () => {
      const ydoc = storedBlock("paragraph", []);
      attach(ydoc, [...blockNodes, CollabWriteback]).destroy();
      editFirstBlock(attach(ydoc, blockNodes));

      expect(storedKeyOrder(ydoc)).toEqual([["paragraph", "marginLeft"]]);
    });

    test("is judged by each editor's own schema", () => {
      // Each editor skips its own default and only its own: the second
      // schema's 8 is not a default for the first, whichever registered last.
      const zero = storedBlock("paragraph", []);
      const eight = storedBlock("paragraph", []);
      const first = attach(zero, [...blockNodes, CollabWriteback]);
      const second = attach(eight, [
        plainKit,
        marginLeftDefault(8),
        CollabWriteback,
      ]);

      editFirstBlock(first);
      editFirstBlock(second);

      expect(storedKeyOrder(zero)).toEqual([["paragraph"]]);
      expect(storedKeyOrder(eight)).toEqual([["paragraph"]]);
    });
  });

  describe("wrapping a block in a block anchor", () => {
    /** Wraps the first block in `blockThread`, as a node-selection thread does. */
    function wrapFirstBlock(editor: Editor) {
      expect(
        editor
          .chain()
          .setNodeSelection(0)
          .wrapIn("blockThread", { "data-thread-id": "thread-1" })
          .run(),
        "failed to wrap the block",
      ).toBe(true);
    }

    const stored: Array<[string, unknown]> = [
      ["theme", "dark"],
      ["language", "javascript"],
    ];

    test("rebuilds the block in schema order on a stock editor", () => {
      const ydoc = storedBlock("codeBlock", stored);
      wrapFirstBlock(attach(ydoc, [...blockNodes, ...blockAnchors]));

      expect(storedKeyOrder(ydoc)).toEqual([
        ["blockThread", "data-thread-id"],
        ["codeBlock", "language", "theme"],
      ]);
    });

    test("keeps the stored key order with CollabWriteback", () => {
      const ydoc = storedBlock("codeBlock", stored);
      wrapFirstBlock(
        attach(ydoc, [...blockNodes, ...blockAnchors, CollabWriteback]),
      );

      expect(storedKeyOrder(ydoc)).toEqual([
        ["blockThread", "data-thread-id"],
        ["codeBlock", "theme", "language"],
      ]);
    });

    test("leaves out a default the stored block lacked", () => {
      const ydoc = storedBlock("codeBlock", [["language", "javascript"]]);
      wrapFirstBlock(
        attach(ydoc, [...blockNodes, ...blockAnchors, CollabWriteback]),
      );

      expect(storedKeyOrder(ydoc)).toEqual([
        ["blockThread", "data-thread-id"],
        ["codeBlock", "language"],
      ]);
    });
  });

  test("writes back a textStyle value Yjs stores with null keys unchanged", () => {
    // Written by a client whose schema has `color`, so Yjs holds
    // `{ backgroundColor, color: null }`. Commenting must not rewrite it.
    const seed: JSONContent = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: TARGET,
              marks: [
                { type: "textStyle", attrs: { backgroundColor: "#E73E3E" } },
              ],
            },
          ],
        },
      ],
    };
    const ydoc = prosemirrorJSONToYDoc(
      getSchema([plainKit, TextStyle, BackgroundColor, Color]),
      seed,
      FIELD,
    );
    const before = storedTextStyles(ydoc);

    const editor = attach(ydoc, [
      plainKit,
      TextStyle,
      FontFamily,
      FontSize,
      Color,
      BackgroundColor,
      InlineThread,
      CollabWriteback,
    ]);
    editor
      .chain()
      .setTextSelection({ from: 1, to: 1 + TARGET.length })
      .setMark("inlineThread", { "data-thread-id": "thread-1" })
      .run();

    expect(before).toEqual([{ backgroundColor: "#E73E3E", color: null }]);
    expect(storedTextStyles(ydoc)).toEqual(before);
  });
});

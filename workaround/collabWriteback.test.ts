import {
  Editor,
  Extension,
  type Extensions,
  getSchema,
  type JSONContent,
  Mark,
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

// CollabWriteback's contract, read from what Yjs stores. Self-contained:
// workaround/ never imports from tests/ (ADR 0002).

const plainKit = StarterKit.configure({ undoRedo: false, trailingNode: false });

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

/** Each stored element as `[nodeName, ...children]`, a text as `#text`. */
function storedTree(ydoc: Y.Doc): unknown[] {
  const visit = (type: Y.XmlFragment | Y.XmlElement): unknown[] =>
    type
      .toArray()
      .map((child) =>
        child instanceof Y.XmlElement
          ? [child.nodeName, ...visit(child)]
          : "#text",
      );
  return visit(ydoc.getXmlFragment(FIELD));
}

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

/** Re-syncs the first block by typing at its end. */
function editFirstBlock(editor: Editor) {
  editor.commands.insertContentAt(1 + TARGET.length, "!");
}

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

    describe("emptied of its text", () => {
      // y-prosemirror never writes back a document that is one empty paragraph.
      function storedBlockBeforeARule() {
        const ydoc = storedBlock("paragraph", [["marginLeft", 0]]);
        ydoc.getXmlFragment(FIELD).push([new Y.XmlElement("horizontalRule")]);
        return ydoc;
      }

      // y-prosemirror empties a block's only text rather than deleting it.
      function emptyFirstBlock(editor: Editor, ydoc: Y.Doc) {
        editor.commands.deleteRange({ from: 1, to: 1 + TARGET.length });
        expect(storedTree(ydoc)).toEqual([
          ["paragraph", "#text"],
          ["horizontalRule"],
        ]);
        expect(
          (ydoc.getXmlFragment(FIELD).get(0) as Y.XmlElement).toString(),
        ).toBe('<paragraph marginLeft="0"></paragraph>');
      }

      test("rebuilds it without its empty text on a stock editor", () => {
        const ydoc = storedBlockBeforeARule();
        const editor = attach(ydoc, [...blockNodes, ...blockAnchors]);
        emptyFirstBlock(editor, ydoc);
        wrapFirstBlock(editor);

        expect(storedTree(ydoc)).toEqual([
          ["blockThread", ["paragraph"]],
          ["horizontalRule"],
        ]);
      });

      test("keeps its empty text with CollabWriteback", () => {
        const ydoc = storedBlockBeforeARule();
        const editor = attach(ydoc, [
          ...blockNodes,
          ...blockAnchors,
          CollabWriteback,
        ]);
        emptyFirstBlock(editor, ydoc);
        wrapFirstBlock(editor);

        expect(storedTree(ydoc)).toEqual([
          ["blockThread", ["paragraph", "#text"]],
          ["horizontalRule"],
        ]);
      });
    });
  });

  test("writes back a textStyle value Yjs stores with null keys unchanged", () => {
    // Stored by a client whose schema has `color`.
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

  describe("any mark, not only textStyle", () => {
    /** A mark whose attributes several extensions declare, as `textStyle`'s. */
    const annotation = (extra: Record<string, { default: unknown }> = {}) =>
      Mark.create({
        name: "annotation",
        addAttributes: () => ({ kind: { default: null }, ...extra }),
        parseHTML: () => [{ tag: "span[data-annotation]" }],
        renderHTML: () => ["span", { "data-annotation": "" }, 0],
      });

    const seed: JSONContent = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: TARGET,
              marks: [{ type: "annotation", attrs: { kind: "note" } }],
            },
          ],
        },
      ],
    };

    /** The `annotation` value of each text run Yjs stores. */
    function storedAnnotations(ydoc: Y.Doc): unknown[] {
      const fragment = ydoc.getXmlFragment(FIELD);
      const paragraph = fragment.get(0) as Y.XmlElement;
      const text = paragraph.get(0) as Y.XmlText;
      return text
        .toDelta()
        .map(
          (op: { attributes?: Record<string, unknown> }) =>
            op.attributes?.annotation,
        );
    }

    function commentOnTarget(editor: Editor) {
      editor
        .chain()
        .setTextSelection({ from: 1, to: 1 + TARGET.length })
        .setMark("inlineThread", { "data-thread-id": "thread-1" })
        .run();
    }

    test("writes back a value stored without null-default keys unchanged", () => {
      const ydoc = prosemirrorJSONToYDoc(
        getSchema([plainKit, annotation()]),
        seed,
        FIELD,
      );
      commentOnTarget(
        attach(ydoc, [
          plainKit,
          annotation({ author: { default: null } }),
          InlineThread,
          CollabWriteback,
        ]),
      );

      expect(storedAnnotations(ydoc)).toEqual([{ kind: "note" }]);
    });

    test("does not write a non-null default the stored value lacks, but still renders it", () => {
      const ydoc = prosemirrorJSONToYDoc(
        getSchema([plainKit, annotation()]),
        seed,
        FIELD,
      );
      const editor = attach(ydoc, [
        plainKit,
        annotation({ status: { default: "open" } }),
        InlineThread,
        CollabWriteback,
      ]);
      commentOnTarget(editor);

      expect(storedAnnotations(ydoc)).toEqual([{ kind: "note" }]);
      const annotationMark = editor.state.doc
        .nodeAt(1)
        ?.marks.find((mark) => mark.type.name === "annotation");
      expect(annotationMark?.attrs).toEqual({ kind: "note", status: "open" });
    });
  });

  describe("an overlapping mark", () => {
    // Overlapping, so y-prosemirror keys it in Yjs by a hash of its JSON.
    const Tag = Mark.create({
      name: "tag",
      excludes: "",
      addAttributes: () => ({
        zeta: { default: null },
        alpha: { default: null },
      }),
      parseHTML: () => [{ tag: "span[data-tag]" }],
      renderHTML: () => ["span", { "data-tag": "" }, 0],
    });

    function storedFormats(ydoc: Y.Doc): Array<[string, string[]]> {
      const paragraph = ydoc.getXmlFragment(FIELD).get(0) as Y.XmlElement;
      const text = paragraph.get(0) as Y.XmlText;
      return text
        .toDelta()
        .flatMap((op: { attributes?: Record<string, object> }) =>
          Object.entries(op.attributes ?? {}).map(
            ([key, value]): [string, string[]] => [key, Object.keys(value)],
          ),
        );
    }

    test("keeps the stored order of a mark read from Yjs", () => {
      const ydoc = prosemirrorJSONToYDoc(
        getSchema([plainKit, Tag]),
        {
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [
                {
                  type: "text",
                  text: TARGET,
                  marks: [{ type: "tag", attrs: { zeta: "z", alpha: "a" } }],
                },
              ],
            },
          ],
        },
        FIELD,
      );
      const before = storedFormats(ydoc);

      editFirstBlock(attach(ydoc, [plainKit, Tag, CollabWriteback]));

      expect(before.map(([, keys]) => keys)).toEqual([["zeta", "alpha"]]);
      expect(storedFormats(ydoc)).toEqual(before);
    });

    test("keeps its stored key when this schema adds an unset attribute", () => {
      // A narrower client stored it.
      const NarrowTag = Tag.extend({
        addAttributes: () => ({ alpha: { default: null } }),
      });
      const ydoc = prosemirrorJSONToYDoc(
        getSchema([plainKit, NarrowTag]),
        {
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [
                {
                  type: "text",
                  text: TARGET,
                  marks: [{ type: "tag", attrs: { alpha: "a" } }],
                },
              ],
            },
          ],
        },
        FIELD,
      );
      const before = storedFormats(ydoc);

      editFirstBlock(attach(ydoc, [plainKit, Tag, CollabWriteback]));

      expect(storedFormats(ydoc)).toEqual(before);
    });

    test("keeps its stored key when a stock client stored its unset attributes", () => {
      // A stock client writes every attribute, so Yjs holds `zeta: null` too.
      const ydoc = prosemirrorJSONToYDoc(
        getSchema([plainKit, Tag]),
        {
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [
                {
                  type: "text",
                  text: TARGET,
                  marks: [{ type: "tag", attrs: { alpha: "a" } }],
                },
              ],
            },
          ],
        },
        FIELD,
      );
      const before = storedFormats(ydoc);

      editFirstBlock(attach(ydoc, [plainKit, Tag, CollabWriteback]));

      expect(before.map(([, keys]) => keys)).toEqual([["zeta", "alpha"]]);
      expect(storedFormats(ydoc)).toEqual(before);
    });

    test("keeps its stored key when this schema adds a non-null default", () => {
      const ydoc = prosemirrorJSONToYDoc(
        getSchema([plainKit, Tag]),
        {
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [
                {
                  type: "text",
                  text: TARGET,
                  marks: [{ type: "tag", attrs: { alpha: "a" } }],
                },
              ],
            },
          ],
        },
        FIELD,
      );
      const before = storedFormats(ydoc);
      const TagWithStatus = Tag.extend({
        addAttributes() {
          return { ...this.parent?.(), status: { default: "open" } };
        },
      });

      editFirstBlock(attach(ydoc, [plainKit, TagWithStatus, CollabWriteback]));

      expect(storedFormats(ydoc)).toEqual(before);
    });
  });
});

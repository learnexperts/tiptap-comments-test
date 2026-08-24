import {
  Editor,
  getSchema,
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
import { prosemirrorJSONToYDoc } from "@tiptap/y-tiptap";
import { afterEach, describe, expect, test } from "vitest";
import * as Y from "yjs";
import {
  compactTextStyleAttrsInFragment,
  sparseAttrs,
} from "~/fixtures/editor/compactTextStyleYAttrs";
import { StripNullTextStyleAttrs } from "~/fixtures/editor/stripNullTextStyleAttrs";
import { SparseTextStyleDefaults } from "~/fixtures/editor/sparseTextStyleDefaults";

const FIELD = "default";

const styledSeed: JSONContent = {
  type: "doc",
  content: [
    {
      type: "paragraph",
      content: [
        {
          type: "text",
          text: "styled",
          marks: [{ type: "textStyle", attrs: { fontFamily: "Arial" } }],
        },
      ],
    },
  ],
};

const fullKit = [
  StarterKit.configure({ undoRedo: false, trailingNode: false }),
  TextStyle,
  FontFamily,
  FontSize,
  Color,
  BackgroundColor,
] as const;

function textStyleFromDelta(ydoc: Y.Doc): Record<string, unknown> | undefined {
  const stack: Array<Y.XmlFragment | Y.XmlElement> = [
    ydoc.getXmlFragment(FIELD),
  ];

  while (stack.length > 0) {
    const node = stack.pop()!;
    for (const child of node.toArray()) {
      if (child instanceof Y.XmlText) {
        for (const op of child.toDelta()) {
          const textStyle = op.attributes?.textStyle;
          if (textStyle && typeof textStyle === "object") {
            return textStyle as Record<string, unknown>;
          }
        }
        continue;
      }
      if (child instanceof Y.XmlElement) {
        stack.push(child);
      }
    }
  }

  return undefined;
}

function densifyTextStyleOnDoc(ydoc: Y.Doc): void {
  const stack: Array<Y.XmlFragment | Y.XmlElement> = [
    ydoc.getXmlFragment(FIELD),
  ];

  while (stack.length > 0) {
    const node = stack.pop()!;
    for (const child of node.toArray()) {
      if (child instanceof Y.XmlText) {
        let index = 0;
        for (const op of child.toDelta()) {
          const length =
            typeof op.insert === "string"
              ? op.insert.length
              : op.insert == null
                ? 0
                : 1;
          if (op.attributes?.textStyle) {
            child.format(index, length, {
              textStyle: {
                fontFamily: "Arial",
                fontSize: null,
                color: null,
                backgroundColor: null,
              },
            });
          }
          index += length;
        }
        continue;
      }
      if (child instanceof Y.XmlElement) {
        stack.push(child);
      }
    }
  }
}

function textStyleAttrsFromDoc(editor: Editor): Record<string, unknown> | undefined {
  let attrs: Record<string, unknown> | undefined;

  editor.state.doc.descendants((node) => {
    if (!node.isText) {
      return true;
    }
    const mark = node.marks.find((m) => m.type.name === "textStyle");
    if (mark) {
      attrs = mark.attrs as Record<string, unknown>;
      return false;
    }
    return true;
  });

  return attrs;
}

function textStyleHasNullKeys(attrs: Record<string, unknown> | undefined): boolean {
  if (!attrs) {
    return false;
  }
  return Object.values(attrs).some((value) => value == null || value === "");
}

describe("sparse textStyle attrs (offline)", () => {
  const cleanups: Array<() => void> = [];

  afterEach(() => {
    while (cleanups.length > 0) {
      cleanups.pop()?.();
    }
  });

  test("sparseAttrs drops null and empty values", () => {
    expect(
      sparseAttrs({
        fontFamily: "Arial",
        color: null,
        fontSize: "",
        backgroundColor: "#fff",
      })
    ).toEqual({ fontFamily: "Arial", backgroundColor: "#fff" });
  });

  test("full textStyle kit densifies null kit fields into Y on bind", () => {
    const ydoc = prosemirrorJSONToYDoc(
      getSchema([...fullKit]),
      styledSeed,
      FIELD
    );

    const element = document.createElement("div");
    document.body.appendChild(element);
    const editor = new Editor({
      element,
      extensions: [
        ...fullKit,
        Collaboration.configure({ document: ydoc, field: FIELD }),
      ] as Extensions,
    });
    cleanups.push(() => {
      editor.destroy();
      element.remove();
    });

    expect(textStyleFromDelta(ydoc)).toEqual({
      fontFamily: "Arial",
      fontSize: null,
      color: null,
      backgroundColor: null,
    });
  });

  test("compactTextStyleAttrsInFragment removes null kit fields from Y", () => {
    const ydoc = prosemirrorJSONToYDoc(
      getSchema([...fullKit]),
      styledSeed,
      FIELD
    );

    densifyTextStyleOnDoc(ydoc);
    expect(textStyleFromDelta(ydoc)).toEqual({
      fontFamily: "Arial",
      fontSize: null,
      color: null,
      backgroundColor: null,
    });

    compactTextStyleAttrsInFragment(ydoc.getXmlFragment(FIELD));

    expect(textStyleFromDelta(ydoc)).toEqual({ fontFamily: "Arial" });
  });

  test("SparseTextStyleDefaults keeps Y sparse after bind", () => {
    const ydoc = prosemirrorJSONToYDoc(
      getSchema([...fullKit, SparseTextStyleDefaults]),
      styledSeed,
      FIELD
    );

    const element = document.createElement("div");
    document.body.appendChild(element);
    const editor = new Editor({
      element,
      extensions: [
        ...fullKit,
        SparseTextStyleDefaults,
        Collaboration.configure({ document: ydoc, field: FIELD }),
      ] as Extensions,
    });
    cleanups.push(() => {
      editor.destroy();
      element.remove();
    });

    expect(textStyleFromDelta(ydoc)).toEqual({ fontFamily: "Arial" });
  });

  test("SparseTextStyleDefaults keeps Y sparse for color-only seed", () => {
    const colorSeed: JSONContent = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "styled",
              marks: [{ type: "textStyle", attrs: { color: "#6E1F1F" } }],
            },
          ],
        },
      ],
    };

    const ydoc = prosemirrorJSONToYDoc(
      getSchema([...fullKit, SparseTextStyleDefaults]),
      colorSeed,
      FIELD
    );

    const element = document.createElement("div");
    document.body.appendChild(element);
    const editor = new Editor({
      element,
      extensions: [
        ...fullKit,
        SparseTextStyleDefaults,
        Collaboration.configure({ document: ydoc, field: FIELD }),
      ] as Extensions,
    });
    cleanups.push(() => {
      editor.destroy();
      element.remove();
    });

    expect(textStyleFromDelta(ydoc)).toEqual({ color: "#6E1F1F" });
  });

  test("StripNullTextStyleAttrs alone does not sparse PM marks (schema defaults)", () => {
    const ydoc = prosemirrorJSONToYDoc(
      getSchema([...fullKit]),
      styledSeed,
      FIELD
    );

    const element = document.createElement("div");
    document.body.appendChild(element);
    const editor = new Editor({
      element,
      extensions: [
        ...fullKit,
        Collaboration.configure({ document: ydoc, field: FIELD }),
        StripNullTextStyleAttrs,
      ] as Extensions,
    });
    cleanups.push(() => {
      editor.destroy();
      element.remove();
    });

    const attrs = textStyleAttrsFromDoc(editor);
    expect(textStyleHasNullKeys(attrs)).toBe(true);
    expect(attrs?.fontFamily).toBe("Arial");
  });
});

import { Editor, getSchema } from "@tiptap/core";
import { TextStyle } from "@tiptap/extension-text-style";
import { BackgroundColor } from "@tiptap/extension-text-style/background-color";
import { Color } from "@tiptap/extension-text-style/color";
import { FontFamily } from "@tiptap/extension-text-style/font-family";
import { FontSize } from "@tiptap/extension-text-style/font-size";
import StarterKit from "@tiptap/starter-kit";
import { afterEach, describe, expect, test } from "vitest";
import {
  CanonicalizeTextStyleAttrs,
  canonicalizeTextStyleAttrs,
  patchTextStyleMarkCreate,
} from "~/fixtures/editor/canonicalizeTextStyleAttrs";
import { SparseTextStyleDefaults } from "~/fixtures/editor/sparseTextStyleDefaults";

const starter = StarterKit.configure({ undoRedo: false, trailingNode: false });
const fullKit = [
  starter,
  TextStyle,
  FontFamily,
  FontSize,
  Color,
  BackgroundColor,
  SparseTextStyleDefaults,
] as const;

describe("canonicalizeTextStyleAttrs", () => {
  test("keeps only supplied keys and sorts them", () => {
    expect(
      canonicalizeTextStyleAttrs(
        {
          backgroundColor: "#E73E3E",
          fontFamily: "Arial",
          fontSize: undefined,
          color: null,
        },
        ["fontFamily", "backgroundColor"]
      )
    ).toEqual({
      backgroundColor: "#E73E3E",
      fontFamily: "Arial",
    });

    expect(
      Object.keys(
        canonicalizeTextStyleAttrs(
          {
            fontSize: "36px",
            backgroundColor: "#E73E3E",
            fontFamily: "Arial",
          },
          ["fontSize", "backgroundColor", "fontFamily"]
        )
      )
    ).toEqual(["backgroundColor", "fontFamily", "fontSize"]);
  });

  test("preserves intentional null when that key was supplied", () => {
    expect(
      canonicalizeTextStyleAttrs(
        {
          fontFamily: "Arial",
          fontSize: null,
          color: undefined,
        },
        ["fontFamily", "fontSize"]
      )
    ).toEqual({
      fontFamily: "Arial",
      fontSize: null,
    });
  });

  test("patched create matches FontFamily-only attrs shape", () => {
    const fullSchema = getSchema([...fullKit]);
    const onlySchema = getSchema([starter, TextStyle, FontFamily]);

    patchTextStyleMarkCreate(fullSchema.marks.textStyle!);

    const fullMark = fullSchema.marks.textStyle!.create({
      fontFamily: "Arial",
    });
    const onlyMark = onlySchema.marks.textStyle!.create({
      fontFamily: "Arial",
    });

    expect(Object.keys(fullMark.attrs)).toEqual(["fontFamily"]);
    expect(fullMark.attrs).toEqual(onlyMark.attrs);
    expect(fullMark.toJSON()).toEqual(onlyMark.toJSON());
  });
});

describe("CanonicalizeTextStyleAttrs extension", () => {
  const cleanups: Array<() => void> = [];

  afterEach(() => {
    while (cleanups.length > 0) {
      cleanups.pop()?.();
    }
  });

  test("onBeforeCreate keeps editor marks sparse", () => {
    const element = document.createElement("div");
    document.body.appendChild(element);

    const editor = new Editor({
      element,
      extensions: [...fullKit, CanonicalizeTextStyleAttrs],
      content: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              {
                type: "text",
                text: "styled",
                marks: [
                  { type: "textStyle", attrs: { fontFamily: "Arial" } },
                ],
              },
            ],
          },
        ],
      },
    });

    cleanups.push(() => {
      editor.destroy();
      element.remove();
    });

    let attrs: Record<string, unknown> | undefined;
    editor.state.doc.descendants((node) => {
      if (!node.isText) {
        return;
      }
      const mark = node.marks.find((m) => m.type.name === "textStyle");
      if (mark) {
        attrs = mark.attrs as Record<string, unknown>;
      }
    });

    expect(attrs).toEqual({ fontFamily: "Arial" });
  });
});

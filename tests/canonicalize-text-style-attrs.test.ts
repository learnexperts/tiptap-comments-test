import { Editor, getSchema } from "@tiptap/core";
import { Mark } from "@tiptap/pm/model";
import { TextStyle } from "@tiptap/extension-text-style";
import { BackgroundColor } from "@tiptap/extension-text-style/background-color";
import { Color } from "@tiptap/extension-text-style/color";
import { FontFamily } from "@tiptap/extension-text-style/font-family";
import { FontSize } from "@tiptap/extension-text-style/font-size";
import StarterKit from "@tiptap/starter-kit";
import { afterEach, describe, expect, test } from "vitest";
import {
  CollabWriteback,
  canonicalizeTextStyleAttrs,
  canonicalTextStyleAttrsForWriteback,
  patchTextStyleMarkCreate,
  textStyleWritebackKeys,
} from "~/fixtures/editor/collabWriteback";
import {
  CanonicalizeAttrOrder,
  recordKeyOrderEquals,
  sortRecordKeys,
} from "~/fixtures/editor/canonicalizeAttrOrder";
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

  test("writeback helpers drop null and empty keys", () => {
    const attrs = {
      backgroundColor: "#E73E3E",
      fontFamily: "Arial",
      fontSize: null,
      color: "",
    };

    expect(textStyleWritebackKeys(attrs)).toEqual([
      "backgroundColor",
      "fontFamily",
    ]);
    expect(canonicalTextStyleAttrsForWriteback(attrs)).toEqual({
      backgroundColor: "#E73E3E",
      fontFamily: "Arial",
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

describe("CollabWriteback textStyle canonicalize", () => {
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
      extensions: [...fullKit, CollabWriteback],
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

  test("appendTransaction sparsifies densified marks before writeback", () => {
    const element = document.createElement("div");
    document.body.appendChild(element);

    const editor = new Editor({
      element,
      extensions: [...fullKit, CollabWriteback],
      content: "<p>x</p>",
    });

    cleanups.push(() => {
      editor.destroy();
      element.remove();
    });

    const textStyle = editor.schema.marks.textStyle!;
    const densified = new Mark(textStyle, {
      backgroundColor: "#E73E3E",
      fontFamily: "Arial",
      fontSize: null,
      color: null,
    });

    const { tr } = editor.state;
    tr.insert(1, editor.schema.text("styled", [densified]));
    editor.view.dispatch(tr);

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

    expect(attrs).toEqual({
      backgroundColor: "#E73E3E",
      fontFamily: "Arial",
    });
  });
});

describe("canonicalizeAttrOrder", () => {
  test("sorts keys and nested objects", () => {
    const sorted = sortRecordKeys({
      fontFamily: "Arial",
      backgroundColor: "#E73E3E",
    });

    expect(Object.keys(sorted)).toEqual(["backgroundColor", "fontFamily"]);
    expect(
      Object.keys(
        sortRecordKeys({
          textStyle: { fontSize: "18px", backgroundColor: "#E73E3E" },
          inlineThread: { "data-thread-id": "abc" },
        }).textStyle as Record<string, unknown>
      )
    ).toEqual(["backgroundColor", "fontSize"]);
  });

  test("detects key-order mismatch with equal values", () => {
    expect(
      recordKeyOrderEquals(
        { fontFamily: "Arial", backgroundColor: "#E73E3E" },
        { backgroundColor: "#E73E3E", fontFamily: "Arial" }
      )
    ).toBe(false);
    expect(
      recordKeyOrderEquals(
        { backgroundColor: "#E73E3E", fontFamily: "Arial" },
        { backgroundColor: "#E73E3E", fontFamily: "Arial" }
      )
    ).toBe(true);
  });

  test("appendTransaction rewrites unsorted mark attrs", () => {
    const element = document.createElement("div");
    document.body.appendChild(element);

    const editor = new Editor({
      element,
      extensions: [...fullKit, CollabWriteback, CanonicalizeAttrOrder],
      content: "<p>x</p>",
    });

    const textStyle = editor.schema.marks.textStyle!;
    const unsorted = new Mark(textStyle, {
      fontFamily: "Arial",
      backgroundColor: "#E73E3E",
    });

    const { tr } = editor.state;
    tr.insert(1, editor.schema.text("styled", [unsorted]));
    editor.view.dispatch(tr);

    let keys: string[] | undefined;
    editor.state.doc.descendants((node) => {
      if (!node.isText) {
        return;
      }
      const mark = node.marks.find((entry) => entry.type === textStyle);
      if (mark) {
        keys = Object.keys(mark.attrs);
      }
    });

    expect(keys).toEqual(["backgroundColor", "fontFamily"]);

    editor.destroy();
    element.remove();
  });
});

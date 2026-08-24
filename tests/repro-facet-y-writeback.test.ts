import { InlineThread } from "@tiptap-pro/extension-comments";
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
import {
  ReproFacet,
  SparseTextStyleDefaults,
} from "~/fixtures/editor";
import {
  markAttributeValues,
  reproFacetValuesEqual,
  segmentsWithoutCommentMarks,
  stableStringify,
  textStyleValuesEqual,
  yTextSegments,
} from "~/fixtures/editor/yMarkSnapshots";

const FIELD = "default";

const reproFacetOverlapSeed: JSONContent = {
  type: "doc",
  content: [
    {
      type: "paragraph",
      content: [
        { type: "text", text: "Before " },
        {
          type: "text",
          text: "styled",
          marks: [{ type: "reproFacet", attrs: { fontFamily: "Arial" } }],
        },
        { type: "text", text: " after" },
      ],
    },
  ],
};

const textStyleOverlapSeed: JSONContent = {
  type: "doc",
  content: [
    {
      type: "paragraph",
      content: [
        { type: "text", text: "Before " },
        {
          type: "text",
          text: "styled",
          marks: [{ type: "textStyle", attrs: { fontFamily: "Arial" } }],
        },
        { type: "text", text: " after" },
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

function findOverlapRange(editor: Editor): { from: number; to: number } {
  const pieces: Array<{ text: string; pos: number }> = [];
  editor.state.doc.descendants((node, pos) => {
    if (!node.isText || !node.text) {
      return true;
    }
    pieces.push({ text: node.text, pos });
    return true;
  });

  const before = pieces.find((piece) => piece.text === "Before ");
  const after = pieces.find((piece) => piece.text === " after");
  if (!before || !after) {
    throw new Error("overlap seed nodes missing");
  }

  return {
    from: before.pos + 1,
    to: after.pos + after.text.length - 1,
  };
}

function findExactStyledRange(editor: Editor, markName: string): {
  from: number;
  to: number;
} {
  let from = -1;
  let to = -1;

  editor.state.doc.descendants((node, pos) => {
    if (!node.isText || !node.text) {
      return true;
    }

    if (node.marks.some((mark) => mark.type.name === markName)) {
      if (from < 0) {
        from = pos;
      }
      to = pos + node.text.length;
    }

    return true;
  });

  if (from < 0 || to < 0) {
    throw new Error(`styled run for ${markName} not found`);
  }

  return { from, to };
}

describe("reproFacet Y writeback (offline)", () => {
  const cleanups: Array<() => void> = [];

  afterEach(() => {
    while (cleanups.length > 0) {
      cleanups.pop()?.();
    }
  });

  function bindEditor(ydoc: ReturnType<typeof prosemirrorJSONToYDoc>, extensions: Extensions) {
    const element = document.createElement("div");
    document.body.appendChild(element);

    const editor = new Editor({
      element,
      extensions: [
        ...extensions,
        InlineThread,
        Collaboration.configure({ document: ydoc, field: FIELD }),
      ] as Extensions,
    });

    cleanups.push(() => {
      editor.destroy();
      element.remove();
    });

    return editor;
  }

  test("reproFacet: editor bind keeps sparse attrs; setMark keeps them stable", () => {
    const reproFacetKit = [
      StarterKit.configure({ undoRedo: false, trailingNode: false }),
      ReproFacet,
    ];
    const ydoc = prosemirrorJSONToYDoc(
      getSchema(reproFacetKit),
      reproFacetOverlapSeed,
      FIELD
    );
    const editor = bindEditor(ydoc, reproFacetKit);
    const afterBind = yTextSegments(ydoc);
    const boundFacet = markAttributeValues(afterBind, "reproFacet")[0]
      ?.value as Record<string, unknown>;

    expect(boundFacet).toEqual({ fontFamily: "Arial" });

    const range = findExactStyledRange(editor, "reproFacet");
    editor
      .chain()
      .setTextSelection(range)
      .setMark("inlineThread", { "data-thread-id": "offline-exact" })
      .run();

    const afterThread = yTextSegments(ydoc);

    expect(reproFacetValuesEqual(afterBind, afterThread)).toBe(true);
  });

  test("reproFacet: overlap keeps reproFacet values but rest splits Y structure", () => {
    const reproFacetKit = [
      StarterKit.configure({ undoRedo: false, trailingNode: false }),
      ReproFacet,
    ];
    const ydoc = prosemirrorJSONToYDoc(
      getSchema(reproFacetKit),
      reproFacetOverlapSeed,
      FIELD
    );
    const before = yTextSegments(ydoc);
    const editor = bindEditor(ydoc, reproFacetKit);

    const range = findOverlapRange(editor);
    editor
      .chain()
      .setTextSelection(range)
      .setMark("inlineThread", { "data-thread-id": "offline-overlap" })
      .run();

    const after = yTextSegments(ydoc);

    expect(reproFacetValuesEqual(before, after)).toBe(true);
    expect(stableStringify(segmentsWithoutCommentMarks(before))).not.toBe(
      stableStringify(segmentsWithoutCommentMarks(after))
    );
  });

  test("sparse textStyle: exact inlineThread leaves textStyle values unchanged in Y", () => {
    const ydoc = prosemirrorJSONToYDoc(
      getSchema([...fullKit, SparseTextStyleDefaults]),
      textStyleOverlapSeed,
      FIELD
    );
    const before = yTextSegments(ydoc);
    const editor = bindEditor(ydoc, [...fullKit, SparseTextStyleDefaults]);

    const range = findExactStyledRange(editor, "textStyle");
    editor
      .chain()
      .setTextSelection(range)
      .setMark("inlineThread", { "data-thread-id": "offline-exact" })
      .run();

    const after = yTextSegments(ydoc);

    expect(textStyleValuesEqual(before, after)).toBe(true);
  });

  test("sparse textStyle: overlap keeps textStyle values but rest splits Y structure", () => {
    const ydoc = prosemirrorJSONToYDoc(
      getSchema([...fullKit, SparseTextStyleDefaults]),
      textStyleOverlapSeed,
      FIELD
    );
    const before = yTextSegments(ydoc);
    const editor = bindEditor(ydoc, [...fullKit, SparseTextStyleDefaults]);

    const range = findOverlapRange(editor);
    editor
      .chain()
      .setTextSelection(range)
      .setMark("inlineThread", { "data-thread-id": "offline-overlap" })
      .run();

    const after = yTextSegments(ydoc);

    expect(textStyleValuesEqual(before, after)).toBe(true);
    expect(stableStringify(segmentsWithoutCommentMarks(before))).not.toBe(
      stableStringify(segmentsWithoutCommentMarks(after))
    );
  });

  test("styling segments without comment marks diverge on overlap for both marks", () => {
    const reproFacetKit = [
      StarterKit.configure({ undoRedo: false, trailingNode: false }),
      ReproFacet,
    ];
    const facetDoc = prosemirrorJSONToYDoc(
      getSchema(reproFacetKit),
      reproFacetOverlapSeed,
      FIELD
    );
    const facetEditor = bindEditor(facetDoc, reproFacetKit);
    const facetBefore = segmentsWithoutCommentMarks(yTextSegments(facetDoc));
    facetEditor
      .chain()
      .setTextSelection(findOverlapRange(facetEditor))
      .setMark("inlineThread", { "data-thread-id": "facet-overlap" })
      .run();
    const facetAfter = segmentsWithoutCommentMarks(yTextSegments(facetDoc));

    const styleDoc = prosemirrorJSONToYDoc(
      getSchema([...fullKit, SparseTextStyleDefaults]),
      textStyleOverlapSeed,
      FIELD
    );
    const styleEditor = bindEditor(styleDoc, [...fullKit, SparseTextStyleDefaults]);
    const styleBefore = segmentsWithoutCommentMarks(yTextSegments(styleDoc));
    styleEditor
      .chain()
      .setTextSelection(findOverlapRange(styleEditor))
      .setMark("inlineThread", { "data-thread-id": "style-overlap" })
      .run();
    const styleAfter = segmentsWithoutCommentMarks(yTextSegments(styleDoc));

    expect(stableStringify(facetBefore)).not.toBe(stableStringify(facetAfter));
    expect(stableStringify(styleBefore)).not.toBe(stableStringify(styleAfter));
  });
});

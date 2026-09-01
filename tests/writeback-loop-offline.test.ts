import { InlineThread } from "@tiptap-pro/extension-comments";
import { Editor, type Extensions } from "@tiptap/core";
import Collaboration from "@tiptap/extension-collaboration";
import { TextStyle } from "@tiptap/extension-text-style";
import { BackgroundColor } from "@tiptap/extension-text-style/background-color";
import { Color } from "@tiptap/extension-text-style/color";
import { FontFamily } from "@tiptap/extension-text-style/font-family";
import { FontSize } from "@tiptap/extension-text-style/font-size";
import StarterKit from "@tiptap/starter-kit";
import { afterEach, describe, expect, test } from "vitest";
import * as Y from "yjs";
import { CollabWriteback } from "~/fixtures/editor/collabWriteback";
import {
  CompactTextStyleYAttrs,
  ySyncPluginKey,
} from "~/fixtures/editor/compactTextStyleYAttrs";
import { SparseTextStyleDefaults } from "~/fixtures/editor/sparseTextStyleDefaults";
import { yTextSegments } from "~/fixtures/editor/yMarkSnapshots";

const FIELD = "default";
const HIGHLIGHT = "#E73E3E";

function pmTextStyleKeys(editor: Editor): Array<{
  text: string;
  keys: string[];
  attrs: Record<string, unknown>;
  marks: string[];
}> {
  const rows: Array<{
    text: string;
    keys: string[];
    attrs: Record<string, unknown>;
    marks: string[];
  }> = [];

  editor.state.doc.descendants((node) => {
    if (!node.isText) {
      return;
    }

    const textStyle = node.marks.find((mark) => mark.type.name === "textStyle");
    rows.push({
      text: node.text ?? "",
      keys: textStyle ? Object.keys(textStyle.attrs) : [],
      attrs: (textStyle?.attrs ?? {}) as Record<string, unknown>,
      marks: node.marks.map((mark) => mark.type.name),
    });
  });

  return rows;
}

function encodeSize(ydoc: Y.Doc): number {
  return Y.encodeStateAsUpdate(ydoc).byteLength;
}

describe("PM→Y writeback loop (offline)", () => {
  const cleanups: Array<() => void> = [];

  afterEach(() => {
    while (cleanups.length > 0) {
      cleanups.pop()?.();
    }
  });

  test("second overlapping-style thread does not keep rewriting Y on view.update", () => {
    const ydoc = new Y.Doc();
    const element = document.createElement("div");
    document.body.appendChild(element);

    const editor = new Editor({
      element,
      extensions: [
        StarterKit.configure({ undoRedo: false, trailingNode: false }),
        TextStyle,
        FontFamily,
        FontSize,
        Color,
        BackgroundColor,
        SparseTextStyleDefaults,
        CollabWriteback,
        InlineThread,
        Collaboration.configure({ document: ydoc, field: FIELD }),
        CompactTextStyleYAttrs,
      ] as Extensions,
    });

    cleanups.push(() => {
      editor.destroy();
      element.remove();
    });

    expect(
      editor.commands.setContent({
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: "Before styled after" }],
          },
        ],
      })
    ).toBe(true);

    const paragraphPos = () => {
      let pos = 0;
      editor.state.doc.descendants((node, nodePos) => {
        if (node.type.name === "paragraph") {
          pos = nodePos;
          return false;
        }
      });
      return pos;
    };

    const selectOffsets = (start: number, end: number) => ({
      from: paragraphPos() + 1 + start,
      to: paragraphPos() + 1 + end,
    });

    expect(
      editor
        .chain()
        .setTextSelection(selectOffsets("Before ".length, "Before ".length + "styled".length))
        .setBackgroundColor(HIGHLIGHT)
        .run()
    ).toBe(true);

    expect(
      editor
        .chain()
        .setTextSelection(selectOffsets(1, 10))
        .setMark("inlineThread", { "data-thread-id": "thread-1" })
        .run()
    ).toBe(true);

    const afterFirst = JSON.stringify(yTextSegments(ydoc));

    expect(
      editor
        .chain()
        .setTextSelection(selectOffsets(10, "Before styled after".length - 1))
        .setMark("inlineThread", { "data-thread-id": "thread-2" })
        .run()
    ).toBe(true);

    const afterSecond = JSON.stringify(yTextSegments(ydoc));
    expect(afterSecond, afterFirst).not.toBe(afterFirst);

    const writebacks: Array<{
      changedParentTypes: number;
      changedSegments: boolean;
      changedUpdateSize: boolean;
    }> = [];

    let lastSegments = JSON.stringify(yTextSegments(ydoc));
    let lastSize = encodeSize(ydoc);

    ydoc.on("afterTransaction", (transaction) => {
      if (!(transaction.local && transaction.origin === ySyncPluginKey)) {
        return;
      }

      const nextSegments = JSON.stringify(yTextSegments(ydoc));
      const nextSize = encodeSize(ydoc);
      writebacks.push({
        changedParentTypes: transaction.changed.size,
        changedSegments: nextSegments !== lastSegments,
        changedUpdateSize: nextSize !== lastSize,
      });
      lastSegments = nextSegments;
      lastSize = nextSize;
    });

    for (let i = 0; i < 5; i += 1) {
      editor.view.dispatch(editor.state.tr.setMeta("probe-writeback", i));
    }

    expect(writebacks).toHaveLength(5);
    expect(
      writebacks.every(
        (entry) =>
          entry.changedParentTypes === 0 &&
          !entry.changedSegments &&
          !entry.changedUpdateSize
      ),
      JSON.stringify(writebacks, null, 2)
    ).toBe(true);

    expect(editor.schema.marks.inlineThread).toBeDefined();
  });
});

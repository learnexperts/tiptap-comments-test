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
import {
  CollabWriteback,
  patchYTextApplyDelta,
  stripUnchangedRetainAttributes,
} from "~/fixtures/editor/collabWriteback";
import {
  CompactTextStyleYAttrs,
  ySyncPluginKey,
} from "~/fixtures/editor/compactTextStyleYAttrs";
import { SparseTextStyleDefaults } from "~/fixtures/editor/sparseTextStyleDefaults";

const HIGHLIGHT = "#E73E3E";
const TEXT_STYLE = { backgroundColor: HIGHLIGHT };
const FIELD = "default";

function contentFormatKeys(update: Uint8Array): string[] {
  const { structs } = Y.decodeUpdate(update);
  const keys: string[] = [];

  for (const struct of structs) {
    const content = (
      struct as { content?: { key?: unknown; constructor?: { name?: string } } }
    ).content;
    if (
      content?.constructor?.name === "ContentFormat" &&
      typeof content.key === "string"
    ) {
      keys.push(content.key);
    }
  }

  return keys;
}

describe("stripUnchangedRetainAttributes", () => {
  test("drops retain textStyle that already matches Y and keeps the new mark", () => {
    const ydoc = new Y.Doc();
    const ytext = ydoc.getText("t");
    ytext.insert(0, "styled", { textStyle: TEXT_STYLE });

    expect(
      stripUnchangedRetainAttributes(ytext, [
        {
          retain: 6,
          attributes: {
            textStyle: { backgroundColor: HIGHLIGHT },
            "inlineThread--abc": { "data-thread-id": "t1" },
          },
        },
      ])
    ).toEqual([
      {
        retain: 6,
        attributes: { "inlineThread--abc": { "data-thread-id": "t1" } },
      },
    ]);
  });

  test("keeps textStyle when the visible value changed", () => {
    const ydoc = new Y.Doc();
    const ytext = ydoc.getText("t");
    ytext.insert(0, "styled", { textStyle: TEXT_STYLE });

    expect(
      stripUnchangedRetainAttributes(ytext, [
        {
          retain: 6,
          attributes: { textStyle: { backgroundColor: "#00FF00" } },
        },
      ])
    ).toEqual([
      {
        retain: 6,
        attributes: { textStyle: { backgroundColor: "#00FF00" } },
      },
    ]);
  });

  test("keeps a null unformat when Y still has the key", () => {
    const ydoc = new Y.Doc();
    const ytext = ydoc.getText("t");
    ytext.insert(0, "styled", { textStyle: TEXT_STYLE });

    expect(
      stripUnchangedRetainAttributes(ytext, [
        { retain: 6, attributes: { textStyle: null } },
      ])
    ).toEqual([{ retain: 6, attributes: { textStyle: null } }]);
  });

  test("leaves insert deltas unchanged", () => {
    const ydoc = new Y.Doc();
    const ytext = ydoc.getText("t");
    const delta = [
      { insert: "styled", attributes: { textStyle: TEXT_STYLE } },
    ];

    expect(stripUnchangedRetainAttributes(ytext, delta)).toBe(delta);
  });

  test("drops a null unformat when Y does not have the key", () => {
    const ydoc = new Y.Doc();
    const ytext = ydoc.getText("t");
    ytext.insert(0, "plain");

    expect(
      stripUnchangedRetainAttributes(ytext, [
        {
          retain: 5,
          attributes: {
            textStyle: null,
            "inlineThread--abc": { "data-thread-id": "t1" },
          },
        },
      ])
    ).toEqual([
      {
        retain: 5,
        attributes: { "inlineThread--abc": { "data-thread-id": "t1" } },
      },
    ]);
  });
});

describe("patchYTextApplyDelta", () => {
  test("y-sync retain still emits textStyle when the value changed", () => {
    patchYTextApplyDelta();

    const ydoc = new Y.Doc();
    const ytext = ydoc.getText("t");
    ytext.insert(0, "styled", { textStyle: TEXT_STYLE });

    const keys: string[] = [];
    ydoc.on("update", (update) => {
      keys.push(...contentFormatKeys(update));
    });

    ydoc.transact(() => {
      ytext.applyDelta([
        { retain: 6, attributes: { textStyle: { backgroundColor: "#00FF00" } } },
      ]);
    }, ySyncPluginKey);

    expect(keys).toContain("textStyle");
  });
});

describe("CollabWriteback surgical Y.Text writeback (offline editor)", () => {
  const cleanups: Array<() => void> = [];

  afterEach(() => {
    while (cleanups.length > 0) {
      cleanups.pop()?.();
    }
  });

  test("second overlapping thread writeback does not emit textStyle ContentFormat", () => {
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
        .setTextSelection(
          selectOffsets("Before ".length, "Before ".length + "styled".length)
        )
        .setBackgroundColor(HIGHLIGHT)
        .run()
    ).toBe(true);

    const writebackFormatKeys: string[][] = [];
    ydoc.on("update", (update, origin) => {
      if (origin !== ySyncPluginKey) {
        return;
      }
      writebackFormatKeys.push(contentFormatKeys(update));
    });

    expect(
      editor
        .chain()
        .setTextSelection(selectOffsets(1, 12))
        .setMark("inlineThread", { "data-thread-id": "thread-1" })
        .run()
    ).toBe(true);

    expect(
      editor
        .chain()
        .setTextSelection(selectOffsets(9, 18))
        .setMark("inlineThread", { "data-thread-id": "thread-2" })
        .run()
    ).toBe(true);

    expect(writebackFormatKeys.length).toBeGreaterThan(0);
    expect(
      writebackFormatKeys.every((keys) => !keys.includes("textStyle")),
      JSON.stringify(writebackFormatKeys)
    ).toBe(true);
    expect(
      writebackFormatKeys.some((keys) =>
        keys.some((key) => key.startsWith("inlineThread"))
      )
    ).toBe(true);
  });
});

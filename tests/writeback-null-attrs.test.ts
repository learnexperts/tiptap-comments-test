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
import type * as Y from "yjs";
import { afterEach, describe, expect, test } from "vitest";
import { CollabWriteback } from "~/workaround/collabWriteback";
import { yTextSegments } from "./utils/yMarkSnapshots";

/**
 * The mechanism behind the lost comment anchor, with no collab server involved.
 *
 * The server stores a `textStyle` mark holding only the attribute that was
 * actually set. The client registers every `textStyle` attribute extension, as
 * a production editor does, so its ProseMirror schema fills the rest in as
 * `null`. Applying an `inlineThread` mark writes that dense attribute bag back
 * into Yjs — a `textStyle` change the user never made.
 *
 * On a comment-only connection the server rejects that write, and the thread
 * anchor is dropped with it. That final step needs the integration test in
 * `tests/comment.test.ts`; everything leading up to it is shown here.
 */

const FIELD = "default";

const starterKit = StarterKit.configure({
  undoRedo: false,
  trailingNode: false,
});

/** What the server has: only the attribute that was set. */
const storedSchema = getSchema([starterKit, TextStyle, BackgroundColor]);

/** What a production client has: every `textStyle` attribute registered. */
const clientKit = [
  starterKit,
  TextStyle,
  FontFamily,
  FontSize,
  Color,
  BackgroundColor,
];

const HIGHLIGHTED = "styled";

const seedContent: JSONContent = {
  type: "doc",
  content: [
    {
      type: "paragraph",
      content: [
        { type: "text", text: "Before " },
        {
          type: "text",
          text: HIGHLIGHTED,
          marks: [
            { type: "textStyle", attrs: { backgroundColor: "#E73E3E" } },
          ],
        },
        { type: "text", text: " after" },
      ],
    },
  ],
};

const editors: Array<() => void> = [];

afterEach(() => {
  while (editors.length) {
    editors.pop()?.();
  }
});

/** The `textStyle` attrs Yjs holds for the highlighted run. */
function storedTextStyle(ydoc: Y.Doc) {
  return yTextSegments(ydoc)
    .filter((segment) => String(segment.text).includes(HIGHLIGHTED))
    .map((segment) => segment.attributes?.textStyle);
}

function seedAsServerWould() {
  return prosemirrorJSONToYDoc(storedSchema, seedContent, FIELD);
}

function attachClient(ydoc: Y.Doc, extra: Extensions = []) {
  const element = document.createElement("div");
  document.body.appendChild(element);

  const editor = new Editor({
    element,
    editable: true,
    extensions: [
      ...clientKit,
      Collaboration.configure({ document: ydoc, field: FIELD }),
      InlineThread,
      ...extra,
    ],
  });

  editors.push(() => {
    editor.destroy();
    element.remove();
  });

  return editor;
}

function setThreadOnHighlightedRun(editor: Editor) {
  const text = editor.state.doc.textBetween(0, editor.state.doc.content.size);
  const from = text.indexOf(HIGHLIGHTED) + 1;

  const applied = editor
    .chain()
    .focus()
    .setTextSelection({ from, to: from + HIGHLIGHTED.length })
    .setMark("inlineThread", { "data-thread-id": "thread-1" })
    .run();

  expect(applied, "failed to apply the inlineThread mark").toBe(true);
}

describe("comment-only writeback rewrites textStyle attrs", () => {
  test("the server stores only the attribute that was set", () => {
    expect(storedTextStyle(seedAsServerWould())).toEqual([
      { backgroundColor: "#E73E3E" },
    ]);
  });

  test("opening the document leaves the stored attrs alone", () => {
    const ydoc = seedAsServerWould();
    attachClient(ydoc);

    expect(storedTextStyle(ydoc)).toEqual([{ backgroundColor: "#E73E3E" }]);
  });

  test("setting an inline thread writes null attrs the server never stored", () => {
    const ydoc = seedAsServerWould();

    setThreadOnHighlightedRun(attachClient(ydoc));

    expect(storedTextStyle(ydoc)).toEqual([
      {
        fontFamily: null,
        fontSize: null,
        color: null,
        backgroundColor: "#E73E3E",
      },
    ]);
  });

  test("CollabWriteback keeps the stored attrs intact", () => {
    const ydoc = seedAsServerWould();

    setThreadOnHighlightedRun(attachClient(ydoc, [CollabWriteback]));

    expect(storedTextStyle(ydoc)).toEqual([{ backgroundColor: "#E73E3E" }]);
  });
});

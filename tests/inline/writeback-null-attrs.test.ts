import { Editor, getSchema, type JSONContent } from "@tiptap/core";
import Collaboration from "@tiptap/extension-collaboration";
import { TextStyle } from "@tiptap/extension-text-style";
import { BackgroundColor } from "@tiptap/extension-text-style/background-color";
import { Color } from "@tiptap/extension-text-style/color";
import { FontFamily } from "@tiptap/extension-text-style/font-family";
import { FontSize } from "@tiptap/extension-text-style/font-size";
import StarterKit from "@tiptap/starter-kit";
import { prosemirrorJSONToYDoc } from "@tiptap/y-tiptap";
import { InlineThread } from "@tiptap-pro/extension-comments";
import { afterEach, describe, expect, test } from "vitest";
import type * as Y from "yjs";
import { yTextSegments } from "../utils/yMarkSnapshots";

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
 * `tests/inline/comment.test.ts`; the write itself is shown here, offline.
 *
 * The second test asserts the behaviour we expect and currently fails. See
 * docs/comment-anchor-lost.md for why the write happens.
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
          marks: [{ type: "textStyle", attrs: { backgroundColor: "#E73E3E" } }],
        },
        { type: "text", text: " after" },
      ],
    },
  ],
};

const STORED = [{ backgroundColor: "#E73E3E" }];

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

function attachClient(ydoc: Y.Doc) {
  const element = document.createElement("div");
  document.body.appendChild(element);

  const editor = new Editor({
    element,
    editable: true,
    extensions: [
      ...clientKit,
      Collaboration.configure({ document: ydoc, field: FIELD }),
      InlineThread,
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
  test("opening the document leaves the stored attrs alone", () => {
    const ydoc = seedAsServerWould();
    attachClient(ydoc);

    expect(storedTextStyle(ydoc)).toEqual(STORED);
  });

  test("setting an inline thread leaves the stored attrs alone", () => {
    const ydoc = seedAsServerWould();
    const editor = attachClient(ydoc);
    expect(
      storedTextStyle(ydoc),
      "the server stores only what was set",
    ).toEqual(STORED);

    setThreadOnHighlightedRun(editor);

    // Adding a comment is not a styling change. Today this writes
    // `fontFamily: null, fontSize: null, color: null` alongside the value the
    // server stored — a `textStyle` edit the user never made.
    expect(
      storedTextStyle(ydoc),
      "adding a comment must not rewrite textStyle",
    ).toEqual(STORED);
  });
});

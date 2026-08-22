import { InlineThread } from "@tiptap-pro/extension-comments";
import {
  Editor,
  getSchema,
  type Extensions,
  type JSONContent,
} from "@tiptap/core";
import Collaboration from "@tiptap/extension-collaboration";
import { TextStyle } from "@tiptap/extension-text-style";
import { FontFamily } from "@tiptap/extension-text-style/font-family";
import StarterKit from "@tiptap/starter-kit";
import {
  prosemirrorJSONToYDoc,
  yDocToProsemirrorJSON,
} from "@tiptap/y-tiptap";
import { afterEach, describe, expect, test } from "vitest";
import * as Y from "yjs";

/**
 * Offline tests for the TextStyle/FontFamily schema-mismatch theory.
 *
 * No collab server: a local Y.Doc + Collaboration binding is enough to show
 * that without FontFamily, ProseMirror drops `fontFamily` while Yjs still has
 * it — and that the next mark writeback clears that attr from Y.
 *
 * The comment-only / read-only case where the thread *anchor* is lost after
 * sync still needs the integration test (server rejects the textStyle wipe).
 */

const FIELD = "default";

const styledSeed: JSONContent = {
  type: "doc",
  content: [
    {
      type: "paragraph",
      content: [
        { type: "text", text: "Before " },
        {
          type: "text",
          text: "bold styled",
          marks: [
            { type: "bold" },
            { type: "textStyle", attrs: { fontFamily: "Arial" } },
          ],
        },
        { type: "text", text: " after" },
      ],
    },
  ],
};

const baseExtensions = [
  StarterKit.configure({ undoRedo: false, trailingNode: false }),
  TextStyle,
] as const;

function schemaWithFontFamily() {
  return getSchema([...baseExtensions, FontFamily]);
}

function createEditor(options: {
  ydoc: Y.Doc;
  withFontFamily: boolean;
  withInlineThread?: boolean;
}) {
  const extensions: Extensions = [
    ...baseExtensions,
    Collaboration.configure({
      document: options.ydoc,
      field: FIELD,
    }),
  ];

  if (options.withFontFamily) {
    extensions.push(FontFamily);
  }

  if (options.withInlineThread) {
    extensions.push(InlineThread);
  }

  const element = document.createElement("div");
  document.body.appendChild(element);

  const editor = new Editor({
    element,
    editable: true,
    extensions,
  });

  return {
    editor,
    destroy() {
      editor.destroy();
      element.remove();
    },
  };
}

function seedYDoc(content: JSONContent): Y.Doc {
  return prosemirrorJSONToYDoc(schemaWithFontFamily(), content, FIELD);
}

function hasFontFamily(content: JSONContent): boolean {
  const walk = (node: JSONContent): boolean => {
    if (
      node.marks?.some(
        (mark) =>
          mark.type === "textStyle" && mark.attrs?.fontFamily === "Arial"
      )
    ) {
      return true;
    }

    return node.content?.some(walk) ?? false;
  };

  return walk(content);
}

function hasInlineThread(editor: Editor, threadId: string): boolean {
  let found = false;

  editor.state.doc.descendants((node) => {
    if (
      node.marks.some(
        (mark) =>
          mark.type.name === "inlineThread" &&
          mark.attrs["data-thread-id"] === threadId
      )
    ) {
      found = true;
      return false;
    }
    return true;
  });

  return found;
}

function findTextRange(
  editor: Editor,
  text: string
): { from: number; to: number } {
  const pieces: Array<{ text: string; pos: number }> = [];

  editor.state.doc.descendants((node, pos) => {
    if (!node.isText || !node.text) {
      return true;
    }
    pieces.push({ text: node.text, pos });
    return true;
  });

  const joined = pieces.map((piece) => piece.text).join("");
  const index = joined.indexOf(text);
  if (index < 0) {
    throw new Error(
      `Text "${text}" not found in: ${JSON.stringify(editor.getJSON(), null, 2)}`
    );
  }

  let seen = 0;
  let from = -1;
  let to = -1;

  for (const piece of pieces) {
    const next = seen + piece.text.length;
    if (from < 0 && index < next) {
      from = piece.pos + (index - seen);
    }
    if (to < 0 && index + text.length <= next) {
      to = piece.pos + (index + text.length - seen);
      break;
    }
    seen = next;
  }

  if (from < 0 || to < 0) {
    throw new Error(`Failed to map text range for "${text}"`);
  }

  return { from, to };
}

function assertOk(value: boolean, message = "Command failed"): asserts value {
  if (!value) {
    throw new Error(message);
  }
}

describe("schema mismatch without FontFamily (offline)", () => {
  const cleanups: Array<() => void> = [];

  afterEach(() => {
    while (cleanups.length > 0) {
      cleanups.pop()?.();
    }
  });

  test("Y.Doc seeded with FontFamily schema retains fontFamily", () => {
    const ydoc = seedYDoc(styledSeed);

    expect(hasFontFamily(yDocToProsemirrorJSON(ydoc, FIELD))).toBe(true);
  });

  test("editor with FontFamily preserves fontFamily from Y.Doc", () => {
    const ydoc = seedYDoc(styledSeed);
    const { editor, destroy } = createEditor({
      ydoc,
      withFontFamily: true,
    });
    cleanups.push(destroy);

    expect(hasFontFamily(editor.getJSON())).toBe(true);
  });

  test("without FontFamily, editor drops fontFamily while Y still has it", () => {
    const ydoc = seedYDoc(styledSeed);
    const { editor, destroy } = createEditor({
      ydoc,
      withFontFamily: false,
    });
    cleanups.push(destroy);

    expect(
      hasFontFamily(editor.getJSON()),
      "ProseMirror schema cannot represent fontFamily"
    ).toBe(false);
    expect(
      hasFontFamily(yDocToProsemirrorJSON(ydoc, FIELD)),
      "Yjs still carries fontFamily until a mark writeback"
    ).toBe(true);
  });

  test("without FontFamily, mark writeback strips fontFamily from Y but keeps the mark", () => {
    const ydoc = seedYDoc(styledSeed);
    const threadId = "offline-thread-1";
    const { editor, destroy } = createEditor({
      ydoc,
      withFontFamily: false,
      withInlineThread: true,
    });
    cleanups.push(destroy);

    expect(hasFontFamily(yDocToProsemirrorJSON(ydoc, FIELD))).toBe(true);

    assertOk(
      editor
        .chain()
        .setTextSelection(findTextRange(editor, "bold styled"))
        .setMark("inlineThread", { "data-thread-id": threadId })
        .run()
    );

    expect(hasInlineThread(editor, threadId)).toBe(true);
    expect(
      hasFontFamily(yDocToProsemirrorJSON(ydoc, FIELD)),
      "Writable binding writes textStyle({}) back and clears fontFamily"
    ).toBe(false);
  });

  test("with FontFamily, mark writeback preserves fontFamily and the mark", () => {
    const ydoc = seedYDoc(styledSeed);
    const threadId = "offline-thread-2";
    const { editor, destroy } = createEditor({
      ydoc,
      withFontFamily: true,
      withInlineThread: true,
    });
    cleanups.push(destroy);

    assertOk(
      editor
        .chain()
        .setTextSelection(findTextRange(editor, "bold styled"))
        .setMark("inlineThread", { "data-thread-id": threadId })
        .run()
    );

    expect(hasInlineThread(editor, threadId)).toBe(true);
    expect(hasFontFamily(editor.getJSON())).toBe(true);
    expect(hasFontFamily(yDocToProsemirrorJSON(ydoc, FIELD))).toBe(true);
  });
});

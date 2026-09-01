import { getSchema, JSONContent } from "@tiptap/core";
import { Node } from "@tiptap/pm/model";
import StarterKit from "@tiptap/starter-kit";
import { describe, expect, test } from "vitest";
import { offsetCursorPosition, offsetTextPosition } from "./positions";

const schema = getSchema([
  StarterKit.configure({ undoRedo: false, trailingNode: false }),
]);

function doc(...content: JSONContent[]): Node {
  return schema.nodeFromJSON({ type: "doc", content });
}

function p(...content: JSONContent[]): JSONContent {
  return { type: "paragraph", content };
}

function text(value: string): JSONContent {
  return { type: "text", text: value };
}

describe("offsetTextPosition", () => {
  describe("given a paragraph Hello", () => {
    // <p> H e l l o </p>
    //  0  1 2 3 4 5 6  7
    const hello = () => doc(p(text("Hello")));

    test("offset 0 does not move", () => {
      const $pos = hello().resolve(1);
      expect(offsetTextPosition($pos, 0).pos).toBe(1);
    });

    test("moves forward by characters within the same text node", () => {
      expect(offsetTextPosition(hello().resolve(1), 2).pos).toBe(3);
    });

    test("moves backward by characters within the same text node", () => {
      expect(offsetTextPosition(hello().resolve(6), -2).pos).toBe(4);
    });

    test("skips the paragraph open token to reach characters", () => {
      expect(offsetTextPosition(hello().resolve(0), 2).pos).toBe(3);
    });

    test("skips the paragraph close token when moving backward", () => {
      expect(offsetTextPosition(hello().resolve(7), -2).pos).toBe(4);
    });

    test("clamps to the start of the document", () => {
      expect(offsetTextPosition(hello().resolve(1), -20).pos).toBe(0);
    });

    test("clamps to the end of the document", () => {
      expect(offsetTextPosition(hello().resolve(1), 20).pos).toBe(7);
    });
  });

  describe("given a hard break between Hello and World", () => {
    // <p> H e l l o <br> W o r  l  d </p>
    //  0  1 2 3 4 5 6    7 8 9 10 11 12  13
    const helloWorld = () =>
      doc(p(text("Hello"), { type: "hardBreak" }, text("World")));

    test("skips the hard break when moving forward", () => {
      expect(offsetTextPosition(helloWorld().resolve(1), 6).pos).toBe(8);
    });

    test("skips the hard break when moving backward", () => {
      expect(offsetTextPosition(helloWorld().resolve(7), -1).pos).toBe(5);
    });
  });

  describe("given adjacent paragraphs A and B", () => {
    // <p> A </p><p> B </p>
    //  0  1 2  3 4  5 6
    const ab = () => doc(p(text("A")), p(text("B")));

    test("crosses paragraph boundaries to the next character", () => {
      expect(offsetTextPosition(ab().resolve(1), 2).pos).toBe(5);
    });

    test("crosses paragraph boundaries to the previous character", () => {
      expect(offsetTextPosition(ab().resolve(5), -2).pos).toBe(1);
    });
  });

  describe("given a blockquote wrapping Hi", () => {
    // <blockquote><p> H i </p></blockquote>
    //  0           1  2 3 4  5            6
    const quoted = () =>
      doc({
        type: "blockquote",
        content: [p(text("Hi"))],
      });

    test("skips nested open tokens to reach characters", () => {
      expect(offsetTextPosition(quoted().resolve(0), 1).pos).toBe(3);
    });

    test("skips nested close tokens when moving backward", () => {
      expect(offsetTextPosition(quoted().resolve(6), -1).pos).toBe(3);
    });
  });
});

describe("offsetCursorPosition", () => {
  describe("given a paragraph Hello", () => {
    // <p> H e l l o </p>
    //  0  1 2 3 4 5 6  7
    const hello = () => doc(p(text("Hello")));

    test("offset 0 does not move", () => {
      expect(offsetCursorPosition(hello().resolve(1), 0).pos).toBe(1);
    });

    test("moves forward one position per keypress within a text node", () => {
      expect(offsetCursorPosition(hello().resolve(1), 2).pos).toBe(3);
    });

    test("moves backward one position per keypress within a text node", () => {
      expect(offsetCursorPosition(hello().resolve(6), -2).pos).toBe(4);
    });

    test("clamps to the first cursor position in the document", () => {
      expect(offsetCursorPosition(hello().resolve(3), -20).pos).toBe(1);
    });

    test("clamps to the last cursor position in the document", () => {
      expect(offsetCursorPosition(hello().resolve(3), 20).pos).toBe(6);
    });
  });

  describe("given a hard break between Hello and World", () => {
    // <p> H e l l o <br> W o r  l  d </p>
    //  0  1 2 3 4 5 6    7 8 9 10 11 12  13
    const helloWorld = () =>
      doc(p(text("Hello"), { type: "hardBreak" }, text("World")));

    test("charges one keypress for crossing the hard break", () => {
      // Contrast offsetTextPosition, which crosses it for free and lands at 8.
      expect(offsetCursorPosition(helloWorld().resolve(1), 6).pos).toBe(7);
    });

    test("charges one keypress crossing the hard break backwards", () => {
      expect(offsetCursorPosition(helloWorld().resolve(7), -1).pos).toBe(6);
    });
  });

  describe("given adjacent paragraphs A and B", () => {
    // <p> A </p><p> B </p>
    //  0  1 2  3 4  5 6  7
    const ab = () => doc(p(text("A")), p(text("B")));

    test("charges one keypress for the two positions of a block boundary", () => {
      // pos 2 ends paragraph A; one keypress crosses its close token and B's
      // open token together, landing at 4 — the start of B's content.
      expect(offsetCursorPosition(ab().resolve(2), 1).pos).toBe(4);
    });

    test("charges one keypress crossing a block boundary backwards", () => {
      expect(offsetCursorPosition(ab().resolve(4), -1).pos).toBe(2);
    });
  });

  describe("given a blockquote wrapping Hi", () => {
    // <blockquote><p> H i </p></blockquote>
    //  0           1  2 3 4  5            6
    const quoted = () =>
      doc(p(text("X")), { type: "blockquote", content: [p(text("Hi"))] });

    test("charges one keypress for a nested block boundary", () => {
      // pos 2 ends the first paragraph; one keypress enters the quoted one.
      expect(offsetCursorPosition(quoted().resolve(2), 1).pos).toBe(5);
    });
  });

  describe("given a position outside inline content", () => {
    // <blockquote><p> A </p></blockquote><p> B </p>
    //  0           1  2 3  4            5 6  7 8  9
    // Position 5 sits between the two blocks, where no cursor can go.
    const quotedThenPlain = () =>
      doc({ type: "blockquote", content: [p(text("A"))] }, p(text("B")));

    test("snaps forward onto a cursor position without spending a move", () => {
      // Guards the `|| 1` in offsetCursorPosition: a zero direction makes
      // ProseMirror's findSelectionIn spin forever here rather than fail.
      expect(offsetCursorPosition(quotedThenPlain().resolve(5), 0).pos).toBe(6);
    });

    test("still moves the requested number of times afterwards", () => {
      expect(offsetCursorPosition(quotedThenPlain().resolve(5), 1).pos).toBe(7);
    });
  });

  describe("given an empty paragraph between A and B", () => {
    // <p> A </p><p></p><p> B </p>
    //  0  1 2  3    4    5 6 7  8
    // The empty paragraph offers exactly one cursor position, at 4.
    const gapped = () => doc(p(text("A")), p(), p(text("B")));

    test("stops in the empty paragraph", () => {
      expect(offsetCursorPosition(gapped().resolve(2), 1).pos).toBe(4);
    });

    test("passes through it on the next keypress", () => {
      expect(offsetCursorPosition(gapped().resolve(2), 2).pos).toBe(6);
    });

    test("stops in it travelling backwards too", () => {
      expect(offsetCursorPosition(gapped().resolve(6), -1).pos).toBe(4);
    });
  });
});

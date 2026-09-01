import { Editor, JSONContent } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { afterEach, describe, expect, test } from "vitest";
import { query, queryAll, queryOrFail } from "./query";

const editors: Editor[] = [];

afterEach(() => {
  while (editors.length) {
    editors.pop()?.destroy();
  }
});

function docOf(...content: JSONContent[]): Editor {
  const editor = new Editor({
    content: { type: "doc", content },
    extensions: [
      StarterKit.configure({ undoRedo: false, trailingNode: false }),
    ],
  });

  editors.push(editor);
  return editor;
}

function p(...content: JSONContent[]): JSONContent {
  return { type: "paragraph", content };
}

function text(value: string, marks?: JSONContent["marks"]): JSONContent {
  return { type: "text", text: value, marks };
}

describe("query", () => {
  describe("given a paragraph of three text runs", () => {
    // <p>[before] [target] [after]</p>
    const editor = () =>
      docOf(
        p(
          text("[before] "),
          text("[target]", [{ type: "bold" }]),
          text(" [after]"),
        ),
      );

    test("finds a text node by its exact content", () => {
      const match = query(editor().$doc, {
        nodeType: "text",
        text: "[target]",
      });

      expect(match?.node.text).toBe("[target]");
    });

    test("returns the matched run itself, not its parent", () => {
      const match = queryOrFail(editor().$doc, {
        nodeType: "text",
        text: "[target]",
      });

      expect(match.node.isText).toBe(true);
      expect(match.node.nodeSize).toBe("[target]".length);
      expect(match.node.marks.map((mark) => mark.type.name)).toEqual(["bold"]);
    });

    test("returns null when nothing matches", () => {
      expect(query(editor().$doc, { nodeType: "text", text: "nope" })).toBe(
        null,
      );
    });

    test("matches a node type without a text constraint", () => {
      const match = query(editor().$doc, { nodeType: "paragraph" });

      expect(match?.node.type.name).toBe("paragraph");
    });
  });

  describe("given text nested inside a blockquote", () => {
    const editor = () =>
      docOf(p(text("outer")), {
        type: "blockquote",
        content: [p(text("inner"))],
      });

    test("descends into nested blocks", () => {
      const match = query(editor().$doc, { nodeType: "text", text: "inner" });

      expect(match?.node.text).toBe("inner");
    });

    test("finds the nested paragraph as well as the top-level one", () => {
      const paragraphs = [
        ...queryAll(editor().$doc, { nodeType: "paragraph" }),
      ];

      expect(paragraphs.map((match) => match.node.textContent)).toEqual([
        "outer",
        "inner",
      ]);
    });
  });

  describe("given repeated text", () => {
    const editor = () => docOf(p(text("same")), p(text("same")));

    test("yields every match in document order", () => {
      const matches = [
        ...queryAll(editor().$doc, { nodeType: "text", text: "same" }),
      ];

      expect(matches).toHaveLength(2);
      expect(matches[0].pos).toBeLessThan(matches[1].pos);
    });

    test("query returns only the first", () => {
      const found = editor();
      const first = query(found.$doc, { nodeType: "text", text: "same" });
      const all = [...queryAll(found.$doc, { nodeType: "text", text: "same" })];

      expect(first?.pos).toBe(all[0].pos);
    });
  });

  describe("given nodes distinguished by attributes", () => {
    const editor = () =>
      docOf(
        { type: "heading", attrs: { level: 1 }, content: [text("one")] },
        { type: "heading", attrs: { level: 2 }, content: [text("two")] },
      );

    test("matches on attributes", () => {
      const match = query(editor().$doc, {
        nodeType: "heading",
        attributes: { level: 2 },
      });

      expect(match?.node.textContent).toBe("two");
    });
  });

  describe("queryOrFail", () => {
    test("throws with the given message when nothing matches", () => {
      const found = docOf(p(text("hello")));

      expect(() =>
        queryOrFail(found.$doc, { text: "missing" }, "Target not found"),
      ).toThrowError("Target not found");
    });
  });
});

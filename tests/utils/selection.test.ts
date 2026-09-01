import { Editor, type JSONContent } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { afterEach, describe, expect, test } from "vitest";
import { queryAll, queryOrFail } from "./query";
import {
  asNodeSelection,
  asTextSelection,
  nodeRange,
  sliceSelection,
} from "./selection";

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

const bold = [{ type: "bold" }];

/**
 * ProseMirror merges adjacent text nodes carrying identical marks, so the
 * target run only stays addressable on its own while it is marked.
 */
const threeRuns = () =>
  docOf(p(text("[before] "), text("[target]", bold), text(" [after]")));

describe("text node merging", () => {
  test("adjacent runs with identical marks collapse into one node", () => {
    const found = docOf(
      p(text("[before] "), text("[target]"), text(" [after]")),
    );
    const runs = [...queryAll(found.$doc, (node) => node.isText)];

    expect(runs).toHaveLength(1);
    expect(runs[0].node.text).toBe("[before] [target] [after]");
  });

  test("a differing mark keeps the runs separate", () => {
    const runs = [...queryAll(threeRuns().$doc, (node) => node.isText)];

    expect(runs.map((run) => run.node.text)).toEqual([
      "[before] ",
      "[target]",
      " [after]",
    ]);
  });
});

describe("nodeRange", () => {
  // <p> [ b e f o r e ]   [ t a  r  g  e  t  ]   [ a  f  t  e  r  ] </p>
  //  0  1                10                  18 19                26  27
  const editor = threeRuns;

  const target = (found: Editor) =>
    queryOrFail(found.$doc, { nodeType: "text", text: "[target]" });

  test("covers a text node's own range, not its parent's", () => {
    expect(nodeRange(target(editor()))).toEqual({ from: 10, to: 18 });
  });

  test("covers a textblock including its open and close tokens", () => {
    const found = editor();
    const paragraph = queryOrFail(found.$doc, { nodeType: "paragraph" });

    expect(nodeRange(paragraph)).toEqual({ from: 0, to: 27 });
  });

  test("covers a leading text node", () => {
    const found = editor();
    const before = queryOrFail(found.$doc, {
      nodeType: "text",
      text: "[before] ",
    });

    expect(nodeRange(before)).toEqual({ from: 1, to: 10 });
  });

  test("covers a non-text atom without an opening token", () => {
    const found = docOf(p(text("Hi"), { type: "hardBreak" }, text("there")));
    const br = queryOrFail(found.$doc, { nodeType: "hardBreak" });

    expect(nodeRange(br)).toEqual({ from: 3, to: 4 });
  });
});

describe("asTextSelection", () => {
  const editor = threeRuns;

  test("spans the matched text rather than collapsing", () => {
    const found = editor();
    const selection = asTextSelection(
      found.state.doc,
      queryOrFail(found.$doc, { nodeType: "text", text: "[target]" }),
    );

    expect(selection.empty).toBe(false);
    expect(found.state.doc.textBetween(selection.from, selection.to)).toBe(
      "[target]",
    );
  });
});

describe("sliceSelection", () => {
  const editor = threeRuns;

  const target = (found: Editor) =>
    queryOrFail(found.$doc, { nodeType: "text", text: "[target]" });

  test("selects a slice by offsets relative to the node start", () => {
    const found = editor();
    const selection = sliceSelection(found.state.doc, target(found), 0, 4);

    expect(found.state.doc.textBetween(selection.from, selection.to)).toBe(
      "[tar",
    );
  });

  test("accepts a negative offset to reach into the preceding run", () => {
    const found = editor();
    const selection = sliceSelection(found.state.doc, target(found), -4, 8);

    expect(found.state.doc.textBetween(selection.from, selection.to)).toBe(
      "re] [target]",
    );
  });
});

describe("asNodeSelection", () => {
  test("selects a paragraph as a node", () => {
    const found = docOf(p(text("Hello")));
    const selection = asNodeSelection(
      found.state.doc,
      queryOrFail(found.$doc, { nodeType: "paragraph" }),
    );

    expect(selection.node.type.name).toBe("paragraph");
    expect(selection.node.textContent).toBe("Hello");
  });

  test("refuses a text node", () => {
    const found = docOf(p(text("Hello")));
    const run = queryOrFail(found.$doc, { nodeType: "text", text: "Hello" });

    expect(() => asNodeSelection(found.state.doc, run)).toThrowError(
      /not selectable/,
    );
  });
});

import { threadExistsInDocument } from "@tiptap-pro/extension-comments";
import type { JSONContent } from "@tiptap/core";
import { describe, expect, test } from "~/fixtures";
import {
  fullKitSparseExtensions,
  reproFacetExtensions,
} from "~/fixtures/editor/extensionSets";
import {
  reproFacetValuesEqual,
  textStyleValuesEqual,
  yDocFromEditor,
  yTextSegments,
} from "~/fixtures/editor/yMarkSnapshots";
import { queryOrFail } from "~/lib/query";
import { TextSelection, asTextSelection, nodeRange } from "~/lib/selection";
import { waitUntilFlushed } from "./utils/flushChanges";
import {
  createThreadAtSelection,
  expectThreadExistsInDocument,
  type SelectionFactory,
} from "./utils/thread";

/**
 * Compares styling attributes in Yjs before and after a *local* `setThread`,
 * before any sync happens. This separates two failure modes that look
 * identical from the editor's point of view: the client spuriously rewriting
 * mark attributes during writeback, versus the server rejecting an otherwise
 * correct update because the mark is not on its allowlist.
 *
 * The reproFacet overlap case is the one place that asserts anchor loss
 * directly, so it doubles as the canary for that server-side behaviour.
 */

function markedRunSeed(mark: JSONContent["marks"]): JSONContent {
  return {
    type: "paragraph",
    content: [
      { type: "text", text: "Before " },
      { type: "text", text: "styled", marks: mark },
      { type: "text", text: " after" },
    ],
  };
}

function selectMarkedRun(markName: string): SelectionFactory {
  return (editor) =>
    asTextSelection(
      editor.state.doc,
      queryOrFail(
        editor.$doc,
        (node) =>
          node.isText && node.marks.some((mark) => mark.type.name === markName),
        `No run carrying a ${markName} mark`,
      ),
    );
}

/**
 * Selects from inside the leading unstyled run, through the marked run, into
 * the trailing run — crossing the mark boundary at both edges.
 */
const selectMiddleRunOverlap: SelectionFactory = (editor) => {
  const before = queryOrFail(editor.$doc, {
    nodeType: "text",
    text: "Before ",
  });
  const after = queryOrFail(editor.$doc, { nodeType: "text", text: " after" });

  return TextSelection.create(
    editor.state.doc,
    nodeRange(before).from + 1,
    nodeRange(after).to - 1,
  );
};

describe("Y mark equality before sync", () => {
  describe("given a reproFacet mark", () => {
    test.override(
      "seedContent",
      markedRunSeed([{ type: "reproFacet", attrs: { fontFamily: "Arial" } }]),
    );
    test.override("extensions", reproFacetExtensions);

    test("exact selection leaves Y values untouched and keeps the anchor", async ({
      editor,
      provider,
    }) => {
      const ydoc = yDocFromEditor(editor);
      const before = yTextSegments(ydoc);

      const { threadId } = await createThreadAtSelection(
        editor,
        selectMarkedRun("reproFacet"),
      );

      expect(reproFacetValuesEqual(before, yTextSegments(ydoc))).toBe(true);

      await waitUntilFlushed(provider);
      expectThreadExistsInDocument(editor, threadId);
    });

    test("overlapping selection loses the anchor on sync", async ({
      editor,
      provider,
    }) => {
      const { threadId } = await createThreadAtSelection(
        editor,
        selectMiddleRunOverlap,
      );

      expect(
        threadExistsInDocument(editor, threadId),
        "Thread should be anchored locally before sync",
      ).toBe(true);

      await waitUntilFlushed(provider);

      expect(
        threadExistsInDocument(editor, threadId),
        "Expected the anchor to be dropped for an unrecognised mark",
      ).toBe(false);
    });
  });

  describe("given a textStyle mark with sparse defaults", () => {
    test.override(
      "seedContent",
      markedRunSeed([{ type: "textStyle", attrs: { fontFamily: "Arial" } }]),
    );
    test.override("extensions", fullKitSparseExtensions);

    test("exact selection leaves Y values untouched and keeps the anchor", async ({
      editor,
      provider,
    }) => {
      const ydoc = yDocFromEditor(editor);
      const before = yTextSegments(ydoc);

      const { threadId } = await createThreadAtSelection(
        editor,
        selectMarkedRun("textStyle"),
      );

      expect(textStyleValuesEqual(before, yTextSegments(ydoc))).toBe(true);

      await waitUntilFlushed(provider);
      expectThreadExistsInDocument(editor, threadId);
    });

    test("overlapping selection leaves Y values untouched and keeps the anchor", async ({
      editor,
      provider,
    }) => {
      const ydoc = yDocFromEditor(editor);
      const before = yTextSegments(ydoc);

      const { threadId } = await createThreadAtSelection(
        editor,
        selectMiddleRunOverlap,
      );

      expect(textStyleValuesEqual(before, yTextSegments(ydoc))).toBe(true);
      expect(
        threadExistsInDocument(editor, threadId),
        "Thread should be anchored locally before sync",
      ).toBe(true);

      await waitUntilFlushed(provider);
      expectThreadExistsInDocument(editor, threadId);
    });
  });
});

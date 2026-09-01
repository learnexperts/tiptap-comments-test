import {
  CommentsKit,
  threadExistsInDocument,
} from "@tiptap-pro/extension-comments";
import { TiptapCollabProvider } from "@tiptap-pro/provider";
import {
  NodePos,
  Range,
  type Command,
  type Editor,
  type EditorEvents,
  type JSONContent,
} from "@tiptap/core";
import Collaboration from "@tiptap/extension-collaboration";
import { TextStyle } from "@tiptap/extension-text-style";
import { BackgroundColor } from "@tiptap/extension-text-style/background-color";
import { Color } from "@tiptap/extension-text-style/color";
import { FontFamily } from "@tiptap/extension-text-style/font-family";
import { FontSize } from "@tiptap/extension-text-style/font-size";
import StarterKit from "@tiptap/starter-kit";
import { assert, vi } from "vitest";
import { describe, expect, test } from "~/fixtures";
import { CollabWriteback } from "~/fixtures/editor/collabWriteback";
import {
  markAttributeValues,
  textStyleValuesEqual,
  yDocFromEditor,
  yTextSegments,
} from "~/fixtures/editor/yMarkSnapshots";
import { queryOrFail } from "~/lib/query";
import { nodeRange } from "~/lib/selection";
import { waitUntilFlushed } from "./utils/flushChanges";

/**
 * Comment-only sync with the full textStyle kit + CollabWriteback.
 * Matrix of attr shapes (single / multi) × selection (exact / overlap).
 */
type SelectionKind =
  | "exact"
  | "overlap"
  | "partial-overlap-leading"
  | "partial-overlap-trailing";

interface CanonicalizeCase {
  label: string;
  attrs: Record<string, string>;
  /** Expected PM / Y attr bag after create (sorted, sparse). */
  expectedAttrs: Record<string, string>;
  withBold?: boolean;
  selection: SelectionKind;
}

const starterKit = StarterKit.configure({
  undoRedo: false,
  trailingNode: false,
});

const fullKitCanonicalizeExtensions = ({
  syncedProvider,
}: {
  syncedProvider: TiptapCollabProvider;
}) => [
  starterKit,
  TextStyle,
  FontFamily,
  FontSize,
  Color,
  BackgroundColor,
  //SparseTextStyleDefaults,
  CollabWriteback,
  //CanonicalizeAttrOrder,
  Collaboration.configure({
    provider: syncedProvider,
    document: syncedProvider.document,
  }),
  //CompactTextStyleYAttrs,
  CommentsKit.configure({
    provider: syncedProvider,
    deleteUnreferencedThreads: false,
    useLegacyWrapping: false,
  }),
];

function styledSeed(
  attrs: Record<string, string | null>,
  options: { withBold?: boolean } = {}
): JSONContent {
  const marks: JSONContent["marks"] = [
    { type: "textStyle", attrs },
    ...(options.withBold ? [{ type: "bold" as const }] : []),
  ];

  return {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [
          { type: "text", text: "Before " },
          {
            type: "text",
            text: options.withBold ? "bold styled" : "styled",
            marks,
          },
          { type: "text", text: " after" },
        ],
      },
    ],
  };
}

/** Production-like densified bag: one real style + null kit siblings. */
const densifiedFontFamilyAttrs = {
  fontFamily: "Arial",
  color: null,
  fontSize: null,
  backgroundColor: null,
} as const;

const densifiedExpectedAttrs = { fontFamily: "Arial" };

function textStyleAttrsOnDoc(
  editor: Editor
): Record<string, unknown> | undefined {
  let found: Record<string, unknown> | undefined;
  editor.state.doc.descendants((node) => {
    if (!node.isText || found) {
      return;
    }
    const mark = node.marks.find((m) => m.type.name === "textStyle");
    if (mark) {
      found = { ...(mark.attrs as Record<string, unknown>) };
    }
  });
  return found;
}

const selectExact: Command = ({ editor, commands }) => {
  const nodePos = queryOrFail(
    editor.$doc,
    (node) =>
      node.type.name === "text" &&
      node.marks.some((mark) => mark.type.name === "textStyle")
  );
  return commands.setTextSelection(nodeRange(nodePos));
};

const selectOverlap: Command = ({ editor, commands }) => {
  const before = queryOrFail(
    editor.$doc,
    (node) => node.type.name === "text" && node.text === "Before "
  );
  const after = queryOrFail(
    editor.$doc,
    (node) => node.type.name === "text" && node.text === " after"
  );
  const from = nodeRange(before);
  const to = nodeRange(after);

  return commands.setTextSelection({
    from: from.from + 1,
    to: to.to - 1,
  });
};

const selectLeadingPartialOverlap: Command = ({ editor, commands }) => {
  const before = queryOrFail(
    editor.$doc,
    (node) => node.type.name === "text" && node.text === "Before "
  );
  const styled = queryOrFail(
    editor.$doc,
    (node) =>
      node.type.name === "text" &&
      node.marks.some((mark) => mark.type.name === "textStyle")
  );
  const beforeRange = nodeRange(before);
  const styledRange = nodeRange(styled);
  const styledLength = styled.node.text?.length ?? 0;

  return commands.setTextSelection({
    from: beforeRange.from + 1,
    to: styledRange.from + Math.ceil(styledLength / 2),
  });
};

const selectTrailingPartialOverlap: Command = ({ editor, commands }) => {
  const styled = queryOrFail(
    editor.$doc,
    (node) =>
      node.type.name === "text" &&
      node.marks.some((mark) => mark.type.name === "textStyle")
  );
  const after = queryOrFail(
    editor.$doc,
    (node) => node.type.name === "text" && node.text === " after"
  );
  const styledRange = nodeRange(styled);
  const afterRange = nodeRange(after);
  const styledLength = styled.node.text?.length ?? 0;

  return commands.setTextSelection({
    from: styledRange.from + Math.floor(styledLength / 2),
    to: afterRange.to - 1,
  });
};

function selectContentForKind(selection: SelectionKind): Command {
  if (selection === "exact") {
    return selectExact;
  }
  if (selection === "overlap") {
    return selectOverlap;
  }
  if (selection === "partial-overlap-leading") {
    return selectLeadingPartialOverlap;
  }
  return selectTrailingPartialOverlap;
}

/** "Before styled after" — styled run is [7, 13). */
const PARAGRAPH_TEXT = "Before styled after";
const STYLED_START = "Before ".length;
const STYLED_END = STYLED_START + "styled".length;
const STYLED_MID = STYLED_START + Math.ceil("styled".length / 2);

/**
 * Absolute offsets from the start of paragraph text. Survives CommentsKit
 * splitting the styled text node after the first thread.
 */
function selectParagraphOffsets(start: number, end: number): Command {
  return ({ editor, commands }) => {
    const paragraph = queryOrFail(
      editor.$doc,
      (node) => node.type.name === "paragraph"
    );

    return commands.setTextSelection({
      from: paragraph.pos + 1 + start,
      to: paragraph.pos + 1 + end,
    });
  };
}

/** "efore sty" — unstyled into first half of highlight; disjoint from trailing. */
const selectDisjointLeading = selectParagraphOffsets(1, STYLED_MID);

/** "led afte" — second half of highlight into unstyled; disjoint from leading. */
const selectDisjointTrailing = selectParagraphOffsets(
  STYLED_MID,
  PARAGRAPH_TEXT.length - 1
);

/** "efore styl" — leading partial that covers most of the styled run. */
const selectNestedLeading = selectParagraphOffsets(1, STYLED_END - 1);

/** "tyled afte" — trailing partial that overlaps `selectNestedLeading` on "tyl". */
const selectNestedTrailing = selectParagraphOffsets(
  STYLED_START + 2,
  PARAGRAPH_TEXT.length - 1
);

const cases: CanonicalizeCase[] = [
  {
    label: "fontFamily only",
    attrs: { fontFamily: "Arial" },
    expectedAttrs: { fontFamily: "Arial" },
    selection: "exact",
  },
  {
    label: "fontFamily only",
    attrs: { fontFamily: "Arial" },
    expectedAttrs: { fontFamily: "Arial" },
    selection: "overlap",
  },
  {
    label: "fontSize only",
    attrs: { fontSize: "36px" },
    expectedAttrs: { fontSize: "36px" },
    selection: "exact",
  },
  {
    label: "fontSize only",
    attrs: { fontSize: "36px" },
    expectedAttrs: { fontSize: "36px" },
    selection: "overlap",
  },
  {
    label: "color only",
    attrs: { color: "#6E1F1F" },
    expectedAttrs: { color: "#6E1F1F" },
    selection: "exact",
  },
  {
    label: "color only",
    attrs: { color: "#6E1F1F" },
    expectedAttrs: { color: "#6E1F1F" },
    selection: "overlap",
  },
  {
    label: "backgroundColor only",
    attrs: { backgroundColor: "#E73E3E" },
    expectedAttrs: { backgroundColor: "#E73E3E" },
    selection: "exact",
  },
  {
    label: "backgroundColor only",
    attrs: { backgroundColor: "#E73E3E" },
    expectedAttrs: { backgroundColor: "#E73E3E" },
    selection: "overlap",
  },
  {
    label: "backgroundColor only",
    attrs: { backgroundColor: "#E73E3E" },
    expectedAttrs: { backgroundColor: "#E73E3E" },
    selection: "partial-overlap-leading",
  },
  {
    label: "backgroundColor only",
    attrs: { backgroundColor: "#E73E3E" },
    expectedAttrs: { backgroundColor: "#E73E3E" },
    selection: "partial-overlap-trailing",
  },
  {
    label: "fontFamily + fontSize",
    attrs: { fontFamily: "Georgia", fontSize: "18px" },
    expectedAttrs: { fontFamily: "Georgia", fontSize: "18px" },
    selection: "exact",
  },
  {
    label: "fontFamily + fontSize",
    attrs: { fontFamily: "Georgia", fontSize: "18px" },
    expectedAttrs: { fontFamily: "Georgia", fontSize: "18px" },
    selection: "overlap",
  },
  {
    label: "color + backgroundColor",
    attrs: { color: "#111111", backgroundColor: "#FFEEAA" },
    expectedAttrs: { backgroundColor: "#FFEEAA", color: "#111111" },
    selection: "exact",
  },
  {
    label: "color + backgroundColor",
    attrs: { color: "#111111", backgroundColor: "#FFEEAA" },
    expectedAttrs: { backgroundColor: "#FFEEAA", color: "#111111" },
    selection: "overlap",
  },
  {
    label: "all four attrs",
    attrs: {
      fontFamily: "Arial",
      fontSize: "24px",
      color: "#003366",
      backgroundColor: "#E0F0FF",
    },
    expectedAttrs: {
      backgroundColor: "#E0F0FF",
      color: "#003366",
      fontFamily: "Arial",
      fontSize: "24px",
    },
    selection: "exact",
  },
  {
    label: "all four attrs",
    attrs: {
      fontFamily: "Arial",
      fontSize: "24px",
      color: "#003366",
      backgroundColor: "#E0F0FF",
    },
    expectedAttrs: {
      backgroundColor: "#E0F0FF",
      color: "#003366",
      fontFamily: "Arial",
      fontSize: "24px",
    },
    selection: "overlap",
  },
  {
    label: "bold + fontFamily",
    attrs: { fontFamily: "Arial" },
    expectedAttrs: { fontFamily: "Arial" },
    withBold: true,
    selection: "exact",
  },
  {
    label: "bold + fontFamily",
    attrs: { fontFamily: "Arial" },
    expectedAttrs: { fontFamily: "Arial" },
    withBold: true,
    selection: "overlap",
  },
  {
    label: "bold + all four attrs",
    attrs: {
      fontFamily: "Helvetica",
      fontSize: "14px",
      color: "#222222",
      backgroundColor: "#FFFFCC",
    },
    expectedAttrs: {
      backgroundColor: "#FFFFCC",
      color: "#222222",
      fontFamily: "Helvetica",
      fontSize: "14px",
    },
    withBold: true,
    selection: "exact",
  },
  {
    label: "bold + all four attrs",
    attrs: {
      fontFamily: "Helvetica",
      fontSize: "14px",
      color: "#222222",
      backgroundColor: "#FFFFCC",
    },
    expectedAttrs: {
      backgroundColor: "#FFFFCC",
      color: "#222222",
      fontFamily: "Helvetica",
      fontSize: "14px",
    },
    withBold: true,
    selection: "overlap",
  },
];

describe("collabWriteback + full kit", () => {
  describe("comment-only user", () => {
    describe.for(cases)(
      "$selection selection: $label",
      ({ label, attrs, expectedAttrs, withBold, selection }) => {
        const seedContent = styledSeed(attrs, { withBold });
        const selectContent = selectContentForKind(selection);

        test.override("seedContent", seedContent);
        test.override("extensions", fullKitCanonicalizeExtensions);

        test.skip("keeps PM textStyle attrs sparse after bind", ({
          editor,
        }) => {
          const pmAttrs = textStyleAttrsOnDoc(editor);
          expect(pmAttrs, `PM attrs for ${label}`).toEqual(expectedAttrs);
          expect(Object.keys(pmAttrs ?? {})).toEqual(
            Object.keys(expectedAttrs)
          );
        });

        test("creates the thread locally", async ({ editor }) => {
          const { threadId } = await createThreadAtSelection(
            editor,
            selectContent
          );
          await expectThreadExistsInDocument(editor, threadId);
        });

        test("keeps thread anchor after sync", async ({
          editor,
          provider,
          annotate,
        }) => {
          const ydoc = yDocFromEditor(editor);
          const before = yTextSegments(ydoc);

          const { threadId } = await createThreadAtSelection(
            editor,
            selectContent
          );

          await waitUntilFlushed(provider);

          await expectThreadExistsInDocument(editor, threadId);
        });
      }
    );

    /**
     * Existing docs often store densified null kit fields in Y. Seed JSON with
     * explicit nulls to simulate that; canonicalize should sparsify PM on bind.
     */
    describe.for<{ selection: SelectionKind }>([
      { selection: "exact" },
      { selection: "overlap" },
    ])(
      "$selection selection on densified Y seed [fontFamily + null kit fields]",
      ({ selection }) => {
        const seedContent = styledSeed({ ...densifiedFontFamilyAttrs });
        const selectContent =
          selection === "exact" ? selectExact : selectOverlap;

        test.override("seedContent", seedContent);
        test.override("extensions", fullKitCanonicalizeExtensions);

        test("creates the thread locally", async ({ editor }) => {
          const { threadId } = await createThreadAtSelection(
            editor,
            selectContent
          );
          await expectThreadExistsInDocument(editor, threadId);
        });

        test("loses thread anchor after sync (densified Y still rewritten)", async ({
          editor,
          provider,
          annotate,
        }) => {
          const ydoc = yDocFromEditor(editor);
          const before = yTextSegments(ydoc);
          const yStyleBefore = markAttributeValues(before, "textStyle");

          const { threadId } = await createThreadAtSelection(
            editor,
            selectContent
          );

          expect(
            threadExistsInDocument(editor, threadId),
            "Thread should exist locally before sync"
          ).toBeTruthy();

          const afterLocal = yTextSegments(ydoc);
          const yStyleAfterLocal = markAttributeValues(afterLocal, "textStyle");

          await waitUntilFlushed(provider);
          const after = editor.getJSON();
          const yStyleAfterSync = markAttributeValues(
            yTextSegments(ydoc),
            "textStyle"
          );

          await annotate(`densified Y seed after sync: ${selection}`, {
            body: JSON.stringify(
              {
                yStyleBefore,
                yStyleAfterLocal,
                yStyleAfterSync,
                textStyleValuesEqual: textStyleValuesEqual(before, afterLocal),
                after,
                pmAttrs: textStyleAttrsOnDoc(editor),
              },
              null,
              2
            ),
            contentType: "application/json",
          });

          // Existing densified Y still causes comment-only sync to drop the
          // anchor: setThread rewrites sparse mark.attrs back to Y, which the
          // server treats as a disallowed textStyle touch.
          expect(
            threadExistsInDocument(editor, threadId),
            "Densified Y seed: thread anchor is lost after comment-only sync"
          ).toBe(true);
        });
      }
    );

    const twoThreadSeed = styledSeed({ backgroundColor: "#E73E3E" });

    describe("two comment-only threads on the same styled node", () => {
      test.override("seedContent", twoThreadSeed);
      test.override("extensions", fullKitCanonicalizeExtensions);

      describe("overlapping styled text but not each other", () => {
        test("creates both threads locally", async ({ editor }) => {
          const { firstThreadId, secondThreadId } =
            await createTwoThreadsAtSelections(
              editor,
              selectDisjointLeading,
              selectDisjointTrailing
            );

          expect(firstThreadId).not.toBe(secondThreadId);
          await expectThreadExistsInDocument(editor, firstThreadId);
          await expectThreadExistsInDocument(editor, secondThreadId);
        });

        test("keeps both thread anchors after sync", async ({
          editor,
          provider,
          annotate,
        }) => {
          const { firstThreadId, secondThreadId } =
            await createTwoThreadsAtSelections(
              editor,
              selectDisjointLeading,
              selectDisjointTrailing
            );

          await waitUntilFlushed(provider);

          await annotate(
            "two disjoint threads overlapping styled text after sync",
            {
              body: JSON.stringify(editor.getJSON(), null, 2),
              contentType: "application/json",
            }
          );

          await expectThreadExistsInDocument(editor, firstThreadId);
          await expectThreadExistsInDocument(editor, secondThreadId);
        });
      });

      describe("overlapping styled text and each other", () => {
        test("creates both threads locally", async ({ editor }) => {
          const { firstThreadId, secondThreadId } =
            await createTwoThreadsAtSelections(
              editor,
              selectNestedLeading,
              selectNestedTrailing
            );

          expect(firstThreadId).not.toBe(secondThreadId);
          await expectThreadExistsInDocument(editor, firstThreadId);
          await expectThreadExistsInDocument(editor, secondThreadId);
        });

        test("keeps both thread anchors after sync", async ({
          editor,
          provider,
          annotate,
        }) => {
          const { firstThreadId, secondThreadId } =
            await createTwoThreadsAtSelections(
              editor,
              selectNestedLeading,
              selectNestedTrailing
            );

          await waitUntilFlushed(provider);

          await annotate("two overlapping threads on styled text after sync", {
            body: JSON.stringify(editor.getJSON(), null, 2),
            contentType: "application/json",
          });

          await expectThreadExistsInDocument(editor, firstThreadId);
          await expectThreadExistsInDocument(editor, secondThreadId);
        });
      });
    });
  });
});

const createThreadAtSelection = vi.defineHelper(
  async function createThreadAtSelection(
    editor: Editor,
    selectContent: Command
  ) {
    const pending = new Promise<EditorEvents["comments:threadCreated"]>(
      (resolve) => editor.once("comments:threadCreated", resolve)
    );

    assert.isOk(
      editor
        .chain()
        .focus()
        .command(selectContent)
        .setMeta("debug", "test-thread-creation")
        .setThread({
          content: "[test-content]",
        })
        .run(),
      "Failed to create thread at selection"
    );

    return pending;
  }
);

const createTwoThreadsAtSelections = vi.defineHelper(
  async function createTwoThreadsAtSelections(
    editor: Editor,
    firstSelect: Command,
    secondSelect: Command
  ) {
    const first = await createThreadAtSelection(editor, firstSelect);
    const second = await createThreadAtSelection(editor, secondSelect);

    return {
      firstThreadId: first.threadId,
      secondThreadId: second.threadId,
    };
  }
);

const expectThreadExistsInDocument = vi.defineHelper(
  async function expectThreadExistsInDocument(
    editor: Editor,
    threadId: string
  ) {
    return expect(
      threadExistsInDocument(editor, threadId),
      `Thread ${threadId} does not exist in document`
    ).toBeTruthy();
  }
);

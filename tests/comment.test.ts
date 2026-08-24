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
import { assert, vi } from "vitest";
import { describe, expect, test } from "~/fixtures";
import {
  CanonicalizeTextStyleAttrs,
  CompactTextStyleYAttrs,
  ReproFacet,
  ReproGlint,
  SparseTextStyleDefaults,
  StripNullTextStyleAttrs,
} from "~/fixtures/editor";
import {
  reproFacetValuesEqual,
  textStyleValuesEqual,
  yDocFromEditor,
  yTextSegments,
} from "~/fixtures/editor/yMarkSnapshots";
import recordTransactions from "./utils/recordTransactions";

interface CommentContentCase {
  label: string;
  selectContent: Command;
  seedContent: JSONContent;
  getExtensions?: (deps: ExtensionDeps) => Extensions | Promise<Extensions>;
  /** When false, sync is expected to drop the document anchor (failing test). */
  expectAnchorAfterSync?: boolean;
  /** Overlap cases where REST thread metadata survives but anchor is lost. */
  expectServerThreadMetadata?: boolean;
  recordSyncTransactions?: boolean;
}

const starterKit = StarterKit.configure({
  undoRedo: false,
  trailingNode: false,
});

type ExtensionDeps = { syncedProvider: TiptapCollabProvider };

function withCommentsKit(
  syncedProvider: TiptapCollabProvider,
  extensions: Extensions
): Extensions {
  return [
    ...extensions,
    Collaboration.configure({
      provider: syncedProvider,
      document: syncedProvider.document,
    }),
    CommentsKit.configure({
      provider: syncedProvider,
      deleteUnreferencedThreads: false,
      useLegacyWrapping: false,
    }),
  ];
}

const fullKitSparseExtensions = ({ syncedProvider }: ExtensionDeps) =>
  withCommentsKit(syncedProvider, [
    starterKit,
    TextStyle,
    FontFamily,
    FontSize,
    Color,
    BackgroundColor,
    SparseTextStyleDefaults,
    CanonicalizeTextStyleAttrs,
  ]);

const fontFamilyOnlyExtensions = ({ syncedProvider }: ExtensionDeps) =>
  withCommentsKit(syncedProvider, [starterKit, TextStyle, FontFamily]);

const textStyleOnlyExtensions = ({ syncedProvider }: ExtensionDeps) =>
  withCommentsKit(syncedProvider, [starterKit, TextStyle]);

const starterKitOnlyExtensions = ({ syncedProvider }: ExtensionDeps) =>
  withCommentsKit(syncedProvider, [starterKit]);

const reproGlintExtensions = ({ syncedProvider }: ExtensionDeps) =>
  withCommentsKit(syncedProvider, [starterKit, ReproGlint]);

const reproFacetExtensions = ({ syncedProvider }: ExtensionDeps) =>
  withCommentsKit(syncedProvider, [starterKit, ReproFacet]);

const stripNullPmAttrsExtensions = ({ syncedProvider }: ExtensionDeps) =>
  withCommentsKit(syncedProvider, [
    starterKit,
    TextStyle,
    FontFamily,
    FontSize,
    Color,
    BackgroundColor,
    SparseTextStyleDefaults,
    CanonicalizeTextStyleAttrs,
    StripNullTextStyleAttrs,
  ]);

const compactYAttrsExtensions = ({ syncedProvider }: ExtensionDeps) =>
  withCommentsKit(syncedProvider, [
    starterKit,
    TextStyle,
    FontFamily,
    FontSize,
    Color,
    BackgroundColor,
    CompactTextStyleYAttrs,
  ]);

const canonicalizeAttrsExtensions = ({ syncedProvider }: ExtensionDeps) =>
  withCommentsKit(syncedProvider, [
    starterKit,
    TextStyle,
    FontFamily,
    FontSize,
    Color,
    BackgroundColor,
    SparseTextStyleDefaults,
    CanonicalizeTextStyleAttrs,
  ]);

const styledInlineSeedContent: JSONContent = {
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

/**
 * Paragraph with unstyled runs around a single textStyle mark — no bold.
 * Production lost comment-only anchors on this shape (font-size, highlight).
 */
function textStyleOnlySeed(attrs: Record<string, string>): JSONContent {
  return {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [
          { type: "text", text: "Before " },
          {
            type: "text",
            text: "styled",
            marks: [{ type: "textStyle", attrs }],
          },
          { type: "text", text: " after" },
        ],
      },
    ],
  };
}

const boldOnlySeed: JSONContent = {
  type: "doc",
  content: [
    {
      type: "paragraph",
      content: [
        { type: "text", text: "Before " },
        { type: "text", text: "bold", marks: [{ type: "bold" }] },
        { type: "text", text: " after" },
      ],
    },
  ],
};

function reproGlintOnlySeed(tint: string): JSONContent {
  return {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [
          { type: "text", text: "Before " },
          {
            type: "text",
            text: "marked",
            marks: [{ type: "reproGlint", attrs: { tint } }],
          },
          { type: "text", text: " after" },
        ],
      },
    ],
  };
}

const selectReproGlintOnly: Command = ({ editor, commands }) => {
  const nodePos = findNodeOrFail(
    editor.$doc,
    (node) =>
      node.type.name === "text" &&
      node.marks.some((mark) => mark.type.name === "reproGlint")
  );

  return commands.setTextSelection(getTextRange(nodePos));
};

function reproFacetOnlySeed(attrs: Record<string, string>): JSONContent {
  return {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [
          { type: "text", text: "Before " },
          {
            type: "text",
            text: "styled",
            marks: [{ type: "reproFacet", attrs }],
          },
          { type: "text", text: " after" },
        ],
      },
    ],
  };
}

const selectReproFacetOnly: Command = ({ editor, commands }) => {
  const nodePos = findNodeOrFail(
    editor.$doc,
    (node) =>
      node.type.name === "text" &&
      node.marks.some((mark) => mark.type.name === "reproFacet")
  );

  return commands.setTextSelection(getTextRange(nodePos));
};

/**
 * Select from inside the leading unstyled run through the middle run into
 * the trailing run — overlap across a mark boundary.
 */
const selectMiddleRunOverlap: Command = ({ editor, commands }) => {
  const before = findNodeOrFail(
    editor.$doc,
    (node) => node.type.name === "text" && node.text === "Before "
  );
  const after = findNodeOrFail(
    editor.$doc,
    (node) => node.type.name === "text" && node.text === " after"
  );
  const from = getTextRange(before);
  const to = getTextRange(after);

  return commands.setTextSelection({
    from: from.from + 1,
    to: to.to - 1,
  });
};

const selectTextStyleOverlap = selectMiddleRunOverlap;

/**
 * Select from inside the leading unstyled run through part of the styled run
 * (one mark boundary — does not span the trailing unstyled run).
 */
const selectLeadingPartialStyledOverlap: Command = ({ editor, commands }) => {
  const before = findNodeOrFail(
    editor.$doc,
    (node) => node.type.name === "text" && node.text === "Before "
  );
  const styled = findNodeOrFail(
    editor.$doc,
    (node) =>
      node.type.name === "text" &&
      node.marks.some((mark) => mark.type.name === "textStyle")
  );
  const beforeRange = getTextRange(before);
  const styledRange = getTextRange(styled);
  const styledLength = styled.node.text?.length ?? 0;
  const partialEnd = styledRange.from + Math.ceil(styledLength / 2);

  return commands.setTextSelection({
    from: beforeRange.from + 1,
    to: partialEnd,
  });
};

/**
 * Select from part of the styled run through inside the trailing unstyled run.
 */
const selectTrailingPartialStyledOverlap: Command = ({ editor, commands }) => {
  const styled = findNodeOrFail(
    editor.$doc,
    (node) =>
      node.type.name === "text" &&
      node.marks.some((mark) => mark.type.name === "textStyle")
  );
  const after = findNodeOrFail(
    editor.$doc,
    (node) => node.type.name === "text" && node.text === " after"
  );
  const styledRange = getTextRange(styled);
  const afterRange = getTextRange(after);
  const styledLength = styled.node.text?.length ?? 0;
  const partialStart = styledRange.from + Math.floor(styledLength / 2);

  return commands.setTextSelection({
    from: partialStart,
    to: afterRange.to - 1,
  });
};

const selectStyledInline: Command = ({ editor, commands }) => {
  const nodePos = findNodeOrFail(
    editor.$doc,
    (node) =>
      node.type.name === "text" &&
      node.marks.some((mark) => mark.type.name === "bold") &&
      node.marks.some((mark) => mark.type.name === "textStyle")
  );

  return commands.setTextSelection(getTextRange(nodePos));
};

/** Select the textStyle run only (no adjacent unstyled characters). */
const selectTextStyleOnly: Command = ({ editor, commands }) => {
  const nodePos = findNodeOrFail(
    editor.$doc,
    (node) =>
      node.type.name === "text" &&
      node.marks.some((mark) => mark.type.name === "textStyle")
  );

  return commands.setTextSelection(getTextRange(nodePos));
};

/** Select a character slice within the textStyle-marked run (offsets from run start). */
function selectStyledTextStyleSlice(
  startOffset: number,
  endOffset: number
): Command {
  return ({ editor, commands }) => {
    const styled = findNodeOrFail(
      editor.$doc,
      (node) =>
        node.type.name === "text" &&
        node.marks.some((mark) => mark.type.name === "textStyle")
    );
    const styledRange = getTextRange(styled);

    return commands.setTextSelection({
      from: styledRange.from + startOffset,
      to: styledRange.from + endOffset,
    });
  };
}

/** First four characters of the styled run ("styl" on the default seed). */
const selectStyledRunLeading = selectStyledTextStyleSlice(0, 4);

/** Last four characters of the styled run ("yled"); overlaps "ty" with leading slice. */
const selectStyledRunTrailing = selectStyledTextStyleSlice(2, 6);

describe("setThread", () => {
  describe("comment-only user", () => {
    describe.for<CommentContentCase>([
      {
        label: "block selection",
        selectContent({ editor, commands }) {
          const node = findNodeOrFail(
            editor.$doc,
            (node) => node.type.name === "paragraph"
          );
          return commands.setNodeSelection(node.pos);
        },
        seedContent: {
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: "Hello, world!" }],
            },
          ],
        },
        recordSyncTransactions: true,
      },
      {
        label: "basic inline selection",
        selectContent({ editor, commands }) {
          const range = getTextRange(
            findNodeOrFail(editor.$doc, (node) => node.type.name === "text")
          );
          return commands.setTextSelection({
            from: range.from + 1,
            to: range.to - 1,
          });
        },
        seedContent: {
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: "Hello, world!" }],
            },
          ],
        },
        recordSyncTransactions: true,
      },
      {
        label: "selection of bolded text",
        selectContent({ editor, commands }) {
          const nodePos = findNodeOrFail(
            editor.$doc,
            (node) =>
              node.type.name === "text" &&
              node.marks.some((mark) => mark.type.name === "bold")
          );

          return commands.setTextSelection(getTextRange(nodePos));
        },
        seedContent: {
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [
                { type: "text", text: "Before " },
                {
                  type: "text",
                  text: "bold",
                  marks: [{ type: "bold" }],
                },
                { type: "text", text: " after" },
              ],
            },
          ],
        },
        recordSyncTransactions: true,
      },
      {
        label: "exact selection of styled text [bold + fontFamily]",
        selectContent: selectStyledInline,
        seedContent: styledInlineSeedContent,
      },
      {
        label: "exact selection of styled text [fontFamily only]",
        selectContent: selectTextStyleOnly,
        seedContent: textStyleOnlySeed({ fontFamily: "Arial" }),
      },
      {
        label: "exact selection of styled text [color only]",
        selectContent: selectTextStyleOnly,
        seedContent: textStyleOnlySeed({ color: "#6E1F1F" }),
      },
      {
        label: "exact selection of styled text [fontSize only]",
        selectContent: selectTextStyleOnly,
        seedContent: textStyleOnlySeed({ fontSize: "36px" }),
      },
      {
        label: "exact selection of styled text [backgroundColor only]",
        selectContent: selectTextStyleOnly,
        seedContent: textStyleOnlySeed({ backgroundColor: "#E73E3E" }),
      },
      {
        label: "overlap selection of styled text [backgroundColor only]",
        selectContent: selectTextStyleOverlap,
        seedContent: textStyleOnlySeed({ backgroundColor: "#E73E3E" }),
        expectServerThreadMetadata: true,
      },
      {
        label:
          "partial overlap selection of styled text [backgroundColor only, leading edge]",
        selectContent: selectLeadingPartialStyledOverlap,
        seedContent: textStyleOnlySeed({ backgroundColor: "#E73E3E" }),
        expectServerThreadMetadata: true,
      },
      {
        label:
          "partial overlap selection of styled text [backgroundColor only, trailing edge]",
        selectContent: selectTrailingPartialStyledOverlap,
        seedContent: textStyleOnlySeed({ backgroundColor: "#E73E3E" }),
        expectServerThreadMetadata: true,
      },
      {
        label:
          "partial overlap selection of styled text [backgroundColor only, leading edge, canonicalize attrs]",
        selectContent: selectLeadingPartialStyledOverlap,
        seedContent: textStyleOnlySeed({ backgroundColor: "#E73E3E" }),
        getExtensions: canonicalizeAttrsExtensions,
        expectServerThreadMetadata: true,
      },
      {
        label:
          "partial overlap selection of styled text [backgroundColor only, trailing edge, canonicalize attrs]",
        selectContent: selectTrailingPartialStyledOverlap,
        seedContent: textStyleOnlySeed({ backgroundColor: "#E73E3E" }),
        getExtensions: canonicalizeAttrsExtensions,
        expectServerThreadMetadata: true,
      },
      {
        label:
          "overlap selection of styled text [backgroundColor only, canonicalize attrs]",
        selectContent: selectTextStyleOverlap,
        seedContent: textStyleOnlySeed({ backgroundColor: "#E73E3E" }),
        getExtensions: canonicalizeAttrsExtensions,
        expectServerThreadMetadata: true,
      },
      {
        label:
          "overlap selection of styled text [fontFamily only, FontFamily extension only]",
        selectContent: selectTextStyleOverlap,
        seedContent: textStyleOnlySeed({ fontFamily: "Arial" }),
        getExtensions: fontFamilyOnlyExtensions,
      },
      {
        label:
          "overlap selection of styled text [fontFamily only, canonicalize attrs]",
        selectContent: selectTextStyleOverlap,
        seedContent: textStyleOnlySeed({ fontFamily: "Arial" }),
        getExtensions: canonicalizeAttrsExtensions,
      },
      {
        label: "overlap selection of styled text [bold + fontFamily]",
        selectContent: selectMiddleRunOverlap,
        seedContent: styledInlineSeedContent,
        expectServerThreadMetadata: true,
      },
      {
        label:
          "overlap selection of styled text [bold + fontFamily, canonicalize attrs]",
        selectContent: selectMiddleRunOverlap,
        seedContent: styledInlineSeedContent,
        getExtensions: canonicalizeAttrsExtensions,
        expectServerThreadMetadata: true,
      },
      {
        label: "exact selection of reproGlint marked text",
        selectContent: selectReproGlintOnly,
        seedContent: reproGlintOnlySeed("#7A3E9C"),
        getExtensions: reproGlintExtensions,
      },
      {
        label: "overlap selection of reproGlint marked text",
        selectContent: selectMiddleRunOverlap,
        seedContent: reproGlintOnlySeed("#7A3E9C"),
        getExtensions: reproGlintExtensions,
      },
      {
        label: "exact selection of reproFacet marked text [fontFamily only]",
        selectContent: selectReproFacetOnly,
        seedContent: reproFacetOnlySeed({ fontFamily: "Arial" }),
        getExtensions: reproFacetExtensions,
      },
      {
        label: "overlap selection of reproFacet marked text [fontFamily only]",
        selectContent: selectMiddleRunOverlap,
        seedContent: reproFacetOnlySeed({ fontFamily: "Arial" }),
        getExtensions: reproFacetExtensions,
      },
      {
        label:
          "exact selection of reproFacet marked text [backgroundColor only]",
        selectContent: selectReproFacetOnly,
        seedContent: reproFacetOnlySeed({ backgroundColor: "#E73E3E" }),
        getExtensions: reproFacetExtensions,
      },
      {
        label:
          "overlap selection of reproFacet marked text [backgroundColor only]",
        selectContent: selectMiddleRunOverlap,
        seedContent: reproFacetOnlySeed({ backgroundColor: "#E73E3E" }),
        getExtensions: reproFacetExtensions,
      },
      {
        label: "overlap selection of bolded text",
        selectContent: selectMiddleRunOverlap,
        seedContent: boldOnlySeed,
        getExtensions: starterKitOnlyExtensions,
      },
      {
        label:
          "exact selection of styled text [bold + fontFamily, sparse PM defaults]",
        selectContent: selectStyledInline,
        seedContent: styledInlineSeedContent,
        getExtensions: fullKitSparseExtensions,
      },
      {
        label:
          "exact selection of styled text [bold + fontFamily, strip null PM attrs]",
        selectContent: selectStyledInline,
        seedContent: styledInlineSeedContent,
        getExtensions: stripNullPmAttrsExtensions,
      },
      {
        label:
          "exact selection of styled text [bold + fontFamily, sparse Y attrs only]",
        selectContent: selectStyledInline,
        seedContent: styledInlineSeedContent,
        getExtensions: compactYAttrsExtensions,
      },
      {
        label:
          "exact selection of styled text [bold + fontFamily, FontFamily extension only]",
        selectContent: selectStyledInline,
        seedContent: styledInlineSeedContent,
        getExtensions: fontFamilyOnlyExtensions,
      },
      {
        label:
          "exact selection of styled text [bold + fontFamily, without FontFamily extension]",
        selectContent: selectStyledInline,
        seedContent: styledInlineSeedContent,
        getExtensions: textStyleOnlyExtensions,
      },
    ])(
      "with $label",
      ({
        label,
        selectContent,
        seedContent,
        getExtensions,
        expectAnchorAfterSync = true,
        expectServerThreadMetadata = false,
        recordSyncTransactions = false,
      }) => {
        test.override("seedContent", seedContent);
        if (getExtensions) {
          test.override("extensions", getExtensions);
        }

        test("creates the thread locally", async ({ editor }) => {
          const { threadId } = await createThreadAtSelection(
            editor,
            selectContent
          );
          await expectThreadExistsInDocument(editor, threadId);
        });

        if (expectServerThreadMetadata) {
          test("server stores thread metadata after sync", async ({
            editor,
            provider,
            client,
            documentName,
          }) => {
            const { threadId } = await createThreadAtSelection(
              editor,
              selectContent
            );

            await flushChanges(provider);

            const serverThread = await client.getThread(documentName, threadId);
            expect(serverThread.id).toBe(threadId);
            expect(serverThread.comments[0]?.content).toBe("[test-content]");
          });
        }

        test("keeps thread anchor after sync", async ({
          editor,
          provider,
          annotate,
          onTestFailed,
          onTestFinished,
        }) => {
          const recorder = recordSyncTransactions
            ? recordTransactions(
                editor,
                (transaction) =>
                  transaction.getMeta("debug") === "test-thread-creation"
              )
            : null;

          if (recorder) {
            onTestFailed(() => {
              console.log(
                "transaction steps:",
                JSON.stringify(recorder.getTransactionSteps(), null, 2)
              );
            });

            onTestFinished(() => {
              recorder.unsubscribe();
            });
          }

          const { threadId } = await createThreadAtSelection(
            editor,
            selectContent
          );

          expect(
            threadExistsInDocument(editor, threadId),
            "Thread should exist locally before sync"
          ).toBeTruthy();

          const before = recordSyncTransactions ? editor.getJSON() : null;
          await flushChanges(provider);
          const after = editor.getJSON();

          await annotate(`content after sync: ${label}`, {
            body: JSON.stringify(after, null, 2),
            contentType: "application/json",
          });

          if (before) {
            expect
              .soft(before, "Editor JSON changed during sync")
              .toEqual(after);
          }

          if (expectAnchorAfterSync) {
            await expectThreadExistsInDocument(editor, threadId);
            return;
          }

          expect(
            threadExistsInDocument(editor, threadId),
            "Expected document anchor to be lost after sync"
          ).toBe(false);
        });
      }
    );

    describe("two overlapping threads on styled text", () => {
      const seedContent = textStyleOnlySeed({ backgroundColor: "#E73E3E" });

      test.override("seedContent", seedContent);

      test("creates both threads locally", async ({ editor }) => {
        const { firstThreadId, secondThreadId } =
          await createTwoThreadsAtSelections(
            editor,
            selectStyledRunLeading,
            selectStyledRunTrailing
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
            selectStyledRunLeading,
            selectStyledRunTrailing
          );

        expect(
          threadExistsInDocument(editor, firstThreadId),
          "First thread should exist locally before sync"
        ).toBeTruthy();
        expect(
          threadExistsInDocument(editor, secondThreadId),
          "Second thread should exist locally before sync"
        ).toBeTruthy();

        await flushChanges(provider);

        await annotate(
          "content after sync: two overlapping threads on styled text [backgroundColor only]",
          {
            body: JSON.stringify(editor.getJSON(), null, 2),
            contentType: "application/json",
          }
        );

        await expectThreadExistsInDocument(editor, firstThreadId);
        await expectThreadExistsInDocument(editor, secondThreadId);
      });
    });

    /**
     * Y equality experiment: compare styling attrs in Y before vs after local
     * setThread (pre-sync). Separates spurious writeback from server allowlist.
     */
    describe("Y mark equality before sync", () => {
      describe("reproFacet", () => {
        const seed = reproFacetOnlySeed({ fontFamily: "Arial" });

        test.override("seedContent", seed);
        test.override("extensions", reproFacetExtensions);

        test("exact: reproFacet Y values unchanged locally, anchor kept on sync", async ({
          editor,
          provider,
        }) => {
          const ydoc = yDocFromEditor(editor);
          const before = yTextSegments(ydoc);

          const { threadId } = await createThreadAtSelection(
            editor,
            selectReproFacetOnly
          );
          const afterLocal = yTextSegments(ydoc);

          expect(reproFacetValuesEqual(before, afterLocal)).toBe(true);

          await flushChanges(provider);
          await expectThreadExistsInDocument(editor, threadId);
        });

        test("overlap: reproFacet values may change locally; anchor lost on sync", async ({
          editor,
          provider,
        }) => {
          const ydoc = yDocFromEditor(editor);
          const before = yTextSegments(ydoc);

          const { threadId } = await createThreadAtSelection(
            editor,
            selectMiddleRunOverlap
          );
          const afterLocal = yTextSegments(ydoc);

          expect(threadExistsInDocument(editor, threadId)).toBeTruthy();

          await flushChanges(provider);

          expect(threadExistsInDocument(editor, threadId)).toBe(false);
        });
      });

      describe("textStyle + sparse defaults", () => {
        const seed = textStyleOnlySeed({ fontFamily: "Arial" });

        test.override("seedContent", seed);
        test.override("extensions", fullKitSparseExtensions);

        test("exact: textStyle Y values unchanged locally, anchor kept on sync", async ({
          editor,
          provider,
        }) => {
          const ydoc = yDocFromEditor(editor);
          const before = yTextSegments(ydoc);

          const { threadId } = await createThreadAtSelection(
            editor,
            selectTextStyleOnly
          );
          const afterLocal = yTextSegments(ydoc);

          expect(textStyleValuesEqual(before, afterLocal)).toBe(true);

          await flushChanges(provider);
          await expectThreadExistsInDocument(editor, threadId);
        });

        test("overlap: textStyle values unchanged in Y, anchor kept on sync", async ({
          editor,
          provider,
        }) => {
          const ydoc = yDocFromEditor(editor);
          const before = yTextSegments(ydoc);

          const { threadId } = await createThreadAtSelection(
            editor,
            selectMiddleRunOverlap
          );
          const afterLocal = yTextSegments(ydoc);

          expect(textStyleValuesEqual(before, afterLocal)).toBe(true);
          expect(threadExistsInDocument(editor, threadId)).toBeTruthy();

          await flushChanges(provider);
          await expectThreadExistsInDocument(editor, threadId);
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

const flushChanges = vi.defineHelper(async function flushChanges(
  provider: TiptapCollabProvider
) {
  provider.startSync();

  provider.on("synced", () => {
    console.log("synced");
  });

  await vi.waitUntil(() => !provider.hasUnsyncedChanges, {
    timeout: 10_000,
  });
});

function findNode(
  root: NodePos,
  predicate: (node: NodePos["node"], nodePos: NodePos) => boolean
): NodePos | null {
  for (const nodePos of walkNodes(root)) {
    if (predicate(nodePos.node, nodePos)) {
      return nodePos;
    }
  }

  return null;
}

function findNodeOrFail(
  root: NodePos,
  predicate: (node: NodePos["node"], nodePos: NodePos) => boolean
): NodePos {
  const node = findNode(root, predicate);
  if (!node) {
    throw new Error("Node not found");
  }
  return node;
}

function* walkNodes(root: NodePos): Generator<NodePos> {
  if (!root.children || root.children.length === 0) {
    return;
  }

  for (const child of root.children) {
    yield child;
    yield* walkNodes(child);
  }
}

function getTextRange(nodePos: NodePos): Range {
  return {
    from: nodePos.pos - 1,
    to: nodePos.pos + nodePos.size - 1,
  };
}

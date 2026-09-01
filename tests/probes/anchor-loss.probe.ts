import type { Extensions, JSONContent } from "@tiptap/core";
import { describe, expect, test } from "~/fixtures";
import {
  canonicalizeAttrsExtensions,
  compactYAttrsExtensions,
  fontFamilyOnlyExtensions,
  fullKitSparseExtensions,
  reproFacetExtensions,
  reproGlintExtensions,
  starterKitOnlyExtensions,
  stripNullPmAttrsExtensions,
  textStyleOnlyExtensions,
  type ExtensionDeps,
} from "~/fixtures/editor/extensionSets";
import { queryOrFail } from "~/lib/query";
import { TextSelection, asTextSelection, nodeRange } from "~/lib/selection";
import { waitUntilFlushed } from "../utils/flushChanges";
import {
  createThreadAtSelection,
  expectThreadExistsInDocument,
  type SelectionFactory,
} from "../utils/thread";

/**
 * Historical anchor-loss probes.
 *
 * These cases were written while hunting the comment-only sync bug described in
 * the README. They are retained as the executable record of *why* the writeback
 * extensions (`SparseTextStyleDefaults`, `CollabWriteback`,
 * `CompactTextStyleYAttrs`) exist and what happens without them, plus the
 * `ReproGlint`/`ReproFacet` marks that isolated server-side allowlisting from
 * client-side attribute rewriting.
 *
 * They are deliberately kept out of the default `pnpm test` run so the curated
 * matrix in `tests/comment.test.ts` stays legible. Run them with
 * `pnpm test:probes`.
 */

interface ProbeCase {
  label: string;
  select: SelectionFactory;
  seedContent: JSONContent;
  getExtensions?: (deps: ExtensionDeps) => Extensions | Promise<Extensions>;
  /** Overlap cases where REST thread metadata survives even if the anchor does not. */
  expectServerThreadMetadata?: boolean;
}

function markedRunSeed(
  runText: string,
  marks: JSONContent["marks"]
): JSONContent {
  return {
    type: "paragraph",
    content: [
      { type: "text", text: "Before " },
      { type: "text", text: runText, marks },
      { type: "text", text: " after" },
    ],
  };
}

const styledInlineSeedContent = markedRunSeed("bold styled", [
  { type: "bold" },
  { type: "textStyle", attrs: { fontFamily: "Arial" } },
]);

const textStyleOnlySeed = (attrs: Record<string, string>) =>
  markedRunSeed("styled", [{ type: "textStyle", attrs }]);

const boldOnlySeed = markedRunSeed("bold", [{ type: "bold" }]);

const reproGlintOnlySeed = (tint: string) =>
  markedRunSeed("marked", [{ type: "reproGlint", attrs: { tint } }]);

const reproFacetOnlySeed = (attrs: Record<string, string>) =>
  markedRunSeed("styled", [{ type: "reproFacet", attrs }]);

function markedRun(markName: string) {
  return (editor: Parameters<SelectionFactory>[0]) =>
    queryOrFail(
      editor.$doc,
      (node) =>
        node.isText && node.marks.some((mark) => mark.type.name === markName),
      `No run carrying a ${markName} mark`
    );
}

const plainRun = (editor: Parameters<SelectionFactory>[0], value: string) =>
  queryOrFail(editor.$doc, { nodeType: "text", text: value });

/** Selects exactly the run carrying `markName`, with no adjacent characters. */
function selectMarkedRun(markName: string): SelectionFactory {
  return (editor) =>
    asTextSelection(editor.state.doc, markedRun(markName)(editor));
}

/**
 * From inside the leading unstyled run, through the marked run, into the
 * trailing run — a superset of the marked run crossing both boundaries.
 */
const selectMiddleRunOverlap: SelectionFactory = (editor) =>
  TextSelection.create(
    editor.state.doc,
    nodeRange(plainRun(editor, "Before ")).from + 1,
    nodeRange(plainRun(editor, " after")).to - 1
  );

/** One boundary: from inside the leading run through half the styled run. */
const selectLeadingPartialStyledOverlap: SelectionFactory = (editor) => {
  const styled = markedRun("textStyle")(editor);
  const length = styled.node.text?.length ?? 0;

  return TextSelection.create(
    editor.state.doc,
    nodeRange(plainRun(editor, "Before ")).from + 1,
    nodeRange(styled).from + Math.ceil(length / 2)
  );
};

/** One boundary: from half way through the styled run into the trailing run. */
const selectTrailingPartialStyledOverlap: SelectionFactory = (editor) => {
  const styled = markedRun("textStyle")(editor);
  const length = styled.node.text?.length ?? 0;

  return TextSelection.create(
    editor.state.doc,
    nodeRange(styled).from + Math.floor(length / 2),
    nodeRange(plainRun(editor, " after")).to - 1
  );
};

const selectStyledInline = selectMarkedRun("textStyle");
const selectTextStyleOnly = selectMarkedRun("textStyle");
const selectReproGlintOnly = selectMarkedRun("reproGlint");
const selectReproFacetOnly = selectMarkedRun("reproFacet");

const cases: ProbeCase[] = [
  {
    label: "exact/bold+ff/default",
    select: selectStyledInline,
    seedContent: styledInlineSeedContent,
  },
  {
    label: "overlap/bg/default",
    select: selectMiddleRunOverlap,
    seedContent: textStyleOnlySeed({ backgroundColor: "#E73E3E" }),
    expectServerThreadMetadata: true,
  },
  {
    label: "lead/bg/default",
    select: selectLeadingPartialStyledOverlap,
    seedContent: textStyleOnlySeed({ backgroundColor: "#E73E3E" }),
    expectServerThreadMetadata: true,
  },
  {
    label: "trail/bg/default",
    select: selectTrailingPartialStyledOverlap,
    seedContent: textStyleOnlySeed({ backgroundColor: "#E73E3E" }),
    expectServerThreadMetadata: true,
  },
  {
    label: "lead/bg/canonicalize",
    select: selectLeadingPartialStyledOverlap,
    seedContent: textStyleOnlySeed({ backgroundColor: "#E73E3E" }),
    getExtensions: canonicalizeAttrsExtensions,
    expectServerThreadMetadata: true,
  },
  {
    label: "trail/bg/canonicalize",
    select: selectTrailingPartialStyledOverlap,
    seedContent: textStyleOnlySeed({ backgroundColor: "#E73E3E" }),
    getExtensions: canonicalizeAttrsExtensions,
    expectServerThreadMetadata: true,
  },
  {
    label: "overlap/bg/canonicalize",
    select: selectMiddleRunOverlap,
    seedContent: textStyleOnlySeed({ backgroundColor: "#E73E3E" }),
    getExtensions: canonicalizeAttrsExtensions,
    expectServerThreadMetadata: true,
  },
  {
    label: "overlap/ff/ff-only",
    select: selectMiddleRunOverlap,
    seedContent: textStyleOnlySeed({ fontFamily: "Arial" }),
    getExtensions: fontFamilyOnlyExtensions,
  },
  {
    label: "overlap/ff/canonicalize",
    select: selectMiddleRunOverlap,
    seedContent: textStyleOnlySeed({ fontFamily: "Arial" }),
    getExtensions: canonicalizeAttrsExtensions,
  },
  {
    label: "overlap/bold+ff/default",
    select: selectMiddleRunOverlap,
    seedContent: styledInlineSeedContent,
    expectServerThreadMetadata: true,
  },
  {
    label: "overlap/bold+ff/canonicalize",
    select: selectMiddleRunOverlap,
    seedContent: styledInlineSeedContent,
    getExtensions: canonicalizeAttrsExtensions,
    expectServerThreadMetadata: true,
  },
  {
    label: "exact/reproGlint",
    select: selectReproGlintOnly,
    seedContent: reproGlintOnlySeed("#7A3E9C"),
    getExtensions: reproGlintExtensions,
  },
  {
    label: "overlap/reproGlint",
    select: selectMiddleRunOverlap,
    seedContent: reproGlintOnlySeed("#7A3E9C"),
    getExtensions: reproGlintExtensions,
  },
  {
    label: "exact/reproFacet-ff",
    select: selectReproFacetOnly,
    seedContent: reproFacetOnlySeed({ fontFamily: "Arial" }),
    getExtensions: reproFacetExtensions,
  },
  {
    label: "overlap/reproFacet-ff",
    select: selectMiddleRunOverlap,
    seedContent: reproFacetOnlySeed({ fontFamily: "Arial" }),
    getExtensions: reproFacetExtensions,
  },
  {
    label: "exact/reproFacet-bg",
    select: selectReproFacetOnly,
    seedContent: reproFacetOnlySeed({ backgroundColor: "#E73E3E" }),
    getExtensions: reproFacetExtensions,
  },
  {
    label: "overlap/reproFacet-bg",
    select: selectMiddleRunOverlap,
    seedContent: reproFacetOnlySeed({ backgroundColor: "#E73E3E" }),
    getExtensions: reproFacetExtensions,
  },
  {
    label: "overlap/bold/starterkit-only",
    select: selectMiddleRunOverlap,
    seedContent: boldOnlySeed,
    getExtensions: starterKitOnlyExtensions,
  },
  {
    label: "exact/bold+ff/sparse-pm",
    select: selectStyledInline,
    seedContent: styledInlineSeedContent,
    getExtensions: fullKitSparseExtensions,
  },
  {
    label: "exact/bold+ff/strip-null-pm",
    select: selectStyledInline,
    seedContent: styledInlineSeedContent,
    getExtensions: stripNullPmAttrsExtensions,
  },
  {
    label: "exact/bold+ff/sparse-y",
    select: selectStyledInline,
    seedContent: styledInlineSeedContent,
    getExtensions: compactYAttrsExtensions,
  },
  {
    label: "exact/bold+ff/ff-only",
    select: selectStyledInline,
    seedContent: styledInlineSeedContent,
    getExtensions: fontFamilyOnlyExtensions,
  },
  {
    label: "exact/bold+ff/no-ff-ext",
    select: selectStyledInline,
    seedContent: styledInlineSeedContent,
    getExtensions: textStyleOnlyExtensions,
  },
];

describe("setThread", () => {
  describe("performed by comment-only user", () => {
    describe.for<ProbeCase>(cases)(
      "with $label",
      ({
        label,
        select,
        seedContent,
        getExtensions,
        expectServerThreadMetadata = false,
      }) => {
        test.override("seedContent", seedContent);
        if (getExtensions) {
          test.override("extensions", getExtensions);
        }

        test("creates the thread locally", async ({ editor }) => {
          const { threadId } = await createThreadAtSelection(editor, select);
          expectThreadExistsInDocument(editor, threadId);
        });

        if (expectServerThreadMetadata) {
          test("server stores thread metadata after sync", async ({
            editor,
            provider,
            client,
            documentName,
          }) => {
            const { threadId } = await createThreadAtSelection(editor, select);

            await waitUntilFlushed(provider);

            const serverThread = await client.getThread(documentName, threadId);
            expect(serverThread.id).toBe(threadId);
            expect(serverThread.comments[0]?.content).toBe("[test-content]");
          });
        }

        test("keeps thread anchor after sync", async ({
          editor,
          provider,
          annotate,
        }) => {
          const { threadId } = await createThreadAtSelection(editor, select);
          expectThreadExistsInDocument(editor, threadId);

          await waitUntilFlushed(provider);

          await annotate(`content after sync: ${label}`, {
            body: JSON.stringify(editor.getJSON(), null, 2),
            contentType: "application/json",
          });

          expectThreadExistsInDocument(editor, threadId);
        });
      }
    );
  });
});

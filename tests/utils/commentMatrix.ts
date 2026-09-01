import type { Editor, Extensions, JSONContent } from "@tiptap/core";
import { threadExistsInDocument } from "@tiptap-pro/extension-comments";
import { describe, expect, test } from "~/tests/fixtures";
import { embeddedInParagraph, paragraph, text } from "./document";
import type { ExtensionDeps } from "./extensionSets";
import { waitUntilFlushed } from "./flushChanges";
import { offsetCursorPosition } from "./positions";
import { queryOrFail } from "./query";
import { asNodeSelection, nodeRange, TextSelection } from "./selection";
import { createThreads, type SelectionFactory } from "./thread";

/**
 * The comment-only matrix: five seed shapes crossed with four selection
 * scenarios, shared by every suite that wants to run it under a particular
 * editor configuration.
 *
 * `tests/comment.test.ts` runs it on `stockExtensions` — a plain Tiptap setup,
 * where the failures are the bug as an ordinary user meets it.
 * `tests/probes/writeback-fix.probe.ts` runs the identical matrix on
 * `writebackFixExtensions` to show what the workaround extensions recover.
 * Keeping both on one definition means they cannot drift.
 */

const TARGET = "[formatted text]";

type JSONMark = NonNullable<JSONContent["marks"]>[number];

interface SelectionScenario {
  label: string;
  /**
   * Resolved once against the pristine document, before any thread exists.
   * Creating a thread splits the target run with an `inlineThread` mark, so a
   * factory that looked the run up again would not find it for thread two.
   */
  plan: (editor: Editor) => SelectionFactory[];
}

interface CommentCase {
  label: string;
  content: JSONContent;
  scenarios: SelectionScenario[];
}

function textStyle(attrs: Record<string, string>): JSONMark {
  return { type: "textStyle", attrs };
}

const BOLD: JSONMark = { type: "bold" };

const SINGLE_STYLE = textStyle({ backgroundColor: "#E73E3E" });

const MULTIPLE_STYLES = textStyle({
  fontFamily: "Arial",
  fontSize: "36px",
  color: "#6E1F1F",
  backgroundColor: "#E73E3E",
});

/**
 * The document position where `TARGET` starts.
 *
 * The run is located by *containment* rather than exact match because
 * ProseMirror merges adjacent text nodes with identical marks: in the
 * undecorated seed the whole paragraph is a single run.
 */
function targetAnchor(editor: Editor): number {
  const run = queryOrFail(
    editor.$doc,
    (node) => node.isText && !!node.text?.includes(TARGET),
    `No text run containing ${TARGET}`,
  );

  // `?.` here would silently feed undefined into the offset arithmetic rather
  // than failing, so the assertion is the safer of the two.
  // biome-ignore lint/style/noNonNullAssertion: queryOrFail matched on `node.text`.
  return nodeRange(run).from + run.node.text!.indexOf(TARGET);
}

/**
 * Plans selections as **cursor movements** from the start of `TARGET` — the
 * offsets mean what they would if someone put the caret there and pressed
 * shift+arrow that many times. A `hardBreak` or inline atom therefore costs
 * one, and so does a block boundary, which is not what raw position arithmetic
 * or character counting would give. See `lib/positions.ts`.
 *
 * Negative offsets reach back into the preceding `[before] ` run. The anchor
 * stays valid across thread creation because adding a mark does not move text.
 */
function selectTarget(
  ...ranges: Array<[from: number, to: number]>
): SelectionScenario["plan"] {
  return (editor) => {
    const anchor = targetAnchor(editor);

    return ranges.map(([from, to]) => (current) => {
      const $anchor = current.state.doc.resolve(anchor);

      return TextSelection.between(
        offsetCursorPosition($anchor, from),
        offsetCursorPosition($anchor, to),
      );
    });
  };
}

const planBlockSelection: SelectionScenario["plan"] = () => [
  (editor) =>
    asNodeSelection(
      editor.state.doc,
      queryOrFail(editor.$doc, { nodeType: "paragraph" }),
    ),
];

/**
 * Offsets into "[formatted text]", in cursor movements from its start:
 *   0..4  "[for"   2..6  "orma"   6..10 "tted"
 * so 0..4 and 6..10 are disjoint while 0..4 and 2..6 share "or".
 */
const TEXT_SCENARIOS: SelectionScenario[] = [
  {
    label: "an exact selection",
    plan: selectTarget([0, TARGET.length]),
  },
  {
    // Four keypresses back into the 9-character "[before] " run.
    label: "a partially overlapping selection",
    plan: selectTarget([-4, 8]),
  },
  {
    label: "two threads on disjoint parts",
    plan: selectTarget([0, 4], [6, 10]),
  },
  {
    label: "two threads on overlapping parts",
    plan: selectTarget([0, 4], [2, 6]),
  },
];

const cases: CommentCase[] = [
  {
    label: "block-level",
    content: paragraph([text("[block content]")]),
    scenarios: [{ label: "a node selection", plan: planBlockSelection }],
  },
  {
    label: "undecorated text",
    content: embeddedInParagraph(text(TARGET)),
    scenarios: TEXT_SCENARIOS,
  },
  {
    label: "bolded text",
    content: embeddedInParagraph(text(TARGET, [BOLD])),
    scenarios: TEXT_SCENARIOS,
  },
  {
    label: "text with a single style",
    content: embeddedInParagraph(text(TARGET, [SINGLE_STYLE])),
    scenarios: TEXT_SCENARIOS,
  },
  {
    label: "text with multiple styles",
    content: embeddedInParagraph(text(TARGET, [MULTIPLE_STYLES])),
    scenarios: TEXT_SCENARIOS,
  },
];

/**
 * Registers the whole matrix under `label`, with every case built from
 * `getExtensions`.
 */
export function describeCommentMatrix(
  label: string,
  getExtensions: (deps: ExtensionDeps) => Extensions,
) {
  describe("setThread", () => {
    describe(label, () => {
      test.override("extensions", getExtensions);

      describe.for<CommentCase>(cases)(
        "and $label content",
        ({ content, scenarios }) => {
          test.override("seedContent", content);

          describe.for<SelectionScenario>(scenarios)(
            "and $label",
            ({ plan }) => {
              test("creates the thread locally", async ({ editor }) => {
                const selections = plan(editor);
                const threadIds = await createThreads(editor, selections);

                expect(
                  new Set(threadIds).size,
                  "thread ids should be distinct",
                ).toBe(selections.length);

                for (const threadId of threadIds) {
                  expect(
                    threadExistsInDocument(editor, threadId),
                    `Thread ${threadId} was not anchored in the document`,
                  ).toBe(true);
                }
              });

              test("keeps the thread anchor after sync", async ({
                editor,
                provider,
                annotate,
              }) => {
                const threadIds = await createThreads(editor, plan(editor));

                for (const threadId of threadIds) {
                  expect(
                    threadExistsInDocument(editor, threadId),
                    `Thread ${threadId} was not anchored before sync`,
                  ).toBe(true);
                }

                await waitUntilFlushed(provider);

                await annotate("content after sync", {
                  body: JSON.stringify(editor.getJSON(), null, 2),
                  contentType: "application/json",
                });

                for (const threadId of threadIds) {
                  expect(
                    threadExistsInDocument(editor, threadId),
                    `Thread ${threadId} lost its anchor during sync`,
                  ).toBe(true);
                }
              });
            },
          );
        },
      );
    });
  });
}

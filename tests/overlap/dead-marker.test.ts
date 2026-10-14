import { Editor } from "@tiptap/core";
import Collaboration from "@tiptap/extension-collaboration";
import { InlineThread } from "@tiptap-pro/extension-comments";
import { afterEach, describe, expect, test } from "vitest";
import * as Y from "yjs";
import { paragraph, text } from "../utils/document";
import { textSchema } from "../utils/extensionSets";
import {
  applyStyling,
  formatMarkers,
  formatMarkersTouched,
  NOT_OVERLAPPING,
  OVERLAPPING,
  paragraphText,
  rangeOf,
  type Styling,
  TEXT,
} from "../utils/overlappingStyles";

/**
 * The mechanism behind issue 4, with no collab server involved.
 *
 * Yjs stores a style as markers in the text: "from here, `textStyle` is X".
 * When an author applies two styles whose ranges overlap, Yjs leaves a dead
 * marker: one that the next marker, at the same offset, replaces at once.
 * Adding a comment re-writes the paragraph's marks, and Yjs deletes the dead
 * marker on the way. No style changes, but the update deletes and adds
 * `textStyle` markers, which a comment-only connection may not do.
 *
 * The overlapping cases assert the behaviour we expect and currently fail.
 * See docs/comment-anchor-overlapping-styles.md.
 */

const FIELD = "default";

const editors: Editor[] = [];

afterEach(() => {
  while (editors.length) {
    editors.pop()?.destroy();
  }
});

function attach(ydoc: Y.Doc): Editor {
  const editor = new Editor({
    extensions: [
      ...textSchema.nodes,
      Collaboration.configure({ document: ydoc, field: FIELD }),
      InlineThread,
    ],
  });
  editors.push(editor);
  return editor;
}

/** The author's document, as a separate client receives it. */
function styledByAuthor(styling: Styling): Y.Doc {
  const author = new Y.Doc();
  const editor = attach(author);
  editor.commands.setContent(paragraph([text(TEXT)]));
  applyStyling(editor, styling);

  const guest = new Y.Doc();
  Y.applyUpdate(guest, Y.encodeStateAsUpdate(author));
  return guest;
}

describe.for<[string, Styling[]]>([
  ["overlap", OVERLAPPING],
  ["do not overlap", NOT_OVERLAPPING],
])("given styles that %s", ([, stylings]) => {
  describe.for(stylings)("such as $label", (styling) => {
    test("adding a comment writes no textStyle marker", async ({
      annotate,
    }) => {
      const ydoc = styledByAuthor(styling);
      const yText = paragraphText(ydoc.getXmlFragment(FIELD));
      const editor = attach(ydoc);
      await annotate(`markers before\n${formatMarkers(yText).join("\n")}`);

      const touched: string[] = [];
      ydoc.on("afterTransaction", (transaction: Y.Transaction) => {
        touched.push(...formatMarkersTouched(yText, transaction));
      });
      const [from, to] = rangeOf(editor, "ore] [one][two][three] [af");
      editor
        .chain()
        .setTextSelection({ from, to })
        .setMark("inlineThread", { "data-thread-id": "thread-1" })
        .run();
      await annotate(`markers after\n${formatMarkers(yText).join("\n")}`);

      expect(
        touched.filter((marker) => !marker.endsWith("inlineThread")),
        "adding a comment must not write textStyle",
      ).toEqual([]);
    });
  });
});

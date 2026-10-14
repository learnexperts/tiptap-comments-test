import { randomUUID } from "node:crypto";
import { Editor } from "@tiptap/core";
import { threadExistsInDocument } from "@tiptap-pro/extension-comments";
import {
  TiptapCollabProvider,
  TiptapCollabProviderWebsocket,
} from "@tiptap-pro/provider";
import Websocket from "ws";
import { describe, expect, test } from "../fixtures";
import { createToken } from "../utils/createToken";
import { paragraph, text } from "../utils/document";
import { stockExtensions } from "../utils/extensionSets";
import { waitUntilFlushed } from "../utils/flushChanges";
import {
  applyStyling,
  formatMarkers,
  NOT_OVERLAPPING,
  OVERLAPPING,
  paragraphText,
  rangeOf,
  type Styling,
  TEXT,
} from "../utils/overlappingStyles";
import { TextSelection } from "../utils/selection";
import { createThreadAtSelection } from "../utils/thread";
import { waitForSync } from "../utils/waitForSync";

/**
 * Issue 4. An author styles the text through an editor, with two styles whose
 * ranges overlap. A comment-only user then comments on it, and the server
 * undoes the comment: the update deletes a dead `textStyle` marker the
 * author's edits left behind. Styles that do not overlap leave none, and keep
 * the comment.
 *
 * There is no `with the writeback fix` half: the workaround compares mark
 * values, and every value here is unchanged. See
 * docs/comment-anchor-overlapping-styles.md.
 */

interface Thread {
  label: string;
  /** The text the thread covers. */
  part: string;
}

const THREADS: Thread[] = [
  {
    label: "a selection across every style",
    part: "ore] [one][two][three] [af",
  },
  { label: "a selection inside one style", part: "two" },
];

/** Styles the seeded paragraph as a full-rights session, through an editor. */
async function styleAsAuthor(documentName: string, styling: Styling) {
  const provider = new TiptapCollabProvider({
    name: documentName,
    token: createToken({
      sub: `editor:${randomUUID()}`,
      allowedDocumentNames: [documentName],
    }),
    websocketProvider: new TiptapCollabProviderWebsocket({
      baseUrl: "ws://localhost:3030",
      WebSocketPolyfill: Websocket,
    }),
  });
  await waitForSync(provider);
  const editor = new Editor({
    extensions: stockExtensions({ syncedProvider: provider }),
  });

  try {
    applyStyling(editor, styling);
    await waitUntilFlushed(provider);
  } finally {
    editor.destroy();
    provider.destroy();
  }
}

describe("setThread", () => {
  describe("given a comment-only session", () => {
    describe.for<[string, Styling[]]>([
      ["overlap", OVERLAPPING],
      ["do not overlap", NOT_OVERLAPPING],
    ])("and styles that %s", ([, stylings]) => {
      describe.for(stylings)("such as $label", (styling) => {
        test.override(
          "seed",
          async ({ client, documentName }, { onCleanup }) => {
            await client.createDocument(documentName, {
              type: "doc",
              content: [paragraph([text(TEXT)])],
            });
            onCleanup(() => client.deleteDocument(documentName));
            await styleAsAuthor(documentName, styling);
          },
        );

        describe.for(THREADS)("and $label", ({ part }) => {
          test("keeps the thread anchor after sync", async ({
            editor,
            provider,
            annotate,
          }) => {
            await annotate(
              `markers before\n${formatMarkers(
                paragraphText(provider.document.getXmlFragment("default")),
              ).join("\n")}`,
            );

            const { threadId } = await createThreadAtSelection(
              editor,
              (current) =>
                TextSelection.create(
                  current.state.doc,
                  ...rangeOf(current, part),
                ),
            );

            expect(
              threadExistsInDocument(editor, threadId),
              `Thread ${threadId} was not anchored before sync`,
            ).toBe(true);

            await waitUntilFlushed(provider);

            expect(
              threadExistsInDocument(editor, threadId),
              `Thread ${threadId} lost its anchor during sync`,
            ).toBe(true);
          });
        });
      });
    });
  });
});

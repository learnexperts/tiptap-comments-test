import { randomUUID } from "node:crypto";
import { Editor } from "@tiptap/core";
import { threadExistsInDocument } from "@tiptap-pro/extension-comments";
import {
  TiptapCollabProvider,
  TiptapCollabProviderWebsocket,
} from "@tiptap-pro/provider";
import { vi } from "vitest";
import Websocket from "ws";
import { CollabWriteback } from "~/workaround/collabWriteback";
import { describe, expect, test } from "../fixtures";
import { createToken } from "../utils/createToken";
import { paragraph, text } from "../utils/document";
import { blockSchema, stockExtensionsFor } from "../utils/extensionSets";
import { waitUntilFlushed } from "../utils/flushChanges";
import {
  NodeSelection,
  type Selection,
  TextSelection,
} from "../utils/selection";
import { createThreadAtSelection } from "../utils/thread";
import { waitForSync } from "../utils/waitForSync";

/**
 * Issue 5. An author edits the page through an editor; a comment-only user
 * then comments on a paragraph the edit did not touch. With y-tiptap 3.0.10
 * the comment's update also writes a position-migration record to a root the
 * connection may not write, and the server undoes the whole update:
 *
 * - every block comment, whatever the author did;
 * - an inline comment once the author has left a block emptied of its text,
 *   by splitting a paragraph at its start or deleting its text.
 *
 * The same matrix with the workaround added is tagged `writeback`: `pnpm test`
 * leaves it out, `pnpm test:probes` runs only it. The author stays stock in
 * both. See docs/position-migrations.md.
 */

const PARAGRAPHS = ["Alpha beta gamma", "Delta epsilon", "Zeta eta theta"];

function positionOf(editor: Editor, part: string): number {
  let found = -1;
  editor.state.doc.descendants((node, pos) => {
    if (found < 0 && node.isText && node.text?.includes(part)) {
      found = pos + node.text.indexOf(part);
    }
  });
  if (found < 0) throw new Error(`No text "${part}"`);
  return found;
}

interface AuthorEdit {
  label: string;
  edit: (author: Editor) => void;
}

const EDITS: AuthorEdit[] = [
  { label: "nothing", edit: () => {} },
  {
    label: "splits a paragraph mid-text",
    edit: (author) =>
      author
        .chain()
        .setTextSelection(positionOf(author, "gamma"))
        .splitBlock()
        .run(),
  },
  {
    label: "merges two paragraphs",
    edit: (author) =>
      author
        .chain()
        .setTextSelection(positionOf(author, "Delta"))
        .joinBackward()
        .run(),
  },
  {
    label: "splits a paragraph at its start",
    edit: (author) =>
      author
        .chain()
        .setTextSelection(positionOf(author, "Delta"))
        .splitBlock()
        .run(),
  },
  {
    label: "deletes a paragraph's text",
    edit: (author) => {
      const from = positionOf(author, "Delta epsilon");
      author.commands.deleteRange({ from, to: from + "Delta epsilon".length });
    },
  },
];

interface Comment {
  label: string;
  select: (editor: Editor) => Selection;
}

// Both on the last paragraph, which no edit touches.
const COMMENTS: Comment[] = [
  {
    label: "an inline comment",
    select: (editor) => {
      const from = positionOf(editor, "eta");
      return TextSelection.create(editor.state.doc, from, from + "eta".length);
    },
  },
  {
    label: "a block comment",
    select: (editor) =>
      NodeSelection.create(editor.state.doc, positionOf(editor, "Zeta") - 1),
  },
];

/** Runs `edit` as a full-rights session, then waits for `commenter` to have it. */
async function editAsAuthor(
  documentName: string,
  edit: (author: Editor) => void,
  commenter: Editor,
) {
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
  const author = new Editor({
    extensions: stockExtensionsFor(blockSchema)({ syncedProvider: provider }),
  });

  try {
    edit(author);
    await waitUntilFlushed(provider);
    const edited = JSON.stringify(author.getJSON());
    await vi.waitUntil(() => JSON.stringify(commenter.getJSON()) === edited, {
      timeout: 5_000,
    });
  } finally {
    author.destroy();
    provider.destroy();
  }
}

function describeMigrationMatrix() {
  describe("setThread", () => {
    describe("given a comment-only session", () => {
      describe.for(EDITS)("when an author $label", ({ edit }) => {
        describe.for(COMMENTS)("and $label", ({ select }) => {
          test("keeps the thread anchor after sync", async ({
            editor,
            provider,
            documentName,
          }) => {
            await editAsAuthor(documentName, edit, editor);

            const { threadId } = await createThreadAtSelection(editor, select);

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
}

// One document per test, so a failed one leaves nothing for the next to meet.
test.override("documentName", () => `test-migrations-${randomUUID()}`);
test.override("baseExtensions", stockExtensionsFor(blockSchema));
// Stored with every non-null default, so issue 2 plays no part.
test.override("seedContent", {
  type: "doc",
  content: PARAGRAPHS.map((value) =>
    paragraph([text(value)], { marginLeft: 0 }),
  ),
});

describeMigrationMatrix();

describe("with the writeback fix", { tags: ["writeback"] }, () => {
  test.override("extensions", ({ baseExtensions }) => [
    CollabWriteback,
    ...baseExtensions,
  ]);
  describeMigrationMatrix();
});

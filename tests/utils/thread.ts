import type { Editor, EditorEvents } from "@tiptap/core";
import { assert, vi } from "vitest";
import type { Selection } from "./selection";

export type SelectionFactory = (editor: Editor) => Selection;

/**
 * Creates a comment thread over `select(editor)` and resolves once the editor
 * reports it. The selection is applied through `tr.setSelection` so the same
 * helper serves both text and node selections.
 */
export const createThreadAtSelection = vi.defineHelper(
  async function createThreadAtSelection(
    editor: Editor,
    select: SelectionFactory,
  ) {
    const pending = new Promise<EditorEvents["comments:threadCreated"]>(
      (resolve) => editor.once("comments:threadCreated", resolve),
    );

    assert.isOk(
      editor
        .chain()
        .focus()
        .command(({ tr, editor: current }) => {
          tr.setSelection(select(current));
          return true;
        })
        .setMeta("debug", "test-thread-creation")
        .setThread({ content: "[test-content]" })
        .run(),
      "Failed to create thread at selection",
    );

    return pending;
  },
);

/** Creates one thread per selection, in order, returning their ids. */
export const createThreads = vi.defineHelper(async function createThreads(
  editor: Editor,
  selections: SelectionFactory[],
) {
  const threadIds: string[] = [];

  for (const selection of selections) {
    const { threadId } = await createThreadAtSelection(editor, selection);
    threadIds.push(threadId);
  }

  return threadIds;
});

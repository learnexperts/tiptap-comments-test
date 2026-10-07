import { Extension } from "@tiptap/core";
import type * as Y from "yjs";
import { patchYXmlElementWrites } from "./elementWriteback";
import {
  keepMarkSparse,
  keepStoredMarkValues,
  tagValuesReadFromYjs,
} from "./markWriteback";
import { registerFragment } from "./writebackScope";

/**
 * Comment-safe ProseMirror → Yjs writeback. See `workaround/README.md`.
 *
 * Add it to an editor that also has `Collaboration`; it throws without one.
 * It affects only that editor's Collaboration fragment, and only while
 * y-prosemirror writes ProseMirror → Yjs. Other editors in the process, on the
 * same document or not, are left as stock.
 *
 * 1. Marks leave out attributes they were not given whose default is `null`,
 *    so the client writes the value Yjs stores instead of one densified with
 *    `null`s. A mark read from Yjs keeps the stored key order; a new one is
 *    sorted by key.
 * 2. A block y-prosemirror rebuilds (wrapping it in `blockThread`) is written
 *    with the key order and key set of the element it replaces.
 * 3. A schema default is not written onto an element or a mark value that is
 *    stored without it.
 */
export const CollabWriteback = Extension.create({
  name: "collabWriteback",

  /** Run before Collaboration binds Y → PM. */
  priority: 10_000,

  addStorage() {
    return { unregister: null as (() => void) | null };
  },

  onBeforeCreate() {
    patchYXmlElementWrites();
    tagValuesReadFromYjs();
    keepStoredMarkValues();
    this.storage.unregister = registerFragment(
      collaborationFragment(this.editor.extensionManager.extensions),
      this.editor.schema,
    );

    for (const markType of Object.values(this.editor.schema.marks)) {
      keepMarkSparse(markType);
    }
  },

  onDestroy() {
    this.storage.unregister?.();
    this.storage.unregister = null;
  },
});

/** The fragment the editor's `Collaboration` extension binds to. */
function collaborationFragment(
  extensions: ReadonlyArray<{ name: string; options: unknown }>,
): Y.XmlFragment {
  const collaboration = extensions.find(({ name }) => name === "collaboration");
  if (!collaboration) {
    throw new Error(
      "CollabWriteback needs the Collaboration extension on the same editor",
    );
  }
  const { fragment, document, field } = collaboration.options as {
    fragment?: Y.XmlFragment | null;
    document?: Y.Doc | null;
    field?: string;
  };
  const resolved = fragment ?? document?.getXmlFragment(field ?? "default");
  if (!resolved) {
    throw new Error("CollabWriteback could not find Collaboration's fragment");
  }
  return resolved;
}

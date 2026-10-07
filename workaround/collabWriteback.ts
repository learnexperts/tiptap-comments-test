import { type Editor, Extension } from "@tiptap/core";
import type * as Y from "yjs";
import { patchElementWrites } from "./elementWriteback";
import { keepMarkSparse, patchMarkWrites } from "./markWriteback";
import { registerFragment } from "./writebackScope";

/**
 * Comment-safe ProseMirror → Yjs writeback for one editor; needs
 * `Collaboration` on the same editor. See `workaround/README.md`.
 */
export const CollabWriteback = Extension.create({
  name: "collabWriteback",
  priority: 10_000, // before Collaboration binds

  addStorage: () => ({ unregister: null as (() => void) | null }),

  onBeforeCreate() {
    patchElementWrites();
    patchMarkWrites();
    for (const markType of Object.values(this.editor.schema.marks)) {
      keepMarkSparse(markType);
    }
    this.storage.unregister = registerFragment(
      collaborationFragment(this.editor),
      this.editor.schema,
    );
  },

  onDestroy() {
    this.storage.unregister?.();
    this.storage.unregister = null;
  },
});

function collaborationFragment(editor: Editor): Y.XmlFragment {
  const collaboration = editor.extensionManager.extensions.find(
    ({ name }) => name === "collaboration",
  );
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

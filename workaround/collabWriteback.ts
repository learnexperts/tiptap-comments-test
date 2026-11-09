import { type Editor, Extension } from "@tiptap/core";
import type * as Y from "yjs";
import { patchElementWrites } from "./elementWriteback";
import { patchMarkWrites } from "./markWriteback";
import { dropPositionMigrationsWhile } from "./positionMigrations";
import { registerFragment } from "./writebackScope";

export interface CollabWritebackOptions {
  /**
   * Whether this session may only comment, read at every write. While it
   * holds, the editor writes no position-migration record (mechanism 5).
   * Leave it off for a session that may edit: its records keep other
   * clients' cursors and selections on the text it restructures.
   */
  commentOnly: boolean | (() => boolean);
}

/**
 * Comment-safe ProseMirror → Yjs writeback for one editor; needs
 * `Collaboration` on the same editor. See `workaround/README.md`.
 */
export const CollabWriteback = Extension.create<CollabWritebackOptions>({
  name: "collabWriteback",
  priority: 10_000, // before Collaboration binds

  addOptions: () => ({ commentOnly: false }),

  addStorage: () => ({ unregister: null as (() => void) | null }),

  addProseMirrorPlugins() {
    const { commentOnly } = this.options;
    return [
      dropPositionMigrationsWhile(
        typeof commentOnly === "function" ? commentOnly : () => commentOnly,
      ),
    ];
  },

  onBeforeCreate() {
    patchElementWrites();
    patchMarkWrites();
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

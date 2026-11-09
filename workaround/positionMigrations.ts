import { Plugin } from "@tiptap/pm/state";
import { ySyncPluginKey } from "@tiptap/y-tiptap";

/**
 * Mechanism 5: while `isCommentOnly()` holds, this editor writes its changes
 * to Yjs without y-tiptap's position-migration record.
 *
 * y-tiptap 3.0.10 writes that record, to a root map
 * `__tiptap_position_migrations:<fragment>`, in the same update as a local
 * change. A comment-only connection may not write that root, so the server
 * undoes the whole update, the comment's anchor with it. A comment-only
 * session makes no structural edit for a record to describe.
 *
 * Patches this editor's binding when its view is built, not on `create`:
 * Tiptap emits `create` a tick later, after a comment made at once.
 */
export function dropPositionMigrationsWhile(isCommentOnly: () => boolean) {
  return new Plugin({
    view(view) {
      const binding = ySyncPluginKey.getState(view.state)?.binding;
      if (!binding) {
        throw new Error(
          "CollabWriteback needs the Collaboration extension on the same editor",
        );
      }
      const write = binding._prosemirrorChanged.bind(binding);
      binding._prosemirrorChanged = (doc, plan = null) =>
        write(doc, isCommentOnly() ? null : plan);
      return {};
    },
  });
}

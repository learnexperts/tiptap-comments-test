import { Extension } from "@tiptap/core";
import { Mark, type MarkType } from "@tiptap/pm/model";
import type * as Y from "yjs";
import { patchYXmlElementWrites } from "./elementWriteback";
import { registerFragment } from "./writebackScope";

/**
 * Comment-safe ProseMirror → Yjs writeback. See `workaround/README.md`.
 *
 * Add it to an editor that also has `Collaboration`; it throws without one.
 * It affects only that editor's Collaboration fragment, and only while
 * y-prosemirror writes ProseMirror → Yjs. Other editors in the process, on the
 * same document or not, are left as stock.
 *
 * 1. `textStyle` marks keep only the attribute keys they were created with, so
 *    the client writes the sparse value the server stored instead of one
 *    densified with `null`s.
 * 2. A block y-prosemirror rebuilds (wrapping it in `blockThread`) is written
 *    with the key order and key set of the element it replaces.
 * 3. A schema default is not written onto an existing element that lacks it.
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
    this.storage.unregister = registerFragment(
      collaborationFragment(this.editor.extensionManager.extensions),
      this.editor.schema,
    );

    const textStyle = this.editor.schema.marks.textStyle;
    if (textStyle) {
      keepTextStyleSparse(textStyle);
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

const MARK_CREATE_PATCHED = Symbol("collabWritebackMarkCreate");

/**
 * `Mark`'s constructor is `@internal` in prosemirror-model, so it is absent
 * from the published types even though it exists at runtime. Rebuilding the
 * mark directly is the only way to seat sparse attrs — `markType.create` is
 * what densifies them through `computeAttrs` in the first place.
 */
const MarkConstructor = Mark as unknown as new (
  type: MarkType,
  attrs: Record<string, unknown>,
) => Mark;

/**
 * Patch this schema's `textStyle` `MarkType.create` to keep only the attribute
 * keys it was given, in sorted order.
 *
 * `computeAttrs` densifies the full textStyle kit onto every mark
 * (`fontSize: null`, …). y-prosemirror writes `mark.attrs` wholesale, so a
 * densified mark is a different value from the sparse one the server stored,
 * and re-writing it reads as a styling edit. Keys present in the input —
 * including `null`s Yjs already stores — are kept, so what is read back from
 * Yjs is written back unchanged.
 */
function keepTextStyleSparse(markType: MarkType): void {
  const patched = markType as MarkType & { [MARK_CREATE_PATCHED]?: boolean };
  if (patched[MARK_CREATE_PATCHED]) {
    return;
  }

  const create = markType.create.bind(markType);
  markType.create = (attrs = null) => {
    const keys = Object.keys(attrs ?? {});
    const mark = create(attrs);
    return new MarkConstructor(
      markType,
      Object.fromEntries(
        Object.entries(mark.attrs as Record<string, unknown>)
          .filter(([key]) => keys.includes(key))
          .sort(([left], [right]) => left.localeCompare(right)),
      ),
    );
  };

  patched[MARK_CREATE_PATCHED] = true;
}

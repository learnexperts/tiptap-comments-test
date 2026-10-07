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
 * 1. Marks leave out attributes they were not given whose default is `null`,
 *    and keep the order they were given in, so the client writes the value
 *    Yjs stores instead of one densified with `null`s.
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
 * Patch one mark type's `create` so a mark carries only the attributes it was
 * given, plus any it was not given whose default is non-null, in the order
 * given.
 *
 * `computeAttrs` densifies every attribute the schema declares onto every
 * mark: a `textStyle` that set only `backgroundColor` also carries
 * `fontSize: null`, `color: null` and so on, one per extension that adds an
 * attribute. y-prosemirror writes `mark.attrs` wholesale, so that densified
 * mark is a different value from the sparse one Yjs stores, and writing it
 * back reads as an edit nobody made.
 *
 * - **Only `null` defaults are dropped.** A `null` default means the same as
 *   absent. A non-null default is behaviour (a link's `target`), so it stays,
 *   even though a stored mark lacking it will still be rewritten with it.
 * - **Keys given are kept, `null`s included,** so a value read back from Yjs
 *   is written back unchanged.
 * - **The given order is kept.** y-prosemirror keys an overlapping mark (such
 *   as `inlineThread`) by a hash of its JSON, which depends on key order;
 *   reordering would compute a different key from the one stored.
 */
function keepMarkSparse(markType: MarkType): void {
  const patched = markType as MarkType & { [MARK_CREATE_PATCHED]?: boolean };
  if (patched[MARK_CREATE_PATCHED]) {
    return;
  }
  patched[MARK_CREATE_PATCHED] = true;

  const nullByDefault = new Set(
    Object.entries(markType.spec.attrs ?? {})
      .filter(([, spec]) => spec?.default === null)
      .map(([key]) => key),
  );
  if (nullByDefault.size === 0) {
    return;
  }

  const create = markType.create.bind(markType);
  markType.create = (attrs = null) => {
    const given = attrs ?? {};
    const mark = create(attrs);
    const full = mark.attrs as Record<string, unknown>;
    const keys = Object.keys(given).filter((key) => key in full);
    for (const key of Object.keys(full)) {
      if (!(key in given) && !nullByDefault.has(key)) {
        keys.push(key);
      }
    }
    return new MarkConstructor(
      markType,
      Object.fromEntries(keys.map((key) => [key, full[key]])),
    );
  };
}

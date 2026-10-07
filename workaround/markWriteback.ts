import { Mark, type MarkType } from "@tiptap/pm/model";
import * as Y from "yjs";

/**
 * Mark-attribute writes, for the inline-anchor defect
 * (`docs/comment-anchor-lost.md`).
 *
 * `computeAttrs` densifies every attribute the schema declares onto every
 * mark: a `textStyle` that set only `backgroundColor` also carries
 * `fontSize: null`, `color: null` and so on, one per extension that adds an
 * attribute. y-prosemirror writes `mark.attrs` wholesale, so that densified
 * mark is a different value from the sparse one Yjs stores, and writing it
 * back reads as an edit nobody made.
 *
 * Each mark type's `create` is patched so a mark carries only:
 *
 * - **the attributes it was given**, `null`s included, so a value read back
 *   from Yjs is written back unchanged;
 * - **plus any it was not given whose default is non-null.** A `null` default
 *   means the same as absent, but a non-null default is behaviour (a link's
 *   `target`), so it stays.
 *
 * And it orders them:
 *
 * - **A mark read from Yjs keeps the stored order.** y-prosemirror keys an
 *   overlapping mark (such as `inlineThread`) by a hash of its JSON, which
 *   depends on key order; reordering would compute a different key from the
 *   one stored and rewrite it.
 * - **Every other mark is sorted by key**, so new values have one canonical
 *   shape whatever order a schema or a command lists them in.
 *
 * A mark is "read from Yjs" when its attrs object is one `Y.Text.toDelta()`
 * returned: y-prosemirror passes those objects straight to `schema.mark`.
 * Tagging them changes nothing else, so that patch is not scoped.
 */

const CREATE_PATCHED = Symbol("collabWritebackMarkCreate");
const TO_DELTA_PATCHED = Symbol("collabWritebackToDelta");

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

/** Attribute values `Y.Text.toDelta()` has returned, as stored in Yjs. */
const readFromYjs = new WeakSet<object>();

type TextPrototype = typeof Y.Text.prototype & { [TO_DELTA_PATCHED]?: boolean };

/** Tag every attribute value `Y.Text.toDelta()` returns. Once per process. */
export function tagValuesReadFromYjs(): void {
  const text = Y.Text.prototype as TextPrototype;
  if (text[TO_DELTA_PATCHED]) {
    return;
  }
  text[TO_DELTA_PATCHED] = true;

  const toDelta = text.toDelta;
  text.toDelta = function (this: Y.Text, ...args: Parameters<typeof toDelta>) {
    const delta = toDelta.apply(this, args);
    for (const op of delta as Array<{ attributes?: Record<string, unknown> }>) {
      for (const value of Object.values(op.attributes ?? {})) {
        if (typeof value === "object" && value !== null) {
          readFromYjs.add(value);
        }
      }
    }
    return delta;
  };
}

/** Patch `markType.create` as described above. Once per mark type. */
export function keepMarkSparse(markType: MarkType): void {
  const patched = markType as MarkType & { [CREATE_PATCHED]?: boolean };
  if (patched[CREATE_PATCHED]) {
    return;
  }
  patched[CREATE_PATCHED] = true;

  const declared = Object.entries(markType.spec.attrs ?? {});
  if (declared.length === 0) {
    return;
  }
  const nullByDefault = new Set(
    declared.filter(([, spec]) => spec?.default === null).map(([key]) => key),
  );

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
    if (!readFromYjs.has(given)) {
      keys.sort();
    }

    return new MarkConstructor(
      markType,
      Object.fromEntries(keys.map((key) => [key, full[key]])),
    );
  };
}

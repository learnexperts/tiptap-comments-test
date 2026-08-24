import { Extension } from "@tiptap/core";
import { Mark, type MarkType } from "@tiptap/pm/model";

const PATCHED = Symbol("canonicalizeTextStyleAttrs");

/**
 * Keep only the attr keys that were supplied to `MarkType.create`, in sorted
 * order. `computeAttrs` densifies the full textStyle kit onto every mark
 * (`fontSize: undefined`, …); restricting to the input key set restores the
 * FontFamily-only shape y-prosemirror / comment-only sync tolerate:
 * `{ fontFamily: "Arial" }` instead of a four-key bag.
 *
 * y-prosemirror writes `mark.attrs` wholesale and hashes `mark.toJSON()` for
 * overlapping marks — densified keys show up via `encodeAny` even when
 * `JSON.stringify` hides `undefined`.
 *
 * Register after FontFamily / FontSize / Color / BackgroundColor (and after
 * `SparseTextStyleDefaults` if used). Patches `MarkType.create` in
 * `onBeforeCreate` so Collaboration bind and later edits stay sparse.
 *
 * Note: if Y already stores densified null keys, those keys are part of the
 * create input and are preserved — this does not migrate historical Y.
 */
export function canonicalizeTextStyleAttrs(
  attrs: Record<string, unknown>,
  keys: string[]
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(attrs)
      .filter(([key]) => keys.includes(key))
      .sort(([left], [right]) => left.localeCompare(right))
  );
}

export function patchTextStyleMarkCreate(markType: MarkType): void {
  const patched = markType as MarkType & { [PATCHED]?: boolean };
  if (patched[PATCHED]) {
    return;
  }

  const originalCreate = markType.create.bind(markType);

  markType.create = (attrs = null) => {
    const keys = Object.keys(attrs ?? {});
    const mark = originalCreate(attrs);
    return new Mark(
      markType,
      canonicalizeTextStyleAttrs(mark.attrs as Record<string, unknown>, keys)
    );
  };

  patched[PATCHED] = true;
}

export const CanonicalizeTextStyleAttrs = Extension.create({
  name: "canonicalizeTextStyleAttrs",

  /** Run before Collaboration / CommentsKit bind Y → PM. */
  priority: 10_000,

  onBeforeCreate() {
    const textStyle = this.editor.schema.marks.textStyle;
    if (!textStyle) {
      return;
    }

    patchTextStyleMarkCreate(textStyle);
  },
});

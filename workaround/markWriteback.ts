import { Mark, type MarkType } from "@tiptap/pm/model";
import * as Y from "yjs";
import {
  type AttributeDefaults,
  saysTheSameAs,
  writebackScope,
} from "./writebackScope";

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
 *   `target`), so it stays on the ProseMirror mark and renders.
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
 *
 * A non-null default the stored value lacks is kept off Yjs where the mark is
 * written instead: `Y.Text.applyDelta`, scoped, swaps in the stored value
 * wherever the written one says the same (`saysTheSameAs`), so Yjs sees an
 * equal format and writes nothing. That is the rule element attributes follow
 * too. It cannot reach an overlapping mark, whose Yjs key is a hash of its
 * JSON: the default changes the key before any value is compared.
 */

const CREATE_PATCHED = Symbol("collabWritebackMarkCreate");
const TO_DELTA_PATCHED = Symbol("collabWritebackToDelta");
const APPLY_DELTA_PATCHED = Symbol("collabWritebackApplyDelta");

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

type TextPrototype = typeof Y.Text.prototype & {
  [TO_DELTA_PATCHED]?: boolean;
  [APPLY_DELTA_PATCHED]?: boolean;
};

interface DeltaOp {
  insert?: unknown;
  retain?: number;
  delete?: number;
  attributes?: Record<string, unknown>;
}

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

/**
 * Patch `Y.Text.applyDelta` so a mark value that says the same as the stored
 * one is written as the stored one. Once per process; scoped per write.
 *
 * y-prosemirror writes marks with one retain-only delta over the whole text,
 * one op per ProseMirror text node, each carrying every mark it has.
 */
export function keepStoredMarkValues(): void {
  const text = Y.Text.prototype as TextPrototype;
  if (text[APPLY_DELTA_PATCHED]) {
    return;
  }
  text[APPLY_DELTA_PATCHED] = true;

  const applyDelta = text.applyDelta;
  text.applyDelta = function (
    this: Y.Text,
    delta: DeltaOp[],
    options?: { sanitize?: boolean },
  ) {
    const scope = writebackScope(this);
    const retainOnly =
      Array.isArray(delta) &&
      delta.every((op) => op.retain !== undefined && op.insert === undefined);
    return applyDelta.call(
      this,
      scope && retainOnly
        ? withStoredValues(this, delta, scope.defaults.marks)
        : delta,
      options,
    );
  };
}

/** `delta`, split along the stored runs, preferring stored mark values. */
function withStoredValues(
  text: Y.Text,
  delta: DeltaOp[],
  defaults: ReadonlyMap<string, AttributeDefaults>,
): DeltaOp[] {
  const runs = (text.toDelta() as DeltaOp[]).map((op) => ({
    length: typeof op.insert === "string" ? op.insert.length : 1,
    attributes: op.attributes ?? {},
  }));

  const out: DeltaOp[] = [];
  let index = 0;
  for (const op of delta) {
    const written = op.attributes;
    let remaining = op.retain ?? 0;
    if (!written) {
      out.push(op);
      index += remaining;
      continue;
    }
    while (remaining > 0) {
      const run = runAt(runs, index);
      const length = Math.min(remaining, run.length);
      out.push({
        retain: length,
        attributes: preferStored(written, run.attributes, defaults),
      });
      index += length;
      remaining -= length;
    }
  }
  return out;
}

/** The stored run at `index`, with the length left in it from there. */
function runAt(
  runs: Array<{ length: number; attributes: Record<string, unknown> }>,
  index: number,
) {
  let start = 0;
  for (const run of runs) {
    if (index < start + run.length) {
      return {
        attributes: run.attributes,
        length: start + run.length - index,
      };
    }
    start += run.length;
  }
  return { attributes: {}, length: Number.POSITIVE_INFINITY };
}

/** `written`, with each mark value that says the same as `stored`'s swapped for it. */
function preferStored(
  written: Record<string, unknown>,
  stored: Record<string, unknown>,
  defaults: ReadonlyMap<string, AttributeDefaults>,
): Record<string, unknown> {
  const result = { ...written };
  for (const [key, value] of Object.entries(written)) {
    const storedValue = stored[key];
    if (
      isRecord(value) &&
      isRecord(storedValue) &&
      saysTheSameAs(storedValue, value, defaults.get(markName(key)))
    ) {
      result[key] = storedValue;
    }
  }
  return result;
}

/** The mark name behind a Yjs format key (`inlineThread--a1b2c3d4` → `inlineThread`). */
function markName(key: string): string {
  return key.replace(/--[a-zA-Z0-9+/=]{8}$/, "");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

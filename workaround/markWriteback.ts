import { Mark, type MarkType } from "@tiptap/pm/model";
import * as Y from "yjs";
import { patchMethod } from "./patchMethod";
import {
  type AttributeDefaults,
  saysTheSameAs,
  writebackScope,
} from "./writebackScope";

// Mechanisms 1 and 3 for marks; see README.md.

// prosemirror-model's `Mark` constructor is @internal, and `create` is what
// densifies attrs, so a sparse mark has to be built directly.
const MarkConstructor = Mark as unknown as new (
  type: MarkType,
  attrs: Record<string, unknown>,
) => Mark;

type Attrs = Record<string, unknown>;

interface DeltaOp {
  insert?: unknown;
  retain?: number;
  delete?: number;
  attributes?: Attrs;
}

/** Mark values Yjs handed out; y-prosemirror builds marks straight from them. */
const valuesReadFromYjs = new WeakSet<object>();

/** Makes `markType.create` leave out unset `null`-default attributes. */
export function keepMarkSparse(markType: MarkType): void {
  const declared = Object.entries(markType.spec.attrs ?? {});
  if (declared.length === 0) {
    return;
  }
  const nullDefaults = new Set(
    declared.filter(([, spec]) => spec?.default === null).map(([key]) => key),
  );

  patchMethod(markType, "create", (create) => (attrs = null) => {
    const given = attrs ?? {};
    const full = create.call(markType, attrs).attrs as Attrs;
    const keys = keysToKeep(given, full, nullDefaults);
    return new MarkConstructor(
      markType,
      Object.fromEntries(keys.map((key) => [key, full[key]])),
    );
  });
}

function keysToKeep(
  given: Attrs,
  full: Attrs,
  nullDefaults: Set<string>,
): string[] {
  const keys = [
    ...Object.keys(given).filter((key) => key in full),
    ...Object.keys(full).filter(
      (key) => !(key in given) && !nullDefaults.has(key),
    ),
  ];
  // Re-sorting a stored overlapping mark would change its hashed Yjs key.
  return valuesReadFromYjs.has(given) ? keys : keys.sort();
}

/** Tags values read from Yjs, and writes back stored values unchanged. */
export function patchMarkWrites(): void {
  patchMethod(
    Y.Text.prototype,
    "toDelta",
    (toDelta) =>
      function (this: Y.Text, ...args: Parameters<typeof toDelta>) {
        const delta = toDelta.apply(this, args) as DeltaOp[];
        for (const value of delta.flatMap((op) =>
          Object.values(op.attributes ?? {}),
        )) {
          if (isAttrs(value)) {
            valuesReadFromYjs.add(value);
          }
        }
        return delta;
      },
  );

  patchMethod(
    Y.Text.prototype,
    "applyDelta",
    (applyDelta) =>
      function (this: Y.Text, delta: DeltaOp[], options) {
        const scope = writebackScope(this);
        const marksOnly = delta.every(
          (op) => op.retain !== undefined && op.insert === undefined,
        );
        return applyDelta.call(
          this,
          scope && marksOnly
            ? preferStoredValues(this, delta, scope.defaults.marks)
            : delta,
          options,
        );
      },
  );
}

/** `delta` split along the stored runs, each saying-the-same value swapped for the stored one. */
function preferStoredValues(
  text: Y.Text,
  delta: DeltaOp[],
  defaults: ReadonlyMap<string, AttributeDefaults>,
): DeltaOp[] {
  const runs = (text.toDelta() as DeltaOp[]).map((op) => ({
    length: typeof op.insert === "string" ? op.insert.length : 1,
    attributes: op.attributes ?? {},
  }));

  const result: DeltaOp[] = [];
  let index = 0;
  for (const op of delta) {
    let remaining = op.retain ?? 0;
    if (!op.attributes) {
      result.push(op);
      index += remaining;
      continue;
    }
    while (remaining > 0) {
      const run = storedRunAt(runs, index);
      const length = Math.min(remaining, run.length);
      result.push({
        retain: length,
        attributes: preferStored(op.attributes, run.attributes, defaults),
      });
      index += length;
      remaining -= length;
    }
  }
  return result;
}

function storedRunAt(
  runs: Array<{ length: number; attributes: Attrs }>,
  index: number,
): { length: number; attributes: Attrs } {
  let start = 0;
  for (const run of runs) {
    if (index < start + run.length) {
      return { attributes: run.attributes, length: start + run.length - index };
    }
    start += run.length;
  }
  return { attributes: {}, length: Number.POSITIVE_INFINITY };
}

function preferStored(
  written: Attrs,
  stored: Attrs,
  defaults: ReadonlyMap<string, AttributeDefaults>,
): Attrs {
  return Object.fromEntries(
    Object.entries(written).map(([key, value]) => {
      const storedValue = stored[key];
      const same =
        isAttrs(value) &&
        isAttrs(storedValue) &&
        saysTheSameAs(storedValue, value, defaults.get(markNameOf(key)));
      return [key, same ? storedValue : value];
    }),
  );
}

/** `inlineThread--a1b2c3d4` → `inlineThread`: overlapping marks carry a hash. */
function markNameOf(formatKey: string): string {
  return formatKey.replace(/--[a-zA-Z0-9+/=]{8}$/, "");
}

function isAttrs(value: unknown): value is Attrs {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

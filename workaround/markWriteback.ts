import * as Y from "yjs";
import { patchMethod } from "./patchMethod";
import {
  type AttributeDefaults,
  saysTheSameAs,
  writebackScope,
} from "./writebackScope";

// Mechanisms 1 and 3 for marks; see README.md.

type Attrs = Record<string, unknown>;

interface DeltaOp {
  insert?: unknown;
  retain?: number;
  delete?: number;
  attributes?: Attrs;
}

/** Writes back a stored mark unchanged wherever the written one says the same. */
export function patchMarkWrites(): void {
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

/**
 * `written` with each mark that says the same as a stored one left as stored.
 * An overlapping mark's key is a hash of its JSON, so a different shape shows
 * up as removing the stored key and adding a new one; that pair is dropped.
 */
function preferStored(
  written: Attrs,
  stored: Attrs,
  defaults: ReadonlyMap<string, AttributeDefaults>,
): Attrs {
  const result = { ...written };
  for (const [key, value] of Object.entries(written)) {
    if (!isAttrs(value)) {
      continue;
    }
    const sameAs = (storedKey: string) =>
      isAttrs(stored[storedKey]) &&
      saysTheSameAs(stored[storedKey], value, defaults.get(markNameOf(key)));

    if (key in stored) {
      if (sameAs(key)) {
        result[key] = stored[key];
      }
      continue;
    }
    const replaced = Object.keys(stored).find(
      (storedKey) =>
        result[storedKey] === null &&
        markNameOf(storedKey) === markNameOf(key) &&
        sameAs(storedKey),
    );
    if (replaced !== undefined) {
      delete result[key];
      delete result[replaced];
    }
  }
  return result;
}

/** `inlineThread--a1b2c3d4` → `inlineThread`: overlapping marks carry a hash. */
function markNameOf(formatKey: string): string {
  return formatKey.replace(/--[a-zA-Z0-9+/=]{8}$/, "");
}

function isAttrs(value: unknown): value is Attrs {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

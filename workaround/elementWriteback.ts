import * as Y from "yjs";
import { type SchemaDefaults, writebackScope } from "./writebackScope";

/**
 * Element-attribute writes, for the block-anchor defect
 * (`docs/block-anchor-undone.md`).
 *
 * A comment-only connection may replace a block only with an identical copy,
 * attribute key order included. y-prosemirror cannot move an element, so
 * wrapping a block in `blockThread` deletes it and inserts a copy rebuilt from
 * the PM node: keys in schema order, every non-null default present.
 *
 * Two patches, each active only for writes `writebackScope` puts in scope:
 *
 * - `Y.XmlFragment` `delete`/`insert`: snapshot elements as y-prosemirror
 *   deletes them, and give each inserted copy that differs from a snapshot
 *   only by order, or by defaults the snapshot lacked, the snapshot's key order
 *   and key set. y-tiptap always deletes before it inserts the replacement.
 * - `Y.XmlElement.setAttribute`: skip writing a schema default onto an existing
 *   element that does not store the key. The aligned copy omits such defaults
 *   too, and y-prosemirror would otherwise write them back on the next sync;
 *   it also keeps an inline anchor on such a block from rewriting the block.
 *
 * Neither changes what the content is, only how identical content is written.
 */

const PATCHED = Symbol("collabWritebackElements");

/** An element as y-prosemirror deleted it, attributes in stored order. */
interface StoredElement {
  nodeName: string;
  attrs: [key: string, value: unknown][];
}

type PrelimElement = Y.XmlElement & {
  _prelimAttrs: Map<string, unknown> | null;
  _prelimContent: unknown[] | null;
};

type FragmentPrototype = typeof Y.XmlFragment.prototype & {
  [PATCHED]?: boolean;
};

/** Elements deleted so far in each y-sync transaction. */
const deletedInTransaction = new WeakMap<Y.Transaction, StoredElement[]>();

/** Install both patches once per process; each checks scope per write. */
export function patchYXmlElementWrites(): void {
  const fragment = Y.XmlFragment.prototype as FragmentPrototype;
  if (fragment[PATCHED]) {
    return;
  }

  const originalDelete = fragment.delete;
  fragment.delete = function (this: Y.XmlFragment, index, length = 1) {
    const scope = writebackScope(this);
    if (scope) {
      const stored = deletedInTransaction.get(scope.transaction) ?? [];
      for (const child of this.slice(index, index + length)) {
        collectStored(child, stored);
      }
      deletedInTransaction.set(scope.transaction, stored);
    }
    return originalDelete.call(this, index, length);
  };

  const originalInsert = fragment.insert;
  fragment.insert = function (this: Y.XmlFragment, index, content) {
    const scope = writebackScope(this);
    const stored = scope && deletedInTransaction.get(scope.transaction);
    if (scope && stored?.length) {
      for (const child of content) {
        alignWithStored(child, stored, scope.defaults);
      }
    }
    return originalInsert.call(this, index, content);
  };

  const element = Y.XmlElement.prototype;
  const originalSetAttribute = element.setAttribute;
  element.setAttribute = function (
    this: PrelimElement,
    key: string,
    value: unknown,
  ) {
    // `_prelimAttrs` is non-null while a new element integrates its own
    // attributes; only elements that already existed are spared the default.
    const scope =
      this.doc !== null && this._prelimAttrs === null
        ? writebackScope(this)
        : null;
    if (
      scope &&
      this.getAttribute(key) === undefined &&
      isSchemaDefault(scope.defaults, this.nodeName, key, value)
    ) {
      return;
    }
    // biome-ignore lint/suspicious/noExplicitAny: Yjs types the value by KV.
    return originalSetAttribute.call(this, key, value as any);
  };

  fragment[PATCHED] = true;
}

/** Snapshot `type` and every element below it, in document order. */
function collectStored(type: unknown, out: StoredElement[]): void {
  if (!(type instanceof Y.XmlElement)) {
    return;
  }
  out.push({
    nodeName: type.nodeName,
    attrs: Object.entries(type.getAttributes() as Record<string, unknown>),
  });
  for (const child of type.toArray()) {
    collectStored(child, out);
  }
}

/**
 * Give a not-yet-integrated copy, and each copy below it, the key order and
 * key set of the first deleted element it duplicates.
 */
function alignWithStored(
  type: unknown,
  stored: StoredElement[],
  defaults: SchemaDefaults,
): void {
  if (!(type instanceof Y.XmlElement)) {
    return;
  }
  const prelim = type as PrelimElement;
  const attrs = prelim._prelimAttrs;
  if (attrs) {
    const index = stored.findIndex((entry) =>
      duplicates(entry, type.nodeName, attrs, defaults),
    );
    if (index !== -1) {
      const [twin] = stored.splice(index, 1);
      prelim._prelimAttrs = new Map(
        twin.attrs.map(([key]) => [key, attrs.get(key)]),
      );
    }
  }
  for (const child of prelim._prelimContent ?? []) {
    alignWithStored(child, stored, defaults);
  }
}

/**
 * Whether a copy named `nodeName` with `attrs` holds the same content as
 * `stored`: every stored key with an equal value, and nothing else but schema
 * defaults.
 */
function duplicates(
  stored: StoredElement,
  nodeName: string,
  attrs: Map<string, unknown>,
  defaults: SchemaDefaults,
): boolean {
  if (stored.nodeName !== nodeName) {
    return false;
  }
  const storedKeys = new Set(stored.attrs.map(([key]) => key));
  return (
    stored.attrs.every(
      ([key, value]) => attrs.has(key) && sameValue(attrs.get(key), value),
    ) &&
    [...attrs].every(
      ([key, value]) =>
        storedKeys.has(key) || isSchemaDefault(defaults, nodeName, key, value),
    )
  );
}

function isSchemaDefault(
  defaults: SchemaDefaults,
  nodeName: string,
  key: string,
  value: unknown,
): boolean {
  const byKey = defaults.get(nodeName);
  return byKey?.has(key) === true && sameValue(byKey.get(key), value);
}

function sameValue(left: unknown, right: unknown): boolean {
  return (
    left === right ||
    (typeof left === "object" &&
      typeof right === "object" &&
      JSON.stringify(left) === JSON.stringify(right))
  );
}

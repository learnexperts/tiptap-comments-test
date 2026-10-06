import type { Schema } from "@tiptap/pm/model";
import { ySyncPluginKey } from "@tiptap/y-tiptap";
import * as Y from "yjs";

/**
 * Element-attribute half of `CollabWriteback`.
 *
 * A comment-only connection may replace a block only with an identical copy:
 * the server compares element attributes including the order their keys were
 * first written. y-prosemirror cannot move an element, so wrapping a block in
 * `blockThread` deletes it and inserts a copy built from the PM node — in
 * schema order, with every non-null default. A block whose stored keys were
 * written in another order (a code block's language picked after insert, a
 * paragraph aligned after typing) or that lacks a default therefore reads as
 * an edit, and the server undoes the whole update, anchor included.
 *
 * Two patches, both active only inside `ySyncPluginKey` transactions:
 *
 * 1. `Y.XmlFragment` `delete`/`insert`: snapshot elements as y-prosemirror
 *    deletes them, and give each inserted copy that differs from a snapshot
 *    only by order or by defaults the snapshot lacked the snapshot's key order
 *    and key set. y-tiptap always deletes before it inserts the replacement.
 * 2. `Y.XmlElement.setAttribute`: skip writing a schema default onto an
 *    existing element that does not store the key. Patch 1 relies on this —
 *    the copy omits that default too, and y-prosemirror would otherwise write
 *    it back on the next sync — and it also keeps inline anchors on such blocks
 *    from rewriting the block.
 *
 * Both only ever change how identical content is written, never what it is.
 */

const PATCHED = Symbol("collabWritebackElements");

type Attrs = Record<string, unknown>;

/** An element as y-prosemirror deleted it, attributes in stored order. */
interface StoredElement {
  nodeName: string;
  attrs: [key: string, value: unknown][];
}

type PrelimElement = Y.XmlElement & {
  _prelimAttrs: Map<string, unknown> | null;
  _prelimContent: unknown[] | null;
};

type FragmentProto = typeof Y.XmlFragment.prototype & {
  [PATCHED]?: boolean;
};

type DocWithTransaction = Y.Doc & { _transaction: Y.Transaction | null };

/** Per node name, the non-null schema default of each attribute. */
const schemaDefaults = new Map<string, Map<string, unknown>>();

/** Elements deleted so far in each y-sync transaction. */
const deletedInTransaction = new WeakMap<Y.Transaction, StoredElement[]>();

/** Record `schema`'s attribute defaults, by node name. */
export function registerSchemaDefaults(schema: Schema): void {
  for (const [name, type] of Object.entries(schema.nodes)) {
    const defaults = new Map<string, unknown>();
    for (const [key, spec] of Object.entries(type.spec.attrs ?? {})) {
      const value = (spec as { default?: unknown } | undefined)?.default;
      if (value !== null && value !== undefined) {
        defaults.set(key, value);
      }
    }
    schemaDefaults.set(name, defaults);
  }
}

/** Install both patches. Idempotent. */
export function patchYXmlElementWrites(): void {
  const fragment = Y.XmlFragment.prototype as FragmentProto;
  if (fragment[PATCHED]) {
    return;
  }

  const originalDelete = fragment.delete;
  fragment.delete = function (this: Y.XmlFragment, index, length = 1) {
    const transaction = ySyncTransaction(this.doc);
    if (transaction) {
      const stored = deletedInTransaction.get(transaction) ?? [];
      for (const child of this.slice(index, index + length)) {
        collectStored(child, stored);
      }
      deletedInTransaction.set(transaction, stored);
    }
    return originalDelete.call(this, index, length);
  };

  const originalInsert = fragment.insert;
  fragment.insert = function (this: Y.XmlFragment, index, content) {
    const transaction = ySyncTransaction(this.doc);
    const stored = transaction && deletedInTransaction.get(transaction);
    if (stored?.length) {
      for (const child of content) {
        alignWithStored(child, stored);
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
    const existing = this.doc !== null && this._prelimAttrs === null;
    if (
      existing &&
      ySyncTransaction(this.doc) &&
      this.getAttribute(key) === undefined &&
      isSchemaDefault(this.nodeName, key, value)
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
    attrs: Object.entries(type.getAttributes() as Attrs),
  });
  for (const child of type.toArray()) {
    collectStored(child, out);
  }
}

/**
 * Give a not-yet-integrated copy, and each copy below it, the key order and
 * key set of the first deleted element it duplicates.
 */
function alignWithStored(type: unknown, stored: StoredElement[]): void {
  if (!(type instanceof Y.XmlElement)) {
    return;
  }
  const prelim = type as PrelimElement;
  const attrs = prelim._prelimAttrs;
  if (attrs) {
    const index = stored.findIndex((entry) =>
      duplicates(entry, type.nodeName, attrs),
    );
    if (index !== -1) {
      const [twin] = stored.splice(index, 1);
      prelim._prelimAttrs = new Map(
        twin.attrs.map(([key]) => [key, attrs.get(key)]),
      );
    }
  }
  for (const child of prelim._prelimContent ?? []) {
    alignWithStored(child, stored);
  }
}

/**
 * Whether a copy named `nodeName` with `attrs` holds the same content as
 * `stored`: every stored key with an equal value, and nothing else but
 * schema defaults.
 */
function duplicates(
  stored: StoredElement,
  nodeName: string,
  attrs: Map<string, unknown>,
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
        storedKeys.has(key) || isSchemaDefault(nodeName, key, value),
    )
  );
}

function isSchemaDefault(
  nodeName: string,
  key: string,
  value: unknown,
): boolean {
  const defaults = schemaDefaults.get(nodeName);
  return defaults?.has(key) === true && sameValue(defaults.get(key), value);
}

function sameValue(left: unknown, right: unknown): boolean {
  return (
    left === right ||
    (typeof left === "object" &&
      typeof right === "object" &&
      JSON.stringify(left) === JSON.stringify(right))
  );
}

/** The running transaction, when y-prosemirror is writing PM → Y. */
function ySyncTransaction(doc: Y.Doc | null): Y.Transaction | null {
  const transaction = (doc as DocWithTransaction | null)?._transaction;
  return transaction && transaction.origin === ySyncPluginKey
    ? transaction
    : null;
}

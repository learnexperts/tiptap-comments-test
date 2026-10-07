import * as Y from "yjs";
import { patchMethod } from "./patchMethod";
import {
  type SchemaDefaults,
  saysTheSameAs,
  writebackScope,
} from "./writebackScope";

// Mechanisms 2 to 4 for elements; see README.md. y-prosemirror rebuilds a
// block (to wrap it) as delete-then-insert, so each inserted copy is matched
// against what the same transaction deleted.

/** An element as it was stored, attributes in stored order. */
interface StoredElement {
  nodeName: string;
  attrs: Record<string, unknown>;
  /** y-prosemirror empties a block's only text rather than deleting it. */
  keepsEmptyText: boolean;
}

// Yjs internals: a not-yet-integrated element keeps its attributes and
// children here, and `_prelimAttrs` stays set while it integrates them.
type PrelimElement = Y.XmlElement & {
  _prelimAttrs: Map<string, unknown> | null;
  _prelimContent: unknown[] | null;
};

const deletedInTransaction = new WeakMap<Y.Transaction, StoredElement[]>();

export function patchElementWrites(): void {
  patchMethod(
    Y.XmlFragment.prototype,
    "delete",
    (remove) =>
      function (this: Y.XmlFragment, index, length = 1) {
        const scope = writebackScope(this);
        if (scope) {
          const deleted = deletedInTransaction.get(scope.transaction) ?? [];
          for (const child of this.slice(index, index + length)) {
            snapshot(child, deleted);
          }
          deletedInTransaction.set(scope.transaction, deleted);
        }
        return remove.call(this, index, length);
      },
  );

  patchMethod(
    Y.XmlFragment.prototype,
    "insert",
    (insert) =>
      function (this: Y.XmlFragment, index, content) {
        const scope = writebackScope(this);
        const deleted = scope && deletedInTransaction.get(scope.transaction);
        if (scope && deleted?.length) {
          for (const copy of content) {
            matchStoredShape(copy, deleted, scope.defaults);
          }
        }
        return insert.call(this, index, content);
      },
  );

  patchMethod(
    Y.XmlElement.prototype,
    "setAttribute",
    (setAttribute) =>
      function (this: PrelimElement, key, value) {
        if (addsNothing(this, key, value)) {
          return;
        }
        return setAttribute.call(this, key, value);
      },
  );
}

/** Pushes `type` and every element below it, in document order. */
function snapshot(type: unknown, into: StoredElement[]): void {
  if (!(type instanceof Y.XmlElement)) {
    return;
  }
  into.push({
    nodeName: type.nodeName,
    attrs: type.getAttributes(),
    keepsEmptyText: type.length === 1 && isEmptyText(type.get(0)),
  });
  for (const child of type.toArray()) {
    snapshot(child, into);
  }
}

function isEmptyText(type: unknown): boolean {
  return type instanceof Y.XmlText && type.length === 0;
}

/** Gives `copy`, and each copy below it, the shape of the element it duplicates. */
function matchStoredShape(
  copy: unknown,
  deleted: StoredElement[],
  defaults: SchemaDefaults,
): void {
  if (!(copy instanceof Y.XmlElement)) {
    return;
  }
  const prelim = copy as PrelimElement;
  const attrs = prelim._prelimAttrs;
  if (attrs) {
    const twin = deleted.findIndex(
      (stored) =>
        stored.nodeName === copy.nodeName &&
        saysTheSameAs(
          stored.attrs,
          Object.fromEntries(attrs),
          defaults.nodes.get(copy.nodeName),
        ),
    );
    if (twin !== -1) {
      const [stored] = deleted.splice(twin, 1);
      prelim._prelimAttrs = new Map(
        Object.keys(stored.attrs).map((key) => [key, attrs.get(key)]),
      );
      if (stored.keepsEmptyText && prelim._prelimContent?.length === 0) {
        prelim._prelimContent.push(new Y.XmlText());
      }
    }
  }
  for (const child of prelim._prelimContent ?? []) {
    matchStoredShape(child, deleted, defaults);
  }
}

/** Whether setting `key` on a stored element would add only a default. */
function addsNothing(
  element: PrelimElement,
  key: string,
  value: unknown,
): boolean {
  const isNew = element._prelimAttrs !== null;
  const scope = isNew ? null : writebackScope(element);
  if (!scope) {
    return false;
  }
  const stored = element.getAttributes() as Record<string, unknown>;
  return saysTheSameAs(
    stored,
    { ...stored, [key]: value },
    scope.defaults.nodes.get(element.nodeName),
  );
}

import type { Schema } from "@tiptap/pm/model";
import { ySyncPluginKey } from "@tiptap/y-tiptap";
import type * as Y from "yjs";

// The Yjs patches live on shared prototypes. A write is theirs to touch only
// while y-prosemirror writes ProseMirror → Yjs, under a fragment a
// CollabWriteback editor registered. Fragments, not documents: one document
// can hold several editors' pages, each with its own schema.

// biome-ignore lint/suspicious/noExplicitAny: AbstractType is invariant in its event type.
export type YType = Y.AbstractType<any>;

/** Declared attribute defaults of one node or mark type, `null`s included. */
export type AttributeDefaults = ReadonlyMap<string, unknown>;

export interface SchemaDefaults {
  nodes: ReadonlyMap<string, AttributeDefaults>;
  marks: ReadonlyMap<string, AttributeDefaults>;
}

export interface WritebackScope {
  transaction: Y.Transaction;
  defaults: SchemaDefaults;
}

type DocWithTransaction = Y.Doc & { _transaction: Y.Transaction | null };

const registrations = new WeakMap<
  YType,
  { defaults: SchemaDefaults; editors: number }
>();

/** Puts `fragment` in scope; returns the call that takes it out again. */
export function registerFragment(
  fragment: Y.XmlFragment,
  schema: Schema,
): () => void {
  const registration = registrations.get(fragment) ?? {
    defaults: {
      nodes: declaredDefaults(schema.nodes),
      marks: declaredDefaults(schema.marks),
    },
    editors: 0,
  };
  registration.editors += 1;
  registrations.set(fragment, registration);

  let registered = true;
  return () => {
    if (!registered) {
      return;
    }
    registered = false;
    registration.editors -= 1;
    if (registration.editors === 0) {
      registrations.delete(fragment);
    }
  };
}

/** The scope a write to `type` falls in, or null to leave it alone. */
export function writebackScope(type: YType): WritebackScope | null {
  const transaction = (type.doc as DocWithTransaction | null)?._transaction;
  if (transaction?.origin !== ySyncPluginKey) {
    return null;
  }
  for (let current: YType | undefined = type; current; ) {
    const registration = registrations.get(current);
    if (registration) {
      return { transaction, defaults: registration.defaults };
    }
    current = current._item?.parent as YType | undefined;
  }
  return null;
}

/**
 * Whether `written` adds nothing to `stored`: every stored key unchanged, and
 * any extra key at its schema default, which a reader assumes anyway.
 */
export function saysTheSameAs(
  stored: Readonly<Record<string, unknown>>,
  written: Readonly<Record<string, unknown>>,
  defaults: AttributeDefaults | undefined,
): boolean {
  const storedUnchanged = Object.entries(stored).every(
    ([key, value]) => key in written && sameValue(written[key], value),
  );
  const extrasAreDefaults = Object.entries(written).every(
    ([key, value]) =>
      key in stored ||
      (defaults?.has(key) === true && sameValue(defaults.get(key), value)),
  );
  return storedUnchanged && extrasAreDefaults;
}

function sameValue(left: unknown, right: unknown): boolean {
  return (
    left === right ||
    (typeof left === "object" &&
      typeof right === "object" &&
      JSON.stringify(left) === JSON.stringify(right))
  );
}

function declaredDefaults(
  types: Readonly<Record<string, { spec: { attrs?: object | null } }>>,
): ReadonlyMap<string, AttributeDefaults> {
  return new Map(
    Object.entries(types).map(([name, type]) => [
      name,
      new Map(
        Object.entries(type.spec.attrs ?? {})
          .map(([key, spec]): [string, unknown] => [
            key,
            (spec as { default?: unknown }).default,
          ])
          .filter(([, value]) => value !== undefined),
      ),
    ]),
  );
}

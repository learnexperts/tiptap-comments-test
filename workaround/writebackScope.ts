import type { Schema } from "@tiptap/pm/model";
import { ySyncPluginKey } from "@tiptap/y-tiptap";
import type * as Y from "yjs";

/**
 * Which Yjs writes the workaround may touch.
 *
 * The Yjs patches have to be installed on shared prototypes, so on their own
 * they would apply to every collaborative editor in the process. This module
 * narrows them: a write is in scope only while y-prosemirror is writing
 * ProseMirror → Yjs (`ySyncPluginKey` transaction) **and** the written type
 * sits under a fragment a `CollabWriteback` editor registered. Everything else
 * passes through untouched.
 *
 * Registration is per fragment, not per document, because one document can
 * hold several editors' fragments (one per page), each with its own schema.
 */

/**
 * Any Yjs type. `AbstractType` is invariant in its event type, so `unknown`
 * would not accept an `XmlFragment` or `XmlElement`.
 */
// biome-ignore lint/suspicious/noExplicitAny: see above.
export type YType = Y.AbstractType<any>;

/** Per node name, the non-null schema default of each attribute. */
export type SchemaDefaults = ReadonlyMap<string, ReadonlyMap<string, unknown>>;

export interface WritebackScope {
  /** The y-sync transaction the write belongs to. */
  transaction: Y.Transaction;
  /** The registering editor's schema defaults. */
  defaults: SchemaDefaults;
}

interface Registration {
  defaults: SchemaDefaults;
  editors: number;
}

type DocWithTransaction = Y.Doc & { _transaction: Y.Transaction | null };

const registrations = new WeakMap<YType, Registration>();

/**
 * Puts `fragment` in scope with `schema`'s defaults, and returns the call that
 * takes it out again. Several editors may register one fragment; it stays in
 * scope until the last one leaves.
 */
export function registerFragment(
  fragment: Y.XmlFragment,
  schema: Schema,
): () => void {
  const existing = registrations.get(fragment);
  if (existing) {
    existing.editors += 1;
  } else {
    registrations.set(fragment, {
      defaults: schemaDefaults(schema),
      editors: 1,
    });
  }

  let registered = true;
  return () => {
    const registration = registrations.get(fragment);
    if (!registered || !registration) {
      return;
    }
    registered = false;
    registration.editors -= 1;
    if (registration.editors === 0) {
      registrations.delete(fragment);
    }
  };
}

/** The scope a write to `type` falls in, or null if it must pass through. */
export function writebackScope(type: YType): WritebackScope | null {
  const transaction = (type.doc as DocWithTransaction | null)?._transaction;
  if (!transaction || transaction.origin !== ySyncPluginKey) {
    return null;
  }

  let current: YType | null = type;
  while (current) {
    const registration = registrations.get(current);
    if (registration) {
      return { transaction, defaults: registration.defaults };
    }
    current = (current._item?.parent as YType | undefined) ?? null;
  }
  return null;
}

function schemaDefaults(schema: Schema): SchemaDefaults {
  const byNode = new Map<string, Map<string, unknown>>();
  for (const [name, type] of Object.entries(schema.nodes)) {
    const defaults = new Map<string, unknown>();
    for (const [key, spec] of Object.entries(type.spec.attrs ?? {})) {
      const value = (spec as { default?: unknown } | undefined)?.default;
      if (value !== null && value !== undefined) {
        defaults.set(key, value);
      }
    }
    byNode.set(name, defaults);
  }
  return byNode;
}

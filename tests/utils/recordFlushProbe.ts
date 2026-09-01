import type { TiptapCollabProvider } from "@tiptap-pro/provider";
import * as Y from "yjs";
import { ySyncPluginKey } from "~/fixtures/editor/compactTextStyleYAttrs";

export interface FlushProbeEvent {
  kind: "update" | "transaction" | "unsynced";
  origin?: string;
  local?: boolean;
  changedSize?: number;
  changedShares?: string[];
  bytes?: number;
  structTypes?: string[];
  unsynced: boolean;
  unsyncedCount: number;
}

function unsyncedCountOf(provider: TiptapCollabProvider): number {
  return (provider as TiptapCollabProvider & { unsyncedChanges: number })
    .unsyncedChanges;
}

function originName(origin: unknown, provider: TiptapCollabProvider): string {
  if (origin === provider) {
    return "provider";
  }
  if (origin === ySyncPluginKey) {
    return "ySyncPluginKey";
  }
  if (typeof origin === "string") {
    return origin;
  }
  if (origin && typeof origin === "object") {
    const name = (origin as { constructor?: { name?: string } }).constructor
      ?.name;
    if (name) {
      return name;
    }
  }
  return String(origin);
}

function shareKeys(ydoc: Y.Doc): string[] {
  return [...ydoc.share.keys()].sort();
}

function changedShareNames(
  ydoc: Y.Doc,
  transaction: Y.Transaction
): string[] {
  const names: string[] = [];

  for (const [name, type] of ydoc.share) {
    if (
      transaction.changed.has(type) ||
      transaction.changedParentTypes.has(type)
    ) {
      names.push(name);
    }
  }

  return names.sort();
}

function structTypesOf(update: Uint8Array): string[] {
  try {
    const decoded = Y.decodeUpdate(update);
    return decoded.structs.slice(0, 12).map((struct) => {
      const content = (struct as { content?: { constructor?: { name?: string } } })
        .content;
      const ctor = struct.constructor.name;
      const contentName = content?.constructor?.name;
      return contentName ? `${ctor}/${contentName}` : ctor;
    });
  } catch {
    return [];
  }
}

/**
 * Record Y `update` vs empty `afterTransaction`, plus provider unsynced flag.
 * Distinguishes a real CRDT rewrite loop from a stuck sync handshake.
 */
export function recordFlushProbe(options: {
  ydoc: Y.Doc;
  provider: TiptapCollabProvider;
}) {
  const { ydoc, provider } = options;
  const events: FlushProbeEvent[] = [];
  const sharesAtStart = shareKeys(ydoc);
  const unsyncedAtStart = unsyncedCountOf(provider);

  const onUpdate = (update: Uint8Array, origin: unknown) => {
    events.push({
      kind: "update",
      origin: originName(origin, provider),
      bytes: update.byteLength,
      structTypes: structTypesOf(update),
      unsynced: provider.hasUnsyncedChanges,
      unsyncedCount: unsyncedCountOf(provider),
    });
  };

  const onAfterTransaction = (transaction: Y.Transaction) => {
    events.push({
      kind: "transaction",
      origin: originName(transaction.origin, provider),
      local: transaction.local,
      changedSize: transaction.changed.size,
      changedShares: changedShareNames(ydoc, transaction),
      unsynced: provider.hasUnsyncedChanges,
      unsyncedCount: unsyncedCountOf(provider),
    });
  };

  const onUnsynced = (payload: number | { number: number }) => {
    const count = typeof payload === "number" ? payload : payload.number;
    events.push({
      kind: "unsynced",
      unsynced: count > 0,
      unsyncedCount: count,
    });
  };

  ydoc.on("update", onUpdate);
  ydoc.on("afterTransaction", onAfterTransaction);
  provider.on("unsyncedChanges", onUnsynced);

  return {
    getEvents(): readonly FlushProbeEvent[] {
      return events;
    },
    getSummary() {
      const updates = events.filter((event) => event.kind === "update");
      const mutating = events.filter(
        (event) =>
          event.kind === "transaction" && (event.changedSize ?? 0) > 0
      );

      return {
        sharesAtStart,
        unsyncedAtStart,
        unsyncedAtEnd: unsyncedCountOf(provider),
        updateCount: updates.length,
        mutatingTransactionCount: mutating.length,
        emptyTransactionCount: events.filter(
          (event) =>
            event.kind === "transaction" && event.changedSize === 0
        ).length,
        lastUnsynced: events.at(-1)?.unsynced ?? provider.hasUnsyncedChanges,
        updates: updates.slice(0, 20),
        mutating,
        unsyncedEvents: events.filter((event) => event.kind === "unsynced"),
      };
    },
    unsubscribe() {
      ydoc.off("update", onUpdate);
      ydoc.off("afterTransaction", onAfterTransaction);
      provider.off("unsyncedChanges", onUnsynced);
    },
  };
}

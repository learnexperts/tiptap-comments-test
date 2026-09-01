import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";

const pluginKey = new PluginKey("canonicalizeAttrOrder");

/**
 * Rebuild a plain object with keys in sorted order (nested objects too).
 * y-prosemirror hashes overlapping marks with `encodeAny(mark.toJSON())`,
 * which is insertion-order sensitive.
 */
export function sortRecordKeys(
  value: Record<string, unknown>
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => [
        key,
        isPlainObject(nested) ? sortRecordKeys(nested) : nested,
      ])
  );
}

export function recordKeyOrderEquals(
  left: Record<string, unknown>,
  right: Record<string, unknown>
): boolean {
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  if (leftKeys.length !== rightKeys.length) {
    return false;
  }
  return leftKeys.every((key, index) => key === rightKeys[index]);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Keep mark attr keys sorted on the PM doc before y-prosemirror writeback.
 * Register after `CollabWriteback` so the sparse bag is ordered.
 */
export const CanonicalizeAttrOrder = Extension.create({
  name: "canonicalizeAttrOrder",

  /** After CollabWriteback (10_000); before Collaboration bind. */
  priority: 9_999,

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: pluginKey,
        appendTransaction: (_transactions, _oldState, newState) => {
          const tr = newState.tr;
          let modified = false;

          newState.doc.descendants((node, pos) => {
            if (!node.isText) {
              return;
            }

            const from = pos;
            const to = pos + node.nodeSize;

            for (const mark of node.marks) {
              const attrs = mark.attrs as Record<string, unknown>;
              const sorted = sortRecordKeys(attrs);
              if (recordKeyOrderEquals(attrs, sorted)) {
                continue;
              }

              tr.removeMark(from, to, mark);
              tr.addMark(from, to, mark.type.create(sorted));
              modified = true;
            }
          });

          if (!modified) {
            return null;
          }

          return tr;
        },
      }),
    ];
  },
});

import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { ySyncPluginKey } from "@tiptap/y-tiptap";
import * as Y from "yjs";

const COMPACT_ORIGIN = "compact-text-style-y-attrs";
const pluginKey = new PluginKey("compactTextStyleYAttrs");

export { ySyncPluginKey };

/**
 * Client workaround for comment-only sync + full textStyle kit:
 * y-prosemirror assigns `mark.attrs` wholesale on PM→Y writeback, so unused kit
 * fields (`color`, `fontSize`, …) become `null` in Yjs. Compacting those objects
 * immediately after `ySyncPluginKey` transactions keeps Y sparse before the
 * provider sends the update upstream.
 *
 * Pair with `CollabWriteback` (pre-writeback PM guard + surgical Y retains).
 */
export const CompactTextStyleYAttrs = Extension.create({
  name: "compactTextStyleYAttrs",

  addStorage() {
    return {
      field: "default",
      ydoc: null as Y.Doc | null,
      compact: undefined as (() => void) | undefined,
      cleanup: undefined as (() => void) | undefined,
    };
  },

  addProseMirrorPlugins() {
    const extension = this;

    return [
      new Plugin({
        key: pluginKey,
        view: (view) => {
          const syncState = ySyncPluginKey.getState(view.state);
          const ydoc = syncState?.doc as Y.Doc | undefined;
          if (!ydoc) {
            return {};
          }

          const collaboration = extension.editor.extensionManager.extensions.find(
            (entry) => entry.name === "collaboration"
          );
          const field =
            (collaboration?.options.field as string | undefined) ?? "default";

          extension.storage.ydoc = ydoc;
          extension.storage.field = field;

          const compact = () => {
            const fragment = ydoc.getXmlFragment(field);
            if (!textStyleAttrsNeedCompact(fragment)) {
              return;
            }

            ydoc.transact(() => {
              compactTextStyleAttrsInFragment(fragment);
            }, COMPACT_ORIGIN);
          };

          extension.storage.compact = compact;

          const onAfterTransaction = (transaction: Y.Transaction) => {
            if (transaction.origin === COMPACT_ORIGIN) {
              return;
            }

            if (!isYProsemirrorWriteback(transaction)) {
              return;
            }

            compact();
          };

          ydoc.on("afterTransaction", onAfterTransaction);
          extension.storage.cleanup = () => {
            ydoc.off("afterTransaction", onAfterTransaction);
          };

          return {
            destroy: () => {
              extension.storage.cleanup?.();
              extension.storage.cleanup = undefined;
            },
          };
        },
      }),
    ];
  },

  onDestroy() {
    this.storage.cleanup?.();
  },
});

declare module "@tiptap/core" {
  interface Storage {
    compactTextStyleYAttrs: {
      field: string;
      ydoc: Y.Doc | null;
      compact?: () => void;
      cleanup?: () => void;
    };
  }
}

export function isYProsemirrorWriteback(transaction: Y.Transaction): boolean {
  return transaction.local && transaction.origin === ySyncPluginKey;
}

export function compactTextStyleAttrsInFragment(
  fragment: Y.XmlFragment | Y.XmlElement
): boolean {
  let modified = false;
  const stack: Array<Y.XmlFragment | Y.XmlElement> = [fragment];

  while (stack.length > 0) {
    const node = stack.pop()!;
    for (const child of node.toArray()) {
      if (child instanceof Y.XmlText) {
        if (compactTextStyleAttrsOnText(child)) {
          modified = true;
        }
        continue;
      }
      if (child instanceof Y.XmlElement) {
        stack.push(child);
      }
    }
  }

  return modified;
}

export function textStyleAttrsNeedCompact(
  fragment: Y.XmlFragment | Y.XmlElement
): boolean {
  const stack: Array<Y.XmlFragment | Y.XmlElement> = [fragment];

  while (stack.length > 0) {
    const node = stack.pop()!;
    for (const child of node.toArray()) {
      if (child instanceof Y.XmlText) {
        if (textStyleAttrsNeedCompactOnText(child)) {
          return true;
        }
        continue;
      }
      if (child instanceof Y.XmlElement) {
        stack.push(child);
      }
    }
  }

  return false;
}

function compactTextStyleAttrsOnText(yText: Y.XmlText): boolean {
  let index = 0;
  let modified = false;

  for (const op of yText.toDelta()) {
    const insert = op.insert;
    const length =
      typeof insert === "string" ? insert.length : insert == null ? 0 : 1;
    const textStyle = op.attributes?.textStyle;

    if (isPlainObject(textStyle)) {
      const sparse = sparseAttrs(textStyle);
      if (!shallowEqualRecords(textStyle, sparse)) {
        yText.format(index, length, {
          textStyle: Object.keys(sparse).length > 0 ? sparse : null,
        });
        modified = true;
      }
    }

    index += length;
  }

  return modified;
}

function textStyleAttrsNeedCompactOnText(yText: Y.XmlText): boolean {
  for (const op of yText.toDelta()) {
    const textStyle = op.attributes?.textStyle;
    if (
      isPlainObject(textStyle) &&
      !shallowEqualRecords(textStyle, sparseAttrs(textStyle))
    ) {
      return true;
    }
  }

  return false;
}

export function sparseAttrs(
  attrs: Record<string, unknown>
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(attrs)
      .filter(([, value]) => value != null && value !== "")
      .sort(([left], [right]) => left.localeCompare(right))
  );
}

function shallowEqualRecords(
  left: Record<string, unknown>,
  right: Record<string, unknown>
): boolean {
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  if (leftKeys.length !== rightKeys.length) {
    return false;
  }
  return leftKeys.every(
    (key, index) => key === rightKeys[index] && left[key] === right[key]
  );
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

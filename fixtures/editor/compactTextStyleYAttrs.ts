import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import * as Y from "yjs";

const COMPACT_ORIGIN = "compact-text-style-y-attrs";
const pluginKey = new PluginKey("compactTextStyleYAttrs");

/**
 * Client workaround for comment-only sync + full textStyle kit:
 * y-prosemirror assigns `mark.attrs` wholesale, so unused kit fields
 * (`color`, `fontSize`, …) become `null` in Yjs. Compacting those objects
 * after local transactions keeps the stored shape sparse — matching the
 * FontFamily-only control that still persists anchors.
 *
 * Note: integration tests show sparse Y storage alone does **not** fix
 * comment-only anchor loss with the full kit; this extension is still useful
 * to prove densify → compact behavior offline.
 */
export const CompactTextStyleYAttrs = Extension.create({
  name: "compactTextStyleYAttrs",

  addStorage() {
    return {
      field: "default",
      ydoc: null as Y.Doc | null,
    };
  },

  onCreate() {
    const collaboration = this.editor.extensionManager.extensions.find(
      (extension) => extension.name === "collaboration"
    );
    const ydoc = collaboration?.options.document as Y.Doc | null | undefined;

    if (!ydoc) {
      return;
    }

    this.storage.ydoc = ydoc;
    this.storage.field =
      (collaboration?.options.field as string | undefined) ?? "default";

    this.storage.compact = () => {
      ydoc.transact(() => {
        compactTextStyleAttrsInFragment(
          ydoc.getXmlFragment(this.storage.field)
        );
      }, COMPACT_ORIGIN);
    };

    const onAfterTransaction = (transaction: Y.Transaction) => {
      if (transaction.origin === COMPACT_ORIGIN) {
        return;
      }
      if (!transaction.local) {
        return;
      }
      this.storage.compact?.();
    };

    ydoc.on("afterTransaction", onAfterTransaction);
    this.storage.compact();

    this.storage.cleanup = () => {
      ydoc.off("afterTransaction", onAfterTransaction);
    };
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: pluginKey,
        view: () => ({
          update: () => {
            this.storage.compact?.();
          },
        }),
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

export function compactTextStyleAttrsInFragment(
  fragment: Y.XmlFragment | Y.XmlElement
): void {
  const stack: Array<Y.XmlFragment | Y.XmlElement> = [fragment];

  while (stack.length > 0) {
    const node = stack.pop()!;
    for (const child of node.toArray()) {
      if (child instanceof Y.XmlText) {
        compactTextStyleAttrsOnText(child);
        continue;
      }
      if (child instanceof Y.XmlElement) {
        stack.push(child);
      }
    }
  }
}

function compactTextStyleAttrsOnText(yText: Y.XmlText): void {
  let index = 0;

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
      }
    }

    index += length;
  }
}

export function sparseAttrs(
  attrs: Record<string, unknown>
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(attrs).filter(([, value]) => value != null && value !== "")
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
  return leftKeys.every((key) => left[key] === right[key]);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

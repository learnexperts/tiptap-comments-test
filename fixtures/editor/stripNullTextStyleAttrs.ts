import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { sparseAttrs } from "./compactTextStyleYAttrs";

const pluginKey = new PluginKey("stripNullTextStyleAttrs");

function textStyleNeedsStrip(attrs: Record<string, unknown>): boolean {
  return Object.entries(attrs).some(
    ([, value]) => value == null || value === ""
  );
}

/**
 * Strip null/empty keys from `textStyle` marks in ProseMirror before
 * y-prosemirror writeback. Full kit extensions register attrs with
 * `default: null`, which densifies marks and Yjs; compacting on Y alone
 * races with bind writeback.
 */
export const StripNullTextStyleAttrs = Extension.create({
  name: "stripNullTextStyleAttrs",

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: pluginKey,
        appendTransaction: (_transactions, _oldState, newState) => {
          const textStyleType = newState.schema.marks.textStyle;
          if (!textStyleType) {
            return null;
          }

          const tr = newState.tr;
          let modified = false;

          newState.doc.descendants((node, pos) => {
            if (!node.isText) {
              return;
            }

            const textStyleMark = node.marks.find(
              (mark) => mark.type === textStyleType
            );
            if (!textStyleMark) {
              return;
            }

            const attrs = textStyleMark.attrs as Record<string, unknown>;
            if (!textStyleNeedsStrip(attrs)) {
              return;
            }

            const sparse = sparseAttrs(attrs);
            const from = pos;
            const to = pos + node.nodeSize;

            tr.removeMark(from, to, textStyleType);
            if (Object.keys(sparse).length > 0) {
              tr.addMark(from, to, textStyleType.create(sparse));
            }
            modified = true;
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

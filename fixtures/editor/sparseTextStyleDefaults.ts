import { Extension } from "@tiptap/core";

/**
 * Override full textStyle kit attrs so unset fields use `undefined` instead of
 * `null`. y-prosemirror then omits them from Yjs (`textStyle: { fontFamily }`
 * only), matching the FontFamily-only control shape.
 *
 * Register after FontFamily / FontSize / Color / BackgroundColor.
 */
export const SparseTextStyleDefaults = Extension.create({
  name: "sparseTextStyleDefaults",

  addGlobalAttributes() {
    return [
      {
        types: ["textStyle"],
        attributes: {
          fontFamily: { default: undefined },
          fontSize: { default: undefined },
          color: { default: undefined },
          backgroundColor: { default: undefined },
        },
      },
    ];
  },
});

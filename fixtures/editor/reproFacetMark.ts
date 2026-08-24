import { Mark, mergeAttributes } from "@tiptap/core";

/**
 * Novel mark with a multi-field attr object shaped like `textStyle` (fontFamily,
 * fontSize, color, backgroundColor) but a distinct mark name and Y attribute.
 *
 * Unset attrs default to `undefined` so y-prosemirror omits them from Yjs.
 */
export const ReproFacet = Mark.create({
  name: "reproFacet",

  priority: 101,

  addAttributes() {
    return {
      fontFamily: {
        default: undefined,
        parseHTML: (element) => element.style.fontFamily?.replace(/['"]+/g, ""),
        renderHTML: (attributes) => {
          if (!attributes.fontFamily) {
            return {};
          }

          return { style: `font-family: ${attributes.fontFamily}` };
        },
      },
      fontSize: {
        default: undefined,
        parseHTML: (element) => element.style.fontSize,
        renderHTML: (attributes) => {
          if (!attributes.fontSize) {
            return {};
          }

          return { style: `font-size: ${attributes.fontSize}` };
        },
      },
      color: {
        default: undefined,
        parseHTML: (element) => element.style.color,
        renderHTML: (attributes) => {
          if (!attributes.color) {
            return {};
          }

          return { style: `color: ${attributes.color}` };
        },
      },
      backgroundColor: {
        default: undefined,
        parseHTML: (element) => element.style.backgroundColor,
        renderHTML: (attributes) => {
          if (!attributes.backgroundColor) {
            return {};
          }

          return { style: `background-color: ${attributes.backgroundColor}` };
        },
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: "span",
        getAttrs: (element) => element.hasAttribute("data-repro-facet"),
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "span",
      mergeAttributes({ "data-repro-facet": "" }, HTMLAttributes),
      0,
    ];
  },
});

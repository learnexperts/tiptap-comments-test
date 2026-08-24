import { Mark, mergeAttributes } from "@tiptap/core";

/**
 * Novel inline mark for overlap experiments — not part of TipTap's textStyle kit.
 * Single string attr so we can see whether the collab server blocks unknown marks
 * on read-only comment sync the same way it blocks `textStyle`.
 */
export const ReproGlint = Mark.create({
  name: "reproGlint",

  addAttributes() {
    return {
      tint: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-repro-glint-tint"),
        renderHTML: (attributes) => {
          if (!attributes.tint) {
            return {};
          }

          return { "data-repro-glint-tint": attributes.tint };
        },
      },
    };
  },

  parseHTML() {
    return [{ tag: "span[data-repro-glint-tint]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["span", mergeAttributes(HTMLAttributes), 0];
  },
});

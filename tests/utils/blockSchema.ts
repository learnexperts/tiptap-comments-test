import { Extension, type Extensions, Node } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { BlockThread, InlineThread } from "@tiptap-pro/extension-comments";

// Blocks with several attributes, some with non-null defaults, shaped like a
// production course editor's: the block-anchor matrix's schema.

const CALLOUT_CONTENT = "calloutContent";

const Paragraph = Node.create({
  name: "paragraph",
  priority: 1000,
  group: `block ${CALLOUT_CONTENT}`,
  content: "inline*",
  parseHTML: () => [{ tag: "p" }],
  renderHTML: () => ["p", 0],
});

const CodeBlock = Node.create({
  name: "codeBlock",
  group: `block ${CALLOUT_CONTENT}`,
  content: "text*",
  marks: "",
  code: true,
  defining: true,
  addAttributes: () => ({
    language: { default: null },
    theme: { default: "dark" },
  }),
  parseHTML: () => [{ tag: "pre" }],
  renderHTML: () => ["pre", ["code", 0]],
});

const Callout = Node.create({
  name: "callout",
  group: "block",
  content: `${CALLOUT_CONTENT}+`,
  defining: true,
  parseHTML: () => [{ tag: "div[data-callout]" }],
  renderHTML: () => ["div", { "data-callout": "" }, 0],
});

const BlockAttributes = Extension.create({
  name: "blockAttributes",
  addGlobalAttributes: () => [
    {
      types: ["paragraph"],
      attributes: {
        textAlign: { default: null },
        lineHeight: { default: null },
        marginLeft: { default: 0 },
      },
    },
  ],
});

/** The block nodes, replacing StarterKit's paragraph and code block. */
export const blockNodes: Extensions = [
  StarterKit.configure({
    undoRedo: false,
    trailingNode: false,
    paragraph: false,
    codeBlock: false,
  }),
  Paragraph,
  CodeBlock,
  Callout,
  BlockAttributes,
];

/** The comment anchors, with the block anchor allowed inside a callout. */
export const blockAnchors: Extensions = [
  BlockThread.extend({ group: `block ${CALLOUT_CONTENT}` }),
  InlineThread,
];

import type { NodePos } from "@tiptap/core";
import type { Node } from "@tiptap/pm/model";
import { NodeSelection, TextSelection } from "@tiptap/pm/state";

export { NodeSelection, Selection, TextSelection } from "@tiptap/pm/state";

/**
 * The document range a `NodePos` covers.
 *
 * `NodePos.from`/`.to` cannot be used for this: they are depth-based
 * (`resolvedPos.start(depth)`/`end(depth)`), so every inline sibling in a
 * paragraph reports the *paragraph's* content range rather than its own.
 *
 * `NodePos.pos` is derived in `NodePos.children` as
 * `parent.pos + offset + (isNonTextAtom ? 0 : 1)`, so for everything but a
 * non-text atom it lands one past where the node actually opens.
 */
export function nodeRange(nodePos: NodePos): { from: number; to: number } {
  const { node } = nodePos;
  const isNonTextAtom = node.isAtom && !node.isText;
  const from = isNonTextAtom ? nodePos.pos : nodePos.pos - 1;

  return { from, to: from + node.nodeSize };
}

/** Selects the whole of `nodePos`'s text. */
export function asTextSelection(doc: Node, nodePos: NodePos): TextSelection {
  const { from, to } = nodeRange(nodePos);
  return TextSelection.create(doc, from, to);
}

/** Selects `nodePos` as a node. Text nodes cannot be node-selected. */
export function asNodeSelection(doc: Node, nodePos: NodePos): NodeSelection {
  if (!NodeSelection.isSelectable(nodePos.node)) {
    throw new Error(
      `Cannot node-select a ${nodePos.node.type.name} node; it is not selectable`,
    );
  }

  return NodeSelection.create(doc, nodeRange(nodePos).from);
}

/**
 * Selects a slice of `nodePos`'s text, by character offsets relative to its
 * start. Offsets may fall outside the node to reach into its siblings.
 */
export function sliceSelection(
  doc: Node,
  nodePos: NodePos,
  from: number,
  to: number,
): TextSelection {
  const start = nodeRange(nodePos).from;
  return TextSelection.create(doc, start + from, start + to);
}

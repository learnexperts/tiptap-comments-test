import type { NodePos } from "@tiptap/core";
import type { Node } from "@tiptap/pm/model";
import { type NodeMatcherConfig, nodeMatcher } from "./nodeMatcher";

type Predicate = (node: Node) => boolean;

/**
 * Finds the first descendant of `root` matching the predicate, in document
 * order. Pass `editor.$doc` to search a whole document.
 */
export function query(
  root: NodePos,
  predicate: Predicate | NodeMatcherConfig,
): NodePos | null {
  return queryAll(root, predicate).next().value;
}

/**
 * Yields every descendant of `root` matching the predicate, depth first.
 *
 * Note that `NodePos.from`/`.to` are depth-based, so inline siblings all report
 * their parent textblock's range. Use `lib/selection` to turn a match into a
 * selection rather than reading those properties directly.
 */
export function* queryAll(
  root: NodePos,
  predicate: Predicate | NodeMatcherConfig,
): Generator<NodePos, null, undefined> {
  const matches =
    typeof predicate === "function" ? predicate : nodeMatcher(predicate);

  for (const child of root.children) {
    if (matches(child.node)) {
      yield child;
    }

    yield* queryAll(child, matches);
  }

  return null;
}

/** `query`, but throws instead of returning `null`. */
export function queryOrFail(
  root: NodePos,
  predicate: Predicate | NodeMatcherConfig,
  message = "Node not found",
): NodePos {
  const match = query(root, predicate);

  if (!match) {
    throw new Error(message);
  }

  return match;
}

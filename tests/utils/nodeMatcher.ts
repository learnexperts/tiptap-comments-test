import type { Node } from "@tiptap/pm/model";

type Predicate = (node: Node) => boolean;

export interface NodeMatcherConfig {
  nodeType?: string;
  attributes?: Record<string, unknown>;
  text?: string | RegExp;
}

export function nodeMatcher(config: NodeMatcherConfig): Predicate {
  const predicates = [
    config.nodeType && matchNodeType(config.nodeType),
    config.attributes && matchAttributes(config.attributes),
    config.text && matchText(config.text),
  ].filter((predicate): predicate is Predicate => !!predicate);

  if (predicates.length === 0) {
    return () => true;
  }

  return (node) => {
    return predicates.every((predicate) => predicate(node));
  };
}

export function matchNodeType(nodeType: string): Predicate {
  return (node) => node.type.name === nodeType;
}

export function matchAttributes(
  attributes: Record<string, unknown>,
): Predicate {
  return (node) =>
    Object.entries(attributes).every(
      ([key, value]) => node.attrs[key] === value,
    );
}

export function matchText(text: string | RegExp): Predicate {
  return (node) =>
    typeof text === "string"
      ? node.textContent === text
      : text.test(node.textContent);
}

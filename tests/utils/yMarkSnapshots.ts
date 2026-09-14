import * as Y from "yjs";

/** A flat view of the text runs in a Yjs document, with their mark attrs. */
export interface YTextSegment {
  text: string;
  attributes: Record<string, unknown>;
}

export function yTextSegments(ydoc: Y.Doc, field = "default"): YTextSegment[] {
  const segments: YTextSegment[] = [];
  const stack: Array<Y.XmlFragment | Y.XmlElement> = [
    ydoc.getXmlFragment(field),
  ];

  for (let node = stack.pop(); node; node = stack.pop()) {
    for (const child of node.toArray()) {
      if (child instanceof Y.XmlText) {
        for (const op of child.toDelta()) {
          if (typeof op.insert !== "string" || op.insert.length === 0) {
            continue;
          }

          segments.push({
            text: op.insert,
            attributes: (op.attributes ?? {}) as Record<string, unknown>,
          });
        }
        continue;
      }

      if (child instanceof Y.XmlElement) {
        stack.push(child);
      }
    }
  }

  return segments;
}

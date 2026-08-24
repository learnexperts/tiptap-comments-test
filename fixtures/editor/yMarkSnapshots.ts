import type { Editor } from "@tiptap/core";
import * as Y from "yjs";

export interface YTextSegment {
  text: string;
  attributes: Record<string, unknown>;
}

export function yDocFromEditor(editor: Editor): Y.Doc {
  const collaboration = editor.extensionManager.extensions.find(
    (extension) => extension.name === "collaboration"
  );
  const document = collaboration?.options.document;

  if (!(document instanceof Y.Doc)) {
    throw new Error("Editor has no Collaboration Y.Doc");
  }

  return document;
}

export function yTextSegments(
  ydoc: Y.Doc,
  field = "default"
): YTextSegment[] {
  const segments: YTextSegment[] = [];
  const stack: Array<Y.XmlFragment | Y.XmlElement> = [ydoc.getXmlFragment(field)];

  while (stack.length > 0) {
    const node = stack.pop()!;

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

export function findMarkAttributeKey(
  segments: YTextSegment[],
  markPrefix: string
): string | undefined {
  for (const segment of segments) {
    for (const key of Object.keys(segment.attributes)) {
      if (key === markPrefix || key.startsWith(`${markPrefix}-`)) {
        return key;
      }
    }
  }

  return undefined;
}

export function markAttributeValues(
  segments: YTextSegment[],
  markPrefix: string
): Array<{ text: string; value: unknown }> {
  const key = findMarkAttributeKey(segments, markPrefix);
  if (!key) {
    return [];
  }

  return segments
    .filter((segment) => segment.attributes[key] !== undefined)
    .map((segment) => ({
      text: segment.text,
      value: segment.attributes[key],
    }));
}

/** Segments with comment/thread keys removed — compare styling attrs only. */
export function segmentsWithoutCommentMarks(
  segments: YTextSegment[]
): YTextSegment[] {
  return segments.map((segment) => ({
    text: segment.text,
    attributes: Object.fromEntries(
      Object.entries(segment.attributes).filter(
        ([key]) =>
          !key.startsWith("inlineThread") && !key.startsWith("blockThread")
      )
    ),
  }));
}

export function stableStringify(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortValue);
  }

  if (typeof value !== "object" || value === null) {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => [key, sortValue(nested)])
  );
}

export function reproFacetValuesEqual(
  before: YTextSegment[],
  after: YTextSegment[]
): boolean {
  return (
    stableStringify(markAttributeValues(before, "reproFacet")) ===
    stableStringify(markAttributeValues(after, "reproFacet"))
  );
}

export function textStyleValuesEqual(
  before: YTextSegment[],
  after: YTextSegment[]
): boolean {
  return (
    stableStringify(markAttributeValues(before, "textStyle")) ===
    stableStringify(markAttributeValues(after, "textStyle"))
  );
}

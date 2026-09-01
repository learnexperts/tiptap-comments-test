import type { JSONContent } from "@tiptap/core";

type JSONMark = NonNullable<JSONContent["marks"]>[number];

export function text(text: string, marks: JSONMark[] = []): JSONContent {
  return { type: "text", text, marks };
}

export function paragraph(
  content: JSONContent["content"],
  attrs?: JSONContent["attrs"],
): JSONContent {
  return {
    type: "paragraph",
    content,
    attrs,
  };
}

export function embeddedInParagraph(content: JSONContent): JSONContent {
  return paragraph([text("[before] "), content, text(" [after]")]);
}

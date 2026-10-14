import type { ChainedCommands, Editor } from "@tiptap/core";
import * as Y from "yjs";

/**
 * Issue 4's paragraph and the ways an author styles it. Shared by the offline
 * mechanism file and the server file in `tests/overlap/`, so both describe
 * the same documents.
 */

export const TEXT = "[before] [one][two][three] [after]";

interface Style {
  label: string;
  apply: (chain: ChainedCommands) => ChainedCommands;
}

const COLOR: Style = {
  label: "color",
  apply: (chain) => chain.setColor("#206487"),
};
const FONT_SIZE: Style = {
  label: "font size",
  apply: (chain) => chain.setFontSize("10px"),
};
const BACKGROUND: Style = {
  label: "background",
  apply: (chain) => chain.setBackgroundColor("#C6E7FF"),
};

export interface Styling {
  label: string;
  /** Each style, applied in order through the editor to the text it names. */
  steps: Array<[Style, string]>;
}

function overlapping(first: Style, second: Style): Styling[] {
  return [
    {
      label: `${first.label}, then ${second.label} over its end`,
      steps: [
        [first, "[one][two]"],
        [second, "[two][three]"],
      ],
    },
    {
      label: `${first.label}, then ${second.label} over its start`,
      steps: [
        [first, "[two][three]"],
        [second, "[one][two]"],
      ],
    },
  ];
}

/** Two style ranges that overlap: the cases that leave a dead marker. */
export const OVERLAPPING: Styling[] = [
  ...overlapping(COLOR, FONT_SIZE),
  ...overlapping(COLOR, BACKGROUND),
];

/** Controls: no two ranges meet with different non-null styles. */
export const NOT_OVERLAPPING: Styling[] = [
  { label: "color alone", steps: [[COLOR, "[one][two][three]"]] },
  {
    label: "color, then font size inside it",
    steps: [
      [COLOR, "[one][two][three]"],
      [FONT_SIZE, "[two]"],
    ],
  },
];

/** The `[from, to)` editor positions of `part` in the one-paragraph document. */
export function rangeOf(editor: Editor, part: string): [number, number] {
  const index = editor.state.doc.textContent.indexOf(part);
  if (index < 0) {
    throw new Error(`No ${part} in the document`);
  }
  // The paragraph's text starts at position 1.
  return [1 + index, 1 + index + part.length];
}

export function applyStyling(editor: Editor, styling: Styling): void {
  for (const [style, part] of styling.steps) {
    const [from, to] = rangeOf(editor, part);
    const applied = style
      .apply(editor.chain().setTextSelection({ from, to }))
      .run();
    if (!applied) {
      throw new Error(`Could not apply ${style.label} to ${part}`);
    }
  }
}

/** The text of the first paragraph in `fragment`. */
export function paragraphText(fragment: Y.XmlFragment): Y.XmlText {
  const paragraph = fragment.get(0) as Y.XmlElement;
  return paragraph.get(0) as Y.XmlText;
}

/**
 * Every live format marker in `text`, with the offset it starts at:
 * `@14 textStyle {color, fontSize}`. Only attributes with a value are listed.
 * Several markers at one offset are listed in stored order; the last wins.
 */
export function formatMarkers(text: Y.XmlText): string[] {
  const markers: string[] = [];
  let offset = 0;
  for (let item = text._start; item; item = item.right) {
    if (item.deleted) {
      continue;
    }
    if (item.content instanceof Y.ContentFormat) {
      const { key, value } = item.content;
      markers.push(`@${offset} ${markName(key)} ${describe(value)}`);
    } else if (item.countable) {
      offset += item.length;
    }
  }
  return markers;
}

/**
 * The keys of the format markers `transaction` added to or deleted from
 * `text`, as `+textStyle` and `-textStyle`. A marker added and deleted in the
 * same transaction is left out.
 */
export function formatMarkersTouched(
  text: Y.XmlText,
  transaction: Y.Transaction,
): string[] {
  const touched = new Set<string>();
  for (let item = text._start; item; item = item.right) {
    if (!(item.content instanceof Y.ContentFormat)) {
      continue;
    }
    const added =
      item.id.clock >= (transaction.beforeState.get(item.id.client) ?? 0);
    const deleted = Y.isDeleted(transaction.deleteSet, item.id);
    if (added !== deleted) {
      touched.add(`${added ? "+" : "-"}${markName(item.content.key)}`);
    }
  }
  return [...touched].sort();
}

/** `inlineThread--a1b2c3d4` → `inlineThread`: overlapping marks carry a hash. */
function markName(key: string): string {
  return key.replace(/--[a-zA-Z0-9+/=]{8}$/, "");
}

function describe(value: unknown): string {
  if (typeof value !== "object" || value === null) {
    return String(value);
  }
  const set = Object.entries(value)
    .filter(([, attribute]) => attribute !== null)
    .map(([name]) => name);
  return `{${set.join(", ")}}`;
}

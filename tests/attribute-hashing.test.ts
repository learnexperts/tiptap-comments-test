import { Editor, Mark, getSchema, type Extensions, type JSONContent } from "@tiptap/core";
import Collaboration from "@tiptap/extension-collaboration";
import StarterKit from "@tiptap/starter-kit";
import { prosemirrorJSONToYDoc } from "@tiptap/y-tiptap";
import type * as Y from "yjs";
import { afterEach, describe, expect, test } from "vitest";
import { yTextSegments } from "./utils/yMarkSnapshots";

/**
 * The root cause, with no collab server involved.
 *
 * y-prosemirror keys *overlapping* marks — marks that may cover the same text
 * more than once, as comment threads do — by a hash of the mark's JSON:
 *
 *   pattrs[isOverlapping
 *     ? `${mark.type.name}--${hashOfJSON(mark.toJSON())}`
 *     : mark.type.name] = mark.attrs
 *
 * `hashOfJSON` serialises with lib0's `encodeAny`, which walks object keys in
 * insertion order, so the hash follows the *shape* of the attribute value
 * rather than its meaning. Any mark with a structured attribute value is
 * affected: add, remove or reorder a field — even incidentally, because two
 * clients registered slightly different schemas — and the Yjs key changes.
 *
 * The last two tests assert the behaviour we expect and currently fail. They
 * are the report: they turn green when the defect is fixed, and their failure
 * output names the two keys that ought to have matched.
 *
 * Note that y-prosemirror already has a comparison that would resolve this. Its
 * own `equalAttrs` skips `null`-valued keys and recurses into objects, so by
 * y-prosemirror's own definition of attribute equality the two marks below are
 * equal — they simply are not compared that way when the key is built.
 */

const FIELD = "default";

const starterKit = StarterKit.configure({
  undoRedo: false,
  trailingNode: false,
});

/** Overlapping, like `inlineThread`: excludes nothing, so it may repeat. */
function overlappingMark(attributes: Record<string, unknown>) {
  return Mark.create({
    name: "marker",
    excludes: "",
    addAttributes: () => attributes,
    parseHTML: () => [{ tag: "span[data-marker]" }],
    renderHTML: () => ["span", { "data-marker": "" }, 0],
  });
}

/** The control: excludes itself, so only one may apply at a time. */
const exclusiveMark = Mark.create({
  name: "solo",
  excludes: "solo",
  addAttributes: () => ({ id: { default: null } }),
  parseHTML: () => [{ tag: "span[data-solo]" }],
  renderHTML: () => ["span", { "data-solo": "" }, 0],
});

/** Two clients whose schemas differ only by one optional attribute. */
const narrowClient: Extensions = [starterKit, overlappingMark({ id: { default: null } })];
const wideClient: Extensions = [
  starterKit,
  overlappingMark({ id: { default: null }, note: { default: null } }),
];

const MARKED = "marked";

function seedContent(markName: string): JSONContent {
  return {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [
          { type: "text", text: MARKED, marks: [{ type: markName, attrs: { id: "m1" } }] },
          { type: "text", text: " and some text far away" },
        ],
      },
    ],
  };
}

const teardown: Array<() => void> = [];

afterEach(() => {
  while (teardown.length) teardown.pop()?.();
});

/** The Yjs attribute keys on the marked run. */
function markKeys(ydoc: Y.Doc): string[] {
  const segment = yTextSegments(ydoc).find((s) => String(s.text).includes(MARKED));
  return Object.keys(segment?.attributes ?? {});
}

function seedAs(client: Extensions, markName = "marker") {
  return prosemirrorJSONToYDoc(getSchema(client), seedContent(markName), FIELD);
}

function attach(client: Extensions, ydoc: Y.Doc) {
  const element = document.createElement("div");
  document.body.appendChild(element);

  const editor = new Editor({
    element,
    extensions: [...client, Collaboration.configure({ document: ydoc, field: FIELD })],
  });

  teardown.push(() => {
    editor.destroy();
    element.remove();
  });

  return editor;
}

describe("y-prosemirror keys overlapping marks by a hash of their JSON", () => {
  test("an exclusive mark is keyed by its name alone", () => {
    const ydoc = seedAs([starterKit, exclusiveMark], "solo");

    expect(markKeys(ydoc)).toEqual(["solo"]);
  });

  test("an overlapping mark is keyed by its name plus a hash", () => {
    expect(markKeys(seedAs(narrowClient))[0]).toMatch(/^marker--.{8}$/);
  });

  test("an unset attribute does not change the key of the same mark", () => {
    const [narrowKey] = markKeys(seedAs(narrowClient));
    const [wideKey] = markKeys(seedAs(wideClient));

    // Same mark, same id, same text. The schemas differ only in that the wide
    // client declares a `note` attribute and leaves it unset, which
    // `equalAttrs` would treat as absent.
    expect(
      wideKey,
      "two clients whose schemas differ by one unset attribute should agree on the key",
    ).toBe(narrowKey);
  });

  test("an unrelated edit leaves the mark untouched", () => {
    const ydoc = seedAs(narrowClient);
    const [originalKey] = markKeys(ydoc);

    const editor = attach(wideClient, ydoc);
    expect(markKeys(ydoc), "attaching alone must not rewrite anything").toEqual([
      originalKey,
    ]);

    // Type a character at the very end of the paragraph, nowhere near the
    // marked run and touching none of its attributes.
    editor
      .chain()
      .focus()
      .setTextSelection(editor.state.doc.content.size - 1)
      .insertContent("!")
      .run();

    expect(
      markKeys(ydoc)[0],
      "editing elsewhere must not rewrite a mark the edit never touched",
    ).toBe(originalKey);
  });
});

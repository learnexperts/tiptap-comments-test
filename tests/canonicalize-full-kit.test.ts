import {
  CommentsKit,
  threadExistsInDocument,
} from "@tiptap-pro/extension-comments";
import { TiptapCollabProvider } from "@tiptap-pro/provider";
import {
  NodePos,
  Range,
  type Command,
  type Editor,
  type EditorEvents,
  type JSONContent,
} from "@tiptap/core";
import Collaboration from "@tiptap/extension-collaboration";
import { TextStyle } from "@tiptap/extension-text-style";
import { BackgroundColor } from "@tiptap/extension-text-style/background-color";
import { Color } from "@tiptap/extension-text-style/color";
import { FontFamily } from "@tiptap/extension-text-style/font-family";
import { FontSize } from "@tiptap/extension-text-style/font-size";
import StarterKit from "@tiptap/starter-kit";
import { assert, vi } from "vitest";
import { describe, expect, test } from "~/fixtures";
import { CanonicalizeTextStyleAttrs } from "~/fixtures/editor";
import {
  markAttributeValues,
  textStyleValuesEqual,
  yDocFromEditor,
  yTextSegments,
} from "~/fixtures/editor/yMarkSnapshots";

/**
 * Comment-only sync with the full textStyle kit + CanonicalizeTextStyleAttrs.
 * Matrix of attr shapes (single / multi) × selection (exact / overlap).
 */
type SelectionKind = "exact" | "overlap";

interface CanonicalizeCase {
  label: string;
  attrs: Record<string, string>;
  /** Expected PM / Y attr bag after create (sorted, sparse). */
  expectedAttrs: Record<string, string>;
  withBold?: boolean;
  selection: SelectionKind;
}

const starterKit = StarterKit.configure({
  undoRedo: false,
  trailingNode: false,
});

const fullKitCanonicalizeExtensions = ({
  syncedProvider,
}: {
  syncedProvider: TiptapCollabProvider;
}) => [
  starterKit,
  TextStyle,
  FontFamily,
  FontSize,
  Color,
  BackgroundColor,
  //SparseTextStyleDefaults,
  CanonicalizeTextStyleAttrs,
  Collaboration.configure({
    provider: syncedProvider,
    document: syncedProvider.document,
  }),
  CommentsKit.configure({
    provider: syncedProvider,
    deleteUnreferencedThreads: false,
    useLegacyWrapping: false,
  }),
];

function styledSeed(
  attrs: Record<string, string | null>,
  options: { withBold?: boolean } = {}
): JSONContent {
  const marks: JSONContent["marks"] = [
    { type: "textStyle", attrs },
    ...(options.withBold ? [{ type: "bold" as const }] : []),
  ];

  return {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [
          { type: "text", text: "Before " },
          {
            type: "text",
            text: options.withBold ? "bold styled" : "styled",
            marks,
          },
          { type: "text", text: " after" },
        ],
      },
    ],
  };
}

/** Production-like densified bag: one real style + null kit siblings. */
const densifiedFontFamilyAttrs = {
  fontFamily: "Arial",
  color: null,
  fontSize: null,
  backgroundColor: null,
} as const;

const densifiedExpectedAttrs = { fontFamily: "Arial" };

function textStyleAttrsOnDoc(
  editor: Editor
): Record<string, unknown> | undefined {
  let found: Record<string, unknown> | undefined;
  editor.state.doc.descendants((node) => {
    if (!node.isText || found) {
      return;
    }
    const mark = node.marks.find((m) => m.type.name === "textStyle");
    if (mark) {
      found = { ...(mark.attrs as Record<string, unknown>) };
    }
  });
  return found;
}

const selectExact: Command = ({ editor, commands }) => {
  const nodePos = findNodeOrFail(
    editor.$doc,
    (node) =>
      node.type.name === "text" &&
      node.marks.some((mark) => mark.type.name === "textStyle")
  );
  return commands.setTextSelection(getTextRange(nodePos));
};

const selectOverlap: Command = ({ editor, commands }) => {
  const before = findNodeOrFail(
    editor.$doc,
    (node) => node.type.name === "text" && node.text === "Before "
  );
  const after = findNodeOrFail(
    editor.$doc,
    (node) => node.type.name === "text" && node.text === " after"
  );
  const from = getTextRange(before);
  const to = getTextRange(after);

  return commands.setTextSelection({
    from: from.from + 1,
    to: to.to - 1,
  });
};

const cases: CanonicalizeCase[] = [
  {
    label: "fontFamily only",
    attrs: { fontFamily: "Arial" },
    expectedAttrs: { fontFamily: "Arial" },
    selection: "exact",
  },
  {
    label: "fontFamily only",
    attrs: { fontFamily: "Arial" },
    expectedAttrs: { fontFamily: "Arial" },
    selection: "overlap",
  },
  {
    label: "fontSize only",
    attrs: { fontSize: "36px" },
    expectedAttrs: { fontSize: "36px" },
    selection: "exact",
  },
  {
    label: "fontSize only",
    attrs: { fontSize: "36px" },
    expectedAttrs: { fontSize: "36px" },
    selection: "overlap",
  },
  {
    label: "color only",
    attrs: { color: "#6E1F1F" },
    expectedAttrs: { color: "#6E1F1F" },
    selection: "exact",
  },
  {
    label: "color only",
    attrs: { color: "#6E1F1F" },
    expectedAttrs: { color: "#6E1F1F" },
    selection: "overlap",
  },
  {
    label: "backgroundColor only",
    attrs: { backgroundColor: "#E73E3E" },
    expectedAttrs: { backgroundColor: "#E73E3E" },
    selection: "exact",
  },
  {
    label: "backgroundColor only",
    attrs: { backgroundColor: "#E73E3E" },
    expectedAttrs: { backgroundColor: "#E73E3E" },
    selection: "overlap",
  },
  {
    label: "fontFamily + fontSize",
    attrs: { fontFamily: "Georgia", fontSize: "18px" },
    expectedAttrs: { fontFamily: "Georgia", fontSize: "18px" },
    selection: "exact",
  },
  {
    label: "fontFamily + fontSize",
    attrs: { fontFamily: "Georgia", fontSize: "18px" },
    expectedAttrs: { fontFamily: "Georgia", fontSize: "18px" },
    selection: "overlap",
  },
  {
    label: "color + backgroundColor",
    attrs: { color: "#111111", backgroundColor: "#FFEEAA" },
    expectedAttrs: { backgroundColor: "#FFEEAA", color: "#111111" },
    selection: "exact",
  },
  {
    label: "color + backgroundColor",
    attrs: { color: "#111111", backgroundColor: "#FFEEAA" },
    expectedAttrs: { backgroundColor: "#FFEEAA", color: "#111111" },
    selection: "overlap",
  },
  {
    label: "all four attrs",
    attrs: {
      fontFamily: "Arial",
      fontSize: "24px",
      color: "#003366",
      backgroundColor: "#E0F0FF",
    },
    expectedAttrs: {
      backgroundColor: "#E0F0FF",
      color: "#003366",
      fontFamily: "Arial",
      fontSize: "24px",
    },
    selection: "exact",
  },
  {
    label: "all four attrs",
    attrs: {
      fontFamily: "Arial",
      fontSize: "24px",
      color: "#003366",
      backgroundColor: "#E0F0FF",
    },
    expectedAttrs: {
      backgroundColor: "#E0F0FF",
      color: "#003366",
      fontFamily: "Arial",
      fontSize: "24px",
    },
    selection: "overlap",
  },
  {
    label: "bold + fontFamily",
    attrs: { fontFamily: "Arial" },
    expectedAttrs: { fontFamily: "Arial" },
    withBold: true,
    selection: "exact",
  },
  {
    label: "bold + fontFamily",
    attrs: { fontFamily: "Arial" },
    expectedAttrs: { fontFamily: "Arial" },
    withBold: true,
    selection: "overlap",
  },
  {
    label: "bold + all four attrs",
    attrs: {
      fontFamily: "Helvetica",
      fontSize: "14px",
      color: "#222222",
      backgroundColor: "#FFFFCC",
    },
    expectedAttrs: {
      backgroundColor: "#FFFFCC",
      color: "#222222",
      fontFamily: "Helvetica",
      fontSize: "14px",
    },
    withBold: true,
    selection: "exact",
  },
  {
    label: "bold + all four attrs",
    attrs: {
      fontFamily: "Helvetica",
      fontSize: "14px",
      color: "#222222",
      backgroundColor: "#FFFFCC",
    },
    expectedAttrs: {
      backgroundColor: "#FFFFCC",
      color: "#222222",
      fontFamily: "Helvetica",
      fontSize: "14px",
    },
    withBold: true,
    selection: "overlap",
  },
];

describe("canonicalizeTextStyleAttrs + full kit", () => {
  describe("comment-only user", () => {
    describe.for(cases)(
      "$selection selection: $label",
      ({ label, attrs, expectedAttrs, withBold, selection }) => {
        const seedContent = styledSeed(attrs, { withBold });
        const selectContent =
          selection === "exact" ? selectExact : selectOverlap;

        test.override("seedContent", seedContent);
        test.override("extensions", fullKitCanonicalizeExtensions);

        test.skip("keeps PM textStyle attrs sparse after bind", ({
          editor,
        }) => {
          const pmAttrs = textStyleAttrsOnDoc(editor);
          expect(pmAttrs, `PM attrs for ${label}`).toEqual(expectedAttrs);
          expect(Object.keys(pmAttrs ?? {})).toEqual(
            Object.keys(expectedAttrs)
          );
        });

        test("creates the thread locally", async ({ editor }) => {
          const { threadId } = await createThreadAtSelection(
            editor,
            selectContent
          );
          await expectThreadExistsInDocument(editor, threadId);
        });

        test("keeps thread anchor after sync", async ({
          editor,
          provider,
          annotate,
        }) => {
          const ydoc = yDocFromEditor(editor);
          const before = yTextSegments(ydoc);

          const { threadId } = await createThreadAtSelection(
            editor,
            selectContent
          );

          await flushChanges(provider);

          await expectThreadExistsInDocument(editor, threadId);
        });
      }
    );

    /**
     * Existing docs often store densified null kit fields in Y. Seed JSON with
     * explicit nulls to simulate that; canonicalize should sparsify PM on bind.
     */
    describe.for<{ selection: SelectionKind }>([
      { selection: "exact" },
      { selection: "overlap" },
    ])(
      "$selection selection on densified Y seed [fontFamily + null kit fields]",
      ({ selection }) => {
        const seedContent = styledSeed({ ...densifiedFontFamilyAttrs });
        const selectContent =
          selection === "exact" ? selectExact : selectOverlap;

        test.override("seedContent", seedContent);
        test.override("extensions", fullKitCanonicalizeExtensions);

        test("creates the thread locally", async ({ editor }) => {
          const { threadId } = await createThreadAtSelection(
            editor,
            selectContent
          );
          await expectThreadExistsInDocument(editor, threadId);
        });

        test("loses thread anchor after sync (densified Y still rewritten)", async ({
          editor,
          provider,
          annotate,
        }) => {
          const ydoc = yDocFromEditor(editor);
          const before = yTextSegments(ydoc);
          const yStyleBefore = markAttributeValues(before, "textStyle");

          const { threadId } = await createThreadAtSelection(
            editor,
            selectContent
          );

          expect(
            threadExistsInDocument(editor, threadId),
            "Thread should exist locally before sync"
          ).toBeTruthy();

          const afterLocal = yTextSegments(ydoc);
          const yStyleAfterLocal = markAttributeValues(afterLocal, "textStyle");

          await flushChanges(provider);
          const after = editor.getJSON();
          const yStyleAfterSync = markAttributeValues(
            yTextSegments(ydoc),
            "textStyle"
          );

          await annotate(`densified Y seed after sync: ${selection}`, {
            body: JSON.stringify(
              {
                yStyleBefore,
                yStyleAfterLocal,
                yStyleAfterSync,
                textStyleValuesEqual: textStyleValuesEqual(before, afterLocal),
                after,
                pmAttrs: textStyleAttrsOnDoc(editor),
              },
              null,
              2
            ),
            contentType: "application/json",
          });

          // Existing densified Y still causes comment-only sync to drop the
          // anchor: setThread rewrites sparse mark.attrs back to Y, which the
          // server treats as a disallowed textStyle touch.
          expect(
            threadExistsInDocument(editor, threadId),
            "Densified Y seed: thread anchor is lost after comment-only sync"
          ).toBe(true);
        });
      }
    );
  });
});

const createThreadAtSelection = vi.defineHelper(
  async function createThreadAtSelection(
    editor: Editor,
    selectContent: Command
  ) {
    const pending = new Promise<EditorEvents["comments:threadCreated"]>(
      (resolve) => editor.once("comments:threadCreated", resolve)
    );

    assert.isOk(
      editor
        .chain()
        .focus()
        .command(selectContent)
        .setMeta("debug", "test-thread-creation")
        .setThread({
          content: "[test-content]",
        })
        .run(),
      "Failed to create thread at selection"
    );

    return pending;
  }
);

const expectThreadExistsInDocument = vi.defineHelper(
  async function expectThreadExistsInDocument(
    editor: Editor,
    threadId: string
  ) {
    return expect(
      threadExistsInDocument(editor, threadId),
      `Thread ${threadId} does not exist in document`
    ).toBeTruthy();
  }
);

const flushChanges = vi.defineHelper(async function flushChanges(
  provider: TiptapCollabProvider
) {
  provider.startSync();

  await vi.waitUntil(() => !provider.hasUnsyncedChanges, {
    timeout: 10_000,
  });
});

function findNode(
  root: NodePos,
  predicate: (node: NodePos["node"], nodePos: NodePos) => boolean
): NodePos | null {
  for (const nodePos of walkNodes(root)) {
    if (predicate(nodePos.node, nodePos)) {
      return nodePos;
    }
  }

  return null;
}

function findNodeOrFail(
  root: NodePos,
  predicate: (node: NodePos["node"], nodePos: NodePos) => boolean
): NodePos {
  const node = findNode(root, predicate);
  if (!node) {
    throw new Error("Node not found");
  }
  return node;
}

function* walkNodes(root: NodePos): Generator<NodePos> {
  if (!root.children || root.children.length === 0) {
    return;
  }

  for (const child of root.children) {
    yield child;
    yield* walkNodes(child);
  }
}

function getTextRange(nodePos: NodePos): Range {
  return {
    from: nodePos.pos - 1,
    to: nodePos.pos + nodePos.size - 1,
  };
}

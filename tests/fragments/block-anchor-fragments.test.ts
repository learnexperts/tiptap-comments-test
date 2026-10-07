import { randomUUID } from "node:crypto";
import { Editor } from "@tiptap/core";
import { threadExistsInDocument } from "@tiptap-pro/extension-comments";
import {
  TiptapCollabProvider,
  TiptapCollabProviderWebsocket,
} from "@tiptap-pro/provider";
import Websocket from "ws";
import * as Y from "yjs";
import { describe, expect, test } from "../fixtures";
import { createToken } from "../utils/createToken";
import { paragraph, text } from "../utils/document";
import {
  type Binding,
  rootDefault,
  stockExtensionsFor,
  textSchema,
} from "../utils/extensionSets";
import { waitUntilFlushed } from "../utils/flushChanges";
import { queryOrFail } from "../utils/query";
import {
  asNodeSelection,
  nodeRange,
  type Selection,
  TextSelection,
} from "../utils/selection";
import { createThreadAtSelection } from "../utils/thread";
import { waitForSync } from "../utils/waitForSync";

/**
 * The server keeps a comment-only block wrap only in a fragment it knows: the
 * root `default`, or a root fragment declared `xmlfragment` with
 * `provider.setFieldType`. A fragment nested in a root `Y.Map` is undone
 * however it is declared. Inline anchors are kept in every layout.
 *
 * There is no `with the writeback fix` half: the workaround writes nothing
 * different here. See docs/block-anchor-fragments.md.
 */

type FieldType = Parameters<TiptapCollabProvider["setFieldType"]>[1];

interface FragmentLayout {
  label: string;
  bind: Binding;
  /** Creates the fragment, for layouts a full-rights session must create. */
  create?: (ydoc: Y.Doc) => void;
  /** Passed to `provider.setFieldType` before the content is written. */
  fieldTypes?: Record<string, FieldType>;
}

const TARGET = "[target]";
const NAMED_ROOT = "page:page-1";
const PAGES = "pages";
const PAGE_ID = "page-1";

const namedRoot: Binding = (provider) => ({
  fragment: provider.document.getXmlFragment(NAMED_ROOT),
});

const nestedPage =
  (field?: string): Binding =>
  (provider) => {
    const fragment = provider.document
      .getMap<Y.XmlFragment>(PAGES)
      .get(PAGE_ID);
    if (!fragment) {
      throw new Error(`No ${PAGES}.${PAGE_ID} fragment to bind`);
    }
    return field ? { fragment, field } : { fragment };
  };

const createPage = (ydoc: Y.Doc) => {
  ydoc.getMap(PAGES).set(PAGE_ID, new Y.XmlFragment());
};

/** How lex-frontend stores pages. */
const NESTED: FragmentLayout = {
  label: "a fragment nested in a root map",
  bind: nestedPage(),
  create: createPage,
};

/** Each also given as Collaboration's `field`, which CommentsKit sends as the thread's. */
const NESTED_PATH_KEYS = [
  "pages.page-1",
  "pages.[page-1]",
  "pages[page-1]",
  "pages/page-1",
  "pages:page-1",
];

const KNOWN_LAYOUTS: FragmentLayout[] = [
  { label: "the root fragment `default`", bind: rootDefault },
  {
    label: "a root fragment declared an xmlfragment",
    bind: namedRoot,
    fieldTypes: { [NAMED_ROOT]: "xmlfragment" },
  },
];

const UNKNOWN_LAYOUTS: FragmentLayout[] = [
  { label: "an undeclared root fragment", bind: namedRoot },
  NESTED,
];

const DECLARED_NESTED_LAYOUTS: FragmentLayout[] = [
  {
    label: "a nested fragment whose root map is declared a map",
    bind: nestedPage(),
    create: createPage,
    fieldTypes: { [PAGES]: "map" },
  },
  ...NESTED_PATH_KEYS.map(
    (key): FragmentLayout => ({
      label: `a nested fragment declared an xmlfragment as \`${key}\``,
      bind: nestedPage(key),
      create: createPage,
      fieldTypes: { [PAGES]: "map", [key]: "xmlfragment" },
    }),
  ),
];

/** Writes the seed into the layout's fragment as a full-rights session. */
async function seedAsEditor(documentName: string, layout: FragmentLayout) {
  const provider = new TiptapCollabProvider({
    name: documentName,
    token: createToken({
      sub: `editor:${randomUUID()}`,
      allowedDocumentNames: [documentName],
    }),
    websocketProvider: new TiptapCollabProviderWebsocket({
      baseUrl: "ws://localhost:3030",
      WebSocketPolyfill: Websocket,
    }),
  });
  await waitForSync(provider);
  layout.create?.(provider.document);
  for (const [name, type] of Object.entries(layout.fieldTypes ?? {})) {
    provider.setFieldType(name, type);
  }
  const editor = new Editor({
    extensions: stockExtensionsFor(
      textSchema,
      layout.bind,
    )({ syncedProvider: provider }),
  });

  try {
    editor.commands.setContent([
      paragraph([text(TARGET)]),
      paragraph([text("[after]")]),
    ]);
    await waitUntilFlushed(provider);
  } finally {
    editor.destroy();
    provider.destroy();
  }
}

const targetParagraph = (editor: Editor) =>
  queryOrFail(
    editor.$doc,
    (node) => node.type.name === "paragraph" && node.textContent === TARGET,
    `No paragraph containing ${TARGET}`,
  );

const selectBlock = (editor: Editor): Selection =>
  asNodeSelection(editor.state.doc, targetParagraph(editor));

const selectText = (editor: Editor): Selection => {
  const { from, to } = nodeRange(targetParagraph(editor));
  return TextSelection.create(editor.state.doc, from + 1, to - 1);
};

function describeLayouts(
  layouts: FragmentLayout[],
  anchorOn: (editor: Editor) => Selection,
) {
  describe.for<FragmentLayout>(layouts)("in $label", (layout) => {
    test.override("seed", async ({ client, documentName }, { onCleanup }) => {
      await client.createDocument(documentName, {
        type: "doc",
        content: [{ type: "paragraph" }],
      });
      onCleanup(() => client.deleteDocument(documentName));
      await seedAsEditor(documentName, layout);
    });
    test.override("baseExtensions", ({ syncedProvider }) =>
      stockExtensionsFor(textSchema, layout.bind)({ syncedProvider }),
    );

    test("keeps the anchor after sync", async ({ editor, provider }) => {
      const { threadId } = await createThreadAtSelection(editor, anchorOn);

      expect(
        threadExistsInDocument(editor, threadId),
        `Thread ${threadId} was not anchored before sync`,
      ).toBe(true);

      await waitUntilFlushed(provider);

      expect(
        threadExistsInDocument(editor, threadId),
        `Thread ${threadId} lost its anchor during sync`,
      ).toBe(true);
    });
  });
}

describe("anchors by fragment", () => {
  describe("given a comment-only session", () => {
    describe("on a block", () => {
      describeLayouts(
        [...KNOWN_LAYOUTS, ...UNKNOWN_LAYOUTS, ...DECLARED_NESTED_LAYOUTS],
        selectBlock,
      );
    });

    describe("on text", () => {
      describeLayouts([...KNOWN_LAYOUTS, ...UNKNOWN_LAYOUTS], selectText);
    });
  });
});

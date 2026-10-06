/**
 * Block anchors on a comment-only connection: what wrapping a block in
 * `blockThread` writes to Yjs, and whether the server keeps it, for a
 * comment-only and an editor token.
 *
 * The server undoes the wrap unless the re-inserted block is identical to the
 * stored one, attribute key order included. `PROBE_VARIANT=writeback` runs it
 * with `CollabWriteback`, whose element writeback keeps every case green.
 * Needs the Docker collab server (it reads its log for "Undoing change").
 *
 * Run: pnpm exec vitest run --project=probes tests/probes/block-thread.probe.ts
 * Set PROBE_OUT=<file.jsonl> to record each case's writes and server verdict.
 */
import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { appendFileSync } from "node:fs";
import {
  Editor,
  Extension,
  type Extensions,
  type JSONContent,
  Node,
} from "@tiptap/core";
import Collaboration from "@tiptap/extension-collaboration";
import { TextStyle } from "@tiptap/extension-text-style";
import { BackgroundColor } from "@tiptap/extension-text-style/background-color";
import { Color } from "@tiptap/extension-text-style/color";
import { FontFamily } from "@tiptap/extension-text-style/font-family";
import { FontSize } from "@tiptap/extension-text-style/font-size";
import StarterKit from "@tiptap/starter-kit";
import {
  BlockThread,
  Comments,
  InlineThread,
  threadExistsInDocument,
} from "@tiptap-pro/extension-comments";
import {
  TiptapCollabProvider,
  TiptapCollabProviderWebsocket,
} from "@tiptap-pro/provider";
import { vi } from "vitest";
import Websocket from "ws";
import * as Y from "yjs";
import { describe, expect, test } from "~/tests/fixtures";
import { CollabWriteback } from "~/workaround/collabWriteback";
import { createToken } from "../utils/createToken";
import { waitUntilFlushed } from "../utils/flushChanges";
import { query, queryOrFail } from "../utils/query";
import {
  asNodeSelection,
  nodeRange,
  type Selection,
  TextSelection,
} from "../utils/selection";
import { waitForSync } from "../utils/waitForSync";

const CONTAINER =
  process.env.COLLAB_CONTAINER ?? "tiptap-comments-test-tiptap-collab-1";
const VARIANT = process.env.PROBE_VARIANT ?? "stock";

// ---------------------------------------------------------------- schema

/** A container whose content is a group, like lex-frontend's callout. */
const Callout = Node.create({
  name: "callout",
  group: "block",
  content: "calloutContent+",
  defining: true,
  parseHTML: () => [{ tag: "div[data-callout]" }],
  renderHTML: () => ["div", { "data-callout": "" }, 0],
});

/** StarterKit's paragraph, in the callout's group too. */
const Paragraph = Node.create({
  name: "paragraph",
  priority: 1000,
  group: "block calloutContent",
  content: "inline*",
  parseHTML: () => [{ tag: "p" }],
  renderHTML: () => ["p", 0],
});

/**
 * lex-frontend's CourseCodeBlock: lowlight's `language`, then its own
 * `theme` (default "dark"), in that schema order.
 */
const CodeBlock = Node.create({
  name: "codeBlock",
  group: "block calloutContent",
  content: "text*",
  marks: "",
  code: true,
  defining: true,
  addAttributes: () => ({
    language: { default: null },
    theme: { default: "dark" },
  }),
  parseHTML: () => [{ tag: "pre" }],
  renderHTML: () => ["pre", ["code", 0]],
});

/** Global block attributes shaped like lex-frontend's. */
const GlobalBlockAttrs = Extension.create({
  name: "globalBlockAttrs",
  addGlobalAttributes() {
    return [
      {
        types: ["paragraph", "heading"],
        attributes: {
          textAlign: { default: null },
          lineHeight: { default: null },
          // lex-frontend's Indent: a non-null default.
          marginLeft: { default: 0 },
        },
      },
    ];
  },
});

const textStyleKit = [TextStyle, FontFamily, FontSize, Color, BackgroundColor];

function extensionsFor(provider: TiptapCollabProvider): Extensions {
  const commentsOptions = {
    provider,
    deleteUnreferencedThreads: false,
    useLegacyWrapping: false,
    ...(process.env.RESPECT_PARENT_SCHEMA ? { respectParentSchema: true } : {}),
  };
  return [
    StarterKit.configure({
      undoRedo: false,
      trailingNode: false,
      paragraph: false,
      codeBlock: false,
    }),
    CodeBlock,
    // The paragraph and anchor join the callout's group, as CommentAnchors does.
    Paragraph,
    Callout,
    GlobalBlockAttrs,
    ...textStyleKit,
    ...(VARIANT === "writeback" ? [CollabWriteback] : []),
    Collaboration.configure({ provider, document: provider.document }),
    Comments.configure(commentsOptions),
    Extension.create({
      name: "commentAnchors",
      addExtensions: () => [
        BlockThread.extend({ group: "block calloutContent" }),
        InlineThread,
      ],
    }),
  ];
}

// ---------------------------------------------------------------- cases

/** Seeded as editor-authored content is: with the non-null default present. */
const p = (
  content: JSONContent[],
  attrs: Record<string, unknown> = { marginLeft: 0 },
) => ({ type: "paragraph", attrs, content });
const t = (text: string, marks?: JSONContent["marks"]) => ({
  type: "text",
  text,
  ...(marks ? { marks } : {}),
});

const TARGET = "[target]";
const hasTarget = (n: { textContent: string; type: { name: string } }) =>
  n.type.name === "paragraph" && n.textContent.includes(TARGET);

interface Case {
  label: string;
  content: JSONContent;
  select: (editor: Editor) => Selection;
}

const selectTargetParagraph = (editor: Editor) =>
  asNodeSelection(
    editor.state.doc,
    queryOrFail(editor.$doc, hasTarget, "no target paragraph"),
  );

const cases: Case[] = [
  {
    label: "(a) top-level paragraph",
    content: { type: "doc", content: [p([t("[other]")]), p([t(TARGET)])] },
    select: selectTargetParagraph,
  },
  {
    label: "(a') top-level paragraph with styled text",
    content: {
      type: "doc",
      content: [
        p([
          t(TARGET, [
            { type: "textStyle", attrs: { backgroundColor: "#E73E3E" } },
          ]),
        ]),
      ],
    },
    select: selectTargetParagraph,
  },
  {
    label: "(a'') top-level paragraph with a block attribute",
    content: {
      type: "doc",
      content: [p([t(TARGET)], { textAlign: "center", marginLeft: 0 })],
    },
    select: selectTargetParagraph,
  },
  {
    label: "(a3) top-level paragraph with bold text",
    content: { type: "doc", content: [p([t(TARGET, [{ type: "bold" }])])] },
    select: selectTargetParagraph,
  },
  {
    label: "(a4) top-level paragraph already carrying an inline comment",
    content: {
      type: "doc",
      content: [
        p([
          t(TARGET, [
            { type: "inlineThread", attrs: { "data-thread-id": "old" } },
          ]),
        ]),
      ],
    },
    select: selectTargetParagraph,
  },
  {
    label: "(z) paragraph seeded without its marginLeft default",
    content: { type: "doc", content: [p([t(TARGET)], {})] },
    select: selectTargetParagraph,
  },
  {
    label: "(zi) inline anchor, paragraph seeded without marginLeft",
    content: { type: "doc", content: [p([t(TARGET)], {})] },
    select: (editor) => {
      const para = queryOrFail(editor.$doc, hasTarget);
      const { from, to } = nodeRange(para);
      return TextSelection.create(editor.state.doc, from + 1, to - 1);
    },
  },
  {
    label: "(d) code block",
    content: {
      type: "doc",
      content: [
        p([t("[before]")]),
        { type: "codeBlock", attrs: { theme: "dark" }, content: [t(TARGET)] },
      ],
    },
    select: (editor) =>
      asNodeSelection(
        editor.state.doc,
        queryOrFail(editor.$doc, { nodeType: "codeBlock" }),
      ),
  },
  {
    label: "(d2) multi-line code block with a language",
    content: {
      type: "doc",
      content: [
        p([t("[before]")]),
        {
          type: "codeBlock",
          attrs: { language: "javascript", theme: "dark" },
          content: [t(`const a = 1;\n${TARGET}\n  return a;`)],
        },
      ],
    },
    select: (editor) =>
      asNodeSelection(
        editor.state.doc,
        queryOrFail(editor.$doc, { nodeType: "codeBlock" }),
      ),
  },
  {
    label: "(d3) code block seeded without its theme default",
    content: {
      type: "doc",
      content: [
        p([t("[before]")]),
        { type: "codeBlock", content: [t(TARGET)] },
      ],
    },
    select: (editor) =>
      asNodeSelection(
        editor.state.doc,
        queryOrFail(editor.$doc, { nodeType: "codeBlock" }),
      ),
  },
  {
    label: "(d4) code block, language then theme",
    content: {
      type: "doc",
      content: [
        p([t("[before]")]),
        {
          type: "codeBlock",
          attrs: { language: "javascript", theme: "dark" },
          content: [t(TARGET)],
        },
      ],
    },
    select: (editor) =>
      asNodeSelection(
        editor.state.doc,
        queryOrFail(editor.$doc, { nodeType: "codeBlock" }),
      ),
  },
  {
    label: "(d5) code block, theme then language",
    content: {
      type: "doc",
      content: [
        p([t("[before]")]),
        {
          type: "codeBlock",
          attrs: { theme: "dark", language: "javascript" },
          content: [t(TARGET)],
        },
      ],
    },
    select: (editor) =>
      asNodeSelection(
        editor.state.doc,
        queryOrFail(editor.$doc, { nodeType: "codeBlock" }),
      ),
  },
  {
    label: "(d6) multi-line code block, no language",
    content: {
      type: "doc",
      content: [
        p([t("[before]")]),
        {
          type: "codeBlock",
          attrs: { theme: "dark" },
          content: [t(`a\n${TARGET}\nb`)],
        },
      ],
    },
    select: (editor) =>
      asNodeSelection(
        editor.state.doc,
        queryOrFail(editor.$doc, { nodeType: "codeBlock" }),
      ),
  },
  {
    label: "(a5) paragraph seeded marginLeft then textAlign",
    content: {
      type: "doc",
      content: [p([t(TARGET)], { marginLeft: 0, textAlign: "center" })],
    },
    select: selectTargetParagraph,
  },
  {
    label: "(b) horizontal rule",
    content: {
      type: "doc",
      content: [p([t("[before]")]), { type: "horizontalRule" }],
    },
    select: (editor) =>
      asNodeSelection(
        editor.state.doc,
        queryOrFail(editor.$doc, { nodeType: "horizontalRule" }),
      ),
  },
  {
    label: "(c1) paragraph in a blockquote",
    content: {
      type: "doc",
      content: [{ type: "blockquote", content: [p([t(TARGET)])] }],
    },
    select: selectTargetParagraph,
  },
  {
    label: "(c2) paragraph in a callout (regrouped anchor)",
    content: {
      type: "doc",
      content: [
        p([t("[before]")]),
        { type: "callout", content: [p([t("[first]")]), p([t(TARGET)])] },
      ],
    },
    select: selectTargetParagraph,
  },
  {
    label: "(c3) styled paragraph in a callout",
    content: {
      type: "doc",
      content: [
        {
          type: "callout",
          content: [p([t(TARGET, [{ type: "italic" }])])],
        },
      ],
    },
    select: selectTargetParagraph,
  },
  {
    label: "(i) inline anchor on the same text (control)",
    content: { type: "doc", content: [p([t("[other]")]), p([t(TARGET)])] },
    select: (editor) => {
      const para = queryOrFail(editor.$doc, hasTarget);
      const { from, to } = nodeRange(para);
      return TextSelection.create(editor.state.doc, from + 1, to - 1);
    },
  },
];

// ---------------------------------------------------------------- recording

function pathOf(type: Y.AbstractType<unknown>): string {
  const parts: string[] = [];
  let cur: Y.AbstractType<unknown> | null = type;
  while (cur) {
    if (cur instanceof Y.XmlElement) parts.unshift(cur.nodeName);
    else if (cur instanceof Y.XmlText) parts.unshift("#text");
    else if (cur._item === null) {
      parts.unshift(Y.findRootTypeKey(cur));
      break;
    }
    cur = (cur._item?.parent as Y.AbstractType<unknown>) ?? null;
  }
  return parts.join(">");
}

function describeInserted(value: unknown): string {
  if (value instanceof Y.XmlElement) {
    const attrs = value.getAttributes();
    const kids = value
      .toArray()
      .map((c) => describeInserted(c))
      .join(",");
    return `<${value.nodeName} ${JSON.stringify(attrs)}>[${kids}]`;
  }
  if (value instanceof Y.XmlText) {
    return `#text${JSON.stringify(value.toDelta())}`;
  }
  return JSON.stringify(value);
}

function record(ydoc: Y.Doc) {
  const lines: string[] = [];
  const roots = new Set<string>();
  const onAfter = (tr: Y.Transaction) => {
    if (!tr.local) return;
    for (const type of tr.changed.keys()) {
      let cur = type as Y.AbstractType<unknown>;
      while (cur._item) cur = cur._item.parent as Y.AbstractType<unknown>;
      roots.add(Y.findRootTypeKey(cur));
    }
    for (const [type, events] of tr.changedParentTypes) {
      for (const event of events) {
        if (event.target !== type) continue;
        const where = pathOf(event.target as Y.AbstractType<unknown>);
        if (event instanceof Y.YTextEvent) {
          for (const op of event.delta) {
            lines.push(`${where} text ${JSON.stringify(op)}`);
          }
          continue;
        }
        for (const op of event.changes.delta) {
          if (op.insert)
            for (const v of op.insert as unknown[])
              lines.push(`${where} INSERT ${describeInserted(v)}`);
          else if (op.delete) lines.push(`${where} DELETE ${op.delete}`);
        }
        for (const [key, change] of event.changes.keys) {
          if (!(event.target instanceof Y.Map) || where.startsWith("default"))
            lines.push(
              `${where} attr ${key} ${change.action} -> ${JSON.stringify(
                (event.target as Y.XmlElement).getAttribute?.(key),
              )}`,
            );
        }
      }
    }
  };
  ydoc.on("afterTransaction", onAfter);
  return {
    stop: () => ydoc.off("afterTransaction", onAfter),
    lines,
    roots,
  };
}

function serverUndos(sub: string, since: string): string[] {
  const out = execSync(`docker logs --since ${since} ${CONTAINER} 2>&1`, {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return out
    .split("\n")
    .filter((l) => l.includes("Undoing change") && l.includes(sub))
    .map((l) => {
      const m = l.match(/"message":"(.*?)","/);
      return (m?.[1] ?? l).replace(/\\"/g, '"');
    });
}

// ---------------------------------------------------------------- probe

const ACCESS = [
  { label: "comment-only", editorAccess: false },
  { label: "editor", editorAccess: true },
] as const;

describe(`block thread probe [${VARIANT}]`, () => {
  test.override("extensions", ({ syncedProvider }) =>
    extensionsFor(syncedProvider),
  );

  describe.for(ACCESS)("$label token", ({ editorAccess }) => {
    test.override("claims", ({ documentName }) => {
      const sub = `${editorAccess ? "editor" : "guest"}:${randomUUID()}`;
      return editorAccess
        ? { sub, allowedDocumentNames: [documentName] }
        : {
            sub,
            allowedDocumentNames: [],
            readonlyDocumentNames: [documentName],
            commentDocumentNames: [documentName],
          };
    });

    describe.for(cases)("$label", ({ content, select }) => {
      test.override("seedContent", content);

      test("keeps the anchor after sync", { timeout: 20_000 }, async ({
        editor,
        provider,
        claims,
        annotate,
      }) => {
        const since = new Date(Date.now() - 1000).toISOString();
        const rec = record(provider.document);

        const created = new Promise<{ threadId: string }>((r) =>
          editor.once("comments:threadCreated", r),
        );
        const ok = editor
          .chain()
          .command(({ tr }) => {
            tr.setSelection(select(editor));
            return true;
          })
          .setThread({ content: "[probe]" })
          .run();
        expect(ok).toBe(true);
        const { threadId } = await created;
        const before = threadExistsInDocument(editor, threadId);

        await waitUntilFlushed(provider);
        rec.stop();
        const after = threadExistsInDocument(editor, threadId);
        const undos = serverUndos(claims.sub, since);

        const report = [
          `local anchor before sync: ${before}, after sync: ${after}`,
          `roots touched: ${[...rec.roots].join(", ")}`,
          ...rec.lines.filter((l) => l.startsWith("default")),
          `server: ${undos.length ? undos.join("\n        ") : "(no undo)"}`,
          `doc after: ${JSON.stringify(editor.getJSON())}`,
        ].join("\n  ");
        if (process.env.PROBE_OUT)
          appendFileSync(
            process.env.PROBE_OUT,
            `${JSON.stringify({
              test: expect.getState().currentTestName,
              before,
              after,
              roots: [...rec.roots],
              writes: rec.lines.filter((l) => l.startsWith("default")),
              server: undos,
            })}\n`,
          );
        await annotate("report", { body: report });

        expect(before, "anchor placed locally").toBe(true);
        expect(undos, "server undid the update").toEqual([]);
        expect(after, "anchor survives sync").toBe(true);
      });
    });
  });
});

// ---------------------------------------------------------------- authoring

/**
 * The attributes reach Yjs through an author's ordinary edits, not a seed:
 * an editor-token session builds the block, then the comment-only session
 * (the fixture editor) anchors a block thread on it.
 */
interface AuthoringCase {
  label: string;
  author: (editor: Editor) => void;
  nodeType: string;
}

const authoringCases: AuthoringCase[] = [
  {
    label: "(R1) code block inserted, then its language picked",
    nodeType: "codeBlock",
    author: (ed) => {
      ed.chain()
        .insertContentAt(ed.state.doc.content.size, {
          type: "codeBlock",
          content: [t(TARGET)],
        })
        .run();
      const block = queryOrFail(ed.$doc, { nodeType: "codeBlock" });
      ed.chain()
        .setTextSelection(nodeRange(block).from + 1)
        .updateAttributes("codeBlock", { language: "javascript" })
        .run();
    },
  },
  {
    label: "(R2) code block inserted with its language",
    nodeType: "codeBlock",
    author: (ed) => {
      ed.chain()
        .insertContentAt(ed.state.doc.content.size, {
          type: "codeBlock",
          attrs: { language: "javascript" },
          content: [t(TARGET)],
        })
        .run();
    },
  },
  {
    label: "(R3) paragraph typed, then centred",
    nodeType: "paragraph",
    author: (ed) => {
      ed.chain()
        .insertContentAt(ed.state.doc.content.size, p([t(TARGET)], {}))
        .run();
      const para = queryOrFail(ed.$doc, hasTarget);
      ed.chain()
        .setTextSelection(nodeRange(para).from + 1)
        .updateAttributes("paragraph", { textAlign: "center" })
        .run();
    },
  },
  {
    label: "(R4) paragraph typed, untouched",
    nodeType: "paragraph",
    author: (ed) => {
      ed.chain()
        .insertContentAt(ed.state.doc.content.size, p([t(TARGET)], {}))
        .run();
    },
  },
];

describe(`authored blocks [${VARIANT}]`, () => {
  test.override("extensions", ({ syncedProvider }) =>
    extensionsFor(syncedProvider),
  );
  test.override("seedContent", {
    type: "doc",
    content: [p([t("[before]")])],
  });

  describe.for(authoringCases)("$label", ({ author, nodeType }) => {
    test("comment-only block thread keeps its anchor", {
      timeout: 30_000,
    }, async ({ editor, provider, claims, documentName }) => {
      const authorProvider = new TiptapCollabProvider({
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
      await waitForSync(authorProvider);
      const authorEditor = new Editor({
        extensions: extensionsFor(authorProvider),
      });
      try {
        author(authorEditor);
        await waitUntilFlushed(authorProvider);
        await vi.waitUntil(
          () =>
            query(
              editor.$doc,
              (n) => n.type.name === nodeType && n.textContent.includes(TARGET),
            ) !== null,
          { timeout: 5_000 },
        );

        const block = queryOrFail(
          editor.$doc,
          (n) => n.type.name === nodeType && n.textContent.includes(TARGET),
        );
        const yAttrs = (() => {
          const frag = provider.document.getXmlFragment("default");
          const el = frag
            .toArray()
            .find(
              (c) =>
                c instanceof Y.XmlElement &&
                c.nodeName === nodeType &&
                c.toString().includes(TARGET),
            ) as Y.XmlElement;
          return el.getAttributes();
        })();

        const since = new Date(Date.now() - 1000).toISOString();
        const rec = record(provider.document);
        const created = new Promise<{ threadId: string }>((r) =>
          editor.once("comments:threadCreated", r),
        );
        editor
          .chain()
          .command(({ tr }) => {
            tr.setSelection(asNodeSelection(editor.state.doc, block));
            return true;
          })
          .setThread({ content: "[probe]" })
          .run();
        const { threadId } = await created;
        const before = threadExistsInDocument(editor, threadId);
        await waitUntilFlushed(provider);
        rec.stop();
        const after = threadExistsInDocument(editor, threadId);
        const undos = serverUndos(claims.sub, since);

        if (process.env.PROBE_OUT)
          appendFileSync(
            process.env.PROBE_OUT,
            `${JSON.stringify({
              test: expect.getState().currentTestName,
              storedAttrOrder: Object.keys(yAttrs),
              storedAttrs: yAttrs,
              before,
              after,
              roots: [...rec.roots],
              writes: rec.lines.filter((l) => l.startsWith("default")),
              server: undos,
            })}\n`,
          );

        expect(before, "anchor placed locally").toBe(true);
        expect(undos, "server undid the update").toEqual([]);
        expect(after, "anchor survives sync").toBe(true);
      } finally {
        authorEditor.destroy();
        authorProvider.destroy();
      }
    });
  });
});

import type { Extensions } from "@tiptap/core";
import Collaboration from "@tiptap/extension-collaboration";
import { TextStyle } from "@tiptap/extension-text-style";
import { BackgroundColor } from "@tiptap/extension-text-style/background-color";
import { Color } from "@tiptap/extension-text-style/color";
import { FontFamily } from "@tiptap/extension-text-style/font-family";
import { FontSize } from "@tiptap/extension-text-style/font-size";
import StarterKit from "@tiptap/starter-kit";
import { CommentsKit } from "@tiptap-pro/extension-comments";
import type { TiptapCollabProvider } from "@tiptap-pro/provider";
import { CollabWriteback } from "~/workaround/collabWriteback";
import { blockAnchors, blockNodes } from "./blockSchema";

export type ExtensionDeps = { syncedProvider: TiptapCollabProvider };

/** The nodes an editor's content uses, and any anchors replacing CommentsKit's. */
export interface EditorSchema {
  nodes: Extensions;
  /** Registered after CommentsKit, so a same-named anchor replaces its own. */
  anchors: Extensions;
}

/**
 * A configuration as the `extensions` fixture takes it. Vitest reads the
 * fixture's destructured parameter as its dependencies, so the schema is
 * chosen by a factory rather than passed alongside `syncedProvider`.
 */
export type Configuration = (deps: ExtensionDeps) => Extensions;

const starterKit = StarterKit.configure({
  undoRedo: false,
  trailingNode: false,
});

/** Every `textStyle` attribute extension a production editor registers. */
const textStyleKit = [TextStyle, FontFamily, FontSize, Color, BackgroundColor];

/** StarterKit and the full textStyle kit: the comment matrix's schema. */
export const textSchema: EditorSchema = {
  nodes: [starterKit, ...textStyleKit],
  anchors: [],
};

/** Attributed blocks shaped like a course editor's: the block matrix's schema. */
export const blockSchema: EditorSchema = {
  nodes: [...blockNodes, ...textStyleKit],
  anchors: blockAnchors,
};

const collaboration = (provider: TiptapCollabProvider) =>
  Collaboration.configure({ provider, document: provider.document });

const commentsKit = (provider: TiptapCollabProvider) =>
  CommentsKit.configure({
    provider,
    deleteUnreferencedThreads: false,
    useLegacyWrapping: false,
  });

/**
 * What a normal Tiptap application has: collaboration and comments over
 * `schema`, and nothing from `workaround/`. The matrices run under it, so
 * their failures are the bugs as an ordinary user meets them.
 */
export const stockExtensionsFor =
  (schema: EditorSchema): Configuration =>
  ({ syncedProvider }) => [
    ...schema.nodes,
    collaboration(syncedProvider),
    commentsKit(syncedProvider),
    ...schema.anchors,
  ];

/**
 * `stockExtensionsFor(schema)` plus `CollabWriteback`. That alone takes both
 * matrices green; `workaround/README.md` records which of its mechanisms each
 * case needs.
 */
export const writebackFixExtensionsFor =
  (schema: EditorSchema): Configuration =>
  ({ syncedProvider }) => [
    ...schema.nodes,
    CollabWriteback,
    collaboration(syncedProvider),
    commentsKit(syncedProvider),
    ...schema.anchors,
  ];

/** The stock configuration over {@link textSchema}. */
export const stockExtensions = stockExtensionsFor(textSchema);

/** The writeback configuration over {@link textSchema}. */
export const writebackFixExtensions = writebackFixExtensionsFor(textSchema);

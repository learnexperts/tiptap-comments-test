import type { Extensions } from "@tiptap/core";
import Collaboration from "@tiptap/extension-collaboration";
import { TextStyle } from "@tiptap/extension-text-style";
import { BackgroundColor } from "@tiptap/extension-text-style/background-color";
import { Color } from "@tiptap/extension-text-style/color";
import { FontFamily } from "@tiptap/extension-text-style/font-family";
import { FontSize } from "@tiptap/extension-text-style/font-size";
import StarterKit from "@tiptap/starter-kit";
import { Comments, CommentsKit } from "@tiptap-pro/extension-comments";
import type { TiptapCollabProvider } from "@tiptap-pro/provider";
import { CollabWriteback } from "~/workaround/collabWriteback";
import { blockAnchors, blockNodes } from "./blockSchema";

export type ExtensionDeps = { syncedProvider: TiptapCollabProvider };

export interface EditorSchema {
  nodes: Extensions;
  /** Replaces CommentsKit's anchors; `null` keeps them. */
  anchors: Extensions | null;
}

// Vitest reads a fixture's destructured parameter as its dependencies, so a
// configuration takes only `syncedProvider` and the schema comes from a factory.
export type Configuration = (deps: ExtensionDeps) => Extensions;

const starterKit = StarterKit.configure({
  undoRedo: false,
  trailingNode: false,
});

const textStyleKit = [TextStyle, FontFamily, FontSize, Color, BackgroundColor];

export const textSchema: EditorSchema = {
  nodes: [starterKit, ...textStyleKit],
  anchors: null,
};

export const blockSchema: EditorSchema = {
  nodes: [...blockNodes, ...textStyleKit],
  anchors: blockAnchors,
};

const collaboration = (provider: TiptapCollabProvider) =>
  Collaboration.configure({ provider, document: provider.document });

const commentsOptions = (provider: TiptapCollabProvider) => ({
  provider,
  deleteUnreferencedThreads: false,
  useLegacyWrapping: false,
});

// `Comments` is CommentsKit without the anchors, so each anchor registers once.
const comments = (provider: TiptapCollabProvider, schema: EditorSchema) =>
  schema.anchors
    ? [Comments.configure(commentsOptions(provider)), ...schema.anchors]
    : [CommentsKit.configure(commentsOptions(provider))];

/** A plain Tiptap setup: nothing from `workaround/`. */
export const stockExtensionsFor =
  (schema: EditorSchema): Configuration =>
  ({ syncedProvider }) => [
    ...schema.nodes,
    collaboration(syncedProvider),
    ...comments(syncedProvider, schema),
  ];

/** The stock setup plus `CollabWriteback`. */
export const writebackFixExtensionsFor =
  (schema: EditorSchema): Configuration =>
  ({ syncedProvider }) => [
    ...schema.nodes,
    CollabWriteback,
    collaboration(syncedProvider),
    ...comments(syncedProvider, schema),
  ];

export const stockExtensions = stockExtensionsFor(textSchema);

export const writebackFixExtensions = writebackFixExtensionsFor(textSchema);

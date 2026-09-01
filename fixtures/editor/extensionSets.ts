import { CommentsKit } from "@tiptap-pro/extension-comments";
import { TiptapCollabProvider } from "@tiptap-pro/provider";
import type { Extensions } from "@tiptap/core";
import Collaboration from "@tiptap/extension-collaboration";
import { TextStyle } from "@tiptap/extension-text-style";
import { BackgroundColor } from "@tiptap/extension-text-style/background-color";
import { Color } from "@tiptap/extension-text-style/color";
import { FontFamily } from "@tiptap/extension-text-style/font-family";
import { FontSize } from "@tiptap/extension-text-style/font-size";
import StarterKit from "@tiptap/starter-kit";
import {
  CollabWriteback,
  CompactTextStyleYAttrs,
  ReproFacet,
  ReproGlint,
  SparseTextStyleDefaults,
  StripNullTextStyleAttrs,
} from "./index";

/**
 * Extension permutations used by the anchor-loss probes and the Y mark
 * equality suite. The curated matrix in `tests/comment.test.ts` deliberately
 * uses none of these — it runs the default `extensions` fixture only.
 */

export type ExtensionDeps = { syncedProvider: TiptapCollabProvider };

export const starterKit = StarterKit.configure({
  undoRedo: false,
  trailingNode: false,
});

function extensionListIncludes(
  extensions: Extensions,
  name: string,
): boolean {
  return extensions.some(
    (extension) =>
      typeof extension === "object" &&
      extension !== null &&
      "name" in extension &&
      extension.name === name,
  );
}

export function withCommentsKit(
  syncedProvider: TiptapCollabProvider,
  extensions: Extensions,
  options?: { compactTextStyleY?: boolean },
): Extensions {
  const compactTextStyleY =
    options?.compactTextStyleY ??
    (extensionListIncludes(extensions, "collabWriteback") ||
      extensionListIncludes(extensions, "canonicalizeTextStyleAttrs"));

  const withoutWriteback = extensions.filter((extension) => {
    if (
      typeof extension !== "object" ||
      extension === null ||
      !("name" in extension)
    ) {
      return true;
    }

    return (
      extension.name !== "compactTextStyleYAttrs" &&
      extension.name !== "collabWriteback" &&
      extension.name !== "canonicalizeTextStyleAttrs" &&
      extension.name !== "surgicalYTextWriteback"
    );
  });

  return [
    ...withoutWriteback,
    Collaboration.configure({
      provider: syncedProvider,
      document: syncedProvider.document,
    }),
    CollabWriteback,
    ...(compactTextStyleY ? [CompactTextStyleYAttrs] : []),
    CommentsKit.configure({
      provider: syncedProvider,
      deleteUnreferencedThreads: false,
      useLegacyWrapping: false,
    }),
  ];
}

export const fullKitSparseExtensions = ({ syncedProvider }: ExtensionDeps) =>
  withCommentsKit(syncedProvider, [
    starterKit,
    TextStyle,
    FontFamily,
    FontSize,
    Color,
    BackgroundColor,
    SparseTextStyleDefaults,
    CollabWriteback,
  ]);

export const fontFamilyOnlyExtensions = ({ syncedProvider }: ExtensionDeps) =>
  withCommentsKit(syncedProvider, [starterKit, TextStyle, FontFamily]);

export const textStyleOnlyExtensions = ({ syncedProvider }: ExtensionDeps) =>
  withCommentsKit(syncedProvider, [starterKit, TextStyle]);

export const starterKitOnlyExtensions = ({ syncedProvider }: ExtensionDeps) =>
  withCommentsKit(syncedProvider, [starterKit]);

export const reproGlintExtensions = ({ syncedProvider }: ExtensionDeps) =>
  withCommentsKit(syncedProvider, [starterKit, ReproGlint]);

export const reproFacetExtensions = ({ syncedProvider }: ExtensionDeps) =>
  withCommentsKit(syncedProvider, [starterKit, ReproFacet]);

export const stripNullPmAttrsExtensions = ({ syncedProvider }: ExtensionDeps) =>
  withCommentsKit(syncedProvider, [
    starterKit,
    TextStyle,
    FontFamily,
    FontSize,
    Color,
    BackgroundColor,
    SparseTextStyleDefaults,
    CollabWriteback,
    StripNullTextStyleAttrs,
  ]);

export const compactYAttrsExtensions = ({ syncedProvider }: ExtensionDeps) =>
  withCommentsKit(
    syncedProvider,
    [starterKit, TextStyle, FontFamily, FontSize, Color, BackgroundColor],
    { compactTextStyleY: true },
  );

/** Same composition as `fullKitSparseExtensions`; kept for label clarity. */
export const canonicalizeAttrsExtensions = fullKitSparseExtensions;

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
import { CollabWriteback } from "~/workaround/collabWriteback";

export type ExtensionDeps = { syncedProvider: TiptapCollabProvider };

const starterKit = StarterKit.configure({
  undoRedo: false,
  trailingNode: false,
});

/** Every `textStyle` attribute extension a production editor registers. */
const textStyleKit = [TextStyle, FontFamily, FontSize, Color, BackgroundColor];

const collaboration = (provider: TiptapCollabProvider) =>
  Collaboration.configure({ provider, document: provider.document });

const commentsKit = (provider: TiptapCollabProvider) =>
  CommentsKit.configure({
    provider,
    deleteUnreferencedThreads: false,
    useLegacyWrapping: false,
  });

/**
 * What a normal Tiptap application has: the full textStyle kit, collaboration
 * and comments, and none of the workarounds in `fixtures/editor`. This is the
 * configuration the comment matrix runs under, so its failures are the bug as
 * an ordinary user meets it.
 */
export const stockExtensions = ({
  syncedProvider,
}: ExtensionDeps): Extensions => [
  starterKit,
  ...textStyleKit,
  collaboration(syncedProvider),
  commentsKit(syncedProvider),
];

/**
 * `stockExtensions` plus `CollabWriteback`, which canonicalizes `textStyle`
 * attrs on mark creation and drops retain-delta attributes that already match
 * the current Yjs state. That alone takes the matrix to 34/34.
 *
 * `SparseTextStyleDefaults` and `CompactTextStyleYAttrs` are deliberately not
 * here. The first is redundant once `CollabWriteback` is applied; the second
 * actively regresses the two multi-thread cases on a four-attribute `textStyle`
 * mark, taking the matrix to 32/34.
 */
export const writebackFixExtensions = ({
  syncedProvider,
}: ExtensionDeps): Extensions => [
  starterKit,
  ...textStyleKit,
  CollabWriteback,
  collaboration(syncedProvider),
  commentsKit(syncedProvider),
];

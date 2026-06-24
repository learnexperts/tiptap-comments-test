import { CommentsKit } from "@tiptap-pro/extension-comments";
import {
  TiptapCollabProvider,
  TiptapCollabProviderWebsocket,
} from "@tiptap-pro/provider";
import { Editor, type Extensions } from "@tiptap/core";
import Collaboration from "@tiptap/extension-collaboration";
import { TextStyle } from "@tiptap/extension-text-style";
import { FontFamily } from "@tiptap/extension-text-style/font-family";
import StarterKit from "@tiptap/starter-kit";
import { type TestAPI } from "vitest";
import Websocket from "ws";
import { type TiptapToken } from "../user";
import { waitForSync } from "./waitForSync";

interface EditorDeps {
  documentName: string;
  token: TiptapToken;
  seed: void;
}

export function withEditorFixtures<C extends EditorDeps>(test: TestAPI<C>) {
  return test.extend<{
    $test: {
      provider: TiptapCollabProvider;
      syncedProvider: TiptapCollabProvider;
      extensions: Extensions;
      editor: Editor;
    };
  }>({
    async provider({ documentName, token, seed: _ }, use) {
      const provider = new TiptapCollabProvider({
        name: documentName,
        token,
        websocketProvider: new TiptapCollabProviderWebsocket({
          baseUrl: "ws://localhost:3030",
          WebSocketPolyfill: Websocket,
        }),
      });

      await use(provider);

      provider.destroy();
    },
    async syncedProvider({ provider }, use) {
      await waitForSync(provider, { timeout: 5_000 });
      await use(provider);
    },
    async extensions({ syncedProvider }, use) {
      await use([
        StarterKit.configure({ undoRedo: false, trailingNode: false }),
        TextStyle,
        FontFamily,
        Collaboration.configure({
          provider: syncedProvider,
          document: syncedProvider.document,
        }),
        CommentsKit.configure({
          provider: syncedProvider,
          deleteUnreferencedThreads: false,
          useLegacyWrapping: false,
        }),
      ]);
    },
    async editor({ extensions }, use) {
      const element = document.createElement("div");
      document.body.appendChild(element);

      const editor = new Editor({
        element,
        editable: false,
        extensions,
      });

      await use(editor);

      const debounceTimer = editor.storage.comments?.debounceTimer;
      if (debounceTimer) clearTimeout(debounceTimer);
      editor.destroy();
      element.remove();
    },
  });
}

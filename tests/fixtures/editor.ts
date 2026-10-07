import { Editor, type Extensions } from "@tiptap/core";
import {
  TiptapCollabProvider,
  TiptapCollabProviderWebsocket,
} from "@tiptap-pro/provider";
import type { TestAPI } from "vitest";
import Websocket from "ws";
import { stockExtensions } from "../utils/extensionSets";
import { waitForSync } from "../utils/waitForSync";
import type { UserFixtures } from "./user";

interface EditorDeps extends UserFixtures {
  documentName: string;
  seed: void;
}

export function withEditorFixtures<C extends EditorDeps>(test: TestAPI<C>) {
  return test.extend<{
    $test: {
      provider: TiptapCollabProvider;
      syncedProvider: TiptapCollabProvider;
      baseExtensions: Extensions;
      extensions: Extensions;
      editor: Editor;
    };
  }>({
    async provider({ documentName, token, seed: _, claims: _claims }, use) {
      const provider = new TiptapCollabProvider({
        name: documentName,
        token,
        //user: _claims.sub,
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
    async baseExtensions({ syncedProvider }, use) {
      // What an ordinary Tiptap application has. A suite may swap the schema.
      await use(stockExtensions({ syncedProvider }));
    },
    async extensions({ baseExtensions }, use) {
      // A suite may add to the base, e.g. the workaround.
      await use(baseExtensions);
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

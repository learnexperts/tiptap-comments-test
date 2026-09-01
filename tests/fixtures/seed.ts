import { type JSONContent } from "@tiptap/core";
import { type TestAPI } from "vitest";
import { type ServerClient } from "../utils/createServerClient";

interface SeedDeps {
  documentName: string;
  client: ServerClient;
}

function withSeedFixtures<C extends SeedDeps>(baseTest: TestAPI<C>) {
  return baseTest.extend<{
    $test: {
      seedContent?: JSONContent;
      seed: void;
    };
  }>({
    seedContent: undefined,
    seed: [
      async ({ client, documentName, seedContent }, use) => {
        if (!seedContent) {
          await use();
          return;
        }
        await client.createDocument(documentName, ensureRootNode(seedContent));
        await use();
        await client.deleteDocument(documentName);
      },
      {
        auto: true,
        scope: "test",
      },
    ],
  });
}

export { withSeedFixtures };

function ensureRootNode(content: JSONContent): JSONContent {
  if (content.type === "doc") {
    return content;
  }

  return {
    type: "doc",
    content: [content],
  };
}

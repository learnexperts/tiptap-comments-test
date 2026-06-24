import { type JSONContent } from "@tiptap/core";
import { type TestAPI } from "vitest";
import { type ServerClient } from "../client/createServerClient";

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
          return;
        }
        await client.createDocument(documentName, seedContent);
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

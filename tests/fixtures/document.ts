import { randomUUID } from "node:crypto";
import type { TestAPI } from "vitest";

function withDocumentFixtures<C extends {}>(baseTest: TestAPI<C>) {
  return baseTest.extend<{
    $test: {
      documentName: string;
    };
  }>({
    documentName: `test-comment-repro-${randomUUID()}`,
  });
}

export { withDocumentFixtures };

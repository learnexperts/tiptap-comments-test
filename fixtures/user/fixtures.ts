import { randomUUID } from "node:crypto";
import { type TestAPI } from "vitest";
import { commentClaims, TiptapClaims } from "./claims";
import { createToken, TiptapToken } from "./createToken";

interface UserDeps {
  documentName: string;
}

interface UserFixtures {
  claims: TiptapClaims;
  token: TiptapToken;
}

export function withUserFixtures<C extends UserDeps>(test: TestAPI<C>) {
  return test.extend<UserFixtures>({
    async claims({ documentName }, use) {
      await use(commentClaims({ sub: `guest:${randomUUID()}`, documentName }));
    },
    async token({ claims }, use) {
      await use(createToken(claims));
    },
  });
}

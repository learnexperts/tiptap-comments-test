import { randomUUID } from "node:crypto";
import { type TestAPI } from "vitest";
import { commentClaims, TiptapClaims } from "../utils/claims";
import { createToken, TiptapToken } from "../utils/createToken";

export interface UserDeps {
  documentName: string;
}

export interface UserFixtures {
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

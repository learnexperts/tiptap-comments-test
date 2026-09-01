import { TestAPI } from "vitest";
import {
  createServerClient,
  type ServerClient,
} from "../utils/createServerClient";

export interface ClientFixtures {
  client: ServerClient;
}

export function withClientFixtures<C extends {}>(
  baseTest: TestAPI<C>,
): TestAPI<C & ClientFixtures> {
  return baseTest.extend<{ $test: ClientFixtures }>({
    async client({}, use) {
      await use(
        createServerClient({
          baseUrl: "http://localhost:3030",
          token: "dev-api-secret",
        }),
      );
    },
  });
}

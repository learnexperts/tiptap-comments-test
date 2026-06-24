import { withClientFixtures } from "./client";
import { withDocumentFixtures } from "./document";
import { withEditorFixtures } from "./editor";
import { withSeedFixtures } from "./seed";
import { withUserFixtures } from "./user";

import type { InferFixturesTypes } from "@vitest/runner";
import { test as baseTest, expect } from "vitest";
import applyExtensions from "./utils/applyExtensions";

const wrappers = [
  withDocumentFixtures,
  withClientFixtures,
  withUserFixtures,
  withSeedFixtures,
  withEditorFixtures,
] as const;

const test = applyExtensions(baseTest, wrappers);

const describe = test.describe;
const it = test;

export { describe, expect, it, test };

type X = InferFixturesTypes<typeof test>;

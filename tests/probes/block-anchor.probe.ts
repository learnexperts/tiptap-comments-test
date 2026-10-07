import { describe, test } from "~/tests/fixtures";
import { describeBlockMatrix } from "../utils/blockMatrix";
import { blockSchema, writebackFixExtensionsFor } from "../utils/extensionSets";

/**
 * The same matrix as `tests/block-anchor.test.ts`, with `CollabWriteback`
 * applied. Held out of the default run so `pnpm test` reports the
 * unmitigated bug. Run with `pnpm test:probes`.
 */
describe("with the writeback fix", () => {
  test.override("extensions", writebackFixExtensionsFor(blockSchema));
  describeBlockMatrix();
});

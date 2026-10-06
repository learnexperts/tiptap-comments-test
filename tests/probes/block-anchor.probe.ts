import { describeBlockMatrix } from "../utils/blockMatrix";
import { blockSchema, writebackFixExtensionsFor } from "../utils/extensionSets";

/**
 * The same matrix as `tests/block-anchor.test.ts`, with `CollabWriteback`
 * applied. Held out of the default run so `pnpm test` reports the
 * unmitigated bug. Run with `pnpm test:probes`.
 */
describeBlockMatrix(
  "given a comment-only session with the writeback fix",
  writebackFixExtensionsFor(blockSchema),
);

import { CollabWriteback } from "~/workaround/collabWriteback";
import { describe, test } from "../fixtures";
import { describeBlockMatrix } from "../utils/blockMatrix";
import { blockSchema, stockExtensionsFor } from "../utils/extensionSets";

/**
 * The block-anchor matrix on a plain Tiptap configuration. Failures here are
 * the second defect as an ordinary user meets it: a comment on a block whose
 * stored attributes differ from the rebuilt copy loses its anchor.
 *
 * The same matrix with the workaround added is tagged `writeback`: `pnpm test`
 * leaves it out, `pnpm test:probes` runs only it.
 */
test.override("baseExtensions", stockExtensionsFor(blockSchema));

describeBlockMatrix();

describe("with the writeback fix", { tags: ["writeback"] }, () => {
  test.override("extensions", ({ baseExtensions }) => [
    CollabWriteback,
    ...baseExtensions,
  ]);
  describeBlockMatrix();
});

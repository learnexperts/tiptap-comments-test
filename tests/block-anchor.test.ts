import { test } from "~/tests/fixtures";
import { describeBlockMatrix } from "./utils/blockMatrix";
import { blockSchema, stockExtensionsFor } from "./utils/extensionSets";

/**
 * The block-anchor matrix on a plain Tiptap configuration. Failures here are
 * the second defect as an ordinary user meets it: a comment on a block whose
 * stored attributes differ from the rebuilt copy loses its anchor.
 *
 * `tests/probes/block-anchor.probe.ts` runs the identical matrix with the
 * workaround applied.
 */
test.override("extensions", stockExtensionsFor(blockSchema));
describeBlockMatrix();

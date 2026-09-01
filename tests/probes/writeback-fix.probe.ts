import { writebackFixExtensions } from "../utils/extensionSets";
import { describeCommentMatrix } from "../utils/commentMatrix";

/**
 * The same matrix as `tests/comment.test.ts`, with the workaround extensions
 * applied: `SparseTextStyleDefaults`, `CollabWriteback` and
 * `CompactTextStyleYAttrs`. Comparing the two runs shows which anchor losses
 * the workaround recovers and which survive it.
 *
 * Held out of the default run so `pnpm test` reports the unmitigated bug.
 * Run with `pnpm test:probes`.
 */
describeCommentMatrix(
  "given a comment-only session with the writeback fix",
  writebackFixExtensions,
);

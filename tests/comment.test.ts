import { describeCommentMatrix } from "./utils/commentMatrix";
import { stockExtensions } from "./utils/extensionSets";

/**
 * The comment-only matrix on a plain Tiptap configuration — the full textStyle
 * kit, collaboration and comments, and nothing from `workaround/`. Failures
 * here are the bug as an ordinary user meets it.
 *
 * `tests/probes/writeback-fix.probe.ts` runs the identical matrix with the
 * workaround applied; the difference between the two is what it buys.
 */
describeCommentMatrix("given a comment-only session", stockExtensions);

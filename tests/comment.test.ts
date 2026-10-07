import { CollabWriteback } from "~/workaround/collabWriteback";
import { describe, test } from "./fixtures";
import { describeCommentMatrix } from "./utils/commentMatrix";

/**
 * The comment-only matrix on a plain Tiptap configuration — the full textStyle
 * kit, collaboration and comments. Failures here are the bug as an ordinary
 * user meets it.
 *
 * The same matrix with the workaround added is tagged `writeback`: `pnpm test`
 * leaves it out, `pnpm test:probes` runs only it.
 */
describeCommentMatrix();

describe("with the writeback fix", { tags: ["writeback"] }, () => {
  test.override("extensions", ({ baseExtensions }) => [
    CollabWriteback,
    ...baseExtensions,
  ]);
  describeCommentMatrix();
});

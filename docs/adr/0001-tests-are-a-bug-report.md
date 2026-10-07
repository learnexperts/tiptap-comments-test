# `tests/` is a bug report, not a regression suite

_Amended 2026-10-06: the report now covers a second defect (block anchors), and
the workaround's own tests were added, outside `tests/`. Amended 2026-10-07:
each matrix's stock and workaround runs now share a file, separated by a tag.
See the considered options and consequences. Amended again 2026-10-07: the
report is three issues, one directory and one command each
(`tests/{inline,block,fragments}`). Issue 3 is stock-only, since the workaround
does not address it. `attribute-hashing.test.ts` was removed: it showed a
shape-sensitivity that plays no part in the failing cases._

This repository exists to communicate three TipTap collab + CommentsKit issues
to the TipTap team. `tests/` is the artifact we hand them, so it is optimised for a
stranger reading it once — not for coverage, and not for CI. Each file makes one
claim, and a failing test *is* the report rather than a problem to fix.

## What this means in practice

- **`pnpm test` is expected to fail.** Tests in `tests/inline/`,
  `tests/block/` and `tests/fragments/` are red because the issues are real. A green
  default run would mean we had stopped reproducing a defect. The failures are
  indexed in the README so a *new* failure is still distinguishable from a
  documented one.
- **One claim per file.** `writeback-null-attrs.test.ts` shows the inline
  mechanism offline, `comment.test.ts` shows the resulting anchor loss against
  a real server, `block-anchor.test.ts` shows the block defect, and
  `block-anchor-fragments.test.ts` the nested fragments. The inline and block
  matrix files also run the same matrix with our interim workaround, under a
  `with the writeback fix` describe tagged `writeback`.
- **The workaround runs are held out of the default run.** `pnpm test` filters
  out the `writeback` tag; `pnpm test:probes` runs only it. Those runs are
  all-green, and mixing them into the default run would bury the red tests
  that are the point.
- **The helper unit tests are load-bearing.** `tests/utils/*.test.ts` is not
  coverage. It proves the helpers that choose text ranges do so correctly,
  which pre-empts the obvious rebuttal that our harness is simply selecting the
  wrong text.
- **Offline first.** The mechanism is demonstrated without a collab server, so a
  TipTap engineer can confirm the client-side write before standing up Docker or
  finding a licence key (`pnpm test:utils`, and the mechanism file directly).

## Considered options

- **Keep the investigative suites.** Nine files and ~4,600 lines of extension
  permutations and probe marks were deleted. They recorded how we found the bug,
  which is not what the reader needs to accept that it exists. They remain in
  git history (see the commit that introduced this ADR's sibling changes) and
  can be restored if a specific question resurfaces.
- **Mark the failures `test.fails()` so the suite goes green.** Rejected: it
  inverts the assertions, so the suite would go red the day TipTap fixes the
  bug — the wrong signal to send to the people fixing it, and it hides the
  failure output that is the evidence.
- **Run stock and fixed configurations as one suite.** Rejected: the reader
  should be able to run the bug without also running our workaround. They do
  share a file now (2026-10-07), so the one difference, an `extensions`
  override adding `CollabWriteback`, sits beside the stock run instead of three
  files away. They do not share a run: the `writeback` tag keeps each out of
  the other's command.

## Consequences

- CI cannot gate on `pnpm test` while the defect is open.
- New cases go into the matrix they belong to, `tests/utils/commentMatrix.ts`
  or `tests/utils/blockMatrix.ts`. The stock and workaround runs call the same
  matrix, and the workaround run is the stock `baseExtensions` plus
  `CollabWriteback`, so they cannot drift apart.
- Running a matrix file directly (`vitest run tests/inline/comment.test.ts`) runs both
  halves; pass `--tags-filter='!writeback'` for the report alone.
- The workaround's own contract is tested in `workaround/`, not here, because it
  is not part of the report. It pins, offline, chiefly that the workaround
  changes only the editor it is added to; a leak would silently turn stock
  evidence green. It is green and runs on pre-push.
- Adding a test needs a reason a TipTap engineer would care about. Coverage is
  not one.
- The comparison that eliminated two candidate workarounds survives only as a
  table in the README; those extensions were deleted along with the suites that
  exercised them.

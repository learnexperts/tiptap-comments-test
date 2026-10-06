# `tests/` is a bug report, not a regression suite

_Amended 2026-10-06: the report now covers a second defect (block anchors), and
`tests/workaround/` was added. See the consequences._

This repository exists to communicate two TipTap collab + CommentsKit defects to
the TipTap team. `tests/` is the artifact we hand them, so it is optimised for a
stranger reading it once — not for coverage, and not for CI. Each file makes one
claim, and a failing test *is* the report rather than a problem to fix.

## What this means in practice

- **`pnpm test` is expected to fail.** Tests in `tests/comment.test.ts` and
  `tests/block-anchor.test.ts` are red because the bugs are real. A green
  default run would mean we had stopped reproducing a defect. The failures are
  indexed in the README so a *new* failure is still distinguishable from a
  documented one.
- **One claim per file.** `writeback-null-attrs.test.ts` shows the inline
  mechanism offline, `comment.test.ts` shows the resulting anchor loss against
  a real server, `block-anchor.test.ts` shows the block defect, and each
  `probes/*.probe.ts` shows our interim workaround on the same matrix.
- **The probe is held out of the default run.** The suites are Vitest projects
  and `pnpm test` runs only `repro`; the probe is `pnpm test:probes`. It is
  all-green, and mixing it into the default run would bury the four red tests
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
  should be able to run the bug without also running our workaround.

## Consequences

- CI cannot gate on `pnpm test` while the defect is open.
- New cases go into the matrix they belong to, `tests/utils/commentMatrix.ts`
  or `tests/utils/blockMatrix.ts`. The stock suite and the probe run the same
  matrix, and both configurations come only from `tests/utils/extensionSets.ts`,
  so they cannot drift apart.
- `tests/workaround/` is the one green project that is not part of the report.
  It pins the workaround's own contract offline, chiefly that it changes only
  the editor it is added to; a leak would silently turn stock evidence green.
  It runs on pre-push.
- Adding a test needs a reason a TipTap engineer would care about. Coverage is
  not one.
- The comparison that eliminated two candidate workarounds survives only as a
  table in the README; those extensions were deleted along with the suites that
  exercised them.

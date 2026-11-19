# Archived issues

[← back to the README](../../README.md)

Issues that no longer reproduce against the collab server we test against. Their write-ups, Tiptap drafts and tests are kept as they were, so the history reads in place and the tests can be re-run if one returns. They are not part of the report: `pnpm test` leaves them out, and `pnpm test:archive` runs them, both halves of each matrix.

| # | Issue | Archived | Why | Tests | Tiptap draft |
|---|---|---|---|---|---|
| 1 | [An inline comment on styled text is lost](comment-anchor-lost.md) | 2026-11-09 | The server accepts the `null` `textStyle` attributes a comment writes | [`tests/archive/inline/`](../../tests/archive/inline) | reported |
| 3 | [A block comment is undone in a fragment nested in a `Y.Map`](block-anchor-fragments.md) | 2026-11-09 | The server keeps a block wrap in a nested fragment; only an undeclared root other than `default` still undoes it | [`tests/archive/fragments/`](../../tests/archive/fragments) | [new issue](tiptap/nested-fragments.txt) |
| 4 | [An inline comment is undone where an author's style ranges overlap](comment-anchor-overlapping-styles.md) | 2026-11-09 | The server accepts the deleted dead marker | [`tests/archive/overlap/`](../../tests/archive/overlap) | [addendum to 1](tiptap/addendum-overlapping-styles.txt) |
| 6 | [Resolving a thread removes its anchor, and it may never come back](resolved-thread-anchor.md) | 2026-11-18 | Fixed in comments 3.12.9: resolving keeps the anchor again, and undo no longer strips resolved anchors | [`tests/archive/resolve/`](../../tests/archive/resolve) | [new issue](tiptap/resolved-thread-anchor.txt), never sent |

Issues 1, 3 and 4 were measured against `container.tiptap.dev/collaboration/server:latest` at `COLLABORATION_VERSION` 3.108.2 (digest `sha256:84a012214a048ea0d095988fba9929e7d7afabf4e6e5e24d1c59c8ecf5d4c5bf`), on y-tiptap 3.0.9 and on 3.0.10 with [issue 5](../position-migrations.md)'s record dropped. Both gave the same results. Each write-up's banner gives its numbers.

Issue 6 is a client defect, introduced in comments 3.12.2 and fixed in 3.12.9. It was measured against the same server, on 3.12.1, 3.12.8 and 3.12.9; its banner gives the numbers.

## Running them on 3.0.10

The archive runs on the report's y-tiptap, 3.0.10, where [issue 5](../position-migrations.md) also undoes every stock block comment. So some of these are red for issue 5's reasons, not their own:

| File | 3.0.10 stock | Red for |
|---|---|---|
| `inline/comment.test.ts` | 16/17 | issue 5: the block-level case |
| `inline/writeback-null-attrs.test.ts` | 1/2 | issue 1's client write, which the server now accepts |
| `fragments/block-anchor-fragments.test.ts` | 4/14 | issue 5 in nine block cases; the undeclared root in one |
| `overlap/dead-marker.test.ts` | 0/6 | issue 5's plan re-writing every text's formatting, which the server accepts |
| `overlap/overlapping-styles.test.ts` | 12/12 | — |
| `resolve/resolved-thread-anchor.test.ts` | 9/9 | — |

The `writeback` halves add `CollabWriteback` and are green.

The Tiptap drafts are as submitted. Their paths and commands predate the archive: read `tests/inline/` as `tests/archive/inline/`, and `pnpm test:inline` as `pnpm test:archive tests/archive/inline`, and likewise for the others.

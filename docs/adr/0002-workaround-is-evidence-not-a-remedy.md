# `workaround/` is evidence, not a remedy

_Amended 2026-10-06: the workaround now covers two defects with three
mechanisms in three files, and its halves have separate removal conditions. The
decision is unchanged._

`workaround/` is the one directory here that is not test support: it is the
stopgap we run in production while the defects are open. It lives in its own
top-level directory so the shape of the report is legible at a glance —
`workaround/` is what we do today, everything under `tests/` is the evidence.
Its interface is the single `CollabWriteback` extension; `workaround/README.md`
describes it and its mechanisms.

## It is deliberately not presented as a fix

The extension monkey-patches Yjs's `Text`, `XmlFragment` and `XmlElement`
prototypes from outside the library. That is defensible for a
stopgap we own and maintain; it is not something to recommend to TipTap or to
their other users, and the README says so explicitly.

Its role in the report is diagnostic. Suppressing the spurious `textStyle` write
takes the comment matrix from 30/34 to 34/34, and copying the stored element's
attribute order takes the block matrix green. That localises each defect to the
writeback path — the client emitting a mark change nobody made, and the comment-only path
discarding the whole update rather than only the disallowed part of it. Either
end could be fixed; both are deeper in the collab chain than a client extension
can properly reach.

Do not "helpfully" upgrade the language to recommend it, and do not fold the
directory back into `tests/` on the grounds that it is small. The separation is
the point.

## Consequences

- `tests/` may import `CollabWriteback` from `workaround/`; never the reverse.
  Biome enforces both directions.
- The two halves go away separately: the `textStyle` mechanism when the inline
  defect is fixed, the element mechanisms when the block defect is fixed. When
  both are gone, so are this directory (its tests included) and the
  `writeback` halves of the matrix files. Nothing else in the repo depends on the workaround.
- Every mechanism has earned its place by ablation; `workaround/README.md`
  records the table, including two mechanisms deleted for doing no work.

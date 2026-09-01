# `workaround/` is evidence, not a remedy

`workaround/collabWriteback.ts` is the one file here that is not test support:
it is the stopgap we run in production while the defect is open. It lives in its
own top-level directory so the shape of the report is legible at a glance —
`workaround/` is what we do today, everything under `tests/` is the evidence.

## It is deliberately not presented as a fix

The extension patches `MarkType.create` and monkey-patches
`Y.Text.prototype.applyDelta` from outside the library. That is defensible for a
stopgap we own and maintain; it is not something to recommend to TipTap or to
their other users, and the README says so explicitly.

Its role in the report is diagnostic. Suppressing the spurious `textStyle` write
takes the matrix from 30/34 to 34/34, which localises the defect to the writeback
path — the client emitting a mark change nobody made, and the comment-only path
discarding the whole update rather than only the disallowed part of it. Either
end could be fixed; both are deeper in the collab chain than a client extension
can properly reach.

Do not "helpfully" upgrade the language to recommend it, and do not fold the
directory back into `tests/` on the grounds that it is a single file. The
separation is the point.

## Consequences

- `tests/` may import from `workaround/`; never the reverse.
- If TipTap fixes either cause, this directory and the `probes` project go away
  together. Nothing else in the repo depends on the workaround existing.

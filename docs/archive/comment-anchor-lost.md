# Issue 1: Comment-only inline thread lost on `textStyle`

[← back to the README](../../README.md)

> **Archived 2026-11-09: no longer reproduces.** Against collab server 3.108.2 the comment matrix keeps every anchor: 17/17 on y-tiptap 3.0.9, and 16/17 on 3.0.10, where the one red case is a block comment lost to [issue 5](../position-migrations.md). The client still writes the `null` attributes (the offline file is still 1 of 2 red), but the server now accepts them. Kept for the record and in case it returns; see [the archive](README.md).

Creating an inline comment on text that carries a `textStyle` mark loses the **document anchor** after sync. The thread exists locally before sync; after comment-only sync `inlineThread` is gone. Unstyled and bold text keep the anchor.

```sh
pnpm test:archive tests/archive/inline                                   # needs Docker
pnpm exec vitest run tests/archive/inline/writeback-null-attrs.test.ts   # offline, under a second
```

## Cause: adding a comment rewrites `textStyle`

A production editor registers Color, FontSize, BackgroundColor and FontFamily on `textStyle`. A mark that sets only one of them carries the other three as `null` in the ProseMirror schema, while the server stores only the one that was set.

Adding `inlineThread` changes the run's marks, so y-prosemirror re-syncs the text in `updateYText`. That re-applies every mark on the run as a retain delta, unchanged marks included:

```js
ytext.applyDelta(
  content.map((c) => ({ retain: c.insert.length, attributes: c.attributes }))
)
```

`textStyle` goes out as `{ backgroundColor, color: null, fontFamily: null, fontSize: null }`. Yjs compares format values key by key, so the extra `null` keys count as a change, and the client writes a `textStyle` edit nobody made. y-prosemirror's own `equalAttrs` ignores `null` keys and would call the two values equal; the write does not consult it.

On a comment-only connection the server rejects that `textStyle` write, and drops the `inlineThread` mark in the same update.

[`tests/archive/inline/writeback-null-attrs.test.ts`](../../tests/archive/inline/writeback-null-attrs.test.ts) shows the write offline: the server's sparse value, then the dense one after a comment. [`tests/archive/inline/comment.test.ts`](../../tests/archive/inline/comment.test.ts) shows the lost anchor against a real server.

### Correction to our first report

Our first report named the hashed keys of overlapping marks (`marksToAttributes`) as the root cause. That hashing is shape-sensitive too, but `textStyle` is not an overlapping mark. It is stored under its name, so the hash plays no part in these failures. We have removed the test that demonstrated it.

## Measured

`tests/archive/inline/comment.test.ts` crosses five seeds with selection scenarios: exact, partly overlapping, two threads on separate parts, and two on overlapping parts. That gives 17 cases.

| Seed | Stock | With `CollabWriteback` |
|---|---|---|
| block-level | kept | kept |
| undecorated text | kept | kept |
| bolded text | kept | kept |
| **text with a single style** (`backgroundColor`) | **lost, all 4 scenarios** | kept |
| text with all four styles set | kept | kept |

Stock is **13/17**; with the workaround, **17/17**.

## Writable vs read-only

The write happens either way; only the consequence differs. On a writable connection it is accepted, so the anchor survives and a `textStyle` edit the user never made lands silently in the document history. On a comment-only connection the server rejects it and the anchor goes with it. `editor.editable` does not control this; the JWT does.

## Where we think the fix belongs

Either end would close it:

1. **y-prosemirror writes marks that have not changed.** Comparing with its own `equalAttrs` before re-applying a mark, or leaving `null` defaults out of the written value, would stop the write.
2. **The comment-only check discards the whole update.** Rejecting only the disallowed `textStyle` write would keep the `inlineThread` mark.

## Our interim workaround (not a recommendation)

`workaround/` is what we run in production while this is open ([its README](../../workaround/README.md)). **Do not treat it as a fix.** It patches how `Y.Text` writes marks, from outside the library.

Its value here is diagnostic. Where y-prosemirror writes a mark that says the same as the one Yjs stores, it leaves that mark out of the write, so the stored one stays. That alone takes the matrix to 17/17, which places the defect in the write rather than in comments. Two other client-side extensions were tried beside it and dropped. One wrote `textStyle` without its `null` keys and added nothing. The other compacted the stored value, and it broke the two multi-thread cases on a four-attribute mark, because removing keys is itself a shape change.

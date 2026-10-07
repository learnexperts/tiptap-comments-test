# Comment-only inline thread lost on `textStyle`

[← back to the README](../README.md)

Creating an inline comment on text that carries a `textStyle` mark loses the **document anchor** after sync. The thread exists locally before sync; after comment-only sync `inlineThread` is gone. Unstyled, bold, and italic text keep the anchor.

## Root cause: y-prosemirror hashes structured attribute values

The trigger is how y-prosemirror keys **overlapping marks** in Yjs. From `marksToAttributes` (y-prosemirror 1.3.7):

```js
pattrs[isOverlapping
  ? `${mark.type.name}--${hashOfJSON(mark.toJSON())}`
  : mark.type.name] = mark.attrs;
```

`inlineThread` is an overlapping mark — several threads may cover the same run — so its Yjs attribute *key* embeds a SHA-256 of the mark's JSON. `hashOfJSON` serialises with lib0's `encodeAny`, which walks object keys in insertion order, making the hash sensitive to the **shape** of the value rather than its meaning:

| Mark JSON | Key suffix |
|---|---|
| `{ attrs: { a: 1, b: 2 } }` | `4pRwNP5eTa7c` |
| same keys, reordered | `keCQGKCMl/Va` |
| plus one `null` field | `Cgn9mADkCpBC` |
| one field removed | `ILgx/qYfikVX` |

Any attribute with a structured value is susceptible. If fields are added, removed or reordered — even incidentally, by a schema difference between two clients — the key changes. y-prosemirror then emits a removal of the old key and an insertion of the new one, and the transaction reads as though the user edited the mark when nothing about it changed.

[`tests/attribute-hashing.test.ts`](../tests/attribute-hashing.test.ts) demonstrates this offline, with no collab server and no licence key. Two clients whose schemas differ only in that one declares an extra optional attribute, left unset, produce different Yjs keys for the same mark. Worse, when the wider client opens a document written by the narrower one, **attaching changes nothing — but the next edit anywhere in the document rewrites the key**:

```
as written by the narrow client : marker--yIpmiTPS
after the wide client attaches  : marker--yIpmiTPS
after an unrelated edit         : marker--AVeHEIZY
```

The edit in that last step appends one character at the end of the paragraph and touches neither the marked run nor any of its attributes.

That test asserts the behaviour we expect — that the two keys match — so it fails today and turns green when the defect is fixed.

The same shape-sensitivity applies to non-overlapping marks through their *values*: `updateYText` unconditionally re-applies the whole attribute bag as a retain delta, so a `textStyle` value that differs only in which keys are present is written as a change.

## How that produces the lost anchor

A production editor registers Color, FontSize, BackgroundColor and FontFamily on `textStyle`. A mark that sets only one of them carries the other three as `null` in the ProseMirror schema, so the client's value is a different shape from the sparse one the server stored. Adding a comment therefore emits a `textStyle` write nobody asked for, alongside the `inlineThread` mark. On a comment-only connection the server rejects that write — and drops the `inlineThread` with it.

Measured by the matrix (see [Test layout](../README.md#test-layout)):

| Client schema | Seed | Anchor after comment-only sync |
|---|---|---|
| Full kit, no workaround | `textStyle` with one attr set, three `null` | **lost** — all four selection scenarios |
| Full kit, no workaround | `textStyle` with all four attrs set | kept — the shapes already match |
| Full kit, no workaround | unstyled, bold, or block-level | kept — no structured attribute value |
| Full kit + `CollabWriteback` | every seed and selection in the matrix | **kept** |

## Where we think the fix belongs

We are not proposing a fix. Both candidate causes sit deeper in the collab chain than a client extension can properly reach:

1. **y-prosemirror compares structured attribute values by shape, not by meaning.** Hashing `mark.toJSON()` into the attribute key makes two semantically identical marks collide-or-differ on key order and on the presence of `null` fields. Comparing canonically — or excluding `null`-valued fields from the hash, as `equalAttrs` already does elsewhere in the same file — would stop the spurious write being generated at all.
2. **The comment-only path discards the whole update.** Rather than rejecting just the disallowed `textStyle` write, it drops the accompanying `inlineThread` mark too, and the anchor goes with it.

Fixing either would close the defect. (1) is the more general problem: it affects any mark with a structured attribute value, not just this one. `tests/writeback-null-attrs.test.ts` shows the spurious write offline; `tests/comment.test.ts` shows the combined result against a real server.

## Our interim workaround (not a recommendation)

`workaround/` is what we run in production while this is open ([its README](../workaround/README.md)). **Do not treat it as a fix.** For this defect it patches how `Y.Text` writes marks, from outside the library — acceptable as a stopgap we own, not as guidance for anyone else.

Its value to this report is diagnostic. Where y-prosemirror writes a mark that says the same as the one Yjs stores, it leaves the stored one in place, hashed key included — that is, it neutralises the shape-sensitivity from outside. Doing so takes the matrix from 30/34 to **34/34**, which is what localises the defect to the comparison described above. How it got there, including mechanisms deleted for doing no work or doing harm, is in [its history](../workaround/README.md#history). Two other candidate extensions were tried; one is redundant and one is harmful — see [What the workaround fixes](#what-the-workaround-fixes).

An `appendTransaction` that strips nulls from the ProseMirror doc does **not** work on its own: `mark.create({ backgroundColor })` still merges schema `default: null` from Color / FontSize / FontFamily before writeback sees it.

Tests: see [Test layout](../README.md#test-layout).

## Writable vs read-only

The shape-sensitive write happens either way; only the consequence differs.

On a **writable** local Y.Doc, applying `inlineThread` writes `textStyle` back from the ProseMirror schema. The rewrite is accepted, so the **new mark survives** — the spurious `textStyle` edit lands silently in the document history.

On **read-only + `commentDocumentNames`**, the client may not persist that rewrite. The server rejects it and the **anchor is lost** with it. `editor.editable` does not control this; the JWT does. The same defect is therefore invisible on writable connections and destructive on comment-only ones.

## The matrix

`tests/comment.test.ts` and the probe run one shared definition (`tests/utils/commentMatrix.ts`), so the only variable between them is the extension list.

Five seeds — block-level, undecorated text, bolded text, text with a single style (`backgroundColor`), text with multiple styles (all four `textStyle` attrs). Four selection scenarios on the four text seeds — exact, partially overlapping (crossing one mark boundary), two threads on disjoint parts, two threads on overlapping parts. 17 cases, 34 tests.

## What the workaround fixes

| Seed | Stock | With `CollabWriteback` |
|---|---|---|
| block-level | pass | pass |
| undecorated text | pass | pass |
| bolded text | pass | pass |
| **single style** (`backgroundColor`) | **fails all 4 scenarios** | pass |
| multiple styles (all four attrs) | pass | pass |

Stock is **30/34**; adding `CollabWriteback` alone is **34/34**. Both deterministic across repeated runs.

`CollabWriteback` on its own is sufficient. Measured against the same matrix:

| Configuration | Result |
|---|---|
| `CollabWriteback` | 34/34 |
| `CollabWriteback` + `SparseTextStyleDefaults` | 34/34 |
| `CollabWriteback` + `CompactTextStyleYAttrs` | **32/34** |

`SparseTextStyleDefaults` is redundant once `CollabWriteback` is applied. `CompactTextStyleYAttrs` is actively harmful, and the root cause explains why: it *removes* keys from the attribute value, which is precisely the incidental shape change that makes y-prosemirror treat the mark as edited. It breaks the two multi-thread cases on a four-attribute `textStyle` mark, which pass both without it and on stock. Neither extension is in the repo any more; both results are recorded here so the experiment need not be repeated.

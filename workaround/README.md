# `workaround/`

The client-side stopgap we run in production while the two defects in this report are open. It is **evidence, not a remedy** ([ADR 0002](../docs/adr/0002-workaround-is-evidence-not-a-remedy.md)). It patches ProseMirror and Yjs internals from outside the libraries, which is acceptable for something we own, not as guidance for anyone else.

## Interface

One extension: `CollabWriteback`, from `workaround/collabWriteback.ts`.

```ts
new Editor({
  extensions: [/* schema */, CollabWriteback, Collaboration.configure({ ... }), CommentsKit.configure({ ... })],
});
```

- It needs `Collaboration` on the same editor, and **throws** without it.
- It affects only that editor's Collaboration fragment, and only while y-prosemirror writes ProseMirror → Yjs. Other editors in the process are left stock, whether they share the document or not. One document may hold several editors' fragments, each with its own schema.
- Destroying the editor takes its fragment back out of scope.

Nothing else is exported for `tests/`. Biome enforces both directions: `tests/` may import only `workaround/collabWriteback`, and `workaround/` never imports from `tests/`. The other files are internal:

| File | Holds |
|---|---|
| `collabWriteback.ts` | The extension |
| `markWriteback.ts` | Mechanism 1, and mechanism 3 for marks |
| `elementWriteback.ts` | Mechanism 2, and mechanism 3 for elements |
| `writebackScope.ts` | Which writes are in scope (y-sync transactions on registered fragments), each fragment's node and mark defaults, and the one rule both halves of mechanism 3 apply |

Its contract is tested offline beside it, in [`collabWriteback.test.ts`](collabWriteback.test.ts) (`pnpm test:workaround`, green, run on pre-push). The test is self-contained so it obeys the same rule and travels with the directory.

## Mechanisms

| # | Mechanism | Defect | Needed by |
|---|---|---|---|
| 1 | Every mark type's `create` leaves out attributes it was not given whose default is `null`. A mark read from Yjs keeps its stored key order; any other mark is sorted by key | [Inline anchor lost on `textStyle`](../docs/comment-anchor-lost.md) | the four single-style cases in the comment matrix; a block anchor on styled text; any mark whose attributes several extensions declare |
| 2 | A rebuilt block takes the replaced element's key order and key set | [Block anchor undone](../docs/block-anchor-undone.md) | every block stored out of schema order or without a default |
| 3 | A write is skipped when it would say the same as what Yjs stores: a schema default for a key the stored element or mark value lacks | [Block anchor undone](../docs/block-anchor-undone.md); [inline anchor lost](../docs/comment-anchor-lost.md) | an inline anchor on a block stored without a default; keeps 2's copies stable; a mark stored without a non-null default |

### Ablation

Each mechanism was removed in turn and the comment matrix, the block probe and the offline tests re-run against a real server. Two former mechanisms were deleted as a result.

| Removed | Comment matrix | Block probe | Offline | Outcome |
|---|---|---|---|---|
| nothing | 34/34 | 23/23 | — | — |
| 1 mark create (then `textStyle` only) | **30/34** | 1 red | 2 red | kept, since generalised |
| `appendTransaction` sparsifier | 34/34 | 23/23 | fixes a red | **deleted** |
| `Y.Text.applyDelta` retain strip | 34/34 | 23/23 | — | **deleted** |
| sparsifier and retain strip together | 34/34 | 23/23 | — | confirms both redundant |
| 2 key-order alignment | 34/34 | **6 red** | — | kept |
| 3 default skip | 34/34 | **1 red** | — | kept |

The block probe here is the investigation's original 23 comment-only cases, which `tests/utils/blockMatrix.ts` distils.

Mechanism 1 was ablated when it covered only `textStyle` and sorted every mark's keys. It now covers every mark type, with two changes that make that safe:

- **It drops only `null`-default keys.** A non-null default is behaviour (a link's `target`).
- **It sorts only new marks.** A mark built from Yjs keeps the stored key order, because y-prosemirror keys an overlapping mark (such as `inlineThread`) by a hash of its JSON, which depends on order. Re-sorting a mark that a stock client stored would compute a different key and rewrite it. "Built from Yjs" means its attrs object is one `Y.Text.toDelta()` returned, which y-prosemirror passes straight to `schema.mark`, so `toDelta` tags those objects. Sorting is by code unit, not locale, so every client sorts the same way.

Both matrices are unchanged by the generalisation, and the contract test pins each half of the ordering rule.

**Why the two were deleted:**

- **The sparsifier did harm.** It re-wrote every `textStyle` mark without its `null` keys. When Yjs already stores a mark with `null`s, written by a client with a wider schema, that is a `textStyle` write nobody made, which is exactly what a comment-only connection undoes.
- **The retain strip was redundant.** With mechanism 1 the written value equals the stored one, and Yjs does not rewrite an equal format. A comment writes no `textStyle` without it.

Mechanism 3 was ablated when it covered only elements. It now covers marks too, under the same rule (`saysTheSameAs` in `writebackScope.ts`). A mark keeps a non-null default it was not stored with, because the default is behaviour (a link's `target`) and must still render. Its write is where the default is dropped: a scoped `Y.Text.applyDelta` patch swaps in the stored value wherever the written one says the same, so Yjs sees an equal format and writes nothing. That is narrower than the deleted retain strip, which dropped any unchanged format, and no matrix case needs it; the contract test fails without it.

### Limits

An **overlapping mark** (several may cover one run, such as `inlineThread`) stored without a non-null default is still rewritten with it. y-prosemirror keys an overlapping mark in Yjs by a hash of its JSON, so the default changes the key before any value can be compared. No known overlapping mark hits this: `inlineThread`'s one attribute is always stored.

## When to delete it

The two halves have independent removal conditions:

- **Mechanism 1, and mechanism 3 for marks,** go when the inline defect is fixed: y-prosemirror compares mark values by meaning, or the comment-only check stops discarding the whole update.
- **Mechanism 2, and mechanism 3 for elements,** go when the block defect is fixed: the comment-only check compares element attributes as a set and treats absent as default, or y-prosemirror stops rebuilding unchanged elements.

The matching red tests in `pnpm test` turning green is the signal for each half.

## Copying into lex-frontend

lex-frontend runs a copy of this directory. Copy the `.ts` files as they are, test included, and record the source commit in the header comment of the copy's `collabWriteback.ts`. Don't hand-merge.

- **Formatting:** lex-frontend's formatter will reformat the copy. Accept the format-only diff, and compare copies with a diff that ignores whitespace and semicolons.
- **Tests:** `collabWriteback.test.ts` comes with the copy and tests through `CollabWriteback` on real editors. Replace lex-frontend's tests of internal helpers with it; they break on every internal change.
- **Last synced:** not yet. lex-frontend's copy predates the element writeback and the per-fragment scope.

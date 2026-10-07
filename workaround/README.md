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
| `collabWriteback.ts` | The extension, and mechanism 1 |
| `elementWriteback.ts` | Mechanisms 2 and 3 |
| `writebackScope.ts` | Which writes are in scope: y-sync transactions on registered fragments, and each fragment's schema defaults |

Its contract is tested offline beside it, in [`collabWriteback.test.ts`](collabWriteback.test.ts) (`pnpm test:workaround`, green, run on pre-push). The test is self-contained so it obeys the same rule and travels with the directory.

## Mechanisms

| # | Mechanism | Defect | Needed by |
|---|---|---|---|
| 1 | `textStyle` `MarkType.create` keeps only the keys it was given | [Inline anchor lost on `textStyle`](../docs/comment-anchor-lost.md) | the four single-style cases in the comment matrix; a block anchor on styled text |
| 2 | A rebuilt block takes the replaced element's key order and key set | [Block anchor undone](../docs/block-anchor-undone.md) | every block stored out of schema order or without a default |
| 3 | A schema default is not written onto an existing element that lacks it | [Block anchor undone](../docs/block-anchor-undone.md) | an inline anchor on a block stored without a default; keeps 2's copies stable |

### Ablation

Each mechanism was removed in turn and the comment matrix, the block probe and the offline tests re-run against a real server. Two former mechanisms were deleted as a result.

| Removed | Comment matrix | Block probe | Offline | Outcome |
|---|---|---|---|---|
| nothing | 34/34 | 23/23 | — | — |
| 1 `textStyle` create | **30/34** | 1 red | 2 red | kept |
| `appendTransaction` sparsifier | 34/34 | 23/23 | fixes a red | **deleted** |
| `Y.Text.applyDelta` retain strip | 34/34 | 23/23 | — | **deleted** |
| sparsifier and retain strip together | 34/34 | 23/23 | — | confirms both redundant |
| 2 key-order alignment | 34/34 | **6 red** | — | kept |
| 3 default skip | 34/34 | **1 red** | — | kept |

The block probe here is the investigation's original 23 comment-only cases, which `tests/utils/blockMatrix.ts` distils.

**Why the two were deleted:**

- **The sparsifier did harm.** It re-wrote every `textStyle` mark without its `null` keys. When Yjs already stores a mark with `null`s, written by a client with a wider schema, that is a `textStyle` write nobody made, which is exactly what a comment-only connection undoes.
- **The retain strip was redundant.** With mechanism 1 the written value equals the stored one, and Yjs does not rewrite an equal format. A comment writes no `textStyle` without it.

## When to delete it

The two halves have independent removal conditions:

- **Mechanism 1** goes when the inline defect is fixed: y-prosemirror compares mark values by meaning, or the comment-only check stops discarding the whole update.
- **Mechanisms 2 and 3** go when the block defect is fixed: the comment-only check compares element attributes as a set and treats absent as default, or y-prosemirror stops rebuilding unchanged elements.

The matching red tests in `pnpm test` turning green is the signal for each half.

## Copying into lex-frontend

lex-frontend runs a copy of this directory. Copy the `.ts` files as they are, test included, and record the source commit in the header comment of the copy's `collabWriteback.ts`. Don't hand-merge.

- **Formatting:** lex-frontend's formatter will reformat the copy. Accept the format-only diff, and compare copies with a diff that ignores whitespace and semicolons.
- **Tests:** `collabWriteback.test.ts` comes with the copy and tests through `CollabWriteback` on real editors. Replace lex-frontend's tests of internal helpers with it; they break on every internal change.
- **Last synced:** not yet. lex-frontend's copy predates the element writeback and the per-fragment scope.

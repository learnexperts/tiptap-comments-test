# `workaround/`

The client-side stopgap we run in production while issues 2 and 5 of this report are open, and that covered issues 1 and 4 before they were [archived](../docs/archive/README.md). It is **evidence, not a remedy** ([ADR 0002](../docs/adr/0002-workaround-is-evidence-not-a-remedy.md)). It patches ProseMirror and Yjs internals from outside the libraries, which is acceptable for something we own, not as guidance for anyone else.

## Interface

One extension: `CollabWriteback`, from `workaround/collabWriteback.ts`.

```ts
new Editor({
  extensions: [
    /* schema */,
    CollabWriteback.configure({ commentOnly: () => !canEdit() }),
    Collaboration.configure({ ... }),
    CommentsKit.configure({ ... }),
  ],
});
```

- It needs `Collaboration` on the same editor, and **throws** without it.
- `commentOnly` (default `false`): whether the session may only comment, as a boolean or a function read at every write. Only mechanism 5 reads it; mechanisms 1 to 4 run for every session.
- It affects only that editor's Collaboration fragment, and only while y-prosemirror writes ProseMirror → Yjs. Other editors in the process are left stock, whether they share the document or not. One document may hold several editors' fragments, each with its own schema.
- Destroying the editor takes its fragment back out of scope.

Nothing else is exported for `tests/`. Biome enforces both directions: `tests/` may import only `workaround/collabWriteback`, and `workaround/` never imports from `tests/`. The other files are internal:

| File | Holds |
|---|---|
| `collabWriteback.ts` | The extension |
| `markWriteback.ts` | Mechanism 1 |
| `elementWriteback.ts` | Mechanisms 2, 3 and 4 |
| `positionMigrations.ts` | Mechanism 5 |
| `writebackScope.ts` | Which writes are in scope (y-sync transactions on registered fragments), each fragment's node and mark defaults, and `saysTheSameAs`, the rule every mechanism applies |
| `patchMethod.ts` | Replaces a prototype method once, however many editors install it |

Its contract is tested offline beside it, in [`collabWriteback.test.ts`](collabWriteback.test.ts) (`pnpm test:workaround`, green, run on pre-push). The test is self-contained so it obeys the same rule and travels with the directory.

## Mechanisms

Mechanisms 1 to 4 apply one rule: a write that would **say the same** as what Yjs stores is written as it is stored, or not at all. That means every stored attribute unchanged, and anything extra at its schema default, `null` included. Mechanism 5 is different: it drops a write, y-tiptap's position-migration record, that an editor needs and a comment-only session does not, so it runs only while `commentOnly` holds. None of them changes a ProseMirror node or mark. The app sees exactly what stock Tiptap gives it; only what is written to Yjs changes.

| # | Mechanism | Defect | Needed by |
|---|---|---|---|
| 1 | A mark written to `Y.Text` that says the same as the stored one is left out of the write, so Yjs leaves its markers as stored. For an overlapping mark that means keeping the stored key, see below | [Inline anchor lost on `textStyle`](../docs/archive/comment-anchor-lost.md); [inline anchor undone where styles overlap](../docs/archive/comment-anchor-overlapping-styles.md) | the four single-style cases in the comment matrix; a block anchor on styled text; any mark stored sparser than this client's schema; every overlapping-style case in issue 4 |
| 2 | A rebuilt block takes the replaced element's key order and key set | [Block anchor undone](../docs/block-anchor-undone.md) | every block stored out of schema order or without a default |
| 3 | A schema default is not written onto a stored element that lacks it | [Block anchor undone](../docs/block-anchor-undone.md) | an inline anchor on a block stored without a default; keeps 2's copies stable |
| 4 | A rebuilt block keeps the empty text the replaced element held | [Block anchor undone](../docs/block-anchor-undone.md#an-emptied-block-keeps-an-empty-text) | a block anchor on a paragraph whose text was deleted |
| 5 | While `commentOnly` holds, the editor writes its changes without y-tiptap's position-migration record. It patches this editor's binding (`_prosemirrorChanged(doc, plan)`, an internal) when the view is built | [Position-migration record](../docs/position-migrations.md) | every block comment on y-tiptap 3.0.10, and an inline comment on a page with an emptied block: without it, issue 2's matrix is 1/12 and issue 5's 3/10 |

### Overlapping marks

y-prosemirror stores an exclusive mark (`textStyle`, `bold`, `link`) under its name, so a written value can be compared with the stored one directly. An overlapping mark, one of which several may cover the same text (`inlineThread`), is stored under its name plus a hash of its JSON. A shape difference therefore changes the key, and the write arrives as "remove the stored key, add a new one". Mechanism 1 pairs the two halves: if the new value says the same as the stored one, both are dropped and the stored mark stays exactly as it was. That covers a mark stored sparser than this schema (missing `null` or non-null defaults) and one stored denser, with `null`s a stock client wrote. The contract test pins each case.

### History

Each mechanism was removed in turn, and the comment matrix, the block probe and the offline tests re-run against a real server.

| Removed | Comment matrix | Block probe | Offline | Outcome |
|---|---|---|---|---|
| nothing | 34/34 | 23/23 | — | — |
| `textStyle` `create` patch | **30/34** | 1 red | 2 red | needed, later replaced; see below |
| `appendTransaction` sparsifier | 34/34 | 23/23 | fixes a red | **deleted** |
| `Y.Text.applyDelta` retain strip | 34/34 | 23/23 | — | **deleted** |
| sparsifier and retain strip together | 34/34 | 23/23 | — | confirms both redundant |
| 2 key-order alignment | 34/34 | **6 red** | — | kept |
| 3 default skip | 34/34 | **1 red** | — | kept |
| 4 empty text kept | — | block matrix: **1 red** | 1 red | kept |

The comment matrix then had 34 tests, two per case; it now has one per case, 17. The block probe here is the investigation's original 23 comment-only cases, which `tests/utils/blockMatrix.ts` distils. Mechanism 4 came later and was ablated against that matrix instead; the comment matrix wraps no emptied block, so it was not re-run.

- **The sparsifier did harm.** It re-wrote every `textStyle` mark without its `null` keys. When Yjs already stores a mark with `null`s, written by a client with a wider schema, that is a `textStyle` write nobody made, which is exactly what a comment-only connection undoes.
- **The retain strip was redundant** next to the `create` patch, which made the written value equal the stored one.
- **The `create` patch was replaced by mechanism 1.** It built every mark sparse inside ProseMirror. That needed the private `Mark` constructor and tagging values read from Yjs, and it changed `mark.attrs` for the whole app (`undefined` where Tiptap gives `null`). Mechanism 1 gets the same result where Yjs is written, and also covers the overlapping-mark cases the `create` patch could not. Sorting new marks' keys went with it.
- **A `Mark.prototype.toJSON` patch was tried and rejected.** It could only strip `null`s before hashing, so it rewrote overlapping marks that a stock client had stored with them.
- **Mechanism 1 now leaves a mark out instead of writing the stored value back.** Issue 4 needed it: writing any value, even the stored one, makes Yjs format the run for that mark, and on the way it deletes a dead marker that overlapping styles left. Writing the stored value kept issue 4 at 8 of 12; leaving the mark out takes it to 12/12, with issues 1 and 2 unchanged at 17/17 and 12/12. Also dropping `null` writes for marks the text does not have made no difference to any of the three, so it was left out.

## When to delete it

The inline and block defects have independent removal conditions:

- **Mechanism 1** goes when both inline defects are fixed. Both no longer reproduce against server 3.108.2 and are archived, so its removal is due once an ablation shows nothing still open needs it (the mechanism table lists a block anchor on styled text). Issue 1: y-prosemirror compares mark values by meaning, or the comment-only check stops discarding the whole update. Issue 4: the comment-only check judges styles by value rather than by the markers an update touches, or Yjs stops leaving dead markers or deleting them on a later write.
- **Mechanism 5** goes when issue 5 is fixed: the comment-only check allows the `__tiptap_position_migrations:*` roots, or y-tiptap stops writing a record for a session that cannot edit.
- **Mechanisms 2 to 4** go when the block defect is fixed: the comment-only check compares element attributes as a set, treats absent as default and an empty text as no text, or y-prosemirror stops rebuilding unchanged elements.

It does not cover the other two ways a guest's block comment is undone: `trailingNode` adding a paragraph ([consumer-side](../docs/block-anchor-trailing-node.md)), and a fragment the server does not know ([server-side](../docs/archive/block-anchor-fragments.md), now archived). Neither is a write that says the same as what Yjs stores. Nor does it cover a comment-only user's undo, which writes a position-migration record through y-tiptap's undo path; that is untested.

The matching red tests in `pnpm test` turning green is the signal for each.

## Copying into lex-frontend

lex-frontend runs a copy of this directory. Copy the `.ts` files as they are, test included, and record the source commit in the header comment of the copy's `collabWriteback.ts`. Don't hand-merge.

- **Formatting:** lex-frontend's formatter will reformat the copy. Accept the format-only diff, and compare copies with a diff that ignores whitespace and semicolons.
- **Tests:** `collabWriteback.test.ts` comes with the copy and tests through `CollabWriteback` on real editors. Replace lex-frontend's tests of internal helpers with it; they break on every internal change.
- **`commentOnly`:** lex-frontend adds `CollabWriteback` to every editor, editors included, so pass `commentOnly` as a function of the session's live permissions (the same one `ReadOnlyWriteGuard` reads), never `true`. A copy on y-tiptap 3.0.10 without mechanism 5 loses every guest block comment.
- **Last synced:** not recorded here; the commit is in the header of lex-frontend's copy. Any copy taken before mechanism 4 rebuilds an emptied block without its empty text, and any copy taken before mechanism 1 left unchanged marks out loses a guest's comment on overlapping styles, so re-copy once both land.

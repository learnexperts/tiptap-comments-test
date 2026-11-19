# Issue 5: y-tiptap 3.0.10's position-migration record undoes comment-only comments

[← back to the README](../README.md)

```sh
pnpm test:migrations                                              # needs Docker
pnpm exec vitest run tests/migrations/migration-record.test.ts    # offline, under a second
```

Since `@tiptap/y-tiptap` 3.0.10, a comment-only user's comment can carry a write to a root type the connection may not touch. The comment appears locally, then the server undoes the whole update, and the thread is left with nothing in the document to point at. It hits:

- **every block comment**, whatever the document looks like;
- **an inline comment** while the document holds a block that was emptied of its text, wherever on the page the comment is.

The server logs the extra root:

```
Undoing change to document <doc> from guest:<sub> because non-allowed type was touched. Touched types: __tiptap_position_migrations:root:default.
Undoing change to document <doc> from guest:<sub> because non-allowed type was touched. Touched types: default, __tiptap_position_migrations:root:default.
```

The first is an inline comment, the second a block comment. 3.0.9 writes neither root, and every case below keeps its comment.

## What the record is for

Yjs anchors a relative position (a remote cursor, a selection kept across a remote change, an undo step's selection, a stored anchor) to a specific item. When y-prosemirror reconciles a split, merge or move, it may delete items and insert new ones, so those positions fall back to wherever the deleted item was. 3.0.10 records which old item became which new one, so that positions follow the text. Its readers are `relativePositionToAbsolutePosition`, `restoreRelativeSelection` and the undo plugin.

`ProsemirrorBinding._prosemirrorChanged` writes the record in the same transaction as the content (`applyPositionMigration` → `writePositionMigration`), so peers receive both together. Each record is keyed `<clientID>:<clock>` and holds the client's whole state vector (`seen`) plus the transfers. The root is named after the fragment: `__tiptap_position_migrations:root:<name>` for a root fragment, `__tiptap_position_migrations:item:<client>:<clock>` for one nested in a map, which is how lex-frontend stores pages.

## When a comment writes one

The sync plugin builds a migration plan for every local transaction whose steps are not all plain text replacements (`mapPositionMigration`). Adding a mark is an `AddMarkStep` and wrapping a block is a `ReplaceAroundStep`, so every comment gets a plan. Whether the plan produces any transfers, and so a record, depends on the document:

- **A block comment always does.** The wrap deletes the block and inserts a copy inside `blockThread`, so the old element and its text have new identities to transfer to.
- **An inline comment does only where a block was emptied of its text.** When an author deletes all of a paragraph's text, or splits a paragraph at its very start, y-prosemirror keeps that paragraph's empty `Y.XmlText` rather than deleting it (the same empty text as in [issue 2](block-anchor-undone.md#an-emptied-block-keeps-an-empty-text)). `getPositionContent` lists it in `emptyTexts`, and `getPositionNodeTransfers` compares its id with the id of the element at its position, the paragraph's. They never match, so every plan transfers the empty text's boundaries to the paragraph's, and the record is written. A split mid-text, a merge, a move, or an empty paragraph with no text child (pressing Enter at the end of a line) leave none, and the comment is kept.

That second case writes a record for every client, not only comment-only ones, on every mark or other non-text edit, for as long as the emptied block exists, and each record copies the client's state vector. It is not a transfer anything reads.

The plan also makes y-tiptap re-write the text of every block through `updateYText`, so a comment writes formatting it did not change. Today's server accepts that; it is why the archived issue 4 mechanism file is all red on 3.0.10.

## What we tested

[`tests/migrations/migration-record.test.ts`](../tests/migrations/migration-record.test.ts) shows the write offline. An author edits; a second client then comments on the last paragraph, which no edit touches. Each case asserts the commenter wrote only to `default`:

| The author first | Inline comment | Block comment |
|---|---|---|
| does nothing | `default` | **+ migration record** |
| splits a paragraph mid-text | `default` | **+ migration record** |
| merges two paragraphs | `default` | **+ migration record** |
| splits a paragraph at its start | **+ migration record** | **+ migration record** |
| deletes a paragraph's text | **+ migration record** | **+ migration record** |

[`tests/migrations/position-migrations.test.ts`](../tests/migrations/position-migrations.test.ts) runs the same ten cases against a real server: the author on a full-rights connection, the commenter on a comment-only one. The paragraphs are seeded with every non-null default, so [issue 2](block-anchor-undone.md) plays no part. The seven marked cases lose their anchor, and the other three keep it.

On 3.0.10 this also turns every stock block comment in [issue 2's matrix](../tests/block/block-anchor.test.ts) red, whatever the block. With the record dropped, that matrix is back to issue 2's own two cases.

## Where we think the fix belongs

Either end would close it:

1. **The comment-only check allows the record.** It is bookkeeping about identities, not content: a comment-only connection writing it changes nothing anyone reads as the document.
2. **y-tiptap writes no record for a connection that cannot edit,** or only when an edit actually moved an identity. The empty-text transfer above should not be written by anyone.

## The workaround

Mechanism 5 dropped the record while a session could only comment. It was removed in LD-8581: y-tiptap 3.2.0 writes no record, and on it `migration-record.test.ts` passes 10/10. The `writeback` halves now add `CollabWriteback` with no options.

The draft we send Tiptap is in [`tiptap/position-migrations.txt`](tiptap/position-migrations.txt).

# Issue 6: Resolving a thread removes its anchor, and it may never come back

[← back to the README](../../README.md)

> **Archived 2026-11-18: fixed in comments 3.12.9.** 3.12.9, published the day after this write-up, changelogs it as _"Resolving a comment thread keeps its highlight in the document again, as in versions before 3.12.3"_. Its `resolveThread` only records `resolvedAt` again and the undo sweep is gone: **9/9** against collab server 3.108.2 on y-tiptap 3.0.10. On 3.0.10, 3.12.8 is 7 of 9 red: the paragraph-start case passes there, so that failure was y-tiptap 3.0.9's, and the numbers below were measured on 3.0.9. The Tiptap draft was never sent. Kept for the record and in case it returns; see [the archive](README.md).

```sh
pnpm test:archive tests/archive/resolve    # needs Docker
```

Since `@tiptap-pro/extension-comments` 3.12.2, `resolveThread` removes the thread's anchor from the document: the `inlineThread` mark, or the `blockThread` wrapper. It keeps the anchor's ranges, as Yjs relative positions, in a new root map `__tiptapcollab__resolvedThreadAnchors`, and `unresolveThread` puts the anchor back from there. Up to 3.12.1, `resolveThread` only set `resolvedAt` and the anchor stayed.

Three ways a resolved thread loses its text for good:

1. **A comment-only user resolves it.** The server keeps the anchor removal but undoes the write to `__tiptapcollab__resolvedThreadAnchors`. With no ranges kept, `unresolveThread` returns `false` for everyone, editors included. The server logs:

   ```
   Undoing change to document <doc> from guest:<sub> because non-allowed type was touched. Touched types: __tiptapcollab__resolvedThreadAnchors.
   ```

2. **The thread starts a paragraph.** The ranges are kept, but `unresolveThread` returns `false` when the anchor begins at the paragraph's first character, even for an editor, in the session that resolved it, straight away.

3. **Someone undoes anything.** After every undo or redo, the extension calls `removeThread` on every resolved thread that still has an anchor, whether or not the undo touched it, and keeps no ranges. That covers every thread resolved before 3.12.2, or by a client on an earlier version.

The 3.12.2 changelog entry does not mention the new behaviour: _"Fix overlapping comment highlights when resolving threads, restore their text when reopening, and keep thread state consistent through undo and redo."_

## Why this is serious for us

Resolving is the everyday end of a comment. For a comment-only user, which is most of our reviewers, every comment they resolve is unrecoverable: it can never be reopened on its text. A reviewer resolving by mistake cannot undo it. Every comment that starts a paragraph is the same for everyone, and an author's undo silently strips every highlight resolved before the upgrade.

Nothing fails in the client. `resolveThread` returns `true`, and the loss shows up only when someone tries to reopen.

## How the client does it

From the 3.12.8 build:

- **Resolve.** `resolveThread` captures the anchor's ranges, calls `removeThread({ id, deleteThread: false })`, and adds a `commentThreadHistory` step that sets `resolvedAt`. In a collaborative editor the ranges are saved to the Y.Map `__tiptapcollab__resolvedThreadAnchors`, keyed by thread id, with the collaboration field.
- **Reopen.** `unresolveThread` returns `false` unless the anchor is already in the document or can be rebuilt from the kept ranges.
- **Undo.** After a `prosemirror-history` transaction, and on every `stack-item-popped` of the Yjs `UndoManager`, the extension takes every thread with `resolvedAt` that still has an anchor (suggestion threads aside) and runs `removeThread` on it with `addToHistory: false`. No ranges are captured.
- **No opt-out.** `resolveThread` removes the anchor unconditionally. `onThreadStateChanged` runs after the provider reports the change, so a handler that skips `defaultHandler` still sees the anchor removed, here and on every other client. Its own documentation says _"By default, only permanent deletion removes the anchor."_, and its `defaultHandler` only removes an anchor whose thread no longer exists. `onThreadAnchorRemoved` covers anchors removed by editing.

## What we tested

[`tests/archive/resolve/resolved-thread-anchor.test.ts`](../../tests/archive/resolve/resolved-thread-anchor.test.ts), against a real server on stock Tiptap. Each case comments on plain text, resolves or reopens, and checks the anchor from a fresh connection: the same user after a reload, or another user.

| Case | 3.12.1 | 3.12.8 |
|---|---|---|
| An editor resolves: the anchor is kept | kept | **removed** |
| … with an `onThreadStateChanged` that skips the default handler | kept | **removed** |
| … and reopens after a reload | reopened | reopened |
| A comment-only session resolves: the anchor is kept | kept | **removed** |
| … with an `onThreadStateChanged` that skips the default handler | kept | **removed** |
| … and reopens after a reload | reopened | **`unresolveThread` returns `false`** |
| … and an editor reopens it | reopened | **`unresolveThread` returns `false`** |
| An editor resolves a thread that starts a paragraph and reopens it at once | reopened | **`unresolveThread` returns `false`** |
| An editor undoes an unrelated edit beside a thread resolved with only `resolvedAt`, as 3.12.1 does | kept | **removed** |

Every case asserts what 3.12.1 does, so the red ones are what we ask about below: **8 of 9 red on 3.12.8, 0 of 9 on 3.12.1.** `workaround/` does not touch resolving, so there is no `with the writeback fix` half.

## What we are asking

1. Is removing the anchor on resolve intended? If so, please give us a way to keep it, an option or `onThreadStateChanged`, as the old behaviour.
2. The server should accept a comment-only session's write to `__tiptapcollab__resolvedThreadAnchors`, as it does `__tiptapcollab__threads`. Otherwise the client should not remove an anchor it cannot keep.
3. `unresolveThread` should restore an anchor that starts a paragraph.
4. The undo sweep should only touch threads the undo affected, and keep ranges for any anchor it removes.
5. Is there any way to recover threads already resolved this way?

The draft we send Tiptap is in [`tiptap/resolved-thread-anchor.txt`](tiptap/resolved-thread-anchor.txt).

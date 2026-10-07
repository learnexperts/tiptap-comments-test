# Consumer note: `trailingNode` undoes a block comment on the last block

[← back to the README](../README.md)

**Not reported to Tiptap.** It is ours to fix, so it has no test in the report. It is recorded here because it produces the same symptom as issues 2 and 3.

With StarterKit's `trailingNode` on, which is the default, a comment-only user's block comment on the **last block** is undone on sync. `trailingNode`'s `appendTransaction` runs whatever the editor's `editable` is. Once `blockThread` wraps the last block, the same transaction appends an empty paragraph. That is new content, so the server undoes the whole update, the wrap included.

Measured against the local server on 2026-10-07, with a test written during diagnosis and not kept:

| Block | `trailingNode` | Anchor after sync |
|---|---|---|
| last | on | **undone** |
| last | off | kept |
| before the last | on | kept |

Every editor in this repository turns `trailingNode` off, so the report's tests never meet it. `workaround/` does not cover it either: a new paragraph is not a write that says what Yjs already stores.

**The fix:** editors a comment-only user opens should not append a trailing paragraph while they are read-only. Either configure them with `StarterKit.configure({ trailingNode: false })`, or keep `trailingNode` from appending while `editor.isEditable` is false, which lex-frontend plans to do.

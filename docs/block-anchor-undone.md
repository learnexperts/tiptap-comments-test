# Comment-only block thread undone on attributed blocks

[← back to the README](../README.md)

Creating a **block** comment thread on a comment-only connection loses its anchor after sync whenever the block's stored attributes differ from what the client rebuilds. Nothing errors. The `blockThread` wrapper appears locally, then the server undoes the whole update, and the thread is left with nothing in the document to point at. The server logs:

```
Undoing change to document <doc> from guest:<sub> because non-allowed type was touched. Touched types: default.
```

No `Touched attributes:` entry appears when the cause is an element attribute.

## Mechanism

`setThread` on a node selection runs `wrapIn(blockThread)`. Yjs cannot move an element, so y-prosemirror writes the wrap as a **delete of the block** plus an **insert of `blockThread` holding a copy rebuilt from the ProseMirror node**. `createTypeFromElementNode` writes that copy's attributes in **schema order**, including every non-null default:

```js
for (const key in node.attrs) {
  const val = node.attrs[key]
  if (val !== null && key !== 'ychange') type.setAttribute(key, val)
}
```

The server accepts that delete and insert from a comment-only connection **only when the copy is identical to the deleted element, including the order of its attribute keys.** Any of the following makes the copy differ, and the update is undone:

| Stored element | Rebuilt copy | Result |
|---|---|---|
| `{textAlign, marginLeft}` (schema order) | `{textAlign, marginLeft}` | kept |
| `{marginLeft, textAlign}` | `{textAlign, marginLeft}` | **undone** |
| `codeBlock {theme, language}` | `{language, theme}` | **undone** |
| `paragraph {}` (default not stored) | `{marginLeft: 0}` | **undone** |

The same values in a different key order count as an edit. An editor connection keeps every one of these.

## How stored order drifts

Ordinary editing produces the mismatch. Yjs keeps each attribute key at the position it was first written, so a key set after insert is appended:

- An author inserts a code block, which stores `{theme}`. They then pick a language, and the stored attributes become `{theme, language}`. The schema order is `{language, theme}`.
- An author types a paragraph, which stores `{marginLeft: 0}`. They then centre it, and the stored attributes become `{marginLeft, textAlign}`. The schema order is `{textAlign, …, marginLeft}`.

A comment-only user's block comment on either block is undone. The same block inserted with its attribute already set keeps the comment.

Importing JSON through the server's REST API is another source. The import gives every node of a type the key order of the **first** node of that type it meets. A document whose first paragraph has only `marginLeft` stores every later paragraph as `{marginLeft, textAlign}`, whatever order its JSON gave.

## Missing defaults affect inline anchors too

If a stored element lacks a non-null default, for example from an importer that writes only non-null attributes, y-prosemirror writes the default onto the existing element as soon as it re-syncs that node. Adding an **inline** comment to such a paragraph re-syncs it. The `marginLeft` write rides along with the `inlineThread` mark, and the server undoes both.

## What we tested

[`tests/block-anchor.test.ts`](../tests/block-anchor.test.ts) runs the matrix against a real server on stock Tiptap. It asserts the behaviour we expect, so the cases that lose their anchor are red. [`tests/probes/block-anchor.probe.ts`](../tests/probes/block-anchor.probe.ts) runs the identical matrix with the workaround. Each case attaches the Yjs writes the comment produced as an annotation.

These variations make no difference:

- `@tiptap-pro/extension-comments` and `@tiptap-pro/provider` 3.9.5 vs 3.11.0
- `respectParentSchema` on vs off
- nested vs top-level blocks
- leaf blocks (a horizontal rule)

What matters is only whether the rebuilt copy matches the stored element.

## Where we think the fix belongs

We are not proposing a fix. Either end would close it:

1. **The comment-only check compares element attributes by shape.** Comparing them as a set, without regard to key order, and treating an absent attribute as equal to its schema default, would accept a copy that changes nothing.
2. **y-prosemirror rebuilds rather than moves.** It writes the copy from the ProseMirror node, not from the element it replaces, so the copy's shape depends on schema order instead of stored order.

`workaround/` holds our interim client-side stopgap; see [its README](../workaround/README.md).

# Issue 3: Comment-only block threads undone in a nested fragment

[← back to the README](../README.md)

```sh
pnpm test:fragments    # needs Docker
```

The server keeps a comment-only **block** wrap only in a fragment it knows the type of: the root `XmlFragment` `default`, or another root `XmlFragment` declared `xmlfragment` in the document's typemap. Anywhere else the wrap is undone, even when the copy is identical. A fragment nested in a root `Y.Map` is undone however it is declared. **Inline** comments are kept in every layout.

The server logs the root the update touched:

```
Undoing change to document <doc> from guest:<sub> because non-allowed type was touched. Touched types: pages.
```

## Why this is serious for us

lex-frontend stores every page this way, so a comment-only user's block comment is undone on every page. It appears, then disappears on sync, with no error in the client. The same wrap of the same content is kept in `default`: only where the fragment lives decides it.

The only escape we can see is to move every page of every document to a root fragment declared with `setFieldType`. That is a data migration across all our documents, built on an API Tiptap documents only for webhooks. We need to know whether nested fragments will be supported before we commit to it.

## Declaring a root fragment

The provider declares a root's type with `setFieldType`:

```ts
provider.setFieldType("page:page-1", "xmlfragment");
```

It writes `{ "page:page-1": "xmlfragment" }` into the root map `__tiptapcollab__typemap`. The supported types are `map`, `array`, `text`, `xmlfragment` and `xmlelement`. Tiptap documents it only for [webhook custom fields](https://tiptap.dev/docs/collaboration/core-concepts/webhooks#custom-fields), not for the comment-only check. Without it, a root named anything but `default` is undone just as a nested fragment is.

## A fragment nested in a root map

lex-frontend stores each page as an `XmlFragment` in a root map, `ydoc.getMap("pages").get(pageId)`. A block wrap there is undone in every combination we tried:

- nothing declared
- `pages` declared `map`
- `pages` declared `map` and the fragment declared `xmlfragment` under each of the keys `pages.page-1`, `pages.[page-1]`, `pages[page-1]`, `pages/page-1` and `pages:page-1`, with Collaboration's `field` (which CommentsKit sends as the thread's `field`) set to the same key

The server bundle (`/usr/src/app/dist/index.jsc`, V8 bytecode) contains the strings `applyAndRollbackIfUpdateChangesDataApartFromComments`, `isThreadWrappingOnlyChange` and `__tiptapcollab__typemap`, and allow-lists the roots `__tiptapcollab__threads`, `users`, `versions`, `versions_v2` and `config`. We found no other way to declare a type or address a nested fragment.

## What we tested

[`tests/fragments/block-anchor-fragments.test.ts`](../tests/fragments/block-anchor-fragments.test.ts), against a real server on stock Tiptap. A full-rights session writes the same two paragraphs into the fragment, declaring its types first; a comment-only session then comments on the first.

| Fragment | Block anchor | Inline anchor |
|---|---|---|
| root `default` | kept | kept |
| root `page:page-1`, declared `xmlfragment` | kept | kept |
| root `page:page-1`, undeclared | **undone** | kept |
| `pages` → `page-1`, undeclared | **undone** | kept |
| `pages` → `page-1`, `pages` declared `map` | **undone** | — |
| `pages` → `page-1`, also declared `xmlfragment` by path, five path styles | **undone** | — |

Every case asserts that the anchor is kept, so the red ones are what we ask about below. `workaround/` writes nothing different here, so there is no `with the writeback fix` half.

## What we are asking

1. Is a fragment nested in a `Y.Map` meant to be supported for comment-only block wraps? If so, how should it be declared?
2. Is the typemap, through `setFieldType`, the supported way to make the comment-only check accept a block wrap in a root fragment other than `default`?

The draft we send Tiptap is in [`tiptap/nested-fragments.txt`](tiptap/nested-fragments.txt).

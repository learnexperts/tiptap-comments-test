# Tiptap Comments Reproduction

Minimal reproductions for TipTap collab + CommentsKit bugs on a **comment-only** connection (`readonlyDocumentNames` + `commentDocumentNames`).

There are **two separate failure modes**. Do not conflate them.

## Bug 1: Comment-only inline thread lost on `textStyle`

Creating an inline comment on text that carries a `textStyle` mark loses the **document anchor** after sync. The thread exists locally before sync; after comment-only sync `inlineThread` is gone. Unstyled, bold, and italic text keep the anchor.

This is **not** “empty styles” and **not** “missing FontFamily” in production. The live editor registers Color, FontSize, BackgroundColor, and FontFamily on `textStyle`, so unused attrs are stored as `null`. That full attr bag is enough.

| Client schema | Seed | Anchor after comment-only sync |
|---|---|---|
| TextStyle + FontFamily only | bold + `fontFamily: Arial` | **kept** |
| Full kit + `SparseTextStyleDefaults` | exact `textStyle` (color, font-size, highlight, font-family) | **kept** |
| Full kit + `SparseTextStyleDefaults` | overlap selection onto `textStyle` | **lost** |
| Full kit (no workaround) | any `textStyle` | **lost** |
| TextStyle, no FontFamily | bold + `fontFamily: Arial` | **lost** (schema mismatch; Y still has `fontFamily`) |

### Workaround (approach 2): sparse ProseMirror defaults

`StripNullTextStyleAttrs` (`appendTransaction`) alone does **not** fix writeback: `mark.create({ fontFamily })` still merges schema `default: null` from Color / FontSize / etc.

Register **`SparseTextStyleDefaults`** after the full textStyle kit so unset attrs use `undefined` instead of `null`. y-prosemirror then writes sparse Y (`textStyle: { fontFamily: "Arial" }` only). See `fixtures/editor/sparseTextStyleDefaults.ts`.

Exact and subset selections pass integration tests with this extension. Overlap selections on `backgroundColor` still lose the anchor: the server stores thread metadata (REST `getThread`) but the document JSON has no `inlineThread` mark after sync.

Tests: `with full textStyle kit: *`, overlap describe, and `with FontFamily only` in `tests/comment.test.ts`. Offline: `tests/schema-mismatch.test.ts`, `tests/sparse-text-style-attrs.test.ts`.

### Writable vs read-only

On a **writable** local Y.Doc, applying `inlineThread` writes `textStyle` back from the ProseMirror schema. Missing companions clear Y attrs; the **new mark survives**.

On **read-only + `commentDocumentNames`**, the client cannot persist that textStyle rewrite. After the server applies the comment, the **anchor is lost**. `editor.editable` does not control this; the JWT does.

## Bug 2: Block-level thread + collab server crash

Creating a block-level comment thread can crash the on-premises collab server's `beforeHandleMessage` hook with "Unexpected end of array", force-closing the WebSocket and losing the thread.

The historical failing test is **"thread persists after sync"** under **"with 'block' selection"**.

### Environment

| Package | Version |
|---|---|
| Collab server image | `container.tiptap.dev/collaboration/server:latest` |
| Image digest | `sha256:e617214ea29705f04f31bf51be23c7583fd3280f49c8fffb6428d42d09a3df24` |
| Image built | 2026-06-16 |
| `@tiptap-pro/extension-comments` | ^3.8.4 |
| `@tiptap-pro/provider` | ^3.8.4 |
| `@tiptap/core` | ^3.27.0 |
| `@tiptap/extension-collaboration` | ^3.27.0 |
| `@tiptap/starter-kit` | ^3.27.0 |

### JWT claims

The connection token places the document in `readonlyDocumentNames` and `commentDocumentNames` but not `allowedDocumentNames`:

```json
{
  "sub": "guest:<uuid>",
  "allowedDocumentNames": [],
  "readonlyDocumentNames": ["<documentName>"],
  "commentDocumentNames": ["<documentName>"]
}
```

See [`fixtures/user/claims.ts`](fixtures/user/claims.ts) for the implementation.

### Steps to reproduce (block crash)

1. Seed a document with a simple paragraph via the REST API (`POST /api/documents/:name?format=json`)
2. Connect via WebSocket with a read-only + comment-privileged JWT
3. Create a block-level comment thread using `setThread()` on a node selection
4. Sync changes to the server

### Server logs

The server internally applies the comment change successfully:

```
"Internally applying change to document <name> from guest:<id> because read-only connection was used to create a comment."
```

Then crashes processing follow-up sync messages:

```json
{"level":"error","message":"[beforeHandleMessage]","meta":"Unexpected end of array"}
{"level":"error","message":"[beforeHandleMessage]","meta":"Unexpected end of array"}
{"level":"error","message":"closing connection <socketId> (while handling <documentName>) because of exception","stack":"Error: Unexpected end of array\n    at LM (/usr/src/app/dist/index.jsc:1:4223867)\n    ..."}
```

### What has been ruled out (block crash)

- **`useLegacyWrapping: true` vs `false`** — same crash either way
- **`editable: true` vs `false` on the Editor** — irrelevant; the server determines read-only status from the JWT, not the client config
- **Inline threads on unstyled text work** on the same connection type — the crash is specific to the structural Yjs mutation that block-level threads produce

### Expected behavior

The block-level comment thread should persist after sync, the same way inline comment threads on unstyled text do.

---

## Setup

### Prerequisites

- Node.js
- [pnpm](https://pnpm.io/) (v10+)
- Docker
- A [Tiptap Pro](https://tiptap.dev/) account with registry access and an on-premises license key

### 1. Configure Tiptap Pro registry access

Create an `.npmrc` in the project root (gitignored):

```
@tiptap-pro:registry=https://registry.tiptap.dev/
//registry.tiptap.dev/:_authToken=${TIPTAP_PRO_TOKEN}
```

Export your registry token:

```sh
export TIPTAP_PRO_TOKEN="<your-token>"
```

### 2. Configure the collab server

Create `.env.tiptap-collab` in the project root (gitignored):

```
LICENSE_KEY=<your-on-premises-license-key>
```

### 3. Install dependencies

```sh
pnpm install
```

## Running

### Start the collab server

```sh
docker compose up
```

The server will be available at `localhost:3030`.

### Run the tests

In a separate terminal:

```sh
# Integration (needs Docker collab server)
pnpm test

# Offline schema-mismatch (no server)
pnpm exec vitest run tests/schema-mismatch.test.ts
```

# Tiptap Comments Reproduction

Minimal reproduction for a collab server crash when creating block-level comment threads on a read-only connection with comment privileges.

## Bug summary

Creating a block-level comment thread crashes the on-premises collab server's `beforeHandleMessage` hook with "Unexpected end of array", force-closing the WebSocket connection and losing the thread. Inline comment threads on the same connection type work correctly.

The failing test is **"thread persists after sync"** under **"with 'block' selection"**.

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

### Steps to reproduce

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

### What has been ruled out

- **`useLegacyWrapping: true` vs `false`** — same crash either way
- **`editable: true` vs `false` on the Editor** — irrelevant; the server determines read-only status from the JWT, not the client config
- **Inline threads work fine** on the same connection type — the issue is specific to the structural Yjs mutation that block-level threads produce

### Expected behavior

The block-level comment thread should persist after sync, the same way inline comment threads do.

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
pnpm test
```

# Tiptap Comments Reproduction

Minimal reproductions for TipTap collab + CommentsKit bugs on a **comment-only** connection (`readonlyDocumentNames` + `commentDocumentNames`).

There are **two separate failure modes**. Do not conflate them.

## Bug 1: Comment-only inline thread lost on `textStyle`

Creating an inline comment on text that carries a `textStyle` mark loses the **document anchor** after sync. The thread exists locally before sync; after comment-only sync `inlineThread` is gone. Unstyled, bold, and italic text keep the anchor.

The trigger is **`null`-valued attrs**, not missing ones. A production editor registers Color, FontSize, BackgroundColor and FontFamily on `textStyle`, so a mark that sets only one of them stores the other three as `null` — and that is the case that loses its anchor. A mark with *every* attr set has no nulls and survives.

Measured by the matrix (see [Test layout](#test-layout)):

| Client schema | Seed | Anchor after comment-only sync |
|---|---|---|
| Full kit, no workaround | `textStyle` with one attr set, three `null` | **lost** — all four selection scenarios |
| Full kit, no workaround | `textStyle` with all four attrs set | kept |
| Full kit, no workaround | unstyled, bold, or block-level | kept |
| Full kit + `CollabWriteback` | every seed and selection in the matrix | **kept** |

### Where we think the fix belongs

We are not proposing a fix — the behaviour has two candidate causes and both sit deeper in the collab chain than a client extension can properly reach:

1. **The client emits a `textStyle` change nobody asked for.** Applying an `inlineThread` mark causes writeback to densify `textStyle` from the ProseMirror schema, writing `fontFamily: null, fontSize: null, color: null` over attributes the server never had.
2. **The comment-only path then discards the whole update.** Rather than rejecting just the disallowed `textStyle` write, it drops the accompanying `inlineThread` mark too, and the anchor goes with it.

Fixing either would close the defect. `tests/writeback-null-attrs.test.ts` demonstrates (1) offline; `tests/comment.test.ts` shows the combined result against a real server.

### Our interim workaround (not a recommendation)

`workaround/collabWriteback.ts` is what we run in production while this is open. **Do not treat it as a fix.** It patches `MarkType.create` and monkey-patches `Y.Text.prototype.applyDelta` from outside the library — acceptable as a stopgap we own, not as guidance for anyone else.

Its value to this report is diagnostic. Suppressing the spurious `textStyle` write takes the matrix from 30/34 to **34/34**, which localises the defect to the writeback path described above. Two other candidate extensions were tried; one is redundant and one is harmful — see [What the workaround fixes](#what-the-workaround-fixes).

An `appendTransaction` that strips nulls from the ProseMirror doc does **not** work on its own: `mark.create({ backgroundColor })` still merges schema `default: null` from Color / FontSize / FontFamily before writeback sees it.

Tests: see [Test layout](#test-layout).

### Writable vs read-only

On a **writable** local Y.Doc, applying `inlineThread` writes `textStyle` back from the ProseMirror schema. Missing companions clear Y attrs; the **new mark survives**.

On **read-only + `commentDocumentNames`**, the client cannot persist that textStyle rewrite. After the server applies the comment, the **anchor is lost**. `editor.editable` does not control this; the JWT does.

## Bug 2: Block-level thread + collab server crash

Creating a block-level comment thread can crash the on-premises collab server's `beforeHandleMessage` hook with "Unexpected end of array", force-closing the WebSocket and losing the thread.

The historical failing test was **"thread persists after sync"** under **"with 'block' selection"**. That case now lives in the matrix as **`and 'block-level' content > and 'a node selection'`**, and as of the last run it **passes** — the crash does not reproduce against the current server image. The reproduction steps below are retained in case it resurfaces.

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

See [`tests/utils/claims.ts`](tests/utils/claims.ts) for the implementation.

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

## Test layout

Four files. Each makes one claim. `pnpm test` is **expected to fail** — see [ADR 0001](docs/adr/0001-tests-are-a-bug-report.md) for why this directory is shaped the way it is.

| File | Claim | Needs Docker |
|---|---|---|
| `tests/writeback-null-attrs.test.ts` | **The mechanism.** Applying an `inlineThread` mark makes the client write `null` `textStyle` attrs into Yjs that the server never stored — and suppressing that write stops it. | no |
| `tests/comment.test.ts` | **The bug.** On a comment-only connection, that write costs the thread anchor. Stock Tiptap, **30/34**. | yes |
| `tests/probes/writeback-fix.probe.ts` | **The workaround.** The identical matrix with our stopgap applied, **34/34**. | yes |
| `tests/utils/*.test.ts` | The selection helpers the matrix relies on place their ranges correctly. | no |

Start with the offline file — it needs no licence key and runs in a second:

```sh
pnpm exec vitest run tests/writeback-null-attrs.test.ts
```

The suites are Vitest projects, so each has its own command: `pnpm test` (repro), `pnpm test:utils`, `pnpm test:probes`, `pnpm test:all`.

### The matrix

`tests/comment.test.ts` and the probe run one shared definition (`tests/utils/commentMatrix.ts`), so the only variable between them is the extension list.

Five seeds — block-level, undecorated text, bolded text, text with a single style (`backgroundColor`), text with multiple styles (all four `textStyle` attrs). Four selection scenarios on the four text seeds — exact, partially overlapping (crossing one mark boundary), two threads on disjoint parts, two threads on overlapping parts. 17 cases, 34 tests.

### What the workaround fixes

| Seed | Stock | With `CollabWriteback` |
|---|---|---|
| block-level | pass | pass |
| undecorated text | pass | pass |
| bolded text | pass | pass |
| **single style** (`backgroundColor`) | **fails all 4 scenarios** | pass |
| multiple styles (all four attrs) | pass | pass |

Stock is **30/34**; adding `CollabWriteback` alone is **34/34**. Both deterministic across repeated runs.

`CollabWriteback` on its own is sufficient. Measured against the same matrix:

| Configuration | Result |
|---|---|
| `CollabWriteback` | 34/34 |
| `CollabWriteback` + `SparseTextStyleDefaults` | 34/34 |
| `CollabWriteback` + `CompactTextStyleYAttrs` | **32/34** |

`SparseTextStyleDefaults` is redundant once `CollabWriteback` is applied. `CompactTextStyleYAttrs` is actively harmful: it breaks the two multi-thread cases on a four-attribute `textStyle` mark, which pass both without it and on stock. Neither extension is in the repo any more; both results are recorded here so the experiment need not be repeated.

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
# The report: the bug plus its mechanism (needs Docker for the bug)
pnpm test

# Same matrix with our stopgap applied (needs Docker collab server)
pnpm test:probes

# Helper unit tests — offline, no server, no licence key
pnpm test:utils

# Everything
pnpm test:all

# Types
pnpm typecheck
```

See [Test layout](#test-layout) for which failures are expected.

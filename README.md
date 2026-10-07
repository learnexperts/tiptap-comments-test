# Tiptap Comments Reproduction

A minimal reproduction of two TipTap collab + CommentsKit defects on a **comment-only** connection (`readonlyDocumentNames` + `commentDocumentNames`).

> **[Adding a comment to styled text loses the thread anchor after sync.](docs/comment-anchor-lost.md)**
>
> y-prosemirror keys overlapping marks by a hash of the mark's JSON, so any incidental change to a structured attribute value — a reordered key, an added `null` — reads as an edit. Applying a comment mark therefore emits a `textStyle` write nobody asked for, and a comment-only connection rejects it along with the thread anchor.

> **[A block comment is undone when the block's stored attributes differ from the rebuilt copy.](docs/block-anchor-undone.md)**
>
> Wrapping a block in `blockThread` deletes it and inserts a copy y-prosemirror rebuilds from the ProseMirror node, in schema order with every default. A comment-only connection keeps that only if the copy matches the stored element, key order included — so a code block whose language was picked after insert loses its comment.

It reproduces offline, needing neither Docker nor a licence key:

```sh
pnpm install
pnpm exec vitest run tests/attribute-hashing.test.ts
```

Two of those four tests fail. That is the report — they assert what should happen, so they go green when the defect is fixed.

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

This also installs the git hooks (see [Git hooks](#git-hooks)).

## Running

### Start the collab server

```sh
docker compose up
```

The server will be available at `localhost:3030`.

### Run the tests

In a separate terminal:

```sh
# The report: both bugs plus the inline mechanism (needs Docker for the bugs)
pnpm test

# Same matrices with our stopgap applied (needs Docker collab server)
pnpm test:probes

# Helper unit tests — offline, no server, no licence key
pnpm test:utils

# The stopgap's own contract — offline, green
pnpm test:workaround

# Everything
pnpm test:all

# Types
pnpm typecheck
```

## Git hooks

[lefthook](https://lefthook.dev/) runs the checks that are supposed to be green. `pnpm install` installs the hooks; `pnpm exec lefthook uninstall` removes them.

| Hook | Runs |
|---|---|
| `pre-commit` | `biome check --write` over the staged files, restaging anything it fixes |
| `pre-push` | `pnpm typecheck`, `pnpm test:utils` and `pnpm test:workaround` |

`pnpm test` is deliberately red ([ADR 0001](docs/adr/0001-tests-are-a-bug-report.md)), so no hook gates on it — a hook that did would block every push for as long as the defect is open. `pre-push` runs the offline `utils` and `workaround` suites instead, which need neither Docker nor a licence key.

Run a hook without committing with `pnpm exec lefthook run pre-commit`, or skip one for a single command with `LEFTHOOK=0 git commit ...`.

## Test layout

Each file makes one claim, and each **asserts the behaviour we expect** — so the red tests turn green when the defect is fixed, and their failure output is the evidence. `pnpm test` is expected to fail; see [ADR 0001](docs/adr/0001-tests-are-a-bug-report.md) for why.

| File | Claim | Needs Docker |
|---|---|---|
| `tests/attribute-hashing.test.ts` | **The root cause.** y-prosemirror keys overlapping marks by a hash of their JSON, so an unrelated edit rewrites a mark nobody touched. **2 of 4 red.** | no |
| `tests/writeback-null-attrs.test.ts` | **The mechanism.** That hashing makes the client write `null` `textStyle` attrs into Yjs the server never stored. **1 of 4 red**, and the same assertion passes with our stopgap applied. | no |
| `tests/comment.test.ts` | **The bug.** On a comment-only connection, that write costs the thread anchor. Stock Tiptap, **4 of 34 red**. | yes |
| `tests/block-anchor.test.ts` | **The second bug.** A block comment on a block whose stored attributes differ from the rebuilt copy (out of schema order, or missing a default) loses its anchor. Stock Tiptap, **6 of 10 red**. | yes |
| `writeback`-tagged runs in both matrix files | **The workaround.** Each matrix again under `with the writeback fix`, which only adds `CollabWriteback` to the extensions: **34/34** and **10/10**. Left out of `pnpm test`; `pnpm test:probes` runs them. | yes |
| `tests/utils/*.test.ts` | The selection helpers the matrix relies on place their ranges correctly. | no |
| `workaround/*.test.ts` | Not part of the report: the stopgap's own contract — what it changes, and that it changes it only for the editor it is added to. Green. | no |

Start with `tests/attribute-hashing.test.ts` — it needs no licence key, no server, and runs in under a second. Two of its four tests fail, and the failure message names the two keys that ought to have matched.

The suites are Vitest projects and a `writeback` tag, each with its own command: `pnpm test` (repro without the tag), `pnpm test:probes` (only the tag), `pnpm test:utils`, `pnpm test:workaround`, `pnpm test:all` (everything once). Running a matrix file directly runs both halves; add `--tags-filter='!writeback'` for the report alone.

Full detail lives in [docs/comment-anchor-lost.md](docs/comment-anchor-lost.md) and [docs/block-anchor-undone.md](docs/block-anchor-undone.md). The interim workaround, its mechanisms and its ablation are in [workaround/README.md](workaround/README.md).

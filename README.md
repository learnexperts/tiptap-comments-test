# Tiptap Comments Reproduction

A minimal reproduction of a TipTap collab + CommentsKit defect on a **comment-only** connection (`readonlyDocumentNames` + `commentDocumentNames`).

> **[Adding a comment to styled text loses the thread anchor after sync.](docs/comment-anchor-lost.md)**
>
> y-prosemirror keys overlapping marks by a hash of the mark's JSON, so any incidental change to a structured attribute value — a reordered key, an added `null` — reads as an edit. Applying a comment mark therefore emits a `textStyle` write nobody asked for, and a comment-only connection rejects it along with the thread anchor.

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

## Git hooks

[lefthook](https://lefthook.dev/) runs the checks that are supposed to be green. `pnpm install` installs the hooks; `pnpm exec lefthook uninstall` removes them.

| Hook | Runs |
|---|---|
| `pre-commit` | `biome check --write` over the staged files, restaging anything it fixes |
| `pre-push` | `pnpm typecheck` and `pnpm test:utils` |

`pnpm test` is deliberately red ([ADR 0001](docs/adr/0001-tests-are-a-bug-report.md)), so no hook gates on it — a hook that did would block every push for as long as the defect is open. `pre-push` runs the offline `utils` suite instead, which needs neither Docker nor a licence key.

Run a hook without committing with `pnpm exec lefthook run pre-commit`, or skip one for a single command with `LEFTHOOK=0 git commit ...`.

## Test layout

Five files. Each makes one claim, and each **asserts the behaviour we expect** — so the red tests turn green when the defect is fixed, and their failure output is the evidence. `pnpm test` is expected to fail; see [ADR 0001](docs/adr/0001-tests-are-a-bug-report.md) for why.

| File | Claim | Needs Docker |
|---|---|---|
| `tests/attribute-hashing.test.ts` | **The root cause.** y-prosemirror keys overlapping marks by a hash of their JSON, so an unrelated edit rewrites a mark nobody touched. **2 of 4 red.** | no |
| `tests/writeback-null-attrs.test.ts` | **The mechanism.** That hashing makes the client write `null` `textStyle` attrs into Yjs the server never stored. **1 of 4 red**, and the same assertion passes with our stopgap applied. | no |
| `tests/comment.test.ts` | **The bug.** On a comment-only connection, that write costs the thread anchor. Stock Tiptap, **4 of 34 red**. | yes |
| `tests/probes/writeback-fix.probe.ts` | **The workaround.** The identical matrix with our stopgap applied, **34/34**. | yes |
| `tests/utils/*.test.ts` | The selection helpers the matrix relies on place their ranges correctly. | no |

Start with `tests/attribute-hashing.test.ts` — it needs no licence key, no server, and runs in under a second. Two of its four tests fail, and the failure message names the two keys that ought to have matched.

The suites are Vitest projects, so each has its own command: `pnpm test` (repro), `pnpm test:utils`, `pnpm test:probes`, `pnpm test:all`.

Full detail — root cause, the matrix, and our interim workaround — lives in [docs/comment-anchor-lost.md](docs/comment-anchor-lost.md).

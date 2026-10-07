# Tiptap Comments Reproduction

A minimal reproduction of three ways a TipTap collab + CommentsKit **comment-only** connection (`readonlyDocumentNames` + `commentDocumentNames`) loses a comment. In each, the comment appears locally, then the server undoes the whole update on sync and the thread is left with nothing to point at.

| # | Issue | Write-up | Tests | Run | With Tiptap |
|---|---|---|---|---|---|
| 1 | An inline comment on styled text is lost | [docs/comment-anchor-lost.md](docs/comment-anchor-lost.md) | [`tests/inline/`](tests/inline) | `pnpm test:inline` | reported |
| 2 | A block comment is undone when the rebuilt copy differs from the stored block | [docs/block-anchor-undone.md](docs/block-anchor-undone.md) | [`tests/block/`](tests/block) | `pnpm test:block` | [addendum to 1](docs/tiptap/addendum-block-anchor.txt) |
| 3 | A block comment is undone in a fragment nested in a `Y.Map` | [docs/block-anchor-fragments.md](docs/block-anchor-fragments.md) | [`tests/fragments/`](tests/fragments) | `pnpm test:fragments` | [new issue](docs/tiptap/nested-fragments.txt) |

These commands are expected to fail: every test asserts what should happen, so the red ones are the report and turn green when an issue is fixed ([ADR 0001](docs/adr/0001-tests-are-a-bug-report.md)).

> **1. [Adding a comment to styled text loses the thread anchor after sync.](docs/comment-anchor-lost.md)**
>
> Adding the comment makes y-prosemirror re-write every mark on the run. `textStyle` goes back with `null` defaults the server never stored, which counts as an edit, and the server rejects it along with the anchor.

> **2. [A block comment is undone when the stored block differs from the rebuilt copy.](docs/block-anchor-undone.md)**
>
> Wrapping a block in `blockThread` deletes it and inserts a copy y-prosemirror rebuilds, in schema order with every default and without an emptied text. A comment-only connection keeps that only if the copy matches the stored element, key order and children included. So a code block whose language was picked after insert, or a paragraph whose text was deleted, loses its comment.

> **3. [A block comment is undone outside a root fragment the server knows.](docs/block-anchor-fragments.md)**
>
> The server accepts a block wrap only in the root fragment `default`, or in a root fragment declared with `provider.setFieldType`. A fragment nested in a root `Y.Map`, which is how we store every page, is undone however it is declared. Inline comments are kept everywhere.

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
# The report: all three issues (needs Docker, except issue 1's mechanism)
pnpm test

# One issue at a time
pnpm test:inline
pnpm test:block
pnpm test:fragments

# Issues 1 and 2 with our stopgap applied (needs Docker collab server)
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
| `tests/inline/writeback-null-attrs.test.ts` | **Issue 1, the mechanism.** Adding a comment writes `null` `textStyle` attrs into Yjs the server never stored. **1 of 2 red.** | no |
| `tests/inline/comment.test.ts` | **Issue 1.** On a comment-only connection, that write costs the thread anchor. Stock Tiptap, **4 of 17 red**. | yes |
| `tests/block/block-anchor.test.ts` | **Issue 2.** A block comment on a block that differs from the rebuilt copy (out of schema order, missing a default, or emptied of its text) loses its anchor. Stock Tiptap, **7 of 12 red**. | yes |
| `tests/fragments/block-anchor-fragments.test.ts` | **Issue 3.** A block comment loses its anchor outside the root `default` or a root declared with `setFieldType`, and in any fragment nested in a map. Inline comments are kept. **8 of 14 red**. No workaround run. | yes |
| `writeback`-tagged runs in the issue 1 and 2 matrix files | **The workaround.** Each matrix again under `with the writeback fix`, which only adds `CollabWriteback` to the extensions: **17/17** and **12/12**. Left out of `pnpm test`; `pnpm test:probes` runs them. | yes |
| `tests/utils/*.test.ts` | The selection helpers the matrix relies on place their ranges correctly. | no |
| `workaround/*.test.ts` | Not part of the report: the stopgap's own contract — what it changes, and that it changes it only for the editor it is added to. Green. | no |

The suites are Vitest projects and a `writeback` tag, each with its own command: `pnpm test` (repro without the tag), `pnpm test:inline`, `pnpm test:block` and `pnpm test:fragments` (one issue each), `pnpm test:probes` (only the tag; add a directory, as in `pnpm test:probes tests/block`, for one issue), `pnpm test:utils`, `pnpm test:workaround`, `pnpm test:all` (everything once). Running a matrix file directly runs both halves; add `--tags-filter='!writeback'` for the report alone.

Each issue's write-up is linked from [the table at the top](#tiptap-comments-reproduction). The interim workaround, its mechanisms and its ablation are in [workaround/README.md](workaround/README.md).

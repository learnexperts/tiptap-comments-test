# Tiptap Comments Reproduction

A minimal reproduction of the ways a TipTap collab + CommentsKit **comment-only** connection (`readonlyDocumentNames` + `commentDocumentNames`) loses a comment. In each, the comment appears locally, then the server undoes the whole update on sync and the thread is left with nothing to point at.

Two issues are open, on `@tiptap/y-tiptap` 3.0.10 against collab server 3.108.2:

| # | Issue | Write-up | Tests | Run | With Tiptap |
|---|---|---|---|---|---|
| 2 | A block comment is undone when the stored block lacks a default | [docs/block-anchor-undone.md](docs/block-anchor-undone.md) | [`tests/block/`](tests/block) | `pnpm test:block` | [addendum to 1](docs/tiptap/addendum-block-anchor.txt) |
| 5 | y-tiptap 3.0.10's position-migration record undoes the comment | [docs/position-migrations.md](docs/position-migrations.md) | [`tests/migrations/`](tests/migrations) | `pnpm test:migrations` | [new issue](docs/tiptap/position-migrations.txt), draft |

Issues 1, 3 and 4 no longer reproduce, and issue 6 was fixed in `@tiptap-pro/extension-comments` 3.12.9. They are [archived](docs/archive/README.md), with their tests (`pnpm test:archive`).

These commands are expected to fail: every test asserts what should happen, so the red ones are the report and turn green when an issue is fixed ([ADR 0001](docs/adr/0001-tests-are-a-bug-report.md)).

> **2. [A block comment is undone when the stored block differs from the rebuilt copy.](docs/block-anchor-undone.md)**
>
> Wrapping a block in `blockThread` deletes it and inserts a copy y-prosemirror rebuilds, with every non-null default. A comment-only connection keeps that only if the copy matches the stored element. Today's server accepts a different key order and an emptied text, but not a default the stored block lacks, so a paragraph imported without `marginLeft` loses its block comment, and its inline ones.

> **5. [y-tiptap 3.0.10's position-migration record undoes the comment.](docs/position-migrations.md)**
>
> y-tiptap now writes a record of moved identities, to its own root, in the same update as a local change. A comment-only connection may not write that root. Every block comment writes one, and so does an inline comment while the page holds a block emptied of its text, so the server undoes both.

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
# The report: both open issues (needs Docker, except issue 5's mechanism)
pnpm test

# One issue at a time
pnpm test:block
pnpm test:migrations

# Both issues with our stopgap applied (needs Docker collab server)
pnpm test:probes

# Archived issues 1, 3, 4 and 6, both halves (needs Docker, except their mechanisms)
pnpm test:archive

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
| `tests/block/block-anchor.test.ts` | **Issue 2.** A block comment on a block that differs from the rebuilt copy loses its anchor. On 3.0.10 every stock case is also undone by issue 5, so **12 of 12 red**; with issue 5's record dropped, 2 of 12, both a block stored without its `marginLeft` default. | yes |
| `tests/migrations/migration-record.test.ts` | **Issue 5, the mechanism.** After an author's edit, a client that only comments writes a position-migration record: for every block comment, and for an inline one where a block was emptied of its text. **7 of 10 red.** | no |
| `tests/migrations/position-migrations.test.ts` | **Issue 5.** On a comment-only connection, that record costs the thread anchor. **7 of 10 red.** | yes |
| `writeback`-tagged runs in both matrix files | **The workaround.** Each matrix again under `with the writeback fix`, which only adds `CollabWriteback.configure({ commentOnly: true })` to the extensions: **12/12** and **10/10**. Left out of `pnpm test`; `pnpm test:probes` runs them. | yes |
| `tests/archive/**` | Not part of the report: issues 1, 3, 4 and 6, kept runnable. See [the archive](docs/archive/README.md). | mostly |
| `tests/utils/*.test.ts` | The selection helpers the matrix relies on place their ranges correctly. | no |
| `workaround/*.test.ts` | Not part of the report: the stopgap's own contract — what it changes, and that it changes it only for the editor it is added to. Green. | no |

The suites are Vitest projects and a `writeback` tag, each with its own command: `pnpm test` (repro without the tag), `pnpm test:block` and `pnpm test:migrations` (one issue each), `pnpm test:probes` (only the tag; add a directory, as in `pnpm test:probes tests/block`, for one issue), `pnpm test:archive`, `pnpm test:utils`, `pnpm test:workaround`, `pnpm test:all` (everything once). Running a matrix file directly runs both halves; add `--tags-filter='!writeback'` for the report alone.

Each issue's write-up is linked from [the table at the top](#tiptap-comments-reproduction). The interim workaround, its mechanisms and its ablation are in [workaround/README.md](workaround/README.md).

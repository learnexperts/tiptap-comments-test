# Redis TLS rig

A local rig for [LD-7729](https://learnexperts.atlassian.net/browse/LD-7729): can the Tiptap collaboration server reach Redis over TLS, so production's ElastiCache can have in-transit encryption turned on?

## Why this exists

In cluster mode (`COLLAB_CLUSTERMODE=1`) collab instances relay every document update and awareness change to each other through Redis pub/sub. That traffic is document content, not just signalling.

Tiptap's on-prem configuration docs say `REDIS_URL` mode doesn't support TLS, and that TLS is only available in Sentinel mode (`REDIS_SENTINELS` + `REDIS_TLS=1`, from 3.102.0). ElastiCache has no Sentinel, so on paper there is no supported TLS path to ElastiCache. This rig checks whether a plain `rediss://` URL works anyway.

## What it runs

[`../docker-compose.redis-tls.yml`](../docker-compose.redis-tls.yml) starts:

- **redis**: Redis 7 listening like ElastiCache in "preferred" transit-encryption mode, with TLS on 6379 and plaintext on 6380. Password `devpass`.
- **postgres**: shared storage for both collab instances.
- **collab-a** (`:3030`) and **collab-b** (`:3032`): two collab servers in cluster mode. They can only see each other's updates through Redis.

[`sync-check.mjs`](sync-check.mjs) connects one client to each instance, writes on collab-a, and passes only if the edit arrives on collab-b.

## Running it

Needs `.env.tiptap-collab` with a `LICENSE_KEY` in the repo root (see the main README), and `pnpm install`.

```sh
./redis-tls/gen-certs.sh
docker compose -f docker-compose.redis-tls.yml up -d redis postgres
./redis-tls/run-matrix.sh
docker compose -f docker-compose.redis-tls.yml down -v
```

To try one configuration by hand, set `COLLAB_IMAGE` and `REDIS_URL` (and optionally `NODE_EXTRA_CA_CERTS=` to drop the test CA), bring the stack up, and run `node redis-tls/sync-check.mjs`.

`run-matrix.sh` uses the 3.86.3 image from our ECR, which is what production runs. Pull it first, or change `PROD` in the script.

## Results (14 Sep 2026)

| Case | Version | Redis port used | Edit synced A → B |
|---|---|---|---|
| Plaintext baseline | 3.86.3 | 6380 (plain) | yes |
| `rediss://` | 3.86.3 | 6379 (TLS only) | yes |
| `rediss://` | 3.95.1 | 6379 (TLS only) | yes |
| Control: plain `redis://` to the TLS port | 3.86.3 | none | no, as expected |
| `rediss://` without the test CA | 3.86.3 | none | no, as expected |

- **`rediss://` works in `REDIS_URL` mode**, despite the docs. Both instances connected on the TLS-only port and synced.
- **The connection is really TLS.** Plain `redis://` to 6379 fails. Redis logs `wrong version number` and the instances never connect.
- **The server verifies the Redis certificate.** Without the test CA every handshake is aborted: Redis logs repeated `unexpected eof while reading`. ElastiCache certificates chain to a public root, so production shouldn't need `NODE_EXTRA_CA_CERTS`.
- **Plaintext Redis exposes document content.** `MONITOR` on the plaintext baseline showed typed text readable inside the pub/sub payload.
- **Almost nothing is stored.** The only lasting key is `Cluster` (value `onConnectRedisAvailability`, a connectivity probe). Locks are transient. Channel names include the document name.

## Caveats

- This was tested against Redis 7.4 with a self-signed cert, not ElastiCache. Confirm in staging: ElastiCache in "preferred" mode, collab on `rediss://`, two instances syncing, then switch to "required".
- It's unsupported by Tiptap. Ask them to confirm `rediss://` in `REDIS_URL` mode so an upgrade can't quietly break it.
- `REDIS_URL` takes a single endpoint, so this only fits a non-sharded ElastiCache setup.
- TLS protects traffic on the wire, not access. Anyone who can reach Redis can still read live edits, so AUTH and security groups still matter.

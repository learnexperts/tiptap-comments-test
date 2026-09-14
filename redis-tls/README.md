# Redis TLS rig

Checks whether the Tiptap collaboration server can reach Redis over TLS in `REDIS_URL` mode.

## Why this exists

In cluster mode (`COLLAB_CLUSTERMODE=1`), collab instances pass document updates and awareness changes to each other through Redis pub/sub.

Tiptap's on-prem configuration docs say `REDIS_URL` mode doesn't support TLS. They say TLS is only available in Sentinel mode (`REDIS_SENTINELS` + `REDIS_TLS=1`, from 3.102.0). Managed Redis services such as ElastiCache don't offer Sentinel, so on paper they have no supported TLS path. This rig checks whether a plain `rediss://` URL works anyway.

## What it runs

[`../docker-compose.redis-tls.yml`](../docker-compose.redis-tls.yml) starts:

- **redis**: Redis 7 with TLS on 6379 and plaintext on 6380, reachable only inside the compose network. Password `devpass`.
- **postgres**: shared storage for both collab instances.
- **collab-a** (`:3040`) and **collab-b** (`:3041`): two collab servers in cluster mode. They can only see each other's updates through Redis.

None of these ports collide with the repo's `docker-compose.yml`, so both stacks can run at once.

[`sync-check.mjs`](sync-check.mjs) connects one client to each instance, writes on collab-a, and passes only if the edit arrives on collab-b.

## Running it

Needs `.env.tiptap-collab` with a `LICENSE_KEY` in the repo root (see the main README), and `pnpm install`.

```sh
./redis-tls/gen-certs.sh
docker compose -f docker-compose.redis-tls.yml up -d redis postgres
PINNED_COLLAB_IMAGE=<collab image to test> ./redis-tls/run-matrix.sh
docker compose -f docker-compose.redis-tls.yml down -v
```

To try one configuration by hand, set `COLLAB_IMAGE` and `REDIS_URL` (and optionally `NODE_EXTRA_CA_CERTS=` to drop the test CA). Then bring the stack up and run `node redis-tls/sync-check.mjs`.

## Results

| Case | Version | Redis port used | Edit synced A → B |
|---|---|---|---|
| Plaintext baseline | 3.86.3 | 6380 (plain) | yes |
| `rediss://` | 3.86.3 | 6379 (TLS only) | yes |
| `rediss://` | 3.95.1 | 6379 (TLS only) | yes |
| Control: plain `redis://` to the TLS port | 3.86.3 | none | no, as expected |
| `rediss://` without the test CA | 3.86.3 | none | no, as expected |

- **`rediss://` works in `REDIS_URL` mode**, despite the docs. Both instances connected on the TLS-only port and synced.
- **The connection is really TLS.** Plain `redis://` to 6379 fails. Redis logs `wrong version number` and the instances never connect.
- **The server verifies the Redis certificate.** Without the test CA every handshake is aborted, and Redis logs repeated `unexpected eof while reading`. Certificates that chain to a public root, as ElastiCache's do, shouldn't need `NODE_EXTRA_CA_CERTS`.
- **Almost nothing is stored in Redis.** The only lasting key is `Cluster` (value `onConnectRedisAvailability`, a connectivity probe). Locks are transient.

## Caveats

- Tested against Redis 7.4 with a self-signed cert, not a managed Redis service.
- Unsupported by Tiptap: an upgrade could change this behaviour until they confirm it.
- `REDIS_URL` takes a single endpoint, so this only fits a non-sharded Redis.

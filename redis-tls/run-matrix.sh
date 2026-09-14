#!/usr/bin/env bash
# Run the collab server against Redis in each configuration and check that an
# edit on collab-a reaches collab-b (which only happens through Redis).
#
# Needs the rig's redis + postgres up: docker compose -f docker-compose.redis-tls.yml up -d redis postgres
#
#   PINNED_COLLAB_IMAGE  collab image for the main cases (required)
#   LATEST_COLLAB_IMAGE  collab image for the last case (default: Tiptap's latest)
set -uo pipefail
cd "$(dirname "$0")/.."

COMPOSE=(docker compose -f docker-compose.redis-tls.yml)
PINNED=${PINNED_COLLAB_IMAGE:?set PINNED_COLLAB_IMAGE to the collab image to test}
LATEST=${LATEST_COLLAB_IMAGE:-container.tiptap.dev/collaboration/server:latest}
TLS='rediss://:devpass@redis:6379'
PLAIN='redis://:devpass@redis:6380'
PLAIN_TO_TLS_PORT='redis://:devpass@redis:6379'
CA=/certs/ca.crt

# name | image | REDIS_URL | NODE_EXTRA_CA_CERTS | expected
CASES=(
  "plaintext baseline|$PINNED|$PLAIN|$CA|PASS"
  "rediss:// (pinned)|$PINNED|$TLS|$CA|PASS"
  "control: redis:// to TLS port|$PINNED|$PLAIN_TO_TLS_PORT|$CA|FAIL"
  "rediss:// without our CA|$PINNED|$TLS||FAIL"
  "rediss:// (latest)|$LATEST|$TLS|$CA|PASS"
)

results=()
for row in "${CASES[@]}"; do
  IFS='|' read -r name image url ca expected <<<"$row"
  echo "=== $name"
  if ! up_log=$(COLLAB_IMAGE="$image" REDIS_URL="$url" NODE_EXTRA_CA_CERTS="$ca" \
    "${COMPOSE[@]}" up -d --wait --force-recreate collab-a collab-b 2>&1); then
    echo "    collab containers did not report healthy; last compose output:"
    tail -n 5 <<<"$up_log" | sed 's/^/      /'
  fi
  sleep 3

  version=$("${COMPOSE[@]}" exec -T collab-a printenv COLLABORATION_VERSION 2>/dev/null)
  ports=$("${COMPOSE[@]}" exec -T redis redis-cli -p 6380 -a devpass --no-auth-warning CLIENT LIST \
    | grep -v '127.0.0.1' | grep -oE 'laddr=[^ ]+:[0-9]+' | grep -oE '[0-9]+$' | sort | uniq -c | tr -s ' ' | xargs)
  if node redis-tls/sync-check.mjs; then actual=PASS; else actual=FAIL; fi

  results+=("$name|${version:-?}|${ports:-none}|$expected|$actual")
done

echo
printf '%-32s %-8s %-18s %-8s %s\n' CASE VERSION "REDIS CONNS(port)" EXPECTED ACTUAL
for r in "${results[@]}"; do
  IFS='|' read -r name version ports expected actual <<<"$r"
  printf '%-32s %-8s %-18s %-8s %s\n' "$name" "$version" "$ports" "$expected" "$actual"
done

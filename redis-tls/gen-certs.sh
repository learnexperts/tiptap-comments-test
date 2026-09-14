#!/usr/bin/env bash
# Throwaway CA + server cert for the local TLS Redis in docker-compose.redis-tls.yml.
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p certs
cd certs

openssl req -x509 -newkey rsa:2048 -nodes -days 30 \
  -subj "/CN=redis-tls-test CA" -keyout ca.key -out ca.crt

openssl req -newkey rsa:2048 -nodes \
  -subj "/CN=redis" -keyout redis.key -out redis.csr

printf "subjectAltName=DNS:redis,DNS:localhost,IP:127.0.0.1\n" > san.ext
openssl x509 -req -in redis.csr -CA ca.crt -CAkey ca.key -CAcreateserial \
  -days 30 -extfile san.ext -out redis.crt

# The redis container runs as a non-root user and must be able to read its key.
chmod 644 redis.key
rm -f redis.csr san.ext ca.srl

echo "certs written to $(pwd)"

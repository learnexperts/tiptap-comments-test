// Write on collab-a, expect it to arrive on collab-b.
// The two instances only see each other's updates through Redis, so this
// passes only if the collab server's Redis connection actually works.
import { createHmac } from "node:crypto";
import { HocuspocusProvider } from "@hocuspocus/provider";
import * as Y from "yjs";

const SECRET = process.env.JWT_SECRET ?? "dev-jwt-secret";
const A = process.env.COLLAB_A ?? "ws://localhost:3030";
const B = process.env.COLLAB_B ?? "ws://localhost:3032";
const TIMEOUT_MS = 10_000;

const docName = `redis-tls-${Date.now()}`;
const marker = `hello from A ${Math.random().toString(36).slice(2, 8)}`;

function jwt(payload) {
  const enc = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const unsigned = `${enc({ alg: "HS256", typ: "JWT" })}.${enc(payload)}`;
  const sig = createHmac("sha256", SECRET).update(unsigned).digest("base64url");
  return `${unsigned}.${sig}`;
}

function withTimeout(promise, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`timed out: ${label}`)), TIMEOUT_MS),
    ),
  ]);
}

function connect(url) {
  const document = new Y.Doc();
  const provider = new HocuspocusProvider({
    url,
    name: docName,
    document,
    token: jwt({ sub: "redis-tls-test", iat: Math.floor(Date.now() / 1000) }),
  });
  const synced = new Promise((resolve, reject) => {
    provider.on("synced", () => resolve());
    provider.on("authenticationFailed", ({ reason }) =>
      reject(new Error(`${url} auth failed: ${reason}`)),
    );
  });
  return withTimeout(synced, `initial sync with ${url}`).then(() => ({ provider, document }));
}

const clients = [];
try {
  const b = await connect(B);
  clients.push(b);
  const a = await connect(A);
  clients.push(a);

  const arrived = new Promise((resolve) => {
    const text = b.document.getText("content");
    text.observe(() => {
      if (text.toString().includes(marker)) resolve();
    });
  });
  a.document.getText("content").insert(0, marker);

  await withTimeout(arrived, `update from ${A} reaching ${B}`);
  console.log(`PASS: "${marker}" written on ${A} arrived on ${B} (doc ${docName})`);
  process.exitCode = 0;
} catch (err) {
  console.error(`FAIL: ${err.message}`);
  process.exitCode = 1;
} finally {
  for (const { provider } of clients) provider.destroy();
  setTimeout(() => process.exit(), 200);
}

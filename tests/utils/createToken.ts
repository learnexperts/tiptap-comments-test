import { createHmac } from "node:crypto";
import { type TiptapClaims } from "./claims";

const DEFAULT_SECRET = "dev-jwt-secret";
const DEFAULT_TTL_SECONDS = 60 * 60;

/** A JWT token for the on-premises TipTap collaboration server. */
export type TiptapToken = string & { __brand: "Token" };

/**
 * Mint an HS256 JWT for the on-premises TipTap collaboration server.
 * Uses `TIPTAP_JWT_SECRET` when set, otherwise the local dev dummy secret.
 * @param claims - Document permission claims (document names must match provider `name`)
 * @param secret - Optional override for the signing secret
 */
export function createToken(
  claims: TiptapClaims,
  secret = process.env.TIPTAP_JWT_SECRET ?? DEFAULT_SECRET,
): TiptapToken {
  const now = Math.floor(Date.now() / 1000);
  const payload: TiptapClaims = {
    iat: now,
    exp: now + DEFAULT_TTL_SECONDS,
    allowedDocumentNames: [],
    readonlyDocumentNames: [],
    commentDocumentNames: [],
    ...claims,
  };

  const header = base64UrlEncode(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = base64UrlEncode(JSON.stringify(payload));
  const signingInput = `${header}.${body}`;
  const signature = createHmac("sha256", secret)
    .update(signingInput)
    .digest("base64url");

  return `${signingInput}.${signature}` as TiptapToken;
}

/**
 * Base64url-encode a string or buffer for JWT segments.
 * @param data - Raw segment bytes
 */
function base64UrlEncode(data: string | Buffer): string {
  return Buffer.from(data).toString("base64url");
}

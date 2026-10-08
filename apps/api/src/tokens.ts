import { createHmac, timingSafeEqual } from "node:crypto";

export interface AccessClaims {
  sub: string;
  org: string;
  role: string;
  sid: string;
  exp: number;
}

function encode(value: string): string {
  return Buffer.from(value).toString("base64url");
}

export function signAccessToken(
  claims: Omit<AccessClaims, "exp">,
  secret: string,
  ttlSeconds = 15 * 60,
): string {
  const header = encode(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = encode(
    JSON.stringify({ ...claims, exp: Math.floor(Date.now() / 1000) + ttlSeconds }),
  );
  const signature = createHmac("sha256", secret).update(`${header}.${body}`).digest("base64url");
  return `${header}.${body}.${signature}`;
}

export function verifyAccessToken(token: string, secret: string): AccessClaims | null {
  const parts = token.split(".");
  if (parts.length !== 3) {
    return null;
  }
  const [header, body, signature] = parts;
  if (!header || !body || !signature) {
    return null;
  }
  const expected = createHmac("sha256", secret).update(`${header}.${body}`).digest("base64url");
  const actualBuf = Buffer.from(signature);
  const expectedBuf = Buffer.from(expected);
  if (actualBuf.length !== expectedBuf.length || !timingSafeEqual(actualBuf, expectedBuf)) {
    return null;
  }
  let parsed: AccessClaims;
  try {
    parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as AccessClaims;
  } catch {
    return null;
  }
  if (!parsed.exp || parsed.exp * 1000 <= Date.now()) {
    return null;
  }
  return parsed;
}

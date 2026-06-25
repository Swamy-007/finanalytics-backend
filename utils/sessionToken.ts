import crypto from "crypto";

const SECRET = process.env.SESSION_SECRET ?? "dev-secret-change-in-prod";
const SEVEN_DAYS = 7 * 24 * 60 * 60;

export interface SessionPayload {
  sub:  string; // email
  name: string;
  id:   string;
  type: "session";
  iat:  number;
  exp:  number;
}

function b64url(s: string): string {
  return Buffer.from(s).toString("base64url");
}

const HEADER = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));

function hmac(data: string): string {
  return crypto.createHmac("sha256", SECRET).update(data).digest("base64url");
}

export function issueSessionToken(id: string, email: string, name: string): string {
  const now = Math.floor(Date.now() / 1000);
  const body = b64url(JSON.stringify({
    sub: email, name, id, type: "session", iat: now, exp: now + SEVEN_DAYS,
  } satisfies SessionPayload));
  return `${HEADER}.${body}.${hmac(`${HEADER}.${body}`)}`;
}

export function verifySessionToken(token: string): SessionPayload | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const [header, body, sig] = parts as [string, string, string];

    const expected = hmac(`${header}.${body}`);
    if (sig.length !== expected.length) return null;
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;

    const payload = JSON.parse(Buffer.from(body, "base64url").toString()) as SessionPayload;
    if (payload.type !== "session") return null;
    if (Date.now() / 1000 > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}

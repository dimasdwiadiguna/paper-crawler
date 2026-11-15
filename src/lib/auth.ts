/** Shared-passcode session. The cookie holds an HMAC of a fixed message keyed by APP_PASSCODE,
 *  so changing the passcode logs every browser out. Uses Web Crypto (works in proxy and routes). */
export const SESSION_COOKIE = "pc_session";
export const SESSION_MAX_AGE = 60 * 60 * 24 * 90; // 90 days

async function hmacHex(key: string, msg: string): Promise<string> {
  const enc = new TextEncoder();
  const k = await crypto.subtle.importKey("raw", enc.encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", k, enc.encode(msg));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function passcode(): string | null {
  const p = process.env.APP_PASSCODE;
  return p && p.length ? p : null;
}

export async function sessionToken(): Promise<string | null> {
  const p = passcode();
  return p ? hmacHex(p, "paper-crawler-session-v1") : null;
}

export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function isValidSession(cookie: string | undefined | null): Promise<boolean> {
  if (!cookie) return false;
  const t = await sessionToken();
  return !!t && safeEqual(cookie, t);
}

/** Compare the submitted passcode via HMAC so timing doesn't leak its length. */
export async function checkPasscode(input: string): Promise<boolean> {
  const p = passcode();
  if (!p) return false;
  const [a, b] = await Promise.all([hmacHex("cmp", input), hmacHex("cmp", p)]);
  return safeEqual(a, b);
}

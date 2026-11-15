export class SourceError extends Error {
  constructor(
    message: string,
    public status?: number,
  ) {
    super(message);
  }
}

export function contactEmail(): string | null {
  const e = process.env.CONTACT_EMAIL?.trim();
  return e ? e : null;
}

export function userAgent(): string {
  const email = contactEmail();
  return `paper-crawler/1.0 (personal research tool${email ? `; mailto:${email}` : ""})`;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface RetryOptions {
  retries?: number;
  /** Don't wait longer than this for one Retry-After; fail instead (keeps steps short). */
  maxWaitMs?: number;
  timeoutMs?: number;
  headers?: Record<string, string>;
}

/**
 * GET JSON with exponential backoff on 429 / 5xx / network errors.
 * Honours Retry-After when it is short; a long Retry-After (e.g. a daily quota) fails fast.
 */
export async function getJson<T>(url: string, opts: RetryOptions = {}): Promise<T> {
  const retries = opts.retries ?? 4;
  const maxWait = opts.maxWaitMs ?? 8000;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 25000);
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": userAgent(), Accept: "application/json", ...opts.headers },
        signal: ctrl.signal,
        cache: "no-store",
      });
      if (res.ok) return (await res.json()) as T;
      const body = await res.text().catch(() => "");
      if (res.status === 429 || res.status >= 500) {
        const ra = Number(res.headers.get("retry-after"));
        const wait = Number.isFinite(ra) && ra > 0 ? ra * 1000 : 1000 * 2 ** attempt;
        if (wait > maxWait || attempt === retries) {
          throw new SourceError(`HTTP ${res.status}: ${summarize(body)}`, res.status);
        }
        await sleep(wait + Math.random() * 250);
        continue;
      }
      throw new SourceError(`HTTP ${res.status}: ${summarize(body)}`, res.status);
    } catch (e) {
      lastErr = e;
      if (e instanceof SourceError) throw e;
      if (attempt === retries) break;
      await sleep(1000 * 2 ** attempt);
    } finally {
      clearTimeout(timer);
    }
  }
  throw new SourceError(`Request failed: ${(lastErr as Error)?.message ?? lastErr}`);
}

function summarize(body: string): string {
  try {
    const j = JSON.parse(body);
    const m = j.message ?? j.error ?? body;
    return (typeof m === "string" ? m : JSON.stringify(m)).slice(0, 300);
  } catch {
    return body.slice(0, 300);
  }
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function toDate(ts: string | Date): string {
  return new Date(ts).toISOString().slice(0, 10);
}

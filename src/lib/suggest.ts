import { normalizeTerm } from "./matcher";
import { terms } from "./text";

export interface TermStat {
  term: string;
  /** z-scored smoothed log-odds (target vs. reference) */
  z: number;
  logOdds: number;
  /** documents in the target set containing the term */
  inTarget: number;
  /** documents in the reference set containing the term */
  inReference: number;
}

/** Document frequency of each unigram/bigram. */
export function docFreq(texts: string[]): Map<string, number> {
  const df = new Map<string, number>();
  for (const t of texts) for (const term of new Set(terms(t))) df.set(term, (df.get(term) ?? 0) + 1);
  return df;
}

/**
 * Smoothed log-odds ratio of a term appearing in a target-set document vs. a reference-set document
 * (Haldane–Anscombe α=0.5 smoothing), divided by its standard error (z-score) so rare terms don't dominate.
 */
export function logOdds(a: number, nA: number, b: number, nB: number, alpha = 0.5): { delta: number; z: number } {
  const la = Math.log((a + alpha) / (nA - a + alpha));
  const lb = Math.log((b + alpha) / (nB - b + alpha));
  const delta = la - lb;
  const variance = 1 / (a + alpha) + 1 / (nA - a + alpha) + 1 / (b + alpha) + 1 / (nB - b + alpha);
  return { delta, z: delta / Math.sqrt(variance) };
}

/**
 * Top terms over-represented in `target` documents compared with `reference` documents.
 * Skips terms already used in the topic (`known`), and terms seen in fewer than `minDocs` targets.
 */
export function overRepresented(
  target: string[],
  reference: string[],
  opts: { k?: number; minDocs?: number; known?: string[] } = {},
): TermStat[] {
  const k = opts.k ?? 15;
  const minDocs = opts.minDocs ?? 2;
  const known = new Set((opts.known ?? []).map(normalizeTerm));
  const knownWords = new Set([...known].flatMap((t) => t.split(" ")));
  const dfT = docFreq(target);
  const dfR = docFreq(reference);
  const out: TermStat[] = [];
  for (const [term, a] of dfT) {
    if (a < minDocs) continue;
    if (known.has(term)) continue;
    // A unigram that's part of a known term, or a bigram made only of known words, adds nothing.
    const words = term.split(" ");
    if (words.every((w) => knownWords.has(w))) continue;
    const b = dfR.get(term) ?? 0;
    const { delta, z } = logOdds(a, target.length, b, reference.length);
    if (delta <= 0) continue;
    out.push({ term, z, logOdds: delta, inTarget: a, inReference: b });
  }
  out.sort((x, y) => y.z - x.z || y.inTarget - x.inTarget);
  // Prefer a bigram over its own unigrams when both rank: drop a unigram already covered by a higher bigram.
  const picked: TermStat[] = [];
  for (const s of out) {
    if (picked.length >= k) break;
    if (!s.term.includes(" ") && picked.some((p) => p.term.split(" ").includes(s.term) && p.inTarget >= s.inTarget * 0.8)) continue;
    picked.push(s);
  }
  return picked;
}

export const MIN_SUGGEST_LABELS = 10;

import { terms } from "./text";
import type { Label } from "./types";

export type SparseVec = Map<string, number>;

export interface Doc {
  id: number;
  text: string;
  label: Label | null;
  topics: string[];
}

/** Fit IDF on the corpus and return L2-normalised TF-IDF vectors (sublinear tf). */
export function tfidfVectors(texts: string[], minDf = 1): SparseVec[] {
  const counts = texts.map((t) => {
    const m = new Map<string, number>();
    for (const term of terms(t)) m.set(term, (m.get(term) ?? 0) + 1);
    return m;
  });
  const df = new Map<string, number>();
  for (const m of counts) for (const k of m.keys()) df.set(k, (df.get(k) ?? 0) + 1);
  const n = texts.length;
  return counts.map((m) => {
    const v: SparseVec = new Map();
    let norm = 0;
    for (const [k, tf] of m) {
      const d = df.get(k)!;
      if (d < minDf) continue;
      const w = (1 + Math.log(tf)) * (Math.log((1 + n) / (1 + d)) + 1);
      v.set(k, w);
      norm += w * w;
    }
    norm = Math.sqrt(norm) || 1;
    for (const [k, w] of v) v.set(k, w / norm);
    return v;
  });
}

export function centroid(vecs: SparseVec[]): SparseVec | null {
  if (!vecs.length) return null;
  const c: SparseVec = new Map();
  for (const v of vecs) for (const [k, w] of v) c.set(k, (c.get(k) ?? 0) + w / vecs.length);
  return c;
}

export function cosine(a: SparseVec, b: SparseVec | null): number {
  if (!b) return 0;
  const [small, big] = a.size <= b.size ? [a, b] : [b, a];
  let dot = 0;
  for (const [k, w] of small) {
    const o = big.get(k);
    if (o) dot += w * o;
  }
  let na = 0;
  let nb = 0;
  for (const w of a.values()) na += w * w;
  for (const w of b.values()) nb += w * w;
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

interface Centroids {
  relevant: SparseVec | null;
  close: SparseVec | null;
  not_related: SparseVec | null;
}

function centroidsOf(vecs: SparseVec[], labels: (Label | null)[]): Centroids {
  const by = (l: Label) => centroid(vecs.filter((_, i) => labels[i] === l));
  return { relevant: by("relevant"), close: by("close"), not_related: by("not_related") };
}

export function scoreAgainst(v: SparseVec, c: Centroids): number {
  return cosine(v, c.relevant) + 0.5 * cosine(v, c.close) - cosine(v, c.not_related);
}

export const MIN_TOTAL_LABELS = 5;
export const MIN_TOPIC_LABELS = 10;

/**
 * Score every unlabeled doc: sim(Relevant) + 0.5·sim(Close) − sim(Not related),
 * with per-topic centroids when the topic has >= 10 labels, otherwise global centroids.
 * A doc in several topics gets its best score. Returns null scores in cold start (< 5 labels).
 */
export function scoreDocs(docs: Doc[]): Map<number, number | null> {
  const out = new Map<number, number | null>();
  const labeledCount = docs.filter((d) => d.label).length;
  if (labeledCount < MIN_TOTAL_LABELS) {
    for (const d of docs) out.set(d.id, null);
    return out;
  }
  const vecs = tfidfVectors(
    docs.map((d) => d.text),
    docs.length >= 50 ? 2 : 1,
  );
  const labels = docs.map((d) => d.label);
  const global = centroidsOf(vecs, labels);

  const topicIdx = new Map<string, number[]>();
  docs.forEach((d, i) => {
    if (!d.label) return;
    for (const t of d.topics) {
      if (!topicIdx.has(t)) topicIdx.set(t, []);
      topicIdx.get(t)!.push(i);
    }
  });
  const perTopic = new Map<string, Centroids>();
  for (const [t, idx] of topicIdx) {
    if (idx.length >= MIN_TOPIC_LABELS) {
      perTopic.set(
        t,
        centroidsOf(
          idx.map((i) => vecs[i]),
          idx.map((i) => labels[i]),
        ),
      );
    }
  }

  docs.forEach((d, i) => {
    if (d.label) {
      out.set(d.id, null);
      return;
    }
    const cs = d.topics.length ? d.topics.map((t) => perTopic.get(t) ?? global) : [global];
    const s = Math.max(...cs.map((c) => scoreAgainst(vecs[i], c)));
    out.set(d.id, Math.round(s * 10000) / 10000);
  });
  return out;
}

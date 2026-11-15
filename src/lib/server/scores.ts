import { chunk, db } from "./db";
import { loadCorpus } from "./repo";
import { scoreDocs } from "../tfidf";
import { paperText } from "../text";
import type { Label } from "../types";

/** Recompute TF-IDF relevance scores for every unlabeled paper and store them. */
export async function recomputeScores(): Promise<{ scored: number; labels: number; coldStart: boolean }> {
  const corpus = await loadCorpus();
  const docs = corpus.map((p) => ({
    id: p.id,
    text: paperText(p),
    label: p.label as Label | null,
    topics: p.topics,
  }));
  const scores = scoreDocs(docs);
  const labels = docs.filter((d) => d.label).length;
  const payload = [...scores].map(([id, score]) => ({ id, score }));
  for (const part of chunk(payload, 2000)) {
    const res = await db().rpc("set_scores", { scores: part });
    if (res.error) throw new Error(res.error.message);
  }
  return { scored: payload.filter((p) => p.score !== null).length, labels, coldStart: labels < 5 };
}

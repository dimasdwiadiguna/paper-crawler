import { json, route } from "@/lib/server/http";
import { getTopic, loadCorpus } from "@/lib/server/repo";
import { MIN_SUGGEST_LABELS, overRepresented } from "@/lib/suggest";
import { paperText } from "@/lib/text";
import { prepareText, termMatchesPrepared } from "@/lib/matcher";

export const maxDuration = 60;

export const GET = route<{ params: Promise<{ id: string }> }>(async (_req, { params }) => {
  const { id } = await params;
  const topic = await getTopic(id);
  if (!topic) return json({ error: "Not found" }, 404);
  const corpus = await loadCorpus({ topicId: id });
  const notRelated = corpus.filter((p) => p.label === "not_related").map(paperText);
  const positive = corpus.filter((p) => p.label === "relevant" || p.label === "close").map(paperText);
  const relevant = corpus.filter((p) => p.label === "relevant").map(paperText);
  const inbox = corpus.filter((p) => !p.label && p.status === "active").map((p) => prepareText(paperText(p)));
  const counts = { notRelated: notRelated.length, positive: positive.length, relevant: relevant.length, inbox: inbox.length };
  if (notRelated.length < MIN_SUGGEST_LABELS || positive.length < MIN_SUGGEST_LABELS) {
    return json({ ready: false, counts, need: MIN_SUGGEST_LABELS, exclude: [], synonyms: [] });
  }
  const known = [...topic.blocks.flat(), ...topic.exclude_terms];
  const exclude = overRepresented(notRelated, positive, { k: 15, known }).map((s) => ({
    ...s,
    // how many current inbox papers of this topic adding it as an exclude term would remove
    wouldRemove: inbox.filter((t) => termMatchesPrepared(t, s.term)).length,
  }));
  const others = corpus.filter((p) => p.label && p.label !== "relevant").map(paperText);
  const synonyms = relevant.length >= 3 ? overRepresented(relevant, others, { k: 15, known }) : [];
  return json({ ready: true, counts, exclude, synonyms });
});

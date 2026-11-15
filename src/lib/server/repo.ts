import { check, db, fetchAll } from "./db";
import type { TopicGroup } from "../types";
import { normIssn, type VenueRules } from "../venue";

export const PAPER_COLUMNS =
  "id,doi,title_hash,title,abstract,authors,journal,issn_l,issns,pub_date,year,type,fields,unclassified,sources,status,label,labeled_at,score,first_seen_run_id";

export async function listTopics(): Promise<TopicGroup[]> {
  return check(await db().from("topic_groups").select("*").order("created_at")) as TopicGroup[];
}

export async function getTopic(id: string): Promise<TopicGroup | null> {
  const res = await db().from("topic_groups").select("*").eq("id", id).maybeSingle();
  return check(res) as TopicGroup | null;
}

export async function loadVenueRules(): Promise<VenueRules> {
  const [wl, fields] = await Promise.all([
    db().from("journal_whitelist").select("issn_l,issns"),
    db().from("allowed_fields").select("openalex_id"),
  ]);
  const whitelistIssns = new Set<string>();
  for (const j of check(wl) as { issn_l: string; issns: string[] }[]) {
    whitelistIssns.add(normIssn(j.issn_l));
    for (const i of j.issns ?? []) whitelistIssns.add(normIssn(i));
  }
  const allowedFieldIds = new Set((check(fields) as { openalex_id: string }[]).map((f) => f.openalex_id));
  return { whitelistIssns, allowedFieldIds };
}

export async function labelCount(): Promise<number> {
  const res = await db().from("papers").select("id", { count: "exact", head: true }).not("label", "is", null);
  if (res.error) throw new Error(res.error.message);
  return res.count ?? 0;
}

export interface LabeledText {
  id: number;
  title: string;
  abstract: string | null;
  label: string | null;
  status: string;
  topics: string[];
}

/** All papers that matter for ranking/suggestions (active ones + every labeled one), with topic ids. */
export async function loadCorpus(opts: { topicId?: string } = {}): Promise<LabeledText[]> {
  const sel = opts.topicId
    ? "id,title,abstract,label,status,paper_topics!inner(topic_group_id)"
    : "id,title,abstract,label,status,paper_topics(topic_group_id)";
  const rows = await fetchAll<Record<string, unknown>>((from, to) => {
    let q = db().from("papers").select(sel).or("status.eq.active,label.not.is.null");
    if (opts.topicId) q = q.eq("paper_topics.topic_group_id", opts.topicId);
    return q.order("id").range(from, to);
  });
  return rows.map((r) => ({
    id: r.id as number,
    title: r.title as string,
    abstract: r.abstract as string | null,
    label: r.label as string | null,
    status: r.status as string,
    topics: ((r.paper_topics as { topic_group_id: string }[]) ?? []).map((t) => t.topic_group_id),
  }));
}

import { json, route } from "@/lib/server/http";
import { check, db } from "@/lib/server/db";
import { labelCount, PAPER_COLUMNS } from "@/lib/server/repo";
import { LABELS, PAPER_TYPES, SOURCES } from "@/lib/types";
import { MIN_TOTAL_LABELS } from "@/lib/tfidf";

/**
 * GET /api/papers?view=inbox|library
 *   inbox:   topic, source, type, hasAbstract=1, showFiltered=1
 *   library: q (full text), label, topic, yearFrom, yearTo, journal, type, showFiltered=1
 */
export const GET = route(async (req) => {
  const sp = req.nextUrl.searchParams;
  const view = sp.get("view") === "library" ? "library" : "inbox";
  const limit = Math.min(Number(sp.get("limit")) || 50, 200);
  const offset = Math.max(Number(sp.get("offset")) || 0, 0);
  const topic = sp.get("topic");
  const type = sp.get("type");

  let q = db()
    .from("papers")
    .select(`${PAPER_COLUMNS},paper_topics${topic ? "!inner" : ""}(topic_group_id)`, { count: "exact" });
  if (topic) q = q.eq("paper_topics.topic_group_id", topic);
  if (type && (PAPER_TYPES as readonly string[]).includes(type)) q = q.eq("type", type);
  if (sp.get("showFiltered") !== "1") q = q.eq("status", "active");

  const labels = await labelCount();
  const coldStart = labels < MIN_TOTAL_LABELS;

  if (view === "inbox") {
    q = q.is("label", null);
    const source = sp.get("source");
    if (source && (SOURCES as readonly string[]).includes(source)) q = q.contains("sources", [source]);
    if (sp.get("hasAbstract") === "1") q = q.not("abstract", "is", null);
    q = q.order("first_seen_run_id", { ascending: false, nullsFirst: false });
    if (!coldStart) q = q.order("score", { ascending: false, nullsFirst: false });
    q = q.order("pub_date", { ascending: false, nullsFirst: false }).order("id", { ascending: false });
  } else {
    q = q.not("label", "is", null);
    const label = sp.get("label");
    if (label && (LABELS as readonly string[]).includes(label)) q = q.eq("label", label);
    const text = sp.get("q")?.trim();
    if (text) q = q.textSearch("fts", text, { type: "websearch", config: "english" });
    const yf = Number(sp.get("yearFrom"));
    const yt = Number(sp.get("yearTo"));
    if (yf) q = q.gte("year", yf);
    if (yt) q = q.lte("year", yt);
    const journal = sp.get("journal")?.trim();
    if (journal) q = q.ilike("journal", `%${journal.replace(/[%_]/g, "")}%`);
    q = q.order("labeled_at", { ascending: false });
  }

  const res = await q.range(offset, offset + limit - 1);
  const rows = check(res) as unknown as Record<string, unknown>[];
  const papers = rows.map(({ paper_topics, ...p }) => ({
    ...p,
    topics: ((paper_topics as { topic_group_id: string }[]) ?? []).map((t) => t.topic_group_id),
  }));
  return json({ papers, total: res.count ?? 0, labels, coldStart });
});

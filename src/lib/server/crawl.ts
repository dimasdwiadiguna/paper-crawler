import { check, chunk, db } from "./db";
import { getTopic, listTopics, loadVenueRules, PAPER_COLUMNS } from "./repo";
import { recomputeScores } from "./scores";
import { matchesTopic } from "../matcher";
import { dedupeKey, mergeIntoRow, mergeSourcePapers } from "../merge";
import { paperText, titleHash } from "../text";
import { DEFAULT_OPENALEX_LOOKBACK_DAYS, fetchOpenAlexPage, lookupByDois } from "../sources/openalex";
import { fetchCrossrefPage } from "../sources/crossref";
import { fetchEpmcPage } from "../sources/europepmc";
import { toDate } from "../sources/http";
import { SOURCES, type CrawlWindow, type PageResult, type PaperRow, type SourceName, type SourcePaper, type TopicGroup } from "../types";

export const DEFAULT_CAP = 500;

export interface RunPair {
  topicId: string;
  topicName: string;
  source: SourceName;
  window: CrawlWindow;
}

export interface RunParams {
  cap: number;
  lookbackDays: number;
  pairs: RunPair[];
}

export interface PlanTopic {
  id: string;
  name: string;
  /** null for a source never fetched successfully for this topic */
  cursors: Record<SourceName, string | null>;
  needsRange: boolean;
}

export async function planRun(): Promise<PlanTopic[]> {
  const topics = (await listTopics()).filter((t) => t.active);
  const cursors = check(await db().from("source_cursors").select("*")) as {
    topic_group_id: string;
    source: SourceName;
    last_until: string;
  }[];
  return topics.map((t) => {
    const c = Object.fromEntries(SOURCES.map((s) => [s, null])) as Record<SourceName, string | null>;
    for (const row of cursors) if (row.topic_group_id === t.id) c[row.source] = row.last_until;
    return { id: t.id, name: t.name, cursors: c, needsRange: SOURCES.some((s) => !c[s]) };
  });
}

export async function createRun(input: {
  ranges?: Record<string, { from: string; to: string }>;
  cap?: number;
  lookbackDays?: number;
}): Promise<{ id: number; started_at: string; params: RunParams }> {
  const plan = await planRun();
  const missing = plan.filter((t) => t.needsRange && !input.ranges?.[t.id]);
  if (missing.length) throw new Error(`Date range required for first run of: ${missing.map((m) => m.name).join(", ")}`);
  if (!plan.length) throw new Error("No active topic groups");

  // A run left 'running' (tab closed mid-crawl) can't be resumed; mark it.
  await db().from("runs").update({ status: "abandoned", finished_at: new Date().toISOString() }).eq("status", "running");

  const startedAt = new Date().toISOString();
  const today = toDate(startedAt);
  const pairs: RunPair[] = [];
  for (const t of plan) {
    for (const source of SOURCES) {
      const cursor = t.cursors[source];
      const r = input.ranges?.[t.id];
      const window: CrawlWindow = cursor
        ? { mode: "incremental", from: toDate(cursor), to: today }
        : { mode: "initial", from: r!.from, to: r!.to };
      pairs.push({ topicId: t.id, topicName: t.name, source, window });
    }
  }
  const params: RunParams = {
    cap: clampInt(input.cap, 1, 10000, DEFAULT_CAP),
    lookbackDays: clampInt(input.lookbackDays, 1, 365, DEFAULT_OPENALEX_LOOKBACK_DAYS),
    pairs,
  };
  const run = check(
    await db().from("runs").insert({ started_at: startedAt, params, status: "running" }).select("id,started_at,params").single(),
  ) as { id: number; started_at: string; params: RunParams };
  return run;
}

function clampInt(v: unknown, min: number, max: number, dflt: number): number {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n >= min && n <= max ? n : dflt;
}

export async function fetchSourcePage(
  source: SourceName,
  topic: TopicGroup,
  window: CrawlWindow,
  cursor: string | null,
  lookbackDays = DEFAULT_OPENALEX_LOOKBACK_DAYS,
): Promise<PageResult> {
  switch (source) {
    case "openalex":
      return fetchOpenAlexPage(topic, window, cursor, { lookbackDays });
    case "crossref":
      return fetchCrossrefPage(topic, window, cursor);
    case "europepmc":
      return fetchEpmcPage(topic, window, cursor);
  }
}

export interface StepCounts {
  fetched: number;
  nomatch: number;
  new: number;
  dupes: number;
  filtered: number;
}

export interface StepResult extends StepCounts {
  done: boolean;
  nextCursor: string | null;
  capHit: boolean;
  total: number | null;
  error: string | null;
  warning: string | null;
}

/** Fill fields / ISSN-L for Crossref & Europe PMC records from OpenAlex, by DOI in batches of 50. */
async function enrichFromOpenAlex(papers: SourcePaper[]): Promise<string | null> {
  const need = papers.filter((p) => p.doi && (!p.fields || !p.issn_l));
  if (!need.length) return null;
  try {
    const found = await lookupByDois(need.map((p) => p.doi!));
    for (const p of need) {
      const hit = found.get(p.doi!);
      if (!hit) continue;
      p.fields = p.fields?.length ? p.fields : hit.fields;
      p.issn_l = p.issn_l ?? hit.issn_l;
      p.issns = [...new Set([...p.issns, ...hit.issns])];
      p.journal = p.journal ?? hit.journal;
    }
    return null;
  } catch (e) {
    // Not fatal: papers are kept and flagged "unclassified".
    return `OpenAlex field lookup failed: ${(e as Error).message}`;
  }
}

/** Store matched records: dedupe against the DB, merge, insert/update, link to the topic. */
export async function storePapers(
  records: SourcePaper[],
  topicId: string,
  runId: number,
): Promise<Pick<StepCounts, "new" | "dupes" | "filtered">> {
  const rules = await loadVenueRules();
  const dois = [...new Set(records.map((r) => r.doi).filter((d): d is string => !!d))];
  const hashes = [...new Set(records.map((r) => titleHash(r.title, r.year)))];
  const byDoi = new Map<string, PaperRow>();
  const byHash = new Map<string, PaperRow>();
  for (const part of chunk(dois, 80)) {
    for (const r of check(await db().from("papers").select(PAPER_COLUMNS).in("doi", part)) as unknown as PaperRow[]) byDoi.set(r.doi!, r);
  }
  for (const part of chunk(hashes, 80)) {
    const rows = check(await db().from("papers").select(PAPER_COLUMNS).in("title_hash", part)) as unknown as PaperRow[];
    // Title-hash matching only joins a DOI-less row, or a DOI-less incoming record.
    for (const r of rows) if (!byHash.has(r.title_hash) || !r.doi) byHash.set(r.title_hash, r);
  }

  const inserts: PaperRow[] = [];
  const updates: PaperRow[] = [];
  let dupes = 0;
  let filtered = 0;
  for (const rec of records) {
    const h = titleHash(rec.title, rec.year);
    let existing = rec.doi ? byDoi.get(rec.doi) : undefined;
    if (!existing) {
      const cand = byHash.get(h);
      if (cand && (!cand.doi || !rec.doi)) existing = cand;
    }
    const row = mergeIntoRow(existing ?? null, rec, rules, runId);
    if (row.status === "filtered") filtered++;
    if (existing) {
      dupes++;
      updates.push(row);
    } else {
      inserts.push(row);
    }
  }

  const ids: number[] = [];
  if (inserts.length) {
    const rows = check(await db().from("papers").insert(inserts.map(insertPayload)).select("id")) as { id: number }[];
    ids.push(...rows.map((r) => r.id));
  }
  if (updates.length) {
    // Never write label/labeled_at/score/first_seen here, so labeling during a run is never overwritten.
    const res = await db().from("papers").upsert(updates.map(updatePayload), { onConflict: "id" });
    if (res.error) throw new Error(res.error.message);
    ids.push(...updates.map((u) => u.id!));
  }
  if (ids.length) {
    const res = await db()
      .from("paper_topics")
      .upsert(
        ids.map((id) => ({ paper_id: id, topic_group_id: topicId })),
        { onConflict: "paper_id,topic_group_id", ignoreDuplicates: true },
      );
    if (res.error) throw new Error(res.error.message);
  }
  return { new: inserts.length, dupes, filtered };
}

function insertPayload(r: PaperRow) {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { id, ...rest } = r;
  return rest;
}

function updatePayload(r: PaperRow) {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { label, labeled_at, score, first_seen_run_id, ...rest } = r;
  return rest;
}

/** Keep matching records and collapse in-page duplicates. */
export function matchAndCollapse(records: SourcePaper[], topic: TopicGroup): { kept: SourcePaper[]; nomatch: number } {
  const byKey = new Map<string, SourcePaper>();
  let nomatch = 0;
  for (const r of records) {
    if (!matchesTopic(paperText(r), topic)) {
      nomatch++;
      continue;
    }
    const k = dedupeKey(r);
    const prev = byKey.get(k);
    byKey.set(k, prev ? mergeSourcePapers(prev, r) : r);
  }
  return { kept: [...byKey.values()], nomatch };
}

export async function runStep(input: {
  runId: number;
  pair: number;
  page: number;
  cursor: string | null;
  fetchedSoFar: number;
}): Promise<StepResult> {
  const run = check(await db().from("runs").select("id,started_at,status,params").eq("id", input.runId).single()) as {
    id: number;
    started_at: string;
    status: string;
    params: RunParams;
  };
  if (run.status !== "running") throw new Error(`Run ${run.id} is ${run.status}`);
  const pair = run.params.pairs[input.pair];
  if (!pair) throw new Error("Unknown step");
  const counts: StepCounts = { fetched: 0, nomatch: 0, new: 0, dupes: 0, filtered: 0 };
  let result: StepResult;
  try {
    const topic = await getTopic(pair.topicId);
    if (!topic) throw new Error("Topic group was deleted");
    const page = await fetchSourcePage(pair.source, topic, pair.window, input.cursor, run.params.lookbackDays);
    counts.fetched = page.records.length + page.skipped;
    const { kept, nomatch } = matchAndCollapse(page.records, topic);
    counts.nomatch = nomatch + page.skipped;
    const warning = await enrichFromOpenAlex(kept);
    if (kept.length) Object.assign(counts, await storePapers(kept, topic.id, run.id));
    const total = input.fetchedSoFar + counts.fetched;
    const capHit = !!page.nextCursor && total >= run.params.cap;
    result = {
      ...counts,
      done: !page.nextCursor || capHit,
      nextCursor: capHit ? null : page.nextCursor,
      capHit,
      total: page.total,
      error: null,
      warning,
    };
  } catch (e) {
    result = { ...counts, done: true, nextCursor: null, capHit: false, total: null, error: (e as Error).message, warning: null };
  }

  const ins = await db().from("run_steps").insert({
    run_id: run.id,
    topic_group_id: pair.topicId,
    source: pair.source,
    page: input.page,
    fetched: result.fetched,
    nomatch: result.nomatch,
    new: result.new,
    dupes: result.dupes,
    filtered: result.filtered,
    cap_hit: result.capHit,
    error: result.error ?? result.warning,
  });
  if (ins.error) throw new Error(ins.error.message);

  // Move the cursor only when every page of this (topic, source) finished without errors.
  if (result.done && !result.error) {
    const errs = await db()
      .from("run_steps")
      .select("id", { count: "exact", head: true })
      .eq("run_id", run.id)
      .eq("topic_group_id", pair.topicId)
      .eq("source", pair.source)
      .not("error", "is", null)
      .not("error", "like", "OpenAlex field lookup failed%");
    if (errs.error) throw new Error(errs.error.message);
    if (!errs.count) {
      const up = await db()
        .from("source_cursors")
        .upsert({ topic_group_id: pair.topicId, source: pair.source, last_until: run.started_at }, { onConflict: "topic_group_id,source" });
      if (up.error) throw new Error(up.error.message);
    }
  }
  return result;
}

export interface RunSummary {
  totals: StepCounts & { errors: number };
  bySource: Record<string, StepCounts & { errors: number; capHit: boolean; pages: number }>;
  byTopic: Record<string, StepCounts & { errors: number }>;
  capHits: { topicId: string; source: SourceName }[];
  errors: { topicId: string | null; source: SourceName; page: number; error: string }[];
  scoring?: { scored: number; labels: number; coldStart: boolean } | { error: string };
}

interface StepRow extends StepCounts {
  topic_group_id: string | null;
  source: SourceName;
  page: number;
  cap_hit: boolean;
  error: string | null;
}

export function summarize(steps: StepRow[]): RunSummary {
  const zero = () => ({ fetched: 0, nomatch: 0, new: 0, dupes: 0, filtered: 0, errors: 0 });
  const s: RunSummary = { totals: zero(), bySource: {}, byTopic: {}, capHits: [], errors: [] };
  for (const st of steps) {
    const isErr = !!st.error && !st.error.startsWith("OpenAlex field lookup failed");
    const src = (s.bySource[st.source] ??= { ...zero(), capHit: false, pages: 0 });
    const top = (s.byTopic[st.topic_group_id ?? "deleted"] ??= zero());
    for (const agg of [s.totals, src, top]) {
      agg.fetched += st.fetched;
      agg.nomatch += st.nomatch;
      agg.new += st.new;
      agg.dupes += st.dupes;
      agg.filtered += st.filtered;
      if (isErr) agg.errors++;
    }
    src.pages++;
    if (st.cap_hit) {
      src.capHit = true;
      s.capHits.push({ topicId: st.topic_group_id ?? "", source: st.source });
    }
    if (st.error) s.errors.push({ topicId: st.topic_group_id, source: st.source, page: st.page, error: st.error });
  }
  return s;
}

export async function finishRun(runId: number): Promise<RunSummary> {
  const steps = check(
    await db().from("run_steps").select("topic_group_id,source,page,fetched,nomatch,new,dupes,filtered,cap_hit,error").eq("run_id", runId).order("id"),
  ) as StepRow[];
  const summary = summarize(steps);
  try {
    summary.scoring = await recomputeScores();
  } catch (e) {
    summary.scoring = { error: (e as Error).message };
  }
  const status = summary.totals.errors ? (summary.totals.new || summary.totals.dupes ? "partial" : "error") : "done";
  const res = await db().from("runs").update({ status, summary, finished_at: new Date().toISOString() }).eq("id", runId);
  if (res.error) throw new Error(res.error.message);
  return summary;
}

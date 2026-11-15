import { cleanBlocks, normalizeTerm } from "../matcher";
import { matchesTopic } from "../matcher";
import { normalizeDoi, paperText, stripJats, stripTags } from "../text";
import type { CrawlWindow, PageResult, PaperType, SourcePaper, TopicGroup } from "../types";
import { addDays, contactEmail, getJson } from "./http";

const BASE = "https://api.crossref.org";
export const CROSSREF_PAGE_SIZE = 100;

function words(term: string): string[] {
  return normalizeTerm(term).split(" ").filter(Boolean);
}

/**
 * Crossref's query is relevance-ranked, not boolean, and it requires a share of the query words to
 * match (more words -> fewer hits). So instead of one long query we send one sub-query per term of
 * the first concept block, each followed by the distinct words of the other blocks:
 *   "soft sensor fermentation bioprocess bioreactor ...", "kalman filter fermentation ...", ...
 * Exclude terms are left out; the boolean rule is enforced locally.
 */
export function buildCrossrefSubqueries(group: Pick<TopicGroup, "blocks">): string[] {
  const blocks = cleanBlocks(group.blocks);
  if (!blocks.length) return [];
  const rest: string[] = [];
  for (const block of blocks.slice(1)) for (const t of block) for (const w of words(t)) if (!rest.includes(w)) rest.push(w);
  const out: string[] = [];
  for (const t of blocks[0]) {
    const own = words(t);
    const q = [...own, ...rest.filter((w) => !own.includes(w))].join(" ");
    if (q && !out.includes(q)) out.push(q);
  }
  return out;
}

/** All distinct words (kept for display / backwards compatibility). */
export function buildCrossrefQuery(group: Pick<TopicGroup, "blocks">): string {
  const seen: string[] = [];
  for (const block of cleanBlocks(group.blocks)) for (const t of block) for (const w of words(t)) if (!seen.includes(w)) seen.push(w);
  return seen.join(" ");
}

export const CROSSREF_TYPES = ["journal-article", "posted-content", "proceedings-article"];

/**
 * initial: publication date range.
 * incremental: `from-created-date` (first deposit of the DOI), minus 1 day of overlap.
 * Note: `from-index-date` is NOT used — Crossref re-indexes old records constantly, so an
 * index-date window returns many years-old papers.
 */
export function crossrefDateFilter(window: CrawlWindow): string[] {
  if (window.mode === "initial") return [`from-pub-date:${window.from}`, `until-pub-date:${window.to}`];
  return [`from-created-date:${addDays(window.from, -1)}`, `until-created-date:${window.to}`];
}

const SELECT = "DOI,title,abstract,author,container-title,ISSN,issn-type,published,issued,type";

/**
 * Paging uses `offset`, not `cursor`: Crossref's deep-paging cursor drops relevance ordering, which
 * pushed on-topic results far down the list (verified Nov 2026). Offset is limited to 10,000, far above the cap.
 */
export function buildCrossrefUrl(query: string, window: CrawlWindow, offset = 0, rows = CROSSREF_PAGE_SIZE): string {
  const filter = [...crossrefDateFilter(window), ...CROSSREF_TYPES.map((t) => `type:${t}`)].join(",");
  const params = new URLSearchParams({
    "query.bibliographic": query,
    filter,
    rows: String(rows),
    offset: String(offset),
    select: SELECT,
  });
  const email = contactEmail();
  if (email) params.set("mailto", email);
  return `${BASE}/works?${params.toString()}`;
}

export function mapCrossrefType(type: string | null | undefined): PaperType | null {
  switch (type) {
    case "journal-article":
      return "article";
    case "posted-content":
      return "preprint";
    case "proceedings-article":
      return "conference";
    default:
      return null;
  }
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function dateParts(d: any): { date: string | null; year: number | null } {
  const parts: number[] | undefined = d?.["date-parts"]?.[0];
  if (!parts || !parts[0]) return { date: null, year: null };
  const [y, m, day] = parts;
  const pad = (n: number) => String(n).padStart(2, "0");
  return { date: `${y}-${pad(m ?? 1)}-${pad(day ?? 1)}`, year: y };
}

export function normalizeCrossrefItem(it: any): SourcePaper | null {
  const type = mapCrossrefType(it.type);
  const title = stripTags(it.title?.[0]);
  if (!type || !title) return null;
  const { date, year } = dateParts(it.published ?? it.issued);
  const authors: string[] = (it.author ?? [])
    .map((a: any) => (a.given || a.family ? [a.given, a.family].filter(Boolean).join(" ") : a.name))
    .filter(Boolean);
  return {
    doi: normalizeDoi(it.DOI),
    title,
    abstract: stripJats(it.abstract),
    authors,
    journal: stripTags(it["container-title"]?.[0]) || null,
    issn_l: null,
    issns: it.ISSN ?? [],
    pub_date: date,
    year,
    type,
    fields: null,
    source: "crossref",
  };
}

/** Paging state across sub-queries: which sub-query, and how many results were taken from it (= offset). */
interface CrossrefState {
  i: number;
  n: number;
}

function parseState(cursor: string | null): CrossrefState {
  if (!cursor) return { i: 0, n: 0 };
  try {
    const s = JSON.parse(cursor);
    if (typeof s.i === "number") return { i: s.i, n: Number(s.n) || 0 };
  } catch {
    /* fall through */
  }
  return { i: 0, n: 0 };
}

/** Results to take from each sub-query so the whole (topic, Crossref) step stays within the cap. */
export function crossrefShare(cap: number, subqueries: number): number {
  return Math.max(20, Math.floor(cap / Math.max(1, subqueries)));
}

export async function fetchCrossrefPage(
  group: TopicGroup,
  window: CrawlWindow,
  cursor: string | null,
  cap = 500,
): Promise<PageResult> {
  const subs = buildCrossrefSubqueries(group);
  const state = parseState(cursor);
  if (!subs.length || state.i >= subs.length) return { records: [], skipped: 0, nextCursor: null, total: 0 };
  const share = crossrefShare(cap, subs.length);
  const rows = Math.min(CROSSREF_PAGE_SIZE, share - state.n);
  const data = await getJson<any>(buildCrossrefUrl(subs[state.i], window, state.n, rows));
  const msg = data.message ?? {};
  const items: any[] = msg.items ?? [];
  const records: SourcePaper[] = [];
  let skipped = 0;
  for (const it of items) {
    const p = normalizeCrossrefItem(it);
    if (p) records.push(p);
    else skipped++;
  }
  const taken = state.n + items.length;
  const moreHere = items.length >= rows && taken < (msg["total-results"] ?? 0);
  let next: CrossrefState | null;
  let truncated = false;
  if (moreHere && taken < share) {
    next = { i: state.i, n: taken };
  } else {
    // Share used up while this page still had on-topic results: more relevant papers likely exist.
    truncated = moreHere && records.some((r) => matchesTopic(paperText(r), group));
    next = state.i + 1 < subs.length ? { i: state.i + 1, n: 0 } : null;
  }
  return {
    records,
    skipped,
    nextCursor: next ? JSON.stringify(next) : null,
    total: msg["total-results"] ?? null,
    truncated,
    label: `query ${state.i + 1}/${subs.length}`,
  };
}

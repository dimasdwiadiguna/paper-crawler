import { cleanBlocks, normalizeTerm } from "../matcher";
import { normalizeDoi, stripJats, stripTags } from "../text";
import type { CrawlWindow, PageResult, PaperType, SourcePaper, TopicGroup } from "../types";
import { addDays, contactEmail, getJson } from "./http";

const BASE = "https://api.crossref.org";
export const CROSSREF_PAGE_SIZE = 100;

/**
 * Crossref's query is relevance-ranked, not boolean: send the distinct words of every block term
 * (exclude terms are left out) and enforce the boolean rule locally.
 */
export function buildCrossrefQuery(group: Pick<TopicGroup, "blocks">): string {
  const seen = new Set<string>();
  const words: string[] = [];
  for (const block of cleanBlocks(group.blocks)) {
    for (const term of block) {
      for (const w of normalizeTerm(term).split(" ")) {
        if (w && !seen.has(w)) {
          seen.add(w);
          words.push(w);
        }
      }
    }
  }
  return words.join(" ");
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

export function buildCrossrefUrl(group: Pick<TopicGroup, "blocks">, window: CrawlWindow, cursor: string | null, rows = CROSSREF_PAGE_SIZE): string {
  const filter = [...crossrefDateFilter(window), ...CROSSREF_TYPES.map((t) => `type:${t}`)].join(",");
  const params = new URLSearchParams({
    "query.bibliographic": buildCrossrefQuery(group),
    filter,
    rows: String(rows),
    cursor: cursor ?? "*",
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

export async function fetchCrossrefPage(group: TopicGroup, window: CrawlWindow, cursor: string | null): Promise<PageResult> {
  const data = await getJson<any>(buildCrossrefUrl(group, window, cursor));
  const msg = data.message ?? {};
  const items: any[] = msg.items ?? [];
  const records: SourcePaper[] = [];
  let skipped = 0;
  for (const it of items) {
    const p = normalizeCrossrefItem(it);
    if (p) records.push(p);
    else skipped++;
  }
  return {
    records,
    skipped,
    nextCursor: items.length >= CROSSREF_PAGE_SIZE ? (msg["next-cursor"] ?? null) : null,
    total: msg["total-results"] ?? null,
  };
}

import { cleanBlocks, normalizeTerm } from "../matcher";
import { normalizeDoi, stripJats, stripTags } from "../text";
import type { CrawlWindow, PageResult, PaperType, SourcePaper, TopicGroup } from "../types";
import { addDays, getJson } from "./http";

const BASE = "https://www.ebi.ac.uk/europepmc/webservices/rest/search";
export const EPMC_PAGE_SIZE = 100;

function fmtTerm(term: string): string | null {
  const cleaned = term.replace(/["“”()\[\]:]/g, " ").replace(/\s+/g, " ").trim();
  if (!normalizeTerm(cleaned)) return null;
  return /[\s-]/.test(cleaned) ? `TITLE_ABS:"${cleaned}"` : `TITLE_ABS:${cleaned}`;
}

/** Boolean topic expression over title + abstract, without date/source clauses. */
export function buildEpmcTopicQuery(group: Pick<TopicGroup, "blocks" | "exclude_terms">): string {
  const blocks = cleanBlocks(group.blocks)
    .map((b) => b.map(fmtTerm).filter((t): t is string => !!t))
    .filter((b) => b.length)
    .map((b) => `(${b.join(" OR ")})`);
  let q = blocks.join(" AND ");
  const ex = group.exclude_terms.map(fmtTerm).filter((t): t is string => !!t);
  if (ex.length) q += ` NOT (${ex.join(" OR ")})`;
  return q;
}

/**
 * initial: FIRST_PDATE (first publication date) range.
 * incremental: FIRST_IDATE (date first indexed in Europe PMC), minus 1 day of overlap.
 */
export function epmcDateClause(window: CrawlWindow): string {
  if (window.mode === "initial") return `FIRST_PDATE:[${window.from} TO ${window.to}]`;
  return `FIRST_IDATE:[${addDays(window.from, -1)} TO ${window.to}]`;
}

/** MED = PubMed/MEDLINE, PMC = PubMed Central-only records, PPR = preprints. */
export const EPMC_SOURCES = "(SRC:MED OR SRC:PMC OR SRC:PPR)";

export function buildEpmcQuery(group: Pick<TopicGroup, "blocks" | "exclude_terms">, window: CrawlWindow): string {
  return `(${buildEpmcTopicQuery(group)}) AND ${EPMC_SOURCES} AND ${epmcDateClause(window)}`;
}

export function buildEpmcUrl(group: Pick<TopicGroup, "blocks" | "exclude_terms">, window: CrawlWindow, cursor: string | null, pageSize = EPMC_PAGE_SIZE): string {
  const params = new URLSearchParams({
    query: buildEpmcQuery(group, window),
    resultType: "core",
    format: "json",
    pageSize: String(pageSize),
    cursorMark: cursor ?? "*",
  });
  return `${BASE}?${params.toString()}`;
}

const EXCLUDED_PUB_TYPES = /(editorial|letter|comment|erratum|correction|retract|news|published erratum|congress abstract)/i;

export function mapEpmcType(source: string | undefined, pubTypes: string[]): PaperType | null {
  const types = pubTypes.map((t) => t.toLowerCase());
  if (source === "PPR" || types.some((t) => t.includes("preprint"))) return "preprint";
  if (types.some((t) => t.includes("review") && !t.includes("peer review"))) return "review";
  if (types.some((t) => t.includes("conference") || t.includes("congress") && !t.includes("abstract"))) return "conference";
  if (types.some((t) => t === "journal article" || t === "research-article" || t === "article")) return "article";
  if (types.length && types.every((t) => EXCLUDED_PUB_TYPES.test(t))) return null;
  // Records with only funding/meta pub types (e.g. "Research Support, ...") are articles.
  return source === "MED" || source === "PMC" ? "article" : null;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
export function normalizeEpmcResult(r: any): SourcePaper | null {
  const pubTypes: string[] = r.pubTypeList?.pubType ?? [];
  const type = mapEpmcType(r.source, pubTypes);
  const title = stripTags(r.title).replace(/\.$/, "");
  if (!type || !title) return null;
  const authors: string[] = (r.authorList?.author ?? [])
    .map((a: any) =>
      a.firstName && a.lastName ? `${a.firstName} ${a.lastName}` : (a.fullName ?? a.collectiveName),
    )
    .filter(Boolean);
  const j = r.journalInfo?.journal;
  const issns = [j?.issn, j?.essn].filter(Boolean) as string[];
  const year = r.pubYear ? Number(r.pubYear) : null;
  return {
    doi: normalizeDoi(r.doi),
    title,
    abstract: stripJats(r.abstractText),
    authors,
    journal: j?.title ?? r.bookOrReportDetails?.publisher ?? null,
    issn_l: null,
    issns: [...new Set(issns)],
    pub_date: r.firstPublicationDate ?? null,
    year: Number.isFinite(year) ? year : null,
    type,
    fields: null,
    source: "europepmc",
  };
}

export async function fetchEpmcPage(group: TopicGroup, window: CrawlWindow, cursor: string | null): Promise<PageResult> {
  const data = await getJson<any>(buildEpmcUrl(group, window, cursor));
  const results: any[] = data.resultList?.result ?? [];
  const records: SourcePaper[] = [];
  let skipped = 0;
  for (const r of results) {
    const p = normalizeEpmcResult(r);
    if (p) records.push(p);
    else skipped++;
  }
  const next: string | null = data.nextCursorMark ?? null;
  return {
    records,
    skipped,
    nextCursor: results.length >= EPMC_PAGE_SIZE && next && next !== cursor ? next : null,
    total: data.hitCount ?? null,
  };
}

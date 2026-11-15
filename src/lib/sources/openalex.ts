import { cleanBlocks, normalizeTerm } from "../matcher";
import { normalizeDoi, rebuildAbstract, stripTags } from "../text";
import type { CrawlWindow, Field, PageResult, PaperType, SourcePaper, TopicGroup } from "../types";
import { addDays, contactEmail, getJson } from "./http";

const BASE = "https://api.openalex.org";
export const OPENALEX_PAGE_SIZE = 200;

/**
 * OpenAlex's created-date filters (from_created_date) are part of the paid "daily sync" plans,
 * so incremental runs use publication date with a look-back window instead (default 30 days),
 * and dedupe absorbs the repeats.
 */
export const DEFAULT_OPENALEX_LOOKBACK_DAYS = 30;

function headers(): Record<string, string> {
  const key = process.env.OPENALEX_API_KEY?.trim();
  return key ? { Authorization: `Bearer ${key}` } : {};
}

function withCommon(params: URLSearchParams): string {
  const email = contactEmail();
  if (email) params.set("mailto", email);
  return params.toString();
}

/** Terms can't contain filter syntax characters (comma separates filters, pipe = OR, colon). */
function fmtTerm(term: string): string | null {
  const cleaned = term.replace(/["“”,|:()]/g, " ").replace(/\s+/g, " ").trim();
  if (!normalizeTerm(cleaned)) return null;
  return /[\s-]/.test(cleaned) ? `"${cleaned}"` : cleaned;
}

/** Boolean expression for title_and_abstract.search, e.g. ("a b" OR c) AND (d OR e) NOT f */
export function buildOpenAlexSearch(group: Pick<TopicGroup, "blocks" | "exclude_terms">): string {
  const blocks = cleanBlocks(group.blocks)
    .map((b) => b.map(fmtTerm).filter((t): t is string => !!t))
    .filter((b) => b.length);
  let q = blocks.map((b) => (b.length === 1 ? b[0] : `(${b.join(" OR ")})`)).join(" AND ");
  for (const ex of group.exclude_terms) {
    const t = fmtTerm(ex);
    if (t) q += ` NOT ${t}`;
  }
  return q;
}

export function openAlexDateFilter(window: CrawlWindow, lookbackDays = DEFAULT_OPENALEX_LOOKBACK_DAYS): string {
  if (window.mode === "initial") {
    return `from_publication_date:${window.from},to_publication_date:${window.to}`;
  }
  return `from_publication_date:${addDays(window.from, -lookbackDays)}`;
}

export const OPENALEX_TYPES = "article|review|preprint|conference-paper";

const SELECT = [
  "id",
  "doi",
  "title",
  "display_name",
  "publication_date",
  "publication_year",
  "type",
  "primary_location",
  "authorships",
  "topics",
  "abstract_inverted_index",
].join(",");

export function buildOpenAlexUrl(
  group: Pick<TopicGroup, "blocks" | "exclude_terms">,
  window: CrawlWindow,
  cursor: string | null,
  opts: { lookbackDays?: number; perPage?: number } = {},
): string {
  const filter = [
    `title_and_abstract.search:${buildOpenAlexSearch(group)}`,
    openAlexDateFilter(window, opts.lookbackDays),
    `type:${OPENALEX_TYPES}`,
  ].join(",");
  const params = new URLSearchParams({
    filter,
    select: SELECT,
    per_page: String(opts.perPage ?? OPENALEX_PAGE_SIZE),
    cursor: cursor ?? "*",
  });
  return `${BASE}/works?${withCommon(params)}`;
}

export function mapOpenAlexType(type: string | null | undefined): PaperType | null {
  switch (type) {
    case "article":
      return "article";
    case "review":
      return "review";
    case "preprint":
      return "preprint";
    case "conference-paper":
      return "conference";
    default:
      return null;
  }
}

/* eslint-disable @typescript-eslint/no-explicit-any */
export function fieldsFromTopics(topics: any[] | null | undefined): Field[] | null {
  if (!topics || !topics.length) return null;
  const out = new Map<string, Field>();
  for (const t of topics) {
    if (t.field?.id) {
      const id = shortId(t.field.id);
      out.set(id, { id, name: t.field.display_name, level: "field" });
    }
    if (t.subfield?.id) {
      const id = shortId(t.subfield.id);
      out.set(id, { id, name: t.subfield.display_name, level: "subfield" });
    }
  }
  return out.size ? [...out.values()] : null;
}

/** "https://openalex.org/fields/22" -> "fields/22" */
export function shortId(id: string): string {
  return id.replace(/^https?:\/\/openalex\.org\//, "");
}

export function normalizeOpenAlexWork(w: any): SourcePaper | null {
  const type = mapOpenAlexType(w.type);
  const title = stripTags(w.title ?? w.display_name);
  if (!type || !title) return null;
  const src = w.primary_location?.source;
  return {
    doi: normalizeDoi(w.doi),
    title,
    abstract: rebuildAbstract(w.abstract_inverted_index),
    authors: (w.authorships ?? [])
      .map((a: any) => a.author?.display_name ?? a.raw_author_name)
      .filter(Boolean),
    journal: src?.display_name ?? null,
    issn_l: src?.issn_l ?? null,
    issns: src?.issn ?? [],
    pub_date: w.publication_date ?? null,
    year: w.publication_year ? Number(w.publication_year) : null,
    type,
    fields: fieldsFromTopics(w.topics),
    source: "openalex",
  };
}

export async function fetchOpenAlexPage(
  group: TopicGroup,
  window: CrawlWindow,
  cursor: string | null,
  opts: { lookbackDays?: number; perPage?: number } = {},
): Promise<PageResult> {
  const data = await getJson<any>(buildOpenAlexUrl(group, window, cursor, opts), { headers: headers() });
  const results: any[] = data.results ?? [];
  const records: SourcePaper[] = [];
  let skipped = 0;
  for (const w of results) {
    const p = normalizeOpenAlexWork(w);
    if (p) records.push(p);
    else skipped++;
  }
  const next = data.meta?.next_cursor ?? null;
  return { records, skipped, nextCursor: results.length ? next : null, total: data.meta?.count ?? null };
}

export interface OpenAlexLookup {
  doi: string;
  fields: Field[] | null;
  journal: string | null;
  issn_l: string | null;
  issns: string[];
}

/** Look up fields (and ISSN-L) for up to 50 DOIs per call via the pipe-separated doi: filter. */
export async function lookupByDois(dois: string[]): Promise<Map<string, OpenAlexLookup>> {
  const out = new Map<string, OpenAlexLookup>();
  const unique = [...new Set(dois.map((d) => normalizeDoi(d)).filter((d): d is string => !!d))]
    // DOIs containing filter delimiters can't be expressed in the filter; skip them.
    .filter((d) => !/[,|]/.test(d));
  for (let i = 0; i < unique.length; i += 50) {
    const batch = unique.slice(i, i + 50);
    const params = new URLSearchParams({
      filter: `doi:${batch.join("|")}`,
      select: "doi,topics,primary_location",
      per_page: "50",
    });
    const data = await getJson<any>(`${BASE}/works?${withCommon(params)}`, { headers: headers() });
    for (const w of data.results ?? []) {
      const doi = normalizeDoi(w.doi);
      if (!doi) continue;
      const src = w.primary_location?.source;
      out.set(doi, {
        doi,
        fields: fieldsFromTopics(w.topics),
        journal: src?.display_name ?? null,
        issn_l: src?.issn_l ?? null,
        issns: src?.issn ?? [],
      });
    }
  }
  return out;
}

export interface SourceSuggestion {
  id: string;
  name: string;
  hint: string | null;
  issn: string | null;
  works_count: number | null;
}

export async function autocompleteSources(q: string): Promise<SourceSuggestion[]> {
  const params = new URLSearchParams({ q });
  const data = await getJson<any>(`${BASE}/autocomplete/sources?${withCommon(params)}`, {
    headers: headers(),
    retries: 1,
  });
  return (data.results ?? []).map((r: any) => ({
    id: shortId(r.id),
    name: r.display_name,
    hint: r.hint ?? null,
    issn: r.external_id ?? null,
    works_count: r.works_count ?? null,
  }));
}

export async function getSource(id: string): Promise<{ id: string; name: string; issn_l: string | null; issns: string[] }> {
  const sid = shortId(id).replace(/^sources\//, "");
  const params = new URLSearchParams({ select: "id,display_name,issn_l,issn" });
  const s = await getJson<any>(`${BASE}/sources/${encodeURIComponent(sid)}?${withCommon(params)}`, {
    headers: headers(),
  });
  return { id: shortId(s.id), name: s.display_name, issn_l: s.issn_l ?? null, issns: s.issn ?? [] };
}

export interface FieldCatalogEntry {
  id: string;
  name: string;
  level: "field" | "subfield";
  parent: string | null;
}

let catalogCache: FieldCatalogEntry[] | null = null;

export async function fieldCatalog(): Promise<FieldCatalogEntry[]> {
  if (catalogCache) return catalogCache;
  const fields = await getJson<any>(`${BASE}/fields?${withCommon(new URLSearchParams({ per_page: "200", select: "id,display_name" }))}`, {
    headers: headers(),
  });
  const out: FieldCatalogEntry[] = (fields.results ?? []).map((f: any) => ({
    id: shortId(f.id),
    name: f.display_name,
    level: "field" as const,
    parent: null,
  }));
  for (let page = 1; page <= 3; page++) {
    const sub = await getJson<any>(
      `${BASE}/subfields?${withCommon(new URLSearchParams({ per_page: "200", page: String(page), select: "id,display_name,field" }))}`,
      { headers: headers() },
    );
    const rs: any[] = sub.results ?? [];
    for (const s of rs) {
      out.push({ id: shortId(s.id), name: s.display_name, level: "subfield", parent: s.field?.id ? shortId(s.field.id) : null });
    }
    if (rs.length < 200) break;
  }
  catalogCache = out;
  return out;
}

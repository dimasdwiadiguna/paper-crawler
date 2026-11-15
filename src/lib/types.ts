export const SOURCES = ["openalex", "crossref", "europepmc"] as const;
export type SourceName = (typeof SOURCES)[number];

export const SOURCE_LABELS: Record<SourceName, string> = {
  openalex: "OpenAlex",
  crossref: "Crossref",
  europepmc: "Europe PMC",
};

export const PAPER_TYPES = ["article", "review", "preprint", "conference"] as const;
export type PaperType = (typeof PAPER_TYPES)[number];

export const LABELS = ["relevant", "close", "not_related"] as const;
export type Label = (typeof LABELS)[number];

export const LABEL_NAMES: Record<Label, string> = {
  relevant: "Relevant",
  close: "Close",
  not_related: "Not related",
};

export type PaperStatus = "active" | "filtered";

/** An OpenAlex field or subfield, e.g. { id: "fields/22", name: "Engineering", level: "field" } */
export interface Field {
  id: string;
  name: string;
  level: "field" | "subfield";
}

/** One record as normalised from a single source. */
export interface SourcePaper {
  doi: string | null;
  title: string;
  abstract: string | null;
  authors: string[];
  journal: string | null;
  issn_l: string | null;
  issns: string[];
  pub_date: string | null; // YYYY-MM-DD
  year: number | null;
  type: PaperType;
  /** null = unknown (not looked up yet / not available) */
  fields: Field[] | null;
  source: SourceName;
}

/** A paper row as stored in the database (minus generated columns). */
export interface PaperRow {
  id?: number;
  doi: string | null;
  title_hash: string;
  title: string;
  abstract: string | null;
  authors: string[];
  journal: string | null;
  issn_l: string | null;
  issns: string[];
  pub_date: string | null;
  year: number | null;
  type: PaperType;
  fields: Field[] | null;
  unclassified: boolean;
  sources: SourceName[];
  status: PaperStatus;
  label: Label | null;
  labeled_at: string | null;
  score: number | null;
  first_seen_run_id: number | null;
}

export interface TopicGroup {
  id: string;
  name: string;
  /** Concept blocks: inner arrays are OR'ed synonyms, blocks are AND'ed. */
  blocks: string[][];
  exclude_terms: string[];
  active: boolean;
  created_at?: string;
}

export type WindowMode = "initial" | "incremental";

/**
 * The date window for one (topic, source) step.
 * initial: publication date between from and to.
 * incremental: records added to the source index since `from` (see each source for details).
 */
export interface CrawlWindow {
  mode: WindowMode;
  from: string; // YYYY-MM-DD
  to: string; // YYYY-MM-DD
}

export interface PageResult {
  records: SourcePaper[];
  /** Records the source returned that we couldn't use (unsupported type, no title). */
  skipped: number;
  nextCursor: string | null;
  total: number | null;
}

import { normalizeDoi, titleHash } from "./text";
import type { PaperRow, SourcePaper } from "./types";
import { decideVenue, type VenueRules } from "./venue";

export function dedupeKey(p: { doi: string | null; title: string; year: number | null }): string {
  const doi = normalizeDoi(p.doi);
  return doi ? `doi:${doi}` : `t:${titleHash(p.title, p.year)}`;
}

function longer(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return b.length > a.length ? b : a;
}

function moreComplete(a: string[], b: string[]): string[] {
  if (b.length !== a.length) return b.length > a.length ? b : a;
  return b.join("").length > a.join("").length ? b : a;
}

/** Collapse records of the same paper from one page (or several sources) into one. */
export function mergeSourcePapers(a: SourcePaper, b: SourcePaper): SourcePaper {
  return {
    ...a,
    doi: a.doi ?? b.doi,
    title: a.title.length >= b.title.length ? a.title : b.title,
    abstract: longer(a.abstract, b.abstract),
    authors: moreComplete(a.authors, b.authors),
    journal: a.journal ?? b.journal,
    issn_l: a.issn_l ?? b.issn_l,
    issns: [...new Set([...a.issns, ...b.issns])],
    pub_date: a.pub_date ?? b.pub_date,
    year: a.year ?? b.year,
    // A non-preprint version wins: it's the published record.
    type: a.type === "preprint" && b.type !== "preprint" ? b.type : a.type,
    fields: a.fields?.length ? a.fields : b.fields,
  };
}

/**
 * Merge an incoming source record into an existing row (or create a new row).
 * Keeps the longest abstract and the most complete author list, unions sources/ISSNs,
 * fills gaps, and re-applies the venue rule. Label, score and first-seen run never change here.
 */
export function mergeIntoRow(
  existing: PaperRow | null,
  incoming: SourcePaper,
  rules: VenueRules,
  runId: number | null,
): PaperRow {
  const base: PaperRow = existing ?? {
    doi: normalizeDoi(incoming.doi),
    title_hash: titleHash(incoming.title, incoming.year),
    title: incoming.title,
    abstract: null,
    authors: [],
    journal: null,
    issn_l: null,
    issns: [],
    pub_date: null,
    year: null,
    type: incoming.type,
    fields: null,
    unclassified: true,
    sources: [],
    status: "active",
    label: null,
    labeled_at: null,
    score: null,
    first_seen_run_id: runId,
  };
  const merged: PaperRow = {
    ...base,
    doi: base.doi ?? normalizeDoi(incoming.doi),
    title: base.title || incoming.title,
    abstract: longer(base.abstract, incoming.abstract),
    authors: moreComplete(base.authors ?? [], incoming.authors),
    journal: base.journal ?? incoming.journal,
    issn_l: base.issn_l ?? incoming.issn_l,
    issns: [...new Set([...(base.issns ?? []), ...incoming.issns])],
    pub_date: base.pub_date ?? incoming.pub_date,
    year: base.year ?? incoming.year,
    type: base.type === "preprint" && incoming.type !== "preprint" && existing ? incoming.type : base.type,
    fields: base.fields?.length ? base.fields : incoming.fields,
    sources: [...new Set([...(base.sources ?? []), incoming.source])],
  };
  const v = decideVenue(merged, rules);
  merged.status = v.status;
  merged.unclassified = v.unclassified;
  return merged;
}

import type { Field, PaperStatus, PaperType } from "./types";

export interface VenueRules {
  /** All ISSNs (ISSN-L plus print/electronic) of whitelisted journals, uppercased. */
  whitelistIssns: Set<string>;
  /** Allowed OpenAlex field/subfield ids, e.g. "fields/15", "subfields/1305". */
  allowedFieldIds: Set<string>;
}

export interface VenueDecision {
  status: PaperStatus;
  unclassified: boolean;
  reason: "no-rules" | "whitelist" | "field" | "unclassified" | "rejected";
}

export function normIssn(s: string): string {
  return s.trim().toUpperCase();
}

/**
 * A paper passes if its journal is on the whitelist OR it falls in an allowed field.
 * Preprints are judged by field only. Unknown fields -> kept with the "unclassified" flag.
 * With no rules configured at all, everything passes.
 */
export function decideVenue(
  p: { type: PaperType; issn_l: string | null; issns: string[]; fields: Field[] | null },
  rules: VenueRules,
): VenueDecision {
  const unclassified = !p.fields || p.fields.length === 0;
  if (rules.whitelistIssns.size === 0 && rules.allowedFieldIds.size === 0) {
    return { status: "active", unclassified, reason: "no-rules" };
  }
  if (p.type !== "preprint") {
    const issns = [p.issn_l, ...p.issns].filter((x): x is string => !!x).map(normIssn);
    if (issns.some((i) => rules.whitelistIssns.has(i))) return { status: "active", unclassified, reason: "whitelist" };
  }
  if (unclassified) return { status: "active", unclassified, reason: "unclassified" };
  if (p.fields!.some((f) => rules.allowedFieldIds.has(f.id))) return { status: "active", unclassified, reason: "field" };
  return { status: "filtered", unclassified, reason: "rejected" };
}

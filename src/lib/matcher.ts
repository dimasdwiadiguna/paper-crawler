import { normalizeText } from "./text";
import type { TopicGroup } from "./types";

/**
 * Local boolean matcher, applied identically to every source.
 *
 * Rules:
 *  - case-insensitive; punctuation and hyphens count as spaces ("fed-batch" == "fed batch")
 *  - quotes are optional; every term is matched as a whole phrase on word boundaries
 *  - the last word of a term may carry a suffix when it is >= 4 letters
 *    ("sensor" matches "sensors", "model" ... "modelling"), similar to the stemming OpenAlex does
 *  - a group matches when every non-empty block has at least one matching term
 *    and no exclude term matches.
 */

export function normalizeTerm(term: string): string {
  return normalizeText(term.replace(/["“”]/g, ""));
}

/** Prepare text once so many terms can be tested cheaply. */
export function prepareText(text: string): string {
  return ` ${normalizeText(text)} `;
}

export function termMatchesPrepared(prepared: string, term: string): boolean {
  const t = normalizeTerm(term);
  if (!t) return false;
  const words = t.split(" ");
  const last = words[words.length - 1];
  const needle = last.length >= 4 && /[a-z]/.test(last) ? ` ${t}` : ` ${t} `;
  return prepared.includes(needle);
}

export function termMatches(text: string, term: string): boolean {
  return termMatchesPrepared(prepareText(text), term);
}

export function cleanBlocks(blocks: string[][]): string[][] {
  return blocks.map((b) => b.map((t) => t.trim()).filter((t) => normalizeTerm(t))).filter((b) => b.length);
}

export function matchesTopic(text: string, group: Pick<TopicGroup, "blocks" | "exclude_terms">): boolean {
  const blocks = cleanBlocks(group.blocks);
  if (!blocks.length) return false;
  const prepared = prepareText(text);
  for (const block of blocks) {
    if (!block.some((t) => termMatchesPrepared(prepared, t))) return false;
  }
  for (const ex of group.exclude_terms) {
    if (normalizeTerm(ex) && termMatchesPrepared(prepared, ex)) return false;
  }
  return true;
}

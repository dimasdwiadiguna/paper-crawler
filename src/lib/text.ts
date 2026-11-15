import { createHash } from "node:crypto";

/** Lowercase, strip diacritics, turn every non-alphanumeric run into one space. */
export function normalizeText(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

/**
 * Strip JATS / XML / HTML tags from an abstract.
 * Drops a leading "Abstract" title, keeps paragraph breaks as spaces, decodes entities.
 */
export function stripJats(input: string | null | undefined): string | null {
  if (!input) return null;
  let s = input;
  // Section titles like <jats:title>Abstract</jats:title> at the very start carry no content.
  s = s.replace(/^\s*<(jats:)?title[^>]*>\s*abstract\s*<\/(jats:)?title>/i, "");
  s = s.replace(/<\/(jats:)?(p|title|sec|li|h\d)>/gi, " ");
  s = s.replace(/<br\s*\/?>/gi, " ");
  s = s.replace(/<[^>]+>/g, "");
  s = decodeEntities(s);
  s = s.replace(/\s+/g, " ").trim();
  s = dropAbstractHeading(s);
  return s.length ? s : null;
}

/** "Abstract: Text", "ABSTRACT Text", "Abstract This study…" -> "Text…" (keeps "Abstract reasoning…"). */
export function dropAbstractHeading(s: string): string {
  return s.replace(/^(?:abstract|ABSTRACT|Abstract)(?:\s*[:.\-–—]\s*|\s+(?=[A-Z]))/, "").trim();
}

/** Strip tags from short strings (titles). */
export function stripTags(input: string | null | undefined): string {
  if (!input) return "";
  return decodeEntities(input.replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim();
}

/** Lowercase DOI without resolver prefix; null for empty/invalid. */
export function normalizeDoi(doi: string | null | undefined): string | null {
  if (!doi) return null;
  let d = doi.trim().toLowerCase();
  d = d.replace(/^(https?:\/\/)?(dx\.)?doi\.org\//, "");
  d = d.replace(/^doi:\s*/, "");
  d = d.trim();
  return d.startsWith("10.") ? d : null;
}

/** Normalised title for hashing: lowercase, no punctuation, single spaces. */
export function normalizeTitle(title: string): string {
  return normalizeText(title);
}

/** sha1(normalised title + "|" + year). Used as dedupe key when there's no DOI. */
export function titleHash(title: string, year: number | null): string {
  return createHash("sha1")
    .update(`${normalizeTitle(title)}|${year ?? ""}`)
    .digest("hex");
}

/** Rebuild an abstract from OpenAlex's abstract_inverted_index. */
export function rebuildAbstract(index: Record<string, number[]> | null | undefined): string | null {
  if (!index) return null;
  const words: string[] = [];
  for (const [word, positions] of Object.entries(index)) {
    for (const p of positions) words[p] = word;
  }
  const text = dropAbstractHeading(words.filter((w) => w !== undefined).join(" ").replace(/\s+/g, " ").trim());
  return text.length ? text : null;
}

export const STOPWORDS = new Set(
  `a about above after again against all also am an and any are as at be because been before being below between both but by
can could did do does doing down during each few for from further had has have having he her here hers herself him himself his how
i if in into is it its itself just me more most my myself no nor not now of off on once only or other our ours ourselves out over own
same she should so some such than that the their theirs them themselves then there these they this those through to too under until
up very was we were what when where which while who whom why will with would you your yours yourself yourselves
however thus therefore may might must shall use used using based via within without among across upon whereas whether well
one two three four five first second new study studies paper results result show shows shown proposed propose present presented
method methods approach approaches et al e g i e respectively compared different various several high low including`
    .split(/\s+/)
    .filter(Boolean),
);

/** Content tokens for TF-IDF / suggestions: unigrams + bigrams, stopwords removed. */
export function terms(text: string): string[] {
  const toks = normalizeText(text)
    .split(" ")
    .filter((t) => t.length > 1 && !STOPWORDS.has(t) && !/^\d+$/.test(t));
  const out = toks.slice();
  for (let i = 0; i + 1 < toks.length; i++) out.push(`${toks[i]} ${toks[i + 1]}`);
  return out;
}

export function paperText(p: { title: string; abstract: string | null }): string {
  return `${p.title} ${p.abstract ?? ""}`;
}

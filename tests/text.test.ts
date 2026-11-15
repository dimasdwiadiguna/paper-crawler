import { describe, expect, it } from "vitest";
import { normalizeDoi, rebuildAbstract, stripJats, titleHash, terms } from "@/lib/text";
import { dedupeKey, mergeIntoRow, mergeSourcePapers } from "@/lib/merge";
import type { SourcePaper } from "@/lib/types";

describe("rebuildAbstract", () => {
  it("rebuilds word order from the inverted index", () => {
    const idx = { Soft: [0], sensors: [1], estimate: [2], biomass: [3, 6], and: [4], track: [5] };
    expect(rebuildAbstract(idx)).toBe("Soft sensors estimate biomass and track biomass");
  });
  it("handles null and empty", () => {
    expect(rebuildAbstract(null)).toBeNull();
    expect(rebuildAbstract({})).toBeNull();
  });
  it("drops a leading 'Abstract' heading but keeps 'Abstract reasoning'", () => {
    expect(rebuildAbstract({ Abstract: [0], This: [1], study: [2] })).toBe("This study");
    expect(stripJats("Abstract reasoning in models")).toBe("Abstract reasoning in models");
    expect(stripJats("ABSTRACT. Background")).toBe("Background");
  });
  it("tolerates gaps in positions", () => {
    expect(rebuildAbstract({ a: [0], c: [2] })).toBe("a c");
  });
});

describe("stripJats", () => {
  it("removes JATS tags, a leading Abstract title and decodes entities", () => {
    const s =
      '<jats:title>Abstract</jats:title><jats:p>Fed-batch <jats:italic>E. coli</jats:italic> &amp; CHO cells.</jats:p><jats:p>Second &lt;para&gt;.</jats:p>';
    expect(stripJats(s)).toBe("Fed-batch E. coli & CHO cells. Second <para>.");
  });
  it("strips HTML and a plain 'Abstract' prefix", () => {
    expect(stripJats("<h4>Abstract</h4><p>Hello&#160;world</p>")).toBe("Hello world");
    expect(stripJats("Abstract: Text here")).toBe("Text here");
  });
  it("returns null for empty", () => {
    expect(stripJats("")).toBeNull();
    expect(stripJats("<jats:p> </jats:p>")).toBeNull();
    expect(stripJats(undefined)).toBeNull();
  });
});

describe("normalizeDoi", () => {
  it("lowercases and strips resolver prefixes", () => {
    expect(normalizeDoi("https://doi.org/10.1002/BIT.28000")).toBe("10.1002/bit.28000");
    expect(normalizeDoi("http://dx.doi.org/10.1/ABC")).toBe("10.1/abc");
    expect(normalizeDoi("doi:10.5/x")).toBe("10.5/x");
    expect(normalizeDoi(" 10.5/X ")).toBe("10.5/x");
  });
  it("rejects non-DOIs", () => {
    expect(normalizeDoi("")).toBeNull();
    expect(normalizeDoi(null)).toBeNull();
    expect(normalizeDoi("PMC12345")).toBeNull();
  });
});

describe("dedupe keys", () => {
  it("uses the DOI when present, regardless of case/prefix", () => {
    expect(dedupeKey({ doi: "https://doi.org/10.1/AB", title: "x", year: 2020 })).toBe(
      dedupeKey({ doi: "10.1/ab", title: "different", year: 2021 }),
    );
  });
  it("falls back to a title+year hash insensitive to punctuation/case/spacing", () => {
    expect(titleHash("A Soft-Sensor  for Fermentation!", 2024)).toBe(titleHash("a soft sensor for fermentation", 2024));
    expect(titleHash("Same title", 2024)).not.toBe(titleHash("Same title", 2025));
    expect(dedupeKey({ doi: null, title: "T", year: 1 })).toMatch(/^t:/);
  });
});

const rec = (over: Partial<SourcePaper>): SourcePaper => ({
  doi: "10.1/x",
  title: "Title",
  abstract: null,
  authors: [],
  journal: null,
  issn_l: null,
  issns: [],
  pub_date: null,
  year: 2024,
  type: "article",
  fields: null,
  source: "openalex",
  ...over,
});
const noRules = { whitelistIssns: new Set<string>(), allowedFieldIds: new Set<string>() };

describe("merging", () => {
  it("keeps the longest abstract, most complete authors and records every source", () => {
    const a = mergeIntoRow(null, rec({ abstract: "short", authors: ["A", "B"], source: "openalex" }), noRules, 1);
    const b = mergeIntoRow(a, rec({ abstract: "a much longer abstract", authors: ["A"], source: "crossref", journal: "J" }), noRules, 2);
    const c = mergeIntoRow(b, rec({ abstract: null, authors: ["A", "B", "C"], source: "europepmc" }), noRules, 3);
    expect(c.abstract).toBe("a much longer abstract");
    expect(c.authors).toEqual(["A", "B", "C"]);
    expect(c.sources).toEqual(["openalex", "crossref", "europepmc"]);
    expect(c.journal).toBe("J");
    expect(c.first_seen_run_id).toBe(1);
  });
  it("never touches an existing label", () => {
    const a = { ...mergeIntoRow(null, rec({}), noRules, 1), label: "not_related" as const, labeled_at: "2024-01-01" };
    const b = mergeIntoRow(a, rec({ source: "crossref" }), noRules, 5);
    expect(b.label).toBe("not_related");
    expect(b.labeled_at).toBe("2024-01-01");
  });
  it("merges two records from one page", () => {
    const m = mergeSourcePapers(rec({ type: "preprint", fields: null }), rec({ type: "article", fields: [{ id: "fields/1", name: "F", level: "field" }] }));
    expect(m.type).toBe("article");
    expect(m.fields?.[0].id).toBe("fields/1");
  });
});

describe("terms", () => {
  it("produces unigrams and bigrams without stopwords", () => {
    expect(terms("The soft sensor of a bioreactor")).toEqual(["soft", "sensor", "bioreactor", "soft sensor", "sensor bioreactor"]);
  });
});

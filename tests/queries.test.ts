import { describe, expect, it } from "vitest";
import { buildOpenAlexSearch, buildOpenAlexUrl, mapOpenAlexType, normalizeOpenAlexWork } from "@/lib/sources/openalex";
import { buildCrossrefQuery, buildCrossrefUrl, mapCrossrefType, normalizeCrossrefItem } from "@/lib/sources/crossref";
import { buildEpmcQuery, buildEpmcTopicQuery, mapEpmcType, normalizeEpmcResult } from "@/lib/sources/europepmc";
import type { CrawlWindow } from "@/lib/types";

const group = {
  blocks: [["soft sensor", "Kalman filter", "observer"], ["fermentation", '"fed-batch"']],
  exclude_terms: ["wastewater treatment", "beer"],
};
const initial: CrawlWindow = { mode: "initial", from: "2026-10-01", to: "2026-10-31" };
const incr: CrawlWindow = { mode: "incremental", from: "2026-11-10", to: "2026-11-15" };

describe("OpenAlex query builder", () => {
  it("builds a boolean title_and_abstract search", () => {
    expect(buildOpenAlexSearch(group)).toBe(
      '("soft sensor" OR "Kalman filter" OR observer) AND (fermentation OR "fed-batch") NOT "wastewater treatment" NOT beer',
    );
  });
  it("strips filter delimiters from terms", () => {
    expect(buildOpenAlexSearch({ blocks: [["a,b|c:d"]], exclude_terms: [] })).toBe('"a b c d"');
  });
  it("uses publication dates (initial) and a look-back window (incremental)", () => {
    const u1 = new URL(buildOpenAlexUrl(group, initial, null));
    expect(u1.searchParams.get("filter")).toContain("from_publication_date:2026-10-01,to_publication_date:2026-10-31");
    expect(u1.searchParams.get("filter")).toContain("type:article|review|preprint|conference-paper");
    expect(u1.searchParams.get("cursor")).toBe("*");
    const u2 = new URL(buildOpenAlexUrl(group, incr, "abc", { lookbackDays: 30 }));
    expect(u2.searchParams.get("filter")).toContain("from_publication_date:2026-10-11");
    expect(u2.searchParams.get("filter")).not.toContain("to_publication_date");
    expect(u2.searchParams.get("cursor")).toBe("abc");
  });
  it("maps types and normalises works", () => {
    expect(mapOpenAlexType("conference-paper")).toBe("conference");
    expect(mapOpenAlexType("editorial")).toBeNull();
    const p = normalizeOpenAlexWork({
      doi: "https://doi.org/10.1/ABC",
      title: "T",
      type: "article",
      publication_date: "2026-01-02",
      publication_year: 2026,
      primary_location: { source: { display_name: "J", issn_l: "1234-5678", issn: ["1234-5678"] } },
      authorships: [{ author: { display_name: "Ann" } }],
      topics: [{ field: { id: "https://openalex.org/fields/15", display_name: "Chem Eng" }, subfield: { id: "https://openalex.org/subfields/1500", display_name: "X" } }],
      abstract_inverted_index: { Hi: [0], there: [1] },
    })!;
    expect(p.doi).toBe("10.1/abc");
    expect(p.abstract).toBe("Hi there");
    expect(p.fields?.map((f) => f.id)).toEqual(["fields/15", "subfields/1500"]);
    expect(p.issn_l).toBe("1234-5678");
  });
});

describe("Crossref query builder", () => {
  it("sends distinct words of block terms, without excludes", () => {
    expect(buildCrossrefQuery(group)).toBe("soft sensor kalman filter observer fermentation fed batch");
  });
  it("uses created-date (not index-date) for incremental runs, with 1 day overlap", () => {
    const f = new URL(buildCrossrefUrl(group, incr, null)).searchParams.get("filter")!;
    expect(f).toContain("from-created-date:2026-11-09");
    expect(f).toContain("until-created-date:2026-11-15");
    expect(f).toContain("type:journal-article,type:posted-content,type:proceedings-article");
    expect(f).not.toContain("index-date");
    const f2 = new URL(buildCrossrefUrl(group, initial, null)).searchParams.get("filter")!;
    expect(f2).toContain("from-pub-date:2026-10-01,until-pub-date:2026-10-31");
  });
  it("maps types and strips JATS", () => {
    expect(mapCrossrefType("posted-content")).toBe("preprint");
    expect(mapCrossrefType("proceedings-article")).toBe("conference");
    const p = normalizeCrossrefItem({
      DOI: "10.1/X",
      type: "journal-article",
      title: ["A <i>title</i>"],
      abstract: "<jats:p>Body</jats:p>",
      author: [{ given: "A", family: "B" }, { name: "Consortium" }],
      "container-title": ["Journal"],
      ISSN: ["1111-2222"],
      published: { "date-parts": [[2026, 3]] },
    })!;
    expect(p.title).toBe("A title");
    expect(p.abstract).toBe("Body");
    expect(p.authors).toEqual(["A B", "Consortium"]);
    expect(p.pub_date).toBe("2026-03-01");
    expect(p.year).toBe(2026);
  });
});

describe("Europe PMC query builder", () => {
  it("builds a TITLE_ABS boolean query with NOT", () => {
    expect(buildEpmcTopicQuery(group)).toBe(
      '(TITLE_ABS:"soft sensor" OR TITLE_ABS:"Kalman filter" OR TITLE_ABS:observer) AND (TITLE_ABS:fermentation OR TITLE_ABS:"fed-batch") NOT (TITLE_ABS:"wastewater treatment" OR TITLE_ABS:beer)',
    );
  });
  it("uses FIRST_PDATE initially and FIRST_IDATE incrementally", () => {
    expect(buildEpmcQuery(group, initial)).toContain("FIRST_PDATE:[2026-10-01 TO 2026-10-31]");
    expect(buildEpmcQuery(group, incr)).toContain("FIRST_IDATE:[2026-11-09 TO 2026-11-15]");
    expect(buildEpmcQuery(group, incr)).toContain("(SRC:MED OR SRC:PMC OR SRC:PPR)");
  });
  it("maps publication types", () => {
    expect(mapEpmcType("PPR", ["Preprint"])).toBe("preprint");
    expect(mapEpmcType("MED", ["Review", "Journal Article"])).toBe("review");
    expect(mapEpmcType("MED", ["research-article", "Journal Article"])).toBe("article");
    expect(mapEpmcType("MED", ["Editorial"])).toBeNull();
    expect(mapEpmcType("MED", ["Research Support, Non-U.S. Gov't"])).toBe("article");
  });
  it("normalises core results", () => {
    const p = normalizeEpmcResult({
      source: "MED",
      doi: "10.1/Y",
      title: "<span>Title.</span>",
      abstractText: "<h4>Abstract</h4>Text",
      authorList: { author: [{ firstName: "Ann", lastName: "Lee", fullName: "Lee A" }, { collectiveName: "Group" }] },
      journalInfo: { journal: { title: "J", issn: "1111-1111", essn: "2222-2222" } },
      pubYear: "2026",
      firstPublicationDate: "2026-01-05",
      pubTypeList: { pubType: ["Journal Article"] },
    })!;
    expect(p.title).toBe("Title");
    expect(p.abstract).toBe("Text");
    expect(p.authors).toEqual(["Ann Lee", "Group"]);
    expect(p.issns).toEqual(["1111-1111", "2222-2222"]);
  });
});

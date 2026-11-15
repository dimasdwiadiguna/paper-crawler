import { describe, expect, it } from "vitest";
import { matchAndCollapse, storePapers } from "@/lib/server/crawl";
import { MemoryStore } from "@/lib/server/memoryStore";
import type { SourcePaper, TopicGroup } from "@/lib/types";

const rec = (over: Partial<SourcePaper>): SourcePaper => ({
  doi: "10.1/a",
  title: "A soft sensor for fed-batch fermentation",
  abstract: null,
  authors: ["A"],
  journal: "J",
  issn_l: null,
  issns: [],
  pub_date: "2026-11-01",
  year: 2026,
  type: "article",
  fields: null,
  source: "openalex",
  ...over,
});

describe("storePapers (dedupe across sources)", () => {
  it("merges the same DOI from three sources into one row", async () => {
    const s = new MemoryStore();
    expect(await storePapers([rec({ source: "openalex" })], "t1", 1, s)).toEqual({ new: 1, dupes: 0, filtered: 0 });
    expect(await storePapers([rec({ doi: "10.1/A", source: "crossref", abstract: "longer abstract" })], "t1", 1, s)).toEqual({ new: 0, dupes: 1, filtered: 0 });
    await storePapers([rec({ source: "europepmc", authors: ["A", "B"] })], "t2", 2, s);
    expect(s.rows.size).toBe(1);
    const row = [...s.rows.values()][0];
    expect(row.sources).toEqual(["openalex", "crossref", "europepmc"]);
    expect(row.abstract).toBe("longer abstract");
    expect(row.authors).toEqual(["A", "B"]);
    expect(row.first_seen_run_id).toBe(1);
    expect(s.links).toEqual(new Set(["1:t1", "1:t2"]));
  });

  it("matches DOI-less records by title + year", async () => {
    const s = new MemoryStore();
    await storePapers([rec({ doi: null, source: "europepmc", title: "Soft-Sensor for Fed-Batch Fermentation!" })], "t", 1, s);
    await storePapers([rec({ doi: null, source: "crossref", title: "soft sensor for fed batch fermentation" })], "t", 1, s);
    expect(s.rows.size).toBe(1);
  });

  it("never brings a labeled paper back (label survives re-discovery)", async () => {
    const s = new MemoryStore();
    await storePapers([rec({})], "t", 1, s);
    const row = s.rows.get(1)!;
    s.rows.set(1, { ...row, label: "not_related", labeled_at: "2026-11-02T00:00:00Z" });
    await storePapers([rec({ source: "crossref" })], "t", 5, s);
    expect(s.rows.get(1)!.label).toBe("not_related");
  });

  it("stores venue-rejected papers as filtered", async () => {
    const s = new MemoryStore({ whitelistIssns: new Set(["0006-3592"]), allowedFieldIds: new Set(["fields/15"]) });
    const r = await storePapers([rec({ fields: [{ id: "fields/31", name: "Physics", level: "field" }] })], "t", 1, s);
    expect(r.filtered).toBe(1);
    expect(s.rows.get(1)!.status).toBe("filtered");
  });
});

describe("matchAndCollapse", () => {
  const topic: TopicGroup = { id: "t", name: "t", active: true, blocks: [["soft sensor"], ["fermentation"]], exclude_terms: ["beer"] };
  it("drops non-matching records and collapses in-page duplicates", () => {
    const { kept, nomatch } = matchAndCollapse(
      [rec({}), rec({ abstract: "longer" }), rec({ doi: "10.1/b", title: "Soft sensor for beer fermentation" }), rec({ doi: "10.1/c", title: "Unrelated" })],
      topic,
    );
    expect(nomatch).toBe(2);
    expect(kept).toHaveLength(1);
    expect(kept[0].abstract).toBe("longer");
  });
});

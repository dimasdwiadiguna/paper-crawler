import { describe, expect, it } from "vitest";
import { cosine, scoreDocs, tfidfVectors, type Doc } from "@/lib/tfidf";
import { logOdds, overRepresented } from "@/lib/suggest";

describe("tf-idf", () => {
  it("gives identical texts cosine 1 and disjoint texts 0", () => {
    const [a, b, c] = tfidfVectors(["kalman filter fermentation", "kalman filter fermentation", "galaxy redshift survey"]);
    expect(cosine(a, b)).toBeCloseTo(1, 6);
    expect(cosine(a, c)).toBe(0);
  });
  it("down-weights terms present in every document", () => {
    const [a] = tfidfVectors(["sensor kalman", "sensor yeast", "sensor wine"]);
    expect(a.get("kalman")!).toBeGreaterThan(a.get("sensor")!);
  });
});

const mk = (id: number, text: string, label: Doc["label"], topics = ["t1"]): Doc => ({ id, text, label, topics });

describe("scoreDocs", () => {
  it("returns null scores in cold start (< 5 labels)", () => {
    const s = scoreDocs([mk(1, "a b", "relevant"), mk(2, "c d", null)]);
    expect(s.get(2)).toBeNull();
  });
  it("ranks papers like Relevant ones above papers like Not-related ones", () => {
    const docs = [
      mk(1, "kalman filter biomass estimation fed batch fermentation", "relevant"),
      mk(2, "soft sensor biomass fermentation estimation", "relevant"),
      mk(3, "observer biomass fermentation estimation", "close"),
      mk(4, "wastewater treatment plant aeration control", "not_related"),
      mk(5, "wastewater sludge aeration nitrogen removal", "not_related"),
      mk(6, "extended kalman filter biomass fermentation", null),
      mk(7, "wastewater aeration sludge model", null),
    ];
    const s = scoreDocs(docs);
    expect(s.get(6)!).toBeGreaterThan(0);
    expect(s.get(7)!).toBeLessThan(0);
    expect(s.get(1)).toBeNull(); // labeled papers aren't scored
  });
});

describe("log-odds suggestions", () => {
  it("is positive when a term is over-represented in the target set, symmetric in sign", () => {
    expect(logOdds(8, 10, 1, 10).delta).toBeGreaterThan(0);
    expect(logOdds(1, 10, 8, 10).delta).toBeCloseTo(-logOdds(8, 10, 1, 10).delta, 10);
    expect(logOdds(5, 10, 5, 10).delta).toBeCloseTo(0, 10);
    // more evidence -> larger z for the same ratio
    expect(logOdds(40, 50, 5, 50).z).toBeGreaterThan(logOdds(8, 10, 1, 10).z);
  });
  it("finds terms that separate Not-related from Relevant papers", () => {
    const notRelated = ["wastewater aeration control", "wastewater sludge", "wastewater nitrogen aeration", "traffic kalman"];
    const relevant = ["fermentation biomass kalman", "fermentation soft sensor", "biomass fed batch", "wastewater fermentation"];
    const top = overRepresented(notRelated, relevant, { k: 3, known: ["kalman filter"] });
    // "aeration" (2 vs 0) beats "wastewater" (3 vs 1): it never appears in a relevant paper.
    expect(top[0].term).toBe("aeration");
    expect(top.map((t) => t.term)).toContain("wastewater");
    expect(top.map((t) => t.term)).not.toContain("kalman");
  });
});

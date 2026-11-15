import { describe, expect, it } from "vitest";
import { matchesTopic, termMatches } from "@/lib/matcher";

const seed = {
  blocks: [
    ["soft sensor", "software sensor", "virtual sensor", "state estimation", "state observer", "Kalman filter", "hybrid model", "grey-box model"],
    ["fermentation", "bioprocess", "bioreactor", "cultivation", '"fed-batch"', "cell culture"],
  ],
  exclude_terms: [] as string[],
};

describe("termMatches", () => {
  it("is case-insensitive and treats hyphens as spaces", () => {
    expect(termMatches("A Fed-Batch run", "fed batch")).toBe(true);
    expect(termMatches("A fed batch run", '"fed-batch"')).toBe(true);
  });
  it("allows suffixes on the last word (>= 4 letters)", () => {
    expect(termMatches("Soft sensors for X", "soft sensor")).toBe(true);
    expect(termMatches("grey-box modelling", "grey-box model")).toBe(true);
    expect(termMatches("bioprocessing", "bioprocess")).toBe(true);
  });
  it("respects word boundaries at the start and for short words", () => {
    expect(termMatches("microfermentation", "fermentation")).toBe(false);
    expect(termMatches("the cats", "cat")).toBe(false);
    expect(termMatches("the cat sat", "cat")).toBe(true);
  });
  it("requires the words to be adjacent", () => {
    expect(termMatches("soft and robust sensor", "soft sensor")).toBe(false);
  });
});

describe("matchesTopic", () => {
  it("ANDs blocks and ORs synonyms", () => {
    expect(matchesTopic("A Kalman filter for fed-batch E. coli fermentation", seed)).toBe(true);
    expect(matchesTopic("A Kalman filter for vehicle tracking", seed)).toBe(false);
    expect(matchesTopic("Fermentation of beer", seed)).toBe(false);
  });
  it("applies exclude terms", () => {
    const g = { ...seed, exclude_terms: ["wastewater"] };
    expect(matchesTopic("Soft sensor for bioreactor in wastewater treatment", g)).toBe(false);
    expect(matchesTopic("Soft sensor for bioreactor", g)).toBe(true);
  });
  it("ignores empty blocks and terms, and never matches with no blocks", () => {
    expect(matchesTopic("anything", { blocks: [[" "], []], exclude_terms: [""] })).toBe(false);
    expect(matchesTopic("soft sensor", { blocks: [["soft sensor"], []], exclude_terms: [""] })).toBe(true);
  });
});

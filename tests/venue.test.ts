import { describe, expect, it } from "vitest";
import { decideVenue } from "@/lib/venue";

const rules = { whitelistIssns: new Set(["0006-3592", "1097-0290"]), allowedFieldIds: new Set(["fields/15", "subfields/2402"]) };
const chem = [{ id: "fields/15", name: "Chemical Engineering", level: "field" as const }];
const physics = [{ id: "fields/31", name: "Physics", level: "field" as const }];

describe("venue filter", () => {
  it("passes whitelisted journals by any ISSN, even outside allowed fields", () => {
    expect(decideVenue({ type: "article", issn_l: null, issns: ["1097-0290"], fields: physics }, rules).status).toBe("active");
  });
  it("passes allowed fields/subfields", () => {
    expect(decideVenue({ type: "article", issn_l: "9999-9999", issns: [], fields: chem }, rules).reason).toBe("field");
  });
  it("filters a non-whitelisted journal outside the allowed fields", () => {
    expect(decideVenue({ type: "article", issn_l: "9999-9999", issns: [], fields: physics }, rules).status).toBe("filtered");
  });
  it("judges preprints by field only", () => {
    expect(decideVenue({ type: "preprint", issn_l: "0006-3592", issns: [], fields: physics }, rules).status).toBe("filtered");
    expect(decideVenue({ type: "preprint", issn_l: null, issns: [], fields: chem }, rules).status).toBe("active");
  });
  it("keeps unknown fields as unclassified", () => {
    const d = decideVenue({ type: "article", issn_l: null, issns: [], fields: null }, rules);
    expect(d).toEqual({ status: "active", unclassified: true, reason: "unclassified" });
  });
  it("passes everything when no rules exist", () => {
    const empty = { whitelistIssns: new Set<string>(), allowedFieldIds: new Set<string>() };
    expect(decideVenue({ type: "article", issn_l: null, issns: [], fields: physics }, empty).status).toBe("active");
  });
});

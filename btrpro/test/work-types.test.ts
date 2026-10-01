// TEST_ONLY: job types on the new job / lead form, and the address suggestion formatter.
import { describe, expect, it } from "vitest";
import { leadName, parseWorkTypes, scopesForWork } from "@/lib/projects/work-types";
import { photonLabel } from "@/lib/integrations/address";

describe("job types", () => {
  it("map to estimating scopes and new vs reroof", () => {
    expect(scopesForWork(["REROOF", "GUTTERS"], "RESIDENTIAL")).toEqual({ scopes: ["STEEP"], constructionType: "REROOF" });
    expect(scopesForWork(["NEW_ROOF", "SIDING"], "RESIDENTIAL")).toEqual({ scopes: ["STEEP", "SIDING"], constructionType: "NEW" });
    expect(scopesForWork(["REROOF"], "COMMERCIAL").scopes).toEqual(["LOW_SLOPE"]);
    expect(scopesForWork(["REROOF", "NEW_ROOF"], "RESIDENTIAL").constructionType).toBeNull();
    expect(scopesForWork(["WINDOWS", "REPAIR", "WARRANTY", "INSULATION"], "RESIDENTIAL")).toEqual({ scopes: [], constructionType: null });
  });
  it("parse only known types, in form order, and name the job", () => {
    expect(parseWorkTypes(["GUTTERS", "bogus", "REROOF"])).toEqual(["REROOF", "GUTTERS"]);
    expect(leadName("Jane", "Test", null, ["REROOF", "GUTTERS"])).toBe("Jane Test — Reroof, Gutters");
    expect(leadName("", "", "TEST_ONLY Mgmt", ["REPAIR"])).toBe("TEST_ONLY Mgmt — Repair");
  });
});

describe("address suggestions", () => {
  it("formats a Photon result and keeps the typed house number when OSM only knows the street", () => {
    const street = { properties: { type: "street", name: "Test St", city: "Omaha", state: "Nebraska", postcode: "68142", countrycode: "US" } };
    expect(photonLabel(street, "1234 Test St")).toBe("1234 Test St, Omaha, NE 68142");
    const house = { properties: { type: "house", housenumber: "55", street: "Test Ave", city: "Omaha", state: "Nebraska", postcode: "68114", countrycode: "US" } };
    expect(photonLabel(house, "55 test")).toBe("55 Test Ave, Omaha, NE 68114");
    expect(photonLabel({ properties: { name: "X", countrycode: "CA" } }, "x")).toBeNull();
  });
});

describe("address suggestion cleanup", () => {
  it("drops precinct/township names that OSM puts in the city slot", () => {
    const f = { properties: { type: "street", name: "Test Street", city: "Union Precinct", state: "Nebraska", postcode: "68142", countrycode: "US" } };
    expect(photonLabel(f, "100 Test")).toBe("100 Test Street, NE 68142");
  });
});

// TEST_ONLY builder work orders: synthetic work orders in the ToolKit layout (made-up builder, house, numbers and
// amounts), read line by line; the plan set's cover goes to a fake AI; the packet then creates the house.
import { afterAll, describe, expect, it } from "vitest";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { prisma } from "@/lib/db";
import { createHouse, homeSchedule } from "@/lib/production/homes";
import { houseDescription } from "@/lib/production/house-text";
import { addOnsIn, parseToolkitWorkOrder, readPacket } from "@/lib/production/work-order";

process.env.UPLOAD_DIR = "prisma/test-uploads";
const BUILDER = "TEST_ONLY Homes of Omaha, LC";
const actor = { id: "", name: "TEST_ONLY Office", role: "OFFICE" };

afterAll(async () => {
  await prisma.prodLine.deleteMany({ where: { builder: BUILDER } });
  await prisma.$disconnect();
});

// [x, text] cells per line, top to bottom, the way the ToolKit prints them
function workOrder(no: string, body: [number, string][][]): [number, string][][] {
  return [
    [[40, BUILDER], [420, `WORK ORDER: ${no} ( REPRINT )`]],
    [[40, "1 Test Road"], [420, "VENDOR NUMBER: 000001"]],
    [[40, "Testville, NE 68000"], [420, "DATE: 09/21/2026"]],
    [[50, "VENDOR:"], [260, "PERMIT NUMBER:"], [420, "BUYER:"]],
    [[50, "TEST_ONLY CONTRACTOR"], [420, "SPEC, 100 Test Lane"]],
    [[50, "1 Vendor Ct"]],
    [[420, "HOUSE ADDRESS:"]],
    [[50, "OMAHA, NE 68100"]],
    [[420, "100 Test Lane"]],
    [[50, "PHONE: 000-000-0000"]],
    [[420, "Papillion, NE 68046"]],
    [[40, "DEVELOPMENT"], [200, "HOUSE"], [260, "MODEL/ELEVATION"], [440, "BLOCK / LOT"], [520, "ORIENTATION"]],
    [[40, "999 TS Test Creek"], [200, "00000001"], [260, "(1TM/C )"], [310, "Testmodel / Elevation C"], [440, "2 / 7"], [520, "Per Plan"]],
    [[40, "Cost Code"], [90, "Opt Code"], [140, "Qty"], [300, "Description"], [540, "Amount"]],
    ...body,
    [[460, "TOTAL"], [540, body.length ? "" : "0.00"]],
    [[40, "This is your Work Order which will be approved for payment by your superintendent."]],
  ];
}
const roofing = workOrder("00000101", [
  [[40, "325-01"], [130, "Roofing Labor - Roof Labor"], [540, "1,000.00"]],
  [[90, "10050"], [140, "1"], [160, "COVERED DECK/PATIO"]],
  [[40, "325-51"], [130, "Roofing Labor - Options"], [540, "100.00"]],
  [[90, "20005"], [140, "1"], [160, "SHINGLE COLOR"]],
  [[160, "Test Gray"]],
  [[40, "325-51"], [130, "Roofing Labor - Options"], [540, "0.00"]],
]);
roofing.splice(roofing.length - 2, 1, [[460, "TOTAL"], [540, "1,100.00"]]);
const seal = workOrder("00000102", [
  [[40, "315-02"], [130, "Roofing Matl. - Seal Roof"], [540, "0.00"]],
  [[460, "TOTAL"], [540, "0.00"]],
  [[130, "ADDITIONAL OPTIONS ON OTHER WORK ORDERS IN THE SAME COST CATEGORY"]],
  [[90, "30001"], [140, "1"], [160, "CANTILEVERED PANTRY"]],
]);
seal.splice(seal.length - 2, 1);
const framing = workOrder("00000103", [[[40, "201-01"], [130, "Framing Labor - Framing"], [540, "500.00"]]]);

async function pdf(pages: [number, string][][][], size: [number, number] = [612, 792]) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const lines of pages) {
    const page = doc.addPage(size);
    lines.forEach((cells, i) => cells.forEach(([x, t]) => t && page.drawText(t, { x, y: size[1] - 40 - i * 14, size: 8, font })));
  }
  return { bytes: await doc.save(), name: "TEST_ONLY.pdf" };
}
const lineText = (lines: [number, string][][]) => lines.map((c) => c.map(([, t]) => t).filter(Boolean).join(" ")).join("\n");

describe("work orders", () => {
  it("reads a ToolKit work order: house, scope, number, total and its options", () => {
    const w = parseToolkitWorkOrder(lineText(roofing))!;
    expect(w).toMatchObject({ builder: BUILDER, number: "00000101", street: "100 Test Lane", city: "Papillion, NE 68046", development: "Test Creek", model: "Testmodel", elevation: "C", lot: "2 / 7", scope: "Roofing", total: 1100 });
    expect(w.options).toEqual(["COVERED DECK/PATIO ($100.00)", "SHINGLE COLOR: Test Gray"]);
    const s = parseToolkitWorkOrder(lineText(seal))!;
    expect(s).toMatchObject({ scope: "Roof Seal", total: 0, options: [], otherOptions: ["CANTILEVERED PANTRY"] });
    expect(parseToolkitWorkOrder("An invoice\nTOTAL 5.00")).toBeNull();
  });

  it("names add-ons from option text", () => {
    expect(addOnsIn("COVERED DECK/PATIO")).toEqual(["Covered Rear Deck"]);
    expect(addOnsIn("B (Extended Porch w/ Shed Dormer)")).toEqual(["Ext Front Porch"]);
    expect(addOnsIn("Next-Gen Suite")).toEqual(["In-Law Suite"]);
    expect(addOnsIn("Cantilevered pantry 2'")).toEqual(["Cantilevered Pantry"]);
    expect(addOnsIn("B (Upgraded Patio)")).toEqual([]);
  });

  it("reads a packet (work orders + plan set) and creates the house from it", async () => {
    const cover: [number, string][][] = [[[40, "THE TEST COMPANY"]], [[40, "Cover Sheet"]], [[40, "SELECTIONS: C (Extended Porch) Walkout B (Upgraded Patio)"]]];
    const seen: string[] = [];
    const fakeAi = (async (o: { messages: { content: { type: string; text?: string }[] }[] }) => {
      seen.push(o.messages[0].content.map((c) => c.text ?? c.type).join(""));
      return { model: "fake", data: { elevation_type: "C (Extended Porch)", basement: "WALKOUT", basement_finish: null, deck_patio: "B (Upgraded Patio)", garage: "3-car", add_ons: ["Ext Front Porch"] } };
    }) as never;
    const p = await readPacket([await pdf([roofing]), await pdf([seal]), await pdf([framing]), await pdf([cover, [[[40, "Floor plan"]]], [[[40, "Roof plan"]]]], [1224, 792]), { bytes: new TextEncoder().encode("hello"), name: "notes.txt" }], fakeAi);
    expect(seen).toHaveLength(1); // only the plan set's cover went to the AI; work orders were read directly
    expect(seen[0]).toContain("SELECTIONS:");
    expect(p).toMatchObject({ builder: BUILDER, street: "100 Test Lane", city: "Papillion, NE 68046", model: "Testmodel", elevation: "C", elevationType: "C (Extended Porch)", basement: "WALKOUT" });
    expect(p.addOns.sort()).toEqual(["Cantilevered Pantry", "Covered Rear Deck", "Ext Front Porch"]);
    expect(p.scopes.map((s) => [s.scope, s.workOrder, s.sell])).toEqual([["Roofing", "00000101", 1100], ["Roof Seal", "00000102", 0]]);
    expect(p.planUrl).toMatch(/^local:work-orders\//);
    expect(p.houseInfo).toEqual(["Block / lot 2 / 7 · Test Creek", "Deck/patio: B (Upgraded Patio)", "Garage: 3-car"]);
    expect(p.problems.join(" ")).toMatch(/Framing Labor/);
    expect(p.problems.join(" ")).toMatch(/notes\.txt: not a PDF/);

    await createHouse(
      { builder: p.builder!, address: `${p.street}, ${p.city}`, model: p.model!, elevation: p.elevation!, scopes: p.scopes.map((s) => s.scope), basement: p.basement, addOns: p.addOns, elevationType: p.elevationType, houseInfo: p.houseInfo.join(" · "), planUrl: p.planUrl, workOrders: p.scopes },
      actor,
    );
    const [h] = await homeSchedule(BUILDER);
    const roof = h.scopes.Roofing![0];
    expect(roof).toMatchObject({ sell: 1100, vpo: "00000101", basement: "WALKOUT", elevationType: "C (Extended Porch)", notes: "COVERED DECK/PATIO ($100.00) · SHINGLE COLOR: Test Gray" });
    expect(roof.workOrderUrl).toBe(p.scopes[0].fileUrl);
    expect(h.scopes["Roof Seal"]![0]).toMatchObject({ sell: 0, vpo: "00000102" });
    expect(h.addOns).toBe("Covered Rear Deck, Cantilevered Pantry, Ext Front Porch");
    expect(houseDescription(h)).toBe("Testmodel · Elevation C (Extended Porch) · Walkout basement · Covered Rear Deck, Cantilevered Pantry, Ext Front Porch");
    // a scope added later keeps the house's basement, add-ons and plan set
    const [g] = await createHouse({ builder: BUILDER, address: `${p.street}, ${p.city}`, model: "Testmodel", elevation: "C", scopes: ["Gutters"] }, actor);
    expect(g).toMatchObject({ basement: "WALKOUT", addOns: h.addOns, planUrl: p.planUrl });
    // files must be ones uploaded here
    await expect(createHouse({ builder: BUILDER, address: "2 Test Lane", model: "Testmodel", elevation: "C", scopes: ["Siding"], planUrl: "local:../../etc/passwd" }, actor)).rejects.toThrow(/uploaded here/);
  });

  it("describes a house, with Full Dig as the base", () => {
    expect(houseDescription({ model: "Testmodel", elevation: "B", elevationType: "B (Extended Porch w/ Shed Dormer)", basement: null, addOns: ["Covered Rear Deck"] })).toBe("Testmodel · Elevation B (Extended Porch w/ Shed Dormer) · Full Dig basement · Covered Rear Deck");
    expect(houseDescription({ model: "Testmodel", elevation: "Elevation A", basement: "DAYLIGHT", addOns: "" })).toBe("Testmodel · Elevation A · Daylight basement · No add-ons");
  });
});

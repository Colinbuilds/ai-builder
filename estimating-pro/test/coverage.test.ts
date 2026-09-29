import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { parseCoverage } from "@/lib/sheets/coverage";

const items: { description: string; uom: string }[] = JSON.parse(
  readFileSync(new URL("../data/price_items.json", import.meta.url), "utf8"),
).items;
const uomOf = (d: string) => items.find((i) => i.description === d)?.uom ?? "";
const cov = (d: string) => parseCoverage(d, uomOf(d));

describe("parseCoverage — acceptance test 6", () => {
  it.each([
    ["Vista AR 252 3/SQ", 3, "BD/SQ"],
    ["GAF Tigerpaw 10SQ", 10, "SQ/RL"],
    ["MH 060 TPO 10'X100' White", 1000, "SF/RL"],
    ['MH 2.0" Poly Iso 1 4\'X8\'', 32, "SF/SH"],
    ['MH 3" #14 HDP Fastener 1M', 1000, "EA/BX"],
    ["Elevt 6 Heavy Duty Fastener 5C", 500, "EA/BX"],
  ])("%s → %d %s", (d, qty, unit) => {
    expect(uomOf(d)).not.toBe(""); // the description really is on a sheet
    expect(cov(d)).toMatchObject({ qty, unit });
  });
});

describe("parseCoverage — other explicit patterns", () => {
  it.each([
    ["Proline Hip & Ridge 33.3LF", "BD", 33.3, "LF/BD"],
    ["227 Hip & Ridge 31LF", "BD", 31, "LF/BD"],
    ["Hip & Ridge 116'4\" LF", "BD", 116.333, "LF/BD"],
    ["Tarco 30# Astm 4869 Felt 2SQ/RL", "RL", 2, "SQ/RL"],
    ["1/4\" Weatherall Fanfold 2SQ/BD", "BD", 2, "SQ/BD"],
    ["9' x 150' Hardiewrap Weather Barrier", "RL", 1350, "SF/RL"],
    ["MH Helix LR Adhsv Cartridge 4/Box", "BX", 4, "EA/BX"],
    ['1.25" Plastic Cap Nails 2000/BX', "BX", 2000, "EA/BX"],
    ['1" Plastic Cap Nails 3000/Pail', "PA", 3000, "EA/PA"],
    ['Coil Nail 2-1/4" HDG SM 4.8M #13388', "BX", 4800, "EA/BX"],
    ['MH 10" #14 HDP Fastener 250', "BX", 250, "EA/BX"],
    ["HZ5 Panel CM, Sierra, Stucco 4X10 Primed", "SH", 40, "SF/SH"],
    ["MH X Taper Poly Iso 2 0.5-1.5 4X4", "SH", 16, "SF/SH"],
  ])("%s", (d, uom, qty, unit) => {
    expect(parseCoverage(d, uom)).toMatchObject({ qty, unit });
  });

  it.each([
    ["MH EPDM Unc Flsh Tape 9X50 Wht", "RL"], // 9 is inches — unit-less sizes are never read
    ["MH 060 EPDM Clean 10X100 Blk RL 3\"T", "RL"],
    ["Phillips EM Tile Pan 4X4X10", "PC"],
    ["ClimateFlex IR AR 3/S", "SQ"], // truncated on the sheet; user must confirm
    ["2.5\" Hand Nails 5#/bx", "BX"], // weight, not count
    ["Elevt Twin Jet PRT2 W56RACIAPC2 44#", "BX"],
    ["Drip Edge", "PC"],
    ["HZ5 Plank Eased CM 8.25 Primed", "PC"],
  ])("returns null for %s", (d, uom) => {
    expect(parseCoverage(d, uom)).toBeNull();
  });
});

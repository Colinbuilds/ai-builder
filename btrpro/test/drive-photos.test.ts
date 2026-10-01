// TEST_ONLY folder and file names — shaped like CompanyCam's Drive sync, not real customers.
import { describe, expect, it } from "vitest";
import { companyCamIdFromFile, matchPhotoFolder, photoTime, streetKey } from "@/lib/integrations/drive-photos";

const folders = [
  { id: "f1", name: "Test Owner A - 1234 Maple St Omaha NE" },
  { id: "f2", name: "Test Owner B  - 555 N Oak Ave Elkhorn NE" },
  { id: "f3", name: "Test Owner C - 777 Pine Rd Omaha NE" },
  { id: "f4", name: "Test Owner D - 777 Pine Rd Papillion NE" },
];

describe("CompanyCam photos in Drive", () => {
  it("keys an address by house number and street", () => {
    expect(streetKey("1234 Maple Street, Omaha NE 68142")).toBe("1234 maple");
    expect(streetKey("555 N. Oak Ave")).toBe("555 oak");
    expect(streetKey("Omaha NE")).toBeNull();
    expect(streetKey(null)).toBeNull();
  });

  it("reads the photo time and project id from the file name", () => {
    const d = photoTime("project_110175309_07192026_1559.jpg")!;
    expect([d.getFullYear(), d.getMonth() + 1, d.getDate(), d.getHours(), d.getMinutes()]).toEqual([2026, 7, 19, 15, 59]);
    expect(photoTime("IMG_0001.jpg")).toBeNull();
    expect(companyCamIdFromFile("project_110175309_07192026_1559.jpg")).toBe("110175309");
    expect(companyCamIdFromFile("IMG_0001.jpg")).toBeNull();
  });

  it("links a job only when exactly one folder has its street address", () => {
    expect(matchPhotoFolder({ address: "1234 Maple St", name: "Reroof" }, folders)?.id).toBe("f1");
    expect(matchPhotoFolder({ address: "555 Oak Ave", name: "Siding" }, folders)?.id).toBe("f2");
    expect(matchPhotoFolder({ address: null, name: "Test Owner A - 1234 Maple" }, folders)?.id).toBe("f1");
    expect(matchPhotoFolder({ address: "777 Pine Rd", name: "Two matches" }, folders)).toBeNull();
    expect(matchPhotoFolder({ address: "9 Elm St", name: "No match" }, folders)).toBeNull();
  });
});

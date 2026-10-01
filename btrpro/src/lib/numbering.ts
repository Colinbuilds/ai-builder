// Document numbers (INV-2026-0007, MO-…, WO-…, P-…): the highest number used so far + 1.
// Counting rows would reuse numbers after a job (and its documents) is deleted.
export function nextInSequence(prefix: string, used: string[]) {
  let max = 0;
  for (const n of used) {
    if (!n.startsWith(prefix)) continue;
    const v = Number(n.slice(prefix.length));
    if (Number.isInteger(v) && v > max) max = v;
  }
  return `${prefix}${String(max + 1).padStart(4, "0")}`;
}

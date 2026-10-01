// Making phone photos of receipts and delivery tickets readable: find the paper in the photo (white, unsaturated,
// the largest bright patch), crop to it, turn it upright, even out the contrast, and cut tall pages into zoomed
// sections so small print stays sharp after the AI's image downscaling.
import sharp from "sharp";

export type Crop = { x: number; y: number; w: number; h: number }; // fractions of the (rotated) photo, 0–1
export type Rotate = 0 | 90 | 180 | 270;

const SAMPLE = 240;

/** Finds the sheet of paper in a photo. Returns null when nothing clearly paper-like stands out (use the whole photo). */
export async function detectPaper(bytes: Uint8Array, rotate: Rotate = 0): Promise<Crop | null> {
  const img = sharp(bytes, { failOn: "none" }).rotate().rotate(rotate).resize({ width: SAMPLE, height: SAMPLE, fit: "inside" }).removeAlpha();
  const { data, info } = await img.raw().toBuffer({ resolveWithObject: true });
  const { width: W, height: H, channels: C } = info;
  const n = W * H;
  const lum = new Uint8Array(n);
  const sat = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const r = data[i * C], g = data[i * C + 1], b = data[i * C + 2];
    lum[i] = (r * 299 + g * 587 + b * 114) / 1000;
    sat[i] = Math.max(r, g, b) - Math.min(r, g, b);
  }
  // Otsu threshold on brightness
  const hist = new Array(256).fill(0);
  for (let i = 0; i < n; i++) hist[lum[i]]++;
  let sum = 0;
  for (let t = 0; t < 256; t++) sum += t * hist[t];
  let sumB = 0, wB = 0, best = 0, thr = 160;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (!wB) continue;
    const wF = n - wB;
    if (!wF) break;
    sumB += t * hist[t];
    const mB = sumB / wB, mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) ** 2;
    if (between > best) [best, thr] = [between, t];
  }
  const mask = new Uint8Array(n);
  for (let i = 0; i < n; i++) mask[i] = lum[i] > Math.max(thr, 135) && sat[i] < 38 ? 1 : 0;
  const morph = (src: Uint8Array, grow: boolean, r: number) => {
    const out = new Uint8Array(n);
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        let v = grow ? 0 : 1;
        for (let dy = -r; dy <= r; dy++)
          for (let dx = -r; dx <= r; dx++) {
            const yy = y + dy, xx = x + dx;
            const on = yy >= 0 && yy < H && xx >= 0 && xx < W ? src[yy * W + xx] : 0;
            if (grow && on) v = 1;
            if (!grow && !on) v = 0;
          }
        out[y * W + x] = v;
      }
    return out;
  };
  // close the gaps printed text leaves in the paper, then cut thin bridges to bright background (opening)
  let m = morph(morph(mask, true, 1), false, 1);
  m = morph(morph(m, false, 2), true, 2);
  // largest connected bright region
  const seen = new Uint8Array(n);
  let bestBox: { x0: number; y0: number; x1: number; y1: number; area: number; seed: number } | null = null;
  const stack: number[] = [];
  for (let s = 0; s < n; s++) {
    if (!m[s] || seen[s]) continue;
    let area = 0, x0 = W, y0 = H, x1 = 0, y1 = 0;
    stack.push(s);
    seen[s] = 1;
    while (stack.length) {
      const p = stack.pop()!;
      const x = p % W, y = (p - x) / W;
      area++;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
      for (const q of [p - 1, p + 1, p - W, p + W]) {
        if (q < 0 || q >= n || seen[q] || !m[q]) continue;
        if ((q === p - 1 && x === 0) || (q === p + 1 && x === W - 1)) continue;
        seen[q] = 1;
        stack.push(q);
      }
    }
    if (!bestBox || area > bestBox.area) bestBox = { x0, y0, x1, y1, area, seed: s };
  }
  if (!bestBox) return null;
  // keep only rows/columns that are mostly paper (drops glare and background stuck to an edge)
  const comp = new Uint8Array(n);
  {
    const st = [bestBox.seed];
    const vis = new Uint8Array(n);
    vis[bestBox.seed] = 1;
    while (st.length) {
      const p = st.pop()!;
      comp[p] = 1;
      const x = p % W;
      for (const q of [p - 1, p + 1, p - W, p + W]) {
        if (q < 0 || q >= n || vis[q] || !m[q]) continue;
        if ((q === p - 1 && x === 0) || (q === p + 1 && x === W - 1)) continue;
        vis[q] = 1;
        st.push(q);
      }
    }
  }
  const rows = new Array(H).fill(0), cols = new Array(W).fill(0);
  for (let i = 0; i < n; i++) if (comp[i]) (rows[Math.floor(i / W)]++, cols[i % W]++);
  const span = (a: number[]) => {
    const peak = Math.max(...a);
    const keep = a.map((v) => v >= peak * 0.35);
    return [keep.indexOf(true), keep.lastIndexOf(true)];
  };
  const [ry0, ry1] = span(rows), [cx0, cx1] = span(cols);
  Object.assign(bestBox, { x0: cx0, x1: cx1, y0: ry0, y1: ry1 });
  const boxArea = (bestBox.x1 - bestBox.x0 + 1) * (bestBox.y1 - bestBox.y0 + 1);
  // too small to be the page, or basically the whole photo already
  if (bestBox.area < n * 0.06 || boxArea > n * 0.92) return null;
  const pad = 0.015;
  const x = Math.max(0, bestBox.x0 / W - pad), y = Math.max(0, bestBox.y0 / H - pad);
  return { x, y, w: Math.min(1 - x, (bestBox.x1 + 1) / W - x + pad), h: Math.min(1 - y, (bestBox.y1 + 1) / H - y + pad) };
}

/** The page ready to read: rotated, cropped, contrast evened out, sharpened. */
export async function cleanPage(bytes: Uint8Array, opts: { crop: Crop | null; rotate: Rotate }) {
  const upright = await sharp(bytes, { failOn: "none" }).rotate().rotate(opts.rotate).toBuffer({ resolveWithObject: true });
  const { width: W, height: H } = upright.info;
  let s = sharp(upright.data);
  if (opts.crop) {
    const left = Math.round(opts.crop.x * W), top = Math.round(opts.crop.y * H);
    const width = Math.max(10, Math.min(W - left, Math.round(opts.crop.w * W))), height = Math.max(10, Math.min(H - top, Math.round(opts.crop.h * H)));
    s = s.extract({ left, top, width, height });
  }
  return s.grayscale().normalise({ lower: 2, upper: 98 }).sharpen({ sigma: 1 }).jpeg({ quality: 90 }).toBuffer({ resolveWithObject: true });
}

/** Overlapping top-to-bottom sections of a tall page, each sent at full detail. */
export async function zoomSections(page: Buffer, width: number, height: number): Promise<Buffer[]> {
  const count = Math.min(4, Math.max(2, Math.ceil(height / (width * 1.1))));
  if (height < 900 && width < 900) return [];
  const band = Math.ceil(height / count);
  const overlap = Math.round(band * 0.12);
  const out: Buffer[] = [];
  for (let i = 0; i < count; i++) {
    const top = Math.max(0, i * band - overlap);
    const h = Math.min(height - top, band + overlap * 2);
    out.push(await sharp(page).extract({ left: 0, top, width, height: h }).resize({ width: 1568, height: 1568, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 90 }).toBuffer());
  }
  return out;
}

/**
 * Formation preview + validator.
 *
 *   node scripts/preview-formations.ts [all | bigBang galaxy ...] [--count 300000] [--size 520] [--out .previews]
 *
 * For each formation: runs the generator in-process, validates the contract in lib/formations/types.ts,
 * prints stats as JSON and writes a 3-panel PNG (front ortho | top ortho | final: chapter tilt +
 * perspective from the default camera) using the chapter palette with additive splatting, so the
 * look can be judged by eye (open the PNG with an image viewer / the Read tool).
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { CHAPTERS, type FormationName } from '../data/chapters.ts';
import { FORMATION_ORDER, runFormation } from '../lib/formations/index.ts';
import { CANVAS_EXTENT, FORMATION_BOUND, PULSE_BASE_BRIGHTNESS, PULSE_W_OFFSET } from '../lib/formations/types.ts';

const argv = process.argv.slice(2);
const opt = (name: string, def: string): string => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1]! : def;
};
const count = Number(opt('count', '300000'));
const size = Number(opt('size', '520'));
const outDir = path.resolve(opt('out', '.previews'));
const positional = argv.filter((a, i) => !a.startsWith('--') && !(i > 0 && argv[i - 1]!.startsWith('--')));
const names: FormationName[] =
  positional.length === 0 || positional.includes('all') ? [...FORMATION_ORDER] : (positional as FormationName[]);

fs.mkdirSync(outDir, { recursive: true });

// --------------------------------------------------------------------------------- PNG encoding
function encodePng(width: number, height: number, rgb: Uint8Array): Buffer {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 3 + 1)] = 0;
    Buffer.from(rgb.buffer, rgb.byteOffset + y * width * 3, width * 3).copy(raw, y * (width * 3 + 1) + 1);
  }
  const chunk = (type: string, data: Buffer): Buffer => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(td) >>> 0);
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 6 })), chunk('IEND', Buffer.alloc(0)),
  ]);
}

const hexToRgb = (hex: string): [number, number, number] => {
  const n = parseInt(hex.replace('#', ''), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
};

/** three.js Euler 'XYZ': matrix = Rx · Ry · Rz, applied as v' = Rx(Ry(Rz v)). */
function eulerXYZ(v: [number, number, number], [ax, ay, az]: readonly [number, number, number]): [number, number, number] {
  let [x, y, z] = v;
  let c = Math.cos(az), s = Math.sin(az);
  [x, y] = [x * c - y * s, x * s + y * c];
  c = Math.cos(ay); s = Math.sin(ay);
  [x, z] = [x * c + z * s, -x * s + z * c];
  c = Math.cos(ax); s = Math.sin(ax);
  [y, z] = [y * c - z * s, y * s + z * c];
  return [x, y, z];
}

// --------------------------------------------------------------------------------- run
const summary: Record<string, unknown>[] = [];
for (const name of names) {
  const chapter = CHAPTERS.find((c) => c.formation === name);
  if (!chapter) { console.error(`unknown formation ${name}`); process.exitCode = 1; continue; }

  const t0 = performance.now();
  let lastReport = -1;
  let reportCalls = 0;
  const data = runFormation(name, count, (f) => { reportCalls++; lastReport = f; });
  const ms = performance.now() - t0;

  // ---- validation
  const bound = name === 'canvas' ? CANVAS_EXTENT : FORMATION_BOUND;
  let nan = 0, oob = 0, badW = 0, pulses = 0;
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  let rSum = 0, rMax = 0, wSum = 0;
  const wHist = new Array(10).fill(0) as number[];
  const prefixN = Math.floor(count / 10);
  let prefR = 0, prefW = 0;
  for (let i = 0; i < count; i++) {
    const x = data[i * 4]!, y = data[i * 4 + 1]!, z = data[i * 4 + 2]!, w = data[i * 4 + 3]!;
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z) || !Number.isFinite(w)) { nan++; continue; }
    const yb = name === 'canvas' ? FORMATION_BOUND : bound;
    if (Math.abs(x) > bound || Math.abs(y) > yb || Math.abs(z) > bound) oob++;
    min[0] = Math.min(min[0]!, x); min[1] = Math.min(min[1]!, y); min[2] = Math.min(min[2]!, z);
    max[0] = Math.max(max[0]!, x); max[1] = Math.max(max[1]!, y); max[2] = Math.max(max[2]!, z);
    const r = Math.hypot(x, y, z);
    rSum += r; rMax = Math.max(rMax, r);
    let wb = w;
    if (w >= PULSE_W_OFFSET && w < PULSE_W_OFFSET + 1) { pulses++; wb = PULSE_BASE_BRIGHTNESS; }
    else if (w < 0 || w > 1) badW++;
    wSum += wb;
    wHist[Math.min(9, Math.max(0, Math.floor(wb * 10)))]!++;
    if (i < prefixN) { prefR += r; prefW += wb; }
  }
  const meanR = rSum / count, meanW = wSum / count;
  const prefixDrift = {
    radius: +(Math.abs(prefR / prefixN - meanR) / Math.max(1e-6, meanR)).toFixed(4),
    w: +(Math.abs(prefW / prefixN - meanW) / Math.max(1e-6, meanW)).toFixed(4),
  };
  const errors: string[] = [];
  if (nan) errors.push(`${nan} non-finite values`);
  if (oob) errors.push(`${oob} points out of bounds (±${bound})`);
  if (badW) errors.push(`${badW} w values outside [0,1] ∪ [2,3)`);
  if (prefixDrift.radius > 0.03 || prefixDrift.w > 0.03) errors.push(`prefix not representative (order not random?) ${JSON.stringify(prefixDrift)}`);
  if (reportCalls === 0) errors.push('report() never called');

  // ---- render 3 panels
  const W = size * 3, H = size;
  const acc = new Float32Array(W * H * 3);
  const pa = hexToRgb(chapter.palette.primary), pb = hexToRgb(chapter.palette.secondary);
  const extent = name === 'canvas' ? CANVAS_EXTENT + 0.5 : FORMATION_BOUND + 0.2;
  const exposure = 0.3 * (300000 / count) * (size / 520) ** 2;
  const splat = (panel: number, u: number, v: number, col: [number, number, number], b: number) => {
    const px = Math.floor(u), py = Math.floor(v);
    if (px < 0 || py < 0 || px >= size || py >= size) return;
    const idx = (py * W + panel * size + px) * 3;
    acc[idx] = acc[idx]! + col[0] * b; acc[idx + 1] = acc[idx + 1]! + col[1] * b; acc[idx + 2] = acc[idx + 2]! + col[2] * b;
  };
  // Final panel: proper look-at perspective camera (fov 40°) at `eye`, looking at the origin.
  const fov = (40 * Math.PI) / 180;
  const f = size / 2 / Math.tan(fov / 2);
  const eye: [number, number, number] = name === 'canvas' ? [0, 3.4, 11.5] : [0, 0, 10.5];
  const fl = Math.hypot(...eye);
  const fwd: [number, number, number] = [-eye[0] / fl, -eye[1] / fl, -eye[2] / fl];
  // right = normalize(cross(fwd, up=(0,1,0))) ; up' = cross(right, fwd)
  let rgt: [number, number, number] = [-fwd[2], 0, fwd[0]];
  const rl = Math.hypot(...rgt); rgt = [rgt[0] / rl, rgt[1] / rl, rgt[2] / rl];
  const upv: [number, number, number] = [
    rgt[1] * fwd[2] - rgt[2] * fwd[1], rgt[2] * fwd[0] - rgt[0] * fwd[2], rgt[0] * fwd[1] - rgt[1] * fwd[0],
  ];
  for (let i = 0; i < count; i++) {
    const x = data[i * 4]!, y = data[i * 4 + 1]!, z = data[i * 4 + 2]!, w = data[i * 4 + 3]!;
    if (!Number.isFinite(x + y + z + w)) continue;
    let mix = w, bright = 0.25 + 0.75 * w;
    if (w >= PULSE_W_OFFSET) {
      const ph = w - PULSE_W_OFFSET;
      const pulse = (ph * 4) % 1 < 0.06 ? 1 : 0; // visualise phase direction
      mix = 0.4 + 0.6 * pulse; bright = PULSE_BASE_BRIGHTNESS + pulse * 0.9;
    }
    const col: [number, number, number] = [pb[0] + (pa[0] - pb[0]) * mix, pb[1] + (pa[1] - pb[1]) * mix, pb[2] + (pa[2] - pb[2]) * mix];
    const b = bright * exposure;
    const s = size / (2 * extent);
    splat(0, size / 2 + x * s, size / 2 - y * s, col, b); // front (looking down -Z)
    splat(1, size / 2 + x * s, size / 2 + z * s, col, b); // top (looking down -Y, +Z toward viewer = bottom)
    const sc = chapter.scene.scale;
    const v = eulerXYZ([x * sc, y * sc, z * sc], chapter.scene.tilt);
    const d0 = v[0] - eye[0], d1 = v[1] - eye[1], d2 = v[2] - eye[2];
    const zc = d0 * fwd[0] + d1 * fwd[1] + d2 * fwd[2];
    if (zc > 0.1) {
      const xc = d0 * rgt[0] + d1 * rgt[1] + d2 * rgt[2];
      const yc = d0 * upv[0] + d1 * upv[1] + d2 * upv[2];
      splat(2, size / 2 + (xc * f) / zc, size / 2 - (yc * f) / zc, col, b);
    }
  }
  const rgb = new Uint8Array(W * H * 3);
  for (let i = 0; i < acc.length; i++) rgb[i] = Math.round(255 * Math.pow(1 - Math.exp(-acc[i]! * 1.6), 1 / 2.2));
  for (let y = 0; y < H; y++) for (const xx of [size, size * 2]) { const k = (y * W + xx) * 3; rgb[k] = rgb[k + 1] = rgb[k + 2] = 60; }
  const file = path.join(outDir, `${chapter.number}-${name}.png`);
  fs.writeFileSync(file, encodePng(W, H, rgb));

  const stats = {
    name, chapter: chapter.number, count, ms: Math.round(ms), msPerMillion: Math.round((ms * 1e6) / count),
    bounds: { min: min.map((v) => +v.toFixed(3)), max: max.map((v) => +v.toFixed(3)) },
    meanRadius: +meanR.toFixed(3), maxRadius: +rMax.toFixed(3), meanW: +meanW.toFixed(3),
    wHistogram: wHist.map((n) => +(n / count).toFixed(3)), pulseCarriers: pulses, reportCalls, lastReport,
    prefixDrift, errors, preview: file,
  };
  summary.push(stats);
  console.log(JSON.stringify(stats));
  if (errors.length) process.exitCode = 1;
}
if (summary.length > 1) {
  console.log(`\n${summary.filter((s) => (s.errors as string[]).length === 0).length}/${summary.length} formations valid`);
}

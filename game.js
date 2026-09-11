"use strict";
/* SEEDWORLD — an infinite deterministic world from one 32-bit seed, dressed as a 2007-era MMO client.
   Nothing about the world is stored: every vertex, tree, vein and cottage is a pure function of (x, z, seed). */
/* ---- 1. NOISE: integer hash, never floats, so every client agrees ---- */
function hash2(x, y, s) {
  let h = (s ^ Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return (h ^ (h >>> 16)) >>> 0;
}
const TAU = Math.PI * 2, PI = Math.PI;
const GX = new Float32Array(64), GY = new Float32Array(64);
for (let i = 0; i < 64; i++) { GX[i] = Math.cos(i / 64 * TAU); GY[i] = Math.sin(i / 64 * TAU); }
function noise2(x, y, s) {
  const x0 = Math.floor(x), y0 = Math.floor(y), dx = x - x0, dy = y - y0;
  const u = dx * dx * dx * (dx * (dx * 6 - 15) + 10), v = dy * dy * dy * (dy * (dy * 6 - 15) + 10);
  let g = hash2(x0, y0, s) & 63;         const a = GX[g] * dx + GY[g] * dy;
  g = hash2(x0 + 1, y0, s) & 63;         const b = GX[g] * (dx - 1) + GY[g] * dy;
  g = hash2(x0, y0 + 1, s) & 63;         const c = GX[g] * dx + GY[g] * (dy - 1);
  g = hash2(x0 + 1, y0 + 1, s) & 63;     const d = GX[g] * (dx - 1) + GY[g] * (dy - 1);
  const ab = a + (b - a) * u, cd = c + (d - c) * u;
  return (ab + (cd - ab) * v) * 1.42;
}
function fbm(x, y, s, oct) {
  let sum = 0, amp = 0.5, f = 1, norm = 0;
  for (let i = 0; i < oct; i++) { sum += amp * noise2(x * f, y * f, s + i * 1013); norm += amp; amp *= 0.5; f *= 2; }
  return sum / norm;
}
function ridged(x, y, s, oct) {
  let sum = 0, amp = 0.5, f = 1, norm = 0;
  for (let i = 0; i < oct; i++) { const n = 1 - Math.abs(noise2(x * f, y * f, s + i * 7919)); sum += amp * n * n; norm += amp; amp *= 0.5; f *= 2; }
  return sum / norm;
}
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const smoothstep = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };
/* shortest angular delta in (-PI, PI] */
const wrapA = d => { while (d > PI) d -= TAU; while (d < -PI) d += TAU; return d; };

/* ---- 2. THE WORLD: one tile = one unit, sea level y 0. macroHeight is the expensive field (sampled per tile),
   microRelief is cheap sub-tile detail. ---- */
let S = 0;
const SETTLE_CELL = 250, INV_CELL = 1 / SETTLE_CELL;
let villageCache = new Map(), nbrCache = new Map();

function macroHeight(x, z) {
  if (z > 500000) return dunHeight(x, z);   // the dungeon band rides the same plane (wire format)
  const wx = fbm(x * 0.00062, z * 0.00062, S + 61, 2) * 190;   // domain warp
  const wz = fbm(x * 0.00062 + 41.3, z * 0.00062 - 27.9, S + 62, 2) * 190;
  const cont = fbm((x + wx) * 0.00125, (z + wz) * 0.00125, S + 1, 5);
  const shore = cont * 1.65 + 0.10;
  let h = shore < 0 ? shore * 24 : shore * 32;
  const landish = smoothstep(-7, 4, h);
  h += fbm(x * 0.013, z * 0.013, S + 2, 4) * 5.4 * landish;
  h += fbm(x * 0.041, z * 0.041, S + 7, 3) * 1.9 * landish;
  const belt = ridged(x * 0.00085, z * 0.00085, S + 5, 2);   // mountain belts
  const mask = smoothstep(0.52, 0.86, belt) * smoothstep(1, 9, h);
  if (mask > 0.002) {
    const r = ridged(x * 0.0048, z * 0.0048, S + 3, 5);
    let mh = r * r * 96 * mask;
    const LS = 6.5, t = mh / LS, fl = Math.floor(t);   // quantised ledges
    mh = (fl + smoothstep(0.30, 0.80, t - fl)) * LS;
    h += mh;
  }
  const w = fbm(x * 0.0042, z * 0.0042, S + 9, 2);   // rivers
  const r2 = fbm(x * 0.0031 + w * 0.22, z * 0.0031 + w * 0.22, S + 4, 3);
  let riv = 1 - Math.min(1, Math.abs(r2) / 0.052);
  riv = riv * riv * (1 - smoothstep(14, 44, h));
  if (riv > 0.002) h = Math.max(h - riv * 17, -3.2 + h * 0.02);
  if (h > -4 && h < 4) h *= 0.55 + 0.45 * smoothstep(0, 4, Math.abs(h));   // broad shoreline
  return h;
}
const microRelief = (x, z) => fbm(x * 0.085, z * 0.085, S + 11, 3) * 0.80 + noise2(x * 0.33, z * 0.33, S + 12) * 0.17;

/* ---- STAGE 1: siting. Each stage reads only what the stage before it settled. ---- */
const RANKS = [
  { n: 'hamlet',     R: 22,  land: 0.50, houses: 7,   wall: 0, keep: 0, shops: 1, grids: 0, ring: 0, lm: 0 },
  { n: 'village',    R: 32,  land: 0.56, houses: 15,  wall: 1, keep: 0, shops: 2, grids: 0, ring: 0, lm: 1 },
  { n: 'town',       R: 48,  land: 0.64, houses: 40,  wall: 1, keep: 0, shops: 3, grids: 1, ring: 1, lm: 1 },
  { n: 'city',       R: 72,  land: 0.72, houses: 120,  wall: 2, keep: 1, shops: 5, grids: 2, ring: 1, lm: 1 },
  { n: 'metropolis', R: 100, land: 0.80, houses: 190, wall: 2, keep: 1, shops: 6, grids: 4, ring: 1, lm: 1 }
];
const TIER_N = RANKS.map(r => r.n);
function sitePos(cx, cz) {
  const h = hash2(cx, cz, S + 21), j = SETTLE_CELL * 0.30, span = SETTLE_CELL - j * 2;
  return [cx * SETTLE_CELL + j + (h >>> 9) % span, cz * SETTLE_CELL + j + hash2(cx, cz, S + 22) % span];
}
const _sr = new Float32Array(32), _sok = new Uint8Array(32);
function siteSurvey(px, pz, y0, maxR) {   // 32 golden-angle samples, radius recorded
  for (let i = 0; i < 32; i++) {
    const a = i * 2.39996323, rr = maxR * Math.sqrt((i + 0.5) / 32);
    const h = macroHeight(px + Math.cos(a) * rr, pz + Math.sin(a) * rr);
    _sr[i] = rr; _sok[i] = (h > 1.7 && h < 46 && Math.abs(h - y0) < 10) ? 1 : 0;
  }
}
function landWithin(R) {
  let ok = 0, tot = 0;
  for (let i = 0; i < 32; i++) if (_sr[i] <= R) { tot++; ok += _sok[i]; }
  return tot ? ok / tot : 0;
}
const rankWish = h => { const t = h % 1000; return t < 380 ? 0 : t < 660 ? 1 : t < 850 ? 2 : t < 958 ? 3 : 4; };
/* the outline: a settlement is one shape, and everything reads it through villageDist — the plateau, the fields, the wall, the safety belt.
   PF_N radii round the compass in the stretched frame: a lobed blob for the small places, a softened polygon for the towns that planned
   themselves. pmax is the outline's reach in r, so the siting cap knows what must fit between neighbours. */
const PF_N = 96, EXT_MAX = 1.5;   // every outline fits inside EXT_MAX·r, so a town is sized before its shape is known
/* the outline kinds: 0 a lobed blob (the small places), 1 a rectangle, 2 rectangles joined into a sprawl of wards, 3 a softened regular
   polygon. Rectangles all contain the centre, so their union is star-shaped and one radius per compass point describes it. */
function townShape(cx, cz, rank, role, asp0) {
  const h = hash2(cx, cz, S + 25), h2 = hash2(cx, cz, S + 26), pf = new Float32Array(PF_N), pc = [], roll = (h >>> 1) % 100;
  const kind = role === 2 ? 1 : rank >= 3 ? (roll < 18 ? 0 : roll < 42 ? 1 : roll < 84 ? 2 : 3) : rank === 2 ? (roll < 40 ? 0 : roll < 62 ? 1 : roll < 78 ? 2 : 3) : 0;
  let rects = null, pn = 0, po = 0, rnd = 0;
  if (kind === 1 || kind === 2) {
    const a1 = role === 2 ? 1.45 : kind === 2 ? 0.80 + ((h >>> 8) & 255) / 255 * 0.25 : 1 + ((h >>> 8) & 255) / 255 * 0.45, sw = role === 2 ? 0 : (h >>> 16) & 1;
    rects = [{ x: 0, z: 0, hw: sw ? 1 : a1, hd: sw ? a1 : 1 }];
    if (kind === 2) for (let i = 0, n = 1 + ((h2 >>> 20) & 1); i < n; i++) {   // one or two wings, each still holding the centre
      const g = hash2(cx + i * 7, cz - i * 3, S + 28), hw = 0.60 + (g & 255) / 255 * 0.75, hd = 0.60 + ((g >>> 8) & 255) / 255 * 0.75;
      rects.push({ x: (((g >>> 16) & 255) / 255 * 2 - 1) * hw * 0.92, z: (((g >>> 24) & 255) / 255 * 2 - 1) * hd * 0.92, hw, hd });
    }
  } else if (kind === 3) { pn = [4, 5, 6][(h >>> 4) % 3]; po = ((h >>> 8) & 255) / 256 * TAU; rnd = ((h >>> 16) & 1) * 0.12; }
  const asp = rects ? 1 : asp0, az = Math.sqrt(asp), amp = kind === 0 ? 0.11 + ((h >>> 18) & 31) / 31 * 0.17 : kind === 3 ? 0.04 : 0;
  const ray = a => {   // the raw outline at a frame angle (sin to x, cos to z)
    if (rects) {
      const sx = Math.sin(a), cz2 = Math.cos(a);
      let p = 0;
      for (const rc of rects) { const tx = sx > 1e-6 ? (rc.x + rc.hw) / sx : sx < -1e-6 ? (rc.x - rc.hw) / sx : 1e9, tz = cz2 > 1e-6 ? (rc.z + rc.hd) / cz2 : cz2 < -1e-6 ? (rc.z - rc.hd) / cz2 : 1e9; p = Math.max(p, Math.min(tx, tz)); }
      return p;
    }
    if (pn) { const w = TAU / pn, t = ((a - po) % w + w) % w - w / 2, p = 1 / Math.cos(t); return p + (1 - p) * rnd; }
    return 1;
  };
  let mean = 0, mx = 0;
  for (let i = 0; i < PF_N; i++) { pf[i] = ray(i / PF_N * TAU); mean += pf[i] / PF_N; }
  const f2 = (h2 & 7) / 8 * TAU, f3 = ((h2 >>> 3) & 7) / 8 * TAU, f5 = ((h2 >>> 6) & 7) / 8 * TAU;
  for (let i = 0; i < PF_N; i++) {
    const a = i / PF_N * TAU, p = clamp(pf[i] / mean + amp * (Math.cos(2 * a + f2) * 0.55 + Math.cos(3 * a + f3) * 0.35 + Math.cos(5 * a + f5) * 0.18), 0.6, EXT_MAX / az);
    pf[i] = p; if (p > mx) mx = p;
  }
  if (rects) {   // the corners that stand on the outline take towers; wards are kept in outline units for the plan
    for (const rc of rects) for (const sx of [-1, 1]) for (const sz of [-1, 1]) { const x = rc.x + sx * rc.hw, z = rc.z + sz * rc.hd, a = Math.atan2(x, z), d = Math.hypot(x, z); if (Math.abs(ray(a) - d) < d * 0.03) pc.push(a); }
    rects = rects.map(rc => ({ x: rc.x / mean, z: rc.z / mean, hw: rc.hw / mean, hd: rc.hd / mean }));
  } else if (pn) for (let k = 0; k < pn; k++) pc.push(po + k * TAU / pn);
  return { pf, pn, po, pc, pmax: mx, rects, kind, asp };
}
const PLAN_ODDS = [[0, 0, 55, 100], [25, 25, 65, 100], [35, 60, 75, 100], [40, 75, 75, 100], [40, 75, 75, 100]];   // cumulative %, by rank: radial, grid, high street, crooked
/* the shape-blind half of siting: where a settlement stands, how big it may grow and what rank it earned. The charter reads only this */
function siteInfo(cx, cz) {
  if (cz * SETTLE_CELL > 499000) return null;   // no settlements in the dungeon band
  const k = (cx * 8191 + cz) * 2 + 1;
  let s = villageCache.get(k);
  if (s !== undefined) return s;
  s = null;
  const [px, pz] = sitePos(cx, cz);
  if (wildLvAt(px, pz)) { villageCache.set(k, s); return s; }   // nothing settles the wilderness
  const A = regionAt(px, pz).a;
  // civilisation clusters: each kingdom keeps a dense heart and true emptiness between, so arriving somewhere means leaving nowhere
  const civ = fbm(px * 0.00018, pz * 0.00018, S + 72, 2) * 1.6 + A.civ + smoothstep(3600, 700, Math.hypot(px, pz)) * 0.45;   // the whole larger heart keeps its towns
  if ((hash2(cx, cz, S + 21) % 1000) < 120 + 780 * smoothstep(-0.62, 0.55, civ)) {
    const y = macroHeight(px, pz);
    if (y > 1.9 && y < 34) {
      let gap = 1e9;   // never grow into a neighbour: the outline's reach, not the nominal radius, is what must fit
      for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
        if (!a && !b) continue;
        const q = sitePos(cx + a, cz + b), d = Math.hypot(q[0] - px, q[1] - pz);
        if (d < gap) gap = d;
      }
      let want = rankWish(hash2(cx, cz, S + 23));
      const rich = fbm(px * 0.00045, pz * 0.00045, S + 71, 2);   // regional prosperity
      if (rich > 0.22) want = Math.min(4, want + 1); else if (rich < -0.24) want = Math.max(0, want - 1);
      if (cx >= -1 && cx <= 0 && cz >= -1 && cz <= 0) want = Math.max(want, 1);   // the home cells try for a village at least: Lumbridge has a castle to hold
      const capR = Math.min(gap * 0.55, (-wildD(px, pz) - 40) / 1.6) / EXT_MAX;   // fields and belt (1.6r) stop 40 short of the ditch
      siteSurvey(px, pz, y, RANKS[want].R);
      let rank = -1;
      for (let r = want; r >= 0; r--) { const R = RANKS[r].R; if (R <= capR && landWithin(R) >= RANKS[r].land) { rank = r; break; } }
      if (rank >= 0) s = { cx, cz, x: px, z: pz, y: Math.round(y), rank, r: Math.round(Math.min(RANKS[rank].R, capR)), reg: A, h3: hash2(cx, cz, S + 24) };
    }
  }
  villageCache.set(k, s);
  return s;
}
function villageAt(cx, cz) {
  const k = (cx * 8191 + cz) * 2;
  let v = villageCache.get(k);
  if (v !== undefined) return v;
  const s = siteInfo(cx, cz);
  v = null;
  if (s) {
    const role = charterRoleAt(s), hp = hash2(cx, cz, S + 27), h3 = s.h3, rank = s.rank;
    const sh = townShape(cx, cz, rank, role, 1 + ((h3 >>> 8) & 255) / 255 * 0.35), asp = sh.asp;
    const rot = role === 2 ? 0 : rank >= 2 ? ((h3 >>> 2) & 1) * PI / 2 : (h3 & 255) / 256 * PI;   // the planned towns sit square to the world, as the old ones did
    v = Object.assign({}, s, { tier: Math.min(2, rank), role, ax: 1 / Math.sqrt(asp), az: Math.sqrt(asp), cs: Math.cos(rot), sn: Math.sin(rot),
          pf: sh.pf, pn: sh.pn, po: sh.po, pc: sh.pc, rects: sh.rects, kind: sh.kind, ext: Math.sqrt(asp) * sh.pmax,
          pk: role === 2 ? 1 : PLAN_ODDS[rank].findIndex(c => hp % 100 < c), rot: rank >= 2 ? 0 : ((hp >>> 8) & 255) / 256 * PI / 2,   // a planned town's grid runs with its frame
          G: null, b: null, f: null, keep: null, wall: null, trees: null, spots: null, name: null, lm: null, fur: null, shrine: null, booth: null, pen: null, dock: null, guild: null });
  }
  villageCache.set(k, v);
  return v;
}
function nbrs(cx, cz) {
  const k = cx * 8191 + cz;
  let a = nbrCache.get(k);
  if (a) return a;
  a = [];
  for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) { const v = villageAt(cx + i, cz + j); if (v) a.push(v); }
  nbrCache.set(k, a);
  return a;
}
let _lcx = 1e9, _lcz = 1e9, _llist = [];   // one-entry cell cache
let _nvx = 1e9, _nvz = 1e9, _nvr = null;   // and a one-entry answer per integer tile: finish() asks four times per tile
function nearVillage(x, z) {
  const ix = Math.floor(x), iz = Math.floor(z);
  if (ix === _nvx && iz === _nvz) return _nvr;
  _nvx = ix; _nvz = iz;
  const cx = Math.floor(x * INV_CELL), cz = Math.floor(z * INV_CELL);
  if (cx !== _lcx || cz !== _lcz) { _lcx = cx; _lcz = cz; _llist = nbrs(cx, cz); }
  let best = null, bd = 1e9;
  for (const v of _llist) { const d = villageDist(v, ix, iz); if (d < v.r * 1.8 && d < bd) { bd = d; best = v; } }   // 1.8: the safety belt reads past the fields
  return _nvr = (best ? { v: best, d: bd } : null);
}
const profAt = (v, a) => { const t = a / TAU * PF_N, i0 = Math.floor(t), f = t - i0, i = ((i0 % PF_N) + PF_N) % PF_N, p = v.pf; return p[i] + (p[(i + 1) % PF_N] - p[i]) * f; };
function villageDist(v, x, z) {   // in the settlement's rotated, stretched frame, then through its outline: below r is inside
  const dx = x - v.x, dz = z - v.z, rx = dx * v.cs + dz * v.sn, rz = -dx * v.sn + dz * v.cs;
  const ex = rx / v.ax, ez = rz / v.az;
  return Math.sqrt(ex * ex + ez * ez) / profAt(v, Math.atan2(ex, ez));
}
/* a world heading, as the outline's own compass reads it: the frame is rotated and stretched, so the two disagree */
const frameAng = (v, w) => { const sx = Math.sin(w), cz = Math.cos(w); return Math.atan2((sx * v.cs + cz * v.sn) / v.ax, (-sx * v.sn + cz * v.cs) / v.az); };
function townPt(v, a, d) {   // the inverse: the tile at compass angle a (sin to x, cos to z, as the streets read it) and villageDist d
  const p = profAt(v, a) * d, rx = Math.sin(a) * p * v.ax, rz = Math.cos(a) * p * v.az;
  return [Math.round(v.x + rx * v.cs - rz * v.sn), Math.round(v.z + rx * v.sn + rz * v.cs)];
}
function nearestVillageTo(x, z, maxRing) {   // spiral out; scan one ring past the first hit
  const cx = Math.floor(x * INV_CELL), cz = Math.floor(z * INV_CELL);
  let best = null, bd = 1e9, foundRing = -1;
  for (let ring = 0; ring <= (maxRing === undefined ? 10 : maxRing); ring++) {
    if (foundRing >= 0 && ring > foundRing + 1) break;
    for (let a = -ring; a <= ring; a++) for (let b = -ring; b <= ring; b++) {
      if (Math.max(Math.abs(a), Math.abs(b)) !== ring) continue;
      const v = villageAt(cx + a, cz + b);
      if (!v) continue;
      if (foundRing < 0) foundRing = ring;
      const d = Math.hypot(v.x - x, v.z - z);
      if (d < bd) { bd = d; best = v; }
    }
  }
  return best;
}
/* a walkable street tile inside a settlement: town ground is truce ground */
function safeSpotIn(v) {
  villageBuildings(v);
  let best = null, bd = 1e9;
  for (const s of (v.spots || [])) { const d = Math.hypot(s.x - v.x, s.z - v.z); if (d < bd && !isWater(heightAt(s.x, s.z))) { bd = d; best = s; } }
  if (best) return best;
  for (let r = 0; r <= v.r; r++) for (let a = -r; a <= r; a++) for (let b = -r; b <= r; b++) {
    if (Math.max(Math.abs(a), Math.abs(b)) !== r) continue;
    const x = v.x + a, z = v.z + b, c = cityCell(x, z);
    if ((c === G_ROAD || c === G_PAVED) && heightAt(x, z) > 1.5) return { x, z };
  }
  return { x: v.x, z: v.z };
}

/* ---- STAGE 4: roads. Each settlement links east, south and maybe a diagonal, so every link is built once. ---- */
const roadCache = new Map();
const LINK_DIRS = [[1, 0], [0, 1], [1, 1], [1, -1]];
/* where a road meets a town: a grid town turns arrivals within 34 degrees of a grid axis onto it; every other gate sits on a
   15-degree compass point, so two roads arriving close share one gate and one artery */
const GATE_Q = TAU / 24;
function gateAngle(v, a) {
  if (v.pk === 1 || v.rank >= 3) { const d = wrapA(a - v.rot), s = Math.round(d / (PI / 2)) * PI / 2; if (Math.abs(wrapA(d - s)) < 0.6) return v.rot + s; }
  const q = v.rank >= 2 ? PI / 4 : GATE_Q;
  return Math.round(a / q) * q;
}
/* one highway: A's gate to B's gate, bent round one control point; the gate angles are what the town plans read back */
function linkOf(cx, cz, d) {
  const A = villageAt(cx, cz);
  if (!A || (d >= 2 && (hash2(cx, cz, S + 81 + d) & 3) !== 0)) return null;
  const dd = LINK_DIRS[d], B = villageAt(cx + dd[0], cz + dd[1]) || villageAt(cx + dd[0] * 2, cz + dd[1] * 2);   // reach past an empty cell
  if (!B || A.rank + B.rank < 1) return null;
  const span = Math.hypot(B.x - A.x, B.z - A.z), nx = -(B.z - A.z) / span, nz = (B.x - A.x) / span;
  const bend = (((hash2(cx, cz, S + 83 + d) >>> 7) & 255) / 255 - 0.5) * 0.30;
  const kx = (A.x + B.x) / 2 + nx * bend * span, kz = (A.z + B.z) / 2 + nz * bend * span;
  return { A, B, kx, kz, aA: gateAngle(A, frameAng(A, Math.atan2(kx - A.x, kz - A.z))), aB: gateAngle(B, frameAng(B, Math.atan2(kx - B.x, kz - B.z))), w: 1.7 + Math.max(A.rank, B.rank) * 0.42 };
}
function linkSegments(cx, cz, out) {
  for (let d = 0; d < 4; d++) {
    const L = linkOf(cx, cz, d);
    if (!L) continue;
    const [ax, az] = townPt(L.A, L.aA, L.A.r), [bx, bz] = townPt(L.B, L.aB, L.B.r), w = L.w;
    let px = ax, pz = az;
    for (let i = 1; i <= 6; i++) {   // quadratic bezier in six chords
      const t = i / 6, u = 1 - t;
      const qx = u * u * ax + 2 * u * t * L.kx + t * t * bx, qz = u * u * az + 2 * u * t * L.kz + t * t * bz;
      out.push({ x0: px, z0: pz, x1: qx, z1: qz, w, lo: Math.min(px, qx) - w - 2, hi: Math.max(px, qx) + w + 2,
                 zl: Math.min(pz, qz) - w - 2, zh: Math.max(pz, qz) + w + 2 });
      px = qx; pz = qz;
    }
  }
}
/* the roads a settlement receives: its own four links and the ones its western and northern neighbours sent it */
function townApproaches(v) {
  const out = [], add = a => { for (const b of out) if (Math.abs(wrapA(a - b)) < 0.01) return; out.push(a); };
  for (let d = 0; d < 4; d++) {
    const L = linkOf(v.cx, v.cz, d); if (L) add(L.aA);
    const dd = LINK_DIRS[d];
    for (let s = 1; s <= 2; s++) { const M = linkOf(v.cx - dd[0] * s, v.cz - dd[1] * s, d); if (M && M.B.cx === v.cx && M.B.cz === v.cz) add(M.aB); }
  }
  return out;
}
function cellRoads(cx, cz) {
  const k = cx * 8191 + cz;
  let a = roadCache.get(k);
  if (a) return a;
  const all = [];
  for (let i = -3; i <= 1; i++) for (let j = -3; j <= 1; j++) linkSegments(cx + i, cz + j, all);
  const x0 = cx * SETTLE_CELL, x1 = x0 + SETTLE_CELL, z0 = cz * SETTLE_CELL, z1 = z0 + SETTLE_CELL;
  roadCache.set(k, a = all.filter(s => s.hi >= x0 && s.lo <= x1 && s.zh >= z0 && s.zl <= z1));
  return a;
}
let _rcx = 1e9, _rcz = 1e9, _rlist = [];
function highwayAt(x, z) {   // 1 on the crown, 0 at the shoulder
  const cx = Math.floor(x * INV_CELL), cz = Math.floor(z * INV_CELL);
  if (cx !== _rcx || cz !== _rcz) { _rcx = cx; _rcz = cz; _rlist = cellRoads(cx, cz); }
  let best = 0;
  for (const s of _rlist) {
    if (x < s.lo || x > s.hi || z < s.zl || z > s.zh) continue;
    const ex = s.x1 - s.x0, ez = s.z1 - s.z0, L = ex * ex + ez * ez;
    const t = clamp(L > 1e-9 ? ((x - s.x0) * ex + (z - s.z0) * ez) / L : 0, 0, 1);
    const d = Math.hypot(x - (s.x0 + ex * t), z - (s.z0 + ez * t));
    if (d < s.w) { const q = 1 - d / s.w; if (q > best) best = q; }
  }
  return best;
}
/* flatten toward a settlement, then add micro relief where the ground is not flattened */
function finish(x, z, m) {
  const n = nearVillage(x, z);
  let flat = 0, h = m;
  if (n) {
    flat = 1 - smoothstep(n.v.rank >= 3 ? 0.80 : 0.62, 1.0, n.d / n.v.r);   // a true plateau with a short shoulder: towns sit on a table at one whole height, 2007-style; a city's table reaches its walls
    h = m + (n.v.y - m) * flat;
  }
  if (flat < 0.999 && z < 500000) h += microRelief(x, z) * (1 - flat) * smoothstep(-3, 2, h);   // the dungeon band stays smooth: relief turned its walls into rows of spikes
  if (z < 500000 && h > 0.35) {   // the wilderness ditch: a sheer trench between two raised banks, continuous over every
    const t = ditchT(x, z);   // scrap of land (open water alone interrupts it) — berms keep the wall tall even on marsh,
    if (t < 1.25) h = Math.max(h - 3.8, -0.25);   // and the tile-normalised profile keeps one width on any slope of the field
    else if (t < 3.2) h += 0.85;
  }
  return h;
}
const heightAt = (x, z) => finish(x, z, macroHeight(x, z));

/* ---- 2b. REGIONS: a jittered Voronoi of kingdoms ~1500 tiles across. Everything discrete hangs off the cell —
   palette, species, monsters, roofs, the music of the names — so crossing a border is arriving somewhere different.
   Only the paint blends, and only over ~30 tiles: OSRS borders are abrupt. All wire format (spawns read it). ---- */
const REG_CELL = 1536, regCache = new Map();
const REG = [
  { k: 'meadows', f: 'the Kingdom of X', veg: null, vs: 0, td: 1.0, civ: 0.14, wm: 0,
    sa: ['lum', 'var', 'dra', 'ed', 'bar', 'tav', 'sil', 'fen'], sb: ['bridge', 'ford', 'erby', 'wick', 'field', 'stead', 'ton', 'brook'],
    mn: { goblin: 3, redgoblin: 2, cow: 2, chicken: 2, man: 2, farmer: 2, imp: 2, rat: 2, hillgiant: 2 } },
  { k: 'highlands', f: 'the X Highlands', veg: [0.36, 0.40, 0.25], vs: 0.30, td: 0.6, civ: 0, wm: -1, st: [2, 2],
    sa: ['fal', 'bur', 'dwar', 'ice', 'crag', 'hem', 'tor', 'gunn'], sb: ['ador', 'crag', 'hold', 'gate', 'forge', 'moor', 'helm', 'deep'],
    mn: { dwarf: 4, chaosdwarf: 3, troll: 3, hillgiant: 2, hobgoblin: 3, bear: 2, earthwarrior: 2, trollgeneral: 2 } },
  { k: 'greenwood', f: 'the Forest of X', veg: [0.19, 0.38, 0.15], vs: 0.35, td: 1.9, civ: -0.02, wm: 0,
    sa: ['ard', 'cath', 'kel', 'sea', 'glen', 'yan', 'elk', 'ley'], sb: ['ougne', 'erley', 'wood', 'shade', 'grove', 'dale', 'wyn', 'combe'],
    mn: { bear: 3, wolf: 3, grizzly: 3, unicorn: 3, druid: 3, redspider: 2, mossgiant: 3, wilddog: 2 } },
  { k: 'mire', f: 'the X Mire', veg: [0.29, 0.33, 0.22], vs: 0.50, td: 0.8, civ: -0.20, wm: 0,
    sa: ['mor', 'phas', 'can', 'dre', 'grim', 'fen', 'vel', 'lot'], sb: ['tania', 'holm', 'grave', 'gloom', 'moss', 'wraith', 'ost', 'vale'],
    rf: [[0.24, 0.25, 0.30], [0.20, 0.22, 0.26], [0.29, 0.27, 0.24], [0.24, 0.25, 0.30]],
    mn: { zombie: 5, skeleton: 5, ghost: 5, ghoul: 6, shade: 5, banshee: 4, spectre: 3, shadowspider: 3, bigwolf: 2, revenant: 2 } },
  { k: 'desert', f: 'the X Desert', veg: [0.84, 0.75, 0.47], vs: 0.92, td: 0.06, civ: -0.16, wm: 1,
    sa: ['al', 'khar', 'nar', 'men', 'ullek', 'soph', 'zeh', 'pol'], sb: ['id', 'idor', 'aphos', 'tep', 'umeh', 'asis', 'akkar', 'anine'],
    rf: [[0.72, 0.64, 0.46], [0.66, 0.58, 0.42], [0.60, 0.51, 0.36], [0.72, 0.64, 0.46]],
    mn: { scorpion: 5, smallscorpion: 5, jackal: 5, camel: 3, bandit: 4, kalphiteworker: 4, kalphitesoldier: 3, mugger: 2, skeleton: 2 } },
  { k: 'jungle', f: 'the X Jungle', veg: [0.16, 0.42, 0.13], vs: 0.45, td: 2.2, civ: -0.12, wm: 1,
    sa: ['kar', 'tai', 'bwo', 'shi', 'mus', 'jal', 'tal', 'cai'], sb: ['amja', 'bwana', 'anja', 'ilo', 'aro', 'umbo', 'iji', 'apu'],
    mn: { jogre: 4, boar: 3, poisonspider: 3, spider: 3, jungledemon: 2, greendragon: 2, jackal: 2, ogre: 2 } },
  { k: 'reach', f: 'the X Reach', veg: [0.52, 0.57, 0.48], vs: 0.45, td: 0.45, civ: -0.16, wm: -1, pine: 1,
    sa: ['rell', 'jat', 'fre', 'ne', 'ulf', 'skel', 'hild', 'var'], sb: ['ekka', 'stad', 'heim', 'fjord', 'vik', 'berg', 'gard', 'strand'],
    mn: { icegiant: 4, icewarrior: 4, icetroll: 4, whitewolf: 5, wolf: 2, troll: 2, barbarian: 3, grizzly: 2 } },
  { k: 'wilds', f: 'the X Wilds', veg: [0.42, 0.36, 0.26], vs: 0.50, td: 0.30, civ: -0.32, wm: 0,
    sa: ['dar', 'bone', 'ash', 'rot', 'blood', 'crow', 'gash', 'vex'], sb: ['fell', 'maw', 'scar', 'pit', 'reach', 'rend', 'howe', 'waste'],
    mn: { bandit: 4, blackknight: 4, darkwizard: 4, revenant: 3, greaterdemon: 2, wilddog: 3, skeleton: 2, zamorakmonk: 3, mugger: 2 } }
].map((r, i) => (r.i = i, r.mn = r.mn || {}, r));
const RPOOL_MID = [0, 2, 1, 3, 0, 7, 2, 3, 0, 1], RPOOL_HOT = [4, 5, 0, 7, 4, 5], RPOOL_COLD = [6, 1, 7, 2, 6, 1];
const SYL_C = ['a', 'en', 'ar', 'or', 'in', 'le', 'ver', 'bur', 'der', 'is', 'ol', 'un', 'ath', 'ey', 'am', 'el'];
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
const wordOf = (h, A) => cap(A.sa[h % 8] + (((h >>> 16) & 3) ? SYL_C[(h >>> 18) % 16] : '') + A.sb[(h >>> 8) % 8]);
function regSite(gx, gz) {   // one seat per cell: a jittered throne and its kingdom's kind
  if (regCache.S !== S) { regCache.clear(); regCache.S = S; }
  const key = gx * 8191 + gz;
  let r = regCache.get(key);
  if (r) return r;
  const h = hash2(gx * 5 + 3, gz * 3 + 7, S + 55);
  const x = (gx + 0.25 + ((h >>> 4) & 511) / 1024) * REG_CELL, z = (gz + 0.25 + ((h >>> 14) & 511) / 1024) * REG_CELL;
  let a;
  if (gx >= -1 && gx <= 0 && gz >= -1 && gz <= 0) a = REG[0];   // the four cells that can own the origin: home is always the meadows
  else {
    const w = fbm(x * 0.00016, z * 0.00016, S + 56, 2);   // continental warmth picks the family; the hash picks within it
    const pool = w > 0.15 ? RPOOL_HOT : w < -0.15 ? RPOOL_COLD : RPOOL_MID;
    a = REG[pool[(h >>> 23) % pool.length]];
  }
  regCache.set(key, r = { x, z, a, gx, gz, name: null });
  return r;
}
const regionName = r => r.name || (r.name = r.a.f.replace('X', wordOf(hash2(r.gx * 11, r.gz * 17, S + 57), r.a)));
let _rgx = 1e9, _rgz = 1e9, _rgv = null;
const _rgveg = [0, 0, 0], _rgo = { a: null, s: null, veg: null, vs: 0 };
function regionAt(x, z) {   // nearest seat of the 3x3; the second-nearest paints the border
  const ix = Math.floor(x), iz = Math.floor(z);
  if (ix === _rgx && iz === _rgz && _rgv) return _rgv;
  _rgx = ix; _rgz = iz;
  const gx = Math.floor(x / REG_CELL), gz = Math.floor(z / REG_CELL);
  let s1 = null, s2 = null, d1 = 1e18, d2 = 1e18;
  for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
    const s = regSite(gx + a, gz + b), d = (s.x - ix) * (s.x - ix) + (s.z - iz) * (s.z - iz);
    if (d < d1) { d2 = d1; s2 = s1; d1 = d; s1 = s; } else if (d < d2) { d2 = d; s2 = s; }
  }
  const A = s1.a, B = s2 ? s2.a : A, t = clamp((Math.sqrt(d2) - Math.sqrt(d1)) / 60, 0, 1) * 0.5 + 0.5;
  _rgo.a = A; _rgo.s = s1; _rgo.veg = null; _rgo.vs = A.vs * t + (B.veg ? B.vs : 0) * (1 - t);
  if (_rgo.vs > 0.01) {
    const va = A.veg || B.veg, vb = B.veg || va;
    for (let i = 0; i < 3; i++) _rgveg[i] = vb[i] + (va[i] - vb[i]) * t;
    _rgo.veg = _rgveg;
  }
  return _rgv = _rgo;
}

/* place names: syllables from the kingdom, a form from the rank; Port only beside water */
const NAME_FORMS = [
  ['X', 'X', 'Little X', 'X End', 'X Green', 'Nether X', 'X Hollow', 'X Cot'],
  ['X', 'X', 'X', 'Upper X', 'Lower X', 'X Cross', 'X Wick', 'Old X'],
  ['X', 'X', 'Port X', 'X Market', 'East X', 'West X', 'X Bridge', 'New X'],
  ['X', 'X', 'X Castle', 'Great X', 'North X', 'South X', 'X Keep', 'Port X'],
  ['X', 'Royal X', 'X City', 'Greater X', 'Imperial X', 'X Crown', 'High X', 'Port X']
];
/* the old names, granted to the heartland: each list is one biome's, iconic first, and a 1 marks a name that must
   stand by water. Settlements inside the first band's reach claim them nearest-the-origin first, each name once;
   every town beyond — and any heart town the lists cannot cover — keeps its seeded name. */
const OSRS_NAMES = {
  meadows: [['Lumbridge'], ['Varrock'], ['Draynor Village'], ['Edgeville'], ['Hosidius'], ['Shayzien'], ['Kourend Castle'], ['Civitas illa Fortis'], ['Port Piscarilius', 1], ['Dorgesh-Kaan']],
  highlands: [['Falador'], ['Taverley'], ['Burthorpe'], ['Port Sarim', 1], ['Rimmington'], ['Entrana', 1], ['Keldagrim'], ["Gu'Tanoth"]],
  greenwood: [['East Ardougne'], ['Camelot'], ["Seers' Village"], ['Yanille'], ['West Ardougne'], ['Catherby', 1], ['Port Khazard', 1], ['Hemenster'], ['Witchaven', 1], ['Lletya'], ['Prifddinas'], ['Tyras Camp'], ['Zanaris']],
  desert: [['Al Kharid'], ['Pollnivneach'], ['Nardah'], ['Sophanem'], ['Menaphos'], ['Ullek'], ['Uzer']],
  mire: [['Canifis'], ['Port Phasmatys', 1], ["Mort'ton"], ['Burgh de Rott'], ['Darkmeyer'], ['Meiyerditch'], ['Arceuus']],
  reach: [['Rellekka'], ['Neitiznot'], ['Jatizso'], ['Miscellania'], ['Etceteria'], ['Mountain Camp']],
  jungle: [['Brimhaven', 1], ['Shilo Village'], ['Tai Bwo Wannai'], ['Musa Point', 1], ['Jiggig']],
  wilds: [['Lovakengj'], ['Mor Ul Rek']]
};
let osrsMap = null, osrsMapS = 0, roleMap = null;
function charter() {   // pure in S: every client grants the same names and the same two charters
  if (osrsMapS === S && osrsMap) return;
  osrsMapS = S; osrsMap = new Map(); roleMap = new Map();
  const key = q => q.cx + ':' + q.cz, vs = [], used = new Set();
  for (let a = -16; a <= 16; a++) for (let b = -16; b <= 16; b++) {
    const q = siteInfo(a, b);
    if (q && Math.hypot(q.x, q.z) < 3800) vs.push(q);
  }
  vs.sort((p, q2) => (Math.hypot(p.x, p.z) - Math.hypot(q2.x, q2.z)) || (p.x - q2.x) || (p.z - q2.z));
  const grant = (q, n, role) => { used.add(n); osrsMap.set(key(q), n); roleMap.set(key(q), role); };
  const lum = homeVillage();   // where everyone wakes: Lumbridge, castle and bank guaranteed
  if (lum) grant(lum, 'Lumbridge', 1);
  const vr = vs.find(q => q.rank >= 3 && !roleMap.has(key(q))) || vs.find(q => q.rank >= 2 && !roleMap.has(key(q)));   // the nearest city: Varrock, and its Grand Exchange
  if (vr) grant(vr, 'Varrock', 2);
  const wet = q => { for (let i = 0; i < 8; i++) { const a2 = i / 8 * TAU, rr = q.r * 1.3; if (macroHeight(q.x + Math.cos(a2) * rr, q.z + Math.sin(a2) * rr) < SEA) return 1; } return 0; };
  for (const q of vs) {
    const pool = OSRS_NAMES[q.reg.k];
    if (!pool || osrsMap.has(key(q))) continue;
    let coastal = -1;
    for (const row of pool) {
      if (used.has(row[0])) continue;
      if (row[1]) { if (coastal < 0) coastal = wet(q); if (!coastal) continue; }
      used.add(row[0]); osrsMap.set(key(q), row[0]);
      break;
    }
  }
}
/* the spawn: the nearest settlement to the origin, unless a village or town stands within a short walk of it */
function homeVillage() {
  let best = null, bs = 1e9;
  for (let a = -7; a <= 7; a++) for (let b = -7; b <= 7; b++) {
    const q = siteInfo(a, b);
    if (!q) continue;
    const s = Math.hypot(q.x, q.z) - Math.min(q.rank, 2) * 140;
    if (s < bs) { bs = s; best = q; }
  }
  return best;
}
const osrsNameOf = v => { charter(); return osrsMap.get(v.cx + ':' + v.cz) || null; };
const charterRoleAt = s => { if (Math.hypot(s.x, s.z) >= 3800) return 0; charter(); return roleMap.get(s.cx + ':' + s.cz) || 0; };   // 1 Lumbridge, 2 Varrock
const charterRole = charterRoleAt;
function villageName(v) {
  if (v.name) return v.name;
  if (Math.hypot(v.x, v.z) < 3800) { const os = osrsNameOf(v); if (os) return v.name = os; }
  const h = hash2(v.x, v.z, S + 61);
  let form = NAME_FORMS[v.rank][(h >>> 24) & 7];
  if (form === 'Port X') {
    let wet = 0;
    for (let i = 0; i < 8 && !wet; i++) { const a = i / 8 * TAU, rr = v.r * 1.3; if (macroHeight(v.x + Math.cos(a) * rr, v.z + Math.sin(a) * rr) < SEA) wet = 1; }
    if (!wet) form = 'X';
  }
  return v.name = form.replace('X', wordOf(h, v.reg || regionAt(v.x, v.z).a));
}

/* ---- 2c. SITES: the unit of OSRS content is the named place with a fixed composition, not the per-tile coin flip.
   One lattice carries the mines, groves and waypoints; a finer one shoals the fishing. Pure in (cell, S). ---- */
const SITE_CELL = 56, siteCache = new Map();
const RUIN_CELL = 192, ruinCache = new Map();   // declared here: the welcome preview reaches siteAt before the runecraft block evals
const GUILDS = [   // chartered at rank >= 3, behind a level-60 door
  { k: 'mining', n: 'Mining Guild', sk: 'mining', rocks: [[3, 5], [4, 4], [5, 2]] },
  { k: 'wood', n: 'Woodcutting Guild', sk: 'woodcutting', trees: [[4, 5], [5, 2]] },
  { k: 'cook', n: 'Cooking Guild', sk: 'cooking', ranges: 2 }
];
/* mine archetypes: rows of [ORES index, rocks]; pw gates the tier, warm ground favours gold */
const MINE_T = [
  { n: 'Copper', r: [[0, 3], [1, 2]], pw: 0 }, { n: 'Tin', r: [[1, 3], [0, 2]], pw: 0 },
  { n: 'Iron', r: [[2, 4], [1, 1]], pw: 0.22 }, { n: 'Coal', r: [[3, 4], [2, 1]], pw: 0.55 },
  { n: 'Silver', r: [[7, 3], [2, 2]], pw: 0.8 }, { n: 'Gold', r: [[8, 3], [3, 1]], pw: 1.0, warm: 1 },
  { n: 'Mithril', r: [[4, 3], [3, 2]], pw: 1.35 }, { n: 'Adamant', r: [[5, 3], [4, 1], [3, 2]], pw: 1.95 },
  { n: 'Rune', r: [[6, 2], [5, 2]], pw: 2.7 }
];
/* groves: the only home of the rare woods — a yew is somewhere, not a lottery ticket */
const GROVE_T = [{ k: 1, pw: 0 }, { k: 2, pw: 0 }, { k: 3, pw: 0.5 }, { k: 6, pw: 1.0, warm: 1 }, { k: 4, pw: 1.0 }, { k: 5, pw: 1.9 }];
/* waypoints between towns: k picks the furniture, sp the tenants; shore kinds wait for the right ground.
   wild 1 = only in the wilderness (its broken places), wild 2 = at home on either side of the ditch */
const POI_T = [
  { k: 0, f: 'the X Stones', wild: 2 }, { k: 1, f: 'X Digs', res: [[0, 1], [1, 1]] }, { k: 2, f: "X's Rest", sp: ['monk'] },
  { k: 3, f: 'the X Wreck', shore: 1 }, { k: 4, f: 'X Cart' }, { k: 5, f: 'X Bones', sp: ['skeleton'], wild: 2 },
  { k: 6, f: 'X Farm', sp: ['chicken', 'chicken'] }, { k: 7, f: 'X Shack', shore: 1, fish: 1 },
  { k: 8, f: 'the X Circle', sp: ['darkwizard', 'darkwizard'], wild: 2 }, { k: 9, f: 'X Barrow', sp: ['ghost'], wild: 2 },
  { k: 10, f: 'X Watch', sp: ['guard'] }, { k: 11, f: 'X Camp', sp: ['bandit', 'bandit'], wild: 2 },
  { k: 12, f: 'the X Ruins', sp: ['skeleton'], wild: 1 }, { k: 13, f: 'the X Temple', sp: ['zamorakmonk', 'zamorakmonk'], wild: 1 },
  { k: 14, f: 'X Keep', sp: ['blackknight', 'blackknight'], wild: 1 }
];
function siteAt(gx, gz) {
  if (gz * SITE_CELL > 499000) return null;   // hoisted above the key: the band's null used to be cached under a key a real cell shares
  if (siteCache.S !== S) { siteCache.clear(); siteCache.S = S; }
  const key = gx * 8191 + gz;
  let s = siteCache.get(key);
  if (s !== undefined) return s;
  s = null;
  const h = hash2(gx * 3 + 5, gz * 5 + 1, S + 400), roll = h % 100;
  if (gz * SITE_CELL > 499000 || roll >= 62) { siteCache.set(key, s); return s; }
  const kind = roll < 9 ? 1 : roll < 19 ? 2 : 3;   // mine, grove, waypoint
  for (let i = 0; i < 8 && !s; i++) {
    const hh = hash2(gx * 31 + i, gz * 17 - i, S + 401 + i);
    const x = gx * SITE_CELL + 7 + hh % (SITE_CELL - 14), z = gz * SITE_CELL + 7 + (hh >>> 9) % (SITE_CELL - 14);
    const y = heightAt(x, z);
    let shore = 0;
    if (kind === 3 && y < 3.5) for (let d2 = 0; d2 < 8 && !shore; d2++) if (macroHeight(x + Math.cos(d2 / 8 * TAU) * 14, z + Math.sin(d2 / 8 * TAU) * 14) < SEA) shore = 1;   // beaches run ~13 tiles wide
    if (y < (shore ? 0.9 : 2.1) || y > (kind === 2 ? 42 : 58)) continue;
    const nv = nearVillage(x, z);
    if (nv && nv.d < nv.v.r * 1.45) continue;
    const RU = ruinAt(Math.floor(x / RUIN_CELL), Math.floor(z / RUIN_CELL));
    if (RU && chebDist(RU.x, RU.z, x, z) < 16) continue;
    if (highwayAt(x, z) > 0.15) continue;
    const lo2 = shore ? 0.4 : 1.8, sp = spanHeights(x, z, 4, 2, (px, pz, py) => py >= lo2);
    if (!sp || sp.hi - sp.lo > (kind === 1 ? 4.5 : shore ? 3.2 : 2.6)) continue;
    const A = regionAt(x, z).a, p = Math.max(0, powerAt(x, z)), res = new Map();
    const lean = (pool, u, bias) => pool[Math.min(pool.length - 1, Math.floor(Math.pow((u & 1023) / 1024, bias) * pool.length))];   // deep tiers favoured, every tier possible
    const spiral = (rows, neg, r0, rs) => {   // res values: ORES index + 1, or -(TREES kind + 1)
      let ri = 0, r = r0;
      for (const [rk, n] of rows) for (let q = 0; q < n; q++, ri++) {
        const a2 = ri * 2.4 + (h & 7); r = r0 + ri * rs;
        res.set(tk(Math.round(x + Math.sin(a2) * r), Math.round(z + Math.cos(a2) * r)), neg ? -(rk + 1) : rk + 1);
      }
      return r;
    };
    if (kind === 1) {
      const pool = MINE_T.filter(m => m.pw <= p && (!m.warm || A.wm > 0));
      if (!pool.length) break;
      const M = lean(pool, hh >>> 20, 0.55);
      s = { t: 1, x, z, y, r: spiral(M.r, 0, 1.4, 0.62) + 1, res, name: wordOf(h, A) + ' ' + M.n + ' Mine' };
    } else if (kind === 2) {
      const pool = GROVE_T.filter(g => g.pw <= p && (!g.warm || A.wm > 0) && (!A.pine || g.k <= 2));
      const G2 = lean(pool, hh >>> 20, 0.65);
      s = { t: 2, x, z, y, r: spiral([[G2.k, 5 + ((hh >>> 24) & 3)]], 1, 2.0, 0.85) + 1, res, gk: G2.k, name: wordOf(h, A) + ' ' + TREES[G2.k].n + ' Grove' };
    } else {
      const isW = wildLvAt(x, z) > 0;
      const pool = POI_T.filter(w => (!w.shore || shore) && (isW ? w.wild : w.wild !== 1)), W = pool[(hh >>> 20) % pool.length];
      s = { t: 3, k: W.k, x, z, y, r: 6, w: W, name: W.f.replace('X', wordOf(h, A)), sp: W.sp || null };
      if (W.res) { s.res = res; spiral(W.res, 0, 1.6, 1.1); }
      else s.res = null;
    }
  }
  siteCache.set(key, s);
  return s;
}
let _stx = 1e9, _stz = 1e9, _str = null;
function nearSite(x, z) {   // one-entry per-tile memo, like nearVillage
  const ix = Math.floor(x), iz = Math.floor(z);
  if (ix === _stx && iz === _stz) return _str;
  _stx = ix; _stz = iz;
  const gx = Math.floor(x / SITE_CELL), gz = Math.floor(z / SITE_CELL);
  let best = null, bd = 1e9;
  for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
    const s = siteAt(gx + a, gz + b);
    if (!s) continue;
    const d = Math.hypot(s.x - ix, s.z - iz);
    if (d < bd) { bd = d; best = s; }
  }
  return _str = best ? { s: best, d: bd } : null;
}
/* fishing shoals: clusters at the bank, never a lonely per-tile roll. Spots keep both coordinates even (the agility logs own odd-odd). */
const FISH_CELL = 48, fishCache = new Map();
function fishCellAt(gx, gz) {
  if (fishCache.S !== S) { fishCache.clear(); fishCache.S = S; }
  const key = gx * 8191 + gz;
  let c = fishCache.get(key);
  if (c !== undefined) return c;
  c = null;
  const h = hash2(gx * 7 + 3, gz * 11 + 7, S + 420);
  if (gz * FISH_CELL <= 499000 && h % 100 < 58) for (let i = 0; i < 10 && !c; i++) {
    const hh = hash2(gx * 13 + i, gz * 29 - i, S + 421 + i);
    const x = (gx * FISH_CELL + 4 + hh % (FISH_CELL - 8)) & ~1, z = (gz * FISH_CELL + 4 + (hh >>> 9) % (FISH_CELL - 8)) & ~1;
    if (macroHeight(x, z) >= SEA || wildLvAt(x, z)) continue;   // nothing shoals in lava
    let land = 0;
    for (const [dx, dz] of [[3, 0], [-3, 0], [0, 3], [0, -3]]) if (macroHeight(x + dx, z + dz) >= SEA) { land = 1; break; }
    if (!land) continue;
    const set = new Set([tk(x, z)]);
    for (let q = 1, n = 2 + ((hh >>> 24) & 3); q <= n; q++) {
      const qx = x + 2 * Math.round(Math.sin(q * 2.1 + (h & 7)) * q * 0.8), qz = z + 2 * Math.round(Math.cos(q * 2.1 + (h & 7)) * q * 0.8);
      if (macroHeight(qx, qz) < SEA) set.add(tk(qx, qz));
    }
    c = { x, z, set };
  }
  fishCache.set(key, c);
  return c;
}
const fishSpotAt = (x, z, key) => { const c = fishCellAt(Math.floor(x / FISH_CELL), Math.floor(z / FISH_CELL)); return c ? c.set.has(key) : false; };

/* ---- 2d. THE WILDERNESS: an infinite series of ragged rings round the origin. Ring i spans a quadratic layout
   S_i = 1400 + 1220i + 460i² of thickness 480 + 420i — each ring and each gap wider than the last — and two
   independent noise warps drag its inner and outer shores, so no boundary is a circle and the belt runs thick in one
   compass direction and thin in another, pinching clean through here and there. The level is the depth in from the
   nearest open ground, one level per 16 tiles, capped at 99: only the heart of a far ring reads high. PvP lives only
   here. Below ground the mirrored surface tile answers, so a cave under the wilds is wilderness too. Wire format. ---- */
let _wlx = 1e9, _wlz = 1e9, _wld = -999;
function wildD(x, z) {   // signed tiles into (+) or short of (−) the nearest band; every consumer derives from this one memo
  if (z > 500000) z -= 524288;   // the dungeon plane wears its surface's colours (DUN_Z, spelled out: it evals far below)
  const ix = Math.floor(x), iz = Math.floor(z);
  if (ix === _wlx && iz === _wlz) return _wld;
  _wlx = ix; _wlz = iz;
  const d = Math.hypot(ix, iz);
  if (d < 2310) return _wld = -999;   // the heartland never wilds: skip the noise entirely
  // each band is a MEANDERING RIVER of wilderness: a centreline dragged radially by slow noise, and a width of its
  // own that runs from a rare ~70-tile neck to an uncapped bulge (the S-curve keeps the band a TERRITORY — most of
  // its run is hundreds of tiles deep). Bands, their widths AND the calm safelands between them all grow with the
  // index; every ray from the origin still crosses every band, so the belts stay closed. Wire format.
  const m = fbm(ix * 0.00085, iz * 0.00085, S + 801, 3);   // where the band wanders
  const th = fbm(ix * 0.00052, iz * 0.00052, S + 802, 3);   // how fat it runs there
  const q = Math.floor(Math.max(0, (-2400 + Math.sqrt(5760000 + 2800 * (Math.max(d, 4200) - 4200))) / 1400));
  let best = -999;
  for (let i = Math.max(0, q - 1); i <= q + 1; i++) {
    const T = 700 + 500 * i, C = 4200 + 2400 * i + 700 * i * i, gap = 3100 + 1400 * i;
    const Rc = C + m * gap * 0.38;
    let H = 36 + T * 0.92 * Math.pow(smoothstep(-0.55, 0.45, th + 0.10 + Math.min(0.25, 0.035 * i)), 1.15);
    if (!i) H = Math.min(H, Rc - 2400);   // the first band never presses the heart below ~2400 tiles
    best = Math.max(best, H - Math.abs(d - Rc));
  }
  return _wld = best;
}
const wildLvAt = (x, z) => { const dp = wildD(x, z); return dp > 0 ? clamp(Math.ceil(dp / 26), 1, 99) : 0; };   // one level per 26 tiles: a level is a RUN, not a step
const wildBlend = (x, z) => clamp((wildD(x, z) + 40) / 80, 0, 1);   // the ash creeps in over ~40 tiles each side; the LAW changes at the middle
let _dtx = 1e9, _dtz = 1e9, _dtv = 99;
function ditchT(x, z) {   // distance from the law's line in TILES: the field's own slope normalises it, so the trench keeps one width everywhere
  if (z > 500000) return 99;
  const ix = Math.floor(x), iz = Math.floor(z);
  if (ix === _dtx && iz === _dtz) return _dtv;
  _dtx = ix; _dtz = iz;
  const wd = wildD(ix, iz);
  if (wd < -9 || wd > 9) return _dtv = 99;
  const gx2 = wildD(ix + 1, iz) - wildD(ix - 1, iz), gz2 = wildD(ix, iz + 1) - wildD(ix, iz - 1);
  return _dtv = Math.abs(wd) / Math.max(0.55, Math.hypot(gx2, gz2) / 2);
}
const onDitchBank = (x, z) => ditchT(x, z) < 3.6;   // trench + berms + a cleared step: no tree or stone interrupts the line
/* How deep a teleport still works (/w/Wilderness). Spells and ordinary trinkets stop at 20; a short exempt list —
   glory, ring of life, the defence and max capes among them — runs to 30. Without this the skull, the level gate and
   the death pile all lose their teeth, since an escape was always one click away at any depth. */
const TP_CAP = 20, TP_CAP_ITEM = 30;

/* ---- 3. PALETTE: colour per quad, light baked into the vertex ---- */
const PAL = {
  deep: [0.180, 0.243, 0.271], silt: [0.318, 0.353, 0.278], wet: [0.678, 0.639, 0.494], sand: [0.859, 0.796, 0.565],
  shing: [0.647, 0.616, 0.541], grass: [0.290, 0.478, 0.184], lush: [0.176, 0.396, 0.137], fern: [0.239, 0.443, 0.196],
  dry: [0.588, 0.596, 0.290], heath: [0.463, 0.427, 0.267], moss: [0.239, 0.353, 0.180], rock: [0.424, 0.404, 0.373],
  dark: [0.310, 0.294, 0.278], scree: [0.549, 0.522, 0.471], snow: [0.906, 0.929, 0.945], old: [0.741, 0.769, 0.784],
  dirt: [0.475, 0.396, 0.271], road: [0.545, 0.463, 0.322], cobble: [0.494, 0.482, 0.451], flag: [0.549, 0.537, 0.506],
  lawn: [0.302, 0.475, 0.216], swamp: [0.271, 0.345, 0.224], till: [0.443, 0.345, 0.220],
  wildG: [0.155, 0.135, 0.125], lavaDeep: [0.96, 0.42, 0.10], lavaEdge: [0.42, 0.13, 0.05],   // the wilderness wears ash; its waters burn
  wall: [0.298, 0.286, 0.267], roof: [0.404, 0.243, 0.196]   // only the maps ever see these: the 3D wall and roof meshes cover their own ground
};
const out = [0, 0, 0], mixOut = [0, 0, 0], _lav = [0, 0, 0];
function mix(a, b, t) {
  for (let i = 0; i < 3; i++) mixOut[i] = a[i] + (b[i] - a[i]) * t;
  return mixOut;
}
let _bx = 1e9, _bz = 1e9, _bm = 0, _bw = 0;   // moisture/warmth sampled once per tile
function biomeAt(x, z) {
  const ix = Math.floor(x), iz = Math.floor(z);
  if (ix !== _bx || iz !== _bz) { _bx = ix; _bz = iz; _bm = fbm(ix * 0.0037, iz * 0.0037, S + 31, 3); _bw = fbm(ix * 0.0024, iz * 0.0024, S + 53, 2); }
  return _bm;
}
/* farm strips round every settlement: 0, or 1/2 for row direction */
function fieldAt(x, z, n) {
  if (!n || n.d < n.v.r * 1.02 || n.d > n.v.r * 1.55) return 0;
  const h = hash2(Math.floor(x / 12), Math.floor(z / 12), S + 107);
  return (h & 7) < 3 ? 1 + (h >>> 3 & 1) : 0;
}
function colorAt(x, z, h, slope) {
  if (z > 500000) return dunColor(x, z, h, slope);
  const moist = biomeAt(x, z), warm = _bw - h * 0.010;
  let c;
  if (h < -4)        c = PAL.deep;
  else if (h < -0.3) c = mix(PAL.silt, PAL.deep, smoothstep(-0.3, -4, h));
  else if (h < 0.5)  c = PAL.wet;
  else if (h < 1.9)  c = slope > 1.2 ? PAL.shing : PAL.sand;
  else if (h > 74)   c = PAL.snow;
  else if (h > 62)   c = slope > 1.4 ? PAL.old : mix(PAL.scree, PAL.snow, smoothstep(62, 74, h));
  else if (h > 46)   c = slope > 1.5 ? PAL.dark : PAL.rock;
  else if (h > 32)   c = slope > 1.2 ? PAL.scree : PAL.moss;
  else if (slope > 1.9) c = PAL.dark;
  else if (slope > 1.2) c = mix(PAL.rock, PAL.moss, 0.45);
  else if (moist > 0.34 && h < 7) c = mix(PAL.swamp, PAL.silt, 0.3);
  else if (moist > 0.22)  c = PAL.lush;
  else if (moist > 0.05)  c = PAL.fern;
  else if (warm > 0.26)   c = PAL.dry;
  else if (warm > 0.12)   c = PAL.heath;
  else               c = PAL.grass;
  if (h > 1.9 && h < 46 && slope < 1.9) {   // the kingdom's own paint, blended only at the border
    const rg = regionAt(x, z);
    if (rg.vs > 0.02) c = mix(c, rg.veg, rg.vs);
  }
  const wb = wildBlend(x, z), wl = wb > 0.5 ? wildLvAt(x, z) : 0;
  if (wb > 0.002) {   // the wilderness creeps in: ash over the grass, lava bleeding into the water
    if (h < SEA + 0.2) { const lt = smoothstep(0.2, -2.5, h); for (let q2 = 0; q2 < 3; q2++) _lav[q2] = PAL.lavaEdge[q2] + (PAL.lavaDeep[q2] - PAL.lavaEdge[q2]) * lt; c = mix(c, _lav, wb); }
    else c = mix(c, PAL.wildG, (0.78 + Math.min(0.14, wl * 0.0015)) * wb);
  }
  const cell = h > 1.2 ? cityCell(x, z) : 0;   // the town's own plan, then the highways
  if (cell === G_ROAD) c = PAL.road;
  else if (cell === G_PAVED || cell === G_GATE || cell === G_GE) c = PAL.cobble;
  else if (cell === G_KEEP) c = PAL.flag;
  else if (cell === G_PARK) c = PAL.lawn;
  else if (cell === G_WALL) c = PAL.wall;   // the curtain wall draws the town's outline on the map
  else if (cell === G_BUILD) c = PAL.roof;
  else {
    const n = nearVillage(x, z);
    if (n && n.d < n.v.r * 0.95 && h > 1.4) c = mix(c, PAL.dirt, 0.14);   // a flat trodden tone, not a dirt bowl: the streets carry the shape
    else if (h > 1.9 && h < 26 && slope < 0.7) {
      const f = fieldAt(x, z, n);
      if (f) c = mix(c, (f === 1 ? Math.floor(z) : Math.floor(x)) & 1 ? PAL.till : PAL.dry, 0.55);
    }
    if (!wl && h > 1.6 && slope < 1.5 && highwayAt(x, z) > 0.42) c = PAL.road;   // roads rasterise hard: crown or nothing; none cross the wilds
    if (h > 1.7 && h < 46) {   // a working mine bares its ground
      const st = nearSite(x, z);
      if (st && st.s.t === 1 && st.d < st.s.r + 1.5) c = mix(c, PAL.dirt, 0.5);
    }
  }
  const j = 0.97 + (hash2(Math.round(x * 2), Math.round(z * 2), S + 77) & 255) / 255 * 0.06;   // per-quad jitter, faint: 2007 tiles are flat colour
  out[0] = c[0] * j; out[1] = c[1] * j; out[2] = c[2] * j;
  return out;
}
function biomeName(h, x, z) {
  if (inDunPlane(z)) { const d = dunFor(x, z); return d ? d.name : 'the deep dark'; }
  const wl0 = wildLvAt(x, z);
  if (wl0) return h < -0.3 ? 'a lake of lava, the Wilderness' : 'the Wilderness, level ' + wl0;
  if (h < -0.3) return 'open water';
  if (h > 74) return 'snowline';
  if (h > 46) return 'crag';
  const n = nearVillage(x, z);
  if (n && n.d < n.v.r) return villageName(n.v);
  if (n && n.v.guild && chebDist(x, z, n.v.guild.x, n.v.guild.z) <= n.v.guild.R + 2) return n.v.guild.name;
  const R2 = regionName(regionAt(x, z).s), st = nearSite(x, z);
  if (st && st.d < st.s.r + 5) return st.s.name + ', ' + R2;
  if (h < 1.9) return 'shore, ' + R2;
  if (h > 32) return 'highland, ' + R2;
  return (biomeAt(x, z) > 0.05 ? 'woodland, ' : 'plains, ') + R2;
}

/* ---- 4. PROGRESSION: the 2007 xp curve, exactly; 99 = 13,034,431 xp ---- */
const MAXL = 99;
const XP_TABLE = new Float64Array(MAXL + 2);
for (let L = 2, s = 0; L <= MAXL + 1; L++) { s += Math.floor((L - 1) + 300 * Math.pow(2, (L - 1) / 7)); XP_TABLE[L] = Math.floor(s / 4); }
const XP_RATE = 1;   // the 2007 rates, exactly
const levelFor = x => { let L = 1; while (L < MAXL && x >= XP_TABLE[L + 1]) L++; return L; };
/* 28 slots: 24 named, 4 reserved */
const SKILLS = [
  ['attack', 'Attack', 'sword'], ['strength', 'Strength', 'fist'], ['defence', 'Defence', 'shield'], ['ranged', 'Ranged', 'arrow'],
  ['prayer', 'Prayer', 'star'], ['magic', 'Magic', 'rune'], ['runecraft', 'Runecrft', 'rune', 'Runecraft'], ['construction', 'Constr', 'hammer', 'Construction'],
  ['hitpoints', 'Hitpts', 'heart', 'Hitpoints'], ['agility', 'Agility', 'boot'], ['herblore', 'Herblore', 'leaf'], ['thieving', 'Thieving', 'coins'],
  ['crafting', 'Crafting', 'ring'], ['fletching', 'Fletching', 'arrow'], ['slayer', 'Slayer', 'skull'], ['hunter', 'Hunter', 'net'],
  ['mining', 'Mining', 'pick'], ['smithing', 'Smithing', 'hammer'], ['fishing', 'Fishing', 'fish'], ['cooking', 'Cooking', 'cfish'],
  ['firemaking', 'Firemkg', 'flame', 'Firemaking'], ['woodcutting', 'Woodcut', 'axe', 'Woodcutting'], ['farming', 'Farming', 'leaf'], ['sailing', 'Sailing', 'anchor'],
  ['r25', '—', 'lock'], ['r26', '—', 'lock'], ['r27', '—', 'lock'], ['r28', '—', 'lock']
].map(([k, n, g, f]) => ({ k, n, g, f: f || n, locked: n === '—' ? 1 : 0 }));
const NSK = 28;
const SK = Object.create(null);
SKILLS.forEach((s, i) => SK[s.k] = i);
const xp = new Float64Array(NSK), lvl = new Uint8Array(NSK);
const bst = new Int8Array(NSK);   // potion boosts and drains; each steps one point toward 0 a minute
const eff = k => lvl[SK[k]] + bst[SK[k]];
const skName = i => SKILLS[i].f;
function resetSkills() {
  xp.fill(0); lvl.fill(1);
  xp[SK.hitpoints] = XP_TABLE[10]; lvl[SK.hitpoints] = 10;
}
function gainXp(k, amount) {
  const i = SK[k], a = amount * XP_RATE;
  xp[i] += a;
  xpDrop(i, a);
  if (i !== 0 && i !== 1 && i !== 2 && i !== 3 && i !== 4 && i !== 5 && i !== 8 && Math.random() < devRandMul / 4000) spawnGenie();   // honest work draws the lamp

  let leveled = 0;
  while (lvl[i] < MAXL && xp[i] >= XP_TABLE[lvl[i] + 1]) { lvl[i]++; leveled = 1; }
  if (leveled) {
    say('Congratulations, you just advanced a ' + skName(i) + ' level.', 'lv');
    say('Your ' + skName(i) + ' level is now ' + lvl[i] + '.', 'lv');
    if (i === SK.hitpoints) { P.hp += lvl[i] - P.maxhp; P.maxhp = lvl[i]; }   // a level heals only the point it grants
    if (i < 6 || i === SK.hitpoints) sendEquip();   // defence for the room's rolls, and every skill the combat level is made of   // the room rolls against it
    dirty.orb = 1;
    markDirty();   // levels re-derive from the xp array in the same blob: a routine save suffices
  }
  dirty.sk = 1;
}
function totalLevel() { let t = 0; for (let i = 0; i < NSK; i++) if (!SKILLS[i].locked) t += lvl[i]; return t; }
function combatLevel() {
  const base = 0.25 * (lvl[SK.defence] + lvl[SK.hitpoints] + Math.floor(lvl[SK.prayer] / 2));
  const melee = 0.325 * (lvl[SK.attack] + lvl[SK.strength]);
  const range = 0.325 * Math.floor(lvl[SK.ranged] * 1.5), mage = 0.325 * Math.floor(lvl[SK.magic] * 1.5);
  return Math.floor(base + Math.max(melee, range, mage)) || 3;
}

/* ---- 5. ITEMS: tier x piece generates the armoury; every other item is one line ---- */
const TIERS = [
  { k: 'bronze',  n: 'Bronze',  req: 1,  tool: 1,  mine: 1,  c: '#a9713b', c2: '#6e4520', m: 1 },
  { k: 'iron',    n: 'Iron',    req: 1,  tool: 1,  mine: 15, c: '#75767a', c2: '#4a4b4f', m: 2 },
  { k: 'steel',   n: 'Steel',   req: 5,  tool: 6,  mine: 30, c: '#c3c8d0', c2: '#828892', m: 3 },
  { k: 'black',   n: 'Black',   req: 10, tool: 11, mine: 99, c: '#36383f', c2: '#1d1e23', m: 4 },
  { k: 'mithril', n: 'Mithril', req: 20, tool: 21, mine: 55, c: '#5c63b8', c2: '#373d84', m: 5 },
  { k: 'adamant', n: 'Adamant', req: 30, tool: 31, mine: 70, c: '#4e7d52', c2: '#2d5232', m: 6 },
  { k: 'rune',    n: 'Rune',    req: 40, tool: 41, mine: 85, c: '#3ab6c4', c2: '#1f7d89', m: 7 },
  // appended, never inserted: t.i feeds the drop ladder (caps at rune). White is armour-only; dragon is drops/exchange only.
  { k: 'white',  n: 'White',  req: 10, tool: 999, mine: 999, c: '#d9dde3', c2: '#9aa3ad', m: 4, armourOnly: 1 },
  { k: 'dragon', n: 'Dragon', req: 60, tool: 61,  mine: 999, c: '#a02c1e', c2: '#6b1a10', m: 8 }
];
const TIER = Object.create(null); TIERS.forEach((t, i) => { t.i = i; TIER[t.k] = t; });
/* [key, name, glyph, slot, atk, str, def, extras]; extras: spd, two, reach, stab, tool, gate. The a/s/d columns only price the
   piece and scale the few invented ladders (tools, boots, gauntlets) — real combat numbers come from WV/AV below. */
const PIECES = [
  ['hatchet', 'hatchet', 'axe', 'weapon', 4, 5, 0, { tool: 'woodcutting' }], ['pickaxe', 'pickaxe', 'pick', 'weapon', 3, 4, 0, { tool: 'mining' }],
  ['dagger', 'dagger', 'dagger', 'weapon', 5, 4, 0, { spd: 4, stab: 1 }], ['sword', 'sword', 'sword', 'weapon', 7, 6, 1, { spd: 4, stab: 1 }],
  ['scimitar', 'scimitar', 'scim', 'weapon', 9, 8, 0, { spd: 4 }], ['longsword', 'longsword', 'lsword', 'weapon', 10, 8, 1],
  ['mace', 'mace', 'mace', 'weapon', 6, 8, 1, { spd: 4 }], ['battleaxe', 'battleaxe', 'baxe', 'weapon', 8, 9, 0, { spd: 6 }],
  ['warhammer', 'warhammer', 'wham', 'weapon', 8, 10, 0, { spd: 6 }], ['claws', 'claws', 'claws', 'weapon', 8, 7, 1, { spd: 4, two: 1 }],
  ['2h_sword', '2h sword', 'sword2h', 'weapon', 12, 13, 0, { spd: 7, two: 1 }], ['halberd', 'halberd', 'halberd', 'weapon', 11, 12, 0, { spd: 7, two: 1, reach: 2, stab: 1 }],
  ['spear', 'spear', 'spear', 'weapon', 8, 7, 0, { spd: 4, two: 1, stab: 1 }], ['hasta', 'hasta', 'spear', 'weapon', 7, 7, 0, { spd: 4, stab: 1 }],
  ['med_helm', 'med helm', 'helm', 'head', 0, 0, 4], ['full_helm', 'full helm', 'fhelm', 'head', 0, 0, 6],
  ['platebody', 'platebody', 'body', 'body', 0, 0, 9], ['chainbody', 'chainbody', 'chain', 'body', 0, 0, 7],
  ['platelegs', 'platelegs', 'legs', 'legs', 0, 0, 7], ['plateskirt', 'plateskirt', 'skirt', 'legs', 0, 0, 7],
  ['kiteshield', 'kiteshield', 'shield', 'shield', 0, 0, 8], ['sq_shield', 'sq shield', 'sqshield', 'shield', 0, 0, 6],
  ['defender', 'defender', 'defender', 'shield', 3, 2, 3], ['boots', 'boots', 'boot', 'feet', 0, 0, 2], ['gauntlets', 'gauntlets', 'glove', 'hands', 0, 0, 2]
].map(([k, n, g, slot, a, s, d, x]) => Object.assign({ k, n, g, slot, a, s, d }, x));
/* the wiki's own ladder, indexed by tier (bronze iron steel black mithril adamant rune white dragon).
   WV: [attack, strength] per weapon class — the single attack scalar is the class's best style's bonus.
   AV: armour defence — the rounded mean of the wiki's stab/slash/crush. Tools, boots and gauntlets stay formula-scaled. */
const WV = {
  hatchet: [[4, 5, 8, 10, 12, 17, 26, , 38], [5, 7, 9, 12, 13, 19, 29, , 42]], pickaxe: [[4, 5, 8, 10, 12, 17, 26, , 38], [5, 7, 9, 11, 13, 19, 29, , 42]],
  dagger: [[4, 5, 8, 10, 11, 15, 25, , 40], [3, 4, 7, 7, 10, 14, 24, , 40]],
  sword: [[4, 6, 11, 14, 16, 23, 38, , 65], [5, 7, 12, 12, 17, 24, 39, , 63]],
  scimitar: [[7, 10, 15, 19, 21, 29, 45, , 67], [6, 9, 14, 14, 20, 28, 44, , 66]],
  longsword: [[5, 8, 14, 18, 20, 29, 47, , 69], [7, 10, 16, 16, 22, 31, 49, , 71]],
  mace: [[6, 9, 13, 16, 18, 25, 39, , 60], [5, 7, 11, 13, 16, 23, 36, , 55]],
  battleaxe: [[6, 8, 16, 20, 22, 31, 48, , 70], [9, 13, 20, 24, 29, 41, 64, , 85]],
  warhammer: [[10, 11, 18, 22, 25, 35, 53, , 95], [8, 11, 18, 22, 27, 39, 62, , 85]],
  claws: [[4, 6, 11, 14, 16, 23, 38, , 57], [5, 7, 12, 14, 17, 24, 39, , 56]],
  '2h_sword': [[9, 13, 21, 27, 30, 43, 69, , 92], [10, 14, 22, 26, 31, 44, 70, , 93]],
  halberd: [[8, 12, 19, 25, 28, 41, 67, , 95], [8, 12, 20, 20, 29, 42, 68, , 89]],
  spear: [[5, 8, 12, 15, 17, 24, 36, , 55], [6, 10, 12, 16, 18, 28, 42, , 60]],
  hasta: [[5, 8, 12, , 17, 24, 36, , 55], [6, 10, 12, , 18, 28, 42, , 60]],
  defender: [[3, 5, 7, 9, 10, 13, 20, , 25], [0, 0, 1, 2, 3, 4, 5, , 6]]
};
const AV = {
  med_helm: [3, 4, 7, 9, 10, 14, 22, 9, 33], full_helm: [4, 6, 9, 12, 13, 19, 30, 12, 45],
  platebody: [13, 18, 29, 37, 43, 61, 78, 37, 104], chainbody: [10, 15, 24, 31, 34, 49, 71, 31, 91],
  platelegs: [7, 10, 16, 20, 22, 31, 49, 20, 66], plateskirt: [7, 10, 16, 20, 22, 31, 49, 20, 66],
  kiteshield: [6, 9, 14, 18, 20, 29, 46, 18, 58], sq_shield: [5, 8, 12, 15, 17, 24, 38, 15, 50],
  defender: [2, 4, 6, 8, 9, 12, 19, , 24]
};

const ITEMS = Object.create(null);
const defItem = o => ITEMS[o.id] = o;
/* wearable with zeroed bonuses and an empty requirement unless given */
const defWear = o => defItem(Object.assign({ equip: 1, atk: 0, str: 0, def: 0, req: {} }, o));
/* compact wearable row: W(id, name|0 derive from id, glyph, 'c.c2'|0 (0 = TINT07 paints it at load), slot, val, req?|0, rest?).
   req stays a literal object — its key order decides which requirement speaks first. */
const nameOf = id => { const s = id.replace(/_/g, ' '); return s[0].toUpperCase() + s.slice(1); };
const W = (id, nm, g, cc, slot, val, req, x) => {
  const o = Object.assign({ id, name: nm || nameOf(id), g, slot, val, req: req || {} }, x);
  if (cc) { const i = cc.indexOf('.', 1); o.c = cc.slice(0, i); o.c2 = cc.slice(i + 1); }
  defWear(o);
};
const armSeg = s => { for (const r of ARM[s]) W(...r); };   // rows live in data07.js, in ITEMS insertion order

for (const t of TIERS) for (const p of PIECES) {
  if (t.k === 'black' && (p.k === 'pickaxe' || p.k === 'hasta')) continue;   // neither exists in 2007
  if (t.armourOnly && (p.slot === 'weapon' || p.k === 'defender')) continue;
  if (t.k === 'bronze' && p.k === 'boots') continue;   // boots start at iron
  const w = WV[p.k], av = AV[p.k];
  defItem({
    id: t.k + '_' + p.k, name: t.n + ' ' + p.n, g: p.g, c: t.c, c2: t.c2, slot: p.slot, tier: t.i, spd: p.spd || 5, equip: 1,
    two: p.two || 0, reach: p.reach || 0, stab: p.stab || 0, tool: p.tool || null,
    atk: w ? w[0][t.i] || 0 : p.a * t.m, str: w ? w[1][t.i] || 0 : p.s * t.m, def: av ? av[t.i] || 0 : p.d * t.m,
    req: p.tool ? { [p.tool]: t.tool, attack: t.req } : p.slot === 'weapon' ? (p.k === 'halberd' ? { attack: t.req, strength: Math.max(1, t.req >> 1) } : { [t.k === 'dragon' && p.k === 'warhammer' ? 'strength' : 'attack']: t.req }) : { defence: t.req },   // only the dragon warhammer asks strength; halberds ask half again in strength
    val: Math.round((p.a + p.s + p.d * 1.6 + 6) * t.m * t.m * 1.2)   // price climbs with the square of the tier
  });
}
/* a bow buys accuracy and reach, an arrow buys damage */
const BOWS = [
  { k: '', n: '', lv: 1, ra: 8, c: '#8a6438', c2: '#5b4123' }, { k: 'oak_', n: 'Oak ', lv: 5, ra: 14, c: '#7d6030', c2: '#4e3c1d' },
  { k: 'willow_', n: 'Willow ', lv: 20, ra: 20, c: '#6f8f3a', c2: '#465a24' }, { k: 'maple_', n: 'Maple ', lv: 30, ra: 29, c: '#a8632a', c2: '#6b3e1a' },
  { k: 'yew_', n: 'Yew ', lv: 40, ra: 47, c: '#2f5a3c', c2: '#1c3824' }, { k: 'magic_', n: 'Magic ', lv: 50, ra: 69, c: '#6f6fc8', c2: '#43439b' }
];
/* the wiki gives both forms one accuracy: a longbow buys reach, not aim */
const BOWFORM = [{ k: 'shortbow', n: 'shortbow', spd: 4, rng: 7, m: 1.00 }, { k: 'longbow', n: 'longbow', spd: 6, rng: 9, m: 1.00 }];
for (const b of BOWS) for (const f of BOWFORM) defWear({
  id: b.k + f.k, name: b.n ? b.n + f.n : cap(f.n), g: 'bow', c: b.c, c2: b.c2, slot: 'weapon', bow: 1, two: 1, spd: f.spd, rng: f.rng,
  rat: Math.round(b.ra * f.m), req: { ranged: b.lv }, val: Math.round(30 + b.ra * b.ra * 0.55 * f.m)
});
/* crossbows: one hand, bolts only; the 2007 levels and the slow six-tick cadence */
const XBOWS = [['bronze', 18, 1], ['iron', 42, 26], ['steel', 54, 31], ['mithril', 66, 36], ['adamant', 78, 46], ['rune', 90, 61], ['dragon', 94, 64]]
  .map(([k, ra, lv]) => ({ k, ra, lv }));
for (const b of XBOWS) { const t = TIER[b.k]; defWear({ id: b.k + '_crossbow', name: t.n + ' crossbow', g: 'cbow', c: t.c, c2: t.c2, slot: 'weapon', bow: 1,
  ammoT: 'bolt', spd: 6, rng: 7, rat: b.ra, req: { ranged: b.lv }, val: Math.round(40 + b.ra * b.ra * 0.5) }); }
/* ammunition carries the strength and stacks */
const ARROWS = [['bronze', 1, 7], ['iron', 1, 10], ['steel', 5, 16], ['mithril', 20, 22], ['adamant', 30, 31], ['rune', 40, 49],
  ['amethyst', 50, 55, 'Amethyst', '#9a6fc4', '#5f4380'], ['dragon', 60, 60]].map(([k, lv, rs, n, c, c2]) => ({ k, lv, rs, n, c, c2 }));
const BOLTS = [['bronze', 1, 10], ['iron', 26, 46], ['steel', 31, 64], ['mithril', 36, 82], ['adamant', 46, 100], ['rune', 61, 115], ['dragon', 64, 122]]
  .map(([k, lv, rs]) => ({ k, lv, rs }));
const defAmmo = (a, suffix, g, aT, pm) => { const t = TIER[a.k]; defWear({ id: a.k + suffix, name: (a.n || t.n) + (aT ? ' bolts' : ' arrow'), g,
  c: a.c || t.c, c2: a.c2 || t.c2, slot: 'ammo', stack: 1, ammo: 1, aT, rst: a.rs, rat: 0, req: { ranged: a.lv }, val: Math.max(1, Math.round(a.rs * pm)) }); };   // wiki: arrows and bolts buy strength only, never accuracy
for (const a of ARROWS) defAmmo(a, '_arrow', 'arrow', undefined, 0.9);
for (const a of BOLTS) defAmmo(a, '_bolts', 'bolt', 'bolt', 1.1);
/* diamond-tipped adamant bolts, enchanted: drop-only — no enchant-bolt spell exists here, and ENCH stays jewellery-only */
W('diamond_bolts_e', 'Diamond bolts (e)', 'bolt', 0, 'ammo', 800, { ranged: 46 }, { stack: 1, ammo: 1, aT: 'bolt', rst: 105, rat: 0 });
/* thrown weapons: ammunition that is its own launcher (bow: 1 so the ranged code reads its speed and range); knives and darts come off the anvil,
   axes and javelins from the archery shop, chinchompas from box traps. [kind, glyph, speed, range, strength per metal: bronze iron steel black mithril adamant rune dragon] */
const THROWN = [['knife', 'knife', 3, 4, [3, 4, 7, 8, 10, 14, 24, 28]], ['dart', 'dart', 3, 3, [1, 3, 4, 6, 7, 10, 14, 20]], ['thrownaxe', 'axe', 5, 4, [5, 7, 11, 0, 16, 23, 36, 44]],
  ['javelin', 'spear', 6, 5, [6, 10, 12, 0, 18, 28, 42, 60]]].map(([k, g, spd, rng, rs]) => ({ k, g, spd, rng, rs }));
const THROWN_T = TIERS.filter(t => !t.armourOnly);
const defThrown = (id, name, g, c, c2, lv, rs, x) => defWear(Object.assign({ id, name, g, c, c2, slot: 'ammo', stack: 1, ammo: 1, thrown: 1, bow: 1, rat: 2 + rs, rst: rs, req: { ranged: lv }, val: Math.max(2, rs * 2) }, x));
THROWN_T.forEach((t, i) => { for (const th of THROWN) if (th.rs[i]) defThrown(t.k + '_' + th.k, t.n + ' ' + th.k, th.g, t.c, t.c2, t.req, th.rs[i], { spd: th.spd, rng: th.rng }); });
defThrown('chinchompa', 'Chinchompa', 'fur', '#9a8a70', '#5a4a3a', 45, 40, { spd: 4, rng: 9, val: 900 }); defThrown('red_chinchompa', 'Red chinchompa', 'fur', '#c04a3a', '#7a2a1e', 55, 55, { spd: 4, rng: 9, val: 1400 });
const DARTS = THROWN_T.map((t, i) => ({ k: t.k, rs: THROWN[1].rs[i] }));
/* unfinished ammunition: the anvil turns a bar into tips, bolt blanks or dart tips, fletching finishes them */
for (const [L, s, n, g] of [[ARROWS, '_arrowtips', ' arrowtips', 'arrow'], [BOLTS, '_bolts_u', ' bolts (unf)', 'bolt'], [DARTS, '_dart_tips', ' dart tips', 'dart']])
  for (const a of L) { const t = TIER[a.k]; if (t) defItem({ id: a.k + s, name: t.n + n, g, c: t.c, c2: t.c2, stack: 1, val: Math.max(1, a.rs >> 1) }); }
/* hide: light armour with the wiki's own defence means and ranged bonuses per piece, st: [coif d/rat, body d/rat, chaps d/rat, vamb d/rat];
   the coifs are this game's invention (2007 has none above leather) and scale off the body */
const HIDES = [
  { k: 'leather', n: 'Leather', lv: 1, df: 1, c: '#8a6438', c2: '#5b4123', st: [6, 2, 9, 2, 2, 4, 2, 4] },
  { k: 'studded', n: 'Studded', lv: 20, df: 20, c: '#6f4a28', c2: '#452c16', st: [8, 3, 22, 8, 16, 6, 3, 5] },
  { k: 'green_dhide', n: "Green d'hide", lv: 40, df: 40, c: '#4a7a3a', c2: '#2c4d22', st: [8, 4, 23, 15, 15, 8, 2, 8] },
  { k: 'blue_dhide', n: "Blue d'hide", lv: 50, df: 40, c: '#3a5f8a', c2: '#223a55', st: [9, 5, 28, 20, 16, 11, 3, 9] },
  { k: 'red_dhide', n: "Red d'hide", lv: 60, df: 40, c: '#8a3a2a', c2: '#552218', st: [10, 6, 32, 25, 18, 14, 4, 10] },
  { k: 'black_dhide', n: "Black d'hide", lv: 70, df: 40, c: '#2e2c30', c2: '#18171a', st: [11, 7, 38, 30, 21, 17, 5, 11] }
];
const HIDEPIECE = [{ k: 'coif', n: 'coif', g: 'hat', slot: 'head' }, { k: 'body', n: 'body', g: 'robe', slot: 'body' },
  { k: 'chaps', n: 'chaps', g: 'legs', slot: 'legs' }, { k: 'vambraces', n: 'vambraces', g: 'glove', slot: 'hands' }];
HIDES.forEach(h => HIDEPIECE.forEach((q, qi) => defWear({
  id: h.k + '_' + q.k, name: h.n + ' ' + q.n, g: q.g, c: h.c, c2: h.c2, slot: q.slot, def: h.st[qi * 2], rat: h.st[qi * 2 + 1],
  req: q.slot === 'body' ? { ranged: h.lv, defence: h.df } : { ranged: h.lv },   // wiki: only the body wears a Defence gate
  val: Math.round((h.st[qi * 2] + h.st[qi * 2 + 1] * 1.4 + 6) * (1 + h.st[3] * 0.22))
})));

/* trees: level, xp, firemaking xp, respawn ticks, canopy tint, scale */
const TREES = [
  ['tree', 'Tree', 1, 25, 40, 25, 0x3f7a34, 1.00, 'logs'], ['oak', 'Oak', 15, 37.5, 60, 30, 0x4e7a2b, 1.18, 'oak_logs'],
  ['willow', 'Willow', 30, 67.5, 90, 40, 0x6f8f3a, 1.10, 'willow_logs'], ['maple', 'Maple', 45, 100, 135, 55, 0xa8632a, 1.22, 'maple_logs'],
  ['yew', 'Yew', 60, 175, 202.5, 90, 0x2f5a3c, 1.34, 'yew_logs'], ['magic', 'Magic tree', 75, 250, 303.8, 140, 0x6f6fc8, 1.28, 'magic_logs'],
  ['mahogany', 'Mahogany', 50, 125, 157.5, 70, 0x8a3a2a, 1.26, 'mahogany_logs']   // appended, never inserted: tree kinds are part of the deterministic world
].map(([k, n, lv, xp, fire, rs, tint, sc, log], i) => {
  defItem({ id: log, name: k === 'tree' ? 'Logs' : cap(k) + ' logs', g: 'log', c: '#8a6438', c2: '#5b4123', stack: 1, fire, fireLv: lv, val: 8 + i * 30 });
  return { k, n, lv, xp, fire, rs, tint, sc, log, i, n7: /tree$/i.test(n) ? n : n + ' tree' };   // n7: the 2007 loc pack's name for this species
});
/* rocks: the ore colour is the vein tint and the icon colour. Prices are authored so the chain climbs:
   tin matches copper, coal sits under iron, and the value of everything downstream derives from these. */
const ORES = [
  ['copper', 'Copper rock', 1, 17.5, 12, '#b2632a', '#7a3f18', 'copper_ore', , 10], ['tin', 'Tin rock', 1, 17.5, 12, '#9aa0a8', '#65696f', 'tin_ore', , 10],
  ['iron', 'Iron rock', 15, 35, 16, '#8a5238', '#5b3423', 'iron_ore', , 60], ['coal', 'Coal rock', 30, 50, 30, '#33333a', '#17171b', 'coal', 'Coal', 45],
  ['mithril', 'Mithril rock', 55, 80, 90, '#5c63b8', '#373d84', 'mithril_ore', , 190], ['adamantite', 'Adamantite rock', 70, 95, 140, '#4e7d52', '#2d5232', 'adamantite_ore', , 330],
  ['runite', 'Runite rock', 85, 125, 250, '#3ab6c4', '#1f7d89', 'runite_ore', , 560],
  // appended: oreKind's thresholds index this table
  ['silver', 'Silver rock', 20, 40, 100, '#c8ccd4', '#80848c', 'silver_ore', 'Silver ore', 60], ['gold', 'Gold rock', 40, 65, 100, '#e0b436', '#9a7414', 'gold_ore', 'Gold ore', 150],
  ['essence', 'Rune essence', 1, 5, 0, '#d8d8e8', '#8a8a9a', 'rune_essence', 'Rune essence', 4]
].map(([k, n, lv, xp, rs, c, c2, ore, name, val], i) => {
  defItem({ id: ore, name: name || cap(k) + ' ore', g: 'ore', c, c2, stack: 1, val: val || 10 + i * 45 });
  return { k, n, lv, xp, rs, tint: k === 'coal' ? 0x2b2b30 : parseInt(c.slice(1), 16), ore, i,
    n7: k === 'essence' ? 'Rune essence rock' : k === 'adamantite' ? 'Adamantite rocks' : n };   // the cache's own spellings
});
/* smelting: the 2007 ladder, coal-hungry at the top. A bar is worth its ores plus a fifteenth — smelting adds value now
   instead of destroying a third of it. */
const BARS = [
  ['bronze', 1, 6.2, [['copper_ore', 1], ['tin_ore', 1]]], ['iron', 15, 12.5, [['iron_ore', 1]]], ['steel', 30, 17.5, [['iron_ore', 1], ['coal', 2]]],
  ['mithril', 50, 30, [['mithril_ore', 1], ['coal', 4]]], ['adamant', 70, 37.5, [['adamantite_ore', 1], ['coal', 6]]], ['rune', 85, 50, [['runite_ore', 1], ['coal', 8]]],
  ['silver', 20, 13.7, [['silver_ore', 1]], { n: 'Silver', c: '#c8ccd4', c2: '#80848c' }], ['gold', 40, 22.5, [['gold_ore', 1]], { n: 'Gold', c: '#e0b436', c2: '#9a7414' }]
].map(([t, lv, xp, need, T]) => {
  T = T || TIER[t];
  const id = t + '_bar';
  defItem({ id, name: T.n + ' bar', g: 'bar', c: T.c, c2: T.c2, stack: 1, val: Math.round(need.reduce((s, [o, n2]) => s + ITEMS[o].val * n2, 0) * 1.15) });
  return { id, n: T.n + ' bar', lv, xp, need, t };
});
/* the armoury re-priced off the metal chain: a piece is worth its bars plus two thirds again, so high alchemy (0.6x)
   roughly refunds the metal from steel up — the classic smith-and-alch loop — while the shop spread (buy 1.15x,
   sell 0.42x) keeps buy-to-alch and smith-to-shop-sell both losing. Black, white and dragon keep their prestige pricing. */
const PBARS = { hatchet: 1, pickaxe: 2, dagger: 1, sword: 1, scimitar: 2, longsword: 2, mace: 1, battleaxe: 3, warhammer: 3, claws: 2, '2h_sword': 3, halberd: 3,
  spear: 1, hasta: 1, med_helm: 1, full_helm: 2, platebody: 5, chainbody: 3, platelegs: 3, plateskirt: 3, kiteshield: 3, sq_shield: 2, defender: 2, boots: 1, gauntlets: 1 };
for (const b of BARS) {
  const t = TIER[b.t]; if (!t) continue;
  const bv = ITEMS[b.id].val;
  for (const p in PBARS) { const it = ITEMS[t.k + '_' + p]; if (it) it.val = Math.round(PBARS[p] * bv * 1.67); }
}
/* bars per piece, the level offset from the metal's smelting level, pieces per go */
const SMITH = [['dagger', 1, 0], ['hatchet', 1, 1], ['mace', 1, 2], ['med_helm', 1, 3], ['sword', 1, 4], ['nails', 1, 4, 15], ['dart_tips', 1, 4, 10], ['scimitar', 2, 5], ['spear', 1, 5], ['longsword', 2, 6], ['knife', 1, 7, 5],
  ['full_helm', 2, 7], ['sq_shield', 2, 8], ['warhammer', 3, 9], ['battleaxe', 3, 10], ['chainbody', 3, 11], ['kiteshield', 3, 12], ['claws', 2, 13], ['2h_sword', 3, 14],
  ['plateskirt', 3, 16], ['platelegs', 3, 16], ['platebody', 5, 18], ['arrowtips', 1, 5, 15], ['bolts_u', 1, 3, 10]].map(([p, bars, off, n]) => ({ p, bars, off, n: n || 1 }));   // no smithable pickaxes in 2007
for (const b of BARS) if (TIER[b.t]) defItem({ id: b.t + '_nails', name: TIER[b.t].n + ' nails', g: 'needle', c: TIER[b.t].c, c2: TIER[b.t].c2, stack: 1, val: 1 + TIER[b.t].i * 2 });
/* fish, by level: key, name, level, xp, cooking xp, cooking level, deep (0 = net/rod, 1 = harpoon), colour, heal, stop-burning
   level on a range (100 = never stops: shark and up burn even at 99). A spot gives the best fish your level allows */
const FISH = [
  ['shrimps', 'Shrimps', 1, 10, 30, 1, 0, '#c98a6a', 3, 34], ['sardine', 'Sardine', 5, 20, 40, 1, 0, '#9ab0c0', 4, 38], ['herring', 'Herring', 10, 30, 50, 5, 0, '#8aa0b8', 5, 41],
  ['anchovies', 'Anchovies', 15, 40, 30, 1, 0, '#7a8a9a', 1, 34], ['trout', 'Trout', 20, 50, 70, 15, 0, '#9aa6b0', 7, 49], ['pike', 'Pike', 25, 60, 80, 20, 0, '#7a9a6a', 8, 54],
  ['salmon', 'Salmon', 30, 70, 90, 25, 0, '#d1795f', 9, 58], ['tuna', 'Tuna', 35, 80, 100, 30, 1, '#5a7aa0', 10, 63], ['lobster', 'Lobster', 40, 90, 120, 40, 1, '#b83a2a', 12, 74],
  ['bass', 'Bass', 46, 100, 130, 43, 1, '#6a8a7a', 13, 79], ['swordfish', 'Swordfish', 50, 100, 140, 45, 1, '#7f8fa0', 14, 86], ['monkfish', 'Monkfish', 62, 120, 150, 62, 0, '#b8a888', 16, 92],
  ['shark', 'Shark', 76, 110, 210, 80, 1, '#5b6b7a', 20, 100], ['anglerfish', 'Anglerfish', 82, 120, 230, 84, 1, '#4a4a5a', 22, 100], ['dark_crab', 'Dark crab', 85, 130, 215, 90, 1, '#3a2a2a', 22, 100]
].map(([k, n, lv, xp, cook, cookLv, deep, c, heal, stop], i) => {
  defItem({ id: 'raw_' + k, name: 'Raw ' + n.toLowerCase(), g: 'fish', c, c2: '#5b5b5b', stack: 1, val: 15 + i * 40, raw: k });
  defItem({ id: k, name: n, g: 'cfish', c, c2: '#8a5a2a', stack: 1, val: 25 + i * 60, heal });
  defItem({ id: 'burnt_' + k, name: 'Burnt ' + n.toLowerCase(), g: 'cfish', c: '#2a2320', c2: '#151210', stack: 1, val: 0 });
  return { k, n, lv, xp, cook, cookLv, deep, c, i, stop, raw: 'raw_' + k, done: k };
});
/* meat: what cows and chickens leave behind; COOK is everything a fire or range takes */
const COOK = FISH.concat([['meat', 'beef', '#b83a3a'], ['chicken', 'chicken', '#e8c8a8']].map(([k, src, c]) => {
  defItem({ id: 'raw_' + src, name: 'Raw ' + src, g: 'meat', c, c2: '#6b2b2b', stack: 1, val: 3, raw: k });
  defItem({ id: 'cooked_' + k, name: 'Cooked ' + k, g: 'meat', c: '#8a5a3a', c2: '#4a2a1a', stack: 1, val: 6, heal: 3 });
  defItem({ id: 'burnt_' + k, name: 'Burnt ' + k, g: 'meat', c: '#2a2320', c2: '#151210', stack: 1, val: 0 });
  return { k, n: cap(k), raw: 'raw_' + src, done: 'cooked_' + k, cookLv: 1, cook: 30, stop: 31 };   // meat stops burning at 31, as the wiki has it
}));

/* odd pieces: gilded tools are rune under gold leaf */
armSeg('seg0');
/* Ava's devices: the arrow simply is not consumed, at the advertised rate */
W('avas_attractor', "Ava's attractor", 'cape', 0, 'cape', 780, { ranged: 30 }, { rat: 2, save: 0.6 });
W('avas_accumulator', "Ava's accumulator", 'cape', 0, 'cape', 9800, { ranged: 50 }, { rat: 4, save: 0.72 });
W('team_cape', 0, 'cape', 0, 'cape', 50);
for (const [k, c, c2, b, val] of [['magic', '#4a72d0', '#2a4485', { mag: 10 }, 350], ['defence', '#c04a4a', '#7a2a2a', { def: 7 }, 700],
  ['strength', '#3f9a4a', '#25622c', { str: 10 }, 1400], ['power', '#8a4ad0', '#552a85', { atk: 6, str: 6, def: 6, mag: 6, rat: 6, pb: 1 }, 2800],
  ['glory', '#e0448a', '#8f2455', { atk: 10, str: 6, def: 3, mag: 10, rat: 10, pb: 3 }, 11000]])
  defWear(Object.assign({ id: 'amulet_of_' + k, name: 'Amulet of ' + k, g: 'amulet', c, c2, slot: 'neck', val }, b));
/* rings carry behaviours, not stats */
for (const [k, c, c2, val] of [['recoil', '#4a72d0', '#2a4485', 1200], ['life', '#d0d4dc', '#8a8f98', 5000], ['wealth', '#e0b436', '#9a7414', 9000]])
  defWear({ id: 'ring_of_' + k, name: 'Ring of ' + k, g: 'ring', c, c2, slot: 'ring', val });
for (const [id, name, g, c, c2, val, x] of [['tinderbox', 'Tinderbox', 'tinder', '#8a6438', '#4a3620', 4], ['hammer', 'Hammer', 'hammer', '#75767a', '#4a4b4f', 10],
  ['fishing_rod', 'Fishing rod', 'rod', '#8a6438', '#4a3620', 12], ['small_net', 'Small net', 'net', '#b0a074', '#6a5f42', 12], ['harpoon', 'Harpoon', 'rod', '#9aa0a8', '#5b5f66', 60],
  ['coins', 'Coins', 'coins', '#e0b436', '#9a7414', 1, { stack: 1 }], ['bones', 'Bones', 'bones', '#e0dcc8', '#9a9484', 1, { stack: 1, bury: 4.5 }],
  ['big_bones', 'Big bones', 'bones', '#e8e4d0', '#a09a88', 3, { stack: 1, bury: 15 }],
  ['dragon_bones', 'Dragon bones', 'bones', '#dcd0b8', '#8a7a60', 150, { stack: 1, bury: 72 }]])
  defItem(Object.assign({ id, name, g, c, c2, val }, x));
/* ---- 5b. THE LARDER: what the gathering and making skills pass between them; a family is one line ---- */
const defStack = (id, name, g, c, c2, val, x) => defItem(Object.assign({ id, name, g, c, c2, val, stack: 1 }, x));
/* runes: level, xp per essence, the level step that adds another rune per essence (0 = never), colours, value, sold by mages */
const RC = [['air', 1, 5, 11, '#cfd8e0', '#8f9aa6', 5, 1], ['mind', 2, 5.5, 14, '#9a7ad0', '#65509a', 4, 1], ['water', 5, 6, 19, '#4f8fd0', '#2f5f92', 5, 1],
  ['earth', 9, 6.5, 26, '#8a6a3a', '#5b4524', 5, 1], ['fire', 14, 7, 35, '#d05a2a', '#8f3a16', 5, 1], ['body', 20, 7.5, 46, '#d8cfc4', '#8a8078', 5, 1],
  ['cosmic', 27, 8, 59, '#e8d86a', '#9a8a2a', 120], ['chaos', 35, 8.5, 74, '#c04a4a', '#802e2e', 90, 1], ['nature', 44, 9, 91, '#5aa04a', '#2f6a28', 180],
  ['law', 54, 9.5, 95, '#6a8ad8', '#3a4f8a', 200], ['death', 65, 10, 99, '#e8e8f0', '#6a6a74', 220, 1], ['blood', 77, 23.8, 0, '#8a1a24', '#4a0a10', 400],
  ['soul', 90, 29.7, 0, '#f0e8f8', '#8a7a9a', 600], ['wrath', 95, 8, 0, '#3a1e2e', '#1a0c16', 500],
  ['astral', 40, 8.7, 82, '#a8c8e8', '#5a7a9a', 150, 1]]   // appended, never inserted: RC index is wire format
  .map(([k, lv, xp, step, c, c2, val, shop], i) => ({ k, lv, xp, step, c, c2, val, shop: shop || 0, id: k + '_rune', i }));
const RUNES = RC.map(r => defStack(r.id, cap(r.k) + ' rune', 'rune', r.c, r.c2, r.val, { rune: 1 }));
const runesPer = r => r.step ? 1 + Math.floor(lvl[SK.runecraft] / r.step) : 1;   // air x2 at 11, x3 at 22...
defStack('pure_essence', 'Pure essence', 'ore', '#eef0fa', '#a0a2b4', 5);
W('tiara', 0, 'tiara', 0, 'head', 40);
for (const r of RC) {
  if (r.k === 'wrath' || r.k === 'astral') continue;   // neither altar answers to a talisman on the wiki — and no astral altar stands here, so its pair would be dead stock
  defItem({ id: r.k + '_talisman', name: cap(r.k) + ' talisman', g: 'talisman', c: r.c, c2: r.c2, val: 30 + r.i * 40, tal: r.k });
  defWear({ id: r.k + '_tiara', name: cap(r.k) + ' tiara', g: 'tiara', c: r.c, c2: r.c2, slot: 'head', tiara: r.k, val: 90 + r.i * 40 });
}
/* gems: crafting level and xp to cut; uncut ones turn up while mining, weighted toward the cheap end */
const GEMS = [['sapphire', 20, 50, '#3a64c8', '#1e3a80', 25, 64], ['emerald', 27, 67.5, '#3aa05a', '#1e6030', 50, 32], ['ruby', 34, 85, '#c82a3a', '#801a24', 100, 16],
  ['diamond', 43, 107.5, '#e8f0f8', '#8a98a8', 200, 8], ['dragonstone', 55, 137.5, '#b04ad0', '#6a2a80', 1000, 1],
  ['onyx', 67, 167.5, '#2a2028', '#141018', 30000, 0]].map(([k, lv, xp, c, c2, val, w], i) => {   // w 0: onyx never turns up mining
  defItem({ id: 'uncut_' + k, name: 'Uncut ' + k, g: 'gem', c, c2, val }); defItem({ id: k, name: cap(k), g: 'gem', c, c2, val: val * 2 });
  return { k, lv, xp, c, c2, w, i };
});
const GEM_T = GEMS.map(g => ['uncut_' + g.k, g.w]);
/* jewellery: [form, slot, level, xp, per-gem levels, per-gem xp]; a gold bar, then a gem; amulets need a ball of wool */
const JEWEL = [['ring', 'ring', 5, 15, [20, 27, 34, 43, 55, 67], [40, 55, 70, 85, 100, 115]], ['necklace', 'neck', 6, 20, [22, 29, 40, 56, 72, 82], [55, 60, 75, 90, 105, 120]],
  ['amulet', 'neck', 8, 30, [24, 31, 50, 70, 80, 90], [65, 70, 85, 100, 150, 165]]].map(([k, slot, lv, xp, lvs, xps]) => {
  defWear({ id: 'gold_' + k, name: 'Gold ' + k, g: k === 'ring' ? 'ring' : 'amulet', c: '#e0b436', c2: '#9a7414', slot, val: 60 + lv * 12 });
  for (const g of GEMS) defWear({ id: g.k + '_' + k, name: cap(g.k) + ' ' + k, g: k === 'ring' ? 'ring' : 'amulet', c: g.c, c2: '#9a7414', slot, val: 120 + (g.i + 1) * (g.i + 1) * 160 });
  return { k, lv, xp, lvs, xps };
});
/* herbs: herblore level and xp to clean; grimy ones fall from monsters by tier and grow in herb patches */
const HERBS = [['guam', 3, 2.5], ['marrentill', 5, 3.8], ['tarromin', 11, 5], ['harralander', 20, 6.3], ['ranarr', 25, 7.5], ['toadflax', 30, 8], ['irit', 40, 8.8],
  ['avantoe', 48, 10], ['kwuarm', 54, 11.3], ['snapdragon', 59, 11.8], ['cadantine', 65, 12.5], ['lantadyme', 67, 13.1], ['dwarf_weed', 70, 13.8], ['torstol', 75, 15]]
  .map(([k, lv, xp], i) => {
    const n = k.replace('_', ' ');
    defStack('grimy_' + k, 'Grimy ' + n, 'herb', '#5a6a3a', '#2e3a1e', 6 + i * 24); defStack(k, cap(n), 'herb', '#4faa4a', '#2a6a2a', 12 + i * 36);
    return { k, n, lv, xp, i, grimy: 'grimy_' + k };
  });
/* crops: key, level, plant xp, harvest xp (per item, or for checking a tree's health), growth in ticks, t (0 allotment, 1 herb, 2 tree), what it yields;
   the seed is <key>_seed (an acorn for the oak); seeds stack, produce heals a little */
const CROP_HERB = [[9, 11, 12.5], [14, 13.5, 15], [19, 16, 18], [26, 21.5, 24], [32, 27, 30.5], [38, 34, 38.5], [44, 43, 48.5], [50, 54.5, 61.5], [56, 69, 78],
  [62, 87.5, 98.5], [67, 106.5, 120], [73, 134.5, 151.5], [79, 170.5, 192], [85, 199.5, 224.5]];
const CROPS = [['potato', 1, 8, 9, 4000, 1], ['onion', 5, 9.5, 10.5, 4000, 1], ['cabbage', 7, 10, 11.5, 4000, 1], ['tomato', 12, 12.5, 14, 4000, 2],
  ['sweetcorn', 20, 17, 19, 6000, 3], ['strawberry', 31, 26, 29, 6000, 6], ['watermelon', 47, 48.5, 54.5, 8000, 5]].map(([k, lv, plant, xp, grow, heal], i) => {
  defStack(k, cap(k), 'crop', ['#c8a86a', '#d8c8e8', '#9ad07a', '#d8403a', '#e8d05a', '#d83a4a', '#4aa85a'][i], '#4a3a2a', 4 + i * 12, { heal });
  return { k, n: cap(k), lv, plant, xp, grow, t: 0, yield: k };
}).concat(HERBS.map((h, i) => ({ k: h.k, n: cap(h.n), lv: CROP_HERB[i][0], plant: CROP_HERB[i][1], xp: CROP_HERB[i][2], grow: 8000, t: 1, yield: h.grimy })),
  [['oak', 15, 14, 467.3, 20000], ['willow', 30, 25, 1456.5, 28000], ['maple', 45, 45, 3403.4, 32000], ['yew', 60, 81, 7069.9, 40000], ['magic', 75, 145.5, 13768.3, 48000],
    ['mahogany', 55, 63, 15720, 36000]]   // appended last: the crop index rides in the farm save
    .map(([k, lv, plant, xp, grow]) => ({ k, n: cap(k), lv, plant, xp, grow, t: 2, yield: k + '_logs' })),
  [{ k: 'wheat', n: 'Wheat', lv: 1, plant: 8, xp: 9, grow: 4000, t: 0, yield: 'grain' }]);   // appended after the trees for the same reason: the mill was built first
CROPS.forEach((c, i) => { c.i = i; c.seed = c.k === 'oak' ? 'acorn' : c.k + '_seed'; defStack(c.seed, c.k === 'oak' ? 'Acorn' : c.n + ' seed', 'seed', ['#c8a86a', '#7ad04a', '#8a6a3a'][c.t], '#4a3a2a', 2 + c.lv * 3); });
/* hides, fibres and feathers */
defStack('feather', 'Feather', 'feather', '#f0f0f0', '#8a8a8a', 2);
defStack('flax', 'Flax', 'herb', '#7aa0d8', '#4a6a9a', 3); defStack('bow_string', 'Bow string', 'string', '#e8e0c8', '#8a8470', 60);
defStack('wool', 'Wool', 'wool', '#f0ece0', '#9a968a', 2); defStack('ball_of_wool', 'Ball of wool', 'wool', '#f4f0e8', '#a09c90', 4);
defStack('cowhide', 'Cowhide', 'hide', '#8a6438', '#5b4123', 3); defStack('leather', 'Leather', 'hide', '#a07a48', '#5b4123', 5); defStack('hard_leather', 'Hard leather', 'hide', '#6f4a28', '#452c16', 14);
for (const h of HIDES) if (h.k.endsWith('_dhide')) {
  const c = h.k.slice(0, -6), n = cap(c);
  defStack(c + '_dragonhide', n + ' dragonhide', 'hide', h.c, h.c2, 1800 + h.ra * 40); defStack(c + '_dragon_leather', n + ' dragon leather', 'hide', h.c, h.c2, 1900 + h.ra * 40);
}
/* hand tools */
for (const [id, name, g, val, x] of [['needle', 'Needle', 'needle', 1], ['thread', 'Thread', 'string', 1, { stack: 1 }], ['chisel', 'Chisel', 'chisel', 1], ['knife', 'Knife', 'knife', 6], ['shears', 'Shears', 'knife', 1],
  ['ring_mould', 'Ring mould', 'mould', 5], ['necklace_mould', 'Necklace mould', 'mould', 5], ['amulet_mould', 'Amulet mould', 'mould', 5], ['tiara_mould', 'Tiara mould', 'mould', 5]])
  defItem(Object.assign({ id, name, g, c: '#9aa0a8', c2: '#5b5f66', val }, x));

/* ---- 5c. RECIPES: everything made by hand or at a fixture is one row; a make task turns them out one every few ticks ----
   id made, skill, level, xp, need [[id, n]...]; x: n made per go, tool (kept, must be carried), at (fixture object type, 'tan' for the tanner), tk (ticks per go),
   fn(r) → [[id, n]] actually made or null for a ruined go (no xp), name, msg. Items used on each other or on a fixture find their rows by id. */
const RECIPES = [];
const recipe = (id, sk, lv, xp, need, x) => { const r = Object.assign({ id, sk, lv, xp, need, n: 1 }, x); RECIPES.push(r); return r; };
const rTools = r => r.tool ? [].concat(r.tool) : [];   // a recipe may ask for several tools (hammer and saw)
const usesItem = (r, id) => rTools(r).includes(id) || r.need.some(n => n[0] === id);
const mkOk = r => lvl[SK[r.sk]] >= r.lv && hasAll(r.need) && rTools(r).every(t => invCount(t) > 0);
const mkWhy = r => { const t = rTools(r).find(t2 => !invCount(t2)); return lvl[SK[r.sk]] < r.lv ? skName(SK[r.sk]) + ' ' + r.lv : t ? 'a ' + ITEMS[t].name.toLowerCase()
  : r.need.map(([id, n]) => n + ' ' + ITEMS[id].name.toLowerCase()).join(', '); };
const mkName = r => r.name || ITEMS[r.id].name + (r.n > 1 ? ' x' + r.n : '');
for (const b of BARS) recipe(b.id, 'smithing', b.lv, b.xp, b.need,
  b.t === 'iron' ? { at: 3, fn: () => Math.random() < 0.5 ? [['iron_bar', 1]] : (say('The ore is too impure and you fail to refine it.', 'bad'), null) } : { at: 3 });   // iron smelts at 50%, as ever
const SMITH_XP = { bronze: 12.5, iron: 25, steel: 37.5, mithril: 50, adamant: 62.5, rune: 75 };   // the 2007 xp per bar at the anvil
for (const b of BARS) for (const s of SMITH) if (ITEMS[b.t + '_' + s.p]) recipe(b.t + '_' + s.p, 'smithing', Math.min(MAXL, b.lv > 1 ? b.lv + s.off : Math.max(1, s.off)), (SMITH_XP[b.t] || b.xp * 2) * s.bars, [[b.id, s.bars]], { at: 4, tool: 'hammer', n: s.n });   // bronze starts at the offset itself (dagger and axe at 1), iron up stacks it on the bar

/* ---- 6. SHOPS: stock is a function of (kind, settlement tier), derived every time the door opens ---- */
const SHOP = Object.create(null); SHOP_KINDS.forEach((s, i) => { s.i = i; SHOP[s.k] = s; });
const TIER_STOCK = [2, 4, 6];   // hamlet steel, town mithril, city rune
function shopStock(kind, tier) {
  const s = SHOP[kind], list = [], maxT = TIER_STOCK[tier];
  const push = (id, n) => { if (ITEMS[id]) list.push({ id, n: n === undefined ? 10 : n }); };
  const metal = (pieces, n, lim) => { for (let t = 0; t <= maxT; t++) for (const p of pieces) push(TIERS[t].k + '_' + p, n); };
  if (s.base) for (const id of s.base) if (id !== 'coins') push(id, 30);
  if (s.tools) { metal(['hatchet', 'pickaxe'], 5); push('hammer', 20); push('tinderbox', 20); }
  if (s.weapons) {
    metal(['dagger', 'sword', 'scimitar', 'longsword', 'mace'], 4);
    if (tier >= 1) metal(['battleaxe', 'warhammer', 'claws'], 3);
    if (tier === 2) metal(['2h_sword', 'halberd', 'spear', 'hasta'], 2);
  }
  if (s.armour) {
    const A = ['med_helm', 'full_helm', 'platebody', 'chainbody', 'platelegs', 'plateskirt', 'kiteshield', 'sq_shield'];
    metal(A.concat(['boots', 'gauntlets']), 4);
    if (tier === 2) for (const p of A.concat(['boots', 'gauntlets'])) push('white_' + p, 3);
    push('leather_gloves', 10); push('leather_boots', 10); push('amulet_of_magic', 3); push('anti_dragon_shield', 4);
    if (tier >= 1) { push('amulet_of_defence', 3); push('amulet_of_strength', 3); }
    if (tier === 2) push('amulet_of_power', 2);
  }
  if (s.k === 'food') { for (const f of FISH) if (f.lv <= 40) push(f.done, 15); push('feather', 1000); }
  if (s.range) {
    for (let i = 0; i <= Math.min(5, 1 + tier * 2); i++) {
      push(BOWS[i].k + 'shortbow', 5); push(BOWS[i].k + 'longbow', 5); push(XBOWS[i].k + '_crossbow', 4);
      for (const q of HIDEPIECE) push(HIDES[i].k + '_' + q.k, 4);
    }
    for (let i = 0; i <= Math.min(5, 1 + tier * 2); i++) { push(ARROWS[i].k + '_arrow', 1000 + tier * 2000); push(BOLTS[i].k + '_bolts', 800 + tier * 1600); }
    for (const t of THROWN_T.slice(0, [2, 4, 7][tier])) for (const th of THROWN) push(t.k + '_' + th.k, 300 + tier * 300);
    if (tier === 2) push('amethyst_arrow', 2000);
    if (tier >= 1) { push('snakeskin_boots', 4); push('avas_attractor', 2); }
    if (tier === 2) push('avas_accumulator', 1);
  }
  if (s.mage) {
    push('staff', 10); push('beginner_wand', 6);
    for (let i = 0; i <= Math.min(2, tier); i++) {
      for (const e of ELEMS) push(STAFF_TIERS[i].k + '_of_' + e.k, 4);
      for (const p of ROBE_PIECES) push(ROBE_TIERS[i].k + '_' + p.k, 6);
    }
    if (tier >= 1) { push('battlestaff', 4); push('apprentice_wand', 4); }
    if (tier === 2) { push('mystic_staff', 3); push('teacher_wand', 3); push('ring_of_life', 2); for (const co of COMBOS) push(co.k + '_battlestaff', 2); }
    for (const r of RC) if (r.shop) push(r.id, 500 + tier * 500);
    for (const r of RC) if (r.i <= [1, 5, 7][tier]) push(r.k + '_talisman', 3);
  }
  if (s.k === 'general') {
    for (const r of RC) if (r.shop && r.lv < 20) push(r.id, 200 + tier * 300);
    push('bronze_arrow', 500); push('team_cape', 5);
    if (tier >= 1) push('ring_of_recoil', 3);
  }
  if (s.k === 'craft' && tier === 2) { for (const c of SKILLS) if (!c.locked) push('skillcape_' + c.k, 1); push('max_cape', 1); push('ardougne_max_cape', 1); }   // the city outfitter keeps every master's cape; req99 and reqMax still gate the wearing
  return list;
}
const buyPrice = it => Math.max(1, Math.round(it.val * 1.15));
const sellPrice = it => Math.max(1, Math.round(it.val * 0.42));

/* ---- 6b. MAGIC EQUIPMENT: robes trade defence for magic; an elemental staff supplies its rune ---- */
const ROBE_TIERS = [
  { k: 'wizard', n: 'Wizard', def: 1, mlv: 1, c: '#3b3f8a', c2: '#23264f', m: 0 }, { k: 'black', n: 'Black', def: 1, mlv: 1, c: '#2f2f36', c2: '#1a1a1f', m: 0 },
  { k: 'mystic', n: 'Mystic', def: 20, mlv: 40, c: '#6a5ab0', c2: '#3e3470', m: 1 }
];
/* mg: [wizard/black, mystic] — the wiki's magic bonuses; robes defend with the mind (melee def is zero on every piece) */
const ROBE_PIECES = [['hat', 'hat', 'hat', 'head', [2, 4]], ['robe_top', 'robe top', 'robe', 'body', [3, 20]], ['robe_bottom', 'robe bottom', 'legs', 'legs', [0, 15]],
  ['gloves', 'gloves', 'glove', 'hands', [1, 3]], ['boots', 'boots', 'boot', 'feet', [1, 3]]].map(([k, n, g, slot, mg]) => ({ k, n, g, slot, mg }));
for (const t of ROBE_TIERS) for (const p of ROBE_PIECES) defWear({
  id: t.k + '_' + p.k, name: t.n + ' ' + p.n, g: p.g, c: t.c, c2: t.c2, slot: p.slot, tier: 0, def: 0, mag: p.mg[t.m],
  req: { magic: t.mlv, defence: t.def }, val: Math.round((p.mg[t.m] * 3 + 2) * (t.m ? 12 : 4))
});
const ELEMS = [['air', '#cfd8e0', '#8f9aa6'], ['water', '#4f8fd0', '#2f5f92'], ['earth', '#8a6a3a', '#5b4524'], ['fire', '#d05a2a', '#8f3a16']]
  .map(([k, c, c2]) => ({ k, rune: k + '_rune', c, c2 }));
const ELEM = Object.create(null); ELEMS.forEach(e => { ELEM[e.k] = e; });
const STAFF_TIERS = [
  { k: 'staff', n: 'Staff of', lv: 1, mag: 10, atk: 7, str: 3, m: 1 }, { k: 'battlestaff', n: 'Battlestaff of', lv: 30, mag: 12, atk: 28, str: 35, m: 3 },
  { k: 'mystic', n: 'Mystic staff of', lv: 40, mag: 14, atk: 40, str: 50, m: 6 }
];
const defStaff = (id, name, c, c2, atk, str, mag, lv, val, gives, g) =>
  defWear({ id, name, g: g || 'staff', c, c2, slot: 'weapon', tier: 0, spd: g === 'wand' ? 4 : 5, atk, str, mag, gives, req: { magic: lv }, val });
defStaff('staff', 'Staff', '#8a6438', '#d8c88a', 7, 3, 4, 1, 18);
for (const t of STAFF_TIERS) for (const e of ELEMS)
  defStaff(t.k + '_of_' + e.k, t.n + ' ' + e.k, e.c, e.c2, t.atk, t.str, t.mag, t.lv, Math.round((t.mag * 6 + 20) * t.m * 1.6), e.rune);
defStaff('battlestaff', 'Battlestaff', '#6b5334', '#c8b87a', 25, 32, 12, 30, 298);
defStaff('mystic_staff', 'Mystic staff', '#6a5ab0', '#d8c88a', 40, 50, 14, 40, 883);
for (const id in ITEMS) if (ITEMS[id].slot === 'weapon' && /battlestaff|^mystic_/.test(id)) ITEMS[id].req.attack = ITEMS[id].req.magic;   // the wiki's attack gate on the fighting staves
/* combination staves hand out both runes, at a 40% premium */
const COMBOS = [['mud', 'water', 'earth'], ['lava', 'fire', 'earth'], ['steam', 'fire', 'water'], ['smoke', 'fire', 'air'], ['mist', 'water', 'air'], ['dust', 'earth', 'air']]
  .map(([k, a, b]) => ({ k, a, b }));
for (const co of COMBOS) {
  const A = ELEM[co.a], B = ELEM[co.b], runes = [A.rune, B.rune];
  defStaff(co.k + '_battlestaff', cap(co.k) + ' battlestaff', A.c, B.c, 28, 35, 12, 30, Math.round((9 * 6 + 20) * 3 * 1.6 * 1.4), runes);
  defStaff('mystic_' + co.k + '_staff', 'Mystic ' + co.k + ' staff', A.c, B.c, 40, 50, 14, 40, Math.round((15 * 6 + 20) * 6 * 1.6 * 1.4), runes);
}
/* wands: one-handed, so a mage can carry a shield */
for (const [id, n, mag, lv, val, c, c2] of [['beginner_wand', 'Beginner wand', 5, 45, 60, '#8a6438', '#b9aee0'], ['apprentice_wand', 'Apprentice wand', 10, 50, 240, '#75767a', '#7ab9e0'],
  ['teacher_wand', 'Teacher wand', 15, 55, 700, '#5c63b8', '#e0d47a'], ['master_wand', 'Master wand', 20, 60, 1600, '#3ab6c4', '#e07ad4']])
  defStaff(id, n, c, c2, 0, 0, mag, lv, val, undefined, 'wand');
const staffRune = () => { if (P.imbueT > tickN) return ['air_rune', 'water_rune', 'earth_rune', 'fire_rune'];   // Magic Imbue: the staff answers for every element while it lasts
  const g = eq.weapon && ITEMS[eq.weapon].gives; return g ? (Array.isArray(g) ? g : [g]) : []; };
function spellReady(sp) {
  const free = staffRune();
  for (const [id, k] of sp.need) if (!free.includes(id) && invCount(id) < k) return false;
  return true;
}
function spendRunes(sp) { const free = staffRune(); for (const [id, k] of sp.need) if (!free.includes(id)) invRemove(id, k); }

/* ---- 7. COMBAT STYLES, MAGIC, PRAYER ---- */
/* ---- 7b. SPECIAL ATTACKS: energy runs 0-100 and returns 10 points every 50 ticks, the 2007 pace. cost in %; n hits; acc and dmg
   multiply the roll; claws runs its own cascade; drainDef cuts the target's current Defence (warhammer, stacking); stun parks the
   target's swing timer (spear); fx fires instantly from the button (battleaxe); rng marks ranged specs. The dragon 2h's modifier is
   unstated on the wiki so it rolls plain, and area effects land single-target here. ---- */
const SPEC = {
  dragon_dagger: { cost: 25, n: 2, acc: 1.15, dmg: 1.15 },
  dragon_longsword: { cost: 25, dmg: 1.25 },
  dragon_mace: { cost: 25, acc: 1.25, dmg: 1.5 },
  dragon_warhammer: { cost: 50, dmg: 1.5, drainDef: 0.7 },
  dragon_scimitar: { cost: 55, acc: 1.25 },   // its prayer-cut is PvP-only in 2007 and not modelled
  dragon_spear: { cost: 25, stun: 5, dmg: 0 },   // a three-second shove, as the wiki has it
  dragon_halberd: { cost: 30, dmg: 1.1, big2: 1 },
  dragon_2h_sword: { cost: 60 },
  dragon_claws: { cost: 50, claws: 1 },
  dragon_battleaxe: { cost: 100, fx: () => { let d = 0; for (const k of ['attack', 'defence', 'ranged', 'magic']) { const t = Math.floor(Math.max(0, lvl[SK[k]] + bst[SK[k]]) * 0.1); bst[SK[k]] = Math.max(-lvl[SK[k]], bst[SK[k]] - t); d += t; }
    bst[SK.strength] = Math.min(99, bst[SK.strength] + 10 + Math.floor(d / 4)); dirty.sk = 1; say('You feel the power of the dragon battleaxe surge through you!', 'lv'); } },
  dragon_crossbow: { cost: 60, rng: 1, dmg: 1.2 },
  magic_shortbow: { cost: 55, rng: 1, n: 2, acc: 1.43, msb: 1 }   // snapshot: two arrows, its own prayerless max off the arrow alone
};
const SPELLS = SPELLS_R.map(([k, lv, xp, max, tint, need, drain, hold, undead, bk, fx], i) => ({ k, n: k.split('_').map(cap).join(' '), lv, xp, max, tint, need: need.map(([r, c]) => [r + '_rune', c]), drain, hold, undead, bk: bk || 0, fx: fx || null, i }));
/* prayers drain points per tick while lit, at the 2007 rates: 0.6 / (seconds per point) — the 36s/18s/12s/6s/3s/2s/1.5s ladder */
const PRAYERS = PRAYERS_R.map(([k, n, lv, drain, fx, g, dl], i) => Object.assign({ k, n, lv, drain, g, dl: dl || 0, fx: Object.keys(fx), bit: 1 << i }, fx));
if (PRAYERS.length > 32) throw new Error('prayer bitfield full: P.prayers holds 32 bits');   // bit 31 (the sign) still works through & masks; bit 32 wraps to 1
const prayerMul = f => { let m = 1; for (const p of PRAYERS) if ((P.prayers & p.bit) && p[f]) m *= p[f]; return m; };
const prayAdd = f => { let s = 0; for (const p of PRAYERS) if ((P.prayers & p.bit) && p[f]) s += p[f]; return s; };   // additive riders: the mystic line's magic damage %
const prayHas = (f, v) => PRAYERS.some(p => (P.prayers & p.bit) && (v === undefined ? p[f] : p[f] === v));

/* registration points for the skill sections at the foot of the file: extra task kinds, kill/tick/pool/structure hooks, item-on-object handlers */
const TASKS = Object.create(null), USE_ON = Object.create(null), onKill = [], tickHooks = [], poolHooks = [], structHooks = [];
/* settings, shared by the options tab and the dev console */
const OPT = { camSpeed: 2.0, viewRadius: 7, fog: 1, timers: 1, xpDrops: 1, roofs: 1, hideRoofs: 0, brightness: 1, runMul: 1, retaliate: 1, stuck: 0, pvpWarn: 1, budget: 0, osrs: 1, osrsDist: 99 };

/* ---- 6c. ICONS: drawn, not loaded; one 32x32 canvas per (glyph, colours), cached as a data URL ---- */
const _iconCache = new Map();
const _ic = document.createElement('canvas'); _ic.width = _ic.height = 32;
const _ix = _ic.getContext('2d');
/* memoised on (glyph, colours); '|' keys cannot collide with item ids or 'sk:' keys */
function drawIcon(glyph, c, c2) {
  const k = glyph + '|' + c + '|' + c2;
  let u = _iconCache.get(k);
  if (u) return u;
  _ix.clearRect(0, 0, 32, 32); _ix.lineJoin = 'round'; _ix.lineWidth = 1;
  (GLYPH[glyph] || GLYPH.log)(_ix, c || '#a9713b', c2 || '#6e4520');
  _iconCache.set(k, u = _ic.toDataURL());
  return u;
}
/* 07 icons: wiki-true sprites served from assets/i07/ (items) and assets/c07/ (UI). The generated lookup maps (ICON07 item->sprite,
   SK07/PR07/SP07 by k, US07 by display name, MK07 by MK_ART key, TINT07 worn tints) live in icons07.js — regenerate with
   node icons07-genmap.mjs / node icons07-tint.mjs after editing icons07-map.csv; drawn glyphs remain the fallback. */
if (typeof ICON07 === 'undefined') for (const k of ['ICON07', 'SK07', 'PR07', 'SP07', 'US07', 'MK07', 'TINT07']) globalThis[k] = {};   // lone-file boot: sprites/tints degrade to glyphs
const i07p = f => 'assets/' + (f.indexOf('/') < 0 ? 'i07/' + f : f) + '.png', c07p = n => 'assets/c07/' + n + '.png';
const mk07p = n => n.indexOf('/') < 0 ? c07p(n) : 'assets/' + n + '.png';   // markers default to the c07 map set; a folder means an item sprite stands in
/* The "2007 models" setting arms the sprites as well as the meshes: with it off every lookup misses and the drawn
   glyph underneath takes over, so one toggle really does undress the whole 07 layer. Every read of a sprite map
   goes through here — icons07Apply (settings) forgets the caches the misses would otherwise be stuck in. */
const g07 = (m, k) => OPT.osrs ? m[k] : 0;
function icon(id) {
  let u = _iconCache.get(id);
  if (u) return u;
  const it = ITEMS[id], f = g07(ICON07, id);
  _iconCache.set(id, u = f ? i07p(f) : it ? drawIcon(it.g, it.c, it.c2) : drawIcon('lock', '#6a6258', '#3a3630'));
  return u;
}
/* skillcapes: the 2007 price, and the only requirement that matters */
SKILLS.forEach((s, i) => { if (!s.locked) defWear({ id: 'skillcape_' + s.k, name: s.f + ' cape', g: 'cape', c: SK_C[i], c2: '#2a2620', slot: 'cape', def: 9, req99: s.k, val: 99000 }); });
function skIcon(i) {
  const key = 'sk:' + i, s = SKILLS[i];
  let u = _iconCache.get(key);
  if (!u) _iconCache.set(key, u = g07(SK07, s.k) ? c07p(SK07[s.k]) : drawIcon(s.g, SK_C[i], '#f0e6c8'));
  return u;
}
const hexInt = h => parseInt(h.slice(1), 16);
/* ---- 8. RENDERER ---- */
const CHUNK = 32, SKY = 0x9fb8c8, SEA = -0.30, CLIMB = 1.15;
let RADIUS = 7;
const LX = 0.48, LY = 0.78, LZ = 0.40, LL = Math.hypot(LX, LY, LZ), NLX = LX / LL, NLY = LY / LL, NLZ = LZ / LL;
const LIGHT = new THREE.Vector3(NLX, NLY, NLZ);
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
renderer.setSize(innerWidth, innerHeight);
renderer.setClearColor(SKY);
document.getElementById('app').appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.fog = new THREE.Fog(SKY, 120, RADIUS * CHUNK * 0.95);
const camera = new THREE.PerspectiveCamera(58, innerWidth / innerHeight, 0.4, 2600);
/* fog measured horizontally from the player, not by view depth, so zooming out never walks the character into it */
const fogCenter = { value: new THREE.Vector3() };
THREE.ShaderChunk.fog_pars_vertex = '#ifdef USE_FOG\nvarying vec3 vFogWorld;\n#endif';
THREE.ShaderChunk.fog_vertex = '#ifdef USE_FOG\nvec4 fogWp = vec4(transformed, 1.0);\n#ifdef USE_INSTANCING\nfogWp = instanceMatrix * fogWp;\n#endif\nvFogWorld = (modelMatrix * fogWp).xyz;\n#endif';
THREE.ShaderChunk.fog_pars_fragment = '#ifdef USE_FOG\nuniform vec3 fogColor;\nuniform vec3 fogCenter;\nvarying vec3 vFogWorld;\n#ifdef FOG_EXP2\nuniform float fogDensity;\n#else\nuniform float fogNear;\nuniform float fogFar;\n#endif\n#endif';
THREE.ShaderChunk.fog_fragment = '#ifdef USE_FOG\nfloat fogDepth = distance(vFogWorld.xz, fogCenter.xz);\n#ifdef FOG_EXP2\nfloat fogFactor = 1.0 - exp(-fogDensity * fogDensity * fogDepth * fogDepth);\n#else\nfloat fogFactor = smoothstep(fogNear, fogFar, fogDepth);\n#endif\ngl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, fogFactor);\n#endif';
THREE.MeshBasicMaterial.prototype.onBeforeCompile = function (shader) { shader.uniforms.fogCenter = fogCenter; };
const basicMat = o => new THREE.MeshBasicMaterial(Object.assign({ vertexColors: true }, o));
const fxMat = () => basicMat({ color: 0xffffff, transparent: true, depthTest: false });
/* the water: one following plane, gridded so its vertices can turn to lava over the wilderness */
const water = new THREE.Mesh(new THREE.PlaneGeometry(3000, 3000, 64, 64), new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.86, depthWrite: false }));
{
  const n = water.geometry.attributes.position.count, wc = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { wc[i * 3] = 0.184; wc[i * 3 + 1] = 0.435; wc[i * 3 + 2] = 0.549; }
  water.geometry.setAttribute('color', new THREE.BufferAttribute(wc, 3));
}
water.rotation.x = -PI / 2; water.renderOrder = 2;
scene.add(water);
let _wpx = 1e9, _wpz = 1e9;
function waterPaint() {   // repainted as you travel: blue seas shading into lava across the wilderness buffer
  if (Math.abs(P.rx - _wpx) + Math.abs(P.rz - _wpz) < 12) return;
  _wpx = P.rx; _wpz = P.rz;
  const pos = water.geometry.attributes.position, col = water.geometry.attributes.color;
  for (let i = 0; i < pos.count; i++) {
    const b = wildBlend(_wpx + pos.getX(i), _wpz - pos.getY(i));
    col.setXYZ(i, 0.184 + 0.816 * b, 0.435 + 0.005 * b, 0.549 - 0.449 * b);
  }
  col.needsUpdate = true;
}
const mat = basicMat(), tintMat = basicMat();   // terrain + batched props; x per-instance colour

/* bake directional light into vertex colours: no lights, no normals at runtime */
function shade(geo, rgb) {
  if (geo.index) geo = geo.toNonIndexed();
  const p = geo.attributes.position, col = new Float32Array(p.count * 3);
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3();
  for (let i = 0; i < p.count; i += 3) {
    a.fromBufferAttribute(p, i); b.fromBufferAttribute(p, i + 1); c.fromBufferAttribute(p, i + 2);
    b.sub(a); c.sub(a); n.crossVectors(b, c).normalize();
    const s = 0.46 + 0.54 * Math.max(0, n.dot(LIGHT));
    for (let k = 0; k < 3; k++) { col[(i + k) * 3] = rgb[0] * s; col[(i + k) * 3 + 1] = rgb[1] * s; col[(i + k) * 3 + 2] = rgb[2] * s; }
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return geo;
}
const bakeW = geo => shade(geo, [1, 1, 1]);   // white, so an instance colour tints it
function tint(geo, rgb) {   // flat, unlit: Batch lights it after transforming
  if (geo.index) geo = geo.toNonIndexed();
  const n = geo.attributes.position.count, col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { col[i * 3] = rgb[0]; col[i * 3 + 1] = rgb[1]; col[i * 3 + 2] = rgb[2]; }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return geo;
}
function merge(list) {
  let n = 0; for (const g of list) n += g.attributes.position.count;
  const pos = new Float32Array(n * 3), col = new Float32Array(n * 3);
  let o = 0;
  for (const g of list) { pos.set(g.attributes.position.array, o); col.set(g.attributes.color.array, o); o += g.attributes.position.count * 3; }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  out.computeBoundingSphere();
  return out;
}
const shift = (g, y) => g.translate(0, y, 0);
const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const cyl = (rt, rb, h, n, open) => new THREE.CylinderGeometry(rt, rb, h, n, 1, !!open);
const cone = (r, h, n) => new THREE.ConeGeometry(r, h, n);
const octa = (r, d) => new THREE.OctahedronGeometry(r, d || 0);

/* three culls an InstancedMesh by its shared geometry bounds, so each chunk gets a pooled view with its own sphere.
   Views share the prop's buffers and are never disposed: they return to the pool. */
const _viewPool = new Map();
function boundView(geo, cx, cz, lo, hi) {
  let free = _viewPool.get(geo);
  if (!free) _viewPool.set(geo, free = []);
  let g = free.pop();
  if (!g) {
    g = new THREE.BufferGeometry();
    g.setAttribute('position', geo.attributes.position); g.setAttribute('color', geo.attributes.color);
    g.boundingSphere = new THREE.Sphere(); g._src = geo;
  }
  g.boundingSphere.center.set(cx * CHUNK + CHUNK * 0.5, (lo + hi) * 0.5, cz * CHUNK + CHUNK * 0.5);
  g.boundingSphere.radius = Math.hypot(CHUNK * 0.72, (hi - lo) * 0.5) + 10;
  return g;
}
const freeView = g => { const free = g._src && _viewPool.get(g._src); if (free && free.indexOf(g) < 0) free.push(g); };

/* one merged geometry per chunk for every static prop: one draw call, scratch buffers reused */
const SPOS = new Float32Array(900000), SCOL = new Float32Array(900000), T9 = new Float32Array(9);
function Batch() { this.n = 0; }
Batch.prototype.add = function (geo, x, y, z, sx, sy, sz, rot, col) {
  const p = geo.attributes.position.array, gc = geo.attributes.color.array, cs = Math.cos(rot), sn = Math.sin(rot);
  let n = this.n;
  if (n + p.length > SPOS.length) return;
  for (let i = 0; i < p.length; i += 9) {
    for (let k = 0; k < 3; k++) {
      const px = p[i + k * 3] * sx, py = p[i + k * 3 + 1] * sy, pz = p[i + k * 3 + 2] * sz;
      T9[k * 3] = x + px * cs - pz * sn; T9[k * 3 + 1] = y + py; T9[k * 3 + 2] = z + px * sn + pz * cs;
    }
    const ax = T9[3] - T9[0], ay = T9[4] - T9[1], az = T9[5] - T9[2], bx = T9[6] - T9[0], by = T9[7] - T9[1], bz = T9[8] - T9[2];
    const nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx, L = Math.hypot(nx, ny, nz) || 1;
    const sh = 0.46 + 0.54 * Math.max(0, (nx * NLX + ny * NLY + nz * NLZ) / L);
    const r = (col ? col[0] : gc[i]) * sh, g = (col ? col[1] : gc[i + 1]) * sh, b = (col ? col[2] : gc[i + 2]) * sh;
    for (let k = 0; k < 3; k++) { SPOS[n] = T9[k * 3]; SPOS[n + 1] = T9[k * 3 + 1]; SPOS[n + 2] = T9[k * 3 + 2]; SCOL[n] = r; SCOL[n + 1] = g; SCOL[n + 2] = b; n += 3; }
  }
  this.n = n;
};
/* a 2007 loc's lit triangles, colours already final (the cache bakes its light): no re-shading pass */
Batch.prototype.add07 = function (bt, x, y, z, s, rot) {
  const p = bt.pos, c = bt.col, cs = Math.cos(rot), sn = Math.sin(rot);
  let n = this.n;
  if (n + p.length > SPOS.length) return;
  for (let i = 0; i < p.length; i += 3) {
    const px = p[i] * s, py = p[i + 1] * s, pz = p[i + 2] * s;
    SPOS[n] = x + px * cs - pz * sn; SPOS[n + 1] = y + py; SPOS[n + 2] = z + px * sn + pz * cs;
    SCOL[n] = c[i]; SCOL[n + 1] = c[i + 1]; SCOL[n + 2] = c[i + 2];
    n += 3;
  }
  this.n = n;
};
/* emit the 2007 look of a named fixture into a chunk batch, if the pack is armed and carries the name;
   the variant is the tile's own coin, so every client and every rebuild lays the same stall */
function b07(B, name, x, y, z, s, rot) {
  if (!osrsOn) return 0;
  const n = OSRSK.locVariants(name);
  if (!n) return 0;
  const bt = OSRSK.locBatch(name, hash2(Math.round(x), Math.round(z), S + 107) % n);
  if (!bt) return 0;
  B.add07(bt, x, y, z, s || 1, rot || 0);
  return 1;
}
Batch.prototype.mesh = function () {
  if (!this.n) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(SPOS.slice(0, this.n), 3));
  g.setAttribute('color', new THREE.BufferAttribute(SCOL.slice(0, this.n), 3));
  g.computeBoundingSphere();
  return new THREE.Mesh(g, mat);
};
/* build a batch, add its mesh to the scene and a chunk's extras */
function batchInto(rec, fill) {
  const B = new Batch(); fill(B);
  const m = B.mesh();
  if (m) { scene.add(m); rec.extra.push(m); }
  return m;
}

/* ---- 9. PROP LIBRARY ---- */
const WHITE = [1, 1, 1];
const BOX = tint(box(1, 1, 1), WHITE), PYR = tint(cone(0.5, 1, 4).rotateY(PI / 4), WHITE), BLOB = tint(octa(0.5), WHITE);
const TRUNK = tint(cyl(0.5, 0.62, 1, 5, 1), WHITE), SPIRE = tint(cone(0.5, 1, 6), WHITE), CYL8 = tint(cyl(0.5, 0.5, 1, 8, 1), WHITE), CONE8 = tint(cone(0.5, 1, 8), WHITE);
const DRUM8 = tint(cyl(0.5, 0.5, 1, 8), WHITE);   // capped: CYL8 is an open tube, so a ring an overhanging cone shades reads as a hole
/* triangular prism, base y=0, ridge y=1 along X */
const GABLE = tint(cyl(0.5, 0.5, 1, 3).rotateZ(PI / 2).rotateX(-PI / 2).translate(0, 0.25, 0).scale(1, 1 / 0.75, 1 / 0.866), WHITE);
const BARK = [0.290, 0.204, 0.129], BARK2 = [0.353, 0.267, 0.176];
const STONE = [0.475, 0.463, 0.435], SHRUB = [0.263, 0.404, 0.208], REED = [0.482, 0.518, 0.298];
/* harvestables are instanced so one vein can vanish alone: trunks baked brown, canopies white for the species tint */
const CONIFER_GEO = merge([
  shade(shift(cyl(0.19, 0.28, 2.2, 6, 1), 1.1), BARK),
  bakeW(shift(cone(1.42, 2.9, 7), 2.35)), bakeW(shift(cone(1.12, 2.3, 7), 3.75)), bakeW(shift(cone(0.74, 1.7, 7), 5.05))
]);
const BROAD_GEO = merge([
  shade(shift(cyl(0.22, 0.34, 2.4, 6, 1), 1.2), BARK2),
  shade(shift(cyl(0.13, 0.13, 1.2, 4, 1), 2.5).rotateZ(0.7).translate(0.45, 0, 0), BARK2),
  bakeW(shift(octa(1.62, 1), 3.55)), bakeW(shift(octa(1.05, 1), 3.0).translate(1.15, 0, -0.35)), bakeW(shift(octa(0.92, 1), 3.15).translate(-0.95, 0, 0.7))
]);
const STUMP_GEO = merge([shade(shift(cyl(0.30, 0.40, 0.62, 7), 0.31), [0.36, 0.27, 0.17]), shade(shift(cyl(0.27, 0.27, 0.06, 7), 0.63), [0.52, 0.41, 0.28])]);
const ROCK_GEO = merge([
  bakeW(shift(new THREE.DodecahedronGeometry(0.88, 0), 0.52)), bakeW(shift(new THREE.DodecahedronGeometry(0.52, 0), 0.26).translate(0.70, 0, 0.34)),
  bakeW(shift(new THREE.DodecahedronGeometry(0.40, 0), 0.20).translate(-0.52, 0, -0.48)), bakeW(shift(octa(0.30), 0.86).translate(0.14, 0, -0.18))
]);
const FIRE_GEO = merge([
  shade(shift(cyl(0.7, 0.8, 0.2, 7), 0.10), [0.24, 0.19, 0.14]),
  shade(shift(box(1.3, 0.16, 0.22), 0.2).rotateY(0.6), [0.36, 0.27, 0.17]), shade(shift(box(1.3, 0.16, 0.22), 0.3).rotateY(-0.7), [0.30, 0.22, 0.14]),
  shade(shift(cone(0.52, 1.1, 5), 0.78), [0.94, 0.56, 0.12]), shade(shift(cone(0.26, 0.58, 5), 0.94), [1.0, 0.86, 0.35])
]);
const SPOT_GEO = merge([
  shade(new THREE.RingGeometry(0.55, 0.95, 12).rotateX(-PI / 2), [0.85, 0.95, 1.0]), shade(new THREE.RingGeometry(1.15, 1.4, 14).rotateX(-PI / 2), [0.7, 0.86, 0.95])
]);
const DROP_GEO = merge([bakeW(shift(octa(0.32), 0.32))]);
const MARK_GEO = merge([bakeW(box(1.5, 0.06, 0.22).rotateY(0.785)), bakeW(box(1.5, 0.06, 0.22).rotateY(-0.785))]);
/* the rowboat: half-pipe hull, capped ends, gunwales */
const HULL = merge([
  shade(new THREE.CylinderGeometry(0.85, 0.85, 3.3, 9, 1, true, 0, PI).rotateX(-PI / 2).rotateZ(PI / 2), [0.50, 0.36, 0.22]),
  shade(new THREE.ConeGeometry(0.85, 1.25, 9, 1, true, 0, PI).rotateX(PI / 2).rotateZ(PI / 2).translate(0, 0, 2.27), [0.46, 0.33, 0.20]),
  shade(new THREE.ConeGeometry(0.85, 1.0, 9, 1, true, 0, PI).rotateX(-PI / 2).rotateZ(PI / 2).translate(0, 0, -2.15), [0.46, 0.33, 0.20]),
  shade(box(0.16, 0.18, 4.2).translate(0.82, 0, 0), [0.38, 0.27, 0.16]), shade(box(0.16, 0.18, 4.2).translate(-0.82, 0, 0), [0.38, 0.27, 0.16]),
  shade(box(1.7, 0.14, 0.5).translate(0, -0.18, -0.55), [0.42, 0.30, 0.18])
]);
const OAR_GEO = merge([shade(shift(cyl(0.07, 0.07, 2.2, 5), -1.1), [0.55, 0.41, 0.25]), shade(box(0.34, 0.06, 0.62).translate(0, -2.15, 0), [0.46, 0.33, 0.20])]);

/* ---- 10. INSTANCE POOLS: fixed-size InstancedMeshes for everything transient ---- */
const _m4 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _v3 = new THREE.Vector3(), _s3 = new THREE.Vector3(1, 1, 1),
      _up = new THREE.Vector3(0, 1, 0), _col = new THREE.Color();
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
function Pool(geo, n, tinted) {
  const mesh = new THREE.InstancedMesh(geo, tinted ? tintMat : mat, n);
  mesh.frustumCulled = false;
  for (let i = 0; i < n; i++) mesh.setMatrixAt(i, ZERO);
  if (tinted) for (let i = 0; i < n; i++) mesh.setColorAt(i, _col.setHex(0xffffff));
  mesh.instanceMatrix.needsUpdate = true;
  mesh.count = 0;   // draw only what a frame actually fills
  scene.add(mesh);
  return { mesh, n, used: 0 };
}
const poolReset = p => { p.used = 0; };
function poolPut(p, x, y, z, rot, sx, sy, sz, hex) {
  if (p.used >= p.n) return;
  const i = p.used++;
  _q.setFromAxisAngle(_up, rot || 0);
  _v3.set(x, y, z); _s3.set(sx, sy === undefined ? sx : sy, sz === undefined ? sx : sz);
  p.mesh.setMatrixAt(i, _m4.compose(_v3, _q, _s3));
  if (hex !== undefined && p.mesh.instanceColor) p.mesh.setColorAt(i, _col.setHex(hex));
}
function poolFlush(p) {
  p.mesh.count = p.used;   // the tail no longer needs zeroing: it is simply not drawn
  if (!p.used) return;
  p.mesh.instanceMatrix.needsUpdate = true;
  if (p.mesh.instanceColor) p.mesh.instanceColor.needsUpdate = true;
}
const DROP_CAP = 200;   // ground items at once, and the pool holds every one: at 64 the newest drops drew nothing yet answered the mouse
const POOL_STUMP = Pool(STUMP_GEO, 64), POOL_FIRE = Pool(FIRE_GEO, 24), POOL_DROP = Pool(DROP_GEO, DROP_CAP, 1), POOL_SPOT = Pool(SPOT_GEO, 40);
/* an overlay mesh that ignores depth and culling */
function fxMesh(geo, order, color) {
  const m = new THREE.Mesh(geo, fxMat());
  if (color !== undefined) m.material.color.setHex(color);
  m.renderOrder = order; m.visible = false; m.frustumCulled = false;
  scene.add(m);
  return m;
}
const marker = fxMesh(MARK_GEO, 6, 0xffe14a);
let markT = 0;
/* the death marker: a skull over where you fell, standing until the pile itself would have faded */
const _dmc = document.createElement('canvas'); _dmc.width = _dmc.height = 32;
{ const g = _dmc.getContext('2d'); g.lineJoin = 'round'; g.lineWidth = 1; (GLYPH.skull || GLYPH.log)(g, '#f4ead0', '#1a1a1a'); }
const deathMark = new THREE.Group();
{
  const post = new THREE.Mesh(new THREE.ConeGeometry(0.45, 1.1, 6), basicMat({ color: 0x1a1a1a }));
  post.position.y = 0.55;
  const tex = new THREE.CanvasTexture(_dmc); tex.magFilter = THREE.NearestFilter;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, fog: false }));   // r128 fogs sprites at any range
  sp.scale.setScalar(2.2); sp.position.y = 2.4; sp.renderOrder = 6;
  deathMark.add(post, sp);
}
deathMark.visible = false; scene.add(deathMark);
let deathSpot = null;
/* a ring around whatever you just clicked: red for a fight, cyan otherwise; it follows a target that walks */
const RING_GEO = merge([bakeW(new THREE.RingGeometry(0.62, 0.92, 24).rotateX(-PI / 2))]);
const ring = fxMesh(RING_GEO, 6, 0x4ad8ff);
let ringT = 0, ringObj = null, ringSize = 1;
function flashTarget(o, hostile) {
  ringObj = o;
  ringSize = o.npc ? 0.7 + (o.t && o.t.sz || 1) * 0.9 : o.remote ? 1.0 : o.drop ? 0.55 : o.t === 0 ? 1.5 : 1.1;
  ring.material.color.setHex(hostile ? 0xd83a2a : 0x4ad8ff);
  ring.visible = true; ringT = 1.1;
  ringFrame(0);
}
function ringFrame(dt) {
  if (ringT <= 0) return;
  ringT -= dt;
  const o = ringObj;
  if (ringT <= 0 || !o || (o.npc && o.dead) || (o.remote && !remotes.has(o.pid))) { ring.visible = false; ringObj = null; return; }
  const x = o.rx !== undefined ? o.rx : o.x, z = o.rz !== undefined ? o.rz : o.z;
  ring.position.set(x, Math.max(groundY(x, z), 0) + 0.08, z);
  ring.scale.setScalar(ringSize * (1 + Math.sin((1.1 - ringT) * 9) * 0.10));
  ring.material.opacity = Math.min(1, ringT * 1.6);
  ring.rotation.y += dt * 1.6;
}
/* spells and arrows are bolts that fly the gap; six in the air is plenty */
const spellFx = fxMesh(DROP_GEO, 5);
let spellT = 0;
function spellBurst(x, y, z, tint) { spellFx.material.color.setHex(tint); spellFx.position.set(x, y, z); spellFx.visible = true; spellT = 0.42; }
const BOLT_GEO = merge([bakeW(octa(0.3))]);
const bolts = [], boltMesh = [];
for (let i = 0; i < 6; i++) boltMesh.push(fxMesh(BOLT_GEO, 5));
const BOLT_SPEED = 26;   // tiles a second
/* launch a bolt mesh from (sx,sy,sz) to target o; speed in tiles/s */
function launch(tint, sx, sy, sz, o, dmg, speed, lo, hi, extra) {
  const m = boltMesh.find(x => !x.visible);
  if (!m) return null;
  m.material.color.setHex(tint); m.material.opacity = 1; m.visible = true;
  const b = Object.assign({ m, sp: { tint }, o, dmg, sx, sy, sz, t: 0,
    dur: clamp(Math.hypot((o.rx ?? o.x) - sx, (o.rz ?? o.z) - sz) / speed, lo, hi) }, extra);
  bolts.push(b);
  return b;
}
const aimAt = (rx, ry, rz) => ({ rx, ry, rz, dead: 1 });
function castFx(o, sp, dmg) {
  if (!launch(sp.tint, P.rx, P.ry + 1.3, P.rz, o, dmg, BOLT_SPEED, 0.10, 0.9, { sp })) {
    spellBurst(o.rx, o.ry + 1.1, o.rz, sp.tint); hitsplat(o.rx, o.ry + 1.5, o.rz, dmg);
  }
}
const remoteBolt = (R, sp, tx, tz) => launch(sp.tint, R.rx, R.ry + 1.3, R.rz, aimAt(tx, groundY(tx, tz), tz), null, BOLT_SPEED, 0.10, 0.9, { sp });
function shootArrow(from, o, dmg, tint) {
  launch(tint, from.rx !== undefined ? from.rx : from.tx, (from.ry !== undefined ? from.ry : 0) + 1.25, from.rz !== undefined ? from.rz : from.tz,
         o, dmg, BOLT_SPEED * 1.5, 0.08, 0.7, { arw: 1 });
}
function boltFrame(dt) {
  for (let i = bolts.length - 1; i >= 0; i--) {
    const b = bolts[i], o = b.o;
    b.t += dt;
    const k = Math.min(1, b.t / b.dur), tx = o.rx, ty = o.ry + 1.15, tz = o.rz;
    b.m.position.set(b.sx + (tx - b.sx) * k, b.sy + (ty - b.sy) * k + Math.sin(k * PI) * 1.1, b.sz + (tz - b.sz) * k);
    if (b.arw) { b.m.rotation.set(0, Math.atan2(tx - b.sx, tz - b.sz), 0); b.m.scale.set(0.16, 0.16, 1.5); }
    else { b.m.rotation.y += dt * 13; b.m.rotation.x += dt * 9; b.m.scale.setScalar(0.85 + Math.sin(k * PI) * 0.45); }
    if (k >= 1) {
      b.m.visible = false; b.m.scale.setScalar(1);
      if (!b.arw) spellBurst(tx, ty, tz, b.sp.tint);
      if (!b.arw && b.sp.k && !b.sp.drain) sfxAt(b.dmg === 0 ? 227 : spellSnd(b.sp, 1), tx, tz);   // splash or strike, where it lands
      if (b.dmg !== null) { hitsplat(tx, o.ry + 1.5, tz, b.dmg); healthBar(o); }   // a killing bolt still draws the bar; fxFrame lets it linger empty
      bolts.splice(i, 1);
    }
  }
}

/* ---- 11. ARTICULATED FIGURES: one material per part so gear recolours a limb ---- */
function part(geo, hex, x, y, z) {
  const m = new THREE.Mesh(geo, basicMat({ color: hex }));
  m.position.set(x || 0, y || 0, z || 0);
  return m;
}
const SKIN = 0xd8a878, TUNIC = 0x6a5a3f, PANTS = 0x4a4030, HAIR = 0x4a3524;
/* the barber's book; index 0 is the level-3 classic */
const SKINS = ['#d8a878', '#c99a6a', '#b98255', '#8a5f3d', '#6e452b', '#e8c9a0'];
const SHIRTS = ['#6a5a3f', '#8a2f27', '#31538a', '#3a6b34', '#6a4a8a', '#8a7431', '#4a4a52', '#874a6a'];
const LEGSC = ['#4a4030', '#33302b', '#4a3524', '#2f4a5a', '#513333', '#3d4a33', '#5a5a62', '#3a3348'];
const FACES = [['Plain', 'eyeL eyeR'], ['Bearded', 'eyeL eyeR beard'], ['Moustache', 'eyeL eyeR mo'], ['Heavy brow', 'eyeL eyeR brow'],
  ['Old salt', 'eyeL eyeR brow beard', 1], ['Warpaint', 'eyeL eyeR paint']].map(([n, on, grey]) => ({ n, on: on.split(' '), grey }));
function applyFace(p, fi) {
  const f = FACES[fi] || FACES[0], fp = p.face;
  if (!fp) return;
  for (const k in fp) fp[k].visible = f.on.indexOf(k) >= 0;
  const hairC = f.grey ? 0x9a938a : 0x2a1f16;
  for (const k of ['beard', 'brow', 'mo']) fp[k].material.color.set(hairC);
}

WGRIP.pipe = [16, 20]; WGRIP.trident = [16, 26]; WHANG.add('pipe');
WUP.add('trident'); WFWD.trident = 0.19; WOUT.trident = -0.10;   // carried prongs-up like a spear
const _wepGeo = new Map();
function wepGeo(id) {
  let g = _wepGeo.get(id);
  if (g) return g;
  const it = ITEMS[id], b = WEAPON[it.g] || WEAPON.sword, a = WGRIP[it.g] || WGRIP.sword;
  g = merge(b(hexRgb(it.c), hexRgb(it.c2 || it.c), a[0], a[1]));
  if (WHANG.has(it.g)) { const k = it.g === 'sword2h' ? 1 : 0.5; g.rotateY(WFLIP.has(it.g) ? -PI / 2 : PI / 2).scale(k, k, k); }   // a two-hander at full size
  else if (WUP.has(it.g)) g.rotateX(PI);
  else if (it.g === 'bow') g.rotateX(PI / 2).rotateY(-PI / 2);
  else if (it.g === 'cbow') g.rotateX(-PI / 2);
  g.computeBoundingSphere();
  _wepGeo.set(id, g);
  return g;
}
function holdWeapon(mesh, it) {
  mesh.visible = !!it;
  if (!it) return;
  mesh.geometry = wepGeo(it.id);
  mesh.material.color.set('#ffffff');
  // a one-hander hangs leaning forward; a two-hander is carried in front, blade up and forward, rolled so its flat faces the way you look
  const two = it.two && WHANG.has(it.g) ? 1 : 0, u = Object.assign(mesh.userData, { up: WUP.has(it.g) ? 1 : 0, two, tilt: two ? -PI / 2 : WHANG.has(it.g) ? -0.55 : 0, roll: two ? PI / 2 - TWO_Z : 0 });
  mesh.rotation.set(u.tilt, 0, u.roll, two ? 'ZYX' : 'XYZ');
  mesh.position.set(WOUT[it.g] || 0, -0.60, 0.05 + (WFWD[it.g] || 0));
}
function buildAvatar() {
  const g = new THREE.Group(), W = 0xffffff;
  const hide = (...ms) => { for (const m of ms) m.visible = false; return ms; };
  const torso = part(bakeW(box(0.72, 0.72, 0.44)), TUNIC, 0, 1.05, 0);
  const head = part(bakeW(box(0.46, 0.46, 0.46)), SKIN, 0, 1.66, 0), hair = part(bakeW(box(0.5, 0.16, 0.5)), HAIR, 0, 1.88, 0);
  const armL = part(bakeW(shift(box(0.22, 0.6, 0.22), -0.3)), SKIN, 0.47, 1.34, 0), armR = part(bakeW(shift(box(0.22, 0.6, 0.22), -0.3)), SKIN, -0.47, 1.34, 0);
  // thigh plus shin, so chaps stop at the knee; the shin rides inside the thigh's pivot
  const legL = part(bakeW(shift(box(0.26, 0.40, 0.28), -0.20)), PANTS, 0.17, 0.72, 0), legR = part(bakeW(shift(box(0.26, 0.40, 0.28), -0.20)), PANTS, -0.17, 0.72, 0);
  const calfL = part(bakeW(shift(box(0.24, 0.34, 0.26), -0.17)), PANTS, 0, -0.38, 0), calfR = part(bakeW(shift(box(0.24, 0.34, 0.26), -0.17)), PANTS, 0, -0.38, 0);
  legL.add(calfL); legR.add(calfR);
  const [bootL, bootR] = hide(part(bakeW(box(0.28, 0.17, 0.36)), W, 0, -0.28, 0.03), part(bakeW(box(0.28, 0.17, 0.36)), W, 0, -0.28, 0.03));
  calfL.add(bootL); calfR.add(bootR);
  const [glovL, glovR] = hide(part(bakeW(box(0.26, 0.18, 0.26)), W, 0, -0.56, 0), part(bakeW(box(0.26, 0.18, 0.26)), W, 0, -0.56, 0));
  armL.add(glovL); armR.add(glovR);
  const [capeM, amul] = hide(part(bakeW(box(0.64, 0.94, 0.09)), W, 0, -0.14, -0.27), part(bakeW(box(0.14, 0.16, 0.05)), W, 0, 0.24, 0.235));
  torso.add(capeM, amul);
  const [helm] = hide(part(bakeW(box(0.52, 0.3, 0.52)), W, 0, 1.79, 0));
  const [wizHat] = hide(part(merge([bakeW(box(0.62, 0.05, 0.62)).translate(0, 1.905, 0), bakeW(shift(cone(0.30, 0.52, 6), 0.26)).translate(0, 1.93, 0)]), W, 0, 0, 0));
  // the ranger's bycocket: a thin triangle in the front-back plane, beak forward
  const rhSh = new THREE.Shape();
  rhSh.moveTo(-0.30, 0.02); rhSh.lineTo(0.36, 0.07); rhSh.lineTo(0.02, 0.32); rhSh.closePath();
  const rhGeo = new THREE.ExtrudeGeometry(rhSh, { depth: 0.22, bevelEnabled: false });
  rhGeo.translate(0, 0, -0.11); rhGeo.rotateY(-PI / 2);
  const [rhHat] = hide(part(bakeW(rhGeo), W, 0, 1.90, 0));
  const [skirt] = hide(part(bakeW(shift(cyl(0.34, 0.52, 0.80, 7), 0.40)), TUNIC, 0, 0.05, 0));
  const [wep] = hide(part(bakeW(shift(box(0.12, 1.0, 0.3), -0.42)), W, 0, -0.60, 0.05)); armR.add(wep);
  const [shl] = hide(part(bakeW(box(0.1, 0.66, 0.52)), W, 0.16, -0.40, 0.02)); armL.add(shl);   // strapped to the forearm
  const eyeL = part(bakeW(box(0.09, 0.07, 0.03)), 0x1d1712, 0.11, 1.72, 0.235), eyeR = part(bakeW(box(0.09, 0.07, 0.03)), 0x1d1712, -0.11, 1.72, 0.235);
  const [brow, mo, beard, paint] = hide(part(bakeW(box(0.34, 0.06, 0.03)), 0x2a1f16, 0, 1.785, 0.235), part(bakeW(box(0.26, 0.06, 0.03)), 0x2a1f16, 0, 1.60, 0.235),
    part(bakeW(box(0.38, 0.20, 0.08)), 0x2a1f16, 0, 1.475, 0.21), part(bakeW(box(0.46, 0.05, 0.03)), 0x8a2f27, 0, 1.665, 0.235));
  g.add(torso, head, hair, armL, armR, legL, legR, helm, wizHat, rhHat, skirt, eyeL, eyeR, brow, mo, beard, paint);
  g.parts = { torso, head, hair, armL, armR, legL, legR, calfL, calfR, bootL, bootR, glovL, glovR, capeM, amul, helm, wizHat, rhHat, skirt, wep, shl, legHid: 0,
              face: { eyeL, eyeR, brow, mo, beard, paint } };
  return g;
}
/* ---- 12. THE BESTIARY: a rig is one merged body plus limbs pivoted at their joints; builders take proportions and a palette ---- */
const rig = (core, limbs, bodyC) => ({ body: merge(core), limbs: limbs || [], bodyC });
const limb = (kind, s, geo, x, y, z, a) => ({ kind, s, geo, x, y, z, a });   // a: swing amplitude where the kind's default is wrong
const flatGeo = spec => spec.limbs.length ? merge([spec.body].concat(spec.limbs.map(L => L.geo.clone().translate(L.x, L.y, L.z)))) : spec.body;
const noCull = m => { m.frustumCulled = false; return m; };
function riggedMesh(spec, material) {
  const M = material || mat;
  if (!spec.limbs.length) return noCull(new THREE.Mesh(spec.body, M));
  const g = new THREE.Group();
  g.limbs = [];
  g.add(noCull(new THREE.Mesh(spec.body, M)));
  for (const L of spec.limbs) {
    const m = noCull(new THREE.Mesh(L.geo, M));
    m.position.set(L.x, L.y, L.z);
    if (L.base !== undefined) m.rotation.y = L.base;   // a splayed limb rests at its own yaw before any gait touches it
    g.add(m); g.limbs.push({ m, kind: L.kind, s: L.s, ph: L.ph || 0, base: L.base || 0, a: L.a });
  }
  return g;
}
const pair = (kind, geo, x, y, z) => [limb(kind, 1, geo, x, y, z), limb(kind, -1, geo, -x, y, z)];
function humanoid(o) {
  const w = o.w, h = o.h, body = o.body, skin = o.skin || body;
  const core = [shade(shift(box(w, h * 0.46, w * 0.6), h * 0.74), body), shade(shift(box(w * 0.6, w * 0.58, w * 0.6), h * 1.0), skin)];
  if (o.horns) for (const s of [-1, 1]) core.push(shade(shift(cone(w * 0.12, h * 0.26, 4), h * 1.28).translate(s * w * 0.22, 0, 0), o.horn || [0.9, 0.88, 0.82]));
  if (o.ears) for (const s of [-1, 1]) core.push(shade(shift(cone(w * 0.1, w * 0.4, 4), h * 1.02).rotateZ(s * 1.1).translate(s * w * 0.38, 0, 0), skin));
  if (o.belt) core.push(shade(shift(box(w * 1.04, h * 0.08, w * 0.64), h * 0.6), o.belt));
  const limbs = pair('leg', shade(shift(box(w * 0.3, h * 0.52, w * 0.3), -h * 0.26), body), w * 0.26, h * 0.52, 0);
  if (o.arms !== 0) limbs.push(...pair('arm', shade(shift(box(w * 0.26, h * 0.44, w * 0.26), -h * 0.22), o.arm || body), w * 0.63, h * 0.94, 0));
  if (o.wings) for (const s of [-1, 1]) limbs.push(limb('wing', s,
    shade(box(w * 0.1, h * 0.6, h * 0.5).translate(s * w * 0.72, h * 0.85, -w * 0.3).rotateY(s * 0.5).translate(-s * w * 0.35, -h * 0.85, w * 0.3), o.wing || [0.22, 0.14, 0.14]),
    s * w * 0.35, h * 0.85, -w * 0.3));
  return rig(core, limbs, body);
}
function quadruped(o) {
  const w = o.w, h = o.h, L = o.len || w * 1.7, body = o.body;
  const core = [shade(shift(box(w, h * 0.5, L), h * 0.62), body), shade(shift(box(w * 0.62, h * 0.44, w * 0.66), h * 0.8).translate(0, 0, L * 0.56), o.head || body)];
  if (o.tail) core.push(shade(shift(box(w * 0.16, w * 0.16, L * 0.5), h * 0.68).translate(0, 0, -L * 0.66), o.tail));
  if (o.horns) for (const s of [-1, 1]) core.push(shade(shift(cone(w * 0.11, h * 0.3, 4), h * 1.0).translate(s * w * 0.24, 0, L * 0.5), [0.92, 0.9, 0.84]));
  if (o.snout) core.push(shade(shift(box(w * 0.34, h * 0.2, w * 0.4), h * 0.72).translate(0, 0, L * 0.86), o.head || body));
  const limbs = [];   // legs: 0 keeps the barrel on the ground; diagonal pairs share a phase
  if (o.legs !== 0) {
    const legG = shade(shift(box(w * 0.24, h * 0.5, w * 0.24), -h * 0.25), o.leg || body);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) limbs.push(limb('qleg', sx * sz, legG, sx * w * 0.34, h * 0.5, sz * L * 0.34));
  }
  return rig(core, limbs, body);
}
function spiderGeo(o) {
  const w = o.w, h = o.h || o.w, body = o.body;
  const core = [shade(shift(octa(w * 0.55), h * 0.5).translate(0, 0, -w * 0.3), body), shade(shift(octa(w * 0.34), h * 0.46).translate(0, 0, w * 0.42), o.head || body)];
  const limbs = [];
  for (let i = 0; i < 8; i++) {   // four hips a flank; each leg pivots at its own hip so the gait can sweep it
    const s = i < 4 ? 1 : -1, r = i % 4;
    const geo = shade(box(w * 0.09, w * 0.09, w * 1.05).translate(0, 0, w * 0.52).rotateX(0.42), o.leg || body);
    const L = limb('sleg', s, geo, s * w * 0.36, h * 0.42, w * 0.14 - r * w * 0.2);
    L.base = s * (0.55 + r * 0.42);
    L.ph = (r & 1) * PI + (s < 0 ? PI / 2 : 0) + r * 0.3;   // alternating tetrapod, the flanks half a beat apart
    limbs.push(L);
  }
  return rig(core, limbs, body);
}
function dragonGeo(o) {
  const w = o.w, h = o.h, body = o.body;
  const l = [
    shade(shift(box(w, h * 0.5, w * 1.9), h * 0.62), body), shade(shift(box(w * 0.44, h * 0.4, w * 0.9), h * 1.0).translate(0, 0, w * 1.05), body),
    shade(shift(box(w * 0.5, h * 0.34, w * 0.7), h * 1.16).translate(0, 0, w * 1.6), o.head || body), shade(shift(box(w * 0.3, h * 0.14, w * 0.34), h * 1.06).translate(0, 0, w * 2.0), o.head || body)
  ];
  for (const s of [-1, 1]) l.push(shade(shift(cone(w * 0.12, h * 0.34, 4), h * 1.34).translate(s * w * 0.16, 0, w * 1.62), [0.92, 0.9, 0.84]));
  const legG = shade(shift(box(w * 0.26, h * 0.5, w * 0.3), -h * 0.25), body), limbs = [];
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) limbs.push(limb('qleg', sx * sz, legG, sx * w * 0.4, h * 0.5, sz * w * 0.66));
  for (const s of [-1, 1]) limbs.push(limb('wing', s,
    shade(box(w * 0.1, h * 0.9, w * 1.5).translate(s * w * 0.7, h * 1.05, -w * 0.2).rotateY(s * 0.35).translate(-s * w * 0.3, -h * 1.05, w * 0.2), o.wing || body),
    s * w * 0.3, h * 1.05, -w * 0.2, 0.5));   // a dragon beats its wings, where a demon only stirs them
  limbs.push(limb('tail', 1, merge([0, 1, 2, 3].map(i =>   // the tail is a limb so it can wag; same boxes, hinged at the barrel's end
    shade(box(w * (0.4 - i * 0.07), h * 0.16, w * 0.5).translate(0, -h * 0.02, -w * (0.1 + i * 0.42)), body))), 0, h * 0.68, -w * 0.9));
  return rig(l, limbs, body);
}
function skeletonGeo(o) {
  const w = o.w, h = o.h, c = o.body || [0.87, 0.86, 0.79];
  const l = [shade(shift(box(w * 0.5, w * 0.5, w * 0.46), h * 1.0), c), shade(shift(box(w * 0.12, h * 0.4, w * 0.12), h * 0.56), c)];
  for (let i = 0; i < 4; i++) l.push(shade(shift(box(w * 0.66, h * 0.05, w * 0.4), h * 0.86 - i * h * 0.09), c));
  const limbs = pair('arm', shade(shift(box(w * 0.14, h * 0.44, w * 0.14), -h * 0.22), c), w * 0.42, h * 0.9, 0)
    .concat(pair('leg', shade(shift(box(w * 0.16, h * 0.5, w * 0.16), -h * 0.25), c), w * 0.2, h * 0.5, 0));
  return rig(l, limbs, c);
}
/* a hem that trails off and no legs; in opaque cloth it is every hooded human; `hat` adds the wizard's point */
function ghostGeo(o) {
  const w = o.w, h = o.h, c = o.body;
  const l = [shade(shift(cone(w * 0.7, h * 0.8, 7), h * 0.4), c), shade(shift(box(w * 0.56, w * 0.54, w * 0.52), h * 0.94), o.head || c),
    shade(shift(box(w * 0.2, h * 0.34, w * 0.2), h * 0.66).translate(w * 0.5, 0, 0), c), shade(shift(box(w * 0.2, h * 0.34, w * 0.2), h * 0.66).translate(-w * 0.5, 0, 0), c)];
  if (o.hat) { const top = h * 0.94 + w * 0.27; l.push(shade(shift(box(w * 0.68, h * 0.03, w * 0.68), top + h * 0.015), c), shade(shift(cone(w * 0.34, h * 0.26, 6), top + h * 0.16), c)); }
  return rig(l, [], c);
}

/* Stats follow the wiki (lv/hp/atk/str/def per monster). db: defence bonus on the player-gear scale; abon: attack bonus; sbon: strength
   bonus (feeds the shared max-hit formula); max: max-hit override, only where the wiki max differs from the formula; mspd: tiles per
   tick; flee: livestock, never a slayer task; at: attack styles (m/r/g); agg: retaliates from range. Loot lives in LOOT, keyed by k.
   db and abon are single MELEE/RANGED scalars (stab/slash/crush stay folded, so the player's melee style choice is intentionally inert);
   magic is split out: casts roll mag against mdb and the defender's Magic, so robes and magic levels matter as in 2007.
   build(body) returns the rig; body is the row's primary colour.
   Rows are authored [k, n, lv, hp, atk, str, def, abon, sz, body, build, rest?]; NPC_ROW fills db: 0, spd: 4 unless rest overrides. */
const H = (w, h, x) => b => humanoid(Object.assign({ w, h, body: b }, x));
const Q = (w, h, len, x) => b => quadruped(Object.assign({ w, h, len, body: b }, x));
const SP = (w, h, head, leg) => b => spiderGeo({ w, h, body: b, head, leg });
const DR = (w, h, head, wing) => b => dragonGeo({ w, h, body: b, head, wing });
const SKEL = (w, h) => b => skeletonGeo({ w, h, body: b });
const GH = (w, h, head, hat) => b => ghostGeo({ w, h, body: b, head, hat });
const NPC_ROW = ([k, n, lv, hp, atk, str, def, abon, sz, body, build, o]) => Object.assign({ k, n, lv, hp, atk, str, def, abon, sz, body, build, db: 0, spd: 4 }, o);
/* NPCS rows live in data07.js; C3 unpacks the 6-digit colour strings (exact: n/100), bdec rebuilds the factory call. */
const C3 = s => [+s.slice(0, 2) / 100, +s.slice(2, 4) / 100, +s.slice(4, 6) / 100];
const FACT = { H, Q, SP, DR, SKEL, GH };
const c3q = a => typeof a === 'string' && /^\d{6}$/.test(a) ? C3(a) : a;
const xdec = x => { const o = {}; for (const k in x) o[k] = c3q(x[k]); return o; };
const bdec = b => FACT[b[0]](...b.slice(1).map(a => a && typeof a === 'object' && !Array.isArray(a) ? xdec(a) : c3q(a)));
const NPC_TYPES = NPCS.map(r => NPC_ROW([...r.slice(0, 9), C3(r[9]), bdec(r[10]), r[11]]));
NPC_TYPES.find(t => t.k === 'masterfarmer').pick.loot = [500, 300, 250, 180, 80, 50, 20, 60, 40, 30, 20, 12, 10, 8, 6, 5, 3, 3, 2, 2, 1].map((w, i) => [CROPS[i].seed, w]);

/* ---- 12b. NAMED BOSSES: a family's build at monster scale with the wiki's own stat block; they fight in phases and roam lairs.
   Levels are the game's; hp/atk/str/def/abon/sbon come off each boss's wiki page. max only where the formula misses the wiki max
   (Evil Chicken's magic 21, Sarachnis 31, Venenatis' ranged 35, Callisto's crush 55); fmax is dragonfire where it isn't the plain 50.
   Loot lives in LOOT under the boss's key. Quest-boss rows with no wiki bonuses carry db 0. TODO: verify — bktitan/trollking/slashbash/galvek/elvarg defence bonuses. */
for (const [k, n, bk, lv, hp, atk, str, def, db, abon, sbon, max, fmax, at, rng, spd, mspd, scale, tint, bolt, arrow] of BOSSES) {
  const base = NPC_TYPES.find(t => t.k === bk);
  NPC_TYPES.push({ k, n, boss: 1, big: 1, agg: 1, fire: base.fire || 0, lv, hp, atk, str, def, db, abon, sbon, max, fmax, at, rng, spd, mspd, sz: base.sz * scale, scale,
    bolt: bolt || base.bolt, arrow: arrow || base.arrow, tint: tint || null, body: base.body, build: base.build });
}
NPC_TYPES.forEach((t, i) => {
  if (t.db === undefined) throw new Error('NPC type "' + t.k + '" has no db');
  if (t.abon === undefined) t.abon = Math.round(t.lv * 0.35);
  if (t.sbon === undefined) t.sbon = 0;
  if (t.max === undefined) t.max = null;
  if (t.mspd === undefined) t.mspd = 1;
  const m = MAGIC_STATS[t.k];
  t.mag = m ? m[0] : 1; t.mdb = m ? m[1] : 0;
  t.psn = { poisonspider: 6, kalphitesoldier: 4, scorpia: 20 }[t.k] || 0;   // wiki starting poison damage
  if (t.fire) t.bones = 'dragon_bones';   // dragonkind leave dragon bones; everything else keeps the big/small split
  t.i = i;
});
const NPC_BY = Object.create(null); NPC_TYPES.forEach(t => NPC_BY[t.k] = t);

/* ---- 12c. LEVEL VARIANTS: every rung is the wiki's own stat block, never a scaled copy. A bare number is the base row's level;
   extra rungs are [lv, hp, atk, str, def, sbon?, max?] straight off the monster's wiki page (db, abon and speed inherit the base
   row; an omitted sbon inherits too, so rungs whose wiki bonus differs from the base carry it explicitly; a null max forces the
   formula past a base override). A spawnable type missing here, or a bare rung that is not the row's own level, throws at
   startup — fabricated levels stay impossible. Base rung first and commonest. ---- */
function variantOf(t, r) {
  if (typeof r === 'number') { if (r !== t.lv) throw new Error(t.k + '@' + r + ' has no authored stats'); return t; }
  t.vars = t.vars || Object.create(null);
  const L = r[0];
  let v = t.vars[L];
  if (v) return v;
  v = Object.create(t);
  Object.assign(v, { base: t, lv: L, hp: r[1], atk: r[2], str: r[3], def: r[4], sbon: r[5] !== undefined ? r[5] : t.sbon, max: r[6] !== undefined ? r[6] : t.max });
  return t.vars[L] = v;
}
const SPAWNABLE = [];
for (const t of NPC_TYPES) {
  if (t.boss || t.town) continue;
  const l = LADDERS[t.k];
  if (!l) throw new Error('NPC type "' + t.k + '" has no LADDERS entry');
  l.forEach((r, i) => { const v = variantOf(t, r); v.vw = 1 / Math.pow(1 + i, 0.9); SPAWNABLE.push(v); });
}
function npcByName(s) {   // "goblin@13"
  const [k, L] = String(s).split('@'), t = NPC_BY[k];
  return t && L ? (t.vars && t.vars[+L]) || t : t;
}
/* ---- 12d. DROP TABLES: each family's wiki table, mapped onto this game's items. den + main: one weighted [id, w, min, max]
   roll per `rolls` (weight short of den = the empty slot, holding the place of entries with no counterpart here); ids
   'rdt'/'gem'/'mega'/'herb'/'seed'/'useed'/'rseed' divert to the shared tables. alw: guaranteed drops beyond bones/meat.
   tert: independent 1-in-N rolls [id, N, min, max]. nb: leaves no bones (ghosts, demons' ashes, imps, shades' remains).
   'k@lv' entries override a single rung (wilderness / catacombs variants). Variants otherwise share the base row's table.
   Flagged game-economy deviations (kept so no skill starves, each a ground spawn or shop pickup in OSRS): spiders' eggs,
   kalphite potato cactus, ghoul/shade fungus, Monk of Zamorak wine. Quest bosses with no OSRS table wear their family's
   table with signature pieces at placeholder rates - TODO: verify (elvarg, galvek, trollking, bktitan, evilchicken, slashbash). */
LOOT.woman = LOOT.man; LOOT.rogue = LOOT.man; LOOT.redgoblin = LOOT.goblin; LOOT.giantskeleton = LOOT.skelwarrior; LOOT.babybluedragon = LOOT.babygreendragon;
/* clue scrolls, at each monster's own wiki tertiary rate: [tier (0 easy, 1 medium, 2 hard/elite), 1-in-N].
   Monsters without a row drop none; Skotizo's guaranteed hard clue is the 1-in-1. */
for (const [k, t, n] of [['chicken', 0, 300], ['cow', 0, 128], ['man', 0, 90], ['goblin', 0, 64], ['barbarian', 0, 75], ['skeleton', 0, 100], ['ghost', 0, 90],
  ['mugger', 0, 80], ['farmer', 0, 90], ['darkwizard', 0, 50], ['thug', 0, 128], ['dwarf', 0, 100], ['banshee', 0, 128], ['bear', 0, 90], ['grizzly', 0, 90],
  ['boar', 0, 128], ['hillgiant', 0, 50], ['mossgiant', 0, 45], ['icegiant', 0, 40], ['obor', 0, 50], ['bryophyta', 0, 45],
  ['guard', 1, 128], ['paladin', 1, 128], ['icewarrior', 1, 128], ['jogre', 1, 129], ['scurrius', 1, 25],
  ['greaterdemon', 2, 128], ['blackdemon', 2, 128], ['greendragon', 2, 128], ['bluedragon', 2, 128], ['reddragon', 2, 128], ['blackdragon', 2, 128],
  ['bronzedragon', 2, 128], ['irondragon', 2, 128], ['steeldragon', 2, 64], ['mithrildragon', 2, 350], ['adamantdragon', 2, 320], ['runedragon', 2, 300],
  ['cyclops', 2, 512], ['cyclops@106', 2, 256], ['spectre', 2, 128], ['druid@129', 2, 128], ['scorpia', 2, 100], ['kbd', 2, 450], ['vorkath', 2, 65],
  ['sarachnis', 2, 40], ['skotizo', 2, 1], ['kalphitequeen', 2, 100], ['vetion', 2, 100], ['venenatis', 2, 100], ['callisto', 2, 100],
  ['graardor', 2, 250], ['kril', 2, 250], ['eldric', 2, 25], ['branda', 2, 25]]) LOOT[k].clue = [t, n];
LOOT.elvarg = Object.assign({}, LOOT.greendragon, { tert: [['dragon_dagger', 128], ['green_dhide_body', 128]] });   // TODO: verify — quest boss signatures
LOOT.galvek = Object.assign({}, LOOT.steeldragon, { tert: [['dragon_crossbow', 300], ['dragon_platelegs', 300], ['dragon_sq_shield', 300]] });   // TODO: verify
LOOT.trollking = Object.assign({}, LOOT.troll, { tert: [['dragon_sq_shield', 128], ['dragon_gauntlets', 128]] });   // TODO: verify
delete LOOT.elvarg.clue; delete LOOT.galvek.clue;   // quest bosses assign no trails; the copies must not inherit their family's row
for (const t of NPC_TYPES) if (!LOOT[t.k]) throw new Error('NPC type "' + t.k + '" has no LOOT entry');   // no silent fallback loot
/* shopkeepers never walk, so their rig is flattened into one instanced geometry */
const npcGeo = (bodyC, headC, w, h) => flatGeo(humanoid({ w, h, body: bodyC, skin: headC }));
const KEEP_GEO = npcGeo([0.55, 0.42, 0.28], [0.82, 0.66, 0.5], 0.66, 1.55);
/* ---- STAGE 2: the plan of a town. One tile grid, claimed in a fixed order: streets, walls, castle, houses, parks. ---- */
const FLOOR_TOP = 0.20, WALL_T = 0.30;
const C_WALL = [0.808, 0.745, 0.612], C_BEAM = [0.361, 0.263, 0.184], C_FLOOR = [0.522, 0.396, 0.259], C_FOUND = [0.478, 0.463, 0.435];
const C_ROOF = [0.435, 0.204, 0.157], C_ROOF2 = [0.325, 0.271, 0.239], C_ROOF3 = [0.298, 0.318, 0.365], C_ROOF4 = [0.451, 0.353, 0.180];
const C_DARK = [0.106, 0.098, 0.086], C_CLOTH = [0.741, 0.706, 0.612], C_STONE = [0.545, 0.533, 0.502], C_STONE2 = [0.451, 0.439, 0.412];
const C_SLATE = [0.286, 0.290, 0.325], C_BANNER = [0.549, 0.145, 0.176], C_SIGN = [0.392, 0.286, 0.180], C_THATCH = [0.604, 0.514, 0.286], C_GOLD = [0.804, 0.635, 0.239];
const ROOFS = [C_ROOF, C_ROOF2, C_ROOF3, C_ROOF4];
const tk = (x, z) => x * 4194304 + z;   // tile key
const floorMap = new Map();   // tile -> building you stand in
const G_EMPTY = 0, G_ROAD = 1, G_PAVED = 2, G_BUILD = 3, G_WALL = 4, G_GATE = 5, G_PARK = 6, G_KEEP = 7, G_GE = 8;
/* door side 0..3 → outward unit vector */
const DDX = [0, 1, 0, -1], DDZ = [-1, 0, 1, 0];
const hexRgb = h => { const n = hexInt(h); return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255]; };
/* an axis-aligned prop: horiz picks which of (a, b) is the long side */
const abox = (B, x, y, z, horiz, a, h, b, col) => B.add(BOX, x, y, z, horiz ? a : b, h, horiz ? b : a, 0, col);

function emitShell(B, b) {
  const { x, z, y, w, d, h } = b, hw = w / 2, hd = d / 2, t = WALL_T, dr = b.door;
  const CW = b.stone || b.bank ? C_STONE : C_WALL, CB = b.stone || b.bank ? C_STONE2 : C_BEAM;
  B.add(BOX, x, y - 2.12, z, w + 0.8, 4.4, d + 0.8, 0, C_FOUND);   // plinth tops out above the floorboards (no z-fight)
  B.add(BOX, x, y - 0.05, z, w, 0.5, d, 0, C_FLOOR);
  for (let s = 0; s < 4; s++) {
    const horiz = !(s & 1), along = horiz ? w : d, ha = along / 2;
    const cx = x + DDX[s] * (hw - t / 2), cz = z + DDZ[s] * (hd - t / 2);
    const seg = (c, yy, len, hh, col, tt) => horiz ? B.add(BOX, c, yy, cz, len, hh, tt || t, 0, col) : B.add(BOX, cx, yy, c, tt || t, hh, len, 0, col);
    const base = horiz ? x : z;
    if (s !== dr) {
      seg(base, y + FLOOR_TOP + h / 2, along, h, CW);
      if (!b.stone && along > 2.6) {   // exposed timber framing
        seg(base, y + FLOOR_TOP + h * 0.52, along, 0.22, CB, t + 0.08);
        for (const q of [-0.27, 0.27]) seg(base + along * q, y + FLOOR_TOP + h / 2, 0.24, h, CB, t + 0.08);
      }
      if ((hash2(b.x + s, b.z, S + 71) & 3) !== 0)   // shuttered window
        abox(B, horiz ? x : cx, y + FLOOR_TOP + 1.5, horiz ? cz : z, horiz, Math.min(1.4, along * 0.36), 1.0, t + 0.14, C_DARK);
    } else {
      const gap = 1.0, side = ha - gap;
      if (side > 0.05) { seg(base - (ha + gap) / 2, y + FLOOR_TOP + h / 2, side, h, CW); seg(base + (ha + gap) / 2, y + FLOOR_TOP + h / 2, side, h, CW); }
      seg(base, y + FLOOR_TOP + 2.2 + (h - 2.2) / 2, gap * 2, h - 2.2, CB);
      abox(B, x + DDX[s] * (hw + 0.5), y + 0.03, z + DDZ[s] * (hd + 0.5), horiz, 2.2, 0.34, 1.4, C_FOUND);   // doorstep
    }
  }
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) B.add(BOX, x + sx * (hw - t / 2), y + FLOOR_TOP + h / 2, z + sz * (hd - t / 2), t * 1.3, h, t * 1.3, 0, CB);
  if (b.bank) {   // gold frieze as four bands, so the roof can still lift
    const fy = y + FLOOR_TOP + h - 0.3;
    for (const s of [-1, 1]) { B.add(BOX, x, fy, z + s * (hd + 0.02), w + 0.34, 0.3, 0.22, 0, C_GOLD); B.add(BOX, x + s * (hw + 0.02), fy, z, 0.22, 0.3, d + 0.34, 0, C_GOLD); }
    const ox = DDX[dr] * hw, oz = DDZ[dr] * hd;
    for (const sg of [-1, 1]) B.add(BOX, x + ox + (oz ? sg * 1.4 : 0), y + FLOOR_TOP + h / 2, z + oz + (ox ? sg * 1.4 : 0), 0.5, h, 0.5, 0, C_STONE2);   // pilasters
  }
  if (b.shop !== null) emitShopFit(B, b); else if (b.bank) emitBankFit(B, b); else emitHomeFit(B, b);
}
/* a counter across the room one tile in from the far wall: horiz when the door is on a z face */
function emitCounter(B, b, y, col, top) {
  const horiz = !(b.door & 1);
  abox(B, horiz ? b.x : b.cx, y + 0.5, horiz ? b.cz : b.z, horiz, (horiz ? b.w : b.d) - 1.6, 1.0, 0.7, col);
  if (top) abox(B, horiz ? b.x : b.cx, y + 1.04, horiz ? b.cz : b.z, horiz, (horiz ? b.w : b.d) - 1.5, 0.08, 0.8, top);
}
/* a point against the back wall, `in` tiles from it */
const backOf = (b, inset) => [b.x - DDX[b.door] * (b.w / 2 - inset), b.z - DDZ[b.door] * (b.d / 2 - inset)];
function emitBankFit(B, b) {
  const y = b.y + FLOOR_TOP;
  emitCounter(B, b, y, C_STONE2, C_GOLD);
  const [sx, sz] = backOf(b, 0.8);
  B.add(BOX, sx, y + 0.5, sz, 1.2, 1.0, 0.9, 0, C_DARK);   // the strongbox
  B.add(BOX, sx, y + 1.02, sz, 1.26, 0.1, 0.96, 0, C_GOLD);
}
function emitHomeFit(B, b) {   // furniture sits opposite the door
  const x = b.x, z = b.z, y = b.y + FLOOR_TOP, hw = b.w / 2, hd = b.d / 2, fh = hash2(b.x, b.z, S + 73);
  const bx = x - DDX[b.door] * (hw - 1.4), bz = z - DDZ[b.door] * (hd - 1.2);
  B.add(BOX, bx, y + 0.28, bz, 1.9, 0.36, 1.05, 0, C_BEAM); B.add(BOX, bx, y + 0.52, bz, 1.85, 0.16, 1.0, 0, C_CLOTH);
  const tx = x + ((fh & 1) ? 1 : -1) * (hw * 0.4), tz = z + ((fh & 2) ? 1 : -1) * (hd * 0.4);
  B.add(BOX, tx, y + 0.80, tz, 1.3, 0.12, 0.8, 0, C_FLOOR); B.add(BOX, tx, y + 0.40, tz, 0.32, 0.8, 0.32, 0, C_BEAM);
  B.add(BOX, tx + 0.95, y + 0.22, tz, 0.42, 0.44, 0.42, 0, C_BEAM);
  if (fh & 4) B.add(BOX, x - hw + 0.9, y + 0.35, z + hd - 0.9, 0.7, 0.7, 0.7, 0, C_FLOOR);
}
function emitShopFit(B, b) {   // counter, shelves and a painted sign over the door
  const x = b.x, z = b.z, y = b.y + FLOOR_TOP, hw = b.w / 2, hd = b.d / 2, k = SHOP_KINDS[b.shop], horiz = !(b.door & 1);
  emitCounter(B, b, y, [0.55, 0.42, 0.28]);
  const [sx, sz] = backOf(b, 0.5);
  if (k.k === 'pub') {   // the bar: kegs behind the counter, a round table and stools by the door
    for (const sg of [-1, 1]) {
      const kx = sx + (horiz ? sg * 1.1 : 0), kz = sz + (horiz ? 0 : sg * 1.1);
      B.add(CYL8, kx, y + 0.55, kz, 0.95, 1.1, 0.95, 0, C_SIGN); B.add(BOX, kx, y + 1.14, kz, 1.0, 0.1, 1.0, 0, C_BEAM);
    }
    const tx2 = x + DDX[b.door] * 0.5 + (horiz ? 1.3 : 0), tz2 = z + DDZ[b.door] * 0.5 + (horiz ? 0 : 1.3);
    B.add(BOX, tx2, y + 0.42, tz2, 0.3, 0.84, 0.3, 0, C_BEAM); B.add(CYL8, tx2, y + 0.9, tz2, 1.7, 0.12, 1.7, 0, C_FLOOR);
    B.add(CYL8, tx2, y + 1.0, tz2, 0.34, 0.3, 0.34, 0, [0.79, 0.51, 0.16]);
    for (const sg of [-1, 1]) B.add(BOX, tx2 + sg * 1.25, y + 0.26, tz2 + sg * 0.4, 0.4, 0.52, 0.4, 0, C_BEAM);
  } else
  for (let i = 0; i < 3; i++) abox(B, sx, y + 0.7 + i * 0.62, sz, horiz, (horiz ? b.w : b.d) - 1.8, 0.1, 0.5, C_BEAM);
  const ox = x + DDX[b.door] * (hw + 0.7), oz = z + DDZ[b.door] * (hd + 0.7), sy = b.y + FLOOR_TOP + b.h - 0.4;
  abox(B, ox, sy + 0.42, oz, horiz, 0.16, 0.16, 0.9, C_BEAM);
  abox(B, ox, sy - 0.15, oz, horiz, 1.5, 0.85, 0.12, C_SIGN);
  abox(B, ox, sy - 0.15, oz, horiz, 1.0, 0.4, 0.16, hexRgb(k.c));
}
/* furnace (3), anvil (4) or cooking range (6); indoors at 0.66 scale to fit under a roof */
function emitForge(B, f) {
  const x = f.x, y = f.y, z = f.z, s = f.in ? 0.66 : 1;
  const b = (dx, dy, dz, w, h, d, col, geo, rot) => B.add(geo || BOX, x + dx * s, y + dy * s, z + dz * s, w * s, h * s, d * s, rot || 0, col);
  if (f.t === 6) {
    if (b07(B, 'Cooking range', x, y, z, s, PI / 2)) return;   // the cache range runs long in z; the proc one long in x
    b(0, 0.55, 0, 1.9, 1.1, 1.3, C_STONE2); b(0, 1.16, 0, 2.1, 0.14, 1.5, C_DARK); b(0, 0.55, 0.68, 1.3, 0.7, 0.1, C_DARK);
    b(0, 0.45, 0.74, 1.0, 0.44, 0.06, [0.95, 0.45, 0.10]); b(-0.6, 1.9, -0.3, 0.5, 1.5, 0.5, C_STONE2);
  } else if (f.t === 3) {
    if (b07(B, 'Furnace', x, y, z, s)) return;
    b(0, 1.35, 0, 3.0, 2.7, 3.0, C_STONE); b(0, 2.78, 0, 3.3, 0.3, 3.3, C_STONE2); b(0.7, 3.5, -0.6, 1.0, 1.6, 1.0, C_STONE2, CYL8);
    b(0, 0.95, 1.5, 1.3, 1.3, 0.3, C_DARK); b(0, 0.8, 1.62, 1.0, 0.8, 0.16, [0.98, 0.55, 0.10]);
    if (!f.in) B.add(BOX, x - 1.9, y + 0.35, z + 0.4, 0.9, 0.7, 0.9, 0, C_BEAM);
  } else if (f.t === 13) {   // the saw bench: a blade standing in a log, sawdust and a plank stack beside
    b(0, 0.45, 0, 2.4, 0.9, 1.0, C_BEAM); b(0, 1.1, 0, 1.8, 0.4, 0.4, BARK); b(0.35, 1.25, 0, 0.08, 1.2, 1.2, [0.62, 0.64, 0.68]);
    b(-0.5, 0.12, 0.95, 1.2, 0.3, 0.7, [0.80, 0.68, 0.44], BLOB); b(1.9, 0.25, 0.2, 0.5, 0.5, 1.6, [0.72, 0.58, 0.36]);
  } else {
    if (b07(B, 'Anvil', x, y, z, s)) return;
    b(0, 0.30, 0, 1.5, 0.6, 1.5, C_BEAM); b(0, 0.78, 0, 0.6, 0.4, 0.6, [0.30, 0.29, 0.31]); b(0, 1.16, 0, 2.0, 0.42, 0.9, [0.34, 0.33, 0.35]);
    b(1.25, 1.16, 0, 0.9, 1.0, 0.8, [0.34, 0.33, 0.35], CONE8, PI / 2);
    if (!f.in) B.add(BOX, x - 1.5, y + 0.5, z + 0.9, 0.7, 1.0, 0.7, 0, C_STONE2);
  }
}
/* the roof (and any upper storey) is its own mesh so it lifts the instant you step inside */
function emitRoof(B, b) {
  let base = b.y + FLOOR_TOP + b.h;
  if (b.bank) {
    B.add(BOX, b.x, base + 0.2, b.z, b.w + 0.9, 0.4, b.d + 0.9, 0, C_STONE2);
    for (const s of [-1, 1]) { B.add(BOX, b.x, base + 0.65, b.z + s * (b.d + 0.5) / 2, b.w + 0.9, 0.55, 0.4, 0, C_STONE); B.add(BOX, b.x + s * (b.w + 0.5) / 2, base + 0.65, b.z, 0.4, 0.55, b.d + 0.9, 0, C_STONE); }
    B.add(CYL8, b.x, base + 0.9, b.z, 1.9, 1.0, 1.9, 0, C_STONE); B.add(BLOB, b.x, base + 1.95, b.z, 2.2, 1.6, 2.2, 0, C_GOLD);
    return;
  }
  if (b.st2) {   // jettied upper storey
    const uh = 2.8, CW = b.stone ? C_STONE : C_WALL, CB = b.stone ? C_STONE2 : C_BEAM;
    B.add(BOX, b.x, base + 0.14, b.z, b.w + 0.7, 0.28, b.d + 0.7, 0, CB);
    B.add(BOX, b.x, base + 0.28 + uh / 2, b.z, b.w + 0.5, uh, b.d + 0.5, 0, CW);
    for (const sd of [-1, 1]) for (const sz of [-1, 1]) B.add(BOX, b.x + sd * b.w * 0.22, base + 0.28 + uh * 0.55, b.z + sz * (b.d / 2 + 0.33), 0.9, 1.0, 0.2, 0, C_DARK);
    base += 0.28 + uh;
  }
  const ow = b.w + 0.9, od = b.d + 0.9;
  B.add(BOX, b.x, base + 0.09, b.z, ow, 0.18, od, 0, C_ROOF2);
  const roofC = b.shop !== null ? C_ROOF2 : (b.roofC || C_ROOF);
  let rh;
  if (b.gable) { rh = 1.3 + Math.min(b.w, b.d) * 0.30; B.add(GABLE, b.x, base + 0.18, b.z, Math.max(ow, od) + 0.3, rh, Math.min(ow, od) + 0.1, ow >= od ? 0 : PI / 2, roofC); }
  else { rh = 1.2 + Math.max(b.w, b.d) * 0.24; B.add(PYR, b.x, base + 0.18 + rh / 2, b.z, ow / 0.7071, rh, od / 0.7071, 0, roofC); }
  if ((hash2(b.x, b.z, S + 74) & 1) === 0) B.add(BOX, b.x + b.w * 0.28, base + rh * 0.7, b.z - b.d * 0.28, 0.55, rh * 1.3, 0.55, 0, C_STONE2);   // chimney
}

/* ---- 13. THE CASTLE: gatehouse, mid-wall turrets, a two-tier hall with the banner, sheds and a well ---- */
function emitCastle(B, c) {
  const y = c.y, R = c.R, WH = 5.4, TH = 10 + (c.rank || 3), len = R * 2 + 1;
  B.add(BOX, c.x, y - 0.4, c.z, len, 0.9, len, 0, C_STONE2);
  for (let s = 0; s < 4; s++) {
    const horiz = !(s & 1), wx = c.x + DDX[s] * R, wz = c.z + DDZ[s] * R;
    const at = (t, dy, a, h, b, col, geo) => B.add(geo || BOX, horiz ? c.x + t : wx, y + dy, horiz ? wz : c.z + t, horiz ? a : b, h, horiz ? b : a, 0, col);
    if (s !== c.gate) {
      at(0, WH / 2, len, WH, 1.6, C_STONE);
      at(0, (WH + 2.2) / 2, 3.4, WH + 2.2, 3.4, C_STONE); at(0, WH + 3.2, 3.9, 2.0, 3.9, C_SLATE, PYR);
    } else {
      const side = (len - 5) / 2, off = (5 + side) / 2;
      for (const sg of [-1, 1]) at(sg * off, WH / 2, side, WH, 1.6, C_STONE);
      for (const sg of [-1, 1]) {   // twin drum towers
        at(sg * 3.1, (WH + 3.4) / 2, 3.4, WH + 3.4, 3.4, C_STONE, CYL8); at(sg * 3.1, WH + 3.6, 4.0, 0.5, 4.0, C_STONE2, CYL8); at(sg * 3.1, WH + 5.2, 4.1, 2.7, 4.1, C_SLATE, CONE8);
      }
      at(0, WH + 0.9, 6.6, 1.8, 2.0, C_STONE2); at(0, WH - 0.3, 3.4, 2.2, 0.25, C_DARK); at(0, WH + 2.7, 0.22, 1.7, 1.4, C_BANNER);
    }
    for (let i = 0, n = Math.floor(len / 2); i <= n; i++) {   // battlements
      const t = -len / 2 + i * 2;
      if (s === c.gate && Math.abs(t) < 3) continue;
      at(t, WH + 0.45, 0.9, 0.9, 1.8, C_STONE2);
    }
  }
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {   // corner towers
    const tx = c.x + sx * R, tz = c.z + sz * R;
    B.add(CYL8, tx, y + TH / 2, tz, 4.6, TH, 4.6, 0, C_STONE); B.add(CYL8, tx, y + TH + 0.35, tz, 5.4, 0.7, 5.4, 0, C_STONE2);
    for (let i = 0; i < 6; i++) { const a = i / 6 * TAU; B.add(BOX, tx + Math.sin(a) * 2.5, y + TH + 1.05, tz + Math.cos(a) * 2.5, 0.8, 0.7, 0.8, 0, C_STONE2); }
    B.add(CONE8, tx, y + TH + 2.7, tz, 5.0, 3.4, 5.0, 0, C_SLATE); B.add(BOX, tx - sx * 2.28, y + TH * 0.55, tz, 0.34, 1.3, 0.5, 0, C_DARK);
  }
  const k = c.hall, h1 = k.h * 0.62, h2 = k.h * 0.38;   // the great hall
  B.add(BOX, k.x, y + h1 / 2, k.z, k.w, h1, k.d, 0, C_STONE); B.add(BOX, k.x, y + h1 + 0.35, k.z, k.w + 0.9, 0.7, k.d + 0.9, 0, C_STONE2);
  B.add(BOX, k.x, y + h1 + h2 / 2, k.z, k.w * 0.68, h2, k.d * 0.68, 0, C_STONE); B.add(BOX, k.x, y + k.h + 0.3, k.z, k.w * 0.68 + 0.8, 0.6, k.d * 0.68 + 0.8, 0, C_STONE2);
  for (let i = -Math.floor(k.w / 4), nb = -i; i <= nb; i++) for (const s of [-1, 1]) B.add(BOX, k.x + i * 2, y + h1 + 1.05, k.z + s * (k.d / 2 + 0.2), 0.9, 0.7, 0.6, 0, C_STONE2);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const tx = k.x + sx * k.w / 2, tz = k.z + sz * k.d / 2;
    B.add(CYL8, tx, y + h1 * 0.65, tz, 2.4, h1 * 1.3, 2.4, 0, C_STONE2); B.add(CONE8, tx, y + h1 * 1.3 + 1.2, tz, 2.8, 2.4, 2.8, 0, C_SLATE);
  }
  for (let i = -1; i <= 1; i++) for (const sz of [-1, 1]) B.add(BOX, k.x + i * k.w * 0.3, y + h1 * 0.55, k.z + sz * k.d / 2, 0.8, 1.6, 0.3, 0, C_DARK);
  B.add(BOX, k.x, y + k.h + 2.4, k.z, 0.22, 4.4, 0.22, 0, C_BEAM); B.add(BOX, k.x + 1.05, y + k.h + 3.9, k.z, 1.9, 1.1, 0.14, 0, C_BANNER);
  const gx = DDX[c.gate], gz = DDZ[c.gate];
  B.add(BOX, k.x + gx * k.w / 2, y + 1.5, k.z + gz * k.d / 2, gx ? 0.3 : 2.0, 3.0, gz ? 0.3 : 2.0, 0, C_DARK);
  B.add(BOX, k.x + gx * (k.w / 2 + 0.2), y + h1 - 1.4, k.z + gz * (k.d / 2 + 0.2), gx ? 0.2 : 1.6, 3.0, gz ? 0.2 : 1.6, 0, C_BANNER);
  for (const o of c.out) {
    B.add(BOX, o.x, y + o.h / 2, o.z, o.w - 0.2, o.h, o.d - 0.2, 0, C_WALL);
    B.add(GABLE, o.x, y + o.h, o.z, Math.max(o.w, o.d) + 0.7, 1.3, Math.min(o.w, o.d) + 0.7, o.w >= o.d ? 0 : PI / 2, C_ROOF2);
  }
  emitFurniture(B, { t: 1, x: c.well.x, z: c.well.z, y });
}
/* one tile of curtain wall: dressed stone (2) or palisade (1), with a tower where flagged */
function emitWallCell(B, w) {
  const y = w.y;
  if (w.k === 1) {
    B.add(BOX, w.x, y + 1.55, w.z, 2.05, 3.1, 0.9, 0, BARK2); B.add(BOX, w.x, y + 2.9, w.z, 2.05, 0.3, 1.1, 0, BARK);
    for (const s of [-0.6, 0, 0.6]) B.add(SPIRE, w.x + s, y + 3.4, w.z, 0.55, 0.9, 0.55, 0, BARK2);
    if (w.tower) {
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) B.add(BOX, w.x + sx * 1.05, y + 2.1, w.z + sz * 1.05, 0.3, 4.2, 0.3, 0, C_BEAM);
      B.add(BOX, w.x, y + 4.35, w.z, 2.9, 0.35, 2.9, 0, C_FLOOR); B.add(PYR, w.x, y + 5.5, w.z, 3.3, 1.9, 3.3, 0, C_ROOF2);
    }
    return;
  }
  const H = 5.2;
  B.add(BOX, w.x, y + H / 2, w.z, 2.0, H, 2.0, 0, C_STONE); B.add(BOX, w.x, y + H + 0.35, w.z, 2.3, 0.7, 2.3, 0, C_STONE2);
  if (((w.x + w.z) & 1) === 0) B.add(BOX, w.x, y + H + 0.95, w.z, 0.9, 0.9, 2.3, 0, C_STONE2);
  if (w.tower) {
    B.add(CYL8, w.x, y + H * 0.9, w.z, 3.6, H * 1.8, 3.6, 0, C_STONE); B.add(CYL8, w.x, y + H * 1.8 + 0.3, w.z, 4.2, 0.6, 4.2, 0, C_STONE2);
    B.add(CONE8, w.x, y + H * 1.8 + 1.9, w.z, 4.3, 2.8, 4.3, 0, C_SLATE);
  }
}
/* the gatehouse: twin towers either side of the road and a lintel between, dressed to match the wall */
function emitGate(B, g, rec) {
  const { x, z, y, ax, az, hw } = g, rot = Math.atan2(-az, ax), H = g.k === 2 ? 6.4 : 4.2;
  for (const s of [-1, 1]) {
    const tx = x + ax * s * hw, tz = z + az * s * hw;
    if (g.k === 2) { B.add(BOX, tx, y + H / 2, tz, 2.4, H, 2.4, rot, C_STONE); B.add(BOX, tx, y + H + 0.3, tz, 2.9, 0.6, 2.9, rot, C_STONE2); B.add(PYR, tx, y + H + 1.7, tz, 3.0, 2.2, 3.0, rot, C_SLATE); }
    else { B.add(BOX, tx, y + H / 2, tz, 0.9, H, 0.9, rot, BARK2); B.add(SPIRE, tx, y + H + 0.4, tz, 0.8, 1.0, 0.8, 0, BARK2); }
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) if (g.k === 2 || (!a && !b)) rec.blk.push(tk(Math.round(tx) + a, Math.round(tz) + b));
  }
  B.add(BOX, x, y + H - 0.9, z, hw * 2 - 1.2, g.k === 2 ? 1.6 : 0.5, g.k === 2 ? 1.8 : 0.6, rot, g.k === 2 ? C_STONE2 : BARK);
  if (g.k === 2) { B.add(BOX, x, y + H + 0.1, z, hw * 2 - 0.6, 0.6, 2.4, rot, C_STONE); B.add(BOX, x, y + H - 2.0, z, 0.2, 1.6, 1.2, rot, C_BANNER); }
}
/* square furniture: market stall (0), well (1), fountain (2) */
function emitFurniture(B, f) {
  const x = f.x, z = f.z, y = f.y;
  if (f.t === 0) {
    const awn = (f.k & 1) ? C_BANNER : [0.239, 0.357, 0.545], q = (f.k >>> 2) & 1, rot = q * PI / 2;
    if (b07(B, 'Market stall', x, y, z, 1, rot)) return;
    B.add(BOX, x, y + 0.55, z, 2.3, 1.1, 1.5, rot, C_FLOOR);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) B.add(BOX, x + sx * (q ? 0.65 : 1.05), y + 1.2, z + sz * (q ? 1.05 : 0.65), 0.16, 2.4, 0.16, 0, C_BEAM);
    B.add(GABLE, x, y + 2.35, z, 3.0, 0.9, 2.2, rot, awn);
    B.add(BLOB, x - 0.5, y + 1.32, z, 0.52, 0.4, 0.52, 0, [0.62, 0.49, 0.20]); B.add(BLOB, x + 0.5, y + 1.32, z + 0.2, 0.46, 0.4, 0.46, 0, [0.30, 0.50, 0.20]);
  } else if (f.t === 1) {
    if (b07(B, 'Well', x, y, z)) return;
    B.add(CYL8, x, y + 0.5, z, 2.0, 1.0, 2.0, 0, C_STONE); B.add(CYL8, x, y + 0.62, z, 1.5, 0.9, 1.5, 0, C_DARK);
    for (const s of [-1, 1]) B.add(BOX, x + s * 0.85, y + 1.5, z, 0.18, 2.0, 0.18, 0, C_BEAM);
    B.add(GABLE, x, y + 2.45, z, 2.4, 0.7, 1.6, 0, C_ROOF2);
  } else {
    if (b07(B, 'Fountain', x, y, z)) return;
    B.add(CYL8, x, y + 0.45, z, 3.6, 0.9, 3.6, 0, C_STONE); B.add(BOX, x, y + 0.8, z, 2.5, 0.16, 2.5, 0, [0.31, 0.55, 0.62]);
    B.add(CYL8, x, y + 1.5, z, 0.8, 1.6, 0.8, 0, C_STONE2); B.add(CYL8, x, y + 2.35, z, 1.7, 0.3, 1.7, 0, C_STONE); B.add(BLOB, x, y + 2.8, z, 0.7, 0.8, 0.7, 0, C_STONE2);
  }
}
/* landmarks: stone church (0), windmill (1), wizard's tower (2), manor (3) */
function emitLandmark(B, L) {
  const x = L.x, z = L.z, y = L.y;
  B.add(BOX, x, y - 1.9, z, L.R * 2 + 1.4, 4.4, L.R * 2 + 1.4, 0, C_FOUND);
  if (L.t === 0) {
    B.add(BOX, x + 0.8, y + 2.6, z + 0.2, 6.4, 5.2, 6.0, 0, C_STONE); B.add(GABLE, x + 0.8, y + 5.2, z + 0.2, 7.0, 2.6, 6.6, 0, C_SLATE);
    for (const s of [-1, 1]) for (let i = 0; i < 3; i++) B.add(BOX, x - 0.8 + i * 2.1, y + 3.1, z + 0.2 + s * 3.02, 0.7, 1.9, 0.24, 0, C_DARK);
    B.add(BOX, x - 2.9, y + 4.3, z + 0.2, 3.0, 8.6, 3.0, 0, C_STONE2); B.add(BOX, x - 2.9, y + 7.4, z - 1.32, 0.9, 1.2, 0.24, 0, C_DARK);
    B.add(PYR, x - 2.9, y + 10.2, z + 0.2, 3.4, 3.6, 3.4, 0, C_SLATE); B.add(BOX, x - 2.9, y + 1.3, z - 1.36, 1.2, 2.6, 0.3, 0, C_DARK);
    B.add(BOX, x + 1, y + 0.55, z - 3.9, 2.0, 1.1, 0.9, 0, C_STONE2); B.add(BOX, x + 1, y + 1.14, z - 3.9, 2.2, 0.14, 1.05, 0, C_STONE);   // porch altar
    B.add(BOX, x + 1, y + 1.24, z - 3.9, 0.7, 0.1, 1.1, 0, C_BANNER);
    for (const s of [-1, 1]) { B.add(BOX, x + 1 + s * 0.85, y + 1.4, z - 3.9, 0.14, 0.4, 0.14, 0, C_CLOTH); B.add(BOX, x + 1 + s * 0.85, y + 1.66, z - 3.9, 0.1, 0.14, 0.1, 0, [1, 0.78, 0.3]); }
  } else if (L.t === 1) {
    B.add(CYL8, x, y + 2.6, z, 5.2, 5.2, 5.2, 0, C_STONE); B.add(DRUM8, x, y + 6.4, z, 4.2, 2.6, 4.2, 0, C_WALL); B.add(CONE8, x, y + 8.7, z, 4.8, 2.4, 4.8, 0, C_ROOF2);
    B.add(BOX, x, y + 7.6, z - 2.4, 0.5, 0.5, 1.3, 0, C_BEAM); B.add(BOX, x, y + 7.6, z - 3.0, 0.72, 8.6, 0.22, 0, C_CLOTH); B.add(BOX, x, y + 7.6, z - 3.0, 8.6, 0.72, 0.22, 0, C_CLOTH);
    B.add(BOX, x, y + 1.3, z - 2.5, 1.3, 2.6, 0.3, 0, C_DARK);
  } else if (L.t === 2) {
    B.add(CYL8, x, y + 5.0, z, 5.0, 10.0, 5.0, 0, [0.36, 0.37, 0.46]); B.add(DRUM8, x, y + 10.2, z, 5.8, 0.5, 5.8, 0, C_STONE2);
    B.add(DRUM8, x, y + 11.6, z, 4.6, 2.4, 4.6, 0, [0.32, 0.33, 0.42]); B.add(CONE8, x, y + 14.3, z, 5.2, 3.8, 5.2, 0, [0.24, 0.20, 0.40]);
    for (let i = 0; i < 4; i++) { const a = i * PI / 2 + PI / 4; B.add(BOX, x + Math.sin(a) * 2.45, y + 6.5, z + Math.cos(a) * 2.45, 0.6, 1.1, 0.6, 0, C_DARK); }
    B.add(BOX, x, y + 1.3, z - 2.45, 1.3, 2.6, 0.4, 0, C_DARK);
  }
  if (L.t === 3) {   // the manor: emitShell's own house at twice the size, jettied, behind post and rail
    const b = { x, z, y, w: 7, d: 5, h: 4.4, hw: 3, hd: 2, door: 2, stone: 1, st2: 1, gable: 1, shop: null, bank: 0, roofC: C_SLATE, dx: x, dz: z + 2, cx: x, cz: z - 1 };
    emitShell(B, b); emitRoof(B, b);
    emitPen(B, { x, z, w: L.R, d: L.R, fd: 2, bare: 1 }, null);
    for (const s of [-1, 1]) { B.add(TRUNK, x + s * 3.2, y + 0.9, z + 3.0, 0.3, 1.8, 0.3, 0, BARK); B.add(BLOB, x + s * 3.2, y + 2.4, z + 3.0, 1.6, 1.6, 1.6, 0, [0.28, 0.45, 0.20]); }
  }
}
/* the Grand Exchange rotunda: cobbled circle, pillared ring wall with four gates, a covered counter island */
function emitGE(B, g) {
  const x = g.x, z = g.z, y = g.y, WR = 8.2, N = 16, seg = 2 * WR * Math.sin(PI / N), rm = WR * Math.cos(PI / N);
  for (let a = -9; a <= 9; a++) for (let b = -9; b <= 9; b++) {
    if (a * a + b * b > 9.4 * 9.4) continue;
    B.add(BOX, x + a, heightAt(x + a, z + b) + 0.06, z + b, 1.02, 0.14, 1.02, 0, ((a ^ b) & 1) ? C_STONE : PAL.cobble);
  }
  for (let i = 0; i < N; i++) {
    const a = (i + 0.5) / N * TAU, ar = -(a + PI / 2), px = x + Math.sin(a) * WR, pz = z + Math.cos(a) * WR, py = heightAt(px, pz);
    B.add(BOX, px, py + 1.7, pz, 0.72, 4.6, 0.72, ar, C_STONE); B.add(BOX, px, py + 3.9, pz, 1.05, 0.35, 1.05, ar, C_STONE2);
    const am = (i + 1) / N * TAU, mr = -(am + PI / 2), mx = x + Math.sin(am) * rm, mz = z + Math.cos(am) * rm, my = heightAt(mx, mz);
    if (!(Math.abs(Math.sin(am)) < 0.20 || Math.abs(Math.cos(am)) < 0.20)) B.add(BOX, mx, my + 0.75, mz, 0.5, 2.1, seg, mr, C_STONE2);
    B.add(BOX, mx, my + 4.35, mz, 0.95, 0.55, seg + 0.5, mr, C_STONE);
  }
  for (let d = 0; d < 4; d++) { const a = d * PI / 2, gx2 = x + Math.sin(a) * WR, gz2 = z + Math.cos(a) * WR; B.add(PYR, gx2, heightAt(gx2, gz2) + 5.0, gz2, 1.3, 0.9, 1.3, 0, C_GOLD); }
  for (const s of [-1, 1]) {
    B.add(BOX, x, y + 0.55, z + s * 3, 6.6, 1.5, 0.9, 0, C_STONE); B.add(BOX, x, y + 1.28, z + s * 3, 7.2, 0.16, 1.25, 0, C_SIGN);
    B.add(BOX, x + s * 3, y + 0.55, z, 0.9, 1.5, 6.6, 0, C_STONE); B.add(BOX, x + s * 3, y + 1.28, z, 1.25, 0.16, 7.2, 0, C_SIGN);
  }
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) B.add(BOX, x + sx * 3, y + 2.1, z + sz * 3, 0.42, 4.2, 0.42, 0, C_BEAM);
  B.add(PYR, x, y + 5.2, z, 9.6, 2.8, 9.6, 0, C_SLATE); B.add(BOX, x, y + 6.7, z, 0.5, 1.3, 0.5, 0, C_BEAM); B.add(BLOB, x, y + 7.5, z, 0.9, 0.9, 0.9, 0, C_GOLD);
  B.add(CYL8, x, y + 0.8, z, 0.9, 1.6, 0.9, 0, C_STONE2); B.add(BLOB, x, y + 1.9, z, 0.7, 0.6, 0.7, 0, C_GOLD);
}
function emitCityTree(B, t) {   // decoration only; the choppable ones come from the chunk pass
  const s = t.s;
  if (b07(B, t.broad ? 'Decorative broadleaf tree' : 'Tree', t.x, t.y, t.z, s * 1.24,
    ((hash2(t.x, t.z, S + 107) >>> 4) & 3) * (PI / 2))) return;   // no decorative conifer in the cache: a park spruce wears the plain tree
  if (t.broad) { B.add(TRUNK, t.x, t.y + 1.2 * s, t.z, 0.42 * s, 3.2 * s, 0.42 * s, 0, BARK2); B.add(BLOB, t.x, t.y + 3.3 * s, t.z, 3.6 * s, 3.0 * s, 3.6 * s, 0, [0.30, 0.48, 0.20]); }
  else { B.add(TRUNK, t.x, t.y + 0.9 * s, t.z, 0.32 * s, 2.4 * s, 0.32 * s, 0, BARK); B.add(SPIRE, t.x, t.y + 2.4 * s, t.z, 2.8 * s, 4.4 * s, 2.8 * s, 0, [0.19, 0.38, 0.19]); }
}

/* ---- 14. LAYING OUT A TOWN: every settlement draws its own plan. villageAt rolled the outline and the street pattern; here the
   wall line is fixed first, then one grid is claimed in order — streets, square, castle, exchange, wall, landmark, houses, the rest —
   so nothing overlaps and every artery leaves through a gate onto its highway. ---- */
/* min/max heights over a sampled footprint; returns null when any sample fails `ok` */
function spanHeights(cx, cz, R, step, ok, circle) {
  let lo = 1e9, hi = -1e9;
  for (let p = -R; p <= R; p += step) for (let q = -R; q <= R; q += step) {
    if (circle && p * p + q * q > R * R) continue;
    const y = heightAt(cx + p, cz + q);
    if (ok && !ok(cx + p, cz + q, y)) return null;
    if (y < lo) lo = y; if (y > hi) hi = y;
  }
  return { lo, hi };
}
function layoutCity(v) {
  const R = v.r, gR = Math.ceil(R * v.ext * 1.06) + 2, D = gR * 2 + 1, G = new Uint8Array(D * D), RK = RANKS[v.rank], role = charterRole(v);
  v.G = G; v.gD = D; v.gR = gR; v.role = role;
  const gi = (x, z) => { const ix = x - v.x + gR, iz = z - v.z + gR; return (ix < 0 || iz < 0 || ix >= D || iz >= D) ? -1 : iz * D + ix; };
  const get = (x, z) => { const i = gi(x, z); return i < 0 ? 255 : G[i]; };
  const force = (x, z, c) => { const i = gi(x, z); if (i >= 0) G[i] = c; };
  const fill = (x, z, r, c, circle) => { for (let a = -r; a <= r; a++) for (let b = -r; b <= r; b++) if (!circle || a * a + b * b <= r * r) force(x + a, z + b, c); };
  const vd = (x, z) => villageDist(v, x, z);
  const ring = (h, i, mul, add) => ((h >>> i) & 1023) / 1024 * TAU * (mul || 1) + (add || 0);
  const polar = (a, rr) => townPt(v, a, rr);
  const ph = hash2(v.x, v.z, S + 93), PK = v.pk, CITY = v.rank >= 3;
  const ftw = (ex, ez) => { const rx = ex * R * v.ax, rz = ez * R * v.az; return [Math.round(v.x + rx * v.cs - rz * v.sn), Math.round(v.z + rx * v.sn + rz * v.cs)]; };   // outline units to the world
  const wtf = (x, z) => { const dx = x - v.x, dz = z - v.z, rx = dx * v.cs + dz * v.sn, rz = -dx * v.sn + dz * v.cs; return [rx / v.ax / R, rz / v.az / R]; };
  // the wards of a city: its own rectangles, or the quarters of a single block. Each takes a character of its own
  const dists = [];
  if (CITY) {
    const rc = v.rects && v.rects.length > 1 ? v.rects : v.rects ? [-1, 1].flatMap(sx => [-1, 1].map(sz => ({ x: v.rects[0].x + sx * v.rects[0].hw / 2, z: v.rects[0].z + sz * v.rects[0].hd / 2, hw: v.rects[0].hw / 2, hd: v.rects[0].hd / 2 })))
             : [-1, 1].flatMap(sx => [-1, 1].map(sz => ({ x: sx * 0.8, z: sz * 0.8, hw: 0.8, hd: 0.8 })));
    rc.forEach((rr, i) => { const hd2 = hash2(v.x + i * 131, v.z + i * 17, S + 130); dists.push({ i, rc: rr, st: role === 2 && !i ? 0 : hd2 % 6, h: hd2 }); });   // st: 0/1 grid, 2 crooked, 3 plaza, 4 green, 5 dense grid
  }
  const wardOf = (x, z) => { const [ex, ez] = wtf(x, z); for (const d of dists) if (Math.abs(ex - d.rc.x) <= d.rc.hw && Math.abs(ez - d.rc.z) <= d.rc.hd) return d.i; return -1; };   // wards overlap; a tile belongs to the first

  // the wall's line comes first: the lanes inside stop short of it, the arteries alone cross it at gates
  const wk = RK.wall === 2 ? 2 : RK.wall === 1 && hash2(v.x, v.z, S + 94) % 100 < (v.rank === 2 ? 70 : 30) ? 1 : 0;
  const old = wk === 2 && role !== 2 && (ph & 7) < 2;   // an old town: the wall rings the core and the suburbs sprawl beyond it
  const wr = wk ? (old ? 0.60 : wk === 2 ? 0.86 : 0.80) : 0, lim = wk && !old ? wr - 0.035 : 0.97;
  v.wr = wr;

  // approaches: where the highways arrive, so the main streets meet them at the gates; empty compass points get a lane to the fields
  const app = townApproaches(v), wantApp = v.rank >= 2 ? 4 : v.rank ? 3 : 2, base = ring(hash2(v.x, v.z, S + 91), 0);
  for (let i = 0; i < 12 && app.length < wantApp; i++) {
    const a = gateAngle(v, base + (i % wantApp) * TAU / wantApp + Math.floor(i / wantApp) * 0.45);
    if (!app.some(b => Math.abs(wrapA(a - b)) < 0.35)) app.push(a);
  }

  // streets: segments first, rasterised together. a marks an artery — the only kind a wall opens for
  const segs = [], art = new Set();
  const line = (x0, z0, x1, z1, w, code, a, di) => segs.push({ x0, z0, x1, z1, w, code, a: a || 0, di: di === undefined ? -1 : di });
  const AW = v.rank >= 3 ? 3.2 : v.rank === 2 ? 2.4 : 1.7, LW = v.rank >= 2 ? 1.0 : 1.4, AC = v.rank >= 3 ? G_PAVED : G_ROAD;   // side streets are three tiles wide, 2007-style; a hamlet's lanes are footpaths
  const artery = (a, i, fx, fz) => {   // hub to gate; the crooked plan bends once on the way
    const [gx, gz] = polar(a, R * 1.04);
    if (PK === 3) {
      const [mx, mz] = polar(a + ((i & 1) ? 0.14 : -0.14) * (1 + ((ph >>> i) & 1)), R * (0.45 + ((ph >>> (i + 3)) & 3) * 0.06));
      line(fx, fz, mx, mz, AW, AC, 1); line(mx, mz, gx, gz, AW, AC, 1);
    } else line(fx, fz, gx, gz, AW, AC, 1);
  };
  const ringRoad = (rf, jit) => {   // a closed ring at rf, wandering by jit
    const N = PK !== 3 && v.rank >= 2 ? (v.pn || 8) : Math.max(24, Math.round(R * rf * 0.8)), a0 = v.pn ? v.po : PI / 8;   // a planned town's ring is a polygon of straight streets
    let [px, pz] = polar(a0, R * rf);
    for (let i = 1; i <= N; i++) {
      const [x, z] = i === N ? polar(a0, R * rf) : polar(a0 + i / N * TAU, R * rf * (1 + jit * ((hash2(i, v.x, S + 92) & 255) / 255 - 0.5)));
      line(px, pz, x, z, 2.4, G_ROAD); px = x; pz = z;
    }
  };
  const lanes = (sx, sz, ex, ez, sp, k0) => {   // side lanes off a street, alternating sides; the crooked plan skews them
    const len = Math.hypot(ex - sx, ez - sz), ux = (ex - sx) / len, uz = (ez - sz) / len;
    for (let t = sp * 0.7, k = k0; t < len - 3; t += sp, k++) {
      const h = hash2(k, v.z + k * 7, S + 95), side = (k & 1) ? 1 : -1, L = 5 + (h & 7) + v.rank * 2, ca = Math.atan2(ux, uz) + side * PI / 2 + (PK === 3 ? (((h >>> 3) & 31) / 31 - 0.5) * 0.9 : 0);
      const bx = sx + ux * t, bz = sz + uz * t;
      line(bx, bz, bx + Math.sin(ca) * L, bz + Math.cos(ca) * L, LW, G_ROAD);
    }
  };
  const footOn = (px, pz, chords) => {   // the nearest point on a chain of chords, clear of their ends
    let best = null, bd = 1e9;
    for (const [x0, z0, x1, z1] of chords) {
      const ex = x1 - x0, ez = z1 - z0, t = clamp(((px - x0) * ex + (pz - z0) * ez) / (ex * ex + ez * ez), 0.2, 0.85), fx = x0 + ex * t, fz = z0 + ez * t, d = Math.hypot(px - fx, pz - fz);
      if (d < bd) { bd = d; best = [fx, fz]; }
    }
    return best;
  };
  // the square: on the hub, or a quarter out along the first road with a paved link back
  v.sq = null;
  if (v.rank >= 2) {
    const sr = 3 + v.rank;
    let sx = v.x, sz = v.z;
    if (((ph >>> 9) & 3) === 0) {
      const [ox, oz] = polar(app[0] + 0.45, R * 0.3);
      if (spanHeights(ox, oz, sr, 2, (x, z, y) => y >= 1.9 && get(x, z) !== 255)) { sx = ox; sz = oz; line(sx, sz, v.x, v.z, AW, AC, 1); }
    }
    v.sq = { x: sx, z: sz, r: sr };
  }
  if (CITY) {   // a city: two avenues gate to gate through the centre, boulevards for the diagonal arrivals, and every ward its own streets
    for (let k = 0; k < 4; k++) { const [gx, gz] = polar(k * PI / 2, R * 1.04); line(v.x, v.z, gx, gz, AW, AC, 1); }
    app.forEach((a, i) => { if (Math.abs(wrapA(a - Math.round(a / (PI / 2)) * PI / 2)) > 0.1) artery(a, i, v.x, v.z); });
    if (RK.ring && ((ph >>> 5) & 1)) ringRoad(0.55, 0);
    for (const d of dists) {
      const s = d.st, [dcx, dcz] = ftw(d.rc.x, d.rc.z);
      if (s === 2 || s === 4) for (let j = 0, n = s === 2 ? 9 : 2; j < n; j++) {   // crooked lanes on the eight winds, each bending once
        const g = hash2(dcx + j * 53, dcz - j * 29, S + 131), ex = d.rc.x + ((g & 255) / 255 * 2 - 1) * d.rc.hw * 0.8, ez = d.rc.z + (((g >>> 8) & 255) / 255 * 2 - 1) * d.rc.hd * 0.8;
        const [sx, sz] = ftw(ex, ez);
        if (vd(sx, sz) > R * 0.9) continue;
        const a1 = ((g >>> 16) & 7) * PI / 4, L1 = (8 + ((g >>> 19) & 7)) / R, a2 = a1 + (((g >>> 22) & 1) ? PI / 4 : -PI / 4);
        const [mx, mz] = ftw(ex + Math.sin(a1) * L1, ez + Math.cos(a1) * L1), [fx, fz] = ftw(ex + Math.sin(a1) * L1 + Math.sin(a2) * L1 * 0.6, ez + Math.cos(a1) * L1 + Math.cos(a2) * L1 * 0.6);
        line(sx, sz, mx, mz, LW, G_ROAD, 0, d.i); line(mx, mz, fx, fz, LW, G_ROAD, 0, d.i);
      } else {   // gridded, at the ward's own spacing and offset
        const sp = s === 5 ? 11 : 13 + (d.h & 3), o0 = (d.h >>> 4) % sp, E = v.ext * 1.05, n = Math.ceil(R * E / sp);   // a block holds two rows of houses back to back
        for (let i = -n; i <= n; i++) {
          const o = (i * sp + o0) / R, [ax2, az2] = ftw(o, -E), [bx2, bz2] = ftw(o, E), [cx3, cz3] = ftw(-E, o), [dx3, dz3] = ftw(E, o);
          line(ax2, az2, bx2, bz2, LW, G_ROAD, 0, d.i); line(cx3, cz3, dx3, dz3, LW, G_ROAD, 0, d.i);
        }
      }
    }
  } else if (PK === 2) {   // the high street: one road through, the other arrivals joining it, lanes hung off both sides
    const a1 = app.length > 1 ? app[1] : app[0] + PI, [g0x, g0z] = polar(app[0], R * 1.04), [g1x, g1z] = polar(a1, R * 1.04);
    line(g0x, g0z, v.x, v.z, AW, AC, 1); line(v.x, v.z, g1x, g1z, AW, AC, 1);
    for (let i = 2; i < app.length; i++) { const [gx, gz] = polar(app[i], R * 1.04), f = footOn(gx, gz, [[g0x, g0z, v.x, v.z], [v.x, v.z, g1x, g1z]]); line(gx, gz, f[0], f[1], AW, AC, 1); }
    const sp = 7 + (ph & 3) + (v.rank ? 0 : 3);
    lanes(g0x, g0z, v.x, v.z, sp, 0); lanes(v.x, v.z, g1x, g1z, sp, 40);
  } else if (PK === 1) {   // the planned town: one grid over everything, the arteries snapped to it or cutting through as boulevards
    app.forEach((a, i) => artery(a, i, v.x, v.z));
    const sp = 12 + v.rank + ((ph >>> 6) & 3), cs = Math.cos(v.rot), sn = Math.sin(v.rot), L = R * v.ext, n = Math.ceil(L / sp);
    for (let i = -n; i <= n; i++) {
      const o = i * sp;
      line(v.x + cs * o - sn * L, v.z - sn * o - cs * L, v.x + cs * o + sn * L, v.z - sn * o + cs * L, LW, G_ROAD);
      line(v.x + sn * o - cs * L, v.z + cs * o + sn * L, v.x + sn * o + cs * L, v.z + cs * o - sn * L, LW, G_ROAD);
    }
  } else {   // radial (0) or crooked (3): arteries from the hub, a ring, and the districts each gridded at their own angle
    app.forEach((a, i) => artery(a, i, v.x, v.z));
    if (PK === 0 && v.rank >= 3 && ((ph >>> 3) & 3) === 0) artery(base + 1.1, 9, v.x, v.z);   // one boulevard to nothing but the fields
    if (RK.ring) { if (PK === 3) ringRoad(0.50 + ((ph >>> 4) & 15) / 80, 0.22); else for (const rf of (v.rank >= 3 && ((ph >>> 5) & 3) === 0 ? [0.40, 0.74] : [0.52 + ((ph >>> 4) & 15) / 64])) ringRoad(rf, 0); }
    if (PK === 3 || v.rank <= 1) for (const s of segs.slice()) if (s.a) lanes(s.x0, s.z0, s.x1, s.z1, 9 + ((ph >>> 8) & 3) + (v.rank ? 0 : 3), Math.round(s.x0 + s.z0));
    if (PK === 0) for (let d = 0; d < RK.grids; d++) {
      const h = hash2(v.x + d * 977, v.z - d * 613, S + 93), da = ring(h, 0), dr = R * (0.22 + ((h >>> 10) & 63) / 64 * 0.42);
      const dx = v.x + Math.sin(da) * dr, dz = v.z + Math.cos(da) * dr, rad = R * (0.20 + ((h >>> 16) & 31) / 32 * 0.16);
      const rot = ((h >>> 21) & 255) / 256 * PI / 2, sp = 15 + ((h >>> 5) & 7), cs = Math.cos(rot), sn = Math.sin(rot), n = Math.min(3, Math.floor(rad / sp));
      for (let i = -n; i <= n; i++) {
        const o = i * sp, L = Math.sqrt(Math.max(0, rad * rad - o * o));
        if (L < 4) continue;
        line(dx + (o * cs - -L * sn), dz + (o * sn + -L * cs), dx + (o * cs - L * sn), dz + (o * sn + L * cs), LW, G_ROAD);
        line(dx + (-L * cs - o * sn), dz + (-L * sn + o * cs), dx + (L * cs - o * sn), dz + (L * sn + o * cs), LW, G_ROAD);
      }
    }
  }
  for (const s of segs) {   // rasterise: stop at water, stay inside the outline (arteries run out past it to meet the highway)
    const len = Math.hypot(s.x1 - s.x0, s.z1 - s.z0), steps = Math.ceil(len * 2), w = s.w, lm = (s.a ? 1.05 : lim) * R;
    let was = 0;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps, x = s.x0 + (s.x1 - s.x0) * t, z = s.z0 + (s.z1 - s.z0) * t;
      if ((i & 7) === 0 && heightAt(x, z) < 1.5) break;
      if (vd(x, z) > lm + w) { if (was) break; continue; }
      was = 1;
      for (let a = -w; a <= w; a++) for (let b = -w; b <= w; b++) {
        if (a * a + b * b > w * w) continue;
        const px = Math.round(x + a), pz = Math.round(z + b), i2 = gi(px, pz);
        if (i2 < 0 || vd(px, pz) > lm || (s.di >= 0 && wardOf(px, pz) !== s.di)) continue;
        if (G[i2] === G_EMPTY || (G[i2] === G_ROAD && s.code === G_PAVED)) G[i2] = s.code;
        if (s.a) art.add(tk(px, pz));
      }
    }
  }
  if (v.sq) fill(v.sq.x, v.sq.z, v.sq.r, G_PAVED, PK !== 1);   // the grid town squares its square
  const fur = [], greens = [];
  for (const d of dists) {   // a ward's plaza (paved, a well, stalls) or its green (a lawn the trees will fill)
    if (d.st !== 3 && d.st !== 4) continue;
    const [cx2, cz2] = ftw(d.rc.x, d.rc.z), pr = d.st === 3 ? 3 : 5 + (d.h & 3);
    if (vd(cx2, cz2) > R * 0.85 || wardOf(cx2, cz2) !== d.i || !spanHeights(cx2, cz2, pr, 2, (x, z, y) => y >= 1.9 && get(x, z) !== 255)) continue;
    if (d.st === 3) {
      fill(cx2, cz2, pr, G_PAVED, 1); fur.push({ t: 1, x: cx2, z: cz2, y: heightAt(cx2, cz2) });
      for (const [a, b] of [[2, 1], [-2, -1]]) fur.push({ t: 0, x: cx2 + a, z: cz2 + b, y: heightAt(cx2 + a, cz2 + b), k: hash2(cx2 + a, cz2 + b, S + 109) });
    } else { for (let a = -pr; a <= pr; a++) for (let b = -pr; b <= pr; b++) if (a * a + b * b <= pr * pr && get(cx2 + a, cz2 + b) === G_EMPTY) force(cx2 + a, cz2 + b, G_PARK); greens.push({ x: cx2, z: cz2, r: pr }); }
  }

  // the castle claims a block of its own: inside, or (a citadel) straddling the wall line so the wall runs into it
  const onSq = (x, z) => v.sq && Math.hypot(x - v.sq.x, z - v.sq.z) <= v.sq.r + 1;   // the square alone is sacred; streets get built over
  v.keep = null;
  if (RK.keep || role === 1) {
    const h = hash2(v.x, v.z, S + 96), big = v.rank >= 3, KR = big ? 11 + v.rank * 2 + (h & 3) : 8, cit = big && wk && !old && ((h >>> 12) & 3) === 0;
    let best = null, bestScore = -1e9;
    const kdir = role === 2 ? PI : ((h >>> 14) & 3) * PI / 2;   // a city's castle holds one side of the square; Varrock's palace stands to the north
    for (let i = 0; i < 68 && (i < 40 || !best); i++) {   // the last lap takes whatever ground there is: a city without its castle has no dungeon
      if (CITY && i === 12 && best) break;   // a city keeps its castle on the chosen side whenever the side will take it
      const lax = i >= 40, side = CITY && i < 12;
      const [cx2, cz2] = side ? polar(kdir + (i % 4 - 1.5) * 0.09, R * (0.52 + Math.floor(i / 4) * 0.07)) : polar(ring(h, i % 8, 1, i * 0.7), R * (cit && !lax ? wr - KR / R * 0.55 : 0.16 + (i % 5) * 0.09));
      let free = 0;
      const sp = spanHeights(cx2, cz2, KR, 3, (x, z, y) => { const c = get(x, z); if (c === 255 || y < 1.8 || (!lax && (onSq(x, z) || (!cit && vd(x, z) > R * 0.96)))) return 0; if (c === G_EMPTY) free++; return 1; });
   /* The courtyard is a single flat slab thirty or forty tiles across, so a sloping site is not merely a worse
      site — the stone stands at the high corner and everything walks along the ground underneath it, out of sight.
      A town's plateau is level only to 0.80 of its radius (0.62 below rank 3), and a big castle placed on the
      square's flank reaches past that shoulder, which is why this bit only ever showed on cities. Reject the slope
      outright instead of scoring it: the table's middle always has room, so the search finds a site every time. */
      if (!sp || sp.hi - sp.lo > (i >= 60 ? 1e9 : lax ? 1.6 : 0.6)) continue;
      const score = free - (sp.hi - sp.lo) * 12;
      if (score > bestScore) { bestScore = score; best = { x: cx2, z: cz2, y: sp.hi, R: KR }; }
    }
    if (best) {
      const tdx = v.x - best.x, tdz = v.z - best.z;
      const gate = cit || CITY ? (Math.abs(tdx) > Math.abs(tdz) ? (tdx > 0 ? 1 : 3) : (tdz > 0 ? 2 : 0)) : (h >>> 5) & 3;   // a city's castle gate faces the square
      const hw = big ? 4 + ((h >>> 7) & 1) : 3, hd = big ? 3 + ((h >>> 9) & 1) : 2, gx = DDX[gate], gz = DDZ[gate], bR = best.R - 3, pp = (h >>> 11) & 1 ? 1 : -1;
      const out = big ? [-1, 1].map(sg => gz ? { x: best.x + sg * Math.round(bR * 0.5), z: best.z - gz * bR, w: 5, d: 3, h: 2.9 }
                                             : { x: best.x - gx * bR, z: best.z + sg * Math.round(bR * 0.5), w: 3, d: 5, h: 2.9 }) : [];
      const well = gz ? { x: best.x + pp * (big ? 5 : 4), z: best.z + gz * (KR - 4) } : { x: best.x + gx * (KR - 4), z: best.z + pp * (big ? 5 : 4) };
      v.keep = { x: best.x, z: best.z, y: best.y, R: best.R, gate, rank: v.rank, out, well, hall: { x: best.x, z: best.z, w: hw * 2 + 1, d: hd * 2 + 1, h: 10.5 + v.rank * 1.5, hw, hd } };
      fill(best.x, best.z, best.R, G_KEEP);
    }
  }

  // the grand exchange: rarer than any bank, claimed before the houses; Varrock's is a certainty
  v.ge = null;
  if (v.rank >= 2) {
    const gh = hash2(v.x, v.z, S + 112), odds = role === 2 ? 100 : v.rank >= 4 ? 85 : v.rank === 3 ? 40 : 8;
    if (gh % 100 < odds) {
      const GR = 10, tries = role === 2 ? 64 : 24;
      let best = null, bestScore = -1e9;
      for (let i = 0; i < tries; i++) {
        const [cx2, cz2] = role === 2 && i < 10 ? polar(-PI * 0.75 + (i % 5 - 2) * 0.12, R * (0.5 + Math.floor(i / 5) * 0.1)) : polar(ring(gh, 3, 1, i * 0.7), R * (0.28 + (i % 5) * 0.09));   // Varrock's exchange sits in the north-west
        let free = 0;
        const sp = spanHeights(cx2, cz2, GR, 2, (x, z, y) => { const c = get(x, z); if (c === 255 || c === G_WALL || c === G_KEEP || c === G_BUILD || onSq(x, z) || y < 1.9 || vd(x, z) > R * 0.96) return 0; if (c === G_EMPTY) free++; return 1; }, 1);
        if (!sp || sp.hi - sp.lo > (i >= 32 ? 2.8 : 2.2)) continue;
        const score = free - (sp.hi - sp.lo) * 10 - Math.hypot(cx2 - v.x, cz2 - v.z) * 0.1;
        if (score > bestScore) { bestScore = score; best = { x: cx2, z: cz2, y: sp.hi }; }
      }
      if (best) { fill(best.x, best.z, GR, G_GE, 1); v.ge = { x: best.x, z: best.z, y: best.y, R: GR, blk: null }; }
    }
  }

  // the wall traces the outline: straight runs and corner towers on a polygon, a wobble on a blob; ruined to taste; gates only on arteries
  const wall = [], gates = [];
  if (wk) {
    const thr = wk === 1 ? -0.34 : role === 2 ? -0.7 : [-0.62, -0.34, -0.2][(ph >>> 11) % 3], N = Math.ceil(TAU * wr * R * v.ext / 1.3), K = wk === 2 ? 11 : 9, corner = new Set();
    for (const ca of v.pc) corner.add(Math.round(((ca / TAU) % 1 + 1) % 1 * N) % N);   // a tower on every corner of the outline
    let prevOn = 0, lx = 1e9, lz = 1e9;
    for (let i = 0; i < N; i++) {
      const a = i / N * TAU, on = fbm(Math.sin(a) * 2.2, Math.cos(a) * 2.2, S + 95, 2) > thr, [x, z] = polar(a, wr * R);
      if (x === lx && z === lz) continue;
      lx = x; lz = z;
      if (!on) { prevOn = 0; continue; }
      const c = get(x, z), y = heightAt(x, z);
      if (c === 255 || c === G_KEEP || c === G_GE || y < 1.6) { prevOn = 0; continue; }   // the castle carries the line itself
      const gate = art.has(tk(x, z));
      for (let a2 = -1; a2 <= 1; a2++) for (let b2 = -1; b2 <= 1; b2++) {
        const c2 = get(x + a2, z + b2);
        if (c2 === 255 || c2 === G_KEEP || c2 === G_GE || c2 === G_PAVED) continue;
        if (gate) { if (c2 === G_EMPTY) force(x + a2, z + b2, G_GATE); } else force(x + a2, z + b2, G_WALL);
      }
      if (gate) {
        if (wall.length) wall[wall.length - 1].tower = 1; prevOn = 0;
        if (!gates.some(g => chebDist(g.x, g.z, x, z) < 6)) { const [qx, qz] = polar(a + 0.05, wr * R), [rx2, rz2] = polar(a - 0.05, wr * R), tl = Math.hypot(qx - rx2, qz - rz2) || 1; gates.push({ x, z, y, k: wk, ax: (qx - rx2) / tl, az: (qz - rz2) / tl, hw: AW + 2.1 }); }
        continue;
      }
      wall.push({ x, z, y, k: wk, tower: prevOn === 0 || corner.has(i) || i % K === 0 }); prevOn = 1;
    }
    if (!gates.length && wall.length) {   // every road stopped short (water, most often): the wall opens on the first approach regardless
      const [gx, gz] = polar(app[0], wr * R);
      for (let i = wall.length - 1; i >= 0; i--) if (chebDist(wall[i].x, wall[i].z, gx, gz) <= 2) wall.splice(i, 1);
      for (let a2 = -3; a2 <= 3; a2++) for (let b2 = -3; b2 <= 3; b2++) if (get(gx + a2, gz + b2) === G_WALL) force(gx + a2, gz + b2, G_GATE);
      gates.push({ x: gx, z: gz, y: heightAt(gx, gz), k: wk, ax: Math.cos(app[0]), az: -Math.sin(app[0]), hw: AW + 2.1 });
    }
  }
  v.wall = wall; v.gates = gates;

  // one landmark: church, windmill, or (urban only) a wizard's tower
  v.lm = null;
  if (RK.lm) {
    const h = hash2(v.x, v.z, S + 110), kind = role === 2 ? 0 : v.rank >= 2 ? h % 4 : [0, 1, 3][h % 3], FR = 4;   // church, windmill, wizard's tower (towns up), manor; Varrock keeps its church
    for (let i = 0; i < 28 && !v.lm; i++) {
      const [x, z] = polar(ring(h, 4, 1, i * 1.7), R * (0.34 + (i % 5) * 0.10));
      const sp = spanHeights(x, z, FR, 2, (px, pz, y) => (get(px, pz) === G_EMPTY || (get(px, pz) === G_ROAD && !art.has(tk(px, pz)))) && y >= 1.9);   // a lane may end at the church; an artery never
      if (!sp || sp.hi - sp.lo > 2.0) continue;
      fill(x, z, FR, G_BUILD);
      v.lm = { t: kind, x, z, y: sp.hi, R: FR };
    }
  }

  // the square's furniture: stalls round a fountain; the villages keep a green round the well
  if (v.sq) {
    const q = v.sq, pr = q.r;
    if (get(q.x, q.z) === G_PAVED) fur.push({ t: v.rank >= 3 ? 2 : 1, x: q.x, z: q.z, y: heightAt(q.x, q.z) });
    const ns = 2 + v.rank + (hash2(v.x, v.z, S + 108) & 3);
    for (let i = 0; i < ns; i++) {
      const a = (i + 0.3) / ns * TAU, x = Math.round(q.x + Math.sin(a) * (pr - 1.4)), z = Math.round(q.z + Math.cos(a) * (pr - 1.4));
      if (get(x, z) === G_PAVED) fur.push({ t: 0, x, z, y: heightAt(x, z), k: hash2(x, z, S + 109) });
    }
  } else if (v.rank === 1 || (ph & 1)) {
    for (let a = -3; a <= 3; a++) for (let b = -3; b <= 3; b++) if (a * a + b * b <= 9 && get(v.x + a, v.z + b) === G_EMPTY) force(v.x + a, v.z + b, G_PARK);
    for (const [a, b] of [[0, 0], [2, 2], [-2, 2], [2, -2], [-3, 0]]) {
      const x = v.x + a, z = v.z + b;
      if (get(x, z) !== G_PARK || heightAt(x, z) < 1.9) continue;
      fur.push({ t: 1, x, z, y: heightAt(x, z) });
      break;
    }
  }
  v.fur = fur;

  // houses, planted along the streets; three size passes so a block that cannot take a manor takes cottages.
  // stone gathers round the castle, the town favours one roof, and beyond an old wall the suburbs are thinner and thatched
  const B = [], SIZES = v.rank >= 3 ? [[3, 4], [2, 3], [2, 2]] : v.rank >= 2 ? [[2, 3], [2, 2]] : [[2, 2]], RF = v.reg.rf, SR = v.reg.st || [3, 1], tr = (ph >>> 14) & 3;
  const tryPlot = (px, pz, hw, hd, door) => {
    if (B.length >= RK.houses) return 0;
    const hh = hash2(px, pz, S + 97), d0 = vd(px, pz), sub = wk && d0 > wr * R, fx = px + DDX[door] * (hw + 1), fz = pz + DDZ[door] * (hd + 1);
    if (d0 > R * 0.985 || (sub && (old ? (hh & 3) === 0 : (hh & 3) !== 0))) return 0;   // beyond a wall: an old town's suburbs, else a hut or two
    let onSt = 0;   // the door opens onto a street that was actually laid: the step, or a tile either side of it
    for (const q of [0, -1, 1]) { const c = get(fx + (DDX[door] ? 0 : q), fz + (DDZ[door] ? 0 : q)); if (c === G_ROAD || c === G_PAVED || c === G_GATE) onSt = 1; }
    if (!onSt) return 0;
    for (let a = -hw - 1; a <= hw + 1; a++) for (let b = -hd - 1; b <= hd + 1; b++) {   // footprint plus a one-tile skirt
      const c = get(px + a, pz + b), edge = (a < -hw || a > hw || b < -hd || b > hd), step = a === DDX[door] * (hw + 1) && b === DDZ[door] * (hd + 1);
      if (c === 255 || (!edge && c !== G_EMPTY) || (edge && (c === G_WALL || c === G_KEEP || c === G_GE || (c === G_BUILD && (v.rank < 2 || sub || step))))) return 0;
    }
    let lo = 1e9, hi = -1e9;
    for (const ox of [-hw, 0, hw]) for (const oz of [-hd, 0, hd]) { const y = heightAt(px + ox, pz + oz); if (y < lo) lo = y; if (y > hi) hi = y; }
    if (hi - lo > 1.7 || lo < 1.8) return 0;
    const rf = (hh >>> 3) & 3, ri = rf < 2 ? tr : rf, nearKeep = v.keep && v.rank >= 2 && Math.hypot(px - v.keep.x, pz - v.keep.z) < v.keep.R + 10;
    const b = { x: px, z: pz, y: hi, hw, hd, w: hw * 2 + 1, d: hd * 2 + 1, h: 3.4 + (hw + hd) * 0.22 + ((hh >>> 26) & 15) / 15 * 1.6,
      roofC: (sub && old && (hh & 4)) || (v.rank <= 1 && rf) ? C_THATCH : RF ? RF[ri] : ROOFS[ri],   // the kingdom's roofline; else villages thatch, towns tile
      st2: v.rank >= 2 && hw + hd >= 5 && ((hh >>> 12) & 7) < 3 ? 1 : 0, stone: !(sub && old) && ((v.rank >= SR[0] && ((hh >>> 15) & 3) < SR[1]) || nearKeep) ? 1 : 0,
      gable: ((hh >>> 17) & 3) !== 0 ? 1 : 0, door, shop: null, forge: 0, range: 0, bank: 0, barber: 0, roof: null, blk: null,
      dx: px + DDX[door] * hw, dz: pz + DDZ[door] * hd, cx: px - DDX[door] * (hw - 1), cz: pz - DDZ[door] * (hd - 1) };
    for (let a = -hw; a <= hw; a++) for (let b2 = -hd; b2 <= hd; b2++) force(px + a, pz + b2, G_BUILD);
    B.push(b);
    return 1;
  };
  for (const sz of SIZES) for (const s of segs) {
    if (B.length >= RK.houses) break;
    const len = Math.hypot(s.x1 - s.x0, s.z1 - s.z0);
    if (len < 8) continue;
    const ex = (s.x1 - s.x0) / len, ez = (s.z1 - s.z0) / len, nx = -ez, nz = ex;
    for (let t = 3; t < len - 3 && B.length < RK.houses; t += 2) {
      const hs = hash2(Math.round(s.x0 + ex * t), Math.round(s.z0 + ez * t), S + 98);
      if ((hs & 7) === 0) continue;
      const hw = sz[0] + (hs >>> 4) % (sz[1] - sz[0] + 1), hd = sz[0] + (hs >>> 8) % (sz[1] - sz[0] + 1);
      for (const side of [-1, 1]) {
        if (B.length >= RK.houses) break;
        const bx = -nx * side, bz = -nz * side, door = Math.abs(bx) > Math.abs(bz) ? (bx > 0 ? 3 : 1) : (bz > 0 ? 0 : 2), off = s.w + 0.6 + (door & 1 ? hw : hd);   // the door faces the street, a step off its edge
        tryPlot(Math.round(s.x0 + ex * t + nx * side * off), Math.round(s.z0 + ez * t + nz * side * off), hw, hd, door);
      }
    }
  }
  // then every street that was laid gets its frontage: one pass over the grid, a house wherever open ground meets a road
  for (let iz = 1; iz < D - 1 && B.length < RK.houses; iz++) for (let ix = 1; ix < D - 1 && B.length < RK.houses; ix++) {
    if (G[iz * D + ix] !== G_EMPTY) continue;
    const x = v.x - gR + ix, z = v.z - gR + iz, h = hash2(x, z, S + 103);
    if ((h & 7) === 0) continue;   // a gap now and then: gardens, yards, a lane between
    for (let d = 0; d < 4; d++) {
      const c = get(x + DDX[d], z + DDZ[d]);
      if (c !== G_ROAD && c !== G_PAVED) continue;
      const hw = 2 + ((h >>> 4) & 1), hd = 2 + ((h >>> 5) & 1);
      if (tryPlot(x - DDX[d] * hw, z - DDZ[d] * hd, hw, hd, d)) break;
    }
  }
  v.b = B;

  // shops on the busiest ground, nearest the square
  const qx = v.sq ? v.sq.x : v.x, qz = v.sq ? v.sq.z : v.z;
  const byCentre = B.slice().sort((p, q) => Math.hypot(p.x - qx, p.z - qz) - Math.hypot(q.x - qx, q.z - qz));
  const shops = SHOP_FOR_RANK[v.rank];
  let si = 0;
  for (const b of byCentre) { if (si >= shops.length) break; if (b.hw >= 2 && b.hd >= 2) b.shop = SHOP[shops[si++]].i; }
  // working fixtures: furnace and anvil each find a host building or open ground; a range to cook on
  const FIX = [];
  const corners = host => ({ ax: host.x - DDX[host.door] * (host.hw - 1) - (DDX[host.door] ? 0 : host.hw - 1), az: host.z - DDZ[host.door] * (host.hd - 1) - (DDZ[host.door] ? 0 : host.hd - 1) });
  const host = (minW, extra) => byCentre.find(b => b.shop === null && !b.forge && b.hw >= minW && b.hd >= 2 && (!extra || extra(b)));
  const outdoorFix = (t, so) => {
    for (let i = 0; i < 14; i++) {
      const h = hash2(v.x + i * 53 + so, v.z + i * 29 - so, S + 44);
      const [x, z] = polar(ring(h, 0), 5 + (h >>> 10) % 7);
      if (get(x, z) !== G_EMPTY) continue;
      const y = heightAt(x, z);
      if (y < 1.9) continue;
      force(x, z, G_BUILD); FIX.push({ t, x, z, y, in: null });
      return;
    }
  };
  const indoorFix = (t, minW) => {
    const hb = host(minW, b => !b.range);
    if (!hb) return 0;
    hb.forge = 1;
    const c = corners(hb);
    FIX.push({ t, x: c.ax, z: c.az, y: hb.y + FLOOR_TOP, in: hb });
    return 1;
  };
  if (v.rank >= 2) { if (!indoorFix(3, 3)) outdoorFix(3, 0); if (!indoorFix(4, 2)) outdoorFix(4, 977); }
  else {
    if (hash2(v.x, v.z, S + 43) % 100 < [25, 45][v.rank]) outdoorFix(3, 0);
    if (hash2(v.x, v.z, S + 48) % 100 < [25, 50][v.rank]) outdoorFix(4, 977);
  }
  if (v.rank >= 2) outdoorFix(13, 1234);   // the sawmill, out in a yard
  if (v.rank >= 1 || (hash2(v.x, v.z, S + 46) & 7) < 5) {
    const hb = host(2);
    if (hb) { hb.range = 1; const c = corners(hb); FIX.push({ t: 6, x: c.ax, z: c.az, y: hb.y + FLOOR_TOP, in: hb }); }
  }
  v.f = FIX;
  if (v.rank >= 2 || role === 1 || (v.rank === 1 && (hash2(v.x, v.z, S + 47) & 7) < 3)) {
    const hb = host(2, b => !b.range); if (hb) hb.bank = 1;
    if (role === 2 && hb) { const hb2 = host(2, b => !b.range && !b.bank && Math.sign(b.x - v.x) !== Math.sign(hb.x - v.x)); if (hb2) hb2.bank = 1; }   // Varrock banks east and west
  }
  if (v.rank >= 2 || (v.rank === 1 && (hash2(v.x, v.z, S + 49) & 3) === 0)) { const hb = host(2, b => !b.range && !b.bank); if (hb) hb.barber = 1; }

  // guaranteed amenities: OSRS players route by them. Every village prays; every town (and Lumbridge) banks, even from a street booth.
  const spotIn = (so, tries, maxR) => {   // an open interior tile, claimed
    for (let i = 0; i < tries; i++) {
      const h2 = hash2(v.x + i * 37 + so, v.z - i * 51 - so, S + 124);
      const [x, z] = polar(ring(h2, 0), 5 + (h2 >>> 10) % Math.max(5, maxR));
      if (get(x, z) !== G_EMPTY) continue;
      const y = heightAt(x, z);
      if (y < 1.9) continue;
      force(x, z, G_BUILD);
      return { x, z, y };
    }
    return null;
  };
  if (v.rank >= 1 && !(v.lm && v.lm.t === 0)) v.shrine = spotIn(0, 14, R - 8);   // a wayside altar when the church did not come
  if ((v.rank >= 2 || role === 1) && !B.some(b => b.bank)) v.booth = spotIn(477, role === 1 ? 48 : 14, role === 1 ? R - 6 : 9);   // no hall took the strongbox: a counter on the square
  const taken = [];   // the field ring's yards keep clear of each other
  const ringSpot = (so, tries, lo, span, ext, dh) => {   // flat open ground on the field ring, facing town
    for (let i = 0; i < tries; i++) {
      const h2 = hash2(v.x + i * 61 + so, v.z + i * 43 - so, S + 125);
      const [x, z] = polar(ring(h2, 0, 1, i * 0.9), R * (lo + (i % 4) * span));
      if (taken.some(t => chebDist(t.x, t.z, x, z) < t.r + ext + 2)) continue;
      const sp = spanHeights(x, z, ext, 2, (px, pz, py) => py >= 1.9);
      if (!sp || sp.hi - sp.lo > dh || highwayAt(x, z) > 0.1) continue;
      const ddx = v.x - x, ddz = v.z - z;
      taken.push({ x, z, r: ext });
      return { x: Math.round(x), z: Math.round(z), y: sp.hi, fd: Math.abs(ddx) > Math.abs(ddz) ? (ddx > 0 ? 1 : 3) : (ddz > 0 ? 2 : 0) };
    }
    return null;
  };
  if (v.rank >= 1) {   // the livestock pen: authored beasts, fenced
    v.pen = ringSpot(0, 16, 1.08, 0.09, 5, 1.4);
    if (v.pen) { const ph2 = hash2(v.x, v.z, S + 123); Object.assign(v.pen, { w: 5, d: 4, k: v.reg.wm > 0 && (ph2 & 1) ? 3 : ph2 % 3 }); }
  }
  v.circle = null;
  if (role === 2) for (let i = 0; i < 80 && !v.circle; i++) {   // the dark wizards' circle, beside the road out of the south gate (or the next gate round)
    const [x, z] = polar([0, PI / 2, -PI / 2, PI][i >> 4] + (i % 5 - 2) * 0.13, R * (1.2 + Math.floor((i & 15) / 5) * 0.08)), sp = spanHeights(x, z, 4, 2, (px, pz, py) => py >= 1.9);
    if (!sp || sp.hi - sp.lo > 1.6 || highwayAt(x, z) > 0.1 || taken.some(t => chebDist(t.x, t.z, x, z) < t.r + 6)) continue;
    taken.push({ x, z, r: 4 }); v.circle = { x, z, y: sp.hi, k: 8, name: 'the Dark Wizards\' Circle' };
  }
  for (let i = 0; i < 4 && !v.dock; i++) {   // a boardwalk from firm ground across the strand and out past the waterline
    const dir = [[1, 0], [-1, 0], [0, 1], [0, -1]][(hash2(v.x, v.z, S + 127) + i) & 3];
    let rx = 0, rz = 0, rootR = 0, wet = 0;
    for (let rr = Math.round(R * 0.7); rr <= R * 2.1; rr++) {
      const x = v.x + dir[0] * rr, z = v.z + dir[1] * rr, y2 = heightAt(x, z);
      if (y2 < SEA) { wet = rr; break; }
      if (y2 >= 1.0 && y2 <= 2.2) { rx = x; rz = z; rootR = rr; }
    }
    if (!wet || !rootR || wet - rootR > 15) continue;
    const len = Math.min(16, wet - rootR + 6);
    if (heightAt(rx + dir[0] * len, rz + dir[1] * len) > SEA - 0.2) continue;
    v.dock = { x: rx, z: rz, dx: dir[0], dz: dir[1], len };
  }
  if (v.rank >= 3 && (hash2(v.x, v.z, S + 121) & 3) !== 0) {   // the great cities charter a guild: premium ground behind a level-60 door
    const GK = GUILDS[hash2(v.x, v.z, S + 122) % GUILDS.length], g = ringSpot(911, 20, 1.12, 0.07, 7, 1.8);
    if (g) {
      const res = new Map(), lay = (rows, neg, r0) => { let ri = 0; for (const [rk, n] of rows) for (let q = 0; q < n; q++, ri++) { const a2 = ri * 2.4 + 1, rr = r0 + ri * 0.62; res.set(tk(Math.round(g.x + Math.sin(a2) * rr), Math.round(g.z + Math.cos(a2) * rr)), neg ? -(rk + 1) : rk + 1); } };
      if (GK.rocks) lay(GK.rocks, 0, 1.5);
      if (GK.trees) lay(GK.trees, 1, 1.8);
      v.guild = Object.assign(g, { g: GK, R: 7, res: res.size ? res : null, name: villageName(v) + ' ' + GK.n });
    }
  }

  // street trees in whatever ground is left
  const trees = [], step = v.rank >= 3 ? 2 : 3;
  for (let a = -gR; a <= gR && trees.length < 220; a += step) for (let b = -gR; b <= gR && trees.length < 220; b += step) {
    const x = v.x + a, z = v.z + b;
    if (get(x, z) !== G_EMPTY || vd(x, z) > R) continue;
    const h = hash2(x, z, S + 99);
    if ((h & 15) > 4) continue;
    const y = heightAt(x, z);
    if (y < 1.9) continue;
    force(x, z, G_PARK);
    trees.push({ x, z, y, s: 0.7 + (h >>> 8 & 31) / 31 * 0.7, broad: (h >>> 5) & 1 });
  }
  for (const g of greens) for (let a = -g.r; a <= g.r; a += 2) for (let b = -g.r; b <= g.r; b += 2) {   // the greens grow their own
    const x = g.x + a, z = g.z + b, h = hash2(x, z, S + 99);
    if (a * a + b * b > g.r * g.r || get(x, z) !== G_PARK || (h & 3) || trees.length >= 240) continue;
    trees.push({ x, z, y: heightAt(x, z), s: 0.9 + (h >>> 8 & 31) / 31 * 0.6, broad: 1 });
  }
  v.trees = trees;
  // where the townsfolk stand
  const spots = [];
  for (let i = 0; i < 400 && spots.length < 6 + v.rank * 4; i++) {
    const h = hash2(v.x + i * 131, v.z - i * 71, S + 100);
    const [x, z] = polar(ring(h, 0), ((h >>> 10) & 255) / 255 * R * 0.9), c = get(x, z);
    if (c === G_ROAD || c === G_PAVED || c === G_GATE) spots.push({ x, z });
  }
  v.spots = spots;

  // register floors and walls for O(1) lookups
  for (const b of B) {
    const blk = [];
    for (let a = -b.hw; a <= b.hw; a++) for (let c = -b.hd; c <= b.hd; c++) {
      const x = b.x + a, z = b.z + c, k = tk(x, z), edge = (a === -b.hw || a === b.hw || c === -b.hd || c === b.hd);
      if (edge && !(x === b.dx && z === b.dz)) blk.push(k); else floorMap.set(k, b);
    }
    b.blk = blk;
    if (b.shop !== null || b.bank || b.barber) {
      const ix = b.cx - DDX[b.door], iz = b.cz - DDZ[b.door];
      b.keeper = { x: Math.abs(ix - b.x) <= b.hw - 1 ? ix : b.cx, z: Math.abs(iz - b.z) <= b.hd - 1 ? iz : b.cz };
    }
  }
  if (v.keep) {
    const c = v.keep, blk = [], horiz = !(c.gate & 1);
    for (let a = -c.R; a <= c.R; a++) for (let b2 = -c.R; b2 <= c.R; b2++) {
      if (!(a === -c.R || a === c.R || b2 === -c.R || b2 === c.R)) continue;
      const onGate = (DDX[c.gate] && a === DDX[c.gate] * c.R) || (DDZ[c.gate] && b2 === DDZ[c.gate] * c.R);
      if (onGate && Math.abs(horiz ? a : b2) <= 1) continue;
      blk.push(tk(c.x + a, c.z + b2));
    }
   /* The ring above claims one tile per wall segment, which is all the curtain needs at 1.6 thick. The towers are
      another matter: the corner drums are 4.6 across and the wall and gatehouse towers 3.4, so each one covers
      ground two tiles beyond the line it sits on — and every one of those tiles was walkable, from the field as
      readily as from the courtyard. Claim what the stone actually stands on. */
    const drum = (tx, tz, r) => {
      const q = Math.ceil(r);
      for (let a = -q; a <= q; a++) for (let b2 = -q; b2 <= q; b2++) if (a * a + b2 * b2 <= r * r) blk.push(tk(tx + a, tz + b2));
    };
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) drum(c.x + sx * c.R, c.z + sz * c.R, 2.4);
    for (let s2 = 0; s2 < 4; s2++) {
      const hz = !(s2 & 1), wx = c.x + DDX[s2] * c.R, wz = c.z + DDZ[s2] * c.R;
      if (s2 !== c.gate) drum(wx, wz, 1.8);
      else for (const sg of [-1, 1]) drum(hz ? c.x + sg * 3 : wx, hz ? wz : c.z + sg * 3, 1.8);   // the twin gate drums stand clear of the three-tile opening
    }
    const k = c.hall;
    for (let a = -k.hw; a <= k.hw; a++) for (let b2 = -k.hd; b2 <= k.hd; b2++) blk.push(tk(k.x + a, k.z + b2));
    for (const o of c.out) { const ow = o.w >> 1, od = o.d >> 1; for (let a = -ow; a <= ow; a++) for (let b2 = -od; b2 <= od; b2++) blk.push(tk(o.x + a, o.z + b2)); }
    blk.push(tk(c.well.x, c.well.z));
    c.blk = blk;
   /* The slab is a floor like a deck is: walkY rides its top (the stone is 0.9 thick, centred 0.4 under c.y, so
      the surface is c.y + 0.05) instead of the ground it was poured over. `deck` keeps the HUD honest — an open
      courtyard is not a room — and `sill` gives the gateway a doorstep's budget rather than a stride's, so a
      castle on the one site the last lap had to take is still one you can walk into. */
    const flr = { y: c.y - FLOOR_TOP + 0.05, deck: 1, sill: 1 };
    for (let a = -c.R; a <= c.R; a++) for (let b2 = -c.R; b2 <= c.R; b2++) floorMap.set(tk(c.x + a, c.z + b2), flr);
  }
  if (v.lm) { const L = v.lm, b2 = []; for (let a = -L.R; a <= L.R; a++) for (let c2 = -L.R; c2 <= L.R; c2++) b2.push(tk(L.x + a, L.z + c2)); L.blk = b2; }
  if (v.ge) {   // ring wall with four gates; the counter island is solid
    const g = v.ge, blk = [];
    for (let a = -9; a <= 9; a++) for (let b2 = -9; b2 <= 9; b2++) {
      const d = Math.sqrt(a * a + b2 * b2);
      if (d < 7.6 || d > 8.9 || Math.abs(a) <= 1 || Math.abs(b2) <= 1) continue;
      blk.push(tk(g.x + a, g.z + b2));
    }
    for (let a = -3; a <= 3; a++) for (let b2 = -3; b2 <= 3; b2++) blk.push(tk(g.x + a, g.z + b2));
    g.blk = blk;
  }
  if (v.dock) {   // the deck is a floor: walkY rides it out over the water
    const d2 = v.dock, dk = { y: 0.6, deck: 1 };
    for (let q = 1; q <= d2.len; q++) floorMap.set(tk(d2.x + d2.dx * q, d2.z + d2.dz * q), dk);
  }
  for (const w of v.wall) w.key = tk(w.x, w.z);
  return B;
}
const villageBuildings = v => { if (!v.b) layoutCity(v); return v.b; };
const insideAt = (x, z) => floorMap.get(tk(x, z)) || null;
function cityCell(x, z) {
  const n = nearVillage(x, z);
  if (!n) return 0;
  const v = n.v;
  if (!v.G) layoutCity(v);
  const gR = v.gR, D = v.gD, ix = Math.round(x) - v.x + gR, iz = Math.round(z) - v.z + gR;   // the grid is whole tiles; the quads ask at their centres
  return (ix < 0 || iz < 0 || ix >= D || iz >= D) ? 0 : v.G[iz * D + ix];
}
/* ---- 15. CHUNKS ---- */
const chunks = new Map(), pending = [];
let tilesGenerated = 0;
const ck = (x, z) => x * 1048576 + z;
const blocked = new Map(), opaque = new Map();   // tile -> claim count (trunks, veins, walls); opaque is the subset that also stops an arrow
const refc = (m, k, d) => { const c = (m.get(k) || 0) + d; if (c > 0) m.set(k, c); else m.delete(k); };
/* soft = a body, not a thing: a monster's footprint claims the ground for walking but never for sight, as 2007 arrows fly over each other */
const block = (k, soft) => { refc(blocked, k, 1); if (!soft) refc(opaque, k, 1); };
const unblock = (k, soft) => { refc(blocked, k, -1); if (!soft) refc(opaque, k, -1); };
const shut = (k, own) => (blocked.get(k) || 0) > (own && own.has(k) ? 1 : 0);   // a claim of one's own never bars its owner: an oversized thing walks its own footprint and nothing else's
/* A tree's claim on its tile is the object's own, held or not: rec.blk carries only what never comes and goes, so no
   order of populate, chop, respawn and dispose can strand a count on an empty tile — which used to leave an
   unclearable invisible wall AND delete the tree, since the next populate skips a blocked key. */
const claim = o => { if (!o.bk) { o.bk = 1; block(o.key); } };
const unclaim = o => { if (o.bk) { o.bk = 0; unblock(o.key); } };
const depleted = new Map();   // tile key -> tick it comes back
const objIndex = new Map();

/* the macro field never changes for a seed, and steps 0.5 and 1 sample the identical grid — every LOD promotion
   used to recompute it. Keyed on (cx, cz, ms), kept across disposeChunk, distance-evicted in refresh(). */
const mhCache = new Map();
function macroGrid(cx, cz, ms) {
  const key = cx + ':' + cz + ':' + ms;
  let MH = mhCache.get(key);
  if (MH) return MH;
  const M = Math.round(CHUNK / ms), ox = cx * CHUNK, oz = cz * CHUNK;
  MH = new Float32Array((M + 1) * (M + 1));
  for (let j = 0; j <= M; j++) for (let i = 0; i <= M; i++) MH[j * (M + 1) + i] = macroHeight(ox + i * ms, oz + j * ms);
  mhCache.set(key, MH);
  return MH;
}
function buildChunk(cx, cz, step, ring) {
  const N = Math.round(CHUNK / step), ox = cx * CHUNK, oz = cz * CHUNK;
  // macro relief sampled per tile and interpolated; micro relief and flattening at full mesh resolution
  const ms = Math.max(step, 1), M = Math.round(CHUNK / ms), MH = macroGrid(cx, cz, ms);
  const stride = N + 1, H = new Float32Array(stride * stride), ratio = step / ms;
  let lo = 1e9, hi = -1e9;
  for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) {
    const fx = i * ratio, fz = j * ratio, i0 = Math.min(Math.floor(fx), M - 1), j0 = Math.min(Math.floor(fz), M - 1);
    const txf = fx - i0, tzf = fz - j0, r0 = j0 * (M + 1) + i0, r1 = r0 + M + 1;
    const a = MH[r0] + (MH[r0 + 1] - MH[r0]) * txf, c = MH[r1] + (MH[r1 + 1] - MH[r1]) * txf;
    const y = finish(ox + i * step, oz + j * step, a + (c - a) * tzf);
    H[j * stride + i] = y;
    if (y < lo) lo = y; if (y > hi) hi = y;
  }
  tilesGenerated += CHUNK * CHUNK;
  const quads = N * N + N * 4, pos = new Float32Array(quads * 18), col = new Float32Array(quads * 18);
  let p = 0, c2 = 0;
  function quad(x0, y0, z0, x1, y1, z1, x2, y2, z2, x3, y3, z3, r, g, b) {
    const ax = x1 - x0, ay = y1 - y0, az = z1 - z0, bx = x2 - x0, by = y2 - y0, bz = z2 - z0;
    const nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx, L = Math.hypot(nx, ny, nz) || 1;
    const sh = 0.46 + 0.54 * Math.max(0, (nx * NLX + ny * NLY + nz * NLZ) / L), R = r * sh, G = g * sh, Bl = b * sh;
   // the two triangles go straight into the buffer: the scratch array was one allocation per quad, thousands a chunk
    pos[p] = x0; pos[p + 1] = y0; pos[p + 2] = z0; pos[p + 3] = x2; pos[p + 4] = y2; pos[p + 5] = z2;
    pos[p + 6] = x1; pos[p + 7] = y1; pos[p + 8] = z1; pos[p + 9] = x1; pos[p + 10] = y1; pos[p + 11] = z1;
    pos[p + 12] = x2; pos[p + 13] = y2; pos[p + 14] = z2; pos[p + 15] = x3; pos[p + 16] = y3; pos[p + 17] = z3;
    p += 18;
    for (let k = 0; k < 6; k++) { col[c2++] = R; col[c2++] = G; col[c2++] = Bl; }
  }
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const a = H[j * stride + i], b = H[j * stride + i + 1], d = H[(j + 1) * stride + i], e = H[(j + 1) * stride + i + 1];
    const slope = (Math.abs(a - b) + Math.abs(a - d) + Math.abs(b - e)) / (3 * step);
    const rgb = colorAt(ox + i * step + step * 0.5, oz + j * step + step * 0.5, (a + b + d + e) * 0.25, slope), X = ox + i * step, Z = oz + j * step;
    quad(X, a, Z, X + step, b, Z, X, d, Z + step, X + step, e, Z + step, rgb[0], rgb[1], rgb[2]);
  }
  const SK = 9, s0 = 0.22, s1 = 0.20, s2 = 0.16;   // skirt, so LOD seams never show daylight
  for (let i = 0; i < N; i++) {
    const t = H[i], t2 = H[i + 1], u = H[N * stride + i], u2 = H[N * stride + i + 1], ze = oz + CHUNK;
    quad(ox + i * step, t, oz, ox + (i + 1) * step, t2, oz, ox + i * step, t - SK, oz, ox + (i + 1) * step, t2 - SK, oz, s0, s1, s2);
    quad(ox + i * step, u - SK, ze, ox + (i + 1) * step, u2 - SK, ze, ox + i * step, u, ze, ox + (i + 1) * step, u2, ze, s0, s1, s2);
    const l = H[i * stride], l2 = H[(i + 1) * stride], q0 = H[i * stride + N], q1 = H[(i + 1) * stride + N], xe = ox + CHUNK;
    quad(ox, l - SK, oz + i * step, ox, l2 - SK, oz + (i + 1) * step, ox, l, oz + i * step, ox, l2, oz + (i + 1) * step, s0, s1, s2);
    quad(xe, q0, oz + i * step, xe, q1, oz + (i + 1) * step, xe, q0 - SK, oz + i * step, xe, q1 - SK, oz + (i + 1) * step, s0, s1, s2);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.computeBoundingSphere();
  const mesh = new THREE.Mesh(geo, mat);
  scene.add(mesh);
  const rec = { mesh, step, cx, cz, extra: [], objs: [], blk: [], roofs: [], H, stride, gs: Math.round(1 / step), lo, hi, near: step <= 1, ring, pop: 0 };
  return rec;
}
/* the second phase: trees, veins, decor and buildings land on a near chunk a frame or two after its ground does,
   so no single frame pays for both. pump() drains this before starting new terrain. */
function populateChunk(rec) {
  rec.pop = 1;
  if (!rec.near) return;
  scatterResources(rec, rec.cx, rec.cz); scatterDecor(rec, rec.cx, rec.cz); buildStructures(rec, rec.cx, rec.cz);   // no ring term: what a chunk grows is a function of its tiles, not of how far away it was when it was laid
  for (const k of rec.blk) block(k);
  for (const o of rec.objs) { objIndex.set(o.key, o); if (depleted.has(o.key)) hideInst(o); else if (o.t === 0) claim(o); }   // a stump felled while we were away keeps its tile open
}
const recH = (rec, x, z) => rec.H[((z - rec.cz * CHUNK) * rec.gs) * rec.stride + (x - rec.cx * CHUNK) * rec.gs];
/* ambient species are texture only: the rare woods (maple+, mahogany, yew, magic) and every ore seam above iron live in
   the NAMED sites — a yew is somewhere, not a lottery ticket. The region flavours what the background grows. */
function treeKind(y, moist, h, A) {
  const r = (h >>> 13) & 255;
  if (A && A.pine) return r < 210 ? 0 : 1;   // the frozen reach grows pine and little else
  if (y > 34) return 3;
  if (y < 4.6 && moist > 0.06) return r < 150 ? 2 : 0;
  if (moist > 0.22) return r < 110 ? 1 : 0;
  return r < 40 ? 1 : 0;
}
function oreKind(y, h) {
  const r = (h >>> 7) % 1000;
  if (y > 30 && r < 260) return 3;
  if (r < 280) return 2;
  if (r < 560) return 1;
  return 0;
}
const lvlOk = (k, y) => ORES[k].lv <= 30 || y > 20;
const TREE_BROAD = [0, 1, 1, 1, 0, 1, 1];
const tileSlope = (rec, x, z, y) => Math.abs(recH(rec, x + 1, z) - y) + Math.abs(recH(rec, x, z + 1) - y);
const treeScale = (k, h) => (0.66 + ((h >>> 10) & 255) / 255 * 0.62) * TREES[k].sc;
const rockScale = h => 0.8 + ((h >>> 17) & 15) / 15 * 0.45;
/* trees, veins and fishing spots: instanced, so a chopped tree can vanish without rebuilding the chunk */
function scatterResources(rec, cx, cz) {
  const ox = cx * CHUNK, oz = cz * CHUNK, cm = [], cc = [], bm = [], bc = [], rm = [], rc = [];
  const TCAP = 96, RCAP = 34;
  const putRock = (x, z, y, k, h, key) => {
    const st = rockScale(h);
    rec.objs.push({ t: 1, k, x, z, y, key, n: ORES[k].n, h7: h });
    rm.push([x, y - 0.15, z, ((h >>> 21) & 63) / 64 * TAU, st, st * 0.85]); rc.push(ORES[k].tint); rec.blk.push(key);
  };
  const putTree = (x, z, y, k, h, key, sm, ashen) => {
    const T = TREES[k], s = treeScale(k, h) * sm;
    let tint = T.tint;
    if (ashen) {   // wilderness trees stand grey-brown and half dead
      const r = ((tint >> 16 & 255) * 0.42 + 26) | 0, g = ((tint >> 8 & 255) * 0.34 + 22) | 0, b2 = ((tint & 255) * 0.34 + 18) | 0;
      tint = (r << 16) | (g << 8) | b2;
    }
    rec.objs.push({ t: 0, k, x, z, y, key, n: T.n, h7: h, ash: ashen ? 1 : 0 });
    const row = [x, y - 0.2, z, ((h >>> 26) & 63) / 64 * TAU, s, s * (0.84 + ((h >>> 4) & 31) / 31 * 0.42)];
    if (TREE_BROAD[k]) { bm.push(row); bc.push(tint); } else { cm.push(row); cc.push(tint); }
  };
  for (let j = 0; j < CHUNK; j++) for (let i = 0; i < CHUNK; i++) {
    const x = ox + i, z = oz + j, y = recH(rec, x, z), key = tk(x, z);
    if (y < SEA) {
      if (z < 500000 && fishSpotAt(x, z, key)) rec.objs.push({ t: 2, k: y < -4.5 ? 1 : 0, x, z, y: 0, key, n: 'Fishing spot' });
      continue;
    }
    if (y < 1.7 || y > 70 || blocked.has(key) || floorMap.has(key) || onDitchBank(x, z) || cityCell(x, z) !== 0) continue;
    if (z > 500000) {   // dungeon ground grows nothing; it only bares its marked veins
      const dk = dunVein(x, z);
      if (dk >= 0 && rm.length < RCAP) {
        const h2 = hash2(x, z, S + 101);
        putRock(x, z, y, dk, h2, key);
      }
      continue;
    }
    const h = hash2(x, z, S + 101), nv = nearVillage(x, z), inTown = nv && nv.d < nv.v.r * 1.05;
    const st = nearSite(x, z);   // the named sites lay their exact stock first: mines, groves, guild yards
    let fr = (st && st.s.res && st.s.res.get(key)) || 0;
    if (!fr && nv && nv.v.guild && nv.v.guild.res) fr = nv.v.guild.res.get(key) || 0;
    if (fr) {
      if (tileSlope(rec, x, z, y) < 5.5) {
        if (fr > 0) { if (rm.length < RCAP) putRock(x, z, y, fr - 1, h, key); }
        else if (cm.length + bm.length < TCAP) putTree(x, z, y, -fr - 1, h, key, 1.22, wildLvAt(x, z) > 0);
      }
      continue;
    }
    const slope = tileSlope(rec, x, z, y);
    if (rm.length < RCAP) {   // stray surface rock is low-tier texture; the seams live in the mines
      const rocky = (slope > 1.5 && y > 6) || y > 34, chance = rocky ? 0.006 : 0.0005;
      if (!inTown && slope < 5.5 && ((h >>> 3) & 4095) / 4096 < chance) {
        const k = oreKind(y, h);
        if (lvlOk(k, y)) { putRock(x, z, y, k, h, key); continue; }
      }
    }
    if (y > 48 || cm.length + bm.length >= TCAP) continue;
    if (st && st.s.t === 1 && st.d < st.s.r + 1.5) continue;   // no saplings on the mine floor
    const moist = biomeAt(x, z), A = regionAt(x, z).a;
    let td = (0.010 + Math.max(0, moist + 0.10) * 0.13) * (1 - smoothstep(30, 47, y)) * A.td;   // the kingdom sets the woods
    const wl2 = wildLvAt(x, z);
    if (wl2) {   // the wilds grow thin and scraggly whatever the kingdom; never on a door
      td = Math.min(td * 0.45, 0.024);
      const cvc = caveAt(Math.floor(x / CAVE_CELL), Math.floor(z / CAVE_CELL));
      if (cvc && chebDist(cvc.x, cvc.z, x, z) <= 3) continue;
    }
    if (inTown || fieldAt(x, z, nv)) td *= 0.05;
    if ((h & 1023) / 1024 > td || slope > 2.6) continue;
    putTree(x, z, y, treeKind(y, moist, h, A), h, key, 1, wl2 > 0);
  }
  if (cm.length) rec.extra.push(instance(CONIFER_GEO, cm, cc, rec, 0, 0));
  if (bm.length) rec.extra.push(instance(BROAD_GEO, bm, bc, rec, 0, 1));
  if (rm.length) rec.extra.push(instance(ROCK_GEO, rm, rc, rec, 1, -1));
}
/* rows are [x, y, z, rot, scale, yscale]; tag/broad select which objects this mesh owns */
function instance(geo, rows, cols, rec, tag, broad) {
  const inst = new THREE.InstancedMesh(boundView(geo, rec.cx, rec.cz, rec.lo, rec.hi + 8), tintMat, rows.length);
  rows.forEach((r, i) => {
    _q.setFromAxisAngle(_up, r[3]);
    inst.setMatrixAt(i, _m4.compose(_v3.set(r[0], r[1], r[2]), _q, _s3.set(r[4], r[5], r[4])));
    inst.setColorAt(i, _col.setHex(cols[i]));
  });
  inst.instanceMatrix.needsUpdate = true; inst.instanceColor.needsUpdate = true;
  scene.add(inst);
  let n = 0;
  for (const o of rec.objs) {
    if (o.t !== tag || (tag === 0 && TREE_BROAD[o.k] !== broad)) continue;
    o.inst = inst; o.slot = n++;
  }
  return inst;
}
const hideInst = o => { if (o.inst) { o.inst.setMatrixAt(o.slot, ZERO); o.inst.instanceMatrix.needsUpdate = true; } };
/* the inverse: re-lay the proc instance from the tile's own dice (the same rolls scatterResources made) */
function showInst(o) {
  if (!o.inst) return;
  const y = tileH(o.x, o.z), h = hash2(o.x, o.z, S + 101), s = o.t === 0 ? treeScale(o.k, h) : rockScale(h);
  const sy = o.t === 0 ? s * (0.84 + ((h >>> 4) & 31) / 31 * 0.42) : s * 0.85;
  _q.setFromAxisAngle(_up, ((h >>> (o.t ? 21 : 26)) & 63) / 64 * TAU);
  _v3.set(o.x, y - (o.t ? 0.15 : 0.2), o.z);
  o.inst.setMatrixAt(o.slot, _m4.compose(_v3, _q, _s3.set(s, sy, s)));
  o.inst.instanceMatrix.needsUpdate = true;
}
/* scenery with no gameplay: one merged mesh per chunk */
function scatterDecor(rec, cx, cz) {
  const ox = cx * CHUNK, oz = cz * CHUNK;
  let n = 0;
  batchInto(rec, B => {
    for (let j = 0; j < CHUNK; j++) for (let i = 0; i < CHUNK; i++) {
      if (n > 150) break;
      const x = ox + i, z = oz + j, y = recH(rec, x, z), key = tk(x, z);
      if (z > 500000 || blocked.has(key) || floorMap.has(key) || onDitchBank(x, z) || (y > 1.2 && cityCell(x, z) !== 0)) continue;
      const h = hash2(x, z, S + 103), r1 = (h & 1023) / 1024, r2 = ((h >>> 10) & 1023) / 1024, rot = ((h >>> 20) & 63) / 64 * TAU;
      const jx = x + ((h >>> 26) & 7) / 8 - 0.5, jz = z + ((h >>> 6) & 7) / 8 - 0.5;
      if (y > -0.5 && y < 1.15) {   // reed beds — nothing green fringes a lava shore
        if (r1 < 0.16 && !wildLvAt(x, z)) { for (let q = 0; q < 3; q++) { const a = rot + q * 2.1, rr = 0.35 + q * 0.12; B.add(SPIRE, jx + Math.cos(a) * rr, y + 0.34, jz + Math.sin(a) * rr, 0.26, 1.0 + r2 * 0.7, 0.26, 0, REED); } n++; }
        continue;
      }
      if (y < 1.7 || y > 66) continue;
      const slope = tileSlope(rec, x, z, y), nv = nearVillage(x, z);
      if (nv && nv.d < nv.v.r * 0.95) continue;
      if (y < 26 && slope < 0.7) {
        const f = fieldAt(x, z, nv);
        if (f) {
          if ((((f === 1 ? z : x) & 1) === 0) && ((h >> 4) & 3) !== 0) {
            if ((h >> 8) & 1) B.add(SPIRE, jx, y + 0.55, jz, 0.30, 1.1, 0.30, rot, [0.66, 0.58, 0.26]); else B.add(BLOB, jx, y + 0.22, jz, 0.62, 0.5, 0.62, rot, [0.28, 0.46, 0.18]);
            n++;
          }
          continue;
        }
      }
      const rocky = smoothstep(1.1, 2.6, slope) * 0.5 + smoothstep(34, 60, y) * 0.35;
      const gv = wildLvAt(x, z) ? 0.12 : clamp(regionAt(x, z).a.td, 0.12, 1.2);   // sparse kingdoms grow sparse scrub; the wilds barely any
      if (r2 < 0.008 + rocky * 0.14) {
        const rs = 0.5 + ((h >>> 3) & 15) / 15 * 1.7;
        B.add(BLOB, jx, y + rs * 0.2, jz, rs * 1.5, rs * 1.1, rs * 1.25, rot, STONE);
        if (rs > 1.4) B.add(BLOB, jx + rs * 0.6, y + rs * 0.1, jz - rs * 0.4, rs * 0.7, rs * 0.6, rs * 0.7, rot, STONE);
        n++;
      } else if (r2 > 1 - 0.05 * gv && y < 40) {
        const bs = 0.5 + ((h >>> 3) & 15) / 15 * 0.55;
        B.add(BLOB, jx, y + bs * 0.4, jz, bs * 2.0, bs * 1.4, bs * 2.0, rot, SHRUB); n++;
      } else if (r1 > 0.93 - 0.03 * gv && r1 < 0.93 && y < 34) {
        for (let q = 0; q < 3; q++) B.add(SPIRE, jx + (q - 1) * 0.22, y + 0.16, jz + ((q & 1) - 0.5) * 0.3, 0.16, 0.5, 0.16, rot, [0.35, 0.48, 0.2]);
        n++;
      }
    }
  });
}
const FIX_NAME = { 3: 'Furnace', 4: 'Anvil', 6: 'Cooking range', 13: 'Sawmill' };
const keeperObj = (t, k, x, z, y, n, b) => ({ t, k, x, z, y, key: tk(x, z), n, b });
/* cottages, shops, fixtures and the castle, filed into whichever chunk holds them */
function buildStructures(rec, cx, cz) {
  const gx = Math.floor(cx * CHUNK * INV_CELL), gz = Math.floor(cz * CHUNK * INV_CELL);
  const x0 = cx * CHUNK, x1 = x0 + CHUNK, z0 = cz * CHUNK, z1 = z0 + CHUNK;
  const inChunk = (x, z) => x >= x0 && x < x1 && z >= z0 && z < z1;
  const mine = [], forges = [], walls = [], gts = [], citytrees = [], lms = [], furn = [], ges = [], vs = [];
  let castle = null;
  for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
    const v = villageAt(gx + a, gz + b);
    if (!v) continue;
    villageBuildings(v); vs.push(v);
    if (v.ge && inChunk(v.ge.x, v.ge.z)) {
      const g = v.ge;
      ges.push(g); rec.blk.push(...g.blk);
   // four counter sides, each with a banker (7) and a clerk (10): booth on the counter, keeper a tile behind it
      const st = [[-1, -3, 7, -1, -2, PI], [1, -3, 10, 1, -2, PI], [3, -1, 7, 2, -1, PI / 2], [3, 1, 10, 2, 1, PI / 2],
                  [1, 3, 7, 1, 2, 0], [-1, 3, 10, -1, 2, 0], [-3, 1, 7, -2, 1, -PI / 2], [-3, -1, 10, -2, -1, -PI / 2]];
      st.forEach(([sx, sz, t, kx, kz, dir], i) => rec.objs.push({ t, k: 0, x: g.x + sx, z: g.z + sz, y: heightAt(g.x + kx, g.z + kz) + 0.13, key: tk(g.x + sx, g.z + sz),
        n: t === 7 ? 'Banker' : 'Grand Exchange clerk', kx: g.x + kx, kz: g.z + kz, dir, noMark: (i & 6) !== 0 ? 1 : 0 }));
    }
    for (const bd of v.b) if (inChunk(bd.x, bd.z)) mine.push(bd);
    for (const f of v.f) if (inChunk(f.x, f.z)) { const o = keeperObj(f.t, 0, f.x, f.z, f.y, FIX_NAME[f.t]); rec.objs.push(o); rec.blk.push(o.key); forges.push(f); }
    if (v.keep && inChunk(v.keep.x, v.keep.z)) { castle = v.keep; castle.v = v; }
    if (v.lm && inChunk(v.lm.x, v.lm.z)) {
      lms.push(v.lm); rec.blk.push(...v.lm.blk);
      if (v.lm.t === 0) rec.objs.push(keeperObj(8, 0, v.lm.x + 1, v.lm.z - 4, v.lm.y, 'Altar'));   // the church porch altar
      if (v.lm.t === 1) rec.objs.push(keeperObj(25, 0, v.lm.x + 1, v.lm.z - 4, v.lm.y, 'Windmill'));   // the mill finally grinds
    }
    for (const fu of v.fur) if (inChunk(fu.x, fu.z)) {
      furn.push(fu);
      if (fu.t === 2) { for (let p = -1; p <= 1; p++) for (let q = -1; q <= 1; q++) rec.blk.push(tk(fu.x + p, fu.z + q)); } else rec.blk.push(tk(fu.x, fu.z));
    }
    for (const w of v.wall) if (inChunk(w.x, w.z)) { walls.push(w); rec.blk.push(w.key); }
    for (const g of v.gates) if (inChunk(g.x, g.z)) gts.push(g);
    for (const t of v.trees) if (inChunk(t.x, t.z)) { citytrees.push(t); rec.blk.push(tk(t.x, t.z)); }
  }
  for (const f of structHooks) f(rec, vs, inChunk);
  if (castle) {
    batchInto(rec, B => emitCastle(B, castle)); rec.blk.push(...castle.blk);
    const k = castle.hall, dx2 = Math.round(k.x + DDX[castle.gate] * (k.w / 2)), dz2 = Math.round(k.z + DDZ[castle.gate] * (k.d / 2));
    if (castle.v.rank >= 3) rec.objs.push({ t: 23, k: 0, x: dx2, z: dz2, y: castle.y, key: tk(dx2, dz2), n: 'Dungeon' });   // sits on the slab itself; the walk stops at reach 1, outside the wall. Lumbridge's small keep has no cellar
  }
  if (walls.length || gts.length || citytrees.length || lms.length || furn.length || ges.length) batchInto(rec, W => {
    for (const w of walls) emitWallCell(W, w);
    for (const g of gts) emitGate(W, g, rec);
    for (const t of citytrees) emitCityTree(W, t);
    for (const L of lms) emitLandmark(W, L);
    for (const fu of furn) emitFurniture(W, fu);
    for (const g of ges) emitGE(W, g);
  });
  if (!mine.length && !forges.length) return;
  batchInto(rec, shell => {
    for (const f of forges) emitForge(shell, f);
    for (const b of mine) {
      emitShell(shell, b); rec.blk.push(...b.blk);
      const kp = b.keeper, y = b.y + FLOOR_TOP;
      if (b.shop !== null) rec.objs.push(keeperObj(5, b.shop, kp.x, kp.z, y, SHOP_KINDS[b.shop].n, b));
      if (b.bank) rec.objs.push(keeperObj(7, 0, kp.x, kp.z, y, 'Banker', b));
      if (b.barber) rec.objs.push(keeperObj(9, 0, kp.x, kp.z, y, 'Barber', b));
    }
  });
  for (const b of mine) {   // one mesh per roof, so it lifts alone
    const m = batchInto(rec, rb => emitRoof(rb, b));
    if (m) { b.roof = m; m.visible = roofShown(b); rec.roofs.push(b); }
  }
}
function disposeChunk(rec) {
  scene.remove(rec.mesh); rec.mesh.geometry.dispose();
  for (const e of rec.extra) { scene.remove(e); if (e.isInstancedMesh) { e.dispose(); freeView(e.geometry); } else e.geometry.dispose(); }
  for (const b of rec.roofs) b.roof = null;
  for (const k of rec.blk) unblock(k);
  for (const o of rec.objs) { unclaim(o); if (o.s7) drop7(o); if (objIndex.get(o.key) === o) objIndex.delete(o.key); }
}

/* ---- 16. HEIGHT, FLOORS AND WALKABILITY ---- */
let indoors = null;
const roofShown = b => !OPT.hideRoofs && !(OPT.roofs && indoors === b);
function tileH(x, z) {
  const rec = chunks.get(ck(Math.floor(x / CHUNK), Math.floor(z / CHUNK)));
  return rec && rec.near ? recH(rec, x, z) : heightAt(x, z);
}
function walkY(x, z) { const b = floorMap.get(tk(x, z)); return b ? b.y + FLOOR_TOP : tileH(x, z); }
function groundY(x, z) {
  const b = floorMap.get(tk(Math.round(x), Math.round(z)));
  if (b) return b.y + FLOOR_TOP;
  const x0 = Math.floor(x), z0 = Math.floor(z), fx = x - x0, fz = z - z0;
  const a = tileH(x0, z0), b1 = tileH(x0 + 1, z0), c = tileH(x0, z0 + 1), d = tileH(x0 + 1, z0 + 1), t = a + (b1 - a) * fx;
  return t + (c + (d - c) * fx - t) * fz;
}
const isWater = h => h < SEA;
const STUCK_CLIMB = 8.5;   // stuck mode clears the 6.5-unit ledges; masonry stays shut
/* a doorway is a step, not a cliff: a house floor sits on the lot's high corner, so on sloping ground the
   threshold can stand further above the grass than an ordinary stride. The doorstep budget covers the
   worst lot the claim allows (2.2 of fall plus the floor's own 0.2) so a door is never a one-way trip. */
const DOORSTEP = 2.6;
function canStep(fx, fz, tx, tz, own) {
    if (shut(tk(tx, tz), own) && !shut(tk(fx, fz), own)) return false;   // already inside something that isn't ours: walk out through it
  const a = walkY(fx, fz), b = walkY(tx, tz), aw = isWater(a), bw = isWater(b);
  if (aw !== bw) return Math.abs(a - b) < 8;
  if (bw) return true;
  const ra = floorMap.get(tk(fx, fz)), rb = floorMap.get(tk(tx, tz));
  const fl = ra || rb;   // a house door, or a castle gateway onto its slab
  if (!ra !== !rb && (fl.house !== undefined || fl.sill)) return Math.abs(a - b) <= Math.max(DOORSTEP, OPT.stuck ? STUCK_CLIMB : CLIMB);
  return Math.abs(a - b) <= (OPT.stuck ? STUCK_CLIMB : CLIMB);
}
const dry = (x, z) => !isWater(walkY(x, z)) && !blocked.has(tk(x, z));
const dryOpen = (x, z) => dry(x, z) && !floorMap.has(tk(x, z));

/* ---- LINE OF SIGHT: a walk down the tile line, not a ray. A tile hides what is behind it when something opaque stands on it
   (trunk, vein, wall, web) or when the ground itself rears LOS_RISE above the chord between the two pairs of feet — which is
   every dungeon wall (9.5 over its floor) and every quantised ledge (6.5), and no hummock the open field rolls up. The two ends
   are swapped into one fixed order, so a monster can never see what you cannot, and every input — the claim map, integer tile
   heights — is the same on every client, so two clients simulating the same monster agree. It walks at most range-1 tiles, nine
   at MAGIC_RANGE, and returns before touching the ground at all when the pair are adjacent, which is every melee swing. Never
   memoise it: the map and the footprints move every tick, and a stale answer is the divergence this exists to avoid. ---- */
const LOS_RISE = 3.2;   // half a ledge: taller than any rise the open field rolls up, shorter than anything you would hide behind
function hasLos(ax, az, bx, bz) {
  if (bx < ax || (bx === ax && bz < az)) { let t = ax; ax = bx; bx = t; t = az; az = bz; bz = t; }
  const dx = bx - ax, dz = bz - az, n = Math.max(Math.abs(dx), Math.abs(dz));
  if (n < 2) return true;   // adjacent, diagonals included: nothing fits between
  const ay = walkY(ax, az), by = walkY(bx, bz), sx = dx / n, sz = dz / n;
  for (let i = 1; i < n; i++) {
    const x = Math.round(ax + sx * i), z = Math.round(az + sz * i);
    if (opaque.has(tk(x, z)) || walkY(x, z) > ay + (by - ay) * (i / n) + LOS_RISE) return false;
  }
  return true;
}

/* ---- 17. STREAMING LOOP: half-tile quads nearby, then 1, 2, 4, with hysteresis ---- */
const focus = new THREE.Vector3(0, 0, 0);
const BANDS = [[0, 1, 0.5], [2, 3, 1], [4, 5, 2], [6, 99, 4]];
function stepFor(d, cur) {
  if (cur !== undefined) for (const b of BANDS) if (b[2] === cur && d >= b[0] - 1 && d <= b[1] + 1) return cur;
  for (const b of BANDS) if (d <= b[1]) return b[2];
  return 4;
}
/* delete the oldest half of a memo once it outgrows its cap: an infinite world must not grow them without bound */
const capMap = (m, cap) => { if (m.size > cap) { let n = m.size - (cap >> 1); for (const k of m.keys()) { if (n-- <= 0) break; m.delete(k); } } };
function refresh() {
  const pcx = Math.floor(focus.x / CHUNK), pcz = Math.floor(focus.z / CHUNK);
  pending.length = 0;
  for (let a = -RADIUS; a <= RADIUS; a++) for (let b = -RADIUS; b <= RADIUS; b++) {
    const d = Math.max(Math.abs(a), Math.abs(b)), cx = pcx + a, cz = pcz + b, k = ck(cx, cz), have = chunks.get(k), want = stepFor(d, have && have.step);
    if (!have || have.step !== want) pending.push({ cx, cz, step: want, d, k });
  }
  pending.sort((p, q) => p.d - q.d);
  for (const [k, rec] of chunks) if (Math.max(Math.abs(rec.cx - pcx), Math.abs(rec.cz - pcz)) > RADIUS + 1) { disposeChunk(rec); chunks.delete(k); }
  for (const k of mhCache.keys()) { const [cx, cz] = k.split(':'); if (Math.max(Math.abs(cx - pcx), Math.abs(cz - pcz)) > RADIUS + 2) mhCache.delete(k); }
  capMap(villageCache, 3000); capMap(nbrCache, 3000); capMap(roadCache, 2000); capMap(ruinCache, 600);
  capMap(siteCache, 1600); capMap(fishCache, 1600); capMap(regCache, 400); capMap(caveCache, 400); capMap(bridgeCache, 600);
  nearDirty = 1;
}
const popQueue = [];
function pump(budgetMs, maxChunks) {
  const t0 = performance.now();
  while (popQueue.length && performance.now() - t0 < budgetMs) {   // finish grounds already laid before laying more
    const rec = popQueue.shift();
    if (!rec.pop && rec.mesh.parent) { populateChunk(rec); nearDirty = 1; }
  }
  let n = 0;
  while (pending.length && n < (maxChunks || 99) && performance.now() - t0 < budgetMs) {
    n++;
    const job = pending.shift(), old = chunks.get(job.k);
    if (old) disposeChunk(old);
    const rec = buildChunk(job.cx, job.cz, job.step, job.d);
    chunks.set(job.k, rec);
    if (rec.near) popQueue.push(rec); else rec.pop = 1;
    if (rec.near || (old && old.near)) nearDirty = 1;   // a far chunk carries no objs either way: only a near one moves the list
  }
}
let nearObjs = [], nearDirty = 1;
/* the short list: only what sits within ~64 tiles, for the consumers that scan every frame (pools, minimap dots,
   town markers). Picking keeps the full list so a far tree on screen still answers a click. */
let closeObjs = [], _cox = 1e9, _coz = 1e9;
function rebuildClose() {
  _cox = P.tx; _coz = P.tz; closeObjs.length = 0;
  for (const o of nearObjs) if (Math.abs(o.x - _cox) <= 64 && Math.abs(o.z - _coz) <= 64) closeObjs.push(o);
}
function closeList() {
  if (Math.abs(P.tx - _cox) > 12 || Math.abs(P.tz - _coz) > 12) rebuildClose();
  return closeObjs;
}
function rebuildNear() {
  nearDirty = 0; nearObjs.length = 0;
  const pcx = Math.floor(focus.x / CHUNK), pcz = Math.floor(focus.z / CHUNK);
  for (let a = -3; a <= 3; a++) for (let b = -3; b <= 3; b++) { const rec = chunks.get(ck(pcx + a, pcz + b)); if (rec && rec.near) nearObjs.push(...rec.objs); }
  rebuildClose();
}
/* move the player and the world around them in one go; ms is the chunk-build budget */
function teleport(x, z, ms) {
  P.atkT = Math.max(P.atkT, tickN + 5);   // the room stays the blade for WARP_LOCK after a jump: never spend a swing it will silently drop
  focus.set(x, 0, z); refresh(); pump(ms);
  while (popQueue.length) { const r = popQueue.shift(); if (!r.pop && r.mesh.parent) populateChunk(r); }   // arrival ground must be fully furnished
  placePlayer(x, z); rebuildNear(); refreshNpcs();
  mapOX = 1e9; mapRow = MW; mapImg = null;
}

/* ---- 18. PATHFINDING: A* over tiles, octile heuristic, capped; diagonals need both orthogonals open ---- */
const DX = [1, -1, 0, 0, 1, 1, -1, -1], DZ = [0, 0, 1, -1, 1, -1, 1, -1], MAX_NODES = 6000;
/* which two orthogonals each diagonal's corner rule needs: d4 (+1,+1) wants E(0) and S(2), d5 (+1,-1) E(0) and N(3),
   d6 (-1,+1) W(1) and S(2), d7 (-1,-1) W(1) and N(3) — the same probes the loop has already made this expansion */
const CX4 = [0, 0, 1, 1], CZ4 = [2, 3, 2, 3], _ok4 = [0, 0, 0, 0];
const _hf = [], _hi = [];
function heapPush(f, id) {
  let i = _hf.length; _hf.push(f); _hi.push(id);
  while (i > 0) { const p = (i - 1) >> 1; if (_hf[p] <= _hf[i]) break; let t = _hf[p]; _hf[p] = _hf[i]; _hf[i] = t; t = _hi[p]; _hi[p] = _hi[i]; _hi[i] = t; i = p; }
}
function heapPop() {
  const top = _hi[0], n = _hf.length - 1;
  _hf[0] = _hf[n]; _hi[0] = _hi[n]; _hf.pop(); _hi.pop();
  let i = 0;
  for (;;) {
    const l = i * 2 + 1, r = l + 1; let m = i;
    if (l < n && _hf[l] < _hf[m]) m = l;
    if (r < n && _hf[r] < _hf[m]) m = r;
    if (m === i) break;
    let t = _hf[m]; _hf[m] = _hf[i]; _hf[i] = t; t = _hi[m]; _hi[m] = _hi[i]; _hi[i] = t; i = m;
  }
  return top;
}
/* tiles to walk, nearest first; [] if already there, null if nothing was reachable; otherwise the closest partial leg */
function findPath(sx, sz, gx, gz, reach) {
  reach = reach || 0;
  const hit = (x, z) => Math.max(Math.abs(x - gx), Math.abs(z - gz)) <= reach;
  if (hit(sx, sz)) return [];
  _hf.length = 0; _hi.length = 0;
  const came = new Map(), gs = new Map(), px = new Map(), pz = new Map(), sKey = tk(sx, sz);
  gs.set(sKey, 0); px.set(sKey, sx); pz.set(sKey, sz);
  heapPush(0, sKey);
  let expanded = 0, best = sKey, bestH = Math.hypot(sx - gx, sz - gz), found = null;
  /* Give up early on a goal that is walled off. A reachable target is found in a
     few hundred expansions; the full MAX_NODES budget is only ever spent proving
     a negative, and each expansion issues up to twelve canStep probes, so that
     proof is a visible hitch inside the click that asked for it. Once a long run
     of expansions has failed to get any closer, it is not going to. */
  let stale = 0;
  while (_hi.length && expanded < MAX_NODES && stale < 800) {
    const cur = heapPop(), cx = px.get(cur), cz = pz.get(cur);
    if (hit(cx, cz)) { found = cur; break; }
    expanded++; stale++;
    const g0 = gs.get(cur);
   /* The four orthogonals are probed first and remembered, because each diagonal's corner rule asks for exactly two of
       them again — twelve canStep probes an expansion where eight will do, over thousands of expansions. */
    _ok4[0] = _ok4[1] = _ok4[2] = _ok4[3] = 0;
    for (let d = 0; d < 8; d++) {
      const nx = cx + DX[d], nz = cz + DZ[d];
      if (Math.abs(nx - sx) > 190 || Math.abs(nz - sz) > 190) continue;
      if (d < 4) { if (!(_ok4[d] = canStep(cx, cz, nx, nz) ? 1 : 0)) continue; }
      else if (!_ok4[CX4[d - 4]] || !_ok4[CZ4[d - 4]] || !canStep(cx, cz, nx, nz)) continue;
      const nk = tk(nx, nz), ng = g0 + (d > 3 ? 1.41 : 1), old = gs.get(nk);
      if (old !== undefined && old <= ng) continue;
      gs.set(nk, ng); came.set(nk, cur); px.set(nk, nx); pz.set(nk, nz);
      const hh = Math.hypot(nx - gx, nz - gz);
      if (hh < bestH) { bestH = hh; best = nk; stale = 0; }   // progress towards the goal resets the patience counter
      heapPush(ng + hh * 1.05, nk);
    }
  }
  let node = found !== null ? found : best;
  if (node === sKey) return null;
  const outp = [];
  while (node !== sKey && node !== undefined) { outp.push(node); node = came.get(node); }
  return outp.reverse().map(k => ({ x: px.get(k), z: pz.get(k) }));
}
/* ray-vs-heightfield march with bisection: works over chunks that have not landed yet */
function rayGround(ray) {
  const o = ray.origin, dir = ray.direction;
  if (o.y - groundY(o.x, o.z) < 0) return null;
  const below = t => o.y + dir.y * t - Math.max(groundY(o.x + dir.x * t, o.z + dir.z * t), SEA) <= 0;
  for (let t = 0; t < 460;) {
    const step = t < 60 ? 0.7 : t < 180 ? 1.8 : 4;
    t += step;
    if (below(t)) {
      let lo = t - step, hi = t;
      for (let i = 0; i < 8; i++) { const m = (lo + hi) * 0.5; if (below(m)) hi = m; else lo = m; }
      return { x: o.x + dir.x * hi, y: o.y + dir.y * hi, z: o.z + dir.z * hi, t: hi };
    }
  }
  return null;
}
const pickLists = [];   // fires, traps, campsite furniture: anything a player leaves on the ground besides drops
function pickObject(ray) {
  const o = ray.origin, d = ray.direction;
  let bestT = 1e9, best = null;
  const test = (x, y, z, r, obj) => {
    const ox = x - o.x, oy = y - o.y, oz = z - o.z, proj = ox * d.x + oy * d.y + oz * d.z;
    if (proj < 0 || proj > bestT) return;
    const dx = ox - d.x * proj, dy = oy - d.y * proj, dz = oz - d.z * proj;
    if (dx * dx + dy * dy + dz * dz < r * r) { bestT = proj; best = obj; }
  };
  for (const ob of nearObjs) if (!depleted.has(ob.key)) test(ob.x, ob.y + PICK_Y[ob.t], ob.z, PICK_R[ob.t], ob);
  for (const n of npcs) if (!n.dead) test(n.rx, n.ry + (n.t.sz || 1) * 0.8, n.rz, (n.t.sz || 1) * 1.15, n);
  for (const R of remotes.values()) test(R.rx, R.ry + 0.9, R.rz, 1.1, R);
  for (const dr of drops) test(dr.x, dr.y + 0.35, dr.z, 0.75, dr);
  for (const L of pickLists) for (const f of L) test(f.x, f.y + 0.6, f.z, 1.1, f);
  return best;
}

/* ---- 19. INVENTORY + EQUIPMENT: 28 slots; raw materials stack ---- */
const INV_N = 28, inv = new Array(INV_N).fill(null);
let gpMade = 0, gpSunk = 0;   // the session's faucets and sinks, for the world-state ledger
const eq = {}; for (const s of EQ_SLOTS) eq[s] = null;
const dirty = { inv: 1, eq: 1, sk: 1, orb: 1 };
const FULL = 'Your inventory is too full.';
let useSel = null;   // { i, id, name } while an item is armed
function clearUse() { if (useSel) { useSel = null; dirty.inv = 1; hoverObj = undefined; } P.teleG = 0; }
const BANK_N = 300;
let bank = [];   // [{ id, n }], everything stacks
/* A new bank slot is the only routine action that can grow the blob without
   bound, so it is the one place worth measuring. Topping up a stack is always
   free — the row already exists — and only a brand-new row is checked. The
   ceiling that matters is not BANK_N but what the save can carry: the bank used
   to offer three hundred slots against a blob the server would refuse well
   before that, and the player learned about it by silently losing a session. */
function bankAdd(id, n) {
  const s = bank.find(b => b.id === id);
  if (s) { s.n += n; return n; }
  if (bank.length >= BANK_N) return 0;
  bank.push({ id, n }); saveStale();   // the cached size must not answer for the blob without this row
  if (!OFFLINE && saveBytes() > SAVE_CAP - 64) { bank.pop(); saveStale(); return 0; }   // put it back: this row would make the character unsaveable
  return n;
}
function invFree() { let n = 0; for (let i = 0; i < INV_N; i++) if (!inv[i]) n++; return n; }
function invCount(id) { let n = 0; for (let i = 0; i < INV_N; i++) if (inv[i] && inv[i].id === id) n += inv[i].n; return n; }
function invAdd(id, n) {
  n = n || 1;
  const it = ITEMS[id]; if (!it) return 0;
  let added = 0;
  if (it.stack) for (let i = 0; i < INV_N; i++) if (inv[i] && inv[i].id === id) { inv[i].n += n; dirty.inv = 1; markDirty(); return n; }
  while (added < n) {
    const i = inv.indexOf(null);
    if (i < 0) break;
    inv[i] = { id, n: it.stack ? n - added : 1 };
    added += it.stack ? n - added : 1;
  }
  dirty.inv = 1;
  if (added) markDirty();
  return added;
}
function invRemove(id, n) {
  n = n || 1;
  let left = n;
  for (let i = 0; i < INV_N && left > 0; i++) {
    if (!inv[i] || inv[i].id !== id) continue;
    const take = Math.min(left, inv[i].n);
    inv[i].n -= take; left -= take;
    if (inv[i].n <= 0) inv[i] = null;
  }
  dirty.inv = 1; markDirty();
  return n - left;
}
/* a consumption that must not half-happen. Capacity cannot be judged before the fact — spending the last coins frees
   the slot the goods land in — so take the input, try the output, and put the input back if it has nowhere to go. */
const invSwap = (outId, outN, inId, inN) => {
  invRemove(inId, inN);
  const got = invAdd(outId, outN);
  if (got === outN) return 1;
  if (got) invRemove(outId, got);   // a partial landing is not a swap: unwind it before the input goes back
  invAdd(inId, inN);
  return 0;
};
const hasAll = need => { for (const [id, n] of need) if (invCount(id) < n) return false; return true; };
const coins = () => invCount('coins');
function bestTool(kind) {   // best usable tool carried or wielded
  let best = null;
  const consider = id => { const it = ITEMS[id]; if (it && it.tool === kind && lvl[SK[kind]] >= it.req[kind] && (!best || it.tier > best.tier)) best = it; };
  if (eq.weapon) consider(eq.weapon);
  for (let i = 0; i < INV_N; i++) if (inv[i]) consider(inv[i].id);
  return best;
}
/* the hand shows the tool doing the work while a gathering task runs; purely visual */
let shownTool = '';
function heldToolFor(t) {
  if (!t) return '';
  if (t.k === 'chop' || t.k === 'mine') { const a = bestTool(GATHER[t.k].sk); return a ? a.id : ''; }
  if (t.k === 'fish') { const id = t.o && t.o.k ? 'harpoon' : 'fishing_rod'; return invCount(id) ? id : ''; }
  return '';
}
function updateHeldTool() {
  const want = heldToolFor(P.task);
  if (want === shownTool) return;
  shownTool = want;
  selfStale[osrsSelf ? 0 : 1] = 1;   // the rig that is not on show now holds the wrong thing
  if (osrsSelf) return OSRSK.dress(osrsAvatar.parts, wornIt);   // the tool is part of the mesh there, so the mesh is rebuilt
  holdWeapon(avatar.parts.wep, want ? ITEMS[want] : (eq.weapon ? ITEMS[eq.weapon] : null));
}
const capeOn = k => eq.cape === 'skillcape_' + k;   // the worn master's cape; each perk speaks at its own site
function bonus(f) {
  let t = 0;
  for (const s of EQ_SLOTS) if (eq[s]) t += ITEMS[eq[s]][f] || 0;
  // a skillcape trims itself against a second 99 and grants the wiki's +4 prayer
  if (f === 'pb' && eq.cape && ITEMS[eq.cape].req99 && SKILLS.reduce((n, s, i) => n + (!s.locked && lvl[i] >= 99 ? 1 : 0), 0) >= 2) t += 4;
  return t;
}
function canEquip(it) {
  for (const k in it.req) if (it.req[k] && lvl[SK[k]] < it.req[k]) { say('You need ' + skName(SK[k]) + ' level ' + it.req[k] + ' to wear that.', 'bad'); return false; }
  if (it.req99 && lvl[SK[it.req99]] < 99) { say('Only a master of ' + skName(SK[it.req99]) + ' may wear that cape.', 'bad'); return false; }
  if (it.reqMax && SKILLS.some((k, i) => !k.locked && lvl[i] < 99)) { say('Only a master of every skill may wear that cape.', 'bad'); return false; }
  return true;
}
const gearChanged = () => { P.specArm = 0; P.souls = 0; dirty.inv = dirty.eq = 1; dressAvatar(); drawStyles(); markDirty(1); };   // an arm belongs to the weapon it was made on
function equip(slotIdx) {
  const s = inv[slotIdx]; if (!s) return;
  const it = ITEMS[s.id];
  if (!it.equip) { say("You can't wear that.", 'bad'); return; }
  if (!canEquip(it)) return;
  // two hands are two hands: the displaced piece needs a pack slot beyond the one being vacated
  if (it.slot === 'weapon' && it.two && eq.shield) {
    if (!invFree()) { say('You need a free pack slot to unsling your shield.', 'bad'); return; }
    invAdd(eq.shield, 1); eq.shield = null;
  }
  if (it.slot === 'shield' && eq.weapon && ITEMS[eq.weapon].two) {
    if (!invFree()) { say('You need a free pack slot to put away your two-handed weapon.', 'bad'); return; }
    invAdd(eq.weapon, 1); eq.weapon = null;
  }
  if (it.slot === 'ammo') {   // the quiver carries a count
    const oldId = eq.ammo, oldN = P.ammoN;
    eq.ammo = it.id; P.ammoN = s.n;
    inv[slotIdx] = oldId ? { id: oldId, n: oldN } : null;
  } else {
    const old = eq[it.slot];
    inv[slotIdx] = old ? { id: old, n: 1 } : null;
    eq[it.slot] = it.id;
  }
  gearChanged();
}
function unequip(slot) {
  const id = eq[slot]; if (!id) return;
  if (!invFree()) { say(FULL, 'bad'); return; }
  eq[slot] = null;
  if (slot === 'ammo') { invAdd(id, P.ammoN); P.ammoN = 0; } else invAdd(id, 1);
  gearChanged();
}

/* ---- 20. PLAYER ---- */
const TICK = 600;
const player = new THREE.Group(), boat = new THREE.Group(), hull = new THREE.Mesh(HULL, mat);
const oarL = new THREE.Mesh(OAR_GEO, mat), oarR = new THREE.Mesh(OAR_GEO, mat);
oarL.position.set(0.85, 0.55, -0.2); oarL.rotation.z = -0.9; oarR.position.set(-0.85, 0.55, -0.2); oarR.rotation.z = 0.9;
boat.add(hull, oarL, oarR); boat.visible = false;
const avatar = buildAvatar();
player.add(avatar, boat);
scene.add(player);
/* ---- 20b. 2007 MODELS: the cache's own kit in place of the box rig — for you, for every other real player,
   and for every monster whose name the pack resolves (npcLod below); nothing else in the world changes. Both
   rigs exist at once and the camera picks which one is visible, so switching costs a dress, not a rebuild.
   osrs.js holds the whole of it; the monster hooks live in the frame loop, removeNpc and petFrame.

   The setting only ARMS the kit; distance decides, figure by figure, which rig is actually drawn. A player the
   camera is far from reads as a silhouette either way, and the 07 kit is a merged mesh per loadout where the box
   rig is a handful of shared boxes — so past a certain distance the detail is only cost. Your own rig therefore
   drops to boxes once the boom is more than half way out, and a stranger keeps the kit only while the camera is
   near them or they are near you. Both tests are sticky (OSRS_HYST), because a figure sitting on the line must
   not flicker between rigs frame by frame. ---- */
/* OSRS_CAM is where the kit goes OFF; it comes back on at OSRS_CAM / OSRS_HYST, and the gap between the two is
   the whole of the anti-flicker. Stated that way round because the outer edge is the number with a meaning.
   One number scales the whole overlay. The dev console's "2007 model distance" sets it, and the near-to-you ring
   and the world-object ring (LOC7, below) keep the share of it they hold at the default, so figures and the scenery
   around them never switch rigs at odds with each other. It rides in OPT, so it persists like any other setting. */
const OSRS_DIST0 = 99, OSRS_NEAR0 = 14, LOC7_0 = 30, LOC7_HYST = 34 / 30;
let OSRS_CAM = OSRS_DIST0;              // camera-to-figure distance in tiles: the middle of the 8..190 zoom range
let OSRS_CAM2 = OSRS_CAM * OSRS_CAM;
const OSRS_HYST = 1.15, OSRS_IN = 1 / OSRS_HYST;
let OSRS_NEAR = OSRS_NEAR0;             // ...or this close to you, however far the boom has pulled back
/* every LOD test runs per frame, so nothing is torn down here: the next frame re-tests each figure against the new ring */
function setOsrsDist(v) {
  OSRS_CAM = clamp(Math.round(v) || OSRS_DIST0, 4, 600);
  OSRS_CAM2 = OSRS_CAM * OSRS_CAM;
  const f = OSRS_CAM / OSRS_DIST0;
  OSRS_NEAR = OSRS_NEAR0 * f;
  LOC7 = Math.min(64, LOC7_0 * f);      // 64 is closeList's own reach: a wider ring would only ever be half filled
  LOC7_OUT = LOC7 * LOC7_HYST;
  return OSRS_CAM;
}
let osrsOn = 0, osrsAvatar = null, osrsSelf = 0;
const selfStale = [1, 1];               // [box, 07]: only the rig on show is dressed; the other is dressed when it comes up
const myParts = () => (osrsSelf ? osrsAvatar : avatar).parts;
function osrsApply() {
  if (OPT.osrs && !OSRSK.ready()) {   // the assets arrive once a session; the setting reasserts itself when they land
    OSRSK.load().then(osrsApply, e => { OPT.osrs = 0; icons07Apply(1); drawOpts(); say('The 2007 models could not load: ' + e.message, 'bad'); });   // the sprites answer to the same setting: they must not stay dressed under an OFF switch
    return;
  }
  const want = OPT.osrs ? 1 : 0;
  if (want === osrsOn) return;
  osrsOn = want;
  osrsLod();   // strangers re-test themselves next frame; osrsKind reads osrsOn and the rigs already out come back
  if (chunks.size) {   // fixtures are baked into the chunk batches at populate: re-lay the near ground under the new setting
    for (const [k, rec] of chunks) if (rec.near) { disposeChunk(rec); chunks.delete(k); }
    refresh();
  }
}
/* the boom's own length, not the wheel's: a camera the walls have collapsed onto your shoulder is near, whatever the zoom says */
function osrsLod() {
  const want = osrsOn && Math.min(camDist, dist) <= OSRS_CAM * (osrsSelf ? 1 : OSRS_IN) ? 1 : 0;
  if (want === osrsSelf) return;
  osrsSelf = want;
  if (want && !osrsAvatar) player.add(osrsAvatar = OSRSK.rig());
  if (osrsAvatar) osrsAvatar.visible = !!want;
  avatar.visible = !want;
  P.rig = want ? osrsAvatar : avatar;   // 34. ANIMATION bobs and scales whichever rig is on
  dressSelf();
}
/* Monsters wear the same setting. A matched name gets the cache's own model, fitted to the box rig's height;
   the variant is n.kh % count, so every client dresses the same goblin the same way and a name with many looks
   (guards, goblins) varies across the room. An unmatched name keeps its box rig at any distance. The camera
   rule is the strangers' own, hysteresis included; the box rig keeps walking the ticks underneath either way,
   and the 07 mesh rides its transform, so the lunge, the rear and the bob all carry over. */
function npcH(t) {   // the box rig's height above ground, boss scale folded in: the 07 model is fitted to this
  const b = t.base || t;
  if (b.h07 === undefined) {
    if (!b.rig) b.rig = b.build(b.body);
    const g = flatGeo(b.rig);
    g.computeBoundingBox();
    b.h07 = g.boundingBox.max.y;
  }
  return b.h07 * (t.scale || 1);
}
/* the limb plan, read off the box rig: kinds, phases and joints as fractions of its height, so osrs.js can lay
   the same skeleton over the 07 model at any fitted size (a boss, a pet) and animateNpc drives both rigs */
function npcPlan(t) {
  const b = t.base || t;
  if (b.p07 === undefined) {
    npcH(t);   // settles b.rig and b.h07
    b.p07 = (b.rig.limbs || []).map(L => ({ kind: L.kind, s: L.s, ph: L.ph || 0, base: L.base || 0, a: L.a, x: L.x / b.h07, y: L.y / b.h07, z: L.z / b.h07 }));
  }
  return b.p07;
}
function npcLod(n) {
  if (!osrsOn) return n.k07 = 0;
  if (n.o7v === undefined) n.o7v = OSRSK.npcVariants(n.t.n);
  if (!n.o7v) return 0;
  const s = n.k07 ? 1 : OSRS_IN;
  const dx = n.rx - camera.position.x, dy = n.ry - camera.position.y, dz = n.rz - camera.position.z;
  n.k07 = (dx * dx + dy * dy + dz * dz <= OSRS_CAM2 * s * s
    || Math.abs(n.tx - P.tx) + Math.abs(n.tz - P.tz) <= OSRS_NEAR * s) ? 1 : 0;
  if (n.k07 && !n.o7) { n.o7 = OSRSK.npcMesh(n.t.n, (n.kh >>> 0) % n.o7v, npcH(n.t), npcPlan(n.t)); scene.add(n.o7); }   // >>>: a dev spawn's private seed can be negative
  return n.k07;
}
const npcFree7 = n => { if (n.o7) { scene.remove(n.o7); OSRSK.npcFree(n.o7); n.o7 = null; } };
/* World objects wear the setting too. A tree or a vein close to you drops its instanced proc look for the
   cache's own loc model — variant by the tile's coin so every client grows the same oak — and picks it back up
   when you walk away; the depleted state swaps to the pack's own stump or cleared vein where it carries one.
   Distance is to the player, not the camera: there are hundreds of trees where there is one monster, so the
   ring is tighter, and sticky for the same no-flicker reason. Wilderness trees stay proc — the ashen half-dead
   tint is this world's own and the cache's greens would contradict it. Fixtures inside merged chunk batches
   (stalls, wells, furnaces) swap at populate instead: see b07 and osrsApply's re-lay. */
let LOC7 = LOC7_0, LOC7_OUT = LOC7_0 * LOC7_HYST;   // Manhattan tiles to the player; the gap is the anti-flicker (setOsrsDist scales both)
const l7Set = new Set();   // every object the overlay currently owns, mesh or not — the off-list sweep reads it
function drop7(o) {
  if (o.l7) { scene.remove(o.l7); OSRSK.locFree(o.l7); o.l7 = null; }
  o.l7s = 0; o.s7 = 0; l7Set.delete(o);
}
function loc7Frame(o) {
  if (o.no7) return;
  const dep = depleted.has(o.key) ? 1 : 0;
  const near = osrsOn && !o.ash && o.inst
    && Math.abs(o.x - P.tx) + Math.abs(o.z - P.tz) <= (o.s7 ? LOC7_OUT : LOC7) ? 1 : 0;
  if (near === (o.s7 || 0) && (!near || dep === o.d7)) return;   // settled
  drop7(o);
  if (!near) { if (!dep) showInst(o); return; }
  const name = o.t === 0 ? TREES[o.k].n7 : ORES[o.k].n7, n = OSRSK.locVariants(name);
  if (!n) { o.no7 = 1; return; }   // a name the pack lacks keeps the proc look at any distance
  o.s7 = 1; o.d7 = dep; l7Set.add(o);
  hideInst(o);   // even with no spent model: depleted proc is hidden too, and leaving range restores it
  const mesh = OSRSK.locMesh(name, (o.h7 >>> 8) % n, dep);
  if (!mesh) return;   // depleted with no spent look: the stump pool (a tree) or bare ground (a vein)
  mesh.position.set(o.x, o.y - 0.06, o.z);
  mesh.rotation.y = ((o.h7 >>> 26) & 3) * (PI / 2);   // quarter turns, the client's own four facings
  mesh.scale.setScalar((o.t === 0 ? 1.24 : 1.15) * (0.85 + ((o.h7 >>> 10) & 255) / 255 * 0.3));
  scene.add(mesh);
  o.l7 = mesh; o.l7s = dep;   // l7s: the overlay already shows the spent state, so the stump pool stands down
}
const P = {
  tx: 0, tz: 0, px: 0, pz: 0, rx: 0, ry: 0, rz: 0, face: 0, faceT: 0, span: 1,
  path: [], goal: null, task: null, actT: 0, atkT: 0, acting: 0, actSpan: 2, walkPhase: 0, bobPhase: 0, swingPhase: 0,
  run: 1, energy: 100, hp: 10, maxhp: 10, style: 0, rstyle: 1, cstyle: 0, ammoN: 0, pose: 0, spell: null, prayers: 0, pray: 10, maxpray: 10, foodT: 0, potT: 0, spec: 100, specArm: 0, psn: 0, psnN: 0, psnT: 0, psnImm: 0,
  afloat: 0, moved: 0, dead: 0, stuckT: 0, stun: 0, afire: 0, clue: null, slay: null, farm: Object.create(null), look: { skin: 0, shirt: 0, legs: 0, face: 0 }, home: { x: 0, z: 0 }, regionK: '', regionT: 0,
  turn: player, rig: avatar, boat, oarL, oarR
};
let tickN = 0;
/* the tick comes off the wall clock so every client agrees on the tick number without a server loop */
const EPOCH = 1735689600000;
let clockOffset = 0;
const netNow = () => Date.now() + clockOffset;
const globalTick = () => Math.floor((netNow() - EPOCH) / TICK);
function placePlayer(x, z) {
  P.tx = P.px = x; P.tz = P.pz = z; P.rx = x; P.rz = z;
  P.span = 1; P.stuckT = 0;
  P.afloat = isWater(walkY(x, z)) ? 1 : 0;
  P.ry = P.afloat ? 0 : walkY(x, z);
  P.path.length = 0; P.goal = null; P.task = null;
  focus.set(x, P.ry, z);
}
const gearClass = it => !it ? '' : it.mag > 0 ? 'mage' : it.rat > 0 ? 'range' : 'melee';   // torva reads -18 magic: a penalty dresses nobody
const setCol = (hex, ...ms) => { for (const m of ms) m.material.color.set(hex); };
/* one dresser for every articulated human: armour paints over the barber's work; each discipline wears its own silhouette */
function dressRig(p, look, it) {
  const headIt = it('head'), bodyIt = it('body'), legsIt = it('legs'), wepIt = it('weapon'), shlIt = it('shield');
  const handsIt = it('hands'), feetIt = it('feet'), capeIt = it('cape'), neckIt = it('neck');
  const skin = SKINS[look.skin], shirt = SHIRTS[look.shirt], pants = LEGSC[look.legs], hc = gearClass(headIt), lc = gearClass(legsIt);
  setCol(bodyIt ? bodyIt.c : shirt, p.torso);
  const sleeves = bodyIt && bodyIt.g !== 'chain';   // a chainbody stops at the shoulder
  setCol(sleeves ? bodyIt.c : skin, p.armL, p.armR);
  setCol(skin, p.head);
  // only the legs slot can robe: a mage robe bottom or any skirt hides the legs; a robe top never does
  const robed = lc === 'mage' || !!(legsIt && legsIt.g === 'skirt');
  p.legHid = robed ? 1 : 0;
  p.skirt.visible = robed;
  if (robed) setCol(legsIt.c, p.skirt);
  p.legL.visible = p.legR.visible = !robed;
  setCol(legsIt ? legsIt.c : pants, p.legL, p.legR);
  setCol(legsIt ? (lc === 'range' ? skin : legsIt.c) : pants, p.calfL, p.calfR);
  p.helm.visible = hc === 'melee'; p.wizHat.visible = hc === 'mage'; p.rhHat.visible = hc === 'range'; p.hair.visible = !headIt;
  if (headIt) setCol(headIt.c, hc === 'mage' ? p.wizHat : hc === 'range' ? p.rhHat : p.helm);
  for (const [item, ...ms] of [[feetIt, p.bootL, p.bootR], [handsIt, p.glovL, p.glovR], [capeIt, p.capeM], [neckIt, p.amul], [shlIt, p.shl]]) {
    for (const m of ms) m.visible = !!item;
    if (item) setCol(item.c, ...ms);
  }
  holdWeapon(p.wep, wepIt);
}
/* the worn list, with whatever the current task has put in your hand standing in for the weapon */
const wornIt = s => (s === 'weapon' && shownTool) ? ITEMS[shownTool] : (eq[s] && ITEMS[eq[s]]) || null;
/* Dress the rig that is actually on show and remember the other one is behind. A zoom is not a wardrobe change, so
   the switch itself must not cost a merge — and re-dressing a rig nobody can see costs one for nothing. */
function dressSelf() {
  const k = osrsSelf ? 1 : 0;
  if (!selfStale[k]) return;
  selfStale[k] = 0;
  if (osrsSelf) OSRSK.dress(osrsAvatar.parts, wornIt);
  else { dressRig(avatar.parts, P.look, wornIt); applyFace(avatar.parts, P.look.face); }
}
function dressAvatar() {
  shownTool = '';   // cleared first, so this always shows the weapon and updateHeldTool puts the tool back
  selfStale[0] = selfStale[1] = 1;
  dressSelf();
  sendEquip();
}
const weaponIt = () => eq.weapon ? ITEMS[eq.weapon] : null;
/* the launcher: a wielded bow, or a thrown weapon in the quiver when the hand holds no bow; it sets the speed and the range */
const bowItem = () => { const w = weaponIt(), a = eq.ammo && ITEMS[eq.ammo]; return w && w.bow ? w : a && a.thrown ? a : null; };
const atkSpeed = () => { const w = bowItem() || weaponIt(); return w && w.bow ? Math.max(2, w.spd + (RSTYLES[P.rstyle].spd || 0)) : w ? w.spd : 4; };
const ammoTint = () => { const w = bowItem(); if (w && w.selfAmmo) return hexInt(w.c2); const a = eq.ammo && ITEMS[eq.ammo]; return a ? hexInt(a.c) : 0xc3c8d0; };
function bowRange() {   // a bow draws arrows and a crossbow bolts; a readied spell beats both
  const w = bowItem();
  if (!w || P.spell !== null) return 0;
  if (w.selfAmmo) return w.rng + (RSTYLES[P.rstyle].rng || 0);   // a blowpipe or crystal bow carries its own charge
  if (!eq.ammo || P.ammoN <= 0) return 0;
  const a = ITEMS[eq.ammo];
  if (!a || (!w.thrown && (a.thrown || (w.ammoT || 'arrow') !== (a.aT || 'arrow')))) return 0;   // a bow will not fire knives
  return w.rng + (RSTYLES[P.rstyle].rng || 0);
}
/* the 2007 max-hit shape: floor(0.5 + (effective + 8) * (bonus + 64) / 640); effective = floor(level x prayer) + style */
const maxFrom = (eff, b) => Math.max(1, Math.floor(0.5 + (eff + 8) * (b + 64) / 640));
const rangedMax = () => maxFrom(Math.floor(eff('ranged') * prayerMul('rngs')) + RSTYLES[P.rstyle].str, bonus('rst'));   // rngs is the damage side: Rigour alone splits 20% accuracy / 23% strength
function spendArrow(o) {
  const w = bowItem(); if (w && w.selfAmmo) return;   // nothing leaves the quiver
  const id = eq.ammo;
  const cp = eq.cape && ITEMS[eq.cape];
  if (cp && cp.save && Math.random() < cp.save) return;  // Ava's devices snatch it back
  if (o && id) dropStack(id, 1, Math.round(o.tx !== undefined ? o.tx : o.x), Math.round(o.tz !== undefined ? o.tz : o.z));   // the rest lie where they fell
  if (--P.ammoN > 0) return;
  P.ammoN = 0; eq.ammo = null;
  say('You have run out of ammunition!', 'bad');
  dirty.eq = 1; dressAvatar(); markDirty(1);
}
/* magic damage bonus (occult, kodai, ancestral): a percentage over the spell's flat max, as the wiki prices it.
   Tumeken's shadow trebles both the worn magic attack and the worn magic damage — its own bolt only, damage capped at 100%. */
const m3On = () => { const w = weaponIt(); return !!(w && w.m3 && P.spell === null); };
const magAtk = () => m3On() ? bonus('mag') * 3 : bonus('mag');
const mdmgMax = m => Math.floor(m * (1 + (m3On() ? Math.min(100, (bonus('mdmg') + prayAdd('mdmg')) * 3) : bonus('mdmg') + prayAdd('mdmg')) / 100));
const castTicks = sp => { const w = weaponIt(); return w && w.fastcast && !sp.bk ? 4 : 5; };   // the harmonised orb quickens a standard cast to four ticks; ancients and lunars keep five
/* a powered staff casts its own spell: no runes, max = magic/3 + the staff's own offset (-5 seas, -2 swamp,
   -1 sanguinesti, +1 shadow, the wiki's own ladder), at the weapon's own pace */
const pstaffOn = () => { const w = weaponIt(); return !!(w && w.pstaff && P.spell === null && !bowRange()); };
const pstaffMax = () => { const w = weaponIt(); return Math.max(1, Math.floor(eff('magic') / 3) + ((w && w.pmax) !== undefined ? w.pmax : -5)); };
const barrowsSet = b => [eq.head, eq.body, eq.legs, eq.weapon].every(id => id && id.startsWith(b + 's_'));   // helm to weapon, one brother entire
const setOn = p => [eq.head, eq.body, eq.legs].every(id => id && id.startsWith(p));   // helm, body and legs: the three-piece sets
const barkN = p => [eq.head, eq.body, eq.legs, eq.hands, eq.feet].reduce((n, id) => n + (id && id.startsWith(p) ? 1 : 0), 0);   // the barks pay by the piece
const psnImmune = () => { const h = eq.head && ITEMS[eq.head]; return !!(h && h.psnImm); };   // the serpentine helm, while it is charged (and here it always is)
const onTask = o => !!(P.slay && o && o.npc && (o.t.base || o.t).k === P.slay.k);
const maxHit = () => bowRange() ? rangedMax()
  : Math.floor(maxFrom(Math.floor(eff('strength') * prayerMul('str')) + STYLES[P.style].str, bonus('str'))
    * (barrowsSet('dharok') ? 1 + (P.maxhp - P.hp) * P.maxhp / 10000 : 1)   // Dharok strikes harder for every drop of blood lost
    * (eq.neck === 'berserker_necklace' && (eq.weapon === 'toktz_xil_ak' || eq.weapon === 'tzhaar_ket_om') ? 1.2 : 1));   // the wiki's obsidian charm: a fifth again behind an obsidian blade
const defLevel = () => Math.floor(eff('defence') * prayerMul('def')) + (P.spell !== null || pstaffOn() ? (P.cstyle ? 3 : 0) : bowRange() ? RSTYLES[P.rstyle].def || 0 : STYLES[P.style].def || 0);   // each discipline's own stance pays its defence
/* both sides pass their full effective level: players floor(level x prayer) + style + 8, monsters level + 9 */
function hitChance(atk, atkB, def, defB) {
  const a = atk * (atkB + 64), d = def * (defB + 64);
  return a > d ? 1 - (d + 2) / (2 * (a + 1)) : a / (2 * (d + 1));
}
const roll = (chance, max) => Math.random() < chance ? Math.floor(Math.random() * (max + 1)) : 0;

/* ---- 21. WALKING THE TICK ---- */
function stepsThisTick(E) {
  E = E || P;
  const boat = 2 + (E === P && lvl[SK.sailing] >= 50 ? 1 : 0);   // a practised sailor rows a third again as fast
  return Math.max(1, Math.round((E.afloat ? boat : (!E.run || E.energy <= 0) ? 1 : 2) * OPT.runMul));
}
/* the town's peace caps the beasts on its commons; PvP itself answers only to the wilderness rings now */
const SAFE_RM = 1.75, TOWN_CAP = [20, 26, 32, 40, 48];   // spawn-level ceiling inside the belt, by rank (wire format)
function townCore(x, z) { const n = nearVillage(x, z); return !!(n && n.d < n.v.r * 1.05); }
let pvpAck = 0, pvpHold = 0;
function askPvp(onGo) {
  pvpHold = 1;
  showModal('Entering the Wilderness',
    '<p class="smsg">The scorched ground ahead is the <b>Wilderness</b>: other players can attack you, its level climbs the deeper you go, and dying to one while skulled costs everything you carry.</p>' +
    '<label class="chk"><input type="checkbox" id="pvpNo"> Don\'t show this again</label>' +
    '<div class="wrow2"><button id="pvpGo">Continue</button><button id="pvpStay">Cancel</button></div>',
    'It can be turned back on in Setup under "PvP border warning".');
  const remember = () => { if (el('pvpNo').checked) { OPT.pvpWarn = 0; applyOpts(); drawOpts(); } };
  el('pvpGo').onclick = () => { remember(); pvpAck = 1; pvpHold = 0; closeOverlays(); if (onGo) onGo(); };
  el('pvpStay').onclick = () => { remember(); closeOverlays(); };
}
/* ---- the wilderness ditch: click the trench anywhere and the character runs up and leaps it. Going in asks (once,
   unless silenced); coming out never does. The trench itself is never walkable, so the leap is the only dry crossing. ---- */
let petHop = null;
const nearDitch = (x, z) => ditchT(x, z) < 5 && !isWater(tileH(x, z)) && !inDunPlane(z);   // the trench, its berms and a stride either side: a generous target
function ditchClick(cx, cz) {
  const gdx = wildD(cx + 1, cz) - wildD(cx - 1, cz), gdz = wildD(cx, cz + 1) - wildD(cx, cz - 1);
  const L = Math.hypot(gdx, gdz) || 1, nx2 = gdx / L, nz2 = gdz / L;   // uphill in the field: toward the deep wilds
  const dir = wildD(P.tx, P.tz) > 0 ? -1 : 1;   // leap to whichever side you are not on
  const lip = s => {
    for (let k = 1; k <= 13; k++) {   // a bank click starts nearer one lip and farther from the other
      const x = Math.round(cx + nx2 * s * k), z = Math.round(cz + nz2 * s * k), wd = wildD(x, z);
      if (wd * s > 0 && ditchT(x, z) > 3.3 && !isWater(tileH(x, z)) && !blocked.has(tk(x, z)) && !floorMap.has(tk(x, z))) return { x, z };
    }
    return null;
  };
  const a = lip(-dir), b = lip(dir);
  if (!a || !b) return walkTo(cx, cz);   // a crumbled bank: nothing to vault from
  startTask({ x: a.x, z: a.z, fx: b.x, fz: b.z, ent: dir > 0 ? 1 : 0, key: tk(cx, cz) }, 'ditch');
}
TASKS.ditch = (t, o) => {
  if (P.afloat) return fail("You can't do that from a boat.");
  if (!t.on) { t.on = 1; return; }   // one beat to gather yourself, like the agility vault
  P.task = null;
  const go = () => {
    P.faceT = Math.atan2(o.fx - P.tx, o.fz - P.tz);
    teleport(o.fx, o.fz, 60);
    P.pose = 4; P.acting = 1; P.actSpan = 2;
    say(o.ent ? 'You leap the ditch, into the Wilderness.' : 'You leap the ditch back to gentler ground.', o.ent ? 'bad' : '');
    if (petMesh) petHop = { s: tSec, x0: petMesh.position.x, z0: petMesh.position.z, x1: o.fx + 1.1, z1: o.fz + 0.8 };
  };
  if (o.ent && OPT.pvpWarn && !pvpAck) askPvp(go); else go();
};
const stopWalk = () => { P.path.length = 0; P.goal = null; };
function walkTick() {
  if (pvpHold) { P.px = P.tx; P.pz = P.tz; P.span = 1; P.moved = 0; return; }   // anchor stays synced while asked
  // a stuck step is one tile over five ticks: the anchor stays on the departed tile while stuckT counts up
  if (P.span > 1 && (P.px !== P.tx || P.pz !== P.tz) && P.stuckT < P.span - 1) { P.stuckT++; P.moved = 0; return; }
  P.px = P.tx; P.pz = P.tz; P.span = 1;
  if (P.stun > 0) { P.stun--; P.moved = 0; return; }   // a failed pickpocket leaves you reeling
  if (!P.path.length) { P.moved = 0; chainGoal(); return; }
  const crawl = OPT.stuck && !P.afloat, want = crawl ? 1 : stepsThisTick();
  let took = 0;
  for (let i = 0; i < want && P.path.length; i++) {
    const n = P.path[0];
    if (!canStep(P.tx, P.tz, n.x, n.z)) { stopWalk(); break; }
    if (OPT.pvpWarn && !pvpAck && wildLvAt(n.x, n.z) && !wildLvAt(P.tx, P.tz)) { askPvp(); break; }   // the border asks once — afloat too: lava has no ditch to dig
    P.path.shift();
    P.tx = n.x; P.tz = n.z; took++;
    if (pvpAck && !wildLvAt(P.tx, P.tz)) pvpAck = 0;
  }
  P.moved = took;
  if (took) {
    P.faceT = Math.atan2(P.tx - P.px, P.tz - P.pz);
    const wet = isWater(walkY(P.tx, P.tz));
    if (wet && !P.afloat) { say('You climb into your rowboat.'); P.afloat = 1; }
    else if (!wet && P.afloat) { say('You step ashore.'); P.afloat = 0; }
    if (P.afloat) gainXp('sailing', 1.1 * took);
   /* Drain, then the wiki's own auto-off: "when a player's energy reaches 0%,
       their run option is automatically switched off". Without it the player is
       stuck at zero for as long as they keep walking — the drain skips itself on
       `P.energy > 0` and the restore skips itself on `!P.run`, so neither side
       runs and the orb never refills. Clearing the toggle here fixes both, and it
       is also what lets energy recover while walking, as it should. */
    if (!P.afloat && P.run && P.energy > 0 && took) { P.energy = Math.max(0, P.energy - 0.6 * (1 - lvl[SK.agility] / 300) * (P.stamT > tickN ? 0.3 : 1)); dirty.orb = 1; }   // drain: 60 x (1 - agility/300) units a running tick; a stamina draught keeps 70% of it
    if (P.run && P.energy <= 0) { P.run = 0; dirty.orb = 1; say('You are out of energy and slow to a walk.'); }
    if (crawl && !P.afloat) { P.span = 5; P.stuckT = 0; }
  }
  if (!P.path.length) chainGoal();
  if (!P.path.length && !P.task && !P.goal) { markT = 0; marker.visible = false; }
}
/* a long click outruns the node budget: chain partial legs toward the click, dropping goals that make no progress */
function chainGoal() {
  if (!P.goal || P.task || pvpHold) return;
  const d = Math.hypot(P.tx - P.goal.x, P.tz - P.goal.z);
  if (d < 1 || d >= P.goal.best - 0.5) { P.goal = null; return; }
  P.goal.best = d;
  const p = findPath(P.tx, P.tz, P.goal.x, P.goal.z, 0);
  if (p && p.length) P.path = p; else P.goal = null;
}
function showMark(x, z, hostile) {
  marker.position.set(x, Math.max(groundY(x, z), 0) + 0.12, z);
  marker.material.color.setHex(hostile ? 0xd83a2a : 0xffe14a);
  marker.visible = true; markT = 0.55;
}
function walkTo(wx, wz) {
  const x = Math.round(wx), z = Math.round(wz);
  closeOverlays();
  P.task = null;
  const p = findPath(P.tx, P.tz, x, z, 0);
  if (!p || !p.length) { say("You can't reach that."); P.goal = null; return; }
  P.goal = { x, z, best: Math.hypot(P.tx - x, P.tz - z) + 1 };
  P.path = p;
  showMark(x, z, 0);
}

/* ---- 22. GROUND ITEMS ---- */
const drops = [], pendingPiles = [], pileClaims = [];   // pendingPiles: another player's spill, sealed until its tick comes (their safe half, or the killer's minute)
function dropStack(id, n, x, z) {   // merge into the heap already on that tile, so spent arrows gather in one place
  const d = drops.find(q => q.id === id && q.x === x && q.z === z);
  if (d) { d.n += n; d.until = Math.max(d.until, tickN + 200); return; }
  dropItem(id, n, x, z);
}
function dropItem(id, n, x, z, life, pub) {
  while (drops.length >= DROP_CAP) drops.shift();   // roomy enough that a boss pile can't evict a death pile
  drops.push({ drop: 1, id, n: n || 1, x, z, y: Math.max(walkY(x, z), 0), name: ITEMS[id].name, until: tickN + (life || 200), pub: pub || 0 });   // a deadline on the shared clock: a per-tick countdown stalls whenever the tab is backgrounded
}
/* A spill announced over the wire is mirrored by every client in earshot, and nothing announced the pickup — so each
   mirror stayed lootable on its own and one death fed two or three full copies. Only broadcast piles carry `pub`;
   monster loot, spent arrows and your own drops are local and cost nothing. Claims batch to one message a tile a tick. */
const claimPile = d => { if (d.pub) pileClaims.push([d.x, d.z, d.id, d.n, d.pub]); };
function netPiles() {
  if (!pileClaims.length) return;
  if (srvBuild >= 11) {
    const byPile = new Map();
    for (const [x, z, id, n, own] of pileClaims) { const k = x + ',' + z + ',' + own; if (!byPile.has(k)) byPile.set(k, []); byPile.get(k).push([id, n]); }
    for (const [k, rows] of byPile) {
      const c = k.split(','), x = +c[0], z = +c[1], own = c.slice(2).join(',');
      for (let i = 0; i < rows.length; i += 8) netWorld([16, x, z, rows.slice(i, i + 8), own]);   // 8 rows so four chunks plus a tick's ordinary traffic stay inside the batch lane
    }
  }
  pileClaims.length = 0;
}
/* the mirror side: take these rows off whatever this client is holding for that tile, live heap or still-sealed pile */
function losePile(x, z, rows, own) {
  if (!own) return;   // an unowned claim names no pile, and pendingPiles aliases P.dpile.rows: a wrong match is permanent
  for (const row of rows) {
    const id = String(row && row[0] || ''), want = (row && row[1] | 0) || 0;
   /* the two lists are alternative representations of the same pile, not additive — a client holds it sealed until its
      tick comes and live afterwards — so each is retracted by the full amount, never by a shared remainder. The tile
      must match exactly and the owner must match too: two players die a tile apart in a chokepoint routinely. */
    let n = want;
    for (let i = drops.length - 1; i >= 0 && n > 0; i--) {
      const d = drops[i];
      if (d.pub !== own || d.id !== id || d.x !== x || d.z !== z) continue;
      const t = Math.min(n, d.n); d.n -= t; n -= t;
      if (d.n <= 0) drops.splice(i, 1);
    }
    n = want;
    for (const p of pendingPiles) {
      if (p.own !== own || p.x !== x || p.z !== z) continue;
      for (const r of p.rows) { if (n <= 0) break; if (r[0] !== id) continue; const t = Math.min(n, r[1]); r[1] -= t; n -= t; }
    }
  }
  for (let i = pendingPiles.length - 1; i >= 0; i--) { pendingPiles[i].rows = pendingPiles[i].rows.filter(r => r[1] > 0); if (!pendingPiles[i].rows.length) pendingPiles.splice(i, 1); }
}
function takeDrop(d) {
  const i = drops.indexOf(d); if (i < 0) return;
  if ((!ITEMS[d.id].stack && !invFree()) || !invAdd(d.id, d.n)) { say(FULL, 'bad'); return; }
  drops.splice(i, 1);
  claimPile(d);   // a broadcast pile is mirrored elsewhere: tell those copies it is gone
  if (P.dpile && Math.abs(d.x - P.dpile.x) <= 1 && Math.abs(d.z - P.dpile.z) <= 1) {   // reclaiming your own pile burns it from the saved record
    const r = P.dpile.rows.find(r2 => r2[0] === d.id);
    if (r) { r[1] -= d.n; P.dpile.rows = P.dpile.rows.filter(r2 => r2[1] > 0); if (!P.dpile.rows.length) P.dpile = null; }
  }
  markDirty();
  if (d.id === 'coins') sfx(2115);
  say('You pick up ' + (d.n > 1 ? d.n + ' x ' : '') + ITEMS[d.id].name.toLowerCase() + '.');
}
const fires = []; pickLists.push(fires);
function lightFire(x, z) {
  fires.push({ fire: 1, x, z, y: walkY(x, z), until: tickN + 180 + (hash2(x, z, S) & 127), name: 'Fire' });
  if (fires.length > 20) fires.shift().dead = 1;   // a task cooking at it must learn the fire is gone
}
/* ---- 23. NPCS: spawned off the settlement lattice, so a town has the same guards every time ---- */
const npcs = [], npcDead = new Map();
const npcCap = () => Math.min(28, 16 + Math.floor(Math.max(0, powerAt(P.tx, P.tz)) * 4));
const ORIGIN = { x: 0, z: 0 };   // the seed's canonical spawn anchors the danger gradient
/* how far into the world this ground is: distance does most of the work, altitude and noise season it, and the
   wilderness stacks its level on top — deep rings breed monsters, rune seams and magic groves alike (wire format) */
const powerAt = (x, z) => z > 500000 ? dunPower(x, z)
  : Math.hypot(x - ORIGIN.x, z - ORIGIN.z) / 1000 + Math.max(0, (heightAt(x, z) - 30) / 40) + fbm(x * 0.00055, z * 0.00055, S + 111, 2) * 0.35
    + wildLvAt(x, z) / 26;
/* the spawn lottery: every type weighted by log-distance from the ground's target level, heavy-tailed, asymmetric.
   The sanctuary caps levels near spawn on a geometric ramp. Every constant is wire format. */
const SANCTUARY = 150, SANCTUARY_LV = 15;
const sanctuaryCap = sT => sT <= 0 ? Infinity : Math.round(SANCTUARY_LV * Math.pow(250 / SANCTUARY_LV, 1 - sT));
const SPAWN_MAXLV = SPAWNABLE.reduce((m, q) => Math.max(m, q.lv), 1);
const _spawnTabs = new Map();
function spawnTable(p, sT, A, capT) {
  const bucket = Math.max(0, Math.round(p * 10)), key = ((bucket * 12 + Math.round(sT * 10)) * 9 + A.i) * 6 + (capT ? TOWN_CAP.indexOf(capT) + 1 : 0);
  let t = _spawnTabs.get(key);
  if (t) return t;
  // the old cubic, squashed through tanh so the target approaches the highest level that actually exists instead of diverging
  const targetLv = SPAWN_MAXLV * Math.tanh(4 * Math.pow(1 + bucket / 10, 3) / SPAWN_MAXLV), cap = sanctuaryCap(Math.round(sT * 10) / 10), cum = [], types = [];
  let sum = 0;
  for (const q of SPAWNABLE) {
    if (q.lv > cap || (capT && q.lv > capT)) continue;   // town belts keep their commons gentle
    const r = Math.log(q.lv / targetLv), sg = r < 0 ? 0.95 : 0.55;
    sum += q.vw * (A.mn[(q.base || q).k] || 1) / Math.pow(1 + Math.pow(r / sg, 2), 2);   // the kingdom favours its own kinds
    cum.push(sum); types.push(q);
  }
  _spawnTabs.set(key, t = { cum, types, sum });
  return t;
}
function pickMonster(x, z, h, p) {
  if (p === undefined) p = powerAt(x, z);
  const d = Math.hypot(x - ORIGIN.x, z - ORIGIN.z), n = nearVillage(x, z);
  const capT = n && n.d < n.v.r * SAFE_RM ? TOWN_CAP[n.v.rank] : 0;
  const t = spawnTable(p, clamp((SANCTUARY - d) / 100, 0, 1), regionAt(x, z).a, capT);
  const u = ((h >>> 11) & 1048575) / 1048576 * t.sum, c = t.cum;   // bits 11+: bits 0-15 already place the spawn
  let lo = 0, hi = c.length - 1;
  while (lo < hi) { const m = (lo + hi) >> 1; if (c[m] < u) lo = m + 1; else hi = m; }
  return t.types[lo];
}
/* farmyard beasts live in each settlement's authored pen (see the sites block); the wilds outside the walls are truly wild */
const PEN_K = [['cow', 'cow', 'sheep'], ['sheep', 'sheep', 'cow'], ['chicken', 'chicken', 'duck'], ['camel', 'camel', 'goat']];
const hasNpc = key => npcDead.has(key) || npcs.some(q => q.key === key);
const WILD_CELL = 64;   // one roaming pack per cell, one species to a cell
/* the cell's pack, or null: its hash, the ground's power at the centre (one powerAt a cell), how many, and the species the lottery picks */
function wildPack(gx, gz) {
  const h = hash2(gx, gz, S + 112), x = gx * WILD_CELL + WILD_CELL / 2, z = gz * WILD_CELL + WILD_CELL / 2;
  if (inDunPlane(z)) {   // below: every cell that touches a dungeon teems with its kind
    let d = null;
    for (const [ox2, oz2] of [[0, 0], [-30, -30], [30, -30], [-30, 30], [30, 30]]) { d = dunFor(x + ox2, z + oz2); if (d) break; }
    const t = d && dunPick(d, h);
    return t ? { h, pc: d.pw, n: 2 + (h >>> 7) % 3, t, d } : null;
  }
  const pc = powerAt(x, z), wl = wildLvAt(x, z);
  return (h % 100) > (wl ? 62 + Math.min(22, wl * 0.28) : 58) + Math.min(30, Math.max(0, pc) * 8) ? null
    : { h, pc, n: 1 + (h >>> 7) % 4 + (wl ? (wl > 50 ? 2 : 1) : 0), t: pickMonster(x, z, h, pc) };   // the wilds teem, and teem HARDER with the level: more cells taken, bigger packs, still clustered
}
const wildSpot = (gx, gz, i) => { const hh = hash2(gx * 31 + i, gz * 17 - i, S + 113); return { x: gx * WILD_CELL + (hh % WILD_CELL), z: gz * WILD_CELL + ((hh >>> 8) % WILD_CELL) }; };
function spawnWild() {
  const cx = Math.floor(P.tx / WILD_CELL), cz = Math.floor(P.tz / WILD_CELL), CAP = npcCap();
  for (let a = -1; a <= 1 && npcs.length < CAP; a++) for (let b = -1; b <= 1 && npcs.length < CAP; b++) {
    const gx = cx + a, gz = cz + b, pk = wildPack(gx, gz);
    for (let i = 0; pk && i < pk.n && npcs.length < CAP; i++) {
      const key = 'w' + gx + '_' + gz + '_' + i;
      if (hasNpc(key)) continue;
      let { x, z } = wildSpot(gx, gz, i);
      if (pk.d) {   // below ground the spot is drawn over the halls themselves
        const hh2 = hash2(gx * 31 + i, gz * 17 - i, S + 114), sp2 = pk.d.E * 2 + 1;
        const s2 = dunSnap(pk.d.ox - pk.d.E + hh2 % sp2, pk.d.oz - pk.d.E + (hh2 >>> 9) % sp2);
        if (!s2) continue;
        x = s2.x; z = s2.z;
      }
      if (Math.abs(x - P.tx) > 58 || Math.abs(z - P.tz) > 58 || walkY(x, z) > 70 || !dryOpen(x, z)) continue;
      const nv = nearVillage(x, z);
      if (nv && nv.d < nv.v.r * 1.1) continue;
      spawnNpc(pk.t, x, z, key, pk.pc);
    }
  }
}
/* boss lairs: a pure function of (cell, seed) alone — spot and species are fixed landmarks forever. Only alive/dead varies,
   tracked by npcDead against the stable cell key, so the respawn timer is honoured across any clock boundary. */
const BOSS_CELL = 1024, BOSS_MIN = 600, BOSS_LIST = NPC_TYPES.filter(t => t.boss);
function nearTown(x, z) {
  const cx = Math.floor(x * INV_CELL), cz = Math.floor(z * INV_CELL);
  for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) { const v = villageAt(cx + a, cz + b); if (v && Math.hypot(v.x - x, v.z - z) < v.r * 2.5 + 80) return true; }
  return false;
}
function bossAt(gx, gz) {
  if (gz * BOSS_CELL > 499000 - BOSS_CELL) return null;   // the dungeon band raises its own bosses
  const h = hash2(gx * 7, gz * 13, S + 200);
  if (h % 100 >= 40) return null;   // lairs rise only in the wilderness now, so more cells try their luck
  for (let i = 0; i < 12; i++) {
    const hh = hash2(gx * 31 + i, gz * 17 - i, S + 201 + i);
    const x = gx * BOSS_CELL + 40 + (hh % (BOSS_CELL - 80)), z = gz * BOSS_CELL + 40 + ((hh >>> 9) % (BOSS_CELL - 80)), y = heightAt(x, z);
    if (y < 2.5 || y > 60 || !wildLvAt(x, z)) continue;   // a lair stands in the wilds or not at all, among the kind of company its level keeps
   // the window hangs off the same ambient curve the spawn table computes for this ground: a boss sits a fixed step above the
   // local wildlife, and the floor keeps tracking the ceiling so the deep-world roster carries on turning over
    const tl = SPAWN_MAXLV * Math.tanh(4 * Math.pow(1 + Math.max(0, powerAt(x, z)), 3) / SPAWN_MAXLV), hi = tl * 2.2, lo = hi * 0.25;
    const pool = BOSS_LIST.filter(b => !b.wildOnly && b.lv <= hi && b.lv >= lo);   // the wilderness masters keep to their caves below
    if (!pool.length) continue;
    let sum = 0;
    const cum = pool.map(b => sum += Math.pow(hi / b.lv, 1.5));
    const u = ((h >>> 8) & 65535) / 65536 * sum;
    return { t: pool[cum.findIndex(c => c > u)], x, z };
  }
  return null;
}
/* nearest open tile spiralling out from (x, z) within r rings */
function openNear(x, z, r) {
  for (let ring = 0; ring <= r; ring++) for (let i = -ring; i <= ring; i++) for (let j = -ring; j <= ring; j++)
    if (Math.max(Math.abs(i), Math.abs(j)) === ring && dryOpen(x + i, z + j)) return { x: x + i, z: z + j };
  return null;
}
/* the nearest thing round the player on a lattice of `cell` tiles: fn(gx, gz) answers an {x, z} or null; the spiral stops a ring past its last improvement, or at `rings` */
function nearestOf(cell, rings, fn) {
  const o = tpFrom();   // below ground the spiral walks out from the door you entered by
  const cx = Math.floor(o.x / cell), cz = Math.floor(o.z / cell);
  let best = null, bd = 1e18, hit = 1e9;
  for (let r = 0; r <= rings && r <= hit + 1; r++) for (let i = -r; i <= r; i++) for (let j = -r; j <= r; j++) {
    if (Math.max(Math.abs(i), Math.abs(j)) !== r) continue;
    const p = fn(cx + i, cz + j), d = p ? Math.hypot(p.x - o.x, p.z - o.z) : bd;
    if (d < bd) { bd = d; best = p; hit = r; }
  }
  return best;
}
function spawnBosses() {
  if (inDunPlane(P.tz)) {   // the deepest hall keeps its own master
    const d = dunFor(P.tx, P.tz);
    if (!d || !d.G) return;
    const key = 'bD' + d.v.x + '_' + d.v.z;
    if (hasNpc(key) || Math.abs(d.bossAt.x - P.tx) > 80 || Math.abs(d.bossAt.z - P.tz) > 80) return;
    const tl = SPAWN_MAXLV * Math.tanh(4 * Math.pow(1 + d.pw, 3) / SPAWN_MAXLV);
    const fit = b => b && (d.cave || !b.wildOnly);   // the wilderness masters answer only to wilderness caves
    let pool = d.th.bs.map(k => NPC_BY[k]).filter(b => fit(b) && b.lv <= tl * 2.6);
    if (!pool.length) pool = [d.th.bs.map(k => NPC_BY[k]).filter(fit).sort((a, b) => a.lv - b.lv)[0]];   // the weakest still towers here: a landmark to come back for
    if (!pool[0]) return;
    const t = pool[(d.seed >>> 16) % pool.length], spot = openNear(d.bossAt.x, d.bossAt.z, 5);
    if (spot) spawnNpc(t, spot.x, spot.z, key, d.pw);
    return;
  }
  const cx = Math.floor(P.tx / BOSS_CELL), cz = Math.floor(P.tz / BOSS_CELL);
  for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
    const gx = cx + a, gz = cz + b, key = 'b' + gx + '_' + gz;
    if (hasNpc(key)) continue;
    const L = bossAt(gx, gz);
    if (!L || Math.abs(L.x - P.tx) > 80 || Math.abs(L.z - P.tz) > 80) continue;
    const spot = openNear(L.x, L.z, 4);
    if (spot) spawnNpc(L.t, spot.x, spot.z, key, powerAt(spot.x, spot.z));
  }
}
function removeNpc(n) {
  if (n._bar && !n.dead) { const i = bars.indexOf(n._bar); if (i >= 0) bars.splice(i, 1); fxFree(n._bar.f); n._bar = null; }   // culled alive (teleport, despawn): no ghost bar; a kill keeps its linger
  if (n.fpK) { for (const k of n.fpK) unblock(k, 1); n.fpK = null; }
  npcFree7(n);
  scene.remove(n.mesh); const i = npcs.indexOf(n); if (i >= 0) npcs.splice(i, 1);
}
function refreshNpcs() {
  for (let i = npcs.length - 1; i >= 0; i--) { const n = npcs[i]; if (Math.abs(n.tx - P.tx) > 92 || Math.abs(n.tz - P.tz) > 92) removeNpc(n); }
  spawnBosses();
  const CAP = npcCap();
  if (npcs.length >= CAP) return;
  const gx = Math.floor(P.tx * INV_CELL), gz = Math.floor(P.tz * INV_CELL);
  for (let a = -1; a <= 1 && npcs.length < CAP; a++) for (let b = -1; b <= 1 && npcs.length < CAP; b++) {
    const v = villageAt(gx + a, gz + b);
    if (!v) continue;
    villageBuildings(v);
    for (let i = 0, n = villageSpawnN(v); i < n && npcs.length < CAP; i++) {
      const key = 'n' + v.x + '_' + v.z + '_' + i;
      if (hasNpc(key)) continue;
      const s = villageSpawn(v, i);
      if (Math.abs(s.x - P.tx) > 60 || Math.abs(s.z - P.tz) > 60 || !dry(s.x, s.z)) continue;
      spawnNpc(s.t, s.x, s.z, key, s.pw);
    }
    if (v.circle) for (let i = 0; i < 3 && npcs.length < CAP; i++) {   // the dark wizards keep their circle
      const key = 'w' + v.x + '_' + v.z + '_' + i;
      if (hasNpc(key)) continue;
      const c2 = v.circle, hh = hash2(c2.x + i * 7, c2.z - i * 5, S + 129), sx = c2.x + hh % 5 - 2, sz = c2.z + (hh >>> 8) % 5 - 2;
      if (Math.abs(sx - P.tx) > 58 || Math.abs(sz - P.tz) > 58 || !dry(sx, sz)) continue;
      spawnNpc(NPC_BY.darkwizard, sx, sz, key, powerAt(sx, sz));
    }
    if (v.pen) for (let i = 0; i < 3 && npcs.length < CAP; i++) {   // the pen's own beasts, the same three forever
      const key = 'p' + v.x + '_' + v.z + '_' + i;
      if (hasNpc(key)) continue;
      const p2 = v.pen, hh = hash2(p2.x + i * 7, p2.z - i * 5, S + 126);
      const sx = p2.x - p2.w + 1 + hh % (p2.w * 2 - 1), sz = p2.z - p2.d + 1 + (hh >>> 8) % (p2.d * 2 - 1);
      if (Math.abs(sx - P.tx) > 58 || Math.abs(sz - P.tz) > 58 || !dry(sx, sz)) continue;
      spawnNpc(NPC_BY[PEN_K[p2.k][i]], sx, sz, key, 0);
    }
  }
  const sgx = Math.floor(P.tx / SITE_CELL), sgz = Math.floor(P.tz / SITE_CELL);
  for (let a = -1; a <= 1 && npcs.length < CAP; a++) for (let b = -1; b <= 1 && npcs.length < CAP; b++) {
    const st = siteAt(sgx + a, sgz + b);   // the waypoints keep their tenants: wizard circles, camps, barrows
    if (!st || !st.sp) continue;
    for (let i = 0; i < st.sp.length && npcs.length < CAP; i++) {
      const key = 's' + (sgx + a) + '_' + (sgz + b) + '_' + i;
      if (hasNpc(key)) continue;
      const hh = hash2(st.x * 3 + i, st.z - i, S + 403), sx = st.x - 3 + hh % 7, sz = st.z - 3 + (hh >>> 8) % 7;
      if (Math.abs(sx - P.tx) > 58 || Math.abs(sz - P.tz) > 58 || !dryOpen(sx, sz)) continue;
      spawnNpc(NPC_BY[st.sp[i]], sx, sz, key, powerAt(sx, sz));
    }
  }
  spawnWild();
}
/* the i-th spawn a settlement owns: castle garrison, townsfolk on the streets, else the outskirts' monsters. Before the plan is laid out the
   rank stands in for the keep, every street for the spots and the centre for the tile, so a finder can read a settlement it never built */
const villageSpawnN = v => 4 + v.rank * 3 + hash2(v.x, v.z, S + 51) % 4;
function villageSpawn(v, i) {
  const h = hash2(v.x + i * 71, v.z - i * 37, S + 52), B = v.b, r = { v, i };
  if ((B ? v.keep : RANKS[v.rank].keep) && i < 2 + v.rank) {
    const c = B ? v.keep : v, sp = Math.min(6 + ((h >>> 3) & 7), (B ? c.R : 13) - 2);
    return Object.assign(r, { t: NPC_BY.guard, x: c.x + (((h & 1) ? 1 : -1) * sp), z: c.z + ((((h >>> 1) & 1) ? 1 : -1) * sp) });
  }
  if ((!B || v.spots.length) && (h & 1)) {
    const folk = TOWNFOLK[Math.min(TOWNFOLK.length - 1, v.rank)], sp = B ? v.spots[(h >>> 6) % v.spots.length] : v;
    return Object.assign(r, { t: NPC_BY[folk[(h >>> 17) % folk.length]], x: sp.x, z: sp.z });
  }
  const [x, z] = townPt(v, (h & 1023) / 1024 * TAU, v.r * (1.0 + ((h >>> 10) & 63) / 64 * 0.5)), pw = powerAt(x, z);   // outside the outline, whatever its shape
  return Object.assign(r, { t: pickMonster(x, z, h, pw), x, z, pw });
}
/* the shared wander: destination is a pure function of (key hash, shared tick) */
const wanderAt = (kh, tick, hx, hz) => { const r = hash2(kh ^ tick, tick, S + 777); return r % 6 === 0 ? { x: hx + ((r >>> 8) % 11) - 5, z: hz + ((r >>> 16) % 11) - 5 } : null; };
function spawnNpc(t, x, z, key, pw) {
  const kh = key ? hashSeed(key) : (Math.random() * 4294967296) | 0;   // dev spawns stay local with a private seed
  let dest = null;
  for (let b = 0; b < 12 && !dest && key; b++) dest = wanderAt(kh, tickN - b, x, z);   // adopt the leg the room is already walking
  const base = t.base || t;
  if (!base.rig) base.rig = base.build(base.body);   // built on first meeting, kept forever
  if (t.tint && !t.mat) t.mat = basicMat({ color: t.tint });
  const mesh = riggedMesh(base.rig, t.mat || null);
  if (t.scale) mesh.scale.setScalar(t.scale);
  scene.add(mesh);
  const n = { npc: 1, t, key, name: t.n, tx: x, tz: z, px: x, pz: z, rx: x, rz: z, ry: walkY(x, z), home: { x, z }, hp: t.hp, maxhp: t.hp, face: 0, faceT: 0, mesh,
    atkT: 0, atkStyle: 'm', limbs: mesh.limbs || null, walkPhase: 0, styleIx: 0, styleN: 0, cd: 2 + (hash2(x, z, S) & 3), target: null, dead: 0, mv: 0,
    pw: pw !== undefined ? pw : powerAt(x, z), kh, dest, owner: null, lastNet: 0, netAct: 0 };
  npcs.push(n);
  npcFoot(n);
}
/* one player owns an engaged monster and everyone else watches: the owner simulates, the rest interpolate */
function claimMon(n) { n.owner = PID; n.lastNet = tickN; sendMonFrame(n); }
function sendMonFrame(n) {
  if (!n.key) return;
  netWorld([21, n.key, n.tx, n.tz, Math.round(n.face / TAU * 16) & 15, n.hp, PID, n.netAct || 0]);
  n.netAct = 0;
}
const leash = n => { n.owner = null; n.hp = n.maxhp; n.dest = { x: n.home.x, z: n.home.z }; };
function releaseMon(n) { const key = n.key; leash(n); if (key) netWorld([21, key, n.tx, n.tz, 0, n.maxhp, '', 255]); }
function netMon() {   // frames for anything we own that is off the shared script
  for (const q of npcs) if (q.key && q.owner === PID && !q.dead && q.target) sendMonFrame(q);
}
/* style per swing: out of reach only the far styles are live; in reach melee dominates at the wiki's rates — a two-style
   dragon breathes one swing in six (Mod Ash), the three-style mithril class goes off-melee two in five. */
function npcStyle(n, near, reach) {
  const at = n.t.at || 'm', far = at.replace('m', '');
  if (!far) return 'm';
  const pick = () => far[(Math.random() * far.length) | 0];
  return near > reach || at === far || Math.random() < (at.length > 2 ? 0.4 : 1 / 6) ? pick() : 'm';
}
function npcBolt(n, style, tgt) {
  const T = tgt || P, tint = style === 'r' ? (n.t.arrow || 0x9a8a6a) : (n.t.bolt || 0xd05a2a);
  if (style === 'r') shootArrow({ rx: n.rx, ry: n.ry + n.t.sz * 0.9, rz: n.rz }, aimAt(T.rx, T.ry, T.rz), null, tint);
  else launch(tint, n.rx, n.ry + 0.6 + n.t.sz * 1.1, n.rz, aimAt(T.rx, T.ry, T.rz), null, BOLT_SPEED, 0.10, 0.9);
}
/* one banked step toward (tx, tz). Chasing: the diagonal needs dry ground, orthogonals do not. Wandering (strict): every step does,
   and a zero axis is never tried. Returns 0 when walled in. */
/* the oversized claim their ground: a 3x3 footprint (5x5 for the truly vast) blocks walking, so fights happen at the hide, not the heart */
const npcFp = t => t.big ? (t.sz >= 3 ? 2 : 1) : 0;
const npcReach = t => t.big ? Math.max(npcFp(t) + 1, Math.round(t.sz)) : 1;   // melee reach to a big thing, and from it: the same tiles either way
function npcFoot(n) {
  const fp = npcFp(n.t);
  if (!fp || (n.fpX === n.tx && n.fpZ === n.tz)) return;
  if (n.fpK) for (const k of n.fpK) unblock(k, 1);
  n.fpK = new Set();
  for (let a = -fp; a <= fp; a++) for (let b = -fp; b <= fp; b++) { const k = tk(n.tx + a, n.tz + b); block(k, 1); n.fpK.add(k); }
  n.fpX = n.tx; n.fpZ = n.tz;
}
function npcStep(n, tx, tz, strict) {
  const dx = Math.sign(tx - n.tx), dz = Math.sign(tz - n.tz);
  const ok = (x, z, wet) => canStep(n.tx, n.tz, x, z, n.fpK) && (!wet || !isWater(walkY(x, z)));
  const corner = !(dx && dz) || (ok(n.tx + dx, n.tz, 0) && ok(n.tx, n.tz + dz, 0));   // findPath's rule: a diagonal needs both orthogonals, so nothing slips through a wall's staircase
  if ((!strict || (dx && dz)) && corner && ok(n.tx + dx, n.tz + dz, 1)) { n.tx += dx; n.tz += dz; }
  else if (dx && (!strict || dx) && ok(n.tx + dx, n.tz, strict)) n.tx += dx;   // dx guarded: a zero delta made this canStep(from, from), a step onto its own tile that always "succeeded"
  else if (dz && (!strict || dz) && ok(n.tx, n.tz + dz, strict)) n.tz += dz;
  else {
   // one lateral try, the same side on every client, so a wide body is not stopped for good by a single tile
    const sd = ((n.kh ^ tickN) & 1) ? 1 : -1;
    if (!dx && dz) { if (ok(n.tx + sd, n.tz + dz, strict)) { n.tx += sd; n.tz += dz; return 1; } if (ok(n.tx - sd, n.tz + dz, strict)) { n.tx -= sd; n.tz += dz; return 1; } }
    else if (dx && !dz) { if (ok(n.tx + dx, n.tz + sd, strict)) { n.tx += dx; n.tz += sd; return 1; } if (ok(n.tx + dx, n.tz - sd, strict)) { n.tx += dx; n.tz -= sd; return 1; } }
    return 0;
  }
  return 1;
}
const chebDist = (ax, az, bx, bz) => Math.max(Math.abs(ax - bx), Math.abs(az - bz));
function npcTick(n) {
  if (n.dead) return;
  n.px = n.tx; n.pz = n.tz;
  if (n.owner && n.owner !== PID) { if (tickN - n.lastNet > 5) { n.owner = null; n.dest = { x: n.home.x, z: n.home.z }; } return; }   // owner's frames stopped: orphan it wounds intact — only a deliberate release leashes and heals
  const near = chebDist(n.tx, n.tz, P.tx, P.tz);
  if (n.target && (near > 12 || P.dead)) { n.target = null; releaseMon(n); }
  // 2007 aggression: the mean ones start it within a few tiles, unless outgrown or overstayed; the deep wilds never get used to you
  // (deliberate deviation: 2007 forgets you after a flat ~10 minutes anywhere; here tolerance stretches with the ground's power)
  const npw = Math.max(0, n.pw);
  const dun = n.tz > 500000;   // below ground nothing outgrows you and nothing gets used to you
  if (!n.target && n.t.agg && !P.dead && near <= (n.t.boss ? 7 : 5) && (n.t.boss || dun || npw >= 1.5 || tickN - P.regionT < 1000 / (1 - npw / 1.5)) &&
      (n.t.boss || dun || combatLevel() < n.t.lv * 2 + 1) && hasLos(n.tx, n.tz, P.tx, P.tz)) { n.target = P; claimMon(n); }
  if (n.psn > 0 && tickN >= n.psnT && !n.dead) {   // a poisoned wound bites every 30 ticks, shallowing as it goes; true venom deepens by two, to twenty
    n.psnT = tickN + 30; n.hp -= n.psn; hitsplat(n.rx, n.ry + 1.2, n.rz, n.psn); healthBar(n); sfxAt(2408, n.tx, n.tz);
    if (n.venomF) n.psn = Math.min(20, n.psn + 2);
    else if (++n.psnN % 5 === 0) n.psn--;
    if (n.hp <= 0) { killNpc(n); return; }
  }
  if (n.target) {
    const bigR = npcFp(n.t) + 1, at = n.t.at || 'm';   // a big thing strikes from its own edge, not from atop you
    const phase = n.t.boss ? at[n.styleIx % at.length] : null;
   // anything that can swing closes until it can: a dragon that only ever breathes, from seven tiles, is no fight at all.
   // The metal kinds alone hold their range (wiki), and a boss keeps to the phase it announced.
    const want = (phase ? phase === 'm' : at.includes('m') && !n.t.stay) ? bigR : Math.max(n.t.rng || 1, bigR);
    if (n.cd > 0) n.cd--;   // the swing clock runs while it closes in too, so arriving in reach does not cost a free tick
    if (near > want || !hasLos(n.tx, n.tz, P.tx, P.tz)) {   // out of reach, or behind something: close in until the line opens, as 2007 does
      if (n.heldT > tickN) { n.mv = 0; } else {   // a snared thing strains at the ground instead of closing in
      for (n.mv += n.t.mspd; n.mv >= 1; n.mv--) {   // mspd is tiles per tick, banked
        if (!npcStep(n, P.tx, P.tz, 0)) break;
        if (chebDist(n.tx, n.tz, P.tx, P.tz) <= want && hasLos(n.tx, n.tz, P.tx, P.tz)) break;
      }
      n.mv = Math.min(n.mv, 1);
      }
    } else if (n.cd <= 0) {
      n.cd = n.t.spd; n.mv = 0;
      let st;
      if (phase) {
        st = phase;
        if (++n.styleN >= 3) {
          n.styleN = 0; n.styleIx = (n.styleIx + 1) % n.t.at.length;
          const nx = n.t.at[n.styleIx];
          say(n.t.n + (nx === 'm' ? ' charges in to maul you!' : nx === 'r' ? ' rears back to hurl!' : n.t.fire ? ' draws a deep breath!' : ' begins to cast!'), 'bad');
        }
      } else st = npcStyle(n, near, npcReach(n.t));
      n.atkT = 1; n.atkStyle = st; n.netAct = st === 'm' ? 1 : st === 'r' ? 2 : 3;
      if (st !== 'm') npcBolt(n, st);
   // monster effective level is level + 9; max hit comes from the shared 2007 formula off its strength and strength bonus.
   // a cast rolls the monster's Magic against 0.7 x your Magic + 0.3 x your Defence and your magic gear; all else rolls your Defence
      const cast = st === 'g' && !n.t.fire, mx = n.t.max !== null ? n.t.max : maxFrom(n.t.str * (n.strDr > tickN ? 0.95 : 1) + 1, n.t.sbon);
      const c = hitChance((cast && n.t.mag > 1 ? n.t.mag : n.t.atk) * (n.atkDr > tickN ? (n.atkDrM || 0.95) : 1) + 9, n.t.abon,
        cast ? Math.floor(0.7 * Math.floor(eff('magic') * prayerMul('mag')) + 0.3 * defLevel()) + 8 : defLevel() + 8, cast ? bonus('mag') + bonus('mdef') : bonus('def'));
   // dragonfire ignores armour: a shield or an antifire draught each count one (prayer a half); two is immunity, one leaves a max of 10.
   // unprotected it hits up to 50 as in 2007 (fmax overrides where the wiki differs, e.g. the KBD)
      const fire = st === 'g' && n.t.fire, pr = fire && (eq.shield === 'anti_dragon_shield' || eq.shield === 'dragonfire_shield') + (P.afire > tickN) + (prayHas('prot', 'g') ? 0.5 : 0);
      const dealt = fire ? roll(1, pr >= 2 ? 0 : pr ? 10 : (n.t.fmax || 50)) : prayHas('prot', st) ? 0 : roll(c, mx);
      if (fire && pr < 2) say(pr ? 'Your protection absorbs most of the dragonfire.' : 'You are horribly burnt by the dragonfire!', 'bad');
      if (dealt > 0 && n.t.psn && !P.psn && tickN > P.psnImm && !psnImmune() && Math.random() < 0.25) { P.psn = n.t.psn; P.psnN = 0; P.psnT = tickN + 30; say('You have been poisoned!', 'bad'); }
      if (dealt > 0) n.caHurt = 1;
      hurtPlayer(dealt);
      if (dealt > 0 && eq.ring === 'ring_of_recoil' && !n.dead && !P.dead) {   // a ring of recoil bites back a tenth
        const rec = Math.max(1, Math.ceil(dealt * 0.1));
        n.hp -= rec; hitsplat(n.rx, n.ry + 1.2, n.rz, rec);
        if (n.hp <= 0) { killNpc(n); return; }
        healthBar(n);
      }
      retaliate(n);
    }
  } else {
    const d = n.heldT > tickN ? null : wanderAt(n.kh, tickN, n.home.x, n.home.z);   // un-aggroed monsters mill about deterministically, unless rooted
    if (d) n.dest = d;
    if (n.heldT > tickN) n.dest = null;
    if (n.dest && (n.dest.x !== n.tx || n.dest.z !== n.tz)) {
      for (n.mv += n.t.mspd; n.mv >= 1 && n.dest; n.mv--) {
        if (!npcStep(n, n.dest.x, n.dest.z, 1)) n.dest = null;
        if (n.dest && n.dest.x === n.tx && n.dest.z === n.tz) break;
      }
    }
    n.mv = Math.min(n.mv, 1);
  }
  if (n.target) n.faceT = Math.atan2(P.tx - n.tx, P.tz - n.tz);   // something with a target looks at it
  else if (n.tx !== n.px || n.tz !== n.pz) n.faceT = Math.atan2(n.tx - n.px, n.tz - n.pz);
  npcFoot(n);
}
/* the shared tables of 2007, weights verbatim from the wiki; entries with no counterpart here (key halves, hops and
   flower seeds, shield left half) fall through as the tables' own empty weight. Reached only through an authored
   table's 'rdt'/'gem'/'mega'/'herb'/'seed'/'useed'/'rseed' slot, or 1/128 from the unauthored fallback. */
const RARE_DROPS = [['nature_rune', 3, 67], ['adamant_javelin', 2, 20], ['death_rune', 2, 45], ['law_rune', 2, 45], ['rune_arrow', 2, 42], ['steel_arrow', 2, 150],
  ['rune_2h_sword', 3], ['rune_battleaxe', 3], ['rune_sq_shield', 2], ['dragon_med_helm', 1], ['rune_kiteshield', 1], ['coins', 21, 3000],
  ['rune_bar', 5], ['dragonstone', 2], ['silver_ore', 2, 100], ['gem', 20], ['mega', 15]], RARE_W = 128;
const MEGA_DROPS = [['rune_spear', 8], ['dragon_spear', 3], ['crystal_bow', 2], ['crystal_shield', 1],
  ['partyhat', 1], ['santa_hat', 1], ['hween_mask', 1]], MEGA_W = 128;   // the crystal pieces ride the mega-rare slot: no elves in this world; the holidays never came, so their hats ride it too
const GEM_DROPS = [['uncut_sapphire', 32], ['uncut_emerald', 16], ['uncut_ruby', 8], ['chaos_talisman', 3], ['nature_talisman', 3], ['uncut_diamond', 2],
  ['rune_javelin', 1, 5], ['mega', 1]], GEM_W = 128;
const HERB_SUB = [['grimy_guam', 32], ['grimy_marrentill', 24], ['grimy_tarromin', 18], ['grimy_harralander', 14], ['grimy_ranarr', 11], ['grimy_irit', 8],
  ['grimy_avantoe', 6], ['grimy_kwuarm', 5], ['grimy_cadantine', 4], ['grimy_lantadyme', 3], ['grimy_dwarf_weed', 3]], HERB_W = 128;
const SEED_SUB = [['wheat_seed', 320, 4], ['potato_seed', 368, 4], ['onion_seed', 276, 4], ['cabbage_seed', 184, 4], ['tomato_seed', 92, 3], ['sweetcorn_seed', 46, 3],
  ['strawberry_seed', 23, 2], ['watermelon_seed', 11, 2]], SEED_W = 1008;   // the general table's allotment band
const USEED_SUB = [['strawberry_seed', 131], ['marrentill_seed', 125], ['tarromin_seed', 85], ['watermelon_seed', 63], ['harralander_seed', 56], ['ranarr_seed', 39],
  ['toadflax_seed', 27], ['irit_seed', 18], ['avantoe_seed', 12], ['kwuarm_seed', 9], ['snapdragon_seed', 5], ['cadantine_seed', 4], ['lantadyme_seed', 3],
  ['dwarf_weed_seed', 2], ['torstol_seed', 1]], USEED_W = 1048;   // uncommon seed table; the 468 empty weight is its hops/flower/bush seeds, which have no counterpart here
const RSEED_SUB = [['toadflax_seed', 216], ['irit_seed', 148], ['avantoe_seed', 103], ['kwuarm_seed', 69], ['snapdragon_seed', 46], ['cadantine_seed', 32],
  ['lantadyme_seed', 23], ['dwarf_weed_seed', 14], ['torstol_seed', 9]], RSEED_W = 1090;   // rare seed table; the 430 empty weight is its belladonna/cactus/snape-grass seeds, absent here
/* roll a weighted [id, w, ...] table against `budget` (null = the table's own total) */
function rollTable(table, budget) {
  let r = Math.random() * (budget || table.reduce((s, d) => s + d[1], 0));
  for (const d of table) if ((r -= d[1]) < 0) return d;
  return null;
}
const randInt = (lo, hi) => lo + (Math.random() * (hi - lo + 1) | 0);
const rowBudget = w => eq.ring === 'ring_of_wealth' ? null : w;   // the ring clears the empty slots from the rare tables, as in 2007
const SUBTABLES = { rdt: () => rollTable(RARE_DROPS, rowBudget(RARE_W)), mega: () => rollTable(MEGA_DROPS, MEGA_W), gem: () => rollTable(GEM_DROPS, rowBudget(GEM_W)),
  herb: () => rollTable(HERB_SUB, HERB_W), seed: () => rollTable(SEED_SUB, SEED_W), useed: () => rollTable(USEED_SUB, USEED_W), rseed: () => rollTable(RSEED_SUB, RSEED_W) };
/* run one authored table: alw always drops; each of `rolls` main rolls picks one [id, w, min, max] slot out of den
   (shortfall = the empty slot; named slots divert to the shared tables); tert entries are independent 1-in-N rolls */
function rollLoot(T, drop) {
  if (T.alw) for (const d of T.alw) drop(d[0], randInt(d[1] || 1, d[2] || d[1] || 1));
  if (T.main) for (let r = T.rolls || 1; r > 0; r--) {
    let d = rollTable(T.main, T.den), g = 0;
    while (d && SUBTABLES[d[0]] && g++ < 4) d = SUBTABLES[d[0]]();   // deepest real chain: main -> rdt -> gem -> mega
    if (d && SUBTABLES[d[0]]) throw new Error('subtable chain too deep: ' + d[0]);
    if (d) drop(d[0], randInt(d[2] || 1, d[3] || d[2] || 1));
  }
  if (T.tert) for (const d of T.tert) if (Math.random() * d[1] < 1) {
    let dd = d, g = 0;   // a tert slot may name a shared table (barrows, raid) just as main slots do
    while (dd && SUBTABLES[dd[0]] && g++ < 4) dd = SUBTABLES[dd[0]]();
    if (dd) drop(dd[0], randInt(dd[2] || 1, dd[3] || dd[2] || 1));
  }
}
function killNpc(n) {
  n.dead = 1;
  if (n.plate) { freePlate(n.plate); n.plate = null; }
  const due = tickN + (n.t.boss ? 3000 : 60);   // a slain boss stays down half an hour
  if (n.key) { npcDead.set(n.key, due); netWorld([22, n.key, due]); }   // keyless spawns (events, dev) leave no timer behind
  removeNpc(n);
  const p = Math.max(0, n.pw || 0), x = n.tx, z = n.tz, q = 1 + Math.min(1, p * 0.15);   // only coin stacks swell with the ground's power (capped 2x): authored quantities stay wiki-exact
  const drop = (id, k) => { const nq = id === 'coins' ? Math.max(1, Math.round((k || 1) * q)) : (k || 1); if (id === 'coins') gpMade += nq; clogAdd(id); dropItem(id, nq, x, z); };
  const T = LOOT[n.t.k + '@' + n.t.lv] || LOOT[n.t.k];   // a rung can carry its own wiki table; otherwise the family shares one (a missing table throws at startup)
  if (!T.nb) drop(n.t.bones || (n.t.big ? 'big_bones' : 'bones'), 1);
  if (n.t.meat) drop(n.t.meat, 1);
  rollLoot(T, drop);
  if (T.taskTert && P.slay && (n.t.base || n.t).k === P.slay.k)
    for (const d of T.taskTert) if (Math.random() * d[1] < 1) drop(d[0], randInt(d[2] || 1, d[3] || d[2] || 1));   // the slayer's own spoils fall on-task only
  for (const f of onKill) f(n, drop);
  say(n.t.boss ? 'You have slain ' + n.name + '!' : 'You defeat the ' + n.name + '.', n.t.boss ? 'lv' : 'good');
  if (P.task && P.task.o === n) P.task = null;
}
let pvpOn = 0;
/* the two guards that eat a wound before it lands: the Justiciar set by the wiki's bonus/3000, the elysian by its
   70% chance of a quarter off. Neither knows here that the wiki spares dragonfire and poison from the shield. */
function softenBlow(dmg) {
  if (dmg <= 0) return dmg;
  if (setOn('justiciar_')) dmg -= Math.floor(dmg * Math.max(0, bonus('def')) / 3000);
  const sh = eq.shield && ITEMS[eq.shield];
  if (sh && sh.elys && Math.random() < 0.7) dmg -= Math.floor(dmg * 0.25);
  return Math.max(0, dmg);
}
function hurtPlayer(dmg, byPlayer) {
  dmg = softenBlow(dmg);
  if (P.veng && dmg > 0) {   // the wiki's 75%, spent on the first blow that actually lands
    P.veng = 0; drawSpells();
    const back = Math.max(1, Math.round(dmg * 0.75));
    const t = P.task && P.task.o;
    say('Taste vengeance!', 'lv');
    if (t && t.npc && !t.dead) { t.hp -= back; hitsplat(t.rx, t.ry + 1.2, t.rz, back); healthBar(t); if (t.hp <= 0) killNpc(t); }
    else if (byPlayer) wsSend([11, byPlayer, Math.min(back, HIT_MAX), 0, 'm']);
  }
  P.dreamT = 0;   // a blow ends the dream
  P.hp = Math.max(0, P.hp - dmg);
  dirty.orb = 1;
  hitsplat(P.rx, P.ry + 1.6, P.rz, dmg);
  if (hurtSnd) { sfx(hurtSnd); hurtSnd = 0; } else if (dmg > 0) sfx(513); else parrySnd();
  wsSend([13, P.hp, P.maxhp]);
  if (P.hp > 0 && P.hp * 5 < P.maxhp && eq.neck === 'phoenix_necklace') {   // below a fifth: three tenths back, and the charm is spent — before Redemption or the ring can speak
    P.hp = Math.min(P.maxhp, P.hp + Math.floor(P.maxhp * 0.3));
    eq.neck = null; dirty.eq = 1; dressAvatar(); markDirty(1);
    say('Your phoenix necklace flares with healing warmth, and crumbles to dust.', 'lv');
  }
  if (P.hp > 0 && P.hp <= Math.floor(P.maxhp * 0.1) && prayHas('redeem')) {   // Redemption: a tenth of your health buys a quarter of your prayer level, for every point
    P.hp = Math.min(P.maxhp, P.hp + (lvl[SK.prayer] >> 2)); P.pray = 0; P.prayers = 0; dirty.orb = 1;
    say('You are redeemed, at the cost of all your prayer.', 'lv'); drawPrayers();
  }
  if (P.hp > 0 && (eq.ring === 'ring_of_life' || capeOn('defence')) && P.hp <= Math.max(1, Math.floor(P.maxhp * 0.1)) && wildLvAt(P.tx, P.tz) <= TP_CAP_ITEM) {   // fires at a tenth of your health; the defence cape works the ring's escape and survives it. Both are on the wiki's level-30 exempt list, and neither works below it
    const ring = eq.ring === 'ring_of_life';
    if (ring) { eq.ring = null; dirty.eq = 1; }
    P.task = null; stopWalk();
    const rlf = tpFrom(), v = nearestVillageTo(rlf.x, rlf.z, 12);
    if (v) { const sp = safeSpotIn(v); sfx(200); teleport(sp.x, sp.z, 200); }
    say(ring ? 'Your ring of life flares, carries you to safety, and crumbles to dust.' : 'Your cape flares and carries you to safety.', 'lv');
    markDirty(2); healthBar(P);
    return;
  }
  if (P.hp <= 0) die(byPlayer);
  healthBar(P);
}
/* ---- THE SKULL: strike first and it rises; strike back and it doesn't. The timer is one saved tick (`sku`), refreshed by every
   initiated attack; the grudge list (who may be answered freely) lives only for the session and empties on death. Skulled, a
   player's death forfeits everything carried — Protect Item alone clutches one thing back. Monsters collect no such price. ---- */
let pvpFoes = new Map();   // pid -> the tick their grudge lapses: answering a standing aggressor costs no skull
const FOE_T = 50;   // thirty seconds. The wiki publishes no number for the retaliation window, so this is a house value, not wiki-true
const SKULL_T = 3000;   // thirty minutes, as the wiki counts them: a skull from attacking a player runs 30, and every fresh attack restarts it
const skulled = () => P.skull > tickN;
const foesTick = () => { for (const [k, t] of pvpFoes) if (t <= tickN) pvpFoes.delete(k); };   // a grudge lapses; it used to last the session
function skullUp() {
  const was = skulled();
  P.skull = tickN + SKULL_T;
  if (!was) { say('A skull rises over your head: all you carry is forfeit to your killer.', 'bad'); sendEquip(); markDirty(2); }
}
const remoteCb = R => { for (const id of (R.eq || [])) if (typeof id === 'string' && id[0] === 'c' && id[1] === ':') return clamp(parseInt(id.slice(2), 10) || 0, 3, 126); return 0; };
/* the wilderness law: PvP lives only inside the rings, and its level is how far beneath you your prey may stand.
   Punching up is always allowed — the smaller fighter takes the risk — and answering a standing aggressor is always clean. */
function pvpGate(o) {
  const wa = wildLvAt(P.tx, P.tz), wb = wildLvAt(o.tx, o.tz);
  if (!wa || !wb) return 'You can only attack other players in the Wilderness.';
  if ((pvpFoes.get(o.pid) || 0) > tickN) return null;
  const theirs = remoteCb(o), wl = Math.min(wa, wb);
  if (theirs && combatLevel() - theirs > wl) return 'Level ' + wl + ' Wilderness will not let you strike so far beneath you.';
  return null;
}
const skullTex = new THREE.CanvasTexture(_dmc); skullTex.magFilter = THREE.NearestFilter;
const mkSkull = () => { const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: skullTex, transparent: true, fog: false, depthTest: false })); s.scale.set(0.5, 0.5, 1); s.renderOrder = 6; return s; };
let mySkull = null, skullHad = 0;
function skullFrame() {   // the mark floats over every skulled head, yours included
  const on = skulled() && !P.dead && started;
  if (on && !mySkull) { mySkull = mkSkull(); scene.add(mySkull); }
  if (mySkull) { mySkull.visible = on; if (on) mySkull.position.set(P.rx, P.ry + 2.75, P.rz); }
  for (const R of remotes.values()) {
    const rOn = !!(R.eq && R.eq.indexOf('sk:1') >= 0);
    if (rOn && !R.skullSpr) { R.skullSpr = mkSkull(); scene.add(R.skullSpr); }
    if (R.skullSpr) { R.skullSpr.visible = rOn; if (rOn) R.skullSpr.position.set(R.rx, R.ry + 2.75, R.rz); }
  }
}
tickHooks.push(() => {   // the sentence served, the mark fades — and the wire hears of it
  if (skullHad && !skulled()) { skullHad = 0; say('The skull over your head fades.', 'lv'); sendEquip(); }
  else if (!skullHad && skulled()) skullHad = 1;
});
function retaliate(attacker) {
  if (!OPT.retaliate || P.dead || !attacker) return;
  if (P.task && (P.task.k === 'attack' || P.task.k === 'ui' || P.task.k === 'take')) return;
  P.task = { k: 'attack', o: attacker };   // the swing timer carries across retargets, as in 2007
}
function die(byPlayer) {
  P.dead = 1; P.task = null; P.path.length = 0;
  if (trade) tradeCancel(1);   // a corpse cannot hold up its end: settling now would move goods out of an empty pack
  for (const n of npcs) if (n.target === P) { n.target = null; releaseMon(n); }   // your death ends the fight: they reset and walk home
  sfx(512);
  say('Oh dear, you are dead!', 'bad');
  deathSpot = { x: P.tx, z: P.tz, t: tickN };   // the skull stands where you fell, on every map, for the pile's quarter hour
  deathMark.position.set(P.tx, Math.max(walkY(P.tx, P.tz), 0), P.tz);
  deathMark.visible = true; wmDirty = 1;
  say('A skull marks where you fell.', 'lv');
  // everything carried or worn, dearest first: three items stay with you, the rest lies where you fell for a quarter hour (a player's kill goes out over the wire)
  const all = [], spill = [], dx = P.tx, dz = P.tz;
  for (const sl of EQ_SLOTS) if (eq[sl]) { all.push({ id: eq[sl], n: sl === 'ammo' ? P.ammoN : 1 }); eq[sl] = null; }
  for (let i = 0; i < INV_N; i++) if (inv[i]) { all.push(inv[i]); inv[i] = null; }
  P.ammoN = 0;
  for (let i = all.length - 1; i >= 0; i--) if (all[i].id.startsWith('pet_')) {   // pets never lie in the dirt: insured ones run to the insurer, the rest are gone
    const pid2 = all.splice(i, 1)[0].id;
    if (P.ins.includes(pid2)) { if (!P.petLost.includes(pid2)) P.petLost.push(pid2); say('Your ' + ITEMS[pid2].name.toLowerCase() + ' bolts for its insurer.', 'bad'); }
    else say('Your ' + ITEMS[pid2].name.toLowerCase() + ' is gone for good.', 'bad');
  }
  P.pet = null;
  all.sort((a, b) => ITEMS[b.id].val - ITEMS[a.id].val);
  // three items stay with you, four under Protect Item — unless a player killed you while skulled: then the prayer's one thing is all
  const wasSkulled = skulled();
  const K = byPlayer && wasSkulled ? (prayHas('item') ? 1 : 0) : 3 + (prayHas('item') ? 1 : 0);
  if (prayHas('retri')) for (const n of npcs.slice()) if (!n.dead && chebDist(n.tx, n.tz, dx, dz) <= 1) {   // killNpc splices npcs, so walk a copy   // Retribution: a last blast at whatever stands beside you
    const d = randInt(0, lvl[SK.prayer] >> 2); n.hp -= d; hitsplat(n.rx, n.ry + 1.2, n.rz, d); if (n.hp <= 0) killNpc(n);
  }
  let keep = K;
  for (const s of all) {
    const k = Math.min(keep, s.n); keep -= k;
    if (k) invAdd(s.id, k);
    if (s.n > k) { spill.push([s.id, s.n - k]); if (!byPlayer) dropItem(s.id, s.n - k, dx, dz, 1500, PID); }   // a player's kill leaves nothing for you: the pile is the killer's
  }
  dirty.inv = dirty.eq = 1; dressAvatar();
  if (spill.length) {
    netWorld([12, dx, dz, spill.slice(0, 40), byPlayer || '', tickN]);   // monsters' kills go out too: the pile turns public after its safe half
   // your pile is your right: one saved record survives any relog, and after a killer's minute even a PvP corpse may be reclaimed
    P.dpile = { x: dx, z: dz, t: tickN, pv: byPlayer ? 1 : 0, rows: spill.slice(0, 40).map(r => [r[0], r[1]]) };
    if (byPlayer) pendingPiles.push({ due: tickN + 100, x: dx, z: dz, rows: P.dpile.rows, life: 1400, own: PID });
    say(byPlayer
    ? (wasSkulled ? 'The skull takes its due: ' + (K - keep ? 'you clutch one thing; the rest' : 'everything you carried') + ' falls to your killer.'
                  : 'You keep your ' + (K - keep) + ' most valuable items; the rest falls to your killer.')
    : 'You keep your ' + (K - keep) + ' most valuable items; the rest lies where you fell — yours alone for a while, gone in 15 minutes.', 'bad');
  }
  P.skull = 0; pvpFoes.clear(); sendEquip();   // death lifts the skull and settles every grudge; the wire hears the bare corpse
  markDirty(2);
  setTimeout(() => {   // any death sends you to the nearest settlement — measured from the dungeon door if you fell below
    const rf = tpFrom(), v = nearestVillageTo(rf.x, rf.z, 12);
    let sx = P.home.x, sz = P.home.z;
    if (v) { const s = safeSpotIn(v); sx = s.x; sz = s.z; }
    teleport(sx, sz, 200);
    P.hp = P.maxhp = lvl[SK.hitpoints]; P.dead = 0; P.energy = 100; P.psn = 0; P.spec = 100; P.specArm = 0; P.souls = 0; pvpOn = 0; dirty.orb = 1;
    P.prayers = 0; P.pray = 0; bst.fill(0); drawPrayers(); drawStyles(); drawSk();   // you do not get up with the overheads still lit, quietly burning prayer on the walk back
    const where = v ? villageName(v) : 'where you started';
    say('You wake up in ' + where + '.');
    markDirty(2);
    refresh(); pump(80);
  }, 1500);
}

/* ---- 24. ACTIONS: one roll every four ticks; chance rises with level over the requirement and the tool ---- */
const ACT_TICKS = 4, MAGIC_RANGE = 10;
let devDmgMul = 1;   // dev console: multiplies damage the player deals
const devMul = d => devDmgMul === 1 || !(d > 0) ? d : Math.round(d * devDmgMul);
/* the gathering roll, one every ACT_TICKS. Calibrated against the wiki's own timings rather than a flat ramp: a beginner with a
   bronze axe fells a tree in about eight seconds (it used to take twenty-five), while the stubborn materials still resist —
   the divisor is the resistance, so yew at 99 with a dragon axe lands near the book's nine seconds and runite near thirteen. */
const rollChance = (l, req, tier) => clamp((0.30 + (l - req) * 0.0095 + tier * 0.035) / (1 + req / 60), 0.06, 0.92);
const gatherChance = (l, req, tier) => clamp((0.32 + (l - req) * 0.0085 + tier * 0.040) / (1 + req / 26), 0.05, 0.92);   // the material resists too
function deplete(o, ticks) {   // tickN is the shared clock, so the deadline needs no translation
  const due = tickN + ticks, cur = objIndex.get(o.key) || o;   // a chunk can be rebuilt mid-chop: unclaim the live object, not the caller's stale one
  depleted.set(o.key, due);
  hideInst(cur);
  if (cur.t === 0) unclaim(cur);
  netWorld([20, o.key, due]);
}
function hearDeplete(key, due) {
  if (!(due > tickN)) return;
  const cur = depleted.get(key);
  if (cur !== undefined && cur >= due) return;
  depleted.set(key, due);
  webCleared(key);   // a web slashed by someone else opens for us too
  const o = objIndex.get(key);
  if (!o) return;
  hideInst(o);
  if (o.t === 0) { unclaim(o); sfxAt(2734, o.x, o.z); }   // a neighbour's tree comes down within earshot
}
function respawnTick() {
  if (!depleted.size) return;
  for (const [k, t] of depleted) {
    if (t > tickN) continue;
    depleted.delete(k);
    const o = objIndex.get(k);
    if (!o) continue;
    if (o.t === 0) claim(o);
    if (!o.s7) showInst(o);   // under a 2007 overlay the instance stays down; loc7Frame redresses the mesh next frame
  }
}
function startTask(o, kind) {
  if (P.afloat && kind !== 'fish' && kind !== 'attack') { say("You can't do that from a boat.", 'bad'); return; }
  P.goal = null;
  P.task = { k: kind, o };
  if (kind !== 'attack') P.actT = 0;   // P.atkT, the swing deadline, carries across retargets on its own, as in 2007
}
const fail = msg => { say(msg, 'bad'); P.task = null; };
const needLv = (sk, lv) => { if (lvl[SK[sk]] < lv) { fail('You need ' + skName(SK[sk]) + ' level ' + lv + ' for this.'); return 1; } return 0; };
/* the mask, the salve and the void: flat amplifiers the 2007 way — the best mask effect (never stacked), times the set */
const slayMask = () => eq.head === 'black_mask' || eq.head === 'slayer_helmet';
const voidSet = k => eq.head === 'void_' + k + '_helm' && eq.body === 'void_knight_top' && eq.legs === 'void_knight_robe' && eq.hands === 'void_knight_gloves';
/* ---- ANCIENT MAGICKS: the element's rider, applied AFTER the damage roll — unlike a curse these do both.
   Smoke poisons on a 1/8 hit; shadow drains Attack once and never stacks down to nothing; blood leeches a quarter of
   the damage even when the target could not take it; ice freezes, then leaves 5 ticks of immunity behind it. Burst and
   barrage repeat the whole roll against everything in the wiki's 3x3 around the primary target, each rolled its own. */
function ancientHit(o, sp, dmg) {
  const f = sp.fx, amp = eq.weapon === 'ancient_sceptre' ? 1.1 : 1;   // the sceptre deepens every ancient secondary by a tenth
  if (f.lch && dmg > 0) { const h = Math.max(1, Math.round(dmg * (f.lch + barkN('bloodbark') * 0.02))); P.hp = Math.min(P.maxhp + 0, P.hp + h); dirty.orb = 1; healthBar(P); }   // bloodbark pays 2% a piece, 35% entire
  if (!o.npc || o.dead) return;
  if (f.psn && dmg > 0 && Math.random() < 0.125 * amp && !o.psn) { o.psn = f.psn === 20 ? 4 : 2; o.psnN = 0; o.psnT = tickN + 30; }
  if (f.atk && dmg > 0 && !(o.atkDr > tickN)) { o.atkDr = tickN + 100; o.atkDrM = 1 - f.atk * amp; say('Your spell saps the ' + o.name + "'s attack."); }   // one drain at a time: the wiki says it will not apply to an already-drained target
  if (f.frz && dmg > 0 && !(o.heldT > tickN) && !(o.frzImm > tickN)) {
    const t = Math.round(f.frz * amp) + barkN('swampbark') * 2;   // swampbark adds two ticks a piece, six for helm, body and legs
    o.heldT = tickN + t; o.frzImm = tickN + t + 5;   // 5 ticks of immunity once it thaws
    o.dest = null; say('Your spell freezes the ' + o.name + ' in place!');
  }
}
function ancientFx(o, sp, dmg) {
  ancientHit(o, sp, dmg);
  if (!sp.fx.aoe) return;
   // the 3x3 around the primary target, each victim rolled on its own accuracy exactly as the wiki describes
  const r = sp.fx.aoe, ml0 = Math.floor(eff('magic') * prayerMul('mag')) + 8;
  for (const q of npcs) {
    if (q === o || q.dead || chebDist(q.tx, q.tz, o.tx, o.tz) > r) continue;
    const d2 = devMul(roll(hitChance(ml0 * (voidSet('mage') ? 1.45 : 1), bonus('mag'), q.t.mag + 9, q.t.mdb), mdmgMax(sp.max)));
    castFx(q, sp, d2);
    q.hp -= d2; healthBar(q);
    ancientHit(q, sp, d2);
    if (q.hp <= 0) killNpc(q); else if (!q.target) { q.target = P; if (q.key && q.owner !== PID) { q.owner = PID; claimMon(q); } }
  }
}
/* the venator arrow does not stop at the first mark: it carries to a second and a third within five tiles,
   each for two thirds of the wound before it, and never doubles back on one it has already struck */
function venatorBounce(o, dmg) {
  let d = dmg, prev = o;
  const hit = new Set([o]);
  for (let i = 0; i < 2; i++) {
    d = Math.floor(d * 2 / 3); if (d <= 0) return;
    const q = npcs.find(n => !hit.has(n) && !n.dead && chebDist(n.tx, n.tz, prev.tx, prev.tz) <= 5);
    if (!q) return;
    hit.add(q); shootArrow(prev, q, d, ammoTint());
    q.hp -= d; hitsplat(q.rx, q.ry + 1.5, q.rz, d); healthBar(q);
    if (q.hp <= 0) killNpc(q); else if (!q.target) { q.target = P; if (q.key && q.owner !== PID) { q.owner = PID; claimMon(q); } }
    prev = q;
  }
}
const meleeAmp = o => (slayMask() && onTask(o) ? 7 / 6 : eq.neck === 'salve_amulet' && o.npc && (o.t.base || o.t).undead ? 7 / 6 : 1) * (voidSet('melee') ? 1.1 : 1);
/* one swing at o (a monster or another player): ranged, a readied spell, or melee; returns the damage dealt, or -1 when nothing was thrown */
function swing(o) {
  const sp = P.spell !== null ? SPELLS[P.spell] : null;
  const ps = !sp && pstaffOn() ? { k: 'trident', xp: 0, max: pstaffMax(), tint: weaponIt().ptint || 0x35c8b8 } : null;
  const rng = sp || ps ? 0 : bowRange();
  P.acting = 1; P.actSpan = sp ? castTicks(sp) : atkSpeed();
  P.pose = sp || ps ? 2 : rng ? 1 : stabbing() ? 4 : 0;
  if (tickN < P.atkT) return -1;   // the clock runs whether or not you are swinging, so a fresh fight opens at once
  P.atkT = tickN + P.actSpan;
   /* The arm survived weapon swaps, deaths and an emptied bar: a dagger armed and then swapped for a two-hander fired
      the two-hander's spec for nothing. Judge it once, here, against the weapon actually held. */
  let arm = null;
  if (P.specArm) {
    const sa = SPEC[eq.weapon];
    if (sa && !sa.fx && P.spec >= sa.cost && (!sa.souls || P.souls > 0)) arm = sa;   // the axe's Behead costs no energy, only souls
    else { P.specArm = 0; drawStyles(); }
  }
  P.swingPhase = 0;   // the blow starts the animation: the bolt or the spell leaves on its first frame
  const [dl, db] = o.npc ? [Math.max(0, o.t.def * (o.defDr > tickN ? 0.95 : 1) * (o.specDr || 1) - (o.defCut || 0)) + 9, o.t.db] : remoteDef(o);
  let dmg, xps = null;
  if (rng) {
    const st = RSTYLES[P.rstyle], spc = arm && arm.rng ? arm : null;
    const rv = voidSet('ranger') ? 1.1 : 1;   // the wiki's 10% ranged accuracy and damage
    let ta = 1, td = 1;   // the twisted bow reads the target's Magic; the dhcb bites dragonkind (wiki curves)
    if (o.npc && eq.weapon === 'twisted_bow') { const m = Math.min(250, o.t.mag); ta = Math.min(1.4, (140 + (3 * m - 10) / 100 - Math.pow(3 * m / 10 - 100, 2) / 100) / 100); td = Math.min(2.5, (250 + (3 * m - 14) / 100 - Math.pow(3 * m / 10 - 140, 2) / 100) / 100); }
    if (o.npc && eq.weapon === 'dragon_hunter_crossbow' && o.t.fire) { ta *= 1.3; td *= 1.25; }
    const bw0 = bowItem();   // Craw's and the webweaver bite half again harder at anything met in the Wilderness
    if (bw0 && bw0.wild && o.npc && wildLvAt(P.tx, P.tz) > 0) { ta *= bw0.wild; td *= bw0.wild; }
    const dr = spc && spc.ddmg && eq.ammo === 'dragon_arrow', mn = spc ? (dr ? spc.dmin : spc.min || 0) : 0;   // the dark bow's floors, deeper on dragon arrows
    const ch = hitChance((Math.floor(eff('ranged') * prayerMul('rng')) + st.acc + 8) * (spc && spc.acc || 1) * rv * ta, bonus('rat'), dl, db);
   // the msb snapshot takes the arrow's strength alone and no prayer, the wiki's own formula; the dark bow's dragon cap is 48 an arrow
    const M = spc && spc.msb ? maxFrom(eff('ranged') + 2, (eq.ammo && ITEMS[eq.ammo].rst) || 0)
      : Math.min(dr ? 48 : 1e9, Math.floor(rangedMax() * (spc ? (dr ? spc.ddmg : spc.dmg || 1) : 1) * rv * td));
    if (spc) { P.specArm = 0; P.spec = Math.max(0, P.spec - spc.cost); drawStyles(); }
    dmg = 0;
    for (let h = 0, hn = spc && spc.n || 1; h < hn; h++) { dmg += Math.max(roll(ch, M), mn); if (h && P.ammoN > 0) spendArrow(o); }
    dmg = devMul(boltProc(o, dmg, ch, M));   // enchanted bolts have their say
    if (spc && spc.heal && dmg > 0) { P.hp = Math.min(P.maxhp, P.hp + Math.floor(dmg * spc.heal)); dirty.orb = 1; }   // the blowpipe drinks
    const bw = bowItem();   // an envenomed launcher bites one time in four, and its venom deepens
    if (dmg > 0 && o.npc && bw && bw.psn && !o.psn && Math.random() < 0.25) { o.psn = bw.psn; o.venomF = bw.venom || 0; o.psnN = 0; o.psnT = tickN + 30; say('Venom rides your dart into the ' + o.name + '.'); }
    if (bw0 && bw0.bounce && dmg > 0 && o.npc) venatorBounce(o, dmg);   // the venator arrow carries on
    shootArrow(P, o, dmg, ammoTint());
    sfx(bowSnd());
    wsSend([19, o.tx, o.tz, ammoTint()]);
    spendArrow(o);
    xps = st.xp;
  } else if (sp || ps) {
    if (sp) {
      if (eff('magic') < sp.lv) { say('You need Magic level ' + sp.lv + ' to cast that.', 'bad'); P.spell = null; drawSpells(); return -1; }
      if (sp.undead && !(o.npc && (o.t.base || o.t).undead)) { say('That spell only crumbles the risen dead.', 'bad'); P.spell = null; drawSpells(); return -1; }
      if (sp.drain === 'hold' && !o.npc) { say('The spell cannot root another adventurer.', 'bad'); P.spell = null; drawSpells(); return -1; }   // no wire field carries a hold
      if (!spellReady(sp)) { say('You do not have the runes for that spell.', 'bad'); P.spell = null; drawSpells(); return -1; }
      spendRunes(sp);
    }
    if (sp && sp.drain) {   // a curse rolls magic accuracy like any spell, holds for a minute, then the staff comes down
      dmg = 0; castFx(o, sp, null); sfx(spellSnd(sp));
      const [cl, cb] = o.npc ? [o.t.mag * 1 + 9, o.t.mdb] : [dl, db];
      if (Math.random() < hitChance(Math.floor(eff('magic') * prayerMul('mag')) + 8, magAtk(), cl, cb)) {
        sfx(sp.hold ? 203 : 221);
        if (sp.hold) { o.heldT = tickN + sp.hold + barkN('swampbark') * 2; say('Your spell roots the ' + o.name + ' to the ground!'); }
        else { o[sp.drain + 'Dr'] = tickN + 100; say('Your spell weakens the ' + o.name + '.'); }
      }
      else { sfx(227); say('Your spell splashes off the ' + o.name + '.'); }
      gainXp('magic', sp.xp); P.spell = null;
    }
    else {
   // gear buys accuracy, and mdmg gear a share of damage; a monster defends a spell with its Magic level and magic defence bonus
      const spl = sp || ps, msp = arm && arm.mag ? arm : null;   // the Nightmare orbs spec through the spell you have armed
      const rg = eq.ring && ITEMS[eq.ring];
      const [ml, mb0] = o.npc ? [o.t.mag * (o.defDr > tickN ? 0.95 : 1) + 9, o.t.mdb] : [dl, db];
      const mb = rg && rg.mpierce && Math.random() < 0.25 ? mb0 * 0.9 : mb0;   // the brimstone ring ignores a tenth of the guard, one cast in four
      if (msp) { P.specArm = 0; P.spec = Math.max(0, P.spec - msp.cost); drawStyles(); }
      dmg = devMul(roll(hitChance((Math.floor(eff('magic') * prayerMul('mag')) + 8) * (voidSet('mage') ? 1.45 : 1) * (msp && msp.acc || 1), magAtk(), ml, mb), mdmgMax(msp && msp.max || spl.max))); castFx(o, spl, dmg); sfx(spellSnd(spl));   // the wiki's 45% void magic accuracy
      const wst = weaponIt();   // the sanguinesti drinks one hit in five; the eldritch pours the wound back into prayer
      if (ps && wst && wst.sang && dmg > 0 && Math.random() < 0.2) { dmg += 8; P.hp = Math.min(P.maxhp, P.hp + (dmg >> 1)); dirty.orb = 1; say('The staff drinks deep.', 'lv'); }
      if (msp && msp.pheal && dmg > 0) { P.pray = Math.min(P.maxpray, P.pray + Math.min(120, Math.floor(dmg * msp.pheal))); dirty.orb = 1; }
      if (dmg > 0 && o.npc && barrowsSet('ahrim') && Math.random() < 0.25) { o.strDr = tickN + 100; say("Ahrim's curse saps its strength."); }
      if (sp && sp.fx) ancientFx(o, sp, dmg);
      if (P.cstyle) { gainXp('magic', spl.xp + dmg * 4 / 3); if (dmg > 0) gainXp('defence', dmg); }   // defensive casting splits the 2007 way
      else gainXp('magic', spl.xp + dmg * 2);
    }
    if (sp) { wsSend([18, sp.i, o.tx, o.tz]); drawSpells(); }   // observers cannot see a bolt they were never told about
    else wsSend([19, o.tx, o.tz, ps.tint]);   // a trident's bolt rides the arrow op, teal
  } else {
    const st = STYLES[P.style], spc = arm && !arm.rng && !arm.mag ? arm : null, wp0 = weaponIt();
    let bm = meleeAmp(o);   // the mask on assignment, the salve on the risen dead, the void as a set
    if (setOn('inquisitors_')) bm *= 1.025;   // the wiki's full-set 2.5%; its crush-only clause has no counterpart in a one-scalar attack
    if (wp0 && wp0.dbane && o.npc && o.t.fire) bm *= 1.2;   // the lance's dragonbane: the wiki's 20% on both axes
    const soulN = spc && spc.souls ? P.souls : 0;   // Behead spends every soul at once: 12% accuracy and 6% damage each
    const aEff = (Math.floor(eff('attack') * prayerMul('atk')) + st.acc + 8) * (spc && spc.acc || 1) * (1 + soulN * 0.12) * bm;
    if (spc) {
      P.specArm = 0; P.spec = Math.max(0, P.spec - spc.cost);
      const M = Math.floor(maxHit() * (spc.dmg !== undefined ? spc.dmg : 1) * bm), ch = hitChance(aEff, bonus('atk'), dl, db);
      dmg = 0;
      if (spc.claws) {   // slice and dice: four rolls, the first that lands sets the wiki's cascade (4-2-1-1 / 0-4-2-2 / 0-0-3-3 / 0-0-0-5)
        if (Math.random() < ch) { const h1 = randInt(Math.max(1, M >> 1), Math.max(1, M - 1)); dmg = h1 + (h1 >> 1) + (h1 >> 2) + ((h1 >> 2) + 1); }
        else if (Math.random() < ch) { const h2 = randInt(Math.max(1, Math.floor(M * 3 / 8)), Math.max(1, Math.floor(M * 7 / 8))); dmg = h2 + (h2 >> 1) + ((h2 >> 1) + 1); }
        else if (Math.random() < ch) { const h3 = randInt(Math.max(1, M >> 2), Math.max(1, Math.floor(M * 3 / 4))); dmg = h3 * 2 + 1; }
        else if (Math.random() < ch) { dmg = randInt(Math.max(1, M >> 2), Math.max(1, Math.floor(M * 5 / 4))); }
        else if (Math.random() < 2 / 3) dmg = 2;
      } else {
        const lo = spc.minFrac ? Math.ceil(M * spc.minFrac) : 0;   // Disrupt keeps half the melee maximum as its floor
        for (let h = 0, hn = spc.n || 1; h < hn; h++) {
          const land = spc.sure || Math.random() < ch || (wp0 && wp0.fang && Math.random() < ch);   // the fang rolls twice on its special as well
          dmg += land ? Math.max(spc.min || 0, randInt(lo, M)) : 0;   // the floor rides a landed hit; a missed roll adds nothing
        }
      }
      if (spc.big2 && o.npc && o.t.big) dmg += roll(hitChance(aEff * 0.75, bonus('atk'), dl, db), M);   // the halberd sweeps large prey a second time
      if (spc.drainDef && dmg > 0 && o.npc) o.specDr = (o.specDr || 1) * spc.drainDef;
      if (spc.drainFlat && dmg > 0 && o.npc) o.defCut = (o.defCut || 0) + dmg;   // the bgs caves in Defence by the wound it deals
      if (spc.stun && o.npc) { o.cd = Math.max(o.cd, spc.stun); say('You shove the ' + o.name + ' back!'); }
      if (spc.bonus && dmg > 0) { dmg += randInt(spc.bonus[0], spc.bonus[1]); say("Saradomin's lightning strikes!", 'lv'); }
      if (spc.quick) P.atkT = tickN + 1;   // the maul comes around again at once
      if (spc.souls) {   // Behead: the floor rises to three tenths of a swollen maximum, and the axe empties
        const M2 = Math.floor(M * (1 + soulN * 0.06));
        dmg = Math.random() < hitChance(aEff, bonus('atk'), dl, db) ? randInt(Math.ceil(M2 * 0.3), Math.max(1, M2)) : 0;
        P.souls = 0; say('The axe reaps ' + soulN + ' soul' + (soulN > 1 ? 's' : '') + '!', 'lv');
      }
      if (spc.heal && dmg > 0) {   // the Healing Blade drinks for body and soul
        P.hp = Math.min(P.maxhp, P.hp + Math.max(10, Math.floor(dmg * spc.heal)));
        if (spc.pheal) P.pray = Math.min(P.maxpray, P.pray + Math.max(5, Math.floor(dmg * spc.pheal)));
        dirty.orb = 1;
      }
      drawStyles();
    } else if (barrowsSet('verac') && Math.random() < 0.25) dmg = randInt(1, Math.floor(maxHit() * bm) + 1);   // Verac strikes through guard and prayer alike
    else {
      const ch = hitChance(aEff, bonus('atk'), dl, db), M = Math.floor(maxHit() * bm);
   // the fang rolls its accuracy twice and keeps to the middle of its range, 15% to 85%, exactly as the wiki describes
      dmg = wp0 && wp0.fang ? (Math.random() < ch || Math.random() < ch ? randInt(Math.ceil(M * 0.15), Math.max(1, Math.floor(M * 0.85))) : 0) : roll(ch, M);
      if (wp0 && wp0.big3 && o.npc && o.t.big) dmg += (roll(ch, M) >> 1) + (roll(ch, M) >> 2);   // the scythe passes through the big ones three times, at a half and a quarter
    }
    dmg = devMul(dmg);
    if (wp0 && wp0.souls && !spc && P.souls < 5 && P.hp > 8) { P.souls++; P.hp -= 8; dirty.orb = 1; healthBar(P); drawStyles(); }   // every swing feeds the axe a soul, and a little blood
    const nk0 = eq.neck && ITEMS[eq.neck];
    if (dmg > 0 && nk0 && nk0.bfury && Math.random() < 0.2) { P.hp = Math.min(P.maxhp, P.hp + Math.max(1, Math.round(dmg * 0.3))); dirty.orb = 1; healthBar(P); }   // the blood fury drinks a fifth of the time
    if (dmg > 0 && barrowsSet('guthan') && Math.random() < 0.25) { P.hp = Math.min(P.maxhp, P.hp + dmg); dirty.orb = 1; say("Guthan's spear drinks the wound."); }
    if (dmg > 0) { sfx(meleeSnd()); if (!o.npc) sfx(513, 0.9); } else parrySnd();
    const wp = ITEMS[eq.weapon];   // an envenomed blade bites one time in four; venom deepens instead of fading
    if (dmg > 0 && o.npc && wp && wp.psn && !o.psn && Math.random() < 0.25) { o.psn = wp.psn; o.venomF = wp.venom || 0; o.psnN = 0; o.psnT = tickN + 30; say('Your poison courses through the ' + o.name + '.'); }
    const hm0 = eq.head && ITEMS[eq.head];   // the serpentine helm spits venom of its own: the wiki's 1/6, a half behind an already-poisoned edge
    if (dmg > 0 && o.npc && hm0 && hm0.envenom && !o.psn && Math.random() < (wp && wp.psn ? 0.5 : 1 / 6)) { o.psn = 6; o.venomF = 1; o.psnN = 0; o.psnT = tickN + 30; say('The helm spits venom into the ' + o.name + '.'); }
    hitsplat(o.rx, o.ry + 1.5, o.rz, dmg);
    xps = st.xp;
  }
  if (dmg > 0) { if (xps) for (const k of xps) gainXp(k, dmg * 4 / xps.length); gainXp('hitpoints', dmg * 4 / 3); }
  return dmg;
}
/* gathering tables: chop and mine share one loop */
const GATHER = {
  chop: { list: TREES, sk: 'woodcutting', need: 'You need an axe to chop this.', got: 'You get some ', yield: 'log' },
  mine: { list: ORES, sk: 'mining', need: 'You need a pickaxe to mine this.', got: 'You manage to mine some ', yield: 'ore' }
};
function taskTick() {
  P.acting = 0;   // latches for the whole tick
  const t = P.task; if (!t || P.stun > 0) return;
  const o = t.o;
  if (o) {
    if (o.dead || (o.key !== undefined && depleted.has(o.key) && t.k !== 'cook' && t.k !== 'make') || (o.npc && !o.mesh.parent) || (o.remote && !remotes.has(o.pid))) { P.task = null; return; }
    const ox = (o.npc || o.remote) ? o.tx : o.x, oz = (o.npc || o.remote) ? o.tz : o.z;
   // reach: a spell ten tiles, a bow its range, melee one tile — or the bulk of the thing for the big ones, or a halberd's two
    const reach = t.k !== 'attack' ? (t.reach || 1) : P.spell !== null ? MAGIC_RANGE : pstaffOn() ? 7 : bowRange() || Math.max((eq.weapon && ITEMS[eq.weapon].reach) || 1, o.npc ? npcReach(o.t) : 1);   // a powered staff reaches the wiki's seven
   /* In range but round a corner: 2007 walks in until it can see. The goal is the closest ring OUTSIDE the thing's own
       footprint — asking for cheb 1 of a big monster's centre names only tiles inside its own claims, which findPath can
       never reach, and the old give-up branch was dead code, so that combination simply froze the character. */
    const edge = o.npc ? npcFp(o.t) + 1 : 1;
    const gap = chebDist(P.tx, P.tz, ox, oz);
    const blind = reach > 1 && gap <= reach && gap > edge && !hasLos(P.tx, P.tz, ox, oz);
    if (blind || gap > reach) {
      if (!P.path.length) {
        const p = findPath(P.tx, P.tz, ox, oz, blind ? edge : reach);
        if (!p) { say(blind ? 'You have no line of sight to that.' : "You can't reach that.", 'bad'); P.task = null; return; }
        if (!p.length) return;
        P.path = p;
      }
      return;
    }
    P.path.length = 0;
    P.faceT = Math.atan2(ox - P.tx, oz - P.tz);
  }
  if (t.k === 'make') {   // one go every few ticks until the pack runs out
    P.acting = 1; P.actSpan = 2; P.pose = 0;
    if (--P.actT > 0) return;
    P.actT = t.r.tk || 3;
    if (!craft(t.r) || !mkOk(t.r)) P.task = null;
    return;
  }
  if (t.k === 'take') {
    if (t.all) for (const d of drops.filter(d => Math.abs(d.x - o.x) <= 1 && Math.abs(d.z - o.z) <= 1)) takeDrop(d); else takeDrop(o);
    P.task = null; return;
  }
  if (t.k === 'ui') { P.task = null; t.fn(o); return; }
  if (t.k === 'attack') {
    healthBar(P);
    if (o.remote) {
      healthBar(o, 2.0);
   // each client owns its own hitpoints: we roll with our stats and send it; open ground ends a fight mid-chase
      const why = pvpGate(o);
      if (why) return fail(why);
      const dmg = swing(o);
      if (dmg < 0) return;   // the swing timer refused it: nothing was thrown, so nothing is marked
      if (!((pvpFoes.get(o.pid) || 0) > tickN)) skullUp();   // striking anyone but a standing aggressor marks you, and re-marks you every swing
      wsSend([11, o.pid, dmg, prayHas('smite') ? 1 : 0, P.spell !== null || pstaffOn() ? 'g' : bowRange() ? 'r' : 'm']);   // extra elements are ignored by older builds; the class lets their overhead answer
      return;
    }
    if (o.owner && o.owner !== PID) return fail('Someone else is fighting that.');
    const bt = o.t.base || o.t;   // some monsters answer only to trained slayers, as in 2007
    if (bt.slayLv && lvl[SK.slayer] < bt.slayLv) return fail('You need Slayer level ' + bt.slayLv + ' to harm the ' + o.name + '.');
    if (o.key && o.owner !== PID) { o.owner = PID; claimMon(o); }
    if (o.t.boss) { if (!o.caT0) o.caT0 = tickN; o.caSt = (o.caSt || 0) | (P.spell !== null ? 4 : bowRange() ? 2 : 1); }   // the feat ledger watches the style and the clock
    const dmg = swing(o);
    if (dmg < 0) return;
    o.hp -= dmg;
    if (P.pose === 0 || P.pose === 4) healthBar(o);   // a bolt draws the bar when it lands
    if (o.hp <= 0) killNpc(o); else o.target = P;
    return;
  }
  P.acting = 1; P.actSpan = 2; P.pose = t.k === 'pray' ? 3 : 0;   // gathering swings twice per roll
  if (--P.actT > 0) return;
  P.actT = ACT_TICKS;
  if (t.k === 'pray') {
    const bi = inv.findIndex(s => s && ITEMS[s.id].bury);
    if (bi < 0) {
      if (P.pray < P.maxpray) { P.pray = P.maxpray; dirty.orb = 1; sfx(2674); say('You kneel at the altar, and your prayer is restored.'); } else say('You have no bones to offer.');
      P.task = null; return;
    }
    const id = inv[bi].id;
    invRemove(id, 1); sfx(2738);
    gainXp('prayer', ITEMS[id].bury * (o && o.pm ? o.pm() : 2));   // village altars double; a house chapel pays its wiki multiplier, burners counted
    diaryBump('bones', 0, P.tx, P.tz, 1);
    P.maxpray = lvl[SK.prayer]; P.pray = Math.min(P.maxpray, P.pray + 2); dirty.orb = 1;
    say('You offer the bones at the altar.');
  } else if (GATHER[t.k]) {
    const G = GATHER[t.k], R = G.list[o.k], tool = bestTool(G.sk);
    if (!tool) return fail(G.need);
    if (needLv(G.sk, R.lv)) return;
    sfx(t.k === 'chop' ? 3037 + randInt(0, 5) : R.k === 'essence' ? 2926 : 3220 + randInt(0, 5), 0.7);   // one swing of the tool per roll
    if (Math.random() < gatherChance(lvl[SK[G.sk]], R.lv, tool.tier)) {
      const id = R.k === 'essence' && lvl[SK.mining] >= 30 ? 'pure_essence' : R[G.yield];
      if (!invAdd(id, 1)) { dropItem(id, 1, P.tx, P.tz); say('Your pack is full; the ' + ITEMS[id].name.toLowerCase() + ' falls at your feet.'); }
      else say(G.got + ITEMS[id].name.toLowerCase() + '.');
      diaryBump(t.k, o.k, o.x, o.z, 1);
      gainXp(G.sk, R.xp);
      if (t.k === 'mine') sfx(3600, 0.9);
      else if (Math.random() < (capeOn('woodcutting') ? 1.1 : 1) / 256) { const nid = Math.random() < 0.5 ? 'egg' : rollTable(SEED_SUB)[0]; dropItem(nid, 1, P.tx, P.tz); sfx(1516); say("A bird's nest falls out of the tree!", 'lv'); }   // the woodcutting cape shakes a tenth more nests loose
      if (t.k === 'mine' && R.rs && Math.random() < 1 / 256 && invFree()) { const g = rollTable(GEM_T)[0]; invAdd(g, 1); say('You find an ' + ITEMS[g].name.toLowerCase() + '!', 'lv'); }
      if (t.k === 'mine' && capeOn('mining') && R.lv <= 70 && R.k !== 'essence' && Math.random() < 0.05) invAdd(id, 1);   // the mining cape's spare ore, up to adamantite, no xp
      if (R.rs && (t.k !== 'chop' || !R.i || Math.random() < 0.125)) { if (t.k === 'chop') sfx(2734); deplete(o, R.rs); P.task = null; }   // oaks and up fall one log in eight
    }
  } else if (t.k === 'fish') {
   // every qualifying fish rolls its own chance, best first, so shrimp still turn up beside the trout;
   // the fly fish (trout, salmon) each spend a feather, as ever
    const flies = invCount('feather') > 0;
    const pool = FISH.filter(f => f.deep === o.k && lvl[SK.fishing] >= f.lv && (flies || (f.k !== 'trout' && f.k !== 'salmon')));
    if (!pool.length) return fail('You need a higher Fishing level to fish here.');
    if (!o.k && invCount('small_net') + invCount('fishing_rod') === 0) return fail('You need a small net or a fishing rod.');
    if (o.k && !invCount('harpoon')) return fail('You need a harpoon to fish these waters.');
    sfx(o.k ? 4960 : invCount('small_net') ? 2603 : 2600, 0.7);
    let f = null;
    for (let i = pool.length - 1; i >= 0 && !f; i--) if (Math.random() < rollChance(lvl[SK.fishing], pool[i].lv, 2)) f = pool[i];
    if (f) {
      if (!invAdd(f.raw, 1)) { dropItem(f.raw, 1, P.tx, P.tz); say('Your pack is full; the ' + f.n.toLowerCase() + ' flops at your feet.'); }
      else say('You catch a ' + f.n.toLowerCase() + '.');
      sfx(2148, 0.8);
      if (f.k === 'trout' || f.k === 'salmon') invRemove('feather', 1);
      diaryBump('fish', f.k, P.tx, P.tz, 1);
      gainXp('fishing', f.xp);
      if ((hash2(P.tx, tickN, S) & 7) === 0) deplete(o, 14);   // spots move on
    }
  } else if (TASKS[t.k]) TASKS[t.k](t, o);
  else if (t.k === 'cook') {
    const raw = (t.raw && COOK.find(f => f.raw === t.raw && invCount(f.raw) > 0)) || COOK.find(f => invCount(f.raw) > 0);
    if (!raw) { say('You have nothing left to cook.'); P.task = null; return; }
    if (lvl[SK.cooking] < raw.cookLv) return fail('You need Cooking level ' + raw.cookLv + ' to cook that.');
   // each food has its own stop-burning level, the wiki's own figure for an open fire; a range is two levels kinder. The risk slides down to it from ~55%
    const stop = (raw.stop || raw.cookLv + 34) - (o.t === 6 ? 2 : 0);
    const burnt = !capeOn('cooking') && Math.random() < (lvl[SK.cooking] >= stop ? 0 : clamp(0.55 * (stop - lvl[SK.cooking]) / Math.max(1, stop - raw.cookLv), 0, 0.55));   // the cooking cape never burns
    if (!invSwap(burnt ? 'burnt_' + raw.k : raw.done, 1, raw.raw, 1)) return fail(FULL);
    if (burnt) say('You accidentally burn the ' + raw.n.toLowerCase() + '.', 'bad');
    else { say('You cook the ' + raw.n.toLowerCase() + '.'); gainXp('cooking', raw.cook); }
  }
}
function lightLogs(id) {
  if (P.afloat) return say("You can't light a fire on the water.", 'bad');
  const it = ITEMS[id];
  if (!invCount('tinderbox')) return say('You need a tinderbox to light that.', 'bad');
  if (lvl[SK.firemaking] < it.fireLv) return say('You need Firemaking level ' + it.fireLv + ' to burn these.', 'bad');
  if (fires.some(f => f.x === P.tx && f.z === P.tz)) return say('There is already a fire here.', 'bad');
  invRemove(id, 1); sfx(2599);
  lightFire(P.tx, P.tz);
  gainXp('firemaking', it.fire);
  say('The fire catches and the logs begin to burn.');
  P.task = null;
}
/* the recipe rows at a fixture (an object type, or 'tan'), optionally only those using one item; long lists keep to the inputs you carry */
function openMake(at, o, only) {
  let rows = RECIPES.filter(r => r.at === at && (!only || usesItem(r, only)));
  if (rows.length > 20) rows = rows.filter(r => r.need.every(([id]) => invCount(id)));
  if (rows.length) showMake(o.n, rows, o); else say('You have nothing to make here.');
}
function startMake(r, o) {
  if (!mkOk(r)) return say('You need ' + mkWhy(r) + ' for that.', 'bad');
  P.goal = null; P.task = { k: 'make', r, o: o || null }; P.actT = 0;
}
/* one go at a recipe: inputs out, outputs in (refunded if the pack is full), xp unless the go was ruined */
function craft(r) {
  if (!mkOk(r)) return 0;   // the inputs can leave between ticks (a drop, a bank, a trade): never spend what is no longer there
  for (const [id, n] of r.need) { invRemove(id, n); if (id === 'coins') gpSunk += n; }
  const out = r.fn ? r.fn(r) : [[r.id, r.n]];
  if (out) for (const [id, n] of out) if (!invAdd(id, n)) { for (const [id2, n2] of r.need) { invAdd(id2, n2); if (id2 === 'coins') gpSunk -= n2; } fail(FULL); return 0; }
  if (out) { if (r.xp) gainXp(r.sk, r.xp); say(r.msg || 'You make ' + (out[0][1] > 1 ? out[0][1] + ' ' : 'a ') + ITEMS[out[0][0]].name.toLowerCase() + '.'); }
  if (out && P.task && P.task.k === 'make') { const sid = r.sk === 'fletching' ? 2605 : r.at === 4 ? 2722 : r.at === 3 ? (r.sk === 'smithing' ? 1061 : 2725) : 0; if (sid) sfx(sid, 0.9); }   // anvil rings, furnace roars, knife whittles
  if (out && r.at === 6 && r.sk === 'cooking') diaryBump('bake', 0, P.tx, P.tz, 1);
  return 1;
}
function bury(id) {
  invRemove(id, 1); sfx(2738);
  gainXp('prayer', ITEMS[id].bury);
  P.maxpray = lvl[SK.prayer];
  say('You dig a hole in the ground, and bury the bones.');
  dirty.orb = 1;
}
/* the anglerfish ladder: what it heals at each Hitpoints level, straight off the wiki */
const angHeal = () => { const L = lvl[SK.hitpoints];
  return L >= 93 ? 22 : L >= 90 ? 17 : L >= 80 ? 16 : L >= 75 ? 15 : L >= 70 ? 13 : L >= 60 ? 12 : L >= 50 ? 11 : L >= 40 ? 8 : L >= 30 ? 7 : L >= 25 ? 6 : L >= 20 ? 4 : 3; };
function eat(slotIdx) {
  const it = ITEMS[inv[slotIdx].id];
  if (it.blight && powerAt(P.tx, P.tz) < 1) return say('The blighted flesh only nourishes you in dangerous lands.', 'bad');   // the wilderness rule, in this world's terms
  const gate = it.combo ? 'foodT2' : 'foodT';   // a karambwan rides its own clock: it combos past ordinary food, as ever
  if (P[gate] > tickN) return;   // one bite per three ticks, and each bite delays the next swing; a full belly still eats, as ever
  P[gate] = tickN + 3; P.actT += 3; P.atkT = Math.max(P.atkT, tickN + 3);
  invRemove(inv[slotIdx].id, 1); sfx(2393);
  const heal = it.ang ? angHeal() : it.heal;
  P.hp = it.ang ? Math.min(P.maxhp + heal, P.hp + heal) : Math.min(P.maxhp, P.hp + heal);   // an anglerfish alone feeds past full, to max + its own heal
  if (it.boost) { potBoost(it.boost[0], it.boost[1], 0); dirty.sk = 1; }   // the pies carry their little blessings
  if (it.energy) { P.energy = Math.min(100, P.energy + it.energy); dirty.orb = 1; }
  dirty.orb = 1;
  say('You eat the ' + it.name.toLowerCase() + '. It heals some health.');
}
/* ---- 25. SHOPS, BANK, BARBER ---- */
let openShop = null, bankOpen = 0;
const img = id => '<img src="' + icon(id) + '" alt="">';
const mkRow = (attr, id, name, sub, extra, cls) => '<div class="mk' + (cls || '') + '" ' + attr + '>' + img(id) + '<span>' + name + '<u>' + sub + '</u></span>' + (extra || '') + '</div>';
const gridOf = rows => '<div class="grid">' + rows.join('') + '</div>';
/* paint the centred modal with the pack beside it */
function paintModal(title, html, foot) {
  modalTitle.textContent = title; modalBody.innerHTML = html; modalFoot.textContent = foot;
  modalEl.classList.add('on');
  showTab('inv');
}
function openBank() { clearUse(); P.uspell = null; openShop = null; bankOpen = 1; sfx(2021); say('The banker pulls out your vault book.'); drawBank(); }   // one counter at a time: with both open the pack deposited under a visible shop
let bankQ = '', bankMode = '1', bankX = 50;   // the 2007 quantity row: 1 / 5 / 10 / X / All drives both directions
const bankQty = () => bankMode === 'all' ? 1e9 : bankMode === 'x' ? bankX : +bankMode;
const bankQtyLbl = () => bankMode === 'all' ? 'all' : bankQty();
function drawBank() {   // the search box filters the grid in place, so typing never repaints the modal
  if (!bankOpen) return;
  const bq = (m, lbl) => '<button data-bq="' + m + '"' + (bankMode === m ? ' style="outline:2px solid var(--amber)"' : '') + '>' + lbl + '</button>';
  paintModal('Bank of Seedworld — ' + bank.length + '/' + BANK_N + ' slots',
    '<div class="wrow" style="margin-bottom:5px">' + bq('1', '1') + bq('5', '5') + bq('10', '10') + bq('x', 'X') +
    '<input id="bankXin" inputmode="numeric" value="' + bankX + '" aria-label="custom amount" style="width:52px">' + bq('all', 'All') + '</div>' +
    '<input id="bankQ" placeholder="search your vault…" autocomplete="off" spellcheck="false" style="width:100%;margin-bottom:5px"><div class="grid" id="bankGrid"></div>',
    'Click to withdraw ' + bankQtyLbl() + ', ALL for the stack. Click your pack to store ' + bankQtyLbl() + '.' +
    (!OFFLINE && saveBytes() > SAVE_WARN ? '  Your vault is near the limit of what can be stored — stack what you can.' : ''));
  const xin = el('bankXin');
  xin.oninput = () => { bankX = clamp(Math.floor(+xin.value) || 1, 1, 1e9); };
  const q = el('bankQ'), fill = () => { const f = bankQ.toLowerCase(); el('bankGrid').innerHTML = bank.map((s, i) => ITEMS[s.id].name.toLowerCase().includes(f)
    ? mkRow('data-wd="' + i + '"', s.id, ITEMS[s.id].name, fmt(s.n) + ' banked', '<b class="gp" data-wall="' + i + '">ALL</b>') : '').join('') || '<p style="opacity:.7">' + (bank.length ? 'Nothing matches.' : 'Your vault is empty.') + '</p>'; };
  q.value = bankQ; q.oninput = () => { bankQ = q.value; fill(); }; fill();
}
function bankDeposit(id, n) {
  n = Math.min(n, invCount(id)); if (n <= 0) return;
  if (!bankAdd(id, n)) return say(bank.length >= BANK_N
    ? 'Your vault has no room for another kind of item.'
    : 'Your vault cannot hold another kind of item — the ledger that records it is full. Stack or sell something first.', 'bad');
  invRemove(id, n); markDirty(); drawBank();
}
function bankWithdraw(bi, n) {
  const s = bank[bi]; if (!s) return;
  const got = invAdd(s.id, Math.min(n, s.n));
  if (!got) return say(FULL, 'bad');
  s.n -= got;
  if (s.n <= 0) bank.splice(bi, 1);
  markDirty(); drawBank();
}
/* the barber: swatches left, a turntable mannequin right (its own renderer, built once), paid for on Apply */
const BARBER_FEE = 10;
let barberOn = 0, barberSel = null, barberRAF = 0, barberCv = null, barberGL = null, barberScene = null, barberCam = null, barberRig = null;
function ensureBarberGL() {
  if (barberCv) return;
  barberCv = document.createElement('canvas'); barberCv.id = 'brbCv';
  barberGL = new THREE.WebGLRenderer({ canvas: barberCv, antialias: true, alpha: true });
  barberGL.setPixelRatio(Math.min(devicePixelRatio || 1, 2)); barberGL.setSize(168, 226);
  barberScene = new THREE.Scene();
  barberCam = new THREE.PerspectiveCamera(34, 168 / 226, 0.1, 30);
  barberCam.position.set(0, 1.35, 4.0); barberCam.lookAt(0, 1.02, 0);
  barberScene.add(barberRig = buildAvatar());
  let px = 0, down = 0;
  on(barberCv, 'pointerdown', e => { down = 1; px = e.clientX; try { barberCv.setPointerCapture(e.pointerId); } catch {} e.preventDefault(); });
  on(barberCv, 'pointermove', e => { if (down) { barberRig.rotation.y += (e.clientX - px) * 0.02; px = e.clientX; } });
  on(barberCv, 'pointerup pointercancel', () => { down = 0; });
}
function dressBarberRig() {
  const p = barberRig.parts, L = barberSel;
  setCol(SHIRTS[L.shirt], p.torso); setCol(SKINS[L.skin], p.armL, p.armR, p.head); setCol(LEGSC[L.legs], p.legL, p.legR, p.calfL, p.calfR);
  applyFace(p, L.face);
}
function barberFrame() { barberRAF = barberOn ? requestAnimationFrame(barberFrame) : 0; if (barberOn) barberGL.render(barberScene, barberCam); }
function openBarber() { clearUse(); say('The barber sizes you up.'); barberSel = Object.assign({}, P.look); drawBarber(); }
function drawBarber() {
  const sw = (arr, key, cur) => '<div class="swr">' + arr.map((c, i) => '<b class="swb' + (i === cur ? ' on' : '') + '" data-lk="' + key + ':' + i + '" style="background:' + c + '"></b>').join('') + '</div>';
  showModal('Barber', '<div class="brb"><div class="brbL"><p class="blab">Skin</p>' + sw(SKINS, 'skin', barberSel.skin) + '<p class="blab">Shirt</p>' + sw(SHIRTS, 'shirt', barberSel.shirt) +
    '<p class="blab">Trousers</p>' + sw(LEGSC, 'legs', barberSel.legs) + '<p class="blab">Face</p>' +
    gridOf(FACES.map((f, i) => '<div class="mk' + (i === barberSel.face ? ' fon' : '') + '" data-lk="face:' + i + '"><span>' + f.n + '</span></div>')) +
    '</div><div class="brbR" id="brbSlot"><p class="brbHint">drag to turn</p></div></div>' +
    '<div class="wrow2 brbFoot"><button id="brbOk">Apply — ' + BARBER_FEE + ' gp</button><button id="brbNo">Cancel</button></div>',
    'Nothing changes, and nothing is charged, until you Apply. Worn armour covers clothes until you take it off.');
  ensureBarberGL();
  el('brbSlot').prepend(barberCv);
  dressBarberRig();
  el('brbOk').onclick = barberApply; el('brbNo').onclick = closeOverlays;
  if (barberRAF) cancelAnimationFrame(barberRAF);
  barberOn = 1; barberFrame();
}
function barberApply() {
  const L = P.look, s = barberSel;
  if (s.skin === L.skin && s.shirt === L.shirt && s.legs === L.legs && s.face === L.face) { say('The barber finds nothing to change.'); closeOverlays(); return; }
  if (coins() < BARBER_FEE) return say('A restyle costs ' + BARBER_FEE + ' coins.', 'bad');
  invRemove('coins', BARBER_FEE);
  Object.assign(P.look, s);
  dressAvatar(); markDirty(2);
  say('The barber restyles you for ' + BARBER_FEE + ' coins.', 'good');
  closeOverlays();
}

/* ---- 25b. GRAND EXCHANGE: the order book lives on the worker; this side is an honest till (escrow leaves the pack first) ---- */
const GE_SLOTS_N = 8, GE_POLL = 10000;
let geSlots = null, geOpen = 0, geTimer = 0, geBusy = 0, geView = null;
const geOn = () => !OFFLINE && AUTH;
// is anything on the book still able to move? an unread book has to be read once
const geLive = () => !geSlots || geSlots.some(o => o && o.state === 0 && o.filled < o.qty);
async function geFetch() {
  const j = await api('/ge');
  if (j && j.slots) {
    if (geSlots) for (let i = 0; i < GE_SLOTS_N; i++) { const a = geSlots[i], b = j.slots[i]; if (a && b && a.state !== 1 && b.state === 1) { sfx(3925); break; } }   // an offer finished while we watched
    geSlots = j.slots; if (geOpen && !geView) drawGE();
  }
  return j;
}
const gePost = (path, body) => api(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
function openGE() {
  clearUse();
  if (!geOn()) return say('The exchange is closed to offline traders.', 'bad');
  geOpen = 1; geView = null;
  say('The clerk opens the ledger.');
  drawGE(); geFetch();   // the cached book at once, then the live one
  clearInterval(geTimer);
  /* Poll only while something could actually change. Every tick of this costs an
     authenticated round trip and two D1 queries, and a book of eight finished or
     empty slots will read the same forever. gePlace re-arms it by putting a live
     offer back in geSlots. */
  geTimer = setInterval(() => {
    if (!geOpen) return clearInterval(geTimer);
    if (document.hidden || !geLive()) return;
    geFetch();
  }, GE_POLL);
}
const geGuide = id => Math.max(1, ITEMS[id] ? ITEMS[id].val : 1);
const geTitle = () => 'Grand Exchange — ' + fmt(coins()) + ' gp';
function drawGE() {
  if (!geOpen) return;
  if (geView) return drawGEForm();
  const h = [];
  for (let i = 0; i < GE_SLOTS_N; i++) {
    const o = geSlots ? geSlots[i] : null;
    if (!o) {
      h.push('<div class="ges"><p class="gesEmpty">' + (geSlots ? 'Empty slot' : '…') + '</p>' +
        (geSlots ? '<div class="wrow2 gesBtns"><button data-genew="0:' + i + '">Buy</button><button data-genew="1:' + i + '">Sell</button></div>' : '') + '</div>');
      continue;
    }
    const it = ITEMS[o.item], nm = it ? it.name : o.item, done = o.state === 1, full = o.filled >= o.qty, boxes = [];
    if (o.items_box > 0) boxes.push(o.items_box + ' × ' + nm);
    if (o.coins_box > 0) boxes.push(fmt(o.coins_box) + ' gp');
    h.push('<div class="ges ' + (o.kind ? 'gsell' : 'gbuy') + '"><div class="gesHead">' + img(o.item) + '<span>' + (o.kind ? 'Sell' : 'Buy') + ' ' + nm +
      '<u>' + o.filled + ' / ' + o.qty + ' at ' + fmt(o.price) + ' gp each' + (done ? (full ? ' — complete' : ' — cancelled') : '') + '</u></span></div>' +
      '<div class="gebar"><s style="width:' + (o.qty ? Math.round(o.filled / o.qty * 100) : 0) + '%"></s></div><div class="wrow2 gesBtns">' +
      (boxes.length ? '<button data-gecol="' + i + '">Collect ' + boxes.join(' + ') + '</button>' : '') + (!done ? '<button data-geab="' + i + '">Abort</button>' : '') +
      (!boxes.length && done ? '<button data-gecol="' + i + '">Clear</button>' : '') + '</div></div>');
  }
  paintModal(geTitle(), gridOf(h), 'Offers stand across every world and complete while you are away. Collect the goods to free the slot.');
}
function gePickList() {
  const V = geView, buy = V.kind === 0, list = [];
  if (buy) {
    const q = (V.q || '').trim().toLowerCase();
    for (const id in ITEMS) { if (id === 'coins' || (q && ITEMS[id].name.toLowerCase().indexOf(q) < 0)) continue; list.push(id); if (list.length >= 36) break; }
  } else {
    const seen = new Set();
    for (let i = 0; i < INV_N; i++) if (inv[i] && inv[i].id !== 'coins' && !seen.has(inv[i].id)) { seen.add(inv[i].id); list.push(inv[i].id); }
  }
  if (!list.length) return '<p class="gesEmpty">' + (buy ? 'Nothing by that name.' : 'Nothing in your pack to sell.') + '</p>';
  return list.map(id => '<div class="di' + (V.item === id ? ' on' : '') + '" data-gepick="' + id + '">' + img(id) + '<span>' + ITEMS[id].name + '<u>' +
    (buy ? 'guide ' + fmt(geGuide(id)) + ' gp' : invCount(id) + ' held') + '</u></span></div>').join('');
}
const stopKeys = n => { if (n) n.onkeydown = e => e.stopPropagation(); return n; };
function drawGEForm() {
  const V = geView, buy = V.kind === 0;
  const h = ['<p class="blab">' + (buy ? 'Buy offer' : 'Sell offer') + ' — slot ' + (V.slot + 1) + '</p>'];
  if (buy) h.push('<div class="gerow"><input id="geq" placeholder="search all items" value=""></div>');
  h.push('<div class="gepick" id="gePickWrap">' + gePickList() + '</div>');
  if (V.item) {
    const held = invCount(V.item);
    if (V.qty === undefined) V.qty = buy ? 1 : held;
    if (V.price === undefined) V.price = geGuide(V.item);
    h.push('<div class="gerow"><label>Quantity</label><input id="geQty" type="number" min="1" value="' + V.qty + '">' + (buy ? '' : '<button data-gea="all">All ' + held + '</button>') + '</div>',
      '<div class="gerow"><label>Price each</label><input id="gePrice" type="number" min="1" value="' + V.price + '"><button data-gea="-5">-5%</button><button data-gea="g">Guide</button><button data-gea="+5">+5%</button></div>',
      '<p class="getot" id="geTot"></p>', '<div class="wrow2 brbFoot"><button id="geOk">' + (buy ? 'Place buy offer' : 'Place sell offer') + '</button><button id="geBack">Back</button></div>');
  } else h.push('<div class="wrow2 brbFoot"><button id="geBack">Back</button></div>');
  paintModal(geTitle(), h.join(''), buy ? 'Coins are taken when the offer is placed; a cheaper match refunds the difference to the slot.'
                                        : 'The goods are taken when the offer is placed; a higher standing bid pays its own price.');
  const qEl = stopKeys(el('geq'));
  if (qEl) { qEl.value = V.q || ''; qEl.oninput = () => { V.q = qEl.value; el('gePickWrap').innerHTML = gePickList(); }; }
  const upd = () => {
    V.qty = Math.max(1, Math.floor(+el('geQty').value || 0)); V.price = Math.max(1, Math.floor(+el('gePrice').value || 0));
    el('geTot').textContent = 'Total: ' + fmt(V.qty * V.price) + ' gp' + (buy ? ' — you have ' + fmt(coins()) + ' gp' : '');
  };
  for (const id of ['geQty', 'gePrice']) { const n = stopKeys(el(id)); if (n) n.oninput = upd; }
  if (V.item) upd();
  if (el('geOk')) el('geOk').onclick = gePlace;
  el('geBack').onclick = () => { geView = null; drawGE(); };
}
/* one request at a time; returns the reply or null */
async function geCall(path, body) { if (geBusy) return null; geBusy = 1; const j = await gePost(path, body); geBusy = 0; return j; }
/* one attempt, then one replay. The token makes the second call idempotent server-side, so a reply lost after the
   commit is answered with what the first call actually did instead of an emptied box or a busy slot. */
let geSeq = 0;
const geTok = () => (PID || 'off') + '-' + (++geSeq) + '-' + ((Math.random() * 4294967296) | 0).toString(36);
async function geTry(path, body) { const tok = geTok(); let j = await geCall(path, { ...body, tok }); if (!j || j.e) j = await geCall(path, { ...body, tok }); return j; }
async function gePlace() {
  const V = geView;
  if (!V || !V.item || geBusy) return;
  const qty = clamp(Math.floor(+el('geQty').value || 0), 1, 100000), price = clamp(Math.floor(+el('gePrice').value || 0), 1, 1e9), buy = V.kind === 0;
  if (buy && coins() < qty * price) return say('You need ' + fmt(qty * price) + ' coins for that offer.', 'bad');
  if (!buy && invCount(V.item) < qty) return say("You don't have that many.", 'bad');
  const escrow = buy ? ['coins', qty * price] : [V.item, qty];
  invRemove(escrow[0], escrow[1]); markDirty(2);   // the escrow leaves the pack before the book hears of the offer
  const j = await geTry('/ge/place', { slot: V.slot, kind: V.kind, item: V.item, price, qty });
  /* A refusal and a lost reply are not the same thing, and refunding on both
     duplicated the escrow whenever the offer had actually been placed — api()
     returns null on any thrown fetch, so a dropped response after the commit
     looked exactly like a rejection. Ask the book what really happened before
     giving anything back: a slot that now holds an offer is the answer. */
  if (!j || j.e || !j.offer) {
    const back = await geFetch();
   /* Silence is not a refusal. If the probe itself fails we know nothing, and refunding on that turned a lost reply
       into a duplicated escrow. And a slot that merely holds SOMETHING is not proof it holds OURS — an older offer
       standing there is a genuine 'slot in use' whose escrow has to come back. Match the offer exactly. */
    if (!back || !back.slots) return say('The exchange did not answer — your offer is unconfirmed. Open the exchange to check before placing it again.', 'bad');
    const live = back.slots[V.slot];
    if (live && live.kind === V.kind && live.item === V.item && live.price === price && live.qty === qty) {
      geSlots = back.slots; geView = null;
      say('The offer did reach the exchange — the reply was lost on the way back.', 'lv');
      if (geOpen) drawGE();
      return;
    }
    invAdd(escrow[0], escrow[1]); markDirty(2);
    return say('The exchange refused the offer' + (j && j.e ? ': ' + j.e + '.' : '.'), 'bad');
  }
  if (!geSlots) geSlots = new Array(GE_SLOTS_N).fill(null);
  geSlots[V.slot] = j.offer; geView = null;
  say('Offer placed: ' + (buy ? 'buy ' : 'sell ') + qty + ' × ' + ITEMS[V.item].name + ' at ' + fmt(price) + ' gp each.', 'good');
  if (geOpen) drawGE();
}
async function geAbort(i) {
  if (geBusy) return;
  const j = await geCall('/ge/abort', { slot: i });
  if (j && j.offer) { geSlots[i] = j.offer; say('Offer cancelled — collect what came back.'); }
  else if (j && j.e) say('Could not abort: ' + j.e + '.', 'bad');
  if (geOpen) drawGE();
}
async function geCollect(i) {
  const o = geSlots && geSlots[i];
  if (!o || geBusy) return;
  let free = invFree(), wantCoins = 0, wantItems = 0;   // ask only for what the pack can hold; the box keeps the rest
  if (o.coins_box > 0 && (invCount('coins') > 0 || free > 0)) { wantCoins = o.coins_box; if (invCount('coins') === 0) free--; }
  if (o.items_box > 0) {
    const it = ITEMS[o.item];
    if (it && it.stack) wantItems = (invCount(o.item) > 0 || free > 0) ? o.items_box : 0; else if (it) wantItems = Math.max(0, Math.min(o.items_box, free));
  }
  if (!wantCoins && !wantItems && (o.coins_box > 0 || o.items_box > 0)) return say('Your pack is too full to collect.', 'bad');
  const j = await geTry('/ge/collect', { slot: i, coins: wantCoins, items: wantItems });
  if (!j || j.e) return say('Could not collect' + (j && j.e ? ': ' + j.e + '.' : '.'), 'bad');
  /* The box has already been emptied server-side by the time this runs, so
     whatever invAdd cannot take is gone unless we catch it here. `free` was
     measured before the await and invAdd gives up silently when the pack has
     filled since — a tick of loot arriving mid-request was enough. Anything that
     will not fit goes to the ground at the player's feet rather than nowhere. */
  const spill = (id, want) => {
    if (want <= 0) return;
    const took = invAdd(id, want) | 0;
    if (took >= want) return;
    dropItem(id, want - took, P.tx, P.tz, 3000);
    say('Your pack was full — ' + fmt(want - took) + ' × ' + (ITEMS[id] ? ITEMS[id].name : id) + ' falls at your feet.', 'bad');
  };
  if (j.coins > 0) spill('coins', j.coins);
  const gotId = ITEMS[j.item] ? j.item : ITEMS[o.item] ? o.item : null;
  if (j.items > 0 && gotId) spill(gotId, j.items);
  else if (j.items > 0) say('The clerk holds ' + fmt(j.items) + ' of something this version no longer knows.', 'bad');
  markDirty(2);
  geSlots[i] = j.offer || null;
  const got = [];
  if (j.items > 0) got.push(j.items + ' × ' + (ITEMS[o.item] ? ITEMS[o.item].name : o.item));
  if (j.coins > 0) got.push(fmt(j.coins) + ' gp');
  if (got.length) { sfx(3924); say('You collect ' + got.join(' and ') + '.', 'good'); }
  if (geOpen) drawGE();
}
async function geGreet() {   // one probe on login: a sale that finished overnight is not a secret
  if (!geOn()) return;
  const j = await geFetch();
  if (j && j.slots && j.slots.some(o => o && (o.coins_box > 0 || o.items_box > 0))) { sfx(3925); say('The Grand Exchange holds goods for you to collect.', 'lv'); }
}
function shopBuy(id) {
  const it = ITEMS[id], price = buyPrice(it);
  const st = openShop && openShop.stock.find(q => q.id === id);
  if (!st || st.n < 1) return say('The shop has none of those left.', 'bad');   // the count was decorative, so every armoury was an unlimited faucet
  if (coins() < price) return say("You don't have enough coins.", 'bad');
  if (!invSwap(id, 1, 'coins', price)) return say(FULL, 'bad');   // a stackable with no stack and no free slot still needs room
  st.n--;
  gpSunk += price;
  say('You buy a ' + it.name.toLowerCase() + ' for ' + price + ' coins.');
  markDirty(1); drawShop();
}
function shopSell(slotIdx) {
  const s = inv[slotIdx]; if (!s || s.id === 'coins') return;
  const it = ITEMS[s.id], price = sellPrice(it);
  if (!invSwap('coins', price, s.id, 1)) return say(FULL, 'bad');
  const st = openShop && openShop.stock.find(q => q.id === s.id);
  if (st) st.n++; else if (openShop) openShop.stock.push({ id: s.id, n: 1 });   // what you sell them, they will sell back
  gpMade += price;
  say('You sell a ' + it.name.toLowerCase() + ' for ' + price + ' coins.');
  markDirty(1); drawShop();
}

/* ---- 26. UI ---- */
const el = id => document.getElementById(id);
const on = (t, evs, fn, o) => { for (const e of evs.split(' ')) t.addEventListener(e, fn, o); };
const fmt = n => n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(0) + 'k' : n | 0;
const chatEl = el('chat');
function trouble(playerText, devText) { say(playerText, 'bad'); if (devText) console.warn('[seedworld] ' + devText); }
function say(msg, cls) {
  const stick = chatEl.scrollTop + chatEl.clientHeight >= chatEl.scrollHeight - 14;   // follow the tail only if already there
  const d = document.createElement('div');
  d.className = cls || 'g'; d.textContent = msg;
  chatEl.appendChild(d);
  while (chatEl.childNodes.length > 120) chatEl.removeChild(chatEl.firstChild);
  if (stick) chatEl.scrollTop = chatEl.scrollHeight;
}
const div = (parent, cls, html) => { const d = document.createElement('div'); d.className = cls; if (html) d.innerHTML = html; parent.appendChild(d); return d; };
const invGrid = el('invGrid'), slotEls = [];
for (let i = 0; i < INV_N; i++) { const d = div(invGrid, 'slot'); d.dataset.i = i; slotEls.push(d); }
const stackLbl = n => n > 1 ? '<em>' + (n > 99999 ? fmt(n) : n) + '</em>' : '';
function drawInv() {
  dirty.inv = 0;
  if (useSel && (!inv[useSel.i] || inv[useSel.i].id !== useSel.id)) useSel = null;
  for (let i = 0; i < INV_N; i++) {
    const s = inv[i], e = slotEls[i], use = !!(useSel && useSel.i === i);
    e.classList.toggle('use', use);
    if (!s) { if (e.dataset.id) { e.innerHTML = ''; e.className = 'slot'; e.dataset.id = ''; } continue; }
    const sig = s.id + ':' + s.n;
    if (e.dataset.id === sig) continue;
    e.dataset.id = sig;
    e.className = 'slot has' + (use ? ' use' : '');
    e.innerHTML = img(s.id) + stackLbl(s.n);
  }
  if (openShop) drawShop();
  if (bankOpen) drawBank();
}
const eqWrap = el('eqWrap');
for (const s of EQ_LAY) { const d = div(eqWrap, 'eqslot'); if (!s) d.style.visibility = 'hidden'; else { d.dataset.s = s; d.innerHTML = '<span>' + s + '</span>'; } }
function drawEq() {
  dirty.eq = 0;
  for (const d of eqWrap.children) {
    const s = d.dataset.s; if (!s) continue;
    const id = eq[s];
    d.className = 'eqslot' + (id ? ' f' : '');
    d.innerHTML = (id ? img(id) : '') + '<span>' + s + '</span>' + (s === 'ammo' && id ? '<em>' + P.ammoN + '</em>' : '');
  }
  if (statsOpen) showStats();
}
let statsOpen = 0;
const stRow = (n, v) => '<div class="stRow"><i>' + n + '</i><b>' + v + '</b></div>';
function showStats() {   // the full ledger: bonuses, worn pieces and the levels that come of it
  const h = ['<div class="stq"><div class="stqCol"><p class="blab">Bonuses</p>'];
  const sgn = v => (v < 0 ? '' : '+') + v;   // a penalty is a real number now: torva reads -18 magic attack, and says so
  for (const [n, f] of [['Attack bonus', 'atk'], ['Strength bonus', 'str'], ['Defence bonus', 'def'], ['Magic attack', 'mag'], ['Ranged attack', 'rat'], ['Ranged strength', 'rst']]) h.push(stRow(n, sgn(bonus(f))));
   // magic defence is magic attack plus the gap the armoury's `mdef` carries; the other two had no row at all
  h.push(stRow('Magic defence', sgn(bonus('mag') + bonus('mdef'))), stRow('Magic damage', sgn(bonus('mdmg')) + '%'), stRow('Prayer bonus', sgn(bonus('pb'))));
  h.push('<p class="blab">Levels</p>', stRow('Combat level', combatLevel()), stRow('Total level', totalLevel()), stRow('Hitpoints', P.hp + ' / ' + P.maxhp),
    stRow('Prayer', Math.floor(P.pray) + ' / ' + P.maxpray), stRow('Max melee hit', maxHit()), '</div><div class="stqCol"><p class="blab">Worn</p>');
  let worn = 0;
  for (const s of EQ_SLOTS) {
    if (!eq[s]) continue;
    worn++;
    const it = ITEMS[eq[s]];
    h.push('<div class="stWorn">' + img(it.id) + '<span>' + it.name + (s === 'ammo' ? ' × ' + P.ammoN : '') + '<u>' + s + '</u></span></div>');
  }
  if (!worn) h.push('<p class="gesEmpty">Nothing worn.</p>');
  h.push('</div></div>');
  showModal('Character', h.join(''), 'Bonuses total every worn piece. The combat level weighs your best discipline.', 1);
  statsOpen = 1;
}
el('eqMore').onclick = showStats;
const examineOpt = it => ({ t: 'Examine', o: it.name, cls: 'itm', f: () => say(examine(it)) });
on(eqWrap, 'contextmenu', e => {
  e.preventDefault();
  const d = e.target.closest('.eqslot');
  if (!d || !d.dataset.s || !eq[d.dataset.s]) return;
  const s = d.dataset.s, it = ITEMS[eq[s]];
  openCtx(e.clientX, e.clientY, [{ t: 'Unequip', o: it.name, cls: 'itm', f: () => unequip(s) }, examineOpt(it)]);
});
const skGrid = el('skGrid'), skEls = [];
SKILLS.forEach((s, i) => {
  const d = div(skGrid, 'sk' + (s.locked ? ' locked' : ' live'), '<img src="' + skIcon(i) + '" alt=""><b>1</b><s style="width:0"></s>');
  d.title = s.locked ? 'Reserved slot' : skName(i);
  skEls.push(d);
});
/* The two children each row needs, found once instead of on every repaint, and
   a per-row signature so a row whose numbers have not moved is skipped entirely.
   xp is rounded down for the key because a fractional gain cannot change
   anything this function renders. */
const _skB = [], _skS = [], _skKey = [];
function drawSk() {
  dirty.sk = 0;
  for (let i = 0; i < NSK; i++) {
    const e = skEls[i], L = lvl[i];
    if (!_skB[i]) { _skB[i] = e.querySelector('b'); _skS[i] = e.querySelector('s'); }
    if (SKILLS[i].locked) { if (_skKey[i] !== 'x') { _skKey[i] = 'x'; _skB[i].textContent = '–'; } continue; }
    const key = L + ':' + bst[i] + ':' + Math.floor(xp[i]);
    if (_skKey[i] === key) continue;
    _skKey[i] = key;
    _skB[i].textContent = L + bst[i]; e.classList.toggle('up', bst[i] > 0); e.classList.toggle('dn', bst[i] < 0);
    const a = XP_TABLE[L], b = XP_TABLE[Math.min(MAXL + 1, L + 1)];
    _skS[i].style.width = (L >= MAXL ? 100 : clamp((xp[i] - a) / (b - a), 0, 1) * 100) + '%';
    e.title = skName(i) + ' ' + L + '  ·  ' + Math.floor(xp[i]).toLocaleString() + ' xp' + (L < MAXL ? '  ·  ' + Math.ceil(b - xp[i]).toLocaleString() + ' to ' + (L + 1) : '');
  }
  el('skTotal').textContent = totalLevel();
}
/* touch has no hover: a long press pops the skill's title in a floating tip */
const skTip = div(document.body, ''); skTip.id = 'skTip'; skTip.style.display = 'none';
let skTipT = 0, skHold = 0;
const hideSkTip = () => { skTip.style.display = 'none'; clearTimeout(skTipT); };
const vibrate = () => { if (navigator.vibrate) { try { navigator.vibrate(12); } catch {} } };
on(skGrid, 'pointerdown', e => {
  if (e.pointerType !== 'touch') return;
  const d = e.target.closest('.sk'), txt = d && d.title; if (!txt) return;
  clearTimeout(skHold);
  const px = e.clientX, py = e.clientY;
  skHold = setTimeout(() => {
    vibrate();
    skTip.textContent = txt; skTip.style.display = 'block';
    skTip.style.left = Math.min(px, innerWidth - skTip.offsetWidth - 6) + 'px'; skTip.style.top = Math.max(6, py - skTip.offsetHeight - 12) + 'px';
    clearTimeout(skTipT); skTipT = setTimeout(hideSkTip, 4000);
  }, 380);
});
on(skGrid, 'pointermove', e => { if (Math.abs(e.movementX) + Math.abs(e.movementY) > 6) clearTimeout(skHold); });
on(skGrid, 'pointerup pointercancel', () => clearTimeout(skHold));
on(window, 'pointerdown', e => { if (skTip.style.display === 'block' && e.target !== skTip) hideSkTip(); }, true);
const orb = (id, txt, w, onCls) => { const o = el(id); o.querySelector('b').textContent = txt; o.querySelector('.fill').style.width = w + '%'; if (onCls !== undefined) o.classList.toggle('on', onCls); };
function drawOrbs() {
  dirty.orb = 0;
  orb('orbHp', P.hp, P.hp / P.maxhp * 100);
  orb('orbPray', Math.ceil(P.pray), P.pray / Math.max(1, P.maxpray) * 100, !!P.prayers);
  orb('orbRun', Math.round(P.energy), P.energy, !!P.run);
  if (el('pane-pr').classList.contains('on')) el('prPts').textContent = Math.ceil(P.pray) + '/' + P.maxpray;
}
/* the centred modal: shops, forges, the bank — anything that is not the pack */
const modalEl = el('modal'), modalBody = el('modalBody'), modalTitle = el('modalTitle'), modalFoot = el('modalFoot');
function showModal(title, html, foot, keepTab) {
  barberOn = 0; statsOpen = 0;
  openShop = null; bankOpen = 0; geOpen = 0; geView = null; clearInterval(geTimer);   // a modal takes the screen: leaving a counter open behind it made the pack deposit under a visible shop
  modalTitle.textContent = title; modalBody.innerHTML = html; modalFoot.textContent = foot || '';
  modalEl.classList.add('on');
  if (!keepTab) showTab('inv');
}
function closeOverlays() {
  if (bankOpen) sfx(2022, 0.8);   // the vault book shuts
  modalEl.classList.remove('on'); openShop = null; makeRows = null; bankOpen = 0; barberOn = 0; geOpen = 0; geView = null; clearInterval(geTimer); statsOpen = 0;
  if (pvpHold) { pvpHold = 0; stopWalk(); }   // dismissing the border warning cancels the walk
}
el('modalX').onclick = closeOverlays;
let makeRows = null, makeAt = null;
function showMake(title, rows, o) {
  makeRows = rows; makeAt = o || null;
  showModal(title, gridOf(rows.map((r, i) => mkRow('data-mk="' + i + '"', r.id, mkName(r), mkOk(r) ? 'level ' + r.lv : 'needs ' + mkWhy(r), '', mkOk(r) ? '' : ' no'))),
    'Click an item to make it; you keep going until you run out or walk off.');
}
function startShop(o) {
  clearUse(); P.uspell = null;
  bankOpen = 0;
  const n = nearVillage(o.x, o.z), k = SHOP_KINDS[o.k];
  openShop = { kind: k.k, name: k.n, tier: n ? n.v.tier : 0 };
  openShop.stock = shopStock(openShop.kind, openShop.tier);
  say('You browse the ' + openShop.name.toLowerCase() + '.');
  drawShop();
}
function drawShop() {
  if (!openShop) return;
  const rows = openShop.stock.map(s => { const it = ITEMS[s.id], p = buyPrice(it); return mkRow(s.n > 0 ? 'data-buy="' + s.id + '"' : '', s.id, it.name, s.n > 0 ? s.n + ' in stock' : 'out of stock', '<b class="gp">' + p + '</b>', s.n > 0 && coins() >= p ? '' : ' no'); });
  paintModal(openShop.name + ' — ' + coins() + ' gp', gridOf(rows), 'Click to buy. Click anything in your pack to sell it here.');
}
on(modalBody, 'click', e => {
  const lk = e.target.closest('[data-lk]');
  if (lk) {   // the barber's swatches fit the mannequin only
    if (!barberOn) return;
    const [k, i] = lk.dataset.lk.split(':');
    barberSel[k] = +i;
    for (const b of modalBody.querySelectorAll('[data-lk^="' + k + ':"]')) b.classList.toggle(k === 'face' ? 'fon' : 'on', b.dataset.lk === lk.dataset.lk);
    dressBarberRig();
    return;
  }
  const ge = e.target.closest('[data-genew],[data-gepick],[data-gecol],[data-geab],[data-gea]');
  if (ge && geOpen) {
    const d = ge.dataset;
    if (d.genew !== undefined) { const [k, s] = d.genew.split(':'); geView = { kind: +k, slot: +s, item: null, q: '' }; drawGE(); }
    else if (d.gepick !== undefined && geView) { geView.item = d.gepick; geView.qty = undefined; geView.price = undefined; drawGE(); }
    else if (d.gecol !== undefined) geCollect(+d.gecol);
    else if (d.geab !== undefined) geAbort(+d.geab);
    else if (d.gea !== undefined && geView && geView.item) {
      const pEl = el('gePrice'), qEl2 = el('geQty');
      if (d.gea === 'all') qEl2.value = Math.max(1, invCount(geView.item));
      else if (d.gea === 'g') pEl.value = geGuide(geView.item);
      else pEl.value = Math.max(1, Math.round(Math.max(1, Math.floor(+pEl.value || 0)) * (d.gea === '+5' ? 1.05 : 0.95)));
      pEl.dispatchEvent(new Event('input')); qEl2.dispatchEvent(new Event('input'));
    }
    return;
  }
  const bqb = e.target.closest('[data-bq]');
  if (bqb) { bankMode = bqb.dataset.bq; if (el('bankXin')) bankX = clamp(Math.floor(+el('bankXin').value) || 1, 1, 1e9); drawBank(); return; }
  const all = e.target.closest('[data-wall]');
  if (all) return bankWithdraw(+all.dataset.wall, 1e9);
  const row = e.target.closest('[data-buy],[data-mk],[data-wd]');
  if (!row) return;
  if (row.dataset.buy) shopBuy(row.dataset.buy);
  else if (row.dataset.wd !== undefined) bankWithdraw(+row.dataset.wd, bankQty());
  else { const r = makeRows && makeRows[+row.dataset.mk]; if (r && mkOk(r)) { startMake(r, makeAt); closeOverlays(); } }
});
const PANES = ['inv', 'eq', 'sk', 'wd', 'cb', 'mg', 'pr', 'op'], PANE_DRAW = { cb: () => drawStyles(), mg: () => drawSpells(), pr: () => drawPrayers(), op: () => drawOpts() };
function showTab(k) {
  for (const t of document.querySelectorAll('.tab')) t.classList.toggle('on', t.dataset.p === k);
  for (const p of PANES) el('pane-' + p).classList.toggle('on', p === k);
  if (PANE_DRAW[k]) PANE_DRAW[k]();
}
for (const t of document.querySelectorAll('.tab')) t.onclick = () => showTab(t.dataset.p);
/* list rows for the combat, spell and prayer tabs */
const liRow = (attr, on, no, iconSrc, name, sub, extra) => '<div class="li' + (on ? ' on' : '') + (no ? ' no' : '') + '" ' + attr + '><img src="' + iconSrc + '" alt=""><span>' + name + (extra || '') + '</span>' + sub + '</div>';
const styleList = el('styleList');
function drawStyles() {
  const bow = bowItem(), mage = !bow && gearClass(weaponIt()) === 'mage';   // a bow has no swing to choose
  const list = bow ? RSTYLES : mage ? CSTYLES : STYLES;
  styleList.innerHTML = list.map((s, i) => {
    const on = bow ? P.rstyle === i : !mage ? P.style === i
      : s.st !== undefined ? P.spell === null && P.style === s.st : P.spell !== null && P.cstyle === s.cs;
    return liRow('data-s="' + i + '"', on, 0, drawIcon(s.g, '#c9a24a', '#efe4c4'), s.n, '', '<u>' + s.d + '</u>');
  }).join('');
  el('cbWep').textContent = (bow || weaponIt() || { name: 'Unarmed' }).name;
  el('cbSpd').textContent = atkSpeed() + ' ticks'; el('cbMax').textContent = P.spell !== null ? mdmgMax(SPELLS[P.spell].max) : pstaffOn() ? mdmgMax(pstaffMax()) : maxHit(); el('cbLvl').textContent = combatLevel();
  const sw = SPEC[eq.weapon], b = el('cbSpec');
  b.style.display = sw ? '' : 'none';
  if (sw) { b.textContent = (P.specArm ? 'Special armed — ' : 'Special attack (' + sw.cost + '%) — ') + (sw.souls ? (P.souls || 0) + ' soul' + (P.souls === 1 ? '' : 's') : Math.floor(P.spec) + '%'); b.classList.toggle('on', !!P.specArm); }
}
on(el('cbSpec'), 'click', () => {
  const sw = SPEC[eq.weapon]; if (!sw) return;
  if (sw.fx) { if (P.spec >= sw.cost) { P.spec -= sw.cost; sw.fx(); drawStyles(); } return; }   // instant specs fire from the button
  if (!P.specArm && sw.souls && !P.souls) return say('The axe holds no souls to spend.', 'bad');
  if (!P.specArm && P.spec < sw.cost) return say('Not enough special attack energy.', 'bad');
  P.specArm = P.specArm ? 0 : 1; drawStyles();
});
on(styleList, 'click', e => {
  const d = e.target.closest('[data-s]'); if (!d) return;
  const i = +d.dataset.s;
  if (bowItem()) { P.rstyle = i; say('Ranged style: ' + RSTYLES[i].n + '. ' + RSTYLES[i].d + '.'); }
  else if (gearClass(weaponIt()) === 'mage') {
    const s = CSTYLES[i];
    if (s.st !== undefined) { P.style = s.st; say('Combat style: ' + s.n + '. ' + s.d + '.'); }
    else { P.cstyle = s.cs; say('Cast style: ' + s.n + '. ' + s.d + '.' + (P.spell === null ? ' Ready a spell in the spellbook.' : '')); }
  }
  else { P.style = i; say('Combat style: ' + STYLES[i].n + '. ' + STYLES[i].d + '.'); }
  drawStyles();
});
const spellGrid = el('spellGrid'), bookTabs = el('bookTabs'), spellFilters = el('spellFilters');
/* The tab is one book at a time, sectioned the way OSRS groups them — Combat, Utility, Teleport — with chips that hide
   a whole section or the spells you cannot yet cast. Under-levelled spells are GREYED and kept in place by default,
   as the wiki describes; the "Castable" chip is the opt-in that hides them outright. */
const SPF = ['combat', 'utility', 'teleport'];
let spFilter = { combat: 1, utility: 1, teleport: 1, castable: 0 };
const usKind = s => s.grp === 4 ? 'teleport' : 'utility';
function drawSpells() {
  bookTabs.innerHTML = BOOKS.map((b, i) =>
    '<b data-book="' + i + '" class="' + (P.book === i ? 'on' : bookHas(i) ? '' : 'no') + '">' + b.n + '</b>').join('');
  spellFilters.innerHTML = SPF.map(k => '<b data-spf="' + k + '" class="' + (spFilter[k] ? 'on' : '') + '">' + cap(k) + '</b>').join('')
    + '<b data-spf="castable" class="' + (spFilter.castable ? 'on' : '') + '">Castable</b>';

  const shown = s => !spFilter.castable || (lvl[SK.magic] >= s.lv && spellReady(s));
  const rank = s => s.max > 0 ? (s.undead ? 1 : 0) : 2;   // elements by level, Crumble Undead after them, curses and holds last
  const combat = SPELLS.filter(s => (s.bk || 0) === P.book && shown(s)).sort((a, b) => (rank(a) - rank(b)) || (a.lv - b.lv));
  const util = USPELLS.filter(s => (s.bk || 0) === P.book && shown(s)).sort((a, b) => (a.grp - b.grp) || (a.lv - b.lv));
  const sec = t => '<div class="li sec">' + t + '</div>';
  let h = '';
  if (spFilter.combat && combat.length) h += sec('Combat') + combat.map(s => {
    const ok = lvl[SK.magic] >= s.lv;
    return liRow('data-sp="' + s.i + '" title="' + s.need.map(n => n[1] + ' ' + ITEMS[n[0]].name).join(', ') + (s.fx ? ' — ' + fxNote(s.fx) : '') + '"', P.spell === s.i, !ok,
      g07(SP07, s.k) ? c07p(SP07[s.k]) : drawIcon('rune', '#' + s.tint.toString(16).padStart(6, '0'), '#f0e6c8'), s.n,
      '<u>' + (ok ? (spellReady(s) ? 'ready' : 'no runes') : 'level ' + s.lv) + '</u>');
  }).join('');
  for (const kind of ['utility', 'teleport']) {
    if (!spFilter[kind]) continue;
    const rows = util.filter(s => usKind(s) === kind);
    if (rows.length) h += sec(kind === 'utility' ? 'Utility' : 'Teleports') + rows.map(usRow).join('');
  }
  spellGrid.innerHTML = h || sec('Nothing here at that filter');
  el('mgHint').textContent = P.uspell ? 'Casting ' + P.uspell.n + '. Choose an item in your pack, or pick it again to stop.'
    : P.spell === null ? 'Select a spell, then click a target.'
    : 'Autocasting ' + SPELLS[P.spell].n + '. It stays ready until you pick it again.';
}
/* what the element does, for the row's tooltip */
const fxNote = f => f.psn ? 'poisons on a 1/8 hit' : f.atk ? 'drains ' + Math.round(f.atk * 100) + '% attack'
  : f.lch ? 'heals you a quarter of the damage' : f.frz ? 'freezes for ' + (f.frz * TICK / 1000).toFixed(1) + 's' : '';
on(bookTabs, 'click', e => { const b = e.target.closest('[data-book]'); if (b) setBook(+b.dataset.book); });
on(spellFilters, 'click', e => { const b = e.target.closest('[data-spf]'); if (!b) return; const k = b.dataset.spf; spFilter[k] = spFilter[k] ? 0 : 1; drawSpells(); });
on(modalBody, 'click', e => { const b = e.target.closest('[data-bkswap]'); if (b) { setBook(+b.dataset.bkswap); closeOverlays(); } });
on(spellGrid, 'click', e => {
  const d = e.target.closest('[data-sp]'); if (!d) return;
  const s = SPELLS[+d.dataset.sp];
  if (eff('magic') < s.lv) return say('You need Magic level ' + s.lv + ' to cast that.', 'bad');
  P.spell = P.spell === s.i ? null : s.i;
  say(P.spell === null ? 'You put your staff away.' : 'You ready ' + s.n + '.');
  drawSpells();
});
const prayList = el('prayList');
function drawPrayers() {
  prayList.innerHTML = PRAYERS.slice().sort((a, b) => a.lv - b.lv).map(p => { const ok = lvl[SK.prayer] >= p.lv && lvl[SK.defence] >= p.dl;
    return liRow('data-pr="' + p.k + '"', P.prayers & p.bit, !ok, g07(PR07, p.k) ? c07p(PR07[p.k]) : drawIcon(p.g, '#c9b45a', '#efe4c4'), p.n, '', '<u>' + (ok ? 'level ' + p.lv : 'needs level ' + p.lv) + (p.dl ? ', Defence ' + p.dl : '') + '</u>'); }).join('');
  el('prPts').textContent = Math.ceil(P.pray) + '/' + P.maxpray;
}
on(prayList, 'click', e => {
  const d = e.target.closest('[data-pr]'); if (!d) return;
  const p = PRAYERS.find(x => x.k === d.dataset.pr);
  if (lvl[SK.prayer] < p.lv || lvl[SK.defence] < p.dl) return say('You need Prayer level ' + p.lv + (p.dl ? ' and Defence level ' + p.dl : '') + ' for that.', 'bad');
  if (P.pray <= 0 && !(P.prayers & p.bit)) return say('You have run out of prayer points.', 'bad');
  P.prayers ^= p.bit;
  if (!(P.prayers & p.bit)) sfx(2673);
  if (P.prayers & p.bit) for (const q of PRAYERS) if (q !== p && q.fx.some(x => p.fx.includes(x))) P.prayers &= ~q.bit;   // prayers sharing an effect share a slot
  markDirty(); drawPrayers();
});
const OPT_ROWS = [
  { k: 'camSpeed', n: 'Camera speed', min: 0.6, max: 5, step: 0.4, fmt: v => v.toFixed(1) + 'x' },
  { k: 'viewRadius', n: 'View distance', min: 3, max: 9, step: 1, fmt: v => v + ' chunks', apply: 1 },
  { k: 'fog', n: 'Distance fog', tog: 1 }, { k: 'retaliate', n: 'Auto retaliate', tog: 1 }, { k: 'timers', n: 'Respawn clocks', tog: 1 }, { k: 'xpDrops', n: 'Xp drops', tog: 1 },
  { k: 'hideRoofs', n: 'Hide all roofs', tog: 1 }, { k: 'pvpWarn', n: 'PvP border warning', tog: 1 },
  { k: 'osrs', n: '2007 models', tog: 1 },
  { k: 'brightness', n: 'Brightness', min: 0.7, max: 1.4, step: 0.1, fmt: v => Math.round(v * 100) + '%' }
];
const optList = el('optList');
function drawOpts() {
  optList.innerHTML = OPT_ROWS.map(r => '<div class="opt" data-o="' + r.k + '"><span>' + r.n + '</span><b>' + (r.tog ? (OPT[r.k] ? 'ON' : 'OFF') : r.fmt(OPT[r.k])) + '</b></div>').join('') +
    '<div class="opt"><span>Music volume</span><input type="range" id="volSlider" min="0" max="100" value="' + Math.round(vol * 100) + '" aria-label="Music volume"></div>' +
    '<div class="opt"><span>Effects volume</span><input type="range" id="sfxSlider" min="0" max="100" value="' + Math.round(sfxVol * 100) + '" aria-label="Effects volume"></div>' +
    '<div class="opt" data-o="dev"><span>Developer console</span><b>OPEN</b></div>';
  el('volSlider').oninput = e => setVol(+e.target.value / 100);
  el('sfxSlider').oninput = e => setSfxVol(+e.target.value / 100);
}
on(optList, 'click', e => {
  const d = e.target.closest('[data-o]'); if (!d) return;
  const k = d.dataset.o;
  if (k === 'dev') return devGate();
  const r = OPT_ROWS.find(x => x.k === k);
  if (r.tog) OPT[k] = OPT[k] ? 0 : 1; else { OPT[k] += r.step; if (OPT[k] > r.max + 1e-6) OPT[k] = r.min; }
  if (k === 'osrs') { icons07Apply(1); osrsApply(); }
  applyOpts(r); drawOpts();
});
/* The sprites are cached as data URLs and baked into HTML already on screen, so flipping the setting has to forget
   both caches and repaint everything built from them; what is rebuilt per frame (marks, the map) needs only the
   clear. The meshes are osrsApply's half of the same switch. `panes` redraws the two lazily-built lists as well —
   boot passes it up, because PANE_DRAW builds those on first open anyway and their tables are not up yet. */
function icons07Apply(panes) {
  _iconCache.clear(); _markCache.clear();
  for (const e of slotEls) e.dataset.id = '';       // a pack slot's signature is item+count: the sprite under it moved, not the item
  skEls.forEach((e, i) => { e.firstChild.src = skIcon(i); });   // the skills grid is built once and only its numbers are redrawn
  dirty.inv = dirty.eq = dirty.sk = 1;
  drawPvpTag(); buildWmKey();
  if (panes) { drawSpells(); drawPrayers(); }
  wmDirty = 1;
}
function applyOpts(r) {
  setOsrsDist(OPT.osrsDist);
  scene.fog = OPT.fog ? new THREE.Fog(SKY, 120, OPT.viewRadius * CHUNK * 0.95) : null;
  renderer.setClearColor(new THREE.Color(SKY).multiplyScalar(OPT.brightness));
  mat.color.setScalar(OPT.brightness); tintMat.color.setScalar(OPT.brightness); OSRSK.brightness(OPT.brightness);
  if (r && r.apply) { RADIUS = OPT.viewRadius; refresh(); }
  for (const rec of chunks.values()) for (const b of rec.roofs) if (b.roof) b.roof.visible = roofShown(b);
  document.body.classList.toggle('budget', !!OPT.budget);
  const db = el('devBudget'); if (db) db.classList.toggle('on', !!OPT.budget);
  store.set('seedworld.opt', JSON.stringify(OPT));
}
/* floating combat text, health bars, respawn clocks, xp drops */
const fxEl = el('fx'), fxPool = [];
function fxGet(cls) {
  for (const f of fxPool) if (!f.live) { f.el.className = cls; f.live = 1; f.el.style.display = ''; return f; }
  const f = { el: div(fxEl, cls), live: 1 }; fxPool.push(f); return f;
}
const fxFree = f => { f.live = 0; f.el.style.display = 'none'; };
const _p3 = new THREE.Vector3();
function project(x, y, z) {
  _p3.set(x, y, z).project(camera);
  return _p3.z > 1 ? null : [(_p3.x * 0.5 + 0.5) * innerWidth, (-_p3.y * 0.5 + 0.5) * innerHeight];
}
const place = (e, p) => { e.style.transform = 'translate(' + p[0] + 'px,' + p[1] + 'px)'; };
const splats = [];
function hitsplat(x, y, z, dmg) { const f = fxGet('hs ' + (dmg ? 'd' : 'z')); f.el.textContent = dmg; splats.push({ f, x, y, z, t: 1.1, vy: 0.9 }); }
const bars = [];
function healthBar(target, h) {
  const b0 = target._bar;   // trust the cached bar only while it is live, listed and whole — anything else heals itself
  if (b0 && b0.f.live && b0.f.el.firstChild && bars.indexOf(b0) >= 0) { b0.t = 5; if (h) b0.h = h; return; }
  if (b0) { const i = bars.indexOf(b0); if (i >= 0) bars.splice(i, 1); if (b0.f.live) fxFree(b0.f); target._bar = null; }
  const f = fxGet('hb');
  f.el.innerHTML = '<i></i>';
  bars.push(target._bar = { f, target, t: 5, h: h || 2.0 });
}
function fxRepair(e) {   // a corrupt element must not kill the fx loop for good: reset the layer clean
  console.warn('fx layer reset', e);
  for (const b of bars) b.target._bar = null;
  bars.length = 0; splats.length = 0;
  for (const f of fxPool) fxFree(f);
}
function fxFrame(dt) {
  for (let i = splats.length - 1; i >= 0; i--) {
    const s = splats[i];
    s.t -= dt; s.y += s.vy * dt; s.vy -= dt * 0.6;
    const p = s.t <= 0 ? null : project(s.x, s.y, s.z);
    if (!p) { fxFree(s.f); splats.splice(i, 1); continue; }
    place(s.f.el, p); s.f.el.style.opacity = Math.min(1, s.t * 2.2);
  }
  for (let i = bars.length - 1; i >= 0; i--) {
    const b = bars[i], t = b.target; b.t -= dt;
    if ((t.dead || t.hp <= 0) && b.t > 0.8) b.t = 0.8;   // the killing blow leaves an empty bar for a beat, as 2007 did
    const p = b.t <= 0 ? null : project(t.rx, t.ry + b.h, t.rz) || project(t.rx, t.ry + 0.9, t.rz);   // a giant's crown can leave the frame: fall back to its chest
    if (!p) { fxFree(b.f); t._bar = null; bars.splice(i, 1); continue; }
    p[1] = Math.max(8, p[1]);   // pinned to the top edge rather than lost above it
    place(b.f.el, p);
    let w = b.f.el.firstChild; if (!w) { b.f.el.innerHTML = '<i></i>'; w = b.f.el.firstChild; }   // a gutted element regrows its fill
    w.style.width = Math.max(0, t.hp / t.maxhp * 100) + '%';
  }
}
/* respawn clocks own their elements outright: a borrowed pool element could be stolen by the next hitsplat */
const timers = [], TIMER_CAP = 18;
function timerEl(i) {
  let t = timers[i];
  if (!t) { const d = div(fxEl, 'tm'); d.style.display = 'none'; t = timers[i] = { el: d, s: '', on: 0 }; }
  return t;
}
const timerOff = t => { if (t.on) { t.on = 0; t.el.style.display = 'none'; t.s = ''; } };
function timerFrame() {
  let n = 0;
   // `depleted` is short — only what is actually down — where nearObjs is every rock, tree and crate in the near band
  for (const [key, due] of depleted) {
    if (n >= TIMER_CAP) break;
    const o = objIndex.get(key);
    if (!o || (o.t > 2 && o.t !== 14) || Math.abs(o.x - P.rx) > 44 || Math.abs(o.z - P.rz) > 44) continue;
    const pt = project(o.x, o.y + 1.1, o.z);
    if (!pt) continue;
    const t = timerEl(n);
    if (!t.on) { t.on = 1; t.el.style.display = ''; }
    const secs = Math.max(0, (due - tickN) * TICK / 1000), lbl = secs >= 10 ? Math.ceil(secs) + 's' : secs.toFixed(1) + 's';
    if (lbl !== t.s) { t.s = lbl; t.el.textContent = lbl; }
    place(t.el, pt);
    n++;
  }
  for (let i = n; i < timers.length; i++) timerOff(timers[i]);
}
const clearTimers = () => { for (const t of timers) timerOff(t); };
const xpdEl = el('xpd'), xpRows = [];
function xpDrop(i, amount) {
  if (!OPT.xpDrops) return;
  xpRows.push({ el: div(xpdEl, 'xp', '<img src="' + skIcon(i) + '" alt="">+' + Math.round(amount)), t: 2.4 });
  if (xpRows.length > 6) xpRows.shift().el.remove();
}
function xpFrame(dt) {
  for (let i = xpRows.length - 1; i >= 0; i--) {
    const r = xpRows[i]; r.t -= dt;
    if (r.t < 0.6) r.el.style.opacity = Math.max(0, r.t / 0.6);
    if (r.t <= 0) { r.el.remove(); xpRows.splice(i, 1); }
  }
}
/* ---- 27. DEV CONSOLE (backtick) ---- */
const devEl = el('dev'), devItems = el('devItems'), devFind = el('devFind'), devMons = el('devMons'), devMonFind = el('devMonFind');
el('devSkill').innerHTML = SKILLS.map((s, i) => s.locked ? '' : '<option value="' + i + '">' + skName(i) + '</option>').join('');
function openDev() { devEl.classList.add('on'); el('devLod').value = OPT.osrsDist; devLodNote(); drawDevItems(); drawDevMons(); devFind.focus(); }
/* the console is open ground offline and on the sandbox; elsewhere a one-time password unlocks it per character per world */
const devOK = () => OFFLINE || SEED === 'lumbridge(sandbox)' || store.get('seedworld.devok.' + (PID || 'anon') + '.' + SEED) === '1';
function devGate() {
  if (devOK()) return openDev();
  showModal('Developer console', '<p class="smsg">This console is for world admins. Enter the password to unlock it.</p>' +
    '<div class="wrow2"><input id="devPw" type="password" autocomplete="off" aria-label="Console password"><button id="devPwGo">Unlock</button></div><p id="devPwMsg" class="lmsg"></p>',
    'Once entered, it stays unlocked for this character on this world.');
  const go = () => {
    if (el('devPw').value === '1904') { store.set('seedworld.devok.' + (PID || 'anon') + '.' + SEED, '1'); closeOverlays(); openDev(); }
    else { el('devPwMsg').textContent = 'That is not the password.'; el('devPwMsg').className = 'lmsg warn'; }
  };
  el('devPwGo').onclick = go;
  el('devPw').onkeydown = e => { e.stopPropagation(); if (e.key === 'Enter') go(); };
  el('devPw').focus();
}
el('adminBtn').onclick = devGate;
const closeDev = () => devEl.classList.remove('on');
el('devX').onclick = closeDev;
devEl.onclick = e => { if (e.target === devEl) closeDev(); };
const diRow = (attr, src, name, sub) => '<div class="di" ' + attr + '><img src="' + src + '" alt=""><span>' + name + (sub || '') + '</span></div>';
const NO_MATCH = '<div class="di no"><span>no match</span></div>';
function drawDevItems() {
  const q = devFind.value.trim().toLowerCase(), hits = [];
  for (const id in ITEMS) { const it = ITEMS[id]; if (!q || it.name.toLowerCase().indexOf(q) >= 0 || id.indexOf(q) >= 0) hits.push(it); }
  hits.sort((a, b) => a.name.localeCompare(b.name));
  devItems.innerHTML = hits.map(it => diRow('data-i="' + it.id + '"', icon(it.id), it.name)).join('') || NO_MATCH;
}
on(devFind, 'input', drawDevItems);
const rgbHex = c => [0, 1, 2].map(i => Math.round(clamp(c[i], 0, 1) * 255).toString(16).padStart(2, '0')).join('');
function drawDevMons() {
  const q = devMonFind.value.trim().toLowerCase();
  const hits = SPAWNABLE.concat(BOSS_LIST).filter(t => !q || t.n.toLowerCase().indexOf(q) >= 0 || t.k.indexOf(q) >= 0 || (q === 'boss' && t.boss))
    .sort((a, b) => a.n.localeCompare(b.n) || a.lv - b.lv);
  devMons.innerHTML = hits.map(t => diRow('data-m="' + t.k + (t.base ? '@' + t.lv : '') + '"', drawIcon(t.boss ? 'star' : t.big ? 'skull' : 'fist', '#' + (t.body ? rgbHex(t.body) : '8a8a8a'), '#efe4c4'),
    t.n + ' ', '<u>lv ' + t.lv + (t.boss ? ' · boss' : '') + '</u>')).join('') || NO_MATCH;
}
function spawnNear(t, count) {   // arm's length away, on ground that can be stood on
  let made = 0;
  for (let i = 0; i < count * 40 && made < count; i++) {
    const a = (i * 2.39996) % TAU, rr = 3 + (i % 4), x = P.tx + Math.round(Math.sin(a) * rr), z = P.tz + Math.round(Math.cos(a) * rr);
    if ((Math.abs(x - P.tx) < 2 && Math.abs(z - P.tz) < 2) || !dry(x, z)) continue;
    spawnNpc(t, x, z, 'dev' + tickN + '_' + i + '_' + made);
    made++;
  }
  return made;
}
on(devMons, 'click', e => {
  const d = e.target.closest('[data-m]'); if (!d) return;
  const t = npcByName(d.dataset.m); if (!t) return;
  const made = spawnNear(t, Math.max(1, Math.min(20, +el('devMonQty').value || 1)));
  say(made ? 'Spawned ' + made + ' x ' + t.n + '.' : 'No open ground nearby.', made ? 'lv' : 'bad');
});
on(devMonFind, 'input', drawDevMons);
on(devItems, 'click', e => {
  const d = e.target.closest('[data-i]'); if (!d) return;
  const got = invAdd(d.dataset.i, Math.max(1, Math.min(10000, +el('devQty').value || 1)));
  say(got ? 'Spawned ' + got + ' x ' + ITEMS[d.dataset.i].name.toLowerCase() + '.' : 'No room in your pack.', got ? 'lv' : 'bad');
});
function setLevel(i, L) {
  L = clamp(L | 0, i === SK.hitpoints ? 10 : 1, MAXL);   // hitpoints never sits below 10, as 2007
  lvl[i] = L; xp[i] = XP_TABLE[L];
  if (i === SK.hitpoints) { P.maxhp = L; P.hp = L; }
  if (i === SK.prayer) { P.maxpray = L; P.pray = L; }
  dirty.sk = dirty.orb = 1;
}
el('devSet').onclick = () => { const i = +el('devSkill').value; setLevel(i, +el('devLvl').value); say('Set ' + skName(i) + ' to ' + lvl[i] + '.', 'lv'); };
el('devAll').onclick = () => { for (let i = 0; i < NSK; i++) if (!SKILLS[i].locked) setLevel(i, +el('devLvl').value); say('All skills set to ' + clamp(+el('devLvl').value | 0, 1, MAXL) + '.', 'lv'); };
el('devReset').onclick = () => { resetSkills(); P.maxhp = P.hp = lvl[SK.hitpoints]; P.maxpray = P.pray = 1; dirty.sk = dirty.orb = 1; say('Skills reset.', 'lv'); };
/* the three dev kits scan the whole armoury per slot at press time, so tomorrow's gear outfits itself: melee weighs damage
   and defence together (and a two-hander against sword-and-board), range weighs the quiver into the launcher, mage chases mdmg */
const KIT_SCORE = {
  m: it => (it.str || 0) * 3 + (it.def || 0) * 2 + (it.atk || 0) * 0.05,
  r: it => (it.rst || 0) * 8 + (it.rat || 0) + (it.def || 0) * 0.05,
  g: it => (it.mdmg || 0) * 20 + (it.mag || 0) + (it.def || 0) * 0.05
};
const KIT_FIT = {   // an item fits melee when its melee worth outweighs its mage/range character — a fire cape's stray +1s must not exile it
  m: it => !it.bow && ((it.str || 0) > 0 || (it.def || 0) > 0) && (it.str || 0) * 3 + (it.def || 0) * 2 >= ((it.rat || 0) + (it.mag || 0)) * 2,
  r: it => (it.rst || 0) > 0 || (it.rat || 0) > 0,
  g: it => (it.mdmg || 0) > 0 || (it.mag || 0) > 0
};
function kitBest(spec, slot, alsoFit) {
  let best = null, bs = 0;
  for (const id in ITEMS) {
    const it = ITEMS[id];
    if (!it.equip || it.slot !== slot || it.thrown || !KIT_FIT[spec](it) || (alsoFit && !alsoFit(it))) continue;
    const s = KIT_SCORE[spec](it) + (it.val || 0) * 1e-8;   // value breaks ties toward the prestige piece
    if (s > bs) { bs = s; best = it; }
  }
  return best && { it: best, s: bs };
}
function devKit(spec) {
  const wear = (slot, id, n) => {
    const old = eq[slot], oldN = slot === 'ammo' ? P.ammoN : 1;
    if (old && old !== id) { const got = invAdd(old, oldN); if (got < oldN) dropItem(old, oldN - got, P.tx, P.tz); }
    eq[slot] = id || null;
    if (slot === 'ammo') P.ammoN = id ? (n || 0) : 0;
  };
  for (const slot of EQ_SLOTS) {
    if (slot === 'weapon' || slot === 'shield' || slot === 'ammo') continue;
    const b = kitBest(spec, slot);
    if (b) wear(slot, b.it.id);
  }
  if (spec === 'r') {
    let bw = null, ba = null, bs = 0;
    for (const id in ITEMS) {   // a launcher is judged with the best quiver it can draw
      const w = ITEMS[id];
      if (!w.equip || w.slot !== 'weapon' || !w.bow) continue;
      const a = w.selfAmmo ? null : (kitBest('r', 'ammo', x => x.ammo && (w.ammoT || 'arrow') === (x.aT || 'arrow')) || {}).it;
      const s = (w.rst || 0) + (a ? a.rst || 0 : 0) + (w.rat || 0) * 0.02 - (w.spd || 4) * 0.001 + (w.val || 0) * 1e-8;
      if (s > bs) { bs = s; bw = w; ba = a; }
    }
    if (bw) { wear('weapon', bw.id); wear('ammo', ba && ba.id, 1000); }
    const sh = bw && !bw.two ? kitBest('r', 'shield') : null;
    wear('shield', sh ? sh.it.id : null);
  } else if (spec === 'g') {
    const w = kitBest('g', 'weapon');
    if (w) wear('weapon', w.it.id);
    const sh = !(w && w.it.two) ? kitBest('g', 'shield') : null;
    wear('shield', sh ? sh.it.id : null);
    wear('ammo', null);
  } else {
    const one = kitBest('m', 'weapon', x => !x.two), two = kitBest('m', 'weapon', x => x.two), sh = kitBest('m', 'shield');
    if (two && two.s > (one ? one.s : 0) + (sh ? sh.s : 0)) { wear('weapon', two.it.id); wear('shield', null); }   // both hands only when they beat sword-and-board
    else { if (one) wear('weapon', one.it.id); wear('shield', sh ? sh.it.id : null); }
    wear('ammo', null);
  }
  say('You dress for ' + (spec === 'm' ? 'melee' : spec === 'g' ? 'magic' : 'ranging') + ' in the best the armoury holds.', 'lv');
  gearChanged();
}
const DEV = {
  heal() { P.hp = P.maxhp; P.pray = P.maxpray; P.energy = 100; dirty.orb = 1; say('Restored.', 'lv'); },
  coins() { invAdd('coins', 10000); },
  runes() { for (const r of RUNES) invAdd(r.id, 500); },
  kitm() { devKit('m'); }, kitg() { devKit('g'); }, kitr() { devKit('r'); },
  clear() { inv.fill(null); dirty.inv = 1; say('Pack emptied.', 'lv'); },
  budget() { OPT.budget = OPT.budget ? 0 : 1; applyOpts(); say('World state panel ' + (OPT.budget ? 'shown' : 'hidden') + '.', 'lv'); },
  here() { el('devTx').value = P.tx; el('devTz').value = P.tz; },
  run() {
    OPT.runMul = clamp(+el('devRun').value || 1, 0.25, 8);
    el('devRunNow').textContent = OPT.runMul + 'x · ' + stepsThisTick() + ' tiles/tick';
    say('Run speed set to ' + OPT.runMul + 'x.', 'lv');
  },
  tp() {
    const x = Math.round(+el('devTx').value || 0), z = Math.round(+el('devTz').value || 0);
    if (Math.abs(x) > 2e6 || Math.abs(z) > 2e6) return say('Those coordinates are off the lattice.', 'bad');
    teleport(x, z, 400);
    say('Teleported to ' + x + ', ' + z + ' — ' + biomeName(walkY(x, z), x, z) + '.', 'lv');
  }
};
on(el('devBody'), 'click', e => { const b = e.target.closest('[data-d]'); if (b && DEV[b.dataset.d]) DEV[b.dataset.d](); });
el('devDmg').oninput = () => { devDmgMul = Math.max(0, parseFloat(el('devDmg').value) || 1); };
/* the 07 switch distance, live: every rig test is per frame, so the world re-dresses itself as you type */
const devLodNote = () => { el('devLodNow').textContent = OSRS_CAM + ' tiles to camera · players, monsters · ' + Math.round(LOC7) + ' to you · trees, veins'; };
el('devLod').oninput = () => { OPT.osrsDist = setOsrsDist(parseFloat(el('devLod').value)); applyOpts(); devLodNote(); };

/* ---- 28. HOVER + CONTEXT MENU: left click runs the top option, the corner names it, right click lists the rest ---- */
const hoverEl = el('hover'), ctxEl = el('ctx');
/* an option that flashes the target then starts a task (string kind) or walks up to run fn */
const act = (o, k, hostile) => () => { flashTarget(o, hostile || 0); if (typeof k === 'string') startTask(o, k); else P.task = { k: 'ui', o, fn: k }; };
/* object type -> [verb, noun (null = its own name), task kind or ui fn] */
const OBJ_OPTS = { 0: ['Chop down', null, 'chop'], 1: ['Mine', null, 'mine'], 3: ['Smelt at', 'Furnace', o => openMake(3, o)], 4: ['Smith at', 'Anvil', o => openMake(4, o)],
  5: ['Trade with', null, startShop], 6: o => [{ t: 'Cook at', o: o.n || 'Range', f: act(o, 'cook') }, { t: 'Bake at', o: o.n || 'Range', f: act(o, o2 => openMake(6, o2)) }],
  7: ['Bank at', null, () => openBank()], 8: o => [{ t: 'Pray at', o: 'Altar', f: act(o, 'pray') }, { t: 'Study', o: 'Altar', f: act(o, () => altarStudy()) }],
  9: ['Groom at', null, () => openBarber()], 10: ['Exchange at', null, () => openGE()], 11: ['Craft at', 'Altar', o => rcAltar(o)], 12: ['Talk to', null, o => slayerTalk(o)],
  13: ['Saw at', 'Sawmill', o => openMake(13, o)], 14: ['Steal from', null, 'steal'], 15: o => farmOpts(o), 16: o => agilOpts(o) };
/* what an armed item does to o: [noun, kind or fn]; the skills register USE_ON[type], and any fixture recipe using the item opens the make list */
function useTarget(o, uit) {
  if ((o.fire || o.t === 6) && uit.raw) return [o.fire ? 'Fire' : 'Range', 'cook'];
  if (o.t === 8 && uit.bury) return ['Altar', 'pray'];
  const u = USE_ON[o.t], r = u && u(o, uit);
  if (r) return r;
  if (o.t !== undefined && RECIPES.some(q => q.at === o.t && usesItem(q, uit.id))) return [o.n, o2 => openMake(o.t, o2, uit.id)];
  return null;
}
function optionsFor(o) {
  const opts = [];
  if (!o) return opts;
  if (useSel) {   // the 2007 use-cursor replaces the whole menu
    const u = useSel, uit = ITEMS[u.id], go = useTarget(o, uit);
    if (go) {
      const run = act(o, go[1]);
      opts.push({ t: 'Use', o: u.name + ' → ' + go[0], cls: 'itm', f: () => { const raw = u.id; clearUse(); run(); if (go[1] === 'cook' && P.task) P.task.raw = raw; } });
      return opts;
    }
    opts.push({ t: 'Use', o: u.name + ' → ' + (o.n || o.name || (o.fire ? 'Fire' : 'that')), cls: 'itm', f: () => { say('Nothing interesting happens.'); clearUse(); } });
    return opts;
  }
  if (o.remote) {   // the harmless option first; attacking lives one menu down, and only in the wilds
    opts.push({ t: 'Trade with', o: o.name, f: act(o, tradeRequest) });
    if (!pvpGate(o)) opts.push({ t: 'Attack', o: o.name + (remoteCb(o) ? ' <span class="lvl">(level ' + remoteCb(o) + ')</span>' : ''), f: act(o, 'attack', 1) });
  }
  else if (o.npc && o.t.k === 'genie') opts.push({ t: 'Talk to', o: 'Genie', f: act(o, o2 => { if (!invAdd('genie_lamp', 1)) return say(FULL, 'bad'); say('"Rub it well, master." The genie folds back into smoke.', 'lv'); removeNpc(o2); }) });
  else if (o.npc) { opts.push({ t: 'Attack', o: o.name + ' <span class="lvl">(level ' + o.t.lv + ')</span>', f: act(o, 'attack', 1) }); if (o.t.pick) opts.push({ t: 'Pickpocket', o: o.name, f: act(o, 'pick') }); }
  else if (o.drop) {   // a death spills a whole pack onto one tile: list the heap, this one first
    if (P.teleG) return [{ t: 'Grab', o: (o.n > 1 ? o.n + ' x ' : '') + o.name, cls: 'itm', f: () => teleGrab(o) }];
    const heap = drops.filter(d => Math.abs(d.x - o.x) <= 1 && Math.abs(d.z - o.z) <= 1).sort((a, b) => (a === o ? -1 : b === o ? 1 : 0));
    for (const d of heap.slice(0, 10)) opts.push({ t: 'Take', o: (d.n > 1 ? d.n + ' x ' : '') + d.name, cls: 'itm', f: () => { flashTarget(d, 0); P.task = { k: 'take', o: d }; } });
    if (heap.length > 1) opts.push({ t: 'Take all', o: heap.length + ' items', cls: 'itm', f: () => { flashTarget(o, 0); P.task = { k: 'take', o, all: 1 }; } });
  }
  else if (o.fire) opts.push({ t: 'Cook at', o: 'Fire', f: act(o, 'cook') });
  else if (o.t === 2) opts.push({ t: o.k ? 'Harpoon' : 'Net', o: 'Fishing spot', f: act(o, 'fish') });
  else if (OBJ_OPTS[o.t]) { const e = OBJ_OPTS[o.t]; if (typeof e === 'function') opts.push(...e(o)); else opts.push({ t: e[0], o: e[1] || o.n, f: act(o, e[2]) }); }
  if (o.t === 5 && SHOP_KINDS[o.k].k === 'craft') opts.push({ t: 'Tan hides at', o: o.n, f: act(o, o2 => openMake('tan', o2)) });
  if (o.t !== undefined && o.t <= 2 && depleted.has(o.key)) return [];
  return opts;
}
const itm = (t, o, f) => ({ t, o, cls: 'itm', f });
function itemOptions(i) {
  const s = inv[i]; if (!s) return [];
  const it = ITEMS[s.id], opts = [], nm = it.name;
  if (trade && trade.open) {   // mid-trade the pack is an offer sheet
    for (const k of [1, 5, 10]) if (s.n >= k) opts.push(itm('Offer ' + k, nm, () => tradeAdd(i, k)));
    if (s.n > 1) opts.push(itm('Offer all', nm, () => tradeAdd(i, s.n)));
    if (trade.mine.some(q => q[0] === s.id)) opts.push(itm('Withdraw all', nm, () => tradeRemove(trade.mine.findIndex(q => q[0] === s.id), 1e9)));
    opts.push(examineOpt(it));
    return opts;
  }
  if (bankOpen) {   // at the bank it is a deposit sheet; the quantity row drives the first option
    opts.push(itm('Store ' + bankQtyLbl(), nm, () => bankDeposit(s.id, bankQty())));
    const cnt = invCount(s.id);
    if (cnt >= 5) opts.push(itm('Store 5', nm, () => bankDeposit(s.id, 5)));
    if (cnt > 1) opts.push(itm('Store all', nm, () => bankDeposit(s.id, cnt)));
    opts.push(examineOpt(it));
    return opts;
  }
  if (openShop && s.id !== 'coins') opts.push(itm('Sell', nm, () => shopSell(i)));
  /* An armed utility spell takes the next pack click — but never out of an open interface's hands. It used to be the
     first branch, so opening the bank with High Alchemy armed alchemised the first thing you clicked to deposit. */
  if (P.uspell) return opts.concat(itm(P.uspell.n, nm, () => castItem(i)), examineOpt(it));   // an open interface already cleared it, so reaching here means no interface is up
  if (it.equip) opts.push(itm('Wield', nm, () => equip(i)));
  if (it.heal) opts.push(itm('Eat', nm, () => eat(i)));
  if (it.opt) opts.push(itm(it.opt[0], nm, () => it.opt[1](i)));
  if (it.bury) opts.push(itm('Bury', nm, () => bury(s.id)));
  opts.push(itm(useSel && useSel.i === i ? 'Cancel use' : 'Use', nm, () => { if (useSel && useSel.i === i) clearUse(); else { useSel = { i, id: s.id, name: nm }; dirty.inv = 1; hoverObj = undefined; } }));
  if (it.fire) opts.push(itm('Light', nm, () => lightLogs(s.id)));
  opts.push(itm('Drop', nm, () => { dropItem(s.id, s.n, P.tx, P.tz); inv[i] = null; dirty.inv = 1; }), examineOpt(it));
  return opts;
}
function examine(it) {
  if (it.equip) {
    const mat = it.tname || (it.tier !== undefined && TIERS[it.tier] ? TIERS[it.tier].n : ''), kind = it.slot === 'weapon' ? 'weapon' : it.slot === 'ammo' ? 'ammunition' : 'piece of equipment';
    return it.name + '. ' + (mat ? 'A ' + mat.toLowerCase() + ' ' + kind : 'A fine ' + kind) + ', worth about ' + sellPrice(it) + ' coins.' +
      (it.two ? ' Needs both hands.' : '') + (it.reach > 1 ? ' Strikes from ' + it.reach + ' tiles.' : '') +
      (it.save ? ' Recovers about ' + Math.round(it.save * 100) + '% of fired ammunition.' : '') + (RING_NOTES[it.id] || '');
  }
  if (it.heal) return it.name + '. Restores ' + it.heal + ' hitpoints.';
  if (it.fire) return it.name + '. A bundle of firewood.';
  return it.name + '.';
}
const optLabel = o => o.t + ' <span class="' + (o.cls === 'itm' ? 'itm' : 'obj') + '">' + o.o + '</span>';
function openCtx(x, y, opts) {
  if (!opts.length) return;
  ctxEl.innerHTML = '<h3>Choose Option</h3>';
  const add = (html, f) => { const a = document.createElement('a'); a.innerHTML = html; a.onclick = f; ctxEl.appendChild(a); };
  for (const o of opts) add(optLabel(o), () => { closeCtx(); o.f(); });
  add('Cancel', closeCtx);
  ctxEl.style.display = 'block';
  ctxEl.style.left = Math.min(x, innerWidth - ctxEl.offsetWidth - 4) + 'px';
  ctxEl.style.top = Math.min(y, innerHeight - ctxEl.offsetHeight - 4) + 'px';
}
const closeCtx = () => { ctxEl.style.display = 'none'; };
let ctxAte = 0;   // the click that dismisses a menu is spent on it
on(window, 'pointerdown', e => {
  dragAte = 0;   // every gesture starts here: a stale drag flag cannot eat a real click
  if (e.button === 0 && ctxEl.style.display === 'block' && !(e.target instanceof Node && ctxEl.contains(e.target))) { closeCtx(); ctxAte = 1; }
}, true);
on(window, 'click', () => { ctxAte = 0; dragAte = 0; });

/* ---- 29. MINIMAP: 120 px over 360 tiles, painted a few rows a frame and cached; only the markers repaint as you move ---- */
const mini = el('minimap'), mctx = mini.getContext('2d'), MW = mini.width;
let MSPAN = 360, MSTEP = MSPAN / MW;   // tiles across, tiles per pixel: the wheel and a pinch change them
const mimg = mctx.createImageData(MW, MW), MROW = new Float32Array(MW + 2);
const mapCan = document.createElement('canvas'); mapCan.width = mapCan.height = MW;
const mapCtx = mapCan.getContext('2d');
let mapOX = 1e9, mapOZ = 0, mapRow = MW, mapImg = null, imgX = 0, imgZ = 0, imgStep = MSTEP;   // img*: the centre and scale of the cached picture
/* paint one map pixel: water by depth, land by the terrain palette shaded by the eastward gradient */
function mapPixel(data, p, x, z, h, grad, tpp, k, lo) {
  let R, G, B;
  if (h < 0) {   // the maps blend the lava in across the buffer too
    const t = clamp(-h / 14, 0, 1), b = wildBlend(x, z);
    R = 46 - t * 22 + (175 + clamp(-h / 10, 0, 1) * 70 - (46 - t * 22)) * b;
    G = 92 - t * 44 + (62 + clamp(-h / 10, 0, 1) * 42 - (92 - t * 44)) * b;
    B = 116 - t * 50 + (18 - (116 - t * 50)) * b;
  }
  else { const c = colorAt(x, z, h, Math.abs(grad) / tpp), sh = clamp(0.94 - grad * k, lo, 1.3); R = c[0] * 255 * sh; G = c[1] * 255 * sh; B = c[2] * 255 * sh; }
  data[p] = R; data[p + 1] = G; data[p + 2] = B; data[p + 3] = 255;
}
function mapTick() {
  if (mapRow >= MW) {
    if (Math.abs(P.rx - mapOX) + Math.abs(P.rz - mapOZ) < MSTEP * 7) return;
    mapOX = P.rx; mapOZ = P.rz; mapRow = 0;
  }
  const ox = mapOX - MSPAN / 2, oz = mapOZ - MSPAN / 2;
  for (let r = 0; r < 3 && mapRow < MW; r++, mapRow++) {   // three rows a frame: the old picture holds, rescaled, while the repaint walks down
    const j = mapRow, z = oz + j * MSTEP;
    for (let i = 0; i <= MW; i++) MROW[i] = macroHeight(ox + i * MSTEP, z);
    for (let i = 0; i < MW; i++) mapPixel(mimg.data, (j * MW + i) * 4, ox + i * MSTEP, z, MROW[i], MROW[i + 1] - MROW[i], MSTEP, 0.085, 0.4);
  }
  if (mapRow >= MW) { mapCtx.putImageData(mimg, 0, 0); mapImg = 1; imgX = mapOX; imgZ = mapOZ; imgStep = MSTEP; }
}
/* round, player-centred, turning with the camera: rotating by yaw + PI puts the view direction at the top */
function mapMarks() {
  if (!mapImg) return;
  const C = MW / 2, k = 1 / MSTEP;
  mctx.clearRect(0, 0, MW, MW);
  mctx.save();
  mctx.beginPath(); mctx.arc(C, C, C - 1, 0, TAU); mctx.clip();
  mctx.translate(C, C); mctx.rotate(yaw + PI);
  const sc = imgStep / MSTEP;   // an older picture is shown rescaled until the repaint lands
  mctx.drawImage(mapCan, -C * sc + (imgX - P.rx) * k, -C * sc + (imgZ - P.rz) * k, MW * sc, MW * sc);
  const dot = (x, z, col, s) => { const px = (x - P.rx) * k, pz = (z - P.rz) * k; if (px * px + pz * pz > C * C) return; mctx.fillStyle = col; mctx.fillRect(px - s / 2, pz - s / 2, s, s); };
  for (const o of (MSPAN <= 140 ? closeList() : nearObjs)) {   // the tight zooms only ever show the short list
    if (depleted.has(o.key)) continue;
    if (o.t === 2) dot(o.x, o.z, '#7fd8ff', 2);
    else if (o.t === 5) dot(o.x, o.z, '#ffd34a', 4);
    else if (o.t === 7) dot(o.x, o.z, '#ffffff', 4);
    else if (o.t === 10) dot(o.x, o.z, '#ffb02a', 4);
    else if (o.t > 2) dot(o.x, o.z, MK_ART[o.t] ? MK_ART[o.t][1] : '#ff7fd8', 3);
    else if (Math.abs(o.x - P.rx) < 34 && Math.abs(o.z - P.rz) < 34) dot(o.x, o.z, o.t ? '#c9a24a' : '#2f6b2a', 2);
  }
  for (const d of drops) dot(d.x, d.z, '#e04a4a', 2);
  for (const f of fires) dot(f.x, f.z, '#ff9b21', 2);
  for (const nn of npcs) dot(nn.tx, nn.tz, '#ffe14a', 3);
  if (marker.visible) dot(marker.position.x, marker.position.z, '#ffe14a', 3);
  if (P.hs) dot(P.hs.x + 4, P.hs.z + 4, '#e8d9b0', 4);   // your house
  if (deathSpot) {   // the skull rides the minimap too, counter-rotated to stay upright
    const px2 = (deathSpot.x - P.rx) * k, pz2 = (deathSpot.z - P.rz) * k;
    if (px2 * px2 + pz2 * pz2 <= (C - 4) * (C - 4)) {
      mctx.save(); mctx.translate(px2, pz2); mctx.rotate(-(yaw + PI)); mctx.drawImage(_dmc, -6, -6, 12, 12); mctx.restore();
    }
  }
  mctx.restore();
  mctx.fillStyle = 'rgba(255,255,255,.20)';
  mctx.beginPath(); mctx.moveTo(C, C); mctx.lineTo(C - 7, C - 17); mctx.lineTo(C + 7, C - 17); mctx.closePath(); mctx.fill();
  mctx.fillStyle = '#fff'; mctx.fillRect(C - 1.5, C - 1.5, 3, 3);
  const na = -(yaw + PI) - PI / 2;   // north pip on the rim
  mctx.fillStyle = '#e04a4a';
  mctx.beginPath(); mctx.arc(C + Math.cos(na) * (C - 7), C + Math.sin(na) * (C - 7), 3.4, 0, TAU); mctx.fill();
}

/* ---- 30. CONTROLS: the mouse moves the character, the keys swing the camera ---- */
let yaw = 0.7, pitch = 0.95, dist = 40;
const keys = Object.create(null);
on(window, 'keydown', e => {
  if (document.activeElement.tagName === 'INPUT') return;
  keys[e.code] = true;
  if (e.code === 'Space') { P.run = P.run ? 0 : 1; dirty.orb = 1; say('Run mode ' + (P.run ? 'enabled' : 'disabled') + '.'); }
  if (KEY_TAB[e.code]) { if ('IEK'.indexOf(e.code[3]) >= 0) closeOverlays(); showTab(KEY_TAB[e.code]); }
  if (e.code === 'Backquote') { e.preventDefault(); devEl.classList.contains('on') ? closeDev() : devGate(); }
  if (e.code === 'Escape') { closeCtx(); closeOverlays(); closeDev(); clearUse(); closeWorldMap(); }
  if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].indexOf(e.code) >= 0) e.preventDefault();
});
on(window, 'keyup', e => { keys[e.code] = false; });
const dom = renderer.domElement, ndc = new THREE.Vector2(), rc = new THREE.Raycaster();
let mx = -1, my = -1, hoverObj = null, drag = 0, dragged = 0, lx = 0, ly = 0;
function rayAt(x, y) { ndc.set(x / innerWidth * 2 - 1, -(y / innerHeight * 2 - 1)); rc.setFromCamera(ndc, camera); return rc.ray; }
on(dom, 'pointerdown', e => {
  closeCtx();
  if (e.button === 2) return;
  drag = 1; dragged = 0; lx = e.clientX; ly = e.clientY;
  dom.setPointerCapture(e.pointerId);
});
on(dom, 'pointermove', e => {
  mx = e.clientX; my = e.clientY;
  if (!drag) return;
  if (Math.abs(e.clientX - lx) + Math.abs(e.clientY - ly) > 3) dragged = 1;
  if (dragged) { yaw -= (e.clientX - lx) * 0.005; pitch = clamp(pitch - (e.clientY - ly) * 0.004, 0.14, 1.45); lx = e.clientX; ly = e.clientY; }
});
on(dom, 'pointerup', e => {
  if (!drag) return;
  drag = 0;
  if (ctxAte) { ctxAte = 0; return; }
  if (dragged || e.button === 2 || (trade && trade.open)) return;
  const ray = rayAt(e.clientX, e.clientY), o = pickObject(ray);
  if (useSel && !o) clearUse();   // bare ground with an item armed puts it away
  if (o) { const opts = optionsFor(o); if (opts.length) { closeOverlays(); opts[0].f(); return; } }
  const g = rayGround(ray);
  if (g) {
    const dx2 = Math.round(g.x), dz2 = Math.round(g.z);
    if (nearDitch(dx2, dz2)) ditchClick(dx2, dz2); else walkTo(g.x, g.z);
  }
});
on(dom, 'contextmenu', e => {
  e.preventDefault();
  if (trade && trade.open) return;
  const ray = rayAt(e.clientX, e.clientY), opts = optionsFor(pickObject(ray)), g = rayGround(ray);
  if (g) {
    const dx2 = Math.round(g.x), dz2 = Math.round(g.z);
    if (nearDitch(dx2, dz2)) opts.push({ t: 'Jump over', o: 'Wilderness ditch', f: () => ditchClick(dx2, dz2) });
    opts.push({ t: 'Walk here', o: '', f: () => walkTo(g.x, g.z) });
  }
  openCtx(e.clientX, e.clientY, opts);
});
on(dom, 'wheel', e => { e.preventDefault(); dist = clamp(dist * (1 + Math.sign(e.deltaY) * 0.12), 8, 190); }, { passive: false });
/* touch: one finger orbits (the pointer path above), two fingers pinch to zoom */
const touches = new Map();
let pinchD = 0;
const spanOf = m => { const it = m.values(), a = it.next().value, b = it.next().value; return Math.hypot(a.x - b.x, a.y - b.y); };
on(dom, 'pointerdown', e => {
  if (e.pointerType !== 'touch') return;
  touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (touches.size === 2) { pinchD = spanOf(touches); drag = 0; dragged = 1; }
});
on(dom, 'pointermove', e => {
  if (e.pointerType !== 'touch' || !touches.has(e.pointerId)) return;
  touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (touches.size !== 2) return;
  e.preventDefault();
  const d2 = spanOf(touches);
  if (pinchD > 0 && d2 > 0) dist = clamp(dist * (pinchD / d2), 8, 190);
  pinchD = d2;
}, { passive: false });
on(dom, 'pointerup pointercancel', e => {
  if (e.pointerType !== 'touch') return;
  touches.delete(e.pointerId);
  if (touches.size < 2) pinchD = 0;
  if (touches.size === 0) dragged = 0;
});
dom.style.touchAction = 'none';
/* item on item: a tinderbox meets logs, and that is the whole chemistry set */
function combineItems(ai, bi) {
  const A = inv[ai], B = inv[bi]; if (!A || !B) return 0;
  const logs = ITEMS[A.id].fire ? A : ITEMS[B.id].fire ? B : null, tin = A.id === 'tinderbox' ? A : B.id === 'tinderbox' ? B : null;
  if (logs && tin && logs !== tin) { lightLogs(logs.id); return 1; }
  const pA = ITEMS[A.id].pot, dA = ITEMS[A.id].dose || 0, dB = ITEMS[B.id].dose || 0;
  if (pA && pA === ITEMS[B.id].pot) {   // decanting, as ever: (3)+(2) is (4)+(1), (2)+(2) one (4)
    const hi = Math.min(4, dA + dB), lo = dA + dB - hi;
    if (hi === Math.max(dA, dB)) return 0;   // the fuller one is already full: nothing pours
    inv[bi] = { id: pA.k + '_' + hi, n: 1 };
    inv[ai] = lo ? { id: pA.k + '_' + lo, n: 1 } : null;
    dirty.inv = 1; markDirty();
    say('You pour one potion into the other.');
    return 1;
  }
  if (A.id === B.id) return 0;
  const rows = RECIPES.filter(r => !r.at && usesItem(r, A.id) && usesItem(r, B.id));
  if (!rows.length) return 0;
  if (rows.length === 1) startMake(rows[0]); else showMake(ITEMS[A.id].name + ' + ' + ITEMS[B.id].name, rows);
  return 1;
}
/* carrying an item to another slot: pointer events, so one path covers mouse and touch; a short press is still a click */
const dgEl = el('dghost');
let dgFrom = -1, dgX = 0, dgY = 0, dgOn = 0, dgOver = -1, dragAte = 0, dgLong = 0, dgTouch = 0;
const slotUnder = (x, y) => { const t = document.elementFromPoint(x, y), s = t && t.closest ? t.closest('.slot') : null; return s ? +s.dataset.i : -1; };
function dgPaint(i) {
  const want = (i >= 0 && i !== dgFrom) ? i : -1;
  if (dgOver === want) return;
  if (dgOver >= 0) slotEls[dgOver].classList.remove('over');
  dgOver = want;
  if (dgOver >= 0) slotEls[dgOver].classList.add('over');
}
const dgClearLong = () => { if (dgLong) { clearTimeout(dgLong); dgLong = 0; } };
on(invGrid, 'pointerdown', e => {
  if (e.button !== 0 || (trade && trade.open)) return;
  const s = e.target.closest('.slot'); if (!s) return;
  const i = +s.dataset.i; if (!inv[i]) return;
  dgFrom = i; dgX = e.clientX; dgY = e.clientY; dgOn = 0; dgOver = -1; dgTouch = e.pointerType === 'touch';
  try { invGrid.setPointerCapture(e.pointerId); } catch {}
  dgClearLong();
  if (dgTouch) {   // a finger held still on a slot is a right-click
    const ci = i, cx = e.clientX, cy = e.clientY;
    dgLong = setTimeout(() => {
      dgLong = 0;
      if (dgFrom !== ci || dgOn) return;
      dgFrom = -1;
      slotEls[ci].classList.remove('drag'); dgPaint(-1); dgEl.style.display = 'none';
      dragAte = 1; vibrate();
      openCtx(cx, cy, itemOptions(ci));
    }, 420);
  }
});
on(invGrid, 'pointermove', e => {
  if (dgFrom < 0) return;
  if (!dgOn) {
    if (Math.abs(e.clientX - dgX) + Math.abs(e.clientY - dgY) < 8) return;
    dgClearLong(); dgOn = 1;
    dgEl.innerHTML = img(inv[dgFrom].id); dgEl.style.display = 'block';
    slotEls[dgFrom].classList.add('drag');
  }
  dgEl.style.transform = 'translate(' + (e.clientX - 16) + 'px,' + (e.clientY - 16) + 'px)';
  dgPaint(slotUnder(e.clientX, e.clientY));
});
function dgEnd(e) {
  dgClearLong();
  if (dgFrom < 0) return;
  const from = dgFrom, moved = dgOn;
  dgFrom = -1; dgOn = 0;
  slotEls[from].classList.remove('drag'); dgPaint(-1); dgEl.style.display = 'none';
  if (!moved) return;
  dragAte = 1;
  const to = slotUnder(e.clientX, e.clientY);
  if (to < 0 || to === from) return;
  const t = inv[to]; inv[to] = inv[from]; inv[from] = t;
  if (useSel) { if (useSel.i === from) useSel.i = to; else if (useSel.i === to) useSel.i = from; }   // an armed item follows its slot
  dirty.inv = 1; markDirty();
}
on(invGrid, 'pointerup', dgEnd);
on(invGrid, 'pointercancel', e => { dgClearLong(); dgOn = 0; dgEnd(e); });
on(invGrid, 'click', e => {
  if (dragAte) { dragAte = 0; return; }
  if (ctxAte) { ctxAte = 0; return; }
  let s = e.target.closest('.slot');   // pointer capture can land the click on the grid itself
  if (!s) { const u = slotUnder(e.clientX, e.clientY); if (u >= 0) s = slotEls[u]; }
  if (!s) return clearUse();
  const i = +s.dataset.i;
  if (trade && trade.open) return tradeAdd(i);
  if (e.shiftKey && inv[i] && !bankOpen && !openShop && !useSel) {   // shift-click sheds the stack at your feet, as ever
    const s2 = inv[i];
    dropItem(s2.id, s2.n, P.tx, P.tz);
    inv[i] = null; dirty.inv = 1; markDirty();
    return;
  }
  if (useSel) {
    const from = useSel.i;
    if (from === i) return clearUse();
    if (inv[i] && !combineItems(from, i)) say('Nothing interesting happens.');
    clearUse();
    return;
  }
  const opts = itemOptions(i);
  if (opts.length) opts[0].f();
});
on(invGrid, 'contextmenu', e => { e.preventDefault(); const s = e.target.closest('.slot'); if (s) openCtx(e.clientX, e.clientY, itemOptions(+s.dataset.i)); });
on(eqWrap, 'click', e => {
  if (ctxAte) { ctxAte = 0; return; }
  const d = e.target.closest('.eqslot'); if (d && d.dataset.s) unequip(d.dataset.s);
});
el('orbRun').onclick = () => { P.run = P.run ? 0 : 1; dirty.orb = 1; };
/* the pack and the chat log fold away to their handles */
el('chatmin').onclick = () => { const c = document.body.classList.toggle('chatmin'); el('chatmin').textContent = c ? '+' : '–'; if (!c) chatEl.scrollTop = chatEl.scrollHeight; };
el('invmin').onclick = () => { const c = document.body.classList.toggle('invmin'); el('invmin').textContent = c ? '+' : '–'; el('invmin').title = c ? 'open the pack' : 'minimise the pack'; };
on(chatEl, 'touchstart touchmove wheel', e => e.stopPropagation(), { passive: true });   // the log claims its own scrolls
const chatIn = el('chatin');
on(chatIn, 'keydown', e => {   // Enter focuses the bar, Enter again sends
  e.stopPropagation();
  if (e.key === 'Escape') return chatIn.blur();
  if (e.key !== 'Enter') return;
  const t = chatIn.value.trim().slice(0, 120);
  chatIn.value = '';
  if (!t) return chatIn.blur();
  say((NAME || 'You') + ': ' + t);
  if (ws && ws.readyState === 1) wsSend([4, t]); else say('(offline — nobody heard that)', 'bad');
});
on(window, 'keydown', e => { if (e.key === 'Enter' && document.activeElement !== chatIn && document.activeElement.tagName !== 'INPUT') { e.preventDefault(); chatIn.focus(); } }, true);
on(mini, 'click', e => {   // a click on the minimap walks you there; the tail of a pinch does not
  const r = mini.getBoundingClientRect(), px = (e.clientX - r.left) / r.width * MW - MW / 2, pz = (e.clientY - r.top) / r.height * MW - MW / 2;
  if (mPinched || px * px + pz * pz > (MW / 2) * (MW / 2)) return;
  const a = -(yaw + PI), cs = Math.cos(a), sn = Math.sin(a);
  walkTo(P.rx + (px * cs - pz * sn) * MSTEP, P.rz + (px * sn + pz * cs) * MSTEP);
});
el('wmBtn').onclick = () => { if (wmOpen) closeWorldMap(); else openWorldMap(); };
/* the wheel or two fingers zoom the minimap between 90 and 1440 tiles across; the picture repaints at the new scale */
function miniZoom(f) { MSPAN = clamp(MSPAN * f, 90, 1440); MSTEP = MSPAN / MW; mapOX = 1e9; mapRow = MW; }
on(mini, 'wheel', e => { e.preventDefault(); miniZoom(e.deltaY < 0 ? 0.8 : 1.25); }, { passive: false });
const mPtr = new Map();
let mPinch = 0, mPinched = 0;
on(mini, 'pointerdown', e => { if (e.pointerType !== 'touch') return; mPtr.set(e.pointerId, { x: e.clientX, y: e.clientY }); if (mPtr.size === 1) mPinched = 0; else if (mPtr.size === 2) mPinch = spanOf(mPtr); });
on(mini, 'pointermove', e => {
  if (!mPtr.has(e.pointerId)) return;
  mPtr.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (mPtr.size !== 2) return;
  const d = spanOf(mPtr);
  if (mPinch > 0 && d > 0) { miniZoom(mPinch / d); mPinched = 1; }
  mPinch = d;
});
on(mini, 'pointerup pointercancel', e => { mPtr.delete(e.pointerId); if (mPtr.size < 2) mPinch = 0; });

/* ---- 31. WORLD MAP: 64-pixel tiles cached and filled in nearest first; names and door icons from the settlement plans ---- */
const wmEl = el('wmap'), wmCv = el('wmCv'), wmCtx = wmCv.getContext('2d'), wmPos = el('wmPos');
const WM_TPP = 8, WM_TILE = 64, wmTiles = new Map(), wmRow = new Float32Array(WM_TILE + 1);
let wmOpen = 0, wmZoom = 10, wmCx = 0, wmCz = 0, wmW = 0, wmH = 0;   // first open lands fully zoomed on the player; any zoom the player picks then sticks
const wmLod = () => wmZoom >= 4 ? 2 : 8;   // two tiles a pixel once the streets matter
function wmPaintTile(tx, tz, tpp) {
  const span = WM_TILE * tpp, c = document.createElement('canvas'); c.width = c.height = WM_TILE;
  const g = c.getContext('2d'), im = g.createImageData(WM_TILE, WM_TILE), ox = tx * span, oz = tz * span;
  for (let j = 0; j < WM_TILE; j++) {
    const z = oz + (j + 0.5) * tpp;
    for (let i = 0; i <= WM_TILE; i++) wmRow[i] = macroHeight(ox + (i + 0.5) * tpp, z);
    for (let i = 0; i < WM_TILE; i++) mapPixel(im.data, (j * WM_TILE + i) * 4, ox + (i + 0.5) * tpp, z, wmRow[i], wmRow[i + 1] - wmRow[i], tpp, tpp >= 8 ? 0.06 : 0.12, 0.45);
  }
  g.putImageData(im, 0, 0);
  return c;
}
/* a glyph on a dark disc, drawn with the inventory's own vector art */
function discIcon(g, glyph, c, d, x, y, R, tx, ty, sc) {
  g.beginPath(); g.arc(x, y, R, 0, TAU); g.fillStyle = 'rgba(0,0,0,.62)'; g.fill();
  g.save(); g.translate(tx === undefined ? x - R * 0.78 : tx, ty === undefined ? y - R * 0.78 : ty); g.scale(sc || R * 1.56 / 32, sc || R * 1.56 / 32); g.lineWidth = 1.2; g.lineJoin = 'round';
  (GLYPH[glyph] || GLYPH.star)(g, c, d);
  g.restore();
}
for (const s of SHOP_KINDS) MK_ART['shop_' + s.k] = [s.g, s.c, '#f0e6c8', s.n];   // shop doors carry their 07 shop sprites; the glyph stays the fallback
for (const g of GUILDS) MK_ART['guild_' + g.k] = ['lock', '#d8b04a', '#6b4e22', g.n];   // each skill guild wears its own skill's 07 icon; WM_KEY below reads these at load
const wmImgs = new Map();
function wmPng(n) {   // the 07 map sprites, fetched once; a late arrival repaints the map
  let i = wmImgs.get(n);
  if (!i) { i = new Image(); i.onload = () => { wmDirty = 1; }; i.src = mk07p(n); wmImgs.set(n, i); }
  return i.complete && i.naturalWidth ? i : null;
}
function wmIcon(k, x, y, r) {
  const R = r || 8, im = g07(MK07, k) && wmPng(MK07[k]);
  if (!im) return discIcon(wmCtx, ...MK_ART[k].slice(0, 3), x, y, R);
  wmCtx.beginPath(); wmCtx.arc(x, y, R, 0, TAU); wmCtx.fillStyle = 'rgba(0,0,0,.62)'; wmCtx.fill();
  const s = R * 1.7;
  wmCtx.drawImage(im, x - s / 2, y - s / 2, s, s);
}
/* the white lodestone: one artist paints you on the map and in its legend, so the two always agree */
function drawYou(g, x, y, face, R, al) {   // al: arrow reach — the legend shortens it to spend its 20px on the disc
  al = al || 1.9;
  g.beginPath(); g.arc(x, y, R, 0, TAU); g.fillStyle = '#fff'; g.fill(); g.lineWidth = Math.max(2, R * 0.38); g.strokeStyle = '#000'; g.stroke();
  g.beginPath(); g.moveTo(x + Math.sin(face) * R * al, y + Math.cos(face) * R * al);
  g.lineTo(x + Math.sin(face + 2.5) * R * 1.05, y + Math.cos(face + 2.5) * R * 1.05);
  g.lineTo(x + Math.sin(face - 2.5) * R * 1.05, y + Math.cos(face - 2.5) * R * 1.05);
  g.closePath(); g.fillStyle = '#fff'; g.fill(); g.stroke();
}
const WM_KEY = ['bank', 'ge', 'barber', 3, 4, 6, 'altar', 11, 12, 13, 15, 'mine', 'grove', 'guild_mining', 'guild_wood', 'guild_cook'].map(k => [k, MK_ART[k], MK_ART[k][3]])
  .concat(SHOP_KINDS.map(s => ['shop_' + s.k, MK_ART['shop_' + s.k], s.n]), [['house', MK_ART.house, 'Your house'], ['skull', MK_ART.skull, 'Where you fell']]);
function buildWmKey() {   // every row 20px: the 07 sprites a shade smaller than before, drawn fallbacks matched to them
  const key = el('wmKey'), S = 20;
  key.innerHTML = '';   // re-run when the 2007 setting flips: the rows are sprites or glyphs, never both
  const row = (n, label) => { const d = document.createElement('div'); d.appendChild(n); d.appendChild(document.createTextNode(label)); key.appendChild(d); };
  for (const [k, a, label] of WM_KEY) {
    if (k !== null && g07(MK07, k)) { const im = new Image(S, S); im.src = mk07p(MK07[k]); im.style.imageRendering = 'pixelated'; row(im, label); continue; }
    const c = document.createElement('canvas'); c.width = c.height = S;
    discIcon(c.getContext('2d'), a[0], a[1], a[2], S / 2, S / 2, S / 2 - 1, 2.3, 2.3, 26 / 32 * S / 32); row(c, label);
  }
  const yc = document.createElement('canvas'); yc.width = yc.height = S;
  drawYou(yc.getContext('2d'), S / 2, S / 2 + 1.5, PI, 7, 1.5);   // facing up, as the fresh map shows you; sized to sit level with the sprites
  row(yc, 'You');
}
buildWmKey();
function wmResize() {
  const r = wmCv.getBoundingClientRect();
  wmW = Math.max(1, Math.round(r.width)); wmH = Math.max(1, Math.round(r.height));
  wmCv.width = wmW; wmCv.height = wmH;
}
function wmDraw() {
  const W = wmW, H = wmH, s = wmZoom / WM_TPP, px = wx => (wx - wmCx) * s + W / 2, pz = wz => (wz - wmCz) * s + H / 2;
  wmCtx.imageSmoothingEnabled = false;
  wmCtx.fillStyle = '#141c26'; wmCtx.fillRect(0, 0, W, H);
  const half = W / 2 / s, halfZ = H / 2 / s, tpp = wmLod(), span = WM_TILE * tpp, size = span * s;
  const x0 = Math.floor((wmCx - half) / span), x1 = Math.floor((wmCx + half) / span), z0 = Math.floor((wmCz - halfZ) / span), z1 = Math.floor((wmCz + halfZ) / span);
  const missing = [];
  for (let tz = z0; tz <= z1; tz++) for (let tx = x0; tx <= x1; tx++) {
    const c = wmTiles.get(tpp + ':' + tx + ':' + tz);
    if (c) wmCtx.drawImage(c, Math.floor(px(tx * span)), Math.floor(pz(tz * span)), Math.ceil(size) + 1, Math.ceil(size) + 1);
    else missing.push([tx, tz, Math.hypot((tx + 0.5) * span - wmCx, (tz + 0.5) * span - wmCz)]);
  }
  missing.sort((a, b) => a[2] - b[2]);   // ten milliseconds of painting a frame, nearest first
  const t0 = performance.now();
  for (let i = 0; i < missing.length && (i === 0 || performance.now() - t0 < 10); i++) {
    const [tx, tz] = missing[i];
    if (wmTiles.size > 1200) wmTiles.clear();
    wmTiles.set(tpp + ':' + tx + ':' + tz, wmPaintTile(tx, tz, tpp));
  }
  if (missing.length) wmDirty = 1;   // tiles painted this frame still need drawing: come back until the view is whole
  if (wmZoom < 6) {   // the kingdoms, writ large across their seats
    wmCtx.font = '600 ' + Math.round(clamp(13 + wmZoom * 2.4, 15, 26)) + 'px system-ui, sans-serif';
    wmCtx.textAlign = 'center'; wmCtx.textBaseline = 'middle';
    wmCtx.lineWidth = 4; wmCtx.strokeStyle = 'rgba(8,12,16,0.4)'; wmCtx.fillStyle = 'rgba(240,232,206,0.52)';
    let bud = 24;
    for (let a = Math.floor((wmCx - half) / REG_CELL), a1 = Math.floor((wmCx + half) / REG_CELL); a <= a1 && bud > 0; a++)
      for (let b = Math.floor((wmCz - halfZ) / REG_CELL), b1 = Math.floor((wmCz + halfZ) / REG_CELL); b <= b1 && bud > 0; b++) {
        if (b * REG_CELL > 499000) continue;
        const r = regSite(a, b), sx2 = px(r.x), sy2 = pz(r.z);
        if (sx2 < -220 || sy2 < -30 || sx2 > W + 220 || sy2 > H + 30) continue;
        const nm = regionName(r);
        wmCtx.strokeText(nm, sx2, sy2); wmCtx.fillText(nm, sx2, sy2); bud--;
      }
  }
  const cx0 = Math.floor((wmCx - half) * INV_CELL) - 1, cx1 = Math.floor((wmCx + half) * INV_CELL) + 1, cz0 = Math.floor((wmCz - halfZ) * INV_CELL) - 1, cz1 = Math.floor((wmCz + halfZ) * INV_CELL) + 1;
  if (wmZoom >= 0.75 && (cx1 - cx0) * (cz1 - cz0) < 400) {   // names past half zoom, doors past double
    wmCtx.font = 'bold ' + Math.round(clamp(9 + wmZoom * 1.2, 10, 15)) + 'px system-ui, sans-serif';
    wmCtx.textAlign = 'center'; wmCtx.textBaseline = 'bottom';
    const ico = (k, x, z, r) => wmIcon(k, px(x), pz(z), r);
    let vbud = 3;   // a town's plan is 18-51 ms: lay at most a few an frame, as the ruin and site loops below already do
    for (let a = cx0; a <= cx1; a++) for (let b = cz0; b <= cz1; b++) {
      const v = villageAt(a, b); if (!v) continue;
      const x = px(v.x), y = pz(v.z);
      if (x < -80 || y < -40 || x > W + 80 || y > H + 40) continue;
      if (wmZoom >= 2.5) {
        if (!v.b && --vbud < 0) { wmDirty = 1; continue; }   // come back for the rest next frame
        villageBuildings(v);
        for (const bd of v.b) {
          if (bd.shop !== null) ico('shop_' + SHOP_KINDS[bd.shop].k, bd.x, bd.z);
          else if (bd.bank) ico('bank', bd.x, bd.z); else if (bd.barber) ico('barber', bd.x, bd.z);
        }
        for (const f of v.f) ico(f.t, f.x, f.z);
        for (const p of farmPatches(v)) ico(15, p.x, p.z);
        const sm = slayerSpot(v); if (sm) ico(12, sm.x, sm.z);
        if (v.lm && v.lm.t === 0) ico('altar', v.lm.x, v.lm.z);
        if (v.shrine) ico('altar', v.shrine.x, v.shrine.z);
        if (v.booth) ico('bank', v.booth.x, v.booth.z);
        if (v.guild) ico('guild_' + v.guild.g.k, v.guild.x, v.guild.z, 9);   // each skill guild wears its own skill's icon
        if (v.ge) ico('ge', v.ge.x, v.ge.z, 10);
      }
      const nm = villageName(v);
      wmCtx.lineWidth = 3; wmCtx.strokeStyle = 'rgba(0,0,0,.85)'; wmCtx.strokeText(nm, x, y - 4);
      wmCtx.fillStyle = v.rank >= 3 ? '#ffd34a' : '#f4ead0'; wmCtx.fillText(nm, x, y - 4);
    }
    if (wmZoom >= 2.5) for (let a = Math.floor((wmCx - half) / RUIN_CELL), a1 = Math.floor((wmCx + half) / RUIN_CELL), bud = 40; a <= a1; a++)   // rune altars: an unseen cell costs a survey, forty a frame
      for (let b = Math.floor((wmCz - halfZ) / RUIN_CELL), b1 = Math.floor((wmCz + halfZ) / RUIN_CELL); b <= b1; b++) {
        if (!ruinCache.has(a * 8191 + b) && --bud < 0) continue;
        const R = ruinAt(a, b); if (R) ico(11, R.x, R.z);
      }
    if (wmZoom >= 2.2) {   // the named mines and groves; their names arrive at close zoom
      let bud = 60;
      const nameIt = wmZoom >= 5.5;
      if (nameIt) { wmCtx.font = 'bold 11px system-ui, sans-serif'; wmCtx.textBaseline = 'bottom'; }
      for (let a = Math.floor((wmCx - half) / SITE_CELL), a1 = Math.floor((wmCx + half) / SITE_CELL); a <= a1; a++)
        for (let b = Math.floor((wmCz - halfZ) / SITE_CELL), b1 = Math.floor((wmCz + halfZ) / SITE_CELL); b <= b1; b++) {
          if (!siteCache.has(a * 8191 + b) && --bud < 0) continue;
          const s = siteAt(a, b);
          if (!s || s.t === 3) continue;
          ico(s.t === 1 ? 'mine' : 'grove', s.x, s.z, 7);
          if (nameIt) {
            const sx2 = px(s.x), sy2 = pz(s.z) - 9;
            wmCtx.lineWidth = 3; wmCtx.strokeStyle = 'rgba(0,0,0,.85)'; wmCtx.strokeText(s.name, sx2, sy2);
            wmCtx.fillStyle = '#cfd6c0'; wmCtx.fillText(s.name, sx2, sy2);
          }
        }
    }
  }
  if (P.hs) wmIcon('house', px(P.hs.x + 4), pz(P.hs.z + 4), 9);   // your house, at any zoom
  if (deathSpot) wmIcon('skull', px(deathSpot.x), pz(deathSpot.z), 10);   // where you fell, at any zoom
  const sx = px(P.rx), sy = pz(P.rz);   // you, and only you — the legend's own mark, writ larger
  if (sx > -18 && sy > -18 && sx < W + 18 && sy < H + 18) drawYou(wmCtx, sx, sy, P.face, 8);
}
let wmDirty = 1, wmPX = 1e9, wmPZ = 1e9;
function wmLoop() {
  if (!wmOpen) return;
  if (Math.abs(P.rx - wmPX) + Math.abs(P.rz - wmPZ) > 0.5) { wmDirty = 1; wmPX = P.rx; wmPZ = P.rz; }   // redraw only on pan, zoom or movement
  if (wmDirty) { wmDirty = 0; wmDraw(); }
  requestAnimationFrame(wmLoop);
}
function openWorldMap() { if (wmOpen) return; wmOpen = 1; wmDirty = 1; wmEl.classList.add('on'); wmCx = P.rx; wmCz = P.rz; wmResize(); wmLoop(); }
function closeWorldMap() { wmOpen = 0; wmEl.classList.remove('on'); }
el('wmX').onclick = closeWorldMap;
function wmZoomAt(sx, sy, f) {   // the tile under the cursor stays under it
  const s0 = wmZoom / WM_TPP, wx = wmCx + (sx - wmW / 2) / s0, wz = wmCz + (sy - wmH / 2) / s0;
  wmZoom = clamp(wmZoom * f, 0.5, 10);
  const s1 = wmZoom / WM_TPP;
  wmCx = wx - (sx - wmW / 2) / s1; wmCz = wz - (sy - wmH / 2) / s1;
  wmDirty = 1;
}
el('wmIn').onclick = () => wmZoomAt(wmW / 2, wmH / 2, 1.4);
el('wmOut').onclick = () => wmZoomAt(wmW / 2, wmH / 2, 1 / 1.4);
el('wmHome').onclick = () => { wmCx = P.rx; wmCz = P.rz; wmDirty = 1; };
on(wmCv, 'wheel', e => { e.preventDefault(); const r = wmCv.getBoundingClientRect(); wmZoomAt(e.clientX - r.left, e.clientY - r.top, e.deltaY < 0 ? 1.2 : 1 / 1.2); }, { passive: false });
/* one finger or the left button pans, two fingers pinch, the middle button drags to zoom */
const wmPtr = new Map();
let wmPinch = 0;
on(wmCv, 'pointerdown', e => {
  e.preventDefault();
  try { wmCv.setPointerCapture(e.pointerId); } catch {}
  wmPtr.set(e.pointerId, { x: e.clientX, y: e.clientY, b: e.button });
  if (wmPtr.size === 2) wmPinch = spanOf(wmPtr);
});
on(wmCv, 'pointermove', e => {
  const r = wmCv.getBoundingClientRect(), s = wmZoom / WM_TPP;
  const wx = Math.round(wmCx + (e.clientX - r.left - wmW / 2) / s), wz = Math.round(wmCz + (e.clientY - r.top - wmH / 2) / s);
  wmPos.textContent = wx + ', ' + wz + ' — ' + biomeName(heightAt(wx, wz), wx, wz);
  const prev = wmPtr.get(e.pointerId);
  if (!prev) return;
  wmPtr.set(e.pointerId, { x: e.clientX, y: e.clientY, b: prev.b });
  if (wmPtr.size === 2) {
    const d = spanOf(wmPtr);
    if (wmPinch > 0 && d > 0) { const it = wmPtr.values(), a = it.next().value, b = it.next().value; wmZoomAt((a.x + b.x) / 2 - r.left, (a.y + b.y) / 2 - r.top, d / wmPinch); }
    wmPinch = d;
  } else if (prev.b === 1) wmZoomAt(wmW / 2, wmH / 2, Math.exp(-(e.clientY - prev.y) * 0.012));
  else { wmCx -= (e.clientX - prev.x) / s; wmCz -= (e.clientY - prev.y) / s; wmDirty = 1; }
});
on(wmCv, 'pointerup pointercancel', e => { wmPtr.delete(e.pointerId); if (wmPtr.size < 2) wmPinch = 0; });
on(wmCv, 'contextmenu', e => e.preventDefault());
on(window, 'contextmenu', e => { if (e.target.closest('#ctx')) e.preventDefault(); });
on(window, 'resize', () => {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight);
  if (wmOpen) { wmResize(); wmDirty = 1; }
});
/* ---- 32. RESET ---- */
function hashSeed(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
const resetLookups = () => { _lcx = _lcz = 1e9; _llist = []; _nvx = _nvz = 1e9; _nvr = null; roadCache.clear(); _rcx = _rcz = 1e9; _rlist = [];
  _rgx = _rgz = 1e9; _rgv = null; _stx = _stz = 1e9; _str = null; _wlx = _wlz = 1e9; _dtx = _dtz = 1e9; };
function loadSeed(str) {
  tickN = globalTick() - 1;   // join the world's clock, not a fresh one
  S = hashSeed(str) | 0;
  villageCache = new Map(); nbrCache = new Map(); resetLookups(); _bx = _bz = 1e9;
  for (const [, rec] of chunks) disposeChunk(rec);
  chunks.clear(); pending.length = 0; tilesGenerated = 0;
  blocked.clear(); opaque.clear(); depleted.clear(); objIndex.clear(); floorMap.clear();
  wmTiles.clear(); wmDirty = 1;   // the tile keys carry no seed, so the old coastline would render under the new towns   // opaque is the sight half of blocked: leaving it standing blinds aggro in the next world
  drops.length = 0; pendingPiles.length = 0; pvpFoes.clear(); npcDead.clear(); indoors = null; mhCache.clear(); popQueue.length = 0;   // a fresh world settles every grudge
  for (const pid of [...housesReg.keys()]) clearHouse(pid);  // houses belong to a world; the next save and snapshot restock them
  for (const L of pickLists) { for (const o of L) o.dead = 1; L.length = 0; }   // fires, traps, campsite furniture, house ghosts: a world's litter dies with it, and a live task drops it
  litMap.clear(); bmOn = 0; moveSel = null;
  hsAsked = 0; if (hsBarEl) hsBarEl.style.display = 'none'; hsHintClear();   // a fresh world asks fresh questions
  for (const n of npcs) scene.remove(n.mesh);
  npcs.length = 0;
  closeOverlays();
  // spawn inside the settlement nearest the origin: town ground is truce ground
  let bx = 0, bz = 0;
  const sv = homeVillage();
  if (sv) { const s = safeSpotIn(villageAt(sv.cx, sv.cz)); bx = s.x; bz = s.z; }
  else {
    let best = -1e9;
    for (let i = 0; i < 900; i++) {
      const x = ((hash2(i, 3, S) % 6000) | 0) - 3000, z = ((hash2(i, 7, S) % 6000) | 0) - 3000, h = macroHeight(x, z);
      const sc = h > 3 && h < 22 ? 100 - Math.abs(h - 9) - Math.hypot(x, z) * 0.004 : -1e9;
      if (sc > best) { best = sc; bx = x; bz = z; }
    }
  }
  ORIGIN.x = bx; ORIGIN.z = bz;   // the canonical spawn anchors the danger gradient for every client
  teleport(bx, bz, 300);
  P.home.x = bx; P.home.z = bz;
  const n = nearVillage(bx, bz);
  say(n ? 'You arrive at ' + villageName(n.v) + ', a ' + TIER_N[n.v.rank] + '.' : 'You arrive on an unnamed shore.', 'lv');
}
/* the World tab: travelling never changes the seed, only your place in it */
const wxEl = el('wx'), wzEl = el('wz');
const offMap = (x, z) => !isFinite(x) || !isFinite(z) || Math.abs(x) > 2e6 || Math.abs(z) > 2e6;
function travelTo(x, z) {
  x = Math.round(x); z = Math.round(z);
  if (offMap(x, z)) return say('Those coordinates are off the map.', 'bad');
  // the World tab is the admin debug teleport: no wilderness cap here — the spells and items keep theirs (tpTo)
  closeOverlays();
  teleport(x, z, 400);
  wxEl.value = P.tx; wzEl.value = P.tz;
  say('You travel to ' + P.tx + ', ' + P.tz + ' — ' + biomeName(walkY(P.tx, P.tz), P.tx, P.tz) + '.', 'lv');
  markDirty();
}
el('go').onclick = () => travelTo(parseInt(wxEl.value, 10) || 0, parseInt(wzEl.value, 10) || 0);
for (const b of [wxEl, wzEl]) b.onkeydown = e => { e.stopPropagation(); if (e.key === 'Enter') el('go').click(); };
el('rnd').onclick = () => {   // somewhere else in the same world, judged on macro height alone
  let best = null, bs = -1e9, judged = 0;
  for (let i = 0; i < 400 && judged < 24; i++) {
    const a = Math.random() * TAU, r = 300 + Math.random() * 5200, x = Math.round(P.tx + Math.cos(a) * r), z = Math.round(P.tz + Math.sin(a) * r), h = macroHeight(x, z);
    if (h < 2.4 || h > 26) continue;
    judged++;
    const sl = Math.abs(macroHeight(x + 3, z) - h) + Math.abs(macroHeight(x, z + 3) - h), sc = -sl * 3 + Math.random() * 1.5;
    if (sc > bs) { bs = sc; best = [x, z]; }
  }
  if (!best) return say('Nothing but sea and stone out there — roll again.', 'bad');
  travelTo(best[0], best[1]);
};
function setStuck(v) {
  OPT.stuck = v;
  P.stuckT = 0; P.span = 1; stopWalk();   // the old route was judged by old rules
  el('stuck').classList.toggle('on', !!v);
  say(v ? 'Stuck mode on — you can climb almost anything, slowly.' : 'Stuck mode off — back to normal footing.', 'lv');
  updateZoneTags();
}
function openStuck() {
  const on = OPT.stuck;
  showModal('Stuck?', '<p class="smsg">Some ground turns you back: cliff faces, mountain ledges, the steep sides of a valley. <b>Stuck mode</b> lets you clamber up all of it, so every corner of the map becomes reachable.</p>' +
    '<p class="smsg">The price is pace — you move <b>five times slower</b> while it is on. Walls, houses and castle keeps still stop you: this is for landscape, not for masonry.</p>' +
    '<div class="wrow2"><button id="stuckTog">' + (on ? 'Turn stuck mode off' : 'Turn stuck mode on') + '</button></div>', on ? 'Stuck mode is ON — you are crawling.' : 'Stuck mode is off.');
  el('stuckTog').onclick = () => { setStuck(OPT.stuck ? 0 : 1); closeOverlays(); };
}
el('stuck').onclick = () => { if (!OPT.stuck) openStuck(); else setStuck(0); };   // turning it on gets the explanation; off is one click
function updateZoneTags() {
  el('stuckTag').style.display = OPT.stuck ? 'block' : 'none';
  const wl = wildLvAt(P.tx, P.tz), t = el('pvpTag');
  t.style.display = wl ? 'flex' : 'none';
  if (wl && t._lv !== wl) { t._lv = wl; t.querySelector('span').textContent = 'Wilderness · level ' + wl; }
}
function drawPvpTag() { el('pvpTag').querySelector('img').src = g07(MK07, 'pvp') ? mk07p(MK07.pvp) : drawIcon('skull', '#ff5a3a', '#ffd9c9'); }
drawPvpTag();

/* ---- 33. THE GAME TICK: everything with consequences, ten times per six seconds; frames only interpolate ---- */
function gameTick() {
  tickN++;
  if (deathSpot && tickN - deathSpot.t > 1500) { deathSpot = null; deathMark.visible = false; wmDirty = 1; }
  if (P.dead) { netPiles(); flushNet(); return; }   // die() queues the op 12 loot spill; it must not sit in outQ for the 1500 ms respawn
  walkTick(); taskTick(); updateHeldTool();
  for (let i = npcs.length - 1; i >= 0; i--) npcTick(npcs[i]);
  respawnTick();
  for (const f of tickHooks) f();
  if (tickN % 50 === 0) {   // lowered stats climb back every 100 ticks (50 under Rapid Restore), boosts fall every 100 (150 under Preserve)
    const up = tickN % (prayHas('restore') ? 50 : 100) === 0, down = tickN % (prayHas('preserve') ? 150 : 100) === 0;
    for (let i = 0; i < NSK; i++) if (bst[i] < 0 ? up : bst[i] > 0 && down) { bst[i] -= Math.sign(bst[i]); dirty.sk = 1; }
  }
  if ((!P.moved || !P.run) && P.energy < 100) { P.energy = Math.min(100, P.energy + (15 + Math.floor(lvl[SK.agility] / 10)) / 100); dirty.orb = 1; }   // restore: (15 + agility/10) units a tick, the wiki's own rate
  if (tickN % (P.dreamT > tickN ? 33 : prayHas('heal') || capeOn('hitpoints') ? 50 : 100) === 0 && P.hp < P.maxhp) { P.hp++; dirty.orb = 1; }   // one point a minute, twice as fast under Rapid Heal or the hitpoints cape (they never stack); three times inside a Moonclan dream
  if (tickN % 100 === 0 && P.hp > P.maxhp) { P.hp--; dirty.orb = 1; }   // an overfed brew or anglerfish settles back a point a minute
  if (P.prayers) {
    let drain = 0;
    for (const p of PRAYERS) if (P.prayers & p.bit) drain += p.drain;
    P.pray -= drain / (1 + bonus('pb') / 30);   // wiki: every point of prayer bonus stretches the drain by a thirtieth
    if (P.pray <= 0) { P.pray = 0; P.prayers = 0; sfx(2672); say('You have run out of prayer points.', 'bad'); drawPrayers(); }
    dirty.orb = 1;
  }
  if (tickN - (P.specT || 0) >= (eq.ring === 'lightbearer' ? 25 : 50)) { P.specT = tickN; if (P.spec < 100) { P.spec = Math.min(100, P.spec + 10); if (SPEC[eq.weapon]) drawStyles(); } }   // a free-running 30-second cycle: stamping it only while draining refunded on the very next tick
  if (P.psn > 0 && tickN >= P.psnT && !P.dead) {   // poison bites every 30 ticks; the wound shallows one point per five bites
    P.psnT = tickN + 30;
    hurtSnd = 2408; hurtPlayer(P.psn);   // the wound hisses instead of grunting
    if (++P.psnN % 5 === 0 && --P.psn <= 0) { P.psn = 0; say('The poison has worn off.', 'good'); }
  }
  for (let i = drops.length - 1; i >= 0; i--) if (tickN >= drops[i].until) drops.splice(i, 1);
  for (let i = pendingPiles.length - 1; i >= 0; i--) if (tickN >= pendingPiles[i].due) {   // a sealed spill comes due: the pile appears for everyone
    const p = pendingPiles.splice(i, 1)[0];
    for (const it of p.rows) dropItem(it[0], it[1] | 0, p.x, p.z, p.life, p.own || PID);
  }
  if (P.dpile && tickN > P.dpile.t + 1500) { P.dpile = null; markDirty(); }   // the quarter hour is spent; the record dies with the pile
  for (let i = fires.length - 1; i >= 0; i--) if (tickN >= fires[i].until) fires.splice(i, 1)[0].dead = 1;
  for (const [k, t] of npcDead) if (t <= tickN) npcDead.delete(k);
  if ((tickN & 7) === 0) { refreshNpcs(); foesTick(); }
  const rgn = (P.tx >> 6) + ':' + (P.tz >> 6);   // the tolerance clock restarts in a new region
  if (rgn !== P.regionK) { P.regionK = rgn; P.regionT = tickN; }
  netPiles(); netSend(); netMon(); flushNet();   // claims first: the worker judges them against me.x, which netSend is about to move, and a full batch drops its tail
  if (P.moved && (tickN % 100) === 0) markDirty();   // a wandering player is worth persisting every minute or so
}
function cameraKeys(dt) {
  const rot = OPT.camSpeed * dt, tilt = OPT.camSpeed * 0.62 * dt;
  if (keys.ArrowLeft || keys.KeyA) yaw -= rot;
  if (keys.ArrowRight || keys.KeyD) yaw += rot;
  if (keys.ArrowUp || keys.KeyW) pitch = clamp(pitch + tilt, 0.14, 1.45);
  if (keys.ArrowDown || keys.KeyS) pitch = clamp(pitch - tilt, 0.14, 1.45);
}

/* ---- 34. ANIMATION: one rig drives you and everyone else; each entity owns its phase accumulators ---- */
const setRot = (p, aL, aR, zL, zR, ty, tx) => { p.armL.rotation.x = aL; p.armR.rotation.x = aR; p.armL.rotation.z = zL; p.armR.rotation.z = zR; p.torso.rotation.y = ty; p.torso.rotation.x = tx; };
const ss = (a, b) => smoothstep(0, 1, a / b);
/* per pose: a function of cycle phase ph that sets the arms and torso */
const POSES = {
  1: (p, ph) => { const dr = ph < 0.8 ? ss(ph, 0.8) : 1 - (ph - 0.8) / 0.2, loose = ph > 0.8 ? 1 - (ph - 0.8) / 0.2 : 0; setRot(p, -1.48, -1.48 + dr * 0.30, 0.10, -0.10 - dr * 0.55, -0.40 + loose * 0.10, 0); },   // a bow is drawn, not swung
  2: (p, ph) => { const li = ph < 0.45 ? ss(ph, 0.45) : 1 - ss(ph - 0.45, 0.55); setRot(p, 0, -1.40 * li, 0.06, -0.06 - 0.16 * li, 0, 0); },   // casting is a lift
  3: (p, ph) => { const li = ph < 0.3 ? ss(ph, 0.3) : 1 - ss(ph - 0.3, 0.7) * 0.25; setRot(p, -1.95 * li, -1.95 * li, 0.30 * li, -0.30 * li, 0, 0.24 * li); },   // prayer
  4: (p, ph) => {   // a thrust, the polearm levelled
    const th = ph < 0.25 ? ss(ph, 0.25) : 1 - ss(ph - 0.25, 0.75);
    setRot(p, 0.15 - 0.35 * th, 0.35 - 1.55 * th, 0.06, -0.06 - 0.10 * th, -0.30 * th, -0.06 * th);
    if (p.wep && p.wep.userData.up) p.wep.rotation.x = (PI - 0.45) * th;
  },
  0: (p, ph) => { const sw = ph < 0.6 ? ss(ph, 0.6) : 1 - ss(ph - 0.6, 0.4), a = 0.25 - 2.6 * sw, two = p.wep && p.wep.userData.two;   // wind up, strike down; both arms on a two-hander
    setRot(p, two ? a : 0.15 - 0.9 * sw, a, two ? -TWO_Z : 0.06, two ? TWO_Z : -0.06, sw * 0.3, sw * -0.12); }
};
function animate(E, p, dt) {
  const moving = (E.path && E.path.length > 0) || E.moved > 0 || (E.span > 1 && (E.px !== E.tx || E.pz !== E.tz));
  E.walkPhase += dt * (moving ? (E.afloat ? 4.4 : 7.5 * stepsThisTick(E) / (E.span > 1 ? E.span : 1)) : 0);
  E.bobPhase += dt;
  E.face += wrapA(E.faceT - E.face) * Math.min(1, dt * 14);
  if (E.turn) E.turn.rotation.y = E.face;
  const rig = E.rig, bt = E.boat, oL = E.oarL, oR = E.oarR;
  const u = p.wep && p.wep.userData;
  if (u) p.wep.rotation.set(u.tilt || 0, 0, u.roll || 0);
  if (E.afloat) {
    if (bt) { bt.visible = true; bt.position.y = Math.sin(E.bobPhase * 1.9) * 0.055; bt.rotation.z = Math.sin(E.bobPhase * 1.3) * 0.045; bt.rotation.x = Math.sin(E.bobPhase * 2.3) * 0.02; }
    p.legL.visible = p.legR.visible = false;
    if (rig) { rig.position.y = 0.28; rig.scale.setScalar(0.92); }
    const row = moving ? Math.sin(E.walkPhase) : Math.sin(E.bobPhase * 0.7) * 0.15;
    if (oL) { oL.rotation.x = oR.rotation.x = row * 0.7; oL.rotation.z = -0.9 + row * 0.22; oR.rotation.z = 0.9 - row * 0.22; }
    p.armL.rotation.x = p.armR.rotation.x = -0.8 - row * 0.5;
    p.armL.rotation.z = p.armR.rotation.z = 0;
    return;
  }
  if (bt) bt.visible = false;
  p.legL.visible = p.legR.visible = !p.legHid;
  if (rig) rig.scale.setScalar(1);
  const s = moving ? Math.sin(E.walkPhase) * 0.62 : 0;
  p.legL.rotation.x = s; p.legR.rotation.x = -s;
  if (E.acting && !moving) {
    E.swingPhase += dt * 1000 / (E.actSpan * TICK);
    if (E.swingPhase >= 1) E.swingPhase -= 1;
    (POSES[E.pose] || POSES[0])(p, E.swingPhase);
    if (u && E.pose === 2) p.wep.rotation.x = (u.tilt || 0) - p.armR.rotation.x;   // the staff points at the sky whatever the shoulder does
  } else {
    E.swingPhase = 0;
    if (u && u.two) setRot(p, TWO_A, TWO_A, -TWO_Z, TWO_Z, 0, 0); else setRot(p, s * 0.85, -s * 0.85, 0.06, -0.06, 0, 0);
  }
  if (rig) rig.position.y = moving ? Math.abs(Math.sin(E.walkPhase)) * 0.045 : 0;
}
/* the bestiary walks with the same gait; wings beat on a slow shared clock, offset per creature.
   `limbs` picks whose joints swing — the box rig's own, or the 07 mesh's bones, the same records either way */
function animateNpc(n, dt, limbs) {
  const moving = n.tx !== n.px || n.tz !== n.pz;
  if (moving) n.walkPhase += dt * 7.5 * chebDist(n.tx, n.tz, n.px, n.pz);
  const s = moving ? Math.sin(n.walkPhase) * 0.62 : 0;
  for (const L of limbs || n.limbs) {
    if (L.kind === 'wing') L.m.rotation.z = L.s * (0.12 + Math.sin(tSec * 3.1 + (n.kh & 7)) * (L.a || 0.3));
    else if (L.kind === 'tail') L.m.rotation.y = s * 0.5 + Math.sin(tSec * 1.6 + (n.kh & 7)) * 0.15;   // the wag: gait sway plus an idle flick
    else if (L.kind === 'sleg') {   // spiders row their legs: a yaw sweep with a small lift on the recovery
      const w2 = n.walkPhase * 1.7 + L.ph;
      L.m.rotation.y = L.base + (moving ? Math.sin(w2) * 0.30 : Math.sin(tSec * 1.3 + L.ph) * 0.05) * L.s;
      L.m.rotation.x = moving ? -Math.max(0, Math.sin(w2 + PI / 2)) * 0.14 : 0;
    }
    else L.m.rotation.x = s * L.s * (L.kind === 'arm' ? 0.85 : L.kind === 'qleg' ? 0.72 : 1);
  }
  if (moving && !(n.atkT > 0)) n.mesh.position.y += Math.abs(Math.sin(n.walkPhase)) * 0.045;
}
/* repopulate the instance pools from whatever is near: five draw calls for every stump, fire, drop, ripple and keeper */
const POOL_KEEP = Pool(KEEP_GEO, 24, 1), POOLS = [POOL_STUMP, POOL_FIRE, POOL_DROP, POOL_SPOT, POOL_KEEP];
function updatePools(t) {
  POOLS.forEach(poolReset);
  /* objects the 07 overlay owns but the close list no longer covers (a teleport, a sprint, the setting off):
     loc7Frame tears them down; membership means the checks stay proportional to what is actually up */
  for (const o of l7Set) if (!osrsOn || Math.abs(o.x - P.tx) + Math.abs(o.z - P.tz) > LOC7_OUT) loc7Frame(o);
  for (const o of closeList()) {
    if (o.t <= 1) loc7Frame(o);
    if (o.t === 0) { if (depleted.has(o.key) && !o.l7s) poolPut(POOL_STUMP, o.x, o.y - 0.18, o.z, o.x * 0.7, 1); }
    else if (o.t === 2) { if (!depleted.has(o.key)) { const w = 0.85 + Math.sin(t * 2.2 + o.x * 0.7 + o.z * 0.4) * 0.16; poolPut(POOL_SPOT, o.x, 0.08, o.z, t * 0.5 + o.x, w, 1, w); } }
    else if (KEEP_TINT[o.t]) poolPut(POOL_KEEP, o.kx !== undefined ? o.kx : o.x, o.y, o.kz !== undefined ? o.kz : o.z, o.dir !== undefined ? o.dir : o.b ? o.b.door * (PI / 2) : 0, 1, 1, 1, KEEP_TINT[o.t]);
  }
  for (const f of fires) poolPut(POOL_FIRE, f.x, f.y, f.z, t * 1.7, 1, 0.86 + Math.sin(t * 9 + f.x) * 0.14, 1);
  for (const d of drops) poolPut(POOL_DROP, d.x, d.y + 0.3 + Math.sin(t * 2 + d.x) * 0.06, d.z, t * 0.9, 1, 1, 1, hexInt(ITEMS[d.id].c));
  for (const f of poolHooks) f(t);
  POOLS.forEach(poolFlush);
}

/* ---- 35. HUD ---- */
let frames = 0, tLast = performance.now();
function hud() {
  const a = document.activeElement;
  if (a !== wxEl && a !== wzEl) { wxEl.value = P.tx; wzEl.value = P.tz; }
  updateZoneTags();
  if (pvpAck && !wildLvAt(P.tx, P.tz)) pvpAck = 0;
  el('pos').textContent = el('posr').textContent = P.tx + ', ' + P.tz;
  el('elev').textContent = P.ry.toFixed(1);
  el('biome').textContent = P.afloat ? 'open water' : biomeName(P.ry, P.tx, P.tz);
  el('resident').textContent = chunks.size;
  el('tilecount').textContent = fmt(tilesGenerated);
  const b = tilesGenerated * 5;
  el('baked').textContent = b > 1e6 ? (b / 1e6).toFixed(1) + ' MB' : (b / 1e3).toFixed(0) + ' KB';
  el('gpMade').textContent = fmt(gpMade); el('gpSunk').textContent = fmt(gpSunk);
  el('tris').textContent = fmt(renderer.info.render.triangles);
  el('calls').textContent = renderer.info.render.calls;
  const bear = ((Math.atan2(Math.sin(yaw), -Math.cos(yaw)) % TAU) + TAU) % TAU;
  el('compass').textContent = COMPASS[Math.round(bear / TAU * 8) % 8];
}

/* ---- 36. FRAME ---- */
let prev = performance.now(), lastChunkKey = -1e9, hoverFrame = 0, tSec = 0, camDist = 40;
const CAM_CLEAR = 1.5;
function boomLength(ox, oy, oz, ya, cp, sp, want) {   // how far the boom extends before the camera would be underground
  const dx = -Math.sin(ya) * cp, dz = -Math.cos(ya) * cp;
  const clear = t => oy + sp * t >= Math.max(groundY(ox + dx * t, oz + dz * t), 0) + CAM_CLEAR;
  const N = 12;
  for (let i = 1; i <= N; i++) {
    const t = want * i / N;
    if (clear(t)) continue;
    let lo = want * (i - 1) / N, hi = t;
    for (let k = 0; k < 6; k++) { const m = (lo + hi) * 0.5; if (clear(m)) lo = m; else hi = m; }
    return lo;
  }
  return want;
}
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - prev) / 1000, 0.1); prev = now;
  if (!started) return;
  tSec += dt;
  cameraKeys(dt);
  const gt = globalTick();
  if (gt - tickN > 8) tickN = gt - 1;   // slept or backgrounded: snap, never grind
  while (tickN < gt) gameTick();
  const alpha = ((netNow() - EPOCH) % TICK) / TICK, sub = P.span > 1 ? Math.min(1, (P.stuckT + alpha) / P.span) : alpha;
  P.rx = P.px + (P.tx - P.px) * sub; P.rz = P.pz + (P.tz - P.pz) * sub;
  P.ry = P.afloat ? 0 : groundY(P.rx, P.rz);
  player.position.set(P.rx, P.ry, P.rz);
  focus.set(P.rx, P.ry, P.rz);
  const was = indoors;   // step through a doorway and the roof comes off
  indoors = insideAt(P.tx, P.tz);
  if (indoors !== was) {
    if (was && was.roof) was.roof.visible = roofShown(was);
    if (indoors && indoors.roof) indoors.roof.visible = roofShown(indoors);
    el('inside').textContent = indoors && !indoors.deck ? (indoors.shop != null ? SHOP_KINDS[indoors.shop].n : indoors.bank ? 'Bank of Seedworld' : 'indoors') : 'outdoors';   // a deck is a floor, not a room
    el('inside').className = indoors ? 'in' : '';
  }
  labelsBegin();
  const myCombat = combatLevel();
  let npcPlates = 0;
  for (const n of npcs) {
    n.rx = n.px + (n.tx - n.px) * alpha; n.rz = n.pz + (n.tz - n.pz) * alpha; n.ry = groundY(n.rx, n.rz);
    n.face += wrapA(n.faceT - n.face) * Math.min(1, dt * 12);
    if (n.atkT > 0) {   // a merged monster has no limbs to swing: melee is a lunge, a throw rears up
      n.atkT = Math.max(0, n.atkT - dt * 3.2);
      const k = Math.sin((1 - n.atkT) * PI);
      if (n.atkStyle && n.atkStyle !== 'm') { n.mesh.position.set(n.rx, n.ry + k * 0.35, n.rz); n.mesh.rotation.x = -k * 0.22; }
      else { const lung = k * 0.55; n.mesh.position.set(n.rx + Math.sin(n.face) * lung, n.ry + k * 0.12, n.rz + Math.cos(n.face) * lung); n.mesh.rotation.x = k * 0.28; }
    } else { n.mesh.rotation.x = 0; n.mesh.position.set(n.rx, n.ry, n.rz); }
    n.mesh.rotation.y = n.face;
    const k07 = npcLod(n);
    const limbs = k07 ? n.o7.limbs : n.limbs;   // only the rig on show spends its joints; the walk bob comes with them
    if (limbs && limbs.length) animateNpc(n, dt, limbs);
    if (n.o7) {   // after the bob: the 07 mesh rides the box rig's final transform
      n.o7.visible = !!k07;
      if (k07) { n.o7.position.copy(n.mesh.position); n.o7.rotation.copy(n.mesh.rotation); }
    }
    n.mesh.visible = !k07;
    if (n.hp < n.maxhp || n.target === P || n.owner || (P.task && P.task.k === 'attack' && P.task.o === n)) healthBar(n, 1.5 + n.t.sz * 1.4);
    if (npcPlates < 14 && Math.abs(n.rx - P.rx) < 40 && Math.abs(n.rz - P.rz) < 40) {
      const lbl = '<i style="color:' + lvlColour(n.t.lv, myCombat) + '">' + n.t.n + ' (' + n.t.lv + ')</i>';
      if (labelAt(n, 'plate', n.rx, n.ry + 1.5 + n.t.sz * 1.5, n.rz, lbl, n.t.boss ? 'plate npc boss' : 'plate npc', 1)) { npcPlates++; n.plate.el._obj = n; }
    } else if (n.plate) { freePlate(n.plate); n.plate = null; }
  }
  let marks = 0;   // icon markers over the town's plumbing
  for (const o of closeList()) {
    if (!(o.t >= 3) || o.noMark || marks >= 16 || Math.abs(o.x - P.rx) > 42 || Math.abs(o.z - P.rz) > 42) continue;
    if (labelAt(o, 'mk', o.x, o.y + MARK_H[o.t], o.z, markHtml(o), 'plate mk', 1)) { marks++; o.mk.el._obj = o; }
  }
  if (deathSpot && Math.abs(deathSpot.x - P.rx) < 72 && Math.abs(deathSpot.z - P.rz) < 72)
    labelAt(deathSpot, 'mk', deathSpot.x, deathMark.position.y + 3.2, deathSpot.z, DEATH_HTML, 'plate mk boss', 1);
  osrsLod();   // the boom settled last frame: which of your two rigs is on show is a camera decision, taken once here
  animate(P, myParts(), dt);
  petFrame(dt);
  skullFrame();
  updateRemotes(dt, alpha);
  labelsEnd();
  const key = ck(Math.floor(P.rx / CHUNK), Math.floor(P.rz / CHUNK));
  if (key !== lastChunkKey) { lastChunkKey = key; refresh(); }
  pump(3, 2);
  if (nearDirty) rebuildNear();
  updatePools(tSec);
  mapTick();
  water.position.set(P.rx, 0, P.rz);
  waterPaint();
  if (markT > 0) { markT -= dt; marker.rotation.y += dt * 2.4; if (markT <= 0) marker.visible = false; }
  ringFrame(dt);
  // the boom collapses fast into a hill and recovers slowly; indoors the roof lifts instead
  const dunCam = P.tz > 500000;   // below ground the boom never collides: it rides above the walls instead
  const cp = Math.cos(pitch), sp = Math.sin(pitch), cy = Math.max(P.ry, 0), safe = dunCam ? dist : boomLength(P.rx, cy + 2.2, P.rz, yaw, cp, sp, dist);
  camDist += (safe - camDist) * (safe < camDist ? 0.55 : 0.10);
  const d = clamp(camDist, 3.2, dist);
  camera.position.set(P.rx - Math.sin(yaw) * cp * d, cy + 2.2 + sp * d, P.rz - Math.cos(yaw) * cp * d);
  if (dunCam) camera.position.y = Math.max(camera.position.y, DUN_FLOOR + 16);
  camera.lookAt(P.rx, cy + 2.2, P.rz);
  if (spellT > 0) {
    spellT -= dt;
    const k = clamp(spellT / 0.42, 0, 1);
    spellFx.scale.setScalar(1.2 + (1 - k) * 2.6); spellFx.material.opacity = k; spellFx.rotation.y += dt * 7;
    if (spellT <= 0) spellFx.visible = false;
  }
  boltFrame(dt);
  fogCenter.value.set(P.rx, P.ry, P.rz);
  if (!wmOpen) renderer.render(scene, camera);   // the world map covers the screen: no point painting behind it
  try { fxFrame(dt); } catch (e) { fxRepair(e); }   // bars must outlive any one bad frame
  xpFrame(dt);
  if (OPT.timers) timerFrame(); else clearTimers();
  if (++hoverFrame % 3 === 0 && mx >= 0 && !drag) {
    const o = pickObject(rayAt(mx, my));
    if (o !== hoverObj) {
      hoverObj = o;
      const opts = optionsFor(o);
      hoverEl.innerHTML = opts.length ? optLabel(opts[0]) : (o ? '' : '<span style="color:#a2906c">Walk here</span>');
    }
  }
  if ((hoverFrame & 7) === 0) mapMarks();
  if (dirty.inv) drawInv();
  if (dirty.eq) drawEq();
  if (dirty.sk) drawSk();
  if (dirty.orb) drawOrbs();
  frames++;
  if (now - tLast > 500) { el('fps').textContent = Math.round(frames * 1000 / (now - tLast)); frames = 0; tLast = now; hud(); }
}
/* ---- 37. ACCOUNT: the key is the whole credential; it leaves this file only as a hash ---- */
const API = location.origin, A32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';   // Crockford: no I L O U
function newKey() {
  const b = crypto.getRandomValues(new Uint8Array(25));
  let s = ''; for (const v of b) s += A32[v & 31];
  return s;
}
const normKey = s => (s || '').toUpperCase().trim().replace(/O/g, '0').replace(/[IL]/g, '1').replace(/U/g, 'V').replace(/[^0-9A-HJKMNP-TV-Z]/g, '');
const enc = new TextEncoder();
const hexs = b => [...new Uint8Array(b)].map(v => v.toString(16).padStart(2, '0')).join('');
const sha = async s => hexs(await crypto.subtle.digest('SHA-256', enc.encode(s)));
let KEY = null, AUTH = null, PID = null, NAME = null, OFFLINE = 0, SEED = 'lumbridge';
const store = {
  get(k) { try { return localStorage[k] || ''; } catch { return ''; } },
  set(k, v) { try { localStorage[k] = v; } catch {} },
  del(k) { try { delete localStorage[k]; } catch {} }
};
(function loadOpts() {   // only keys this build knows; stuck mode never survives a reload
  let saved = null;
  try { saved = JSON.parse(store.get('seedworld.opt') || 'null'); } catch {}
  if (!saved || typeof saved !== 'object') return;
  for (const k in OPT) if (k !== 'stuck' && k !== 'roofs' && typeof saved[k] === 'number' && isFinite(saved[k])) OPT[k] = saved[k];
  OPT.roofs = 1;
  RADIUS = OPT.viewRadius;
  applyOpts();
})();

/* ---- MUSIC: one looping track; browsers hold it back until the first gesture ----
   preload 'none', and nothing is asked for until the world is up. The track is four megabytes off a THIRD-PARTY
   host, behind a redirect — two more DNS lookups and two more TLS handshakes — and 'auto' started all of that at
   script-eval time, racing /characters and /save for the connection while the player was still typing their key.
   Login is the one moment in this game that is pure waiting, so nothing that is not login may share it. ---- */
const bgm = new Audio('https://github.com/ivl-ad/seedworld/raw/refs/heads/main/assets/sound/7th_Realm_(v1).ogg');
bgm.loop = true; bgm.preload = 'none';
const volSaved = store.get('seedworld.vol');
let vol = volSaved === '' ? 0.5 : clamp(parseFloat(volSaved) || 0, 0, 1), lastVol = vol > 0 ? vol : 0.5;
function bgmPlay() { if (vol <= 0 || !started || !bgm.paused) return; const p = bgm.play(); if (p && p.catch) p.catch(() => {}); }
function drawVol() { el('bgmBtn').textContent = vol <= 0 ? '🔇' : vol < 0.5 ? '🔉' : '🔊'; const s = el('volSlider'); if (s) s.value = Math.round(vol * 100); }
function setVol(v) {
  vol = clamp(v, 0, 1);
  if (vol > 0) lastVol = vol;
  bgm.volume = vol; bgm.muted = vol <= 0;
  store.set('seedworld.vol', vol.toFixed(2));
  drawVol();
  if (vol > 0) bgmPlay(); else bgm.pause();
}
el('bgmBtn').onclick = () => setVol(vol > 0 ? 0 : lastVol);
bgm.volume = vol; bgm.muted = vol <= 0;
drawVol();   // no bgmPlay() here: the world has not been entered, so there is nothing to score yet
on(window, 'pointerdown keydown', () => { if (vol > 0 && bgm.paused) bgmPlay(); }, { passive: true });

/* ---- SOUND EFFECTS: one-shot wavs in assets/sound/<id>.wav, fetched on first use and decoded once; the music's gesture unlocks these too ---- */
const sfxSaved = store.get('seedworld.sfxvol');
let acx = null, sfxBus = null, sfxN = 0, sndWarm = 0, hurtSnd = 0, fireLoop = null;
let sfxVol = sfxSaved === '' ? 0.8 : clamp(parseFloat(sfxSaved) || 0, 0, 1);
const sndBufs = new Map(), sndAt = new Map();
function sndUnlock() {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  if (!acx) { acx = new AC(); sfxBus = acx.createGain(); sfxBus.gain.value = sfxVol; sfxBus.connect(acx.destination); }
  if (acx.state !== 'running') { const p = acx.resume(); if (p && p.catch) p.catch(() => {}); }
  if (!sndWarm) { sndWarm = 1; [2510, 513, 1975, 512, 2393, 2115, 200].forEach((id, i) => setTimeout(() => sndLoad(id), 500 + i * 300)); }   // the everyday handful warms first
}
on(window, 'pointerdown keydown', sndUnlock, { passive: true });
function sndLoad(id) {
  let b = sndBufs.get(id);
  if (b === undefined) {
    b = fetch('assets/sound/' + id + '.wav').then(r => r.arrayBuffer()).then(a => acx.decodeAudioData(a))
      .then(bf => (sndBufs.set(id, bf), bf), () => sndBufs.set(id, null));
    sndBufs.set(id, b);
  }
  return b;
}
/* play a one-shot at vol (0..1) under the master; an unloaded sound plays when it arrives, unless the moment has passed */
function sfx(id, vol) {
  if (!acx || acx.state !== 'running' || sfxVol <= 0 || document.hidden) return;
  const b = sndBufs.get(id);
  if (b === undefined) { const t0 = performance.now(); sndLoad(id).then(() => { if (performance.now() - t0 < 700) sfx(id, vol); }); return; }
  if (!(b instanceof AudioBuffer) || sfxN >= 12) return;
  const now = performance.now();
  if (now - (sndAt.get(id) || 0) < 60) return;   // the same sound twice in one instant is only louder
  sndAt.set(id, now);
  const s = acx.createBufferSource(), g = acx.createGain();
  s.buffer = b; g.gain.value = vol === undefined ? 1 : vol;
  s.connect(g); g.connect(sfxBus);
  sfxN++; s.onended = () => sfxN--;
  s.start();
}
/* a sound with a place fades over r tiles from where you stand */
function sfxAt(id, x, z, r, vol) { const R = r || 16, d = Math.hypot(x - P.tx, z - P.tz); if (d < R) sfx(id, (vol === undefined ? 1 : vol) * (1 - d / R)); }
function setSfxVol(v) { sfxVol = clamp(v, 0, 1); if (sfxBus) sfxBus.gain.value = sfxVol; store.set('seedworld.sfxvol', sfxVol.toFixed(2)); }
const meleeSnd = () => { const w = weaponIt(); return !w ? 2508 : w.stab ? (Math.random() < 0.5 ? 2548 : 2549) : WSND[w.g] || 2510; };
const bowSnd = () => { const w = bowItem(); return !w ? 2692 : w.g === 'cbow' ? 2695 : w.g === 'dart' || w.g === 'pipe' ? 2696 : w.thrown ? 2708 : 2692; };
const spellSnd = (sp, hit) => sp.drain === 'hold' ? (hit ? 203 : 202) : (sp.k.startsWith('fire') ? 160 : 220) + (hit ? 1 : 0);
const parrySnd = () => sfx(Math.random() < 0.5 ? 1975 : 1977, 0.8);
/* the nearest campfire crackles: one looping source, its gain trailing your distance; put out when you walk away */
tickHooks.push(() => {
  let d = 1e9;
  for (const f of fires) { const q = Math.hypot(f.x - P.tx, f.z - P.tz); if (q < d) d = q; }
  const want = d < 7 && sfxVol > 0 && !document.hidden && acx && acx.state === 'running';
  if (want && !fireLoop) {
    const b = sndBufs.get(1669);
    if (b === undefined) sndLoad(1669);
    else if (b instanceof AudioBuffer) {
      const s = acx.createBufferSource(), g = acx.createGain();
      s.buffer = b; s.loop = true; g.gain.value = 0;
      s.connect(g); g.connect(sfxBus); s.start();
      fireLoop = { s, g, quiet: 0 };
    }
  }
  if (fireLoop) {
    fireLoop.g.gain.setTargetAtTime(want ? clamp(1 - d / 7, 0, 1) * 0.55 : 0, acx.currentTime, 0.25);
    if (want) fireLoop.quiet = 0;
    else if (++fireLoop.quiet > 6) { try { fireLoop.s.stop(); } catch {} fireLoop = null; }
  }
});
async function useKey(raw) {
  const k = normKey(raw);
  if (k.length !== 25) return 0;
  KEY = k;
  AUTH = await sha('seedworld-auth|' + k);
  PID = (await sha('seedworld-id|' + k)).slice(0, 12);
  store.set('seedworld.key', k);
  return 1;
}
/* parsed JSON, or {__status, __html} when the reply was not JSON; null when the request never landed */
/* The account key is the whole credential, so it rides an Authorization header rather than the query string, where
   Cloudflare's request logs, wrangler tail and browser history all keep a copy. /ws is the exception: a WebSocket
   handshake carries no headers of its own. The worker still reads the old query form, so either side may deploy first. */
const authHead = () => (AUTH ? { authorization: 'Bearer ' + AUTH } : {});
async function api(path, opts) {
  try {
    opts = Object.assign({}, opts, { headers: Object.assign({}, authHead(), opts && opts.headers) });
    const r = await fetch(API + path, opts), t = await r.text();
    let j = null; try { j = JSON.parse(t); } catch {}
    if (!j) j = { e: 'not json', __html: 1 };
    j.__status = r.status;
    return j;
  } catch { return null; }
}
const apiJson = (path, body) => api(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

/* the save blob: short keys, positional arrays. lvl[] is never stored; it derives from xp[] on load. */
/* v2. The worker refuses a blob over MAXSAVE and the client then writes nothing
   anywhere for the rest of the session, so every byte here is a byte of headroom
   before that cliff. Three things changed from v1, none of them lossy:

     cl -> clb   354 full item-id strings (5.8 KB) became a bit per entry (62 B).
     inv, bank   flat runs instead of arrays of pairs: two brackets per row back.
     dy          diaries whose board was merely read carry no information and are
                 dropped; a fully-claimed one drops its counters. This is the one
                 field with no natural ceiling — it grew with the size of the
                 world, not the length of the game.

   applySave still reads v1, and must keep doing so: an offline character sits in
   localStorage until its owner comes back, whenever that is. */
function packSave() {
  const invp = [];
  for (let i = 0; i < INV_N; i++) if (inv[i]) invp.push(i, inv[i].id, inv[i].n);
  const bankp = [];
  for (const s of bank) bankp.push(s.id, s.n);
  return { v: 2, tx: P.tx, tz: P.tz, hp: P.hp, maxhp: P.maxhp, pray: Math.round(P.pray), maxpray: P.maxpray, energy: Math.round(P.energy), run: P.run, style: P.style,
    prayers: P.prayers, rstyle: P.rstyle, ammoN: P.ammoN, eq: EQ_SLOTS.map(s => eq[s] || null), inv: invp, bank: bankp,
    look: [P.look.skin, P.look.shirt, P.look.legs, P.look.face], xp: Array.from(xp, v => Math.round(v)), home: [P.home.x, P.home.z],
    sl: P.slay ? [P.slay.k, P.slay.n, P.slay.m] : 0, farm: Object.keys(P.farm).map(k => [+k, ...P.farm[k]]), clue: P.clue || 0,   // the third element is the harvests left, absent until the patch is first worked
    bd: [...npcDead].filter(([k, t]) => k && k[0] === 'b' && t > tickN),   // slain boss lairs: the cell key is stable, so the timer survives a reload
    hs: P.hs || 0,
    clb: clogPack(), cln: CLOG_ORDER.length, pet: P.pet || 0, ins: P.ins, pl: P.petLost, dy: dyPack(), ca: P.ca,
    dr: P.dunRet || 0, cs: P.cstyle, bs: Array.from(bst), sku: P.skull || 0,   // sku: the skull's expiry on the shared clock — one entry, refreshed per initiated attack
    sp: Math.round(P.spec), ht: Math.max(0, P.homeT), ac: Math.max(0, P.agiCapeT || 0), bk: P.book | 0, bks: P.books | 1,   // a relog used to hand back a full spec bar and an off-cooldown home teleport
    dp: P.dpile || 0 };   // dp: the unclaimed death pile, so a relog cannot cost you your right to it
}
/* What the blob would weigh right now. The bank used to advertise three hundred
   slots against a ceiling that could not hold two hundred of them, and the
   player only found out when the server started refusing saves — silently, for
   the rest of the session. Now the pack knows its own size, so the game can
   refuse to enter a state it cannot store, and say why. */
let sbLen = -1;
const saveStale = () => { sbLen = -1; };   // any mutation invalidates it; markDirty is the one funnel every mutation already goes through
const saveBytes = () => { if (sbLen < 0) { try { sbLen = JSON.stringify(packSave()).length; } catch { sbLen = 0; } } return sbLen; };
/* The ONE place that knows which blob versions this build can read. Every gate
   outside applySave used to spell `b.v === 1` inline, so bumping packSave to v2
   quietly turned every returning character into "could not be read" — the login
   branch rejected the very blob the previous session had written. Bump this list
   with the format, never the call sites. */
const SAVE_VERSIONS = [1, 2];
const readableSave = b => !!b && SAVE_VERSIONS.includes(b.v);
const SAVE_CAP = 8192, SAVE_WARN = 7200;   // SAVE_CAP mirrors MAXSAVE in src/worker.js — change both together
/* renames must not eat a save: an old id folds into its new name here before the ITEMS checks discard it */
const OLD_IDS = Object.create(null);   // old id -> current id; add a row with any rename, forever
const idOf = id => OLD_IDS[id] || id;
function applySave(b) {
  if (!readableSave(b)) return 0;
  const v2 = b.v === 2;
  const xs = b.xp || [];
  for (let i = 0; i < NSK; i++) { xp[i] = +xs[i] || 0; lvl[i] = levelFor(xp[i]); }
  if (lvl[SK.hitpoints] < 10) { xp[SK.hitpoints] = XP_TABLE[10]; lvl[SK.hitpoints] = 10; b.maxhp = b.hp = 10; }   // saves from before the 2007 floor rise to it
  inv.fill(null);
  let invRows = b.inv || [];
  if (v2) { const f = invRows; invRows = []; for (let k = 0; k + 2 < f.length; k += 3) invRows.push([f[k], f[k + 1], f[k + 2]]); }
  for (const row of invRows) { const i = row[0] | 0, id = idOf(row[1]); if (i >= 0 && i < INV_N && ITEMS[id]) inv[i] = { id, n: Math.max(1, row[2] | 0) }; }
  const bankRows = [];
  if (v2) { const f = b.bank || []; for (let k = 0; k + 1 < f.length; k += 2) bankRows.push([idOf(f[k]), f[k + 1] | 0]); }
  else for (const r of (b.bank || [])) bankRows.push([idOf(r[0]), r[1] | 0]);
  bank = bankRows.filter(r => ITEMS[r[0]] && r[1] > 0).slice(0, BANK_N).map(r => ({ id: r[0], n: r[1] }));
  const lk = b.look || [];
  P.look.skin = clamp(lk[0] | 0, 0, SKINS.length - 1); P.look.shirt = clamp(lk[1] | 0, 0, SHIRTS.length - 1);
  P.look.legs = clamp(lk[2] | 0, 0, LEGSC.length - 1); P.look.face = clamp(lk[3] | 0, 0, FACES.length - 1);
  const e = b.eq || [];
  EQ_SLOTS.forEach((s, i) => { const id = e[i] && idOf(e[i]); eq[s] = ITEMS[id] ? id : null; });
  P.maxhp = b.maxhp || lvl[SK.hitpoints]; P.hp = Math.min(Math.floor(P.maxhp * 1.15), b.hp || P.maxhp);   // a brew's overheal survives the reload
  P.maxpray = b.maxpray || lvl[SK.prayer]; P.pray = Math.min(P.maxpray, b.pray ?? P.maxpray);
  P.energy = b.energy ?? 100; P.run = b.run ?? 1; P.style = b.style | 0; P.prayers = b.prayers | 0; P.rstyle = Math.min(2, Math.max(0, b.rstyle | 0)); P.cstyle = b.cs ? 1 : 0;
  P.ammoN = eq.ammo ? Math.max(1, b.ammoN | 0) : 0;   // an empty quiver with arrows still in the slot would fire forever
  if (b.home) { P.home.x = b.home[0] | 0; P.home.z = b.home[1] | 0; }
  P.slay = b.sl && NPC_BY[b.sl[0]] && (b.sl[1] | 0) > 0 ? { k: b.sl[0], n: b.sl[1] | 0, m: b.sl[2] | 0 } : null;
  P.farm = Object.create(null);
  for (const [k, c, t, left] of (b.farm || [])) if (CROPS[c] && t > 0) P.farm[k] = left > 0 ? [c | 0, t | 0, Math.min(left | 0, 12)] : [c | 0, t | 0];   // a v1 row has no count and re-arms once, as it always did
  P.clue = b.clue && b.clue.length === 3 ? b.clue.map(v => v | 0) : null;
  for (const [k, t] of (b.bd || [])) if (typeof k === 'string' && k[0] === 'b' && (t | 0) > tickN) npcDead.set(k, t | 0);
  P.hs = b.hs && hValid(b.hs) ? b.hs : null;
  if (P.hs) for (const r of P.hs.rm) r[4] = r[4].map(f => f && idOf(f));   // renamed furniture folds in too
  applyHouse(hMe(), P.hs);   // raised optimistically: the join snapshot may contest the land (case 23 folds ours and asks)
  P.cl = b.clb !== undefined ? clogUnpack(b.clb, b.cln | 0) : new Set((b.cl || []).map(idOf).filter(id => ITEMS[id]));
  P.pet = b.pet && ITEMS[idOf(b.pet)] ? idOf(b.pet) : null;
  P.ins = (b.ins || []).map(idOf).filter(id => ITEMS[id]);
  P.petLost = (b.pl || []).map(idOf).filter(id => ITEMS[id]);
  P.dy = dyUnpack(b.dy);
  P.ca = b.ca && typeof b.ca === 'object' ? b.ca : {};
  P.dunRet = b.dr && isFinite(b.dr.x) ? { x: b.dr.x | 0, z: b.dr.z | 0 } : null;
  const bs = b.bs || [];   // boosts and drains ride the blob, as 2007 logouts kept them
  for (let i = 0; i < NSK; i++) bst[i] = clamp(bs[i] | 0, -99, 99);
  P.skull = Math.min(b.sku | 0, tickN + SKULL_T);   // the skull serves out its saved sentence; a doctored future tick is clipped
  P.spec = clamp(b.sp === undefined ? 100 : +b.sp || 0, 0, 100);
  P.books = (b.bks | 0) | 1; P.book = bookHas(b.bk | 0) ? b.bk | 0 : 0;   // standard is always open, and a book you no longer hold falls back to it
  P.homeT = Math.min(b.ht | 0, tickN) || -1e9; P.agiCapeT = Math.min(b.ac | 0, tickN) || -1e9;
  P.dpile = null;
  const dp = b.dp;
  if (dp && isFinite(dp.x) && Array.isArray(dp.rows)) {   // the unclaimed pile returns: sealed until the killer's minute is out, gone at the quarter hour
    const rows = dp.rows.map(r => [idOf(r[0]), r[1] | 0]).filter(r => ITEMS[r[0]] && r[1] > 0).slice(0, 40);
    const t = dp.t | 0, due = Math.max(t + (dp.pv ? 100 : 0), tickN), life = t + 1500 - due;
    if (rows.length && life > 0) {
      P.dpile = { x: dp.x | 0, z: dp.z | 0, t, pv: dp.pv ? 1 : 0, rows };
      pendingPiles.push({ due, x: dp.x | 0, z: dp.z | 0, rows, life, own: PID });   // your own saved reclaim: yours to retract, nobody else's
    }
  }
  dirty.inv = dirty.eq = dirty.sk = dirty.orb = 1;
  return b;
}
function freshCharacter() {
  resetSkills();
  inv.fill(null); bank = [];
  P.look.skin = P.look.shirt = P.look.legs = P.look.face = 0;
  for (const s of EQ_SLOTS) eq[s] = null;
  P.maxhp = P.hp = lvl[SK.hitpoints]; P.maxpray = P.pray = lvl[SK.prayer];
  P.energy = 100; P.run = 1; P.atkT = 0; P.specArm = 0; P.style = 0; P.cstyle = 0; P.prayers = 0; P.spell = null; P.slay = null; P.clue = null; P.farm = Object.create(null); bst.fill(0);
  P.hs = null;   // loadSeed already tore any standing house down
  P.cl = new Set(); P.pet = null; P.ins = []; P.petLost = []; P.dy = {}; P.ca = {}; P.dunRet = null; P.skull = 0; P.dpile = null;
  P.spec = 100; P.specArm = 0; P.souls = 0; P.homeT = P.agiCapeT = -1e9; P.book = 0; P.books = 1; P.veng = 0; P.vengCd = 0; P.dreamT = 0; P.imbueT = 0;
  for (const [id, n] of [['bronze_hatchet', 1], ['bronze_pickaxe', 1], ['tinderbox', 1], ['hammer', 1], ['small_net', 1], ['coins', 120]]) invAdd(id, n);
  eq.weapon = 'bronze_sword';
  dirty.inv = dirty.eq = dirty.sk = dirty.orb = 1;
}

/* ---- write budget. D1 bills per row written, so mutations only raise a flag and a scheduler coalesces them:
   routine changes (xp, gathered items, position) flush at most every SAVE_MS; anything the player would hate to lose (a level, a
   purchase, gear, a trade, death) flushes promptly but bursts coalesce behind SAVE_GAP; unload and sign-out go straight through.
   Writing is disarmed until a read has succeeded: nothing may overwrite a character we could not load. Every send expects an ack. ---- */
let saveDirty = 0, lastSave = 0, saveTimer = 0, saveArmed = 0, savedOnce = 0, ackPending = 0, ackWarned = 0;
let saveFatal = 0, leftOnce = 0, saveDefer = 0, pendingForce = 0;   // the server refused a blob outright; and: the page is going away, once
const NEED_BUILD = 10;   // the wire contract this client speaks. 10 is a floor, not a preference: this client relies on the room to stamp op 12's clock and to set op 21's owner from the sender, and an older room does neither
const SPAWN_REV = 10;   // 10: castles refuse a sloping site, which moved some cities' keeps and the garrisons with them. 9: town outlines, plans and charters (Lumbridge/Varrock) moved the belts and the spawns. Bumped with any change to powerAt / spawnTable / pickMonster / regions / sites / TOWNFOLK / LADDERS / bossAt / TREES / ruinAt / the dungeon band
let worldSync = 0, srvBuild = 0;   // build >= 4: rooms relay 20/21/22; build >= 5 accepts batched sends
/* every routine message a tick produces rides one socket send (one billable request), flushed at tick's end.
   Saves go alone (their own size lane), and clock pings and trade signals go straight out (latency-sensitive). */
const outQ = [];
const wsSend = m => {
  if (!ws || ws.readyState !== 1) return;
  if (srvBuild < 5 || m[0] === 8 || m[0] === 9 || m[0] === 14 || m[0] === 15 || m[0] === 23) { try { ws.send(JSON.stringify(m)); } catch {} }   // 23 goes alone: a furnished house would burst the batch lane
  else outQ.push(m);
};
const flushNet = () => { if (!outQ.length) return; try { if (ws && ws.readyState === 1) ws.send(JSON.stringify(outQ.length === 1 ? outQ[0] : outQ)); } catch {} outQ.length = 0; };
const netWorld = m => { if (worldSync) wsSend(m); };
/* Three rails, not two. SAVE_MS is the routine beat; SAVE_GAP is the floor a
   genuine milestone may drop to; SAVE_SOON sits between them for the ordinary
   gameplay events that used to claim milestone urgency — buying one item at a
   shop, swapping a helmet, nudging a chair in the house. Those fire in bursts,
   and at the 5-second floor a shopping trip wrote as many rows as a levelling
   session. Twenty seconds keeps the loss window well inside what banking,
   fletching and every xp gain already accept, at a quarter of the writes. */
const SAVE_MS = 60000, SAVE_SOON = 20000, SAVE_GAP = 5000;
let offTimer = 0;
function offSave(now) {   // offline: the blob the worker would keep goes to localStorage instead
  if (!saveArmed) return;
  if (!now) { if (!offTimer) offTimer = setTimeout(() => { offTimer = 0; offSave(1); }, 3000); return; }
  clearTimeout(offTimer); offTimer = 0;
  store.set('seedworld.off.' + SEED, JSON.stringify(packSave()));
}
/* markDirty()  routine — coalesces at SAVE_MS
   markDirty(1)  soon    — a purchase, a gear swap, a furniture move: SAVE_SOON
   markDirty(2)  now     — a level, a death, a trade, sign-out: down to SAVE_GAP
   markDirty(3)  unload  — the page is going away; skip every gap  */
function markDirty(now) {
  saveStale();   // ahead of the early returns: the blob changed whether or not this call schedules a write
  if (OFFLINE) return offSave(now);
  if (!AUTH || !saveArmed) return;
  saveDirty = 1;
  if (now) return flushSave(now >= 2 ? now : 0);
  if (!saveTimer) saveTimer = setTimeout(flushSave, Math.max(0, SAVE_MS - (Date.now() - lastSave)));
}
function flushSave(force) {
  clearTimeout(saveTimer); saveTimer = 0;
  force = pendingForce = Math.max(force | 0, pendingForce);   // a setTimeout retry carries no argument: keep the urgency the caller asked for
  if (!saveDirty || OFFLINE || !AUTH || !saveArmed) { pendingForce = 0; return; }
  if (!ws || ws.readyState !== 1) { saveTimer = setTimeout(flushSave, 2000); return; }   // a socket not up yet must not swallow the flush
  const gap = Date.now() - lastSave, floor = force === 3 ? 0 : force === 2 ? SAVE_GAP : SAVE_SOON;
  if (gap < floor) { saveTimer = setTimeout(flushSave, floor - gap); return; }
  try {
    const body = JSON.stringify(packSave());
   /* Measured here rather than learned from a refusal. Op 7 disarms saving for
       the rest of the session, so discovering the ceiling that way costs the
       player everything they do afterwards; discovering it here costs one line of
       chat and leaves the last good blob in place on the server. */
    if (body.length > SAVE_CAP) {
      saveDirty = 0; pendingForce = 0;
      if (!saveFatal) {
        saveFatal = 1;
        try { store.set('seedworld.rescue.' + SEED, body); } catch {}
        trouble('Your character has outgrown what Seedworld can store (' + body.length + ' of ' + SAVE_CAP + ' bytes), so it is no longer being saved.',
                'packSave() over MAXSAVE — the collection log and bank are the usual weight; a copy is in localStorage under seedworld.rescue.' + SEED);
      }
      return;
    }
    const msg = '[8,' + JSON.stringify(SEED) + ',' + body + ']';
    ws.send(msg);
    saveDirty = 0; pendingForce = 0; lastSave = Date.now(); ackPending = lastSave;
    setTimeout(() => {
      if (!ackPending || ackWarned) return;
      ackWarned = 1;
      trouble('Your progress is not reaching Seedworld right now. Use Sign out to try saving again.',
              'no save ack after 12s for a ' + msg.length + ' byte blob — check https://vla.dev/health reports build ' + NEED_BUILD);
    }, 12000);
  } catch { saveTimer = setTimeout(flushSave, 2000); }
}
/* `on` splits on spaces, so the line below binds pagehide AND beforeunload —
   and visibilitychange fires on the way out too. That was three forced sends of
   a byte-identical blob for every tab close. One is enough; the server also
   holds an unchanged blob to be free, but the wire traffic and the round trips
   were real. Note the hide is NOT guarded on saveDirty: position, hitpoint and
   energy regen raise no flag, so guarding it would quietly lose a minute of
   walking every time the tab went to the background. */
on(document, 'visibilitychange', () => { if (document.hidden && !leftOnce) markDirty(3); });
on(window, 'pagehide beforeunload', () => { if (leftOnce) return; leftOnce = 1; markDirty(3); });
on(window, 'pageshow', () => { leftOnce = 0; });   // a bfcache restore returns to a live page: one hide must not disarm the unload save for good
on(window, 'blur', () => { if (OFFLINE) offSave(1); else if (saveDirty) flushSave(); });   // a second window is often next: put the pending save on the wire before it can kick us

/* ---- 38. THE SOCKET: everything degrades to single player ---- */
/* The relay's own ceiling, and the relay states it: the hello (op 0, element 7) carries the number the room actually
   enforces, so the two halves cannot drift — the victim used to re-clamp to 60 and quietly ate half of every top-tier
   special the relay had been widened to pass. The literal is only the fallback for a room too old to say. */
let HIT_MAX = 130;
let ws = null, wsWant = 0, wsTries = 0, wsTimer = 0, pingTimer = 0, netOK = 0, everConnected = 0;
const pings = [];
function netStatus(on) {
  netOK = on;
  const d = el('netdot');
  if (d) { d.className = on ? 'on' : ''; d.title = on ? 'connected' : 'offline — single player'; }
}
function dropSocket() {   // detach before replacing: its close event must not run the disconnect path
  if (!ws) return;
  const old = ws; ws = null;
  old.onopen = old.onclose = old.onerror = old.onmessage = null;
  try { old.close(1000); } catch {}
}
const forgetSent = () => { lastMove = ''; lastAct = -1; lastEqSent = ''; };
function connect() {
  if (OFFLINE || !AUTH) return;
  wsWant = 1;
  dropSocket();
  let sock;
  try { sock = new WebSocket(API.replace(/^http/, 'ws') + '/ws?auth=' + AUTH + '&seed=' + encodeURIComponent(SEED)); } catch { return retry(); }
  ws = sock;
  sock.onopen = () => {
    if (ws !== sock) { try { sock.close(); } catch {} return; }
    const rejoin = everConnected;
    everConnected = 1; wsTries = 0; netStatus(1);
    say(rejoin ? 'Reconnected.' : 'Connected to ' + SEED + '.', 'lv');
    pingClock(); setTimeout(pingClock, 500); setTimeout(pingClock, 1500);
    clearInterval(pingTimer);
    pingTimer = setInterval(pingClock, 120000);   // the estimator keeps the best of eight lowest-RTT samples and never expires them, so a faster beat buys nothing after startup — and in an idle room this ping is the ONLY inbound traffic, so it alone was keeping the room awake
    forgetSent();   // a fresh socket knows nothing of us: resend everything
    sendEquip(); netSend();
    if (saveDirty) flushSave();
  };
  sock.onclose = ev => {
    if (ws !== sock) return;
    clearInterval(pingTimer);
    const wasOn = netOK;
    console.warn('[seedworld] socket closed', ev.code, ev.reason || '');
    if (trade) tradeClose('The trade ended when the connection dropped.');
    netStatus(0); clearRemotes();
    ws = null;
    if (ev.code === 4001) {   // replaced by another login: stand down, offline and unsaved
      wsWant = 0; saveArmed = 0; saveFatal = 1;   // this window will write nothing more, so sign-out must not claim it did
      say('Your account was opened somewhere else — this window is now offline and will not save.', 'bad');
      say('Click the connection dot by the chat box to take the character back here.', 'bad');
      return;
    }
    if (wasOn) say('Connection lost — still playing offline.', 'bad');
    retry();
  };
  sock.onerror = () => { if (ws === sock) { try { sock.close(); } catch {} } };
  sock.onmessage = e => {
    if (ws !== sock) return;
    let batch; try { batch = JSON.parse(e.data); } catch { return; }
    if (Array.isArray(batch)) for (const m of batch) onNet(m);
  };
}
function retry() {
  if (!wsWant || OFFLINE) return;
  clearTimeout(wsTimer);
  wsTimer = setTimeout(connect, Math.min(30000, 1000 * Math.pow(1.7, wsTries++)));
}
el('netdot').onclick = () => {   // the dot is also the way back in
  if (OFFLINE || !AUTH || !started || netOK) return;
  if (!wsWant) { say('Back to the world list — enter again to take the character over here.', 'lv'); toWorldSelect(); }
  else { wsTries = 0; connect(); }
};
const pingClock = () => wsSend([9, Date.now()]);
function onNet(m) {
  switch (m[0]) {
    case 0: {   // hello: a stale Worker deployment is otherwise invisible from here
      NAME = m[3] || NAME;
      const build = m[5] | 0;
      srvBuild = build;
      if (m[7] !== undefined) HIT_MAX = clamp(m[7] | 0, 1, 255);   // the ceiling is the room's to set, not ours to remember
      worldSync = build >= 4 ? 1 : 0;
      if (worldSync && m[6] !== undefined && (m[6] | 0) !== SPAWN_REV) {   // different monsters on one key: degrade to a private world
        worldSync = 0;
        trouble('This server rolls different monsters than this client — the world stays yours alone until versions agree.', 'spawn rev mismatch: server ' + m[6] + ' vs client ' + SPAWN_REV);
      }
      if (build >= NEED_BUILD && !worldSync) say('This server predates the shared world — trees and monsters are yours alone until it updates.');
      if (build < NEED_BUILD) {
        saveArmed = 0; saveFatal = 1;
        trouble('Seedworld is being updated. You can play, but your progress will not be kept until it finishes.',
                'server build ' + (build || 'pre-versioning') + ' < client ' + NEED_BUILD + ' — deploy src/worker.js (npx wrangler deploy)');
      }
      if (build >= 6) setTimeout(() => {   // announce AFTER the join snapshot lands: an early hello would make the senior house yield to ours
        if (P.hs && housesReg.has(hMe()) && ws && ws.readyState === 1) wsSend([23, P.hs]);
      }, 1200);
      break;
    }
    case 23: {   // a house stands (or falls) somewhere in this world
      const pid = String(m[1] || '');
      if (!pid || pid === PID) break;
      const h = m[2] && Array.isArray(m[2].rm) && hValid(m[2]) &&   // hValid now clamps the room count to the grid itself
        !hSiteBad((m[2].x | 0) + (RS >> 1), (m[2].z | 0) + (RS >> 1)) ? m[2] : null;   // the same siting rule the builder answered to
      const foe = h ? hBlocked(h, pid) : 0;
      if (foe === hMe()) hsYield();   // they held this land before us: ours folds away and the owner chooses
      else if (foe) break;   // two rival houses overlap each other: whichever stands, stands — render nothing new
      applyHouse(pid, h);
      break;
    }
    case 24:   // the room could not carry our house record
      say('The world cannot carry your house as built (' + (m[1] | 0) + ' bytes): others will see its last shape. It is safe in your own save.', 'bad');
      break;
    case 7:   // the server could not store it: stop writing into a hole
      saveArmed = 0; saveFatal = 1;
   /* Clear the pending ack and mute the watchdog. The connection is fine — it is
         the blob the server will not take — and the watchdog's advice ("use Sign
         out to try saving again") is the one thing that provably cannot help, since
         sign-out returns at its own !saveArmed guard. */
      ackPending = 0; ackWarned = 1;
      if (ackResolve) { ackResolve(false); ackResolve = null; }
   /* A rescue copy, because there is otherwise nowhere left for this character to
         go: offSave is reachable only when OFFLINE, so an online player past the cap
         writes to neither D1 nor this browser. The blob may be over quota — that is
         the usual reason we are here — so the failure is swallowed. */
      try { store.set('seedworld.rescue.' + SEED, JSON.stringify(packSave())); } catch {}
      trouble('Seedworld could not save your character. Your progress this session will not be kept.', 'server refused save: ' + (m[1] || 'unknown'));
      say('A copy has been kept in this browser — do not clear site data before this is fixed.', 'bad');
      break;
   /* op 25: the write failed for a reason the next attempt may well survive — a dropped connection, an overloaded
         database. The session stays armed and the blob stays dirty; only the ack is cleared, so the watchdog does not
         scold about a write that is simply coming back. */
    case 25:
      ackPending = 0;
      if (ackResolve) { ackResolve(false); ackResolve = null; }
      saveDirty = 1;
      clearTimeout(saveTimer);
      saveTimer = setTimeout(flushSave, 15000);   // one backoff beat, then the ordinary rails take it again
      if (++saveDefer >= 4 && !ackWarned) {   // a minute of "come back later" is not transient any more, whatever the classifier thought
        ackWarned = 1;
        try { store.set('seedworld.rescue.' + SEED, JSON.stringify(packSave())); } catch {}
        trouble('Seedworld keeps putting your save off. Progress is not landing right now — a copy is kept in this browser.', 'op 25 x' + saveDefer + ': ' + (m[1] || ''));
      }
      break;
    case 11: {   // someone hit us
      const R = ensureRemote(m[1]); let dmg = clamp(m[2] | 0, 0, HIT_MAX);
      if (P.dead || !wildLvAt(P.tx, P.tz)) break;   // outside the wilderness no blade can reach you
      pvpFoes.set(String(m[1]), tickN + FOE_T);   // they struck first (or struck at all): answering them costs no skull, for a while
      if (!pvpOn) { pvpOn = 1; say('You are under attack!', 'bad'); }
      if (m[4] && dmg > 0 && prayHas('prot', m[4])) { dmg = Math.floor(dmg * 0.6); say('Your prayer turns part of the blow aside.'); }   // overheads soften another player's hit by 40%
      if (m[3] && dmg > 0 && P.pray > 0) { P.pray = Math.max(0, P.pray - Math.floor(dmg / 4)); say('You feel your prayer being smitten!', 'bad'); dirty.orb = 1; }
      hurtPlayer(dmg, String(m[1])); retaliate(R);   // the killer's name rides into die(): their kill, their pile
      break;
    }
    case 14: {   // trade signal
      const pid = m[1], nm = m[2] || 'Adventurer', act = m[3] | 0, mine = trade && trade.pid === pid;
      if (act === 0) { if (trade) wsSend([14, pid, 2]); else { trade = newTrade(pid, nm); askTrade(nm); } }
      else if (act === 1 && mine) { say(nm + ' accepted.', 'lv'); tradeOpen(); }
      else if (act === 2 && mine) tradeClose(nm + ' called off the trade.');
      else if (act === 3 && mine) {
   // they quote the version of my offer they accepted and their own: either moving inside the round trip voids the accept.
   // A room below build 11 does not forward the pair, so the check waits for one that does rather than refusing every trade.
   // A versioned accept always quotes at least 1, so an all-zero pair means this peer speaks no versions and the check
   // must not fire. On a real mismatch, re-announce my offer at the same version so the peer's accept is cleared too.
        if (srvBuild >= 11 && ((m[4] | 0) || (m[5] | 0)) && ((m[4] | 0) !== trade.ver || (m[5] | 0) !== trade.theirVer)) {
          trade.iOk = trade.theyOk = 0; trade.pend = null;
          wsSend([15, trade.pid, trade.mine, trade.ver]);
          drawTrade(); say('The offer changed — check it and accept again.', 'bad'); break;
        }
        trade.theyOk = 1; drawTrade(); tradeSettle();
      }
   // act 4: the leader has moved, so the follower performs on that word against the pair it froze when it accepted.
   // No iOk test: an edit after committing must not let this side dodge a bargain the other has already paid.
      else if (act === 4 && mine && !tradeLead() && trade.pend) {
        if (srvBuild < 11 || !((m[4] | 0) || (m[5] | 0)) || ((m[4] | 0) === trade.pend.ver && (m[5] | 0) === trade.pend.theirVer)) tradeMove(1);
      }
      break;
    }
    case 15:   // their offer changed: a changed offer is a new offer
      if (trade && trade.pid === m[1]) { trade.theirs = (m[2] || []).filter(e => ITEMS[e[0]] && e[1] > 0); trade.theirVer = m[3] | 0; trade.iOk = 0; trade.theyOk = 0; trade.pend = null; drawTrade(); }
      break;
    case 20: hearDeplete(/^-?\d+$/.test(m[1]) ? +m[1] : String(m[1]), m[2] | 0); break;   // tile keys are numbers; the relay stringifies them
    case 21: {   // a live monster, owned elsewhere
      const key = String(m[1]), q = npcs.find(x => x.key === key);
      if (!q) break;
      const act = m[7] | 0, owner = String(m[6] || '');
   // only the pid that actually holds it may let it go: element 8 is the relay's own record of the sender, not a claim
      if (act === 255) { if (q.owner && q.owner === String(m[8] || '')) { leash(q); q.target = null; } break; }
      if (owner === PID) break;
      if (q.owner === PID && q.target) {   // both claimed it at once: nearest wins, then the lower pid
        const mine = chebDist(q.tx, q.tz, P.tx, P.tz), R = remotes.get(owner), theirs = R ? chebDist(m[2] | 0, m[3] | 0, R.tx, R.tz) : 99;
        if (mine < theirs || (mine === theirs && PID < owner)) break;
        if (P.task && P.task.o === q) { P.task = null; say('Someone else is fighting that.', 'bad'); }
        q.target = null;
      }
      q.owner = owner; q.lastNet = tickN;
      const nx = m[2] | 0, nz = m[3] | 0, jump = chebDist(nx, nz, q.tx, q.tz);
      q.px = jump > 3 ? nx : q.tx; q.pz = jump > 3 ? nz : q.tz;
      q.tx = nx; q.tz = nz;
      npcFoot(q);
      q.faceT = ((m[4] | 0) & 15) / 16 * TAU;
      q.hp = clamp(m[5] | 0, 0, q.maxhp);
      if (act >= 1 && act <= 3) {
        q.atkT = 1; q.atkStyle = act === 1 ? 'm' : act === 2 ? 'r' : 'g';
        const V = remotes.get(owner);
        if (act > 1) npcBolt(q, q.atkStyle, V ? { rx: V.rx, ry: V.ry, rz: V.rz } : null);
      }
      break;
    }
    case 22: {   // a monster died, somewhere
      const key = String(m[1]), due = m[2] | 0;
      if (!(due > tickN)) break;
      npcDead.set(key, due);
      const q = npcs.find(x => x.key === key);
      if (q) { if (P.task && P.task.o === q) P.task = null; q.dead = 1; if (q.plate) { freePlate(q.plate); q.plate = null; } removeNpc(q); }
      break;
    }
    case 19: { const R = ensureRemote(m[1]); if (R) { shootArrow(R, aimAt(m[2] | 0, groundY(m[2] | 0, m[3] | 0), m[3] | 0), null, (m[4] | 0) || 0xc3c8d0); sfxAt(2692, R.tx, R.tz, 14, 0.7); } break; }
    case 18: { const R = ensureRemote(m[1]), sp = SPELLS[m[2] | 0]; if (R && sp) { remoteBolt(R, sp, m[3] | 0, m[4] | 0); sfxAt(spellSnd(sp), R.tx, R.tz, 14, 0.8); } break; }
    case 13: { const R = ensureRemote(m[1]); if (!R) break; R.hp = m[2] | 0; R.maxhp = Math.max(1, m[3] | 0); R.hurt = tickN; if (R.hp < R.maxhp) healthBar(R, 2.0); break; }
    case 16: losePile(m[2] | 0, m[3] | 0, Array.isArray(m[4]) ? m[4] : [], String(m[5] || '')); break;   // someone took from a broadcast pile: retract our mirror
    case 12: {   // a player died near us and spilled; the pile answers to its clock
      const R = remotes.get(m[1]), rows = (m[4] || []).filter(it => ITEMS[it[0]] && (it[1] | 0) > 0);
      const killer = String(m[5] || ''), t0 = m[6] | 0;
      sfxAt(512, m[2] | 0, m[3] | 0);
      say((R ? R.name : 'Someone') + ' has been defeated.', 'lv');
      if (!rows.length) break;
      if (!t0 || killer === PID) { for (const it of rows) dropItem(it[0], it[1] | 0, m[2] | 0, m[3] | 0, 1500, String(m[1])); break; }   // your kill: the pile is yours this minute
      if (pendingPiles.length < 40) pendingPiles.push({ due: t0 + (killer ? 100 : 750), x: m[2] | 0, z: m[3] | 0, rows, life: killer ? 1400 : 750, own: String(m[1]) });
      break;   // a killer's minute, or the fallen's safe half, then the pile opens to all
    }
    case 10:   // write confirmed
      ackPending = 0; ackWarned = 0; saveDefer = 0;
      if (ackResolve) ackResolve(true);
      if (!savedOnce) { savedOnce = 1; say('Character saved to ' + m[1] + '.', 'lv'); }
      break;
    case 1:   // movement, batched per sender
      for (const r of m[1]) { const R = ensureRemote(r[0], r[2] | 0, r[3] | 0); R.q.push({ k: r[1] | 0, x: r[2] | 0, z: r[3] | 0, f: r[4] | 0, s: r[5] | 0 }); if (R.q.length > 24) R.q.shift(); }
      break;
    case 2: {   // action: 7 draw, 6 cast, 8 thrust, else swing
      const R = ensureRemote(m[1]); if (!R) break;
      R.act = m[2] | 0; R.acting = R.act ? 1 : 0;
      R.pose = R.act === 7 ? 1 : R.act === 6 ? 2 : R.act === 8 ? 4 : 0;
      R.actSpan = R.act >= 5 && R.act <= 8 ? 4 : 2;
      break;
    }
    case 3: { const R = ensureRemote(m[1]); if (R) { R.eq = m[2] || []; R.eqDirty = 1; } break; }
    case 4: { const R = ensureRemote(m[1]); say((R ? R.name : 'Someone') + ': ' + m[2]); if (R) { R.bubble = String(m[2] ?? '').slice(0, 60); R.bubbleT = 4; } break; }
    case 5: dropRemote(m[1]); break;
    case 6: {   // enter; a rejoin refreshes rather than discards
      const pid = m[1];
      if (pid === PID) break;
      const had = remotes.get(pid);
      if (had) { had.name = m[2] || had.name; had.eq = m[5] || had.eq; had.eqDirty = 1; had.tx = had.px = m[3] | 0; had.tz = had.pz = m[4] | 0; had.lastSeen = tickN; had.q.length = 0; }
      else { remotes.set(pid, newRemote(pid, m[2], m[3], m[4], m[5])); remoteSort = 1; }
      break;
    }
    case 9: {   // clock echo: the lowest-RTT sample wins
      const c = m[1], s = m[2], now = Date.now(), rtt = now - c;
      pings.push({ rtt, off: s + rtt / 2 - now });
      if (pings.length > 8) pings.shift();
      let best = pings[0];
      for (const p of pings) if (p.rtt < best.rtt) best = p;
      clockOffset = Math.round(best.off);
      break;
    }
  }
}
/* outbound deltas: a stationary player costs nothing */
let lastMove = '', lastAct = -1, lastEqSent = '';
const stabbing = () => !!(eq.weapon && ITEMS[eq.weapon].stab);
function actCode() {
  if (!P.acting || !P.task) return 0;
  if (P.task.k === 'attack') return P.spell !== null ? 6 : bowRange() ? 7 : stabbing() ? 8 : 5;
  return ACT_CODE[P.task.k] || 0;
}
function netSend() {
  if (!ws || ws.readyState !== 1) return;
  const f16 = Math.round(P.faceT / TAU * 16) & 15, flags = (P.afloat ? 1 : 0) | (P.run ? 2 : 0), sig = P.tx + ',' + P.tz + ',' + f16 + ',' + flags;
  if (sig !== lastMove) { lastMove = sig; wsSend([1, tickN, P.tx, P.tz, f16, flags]); }
  const a = actCode();
  if (a !== lastAct) { lastAct = a; wsSend([2, tickN, a]); }
}
/* the worn list rides the wire with one extra entry, the Defence level as 'd:NN', past every slot so no dresser reads it */
function sendEquip() {
  if (!ws || ws.readyState !== 1) return;
  const arr = EQ_SLOTS.map(s => eq[s] || null);
  arr.push('d:' + lvl[SK.defence]);
  arr.push('c:' + combatLevel());   // combat rides too: the wilderness level rule needs to know who outranks whom
  if (skulled()) arr.push('sk:1');   // the mark travels with the gear; its absence, resent on fade, clears it — 11 + 3 riders = the worker's whole lane of 14
  const sig = arr.join('|');
  if (sig === lastEqSent) return;
  lastEqSent = sig;
  wsSend([3, arr]);
}
function remoteDef(R) {   // their Defence level off the wire (or reported hitpoints) and their armour
  let lv = 0, b = 0;
  for (const id of (R.eq || [])) {
    if (typeof id !== 'string') continue;
    if (id.startsWith('d:')) { lv = clamp(parseInt(id.slice(2), 10) || 0, 1, MAXL); continue; }
    const it = ITEMS[id];
    if (it && it.def) b += it.def;
  }
  return [(lv || clamp(R.maxhp | 0, 1, MAXL)) + 8, b];   // players carry +8 on their effective level
}

/* ---- 39. OTHER PLAYERS: the nearest twelve get articulated rigs, the rest one instanced pool ---- */
const remotes = new Map(), REMOTE_FULL = 12, rigPool = [], osrsPool = [], allRigs = [];
function takeRig(k07) {   // a rig is only ever reused for its own kind; the idle pool of the other kind costs nothing
  const pool = k07 ? osrsPool : rigPool;
  let g = pool.pop();
  if (!g) { g = k07 ? OSRSK.rig() : buildAvatar(); g.visible = false; scene.add(g); allRigs.push(g); }
  g.visible = true;
  return g;
}
/* Which rig a stranger gets: the 07 kit only while the camera is close to THEM, or they are close to you. Both
   halves matter — the camera answers "is this worth the detail on screen", your own tile answers "is this the
   person I am standing next to", and zooming out drops the first without taking the second. */
function osrsKind(R) {
  if (!osrsOn) return R.k07 = 0;
  const s = R.k07 ? 1 : OSRS_IN;
  const dx = R.rx - camera.position.x, dy = R.ry - camera.position.y, dz = R.rz - camera.position.z;
  return R.k07 = (dx * dx + dy * dy + dz * dz <= OSRS_CAM2 * s * s
    || Math.abs(R.tx - P.tx) + Math.abs(R.tz - P.tz) <= OSRS_NEAR * s) ? 1 : 0;
}
function giveRig(g) {
  g.visible = false;
  if (g.userData) g.userData.claim = 0;
  const pool = g.parts && g.parts.osrs ? osrsPool : rigPool;
  if (pool.indexOf(g) < 0 && pool.length < 24) pool.push(g);
}
function newRemote(pid, name, x, z, eqArr) {
  return { remote: 1, pid, name: name || 'Adventurer', hp: 10, maxhp: 10, hurt: 0, tx: x | 0, tz: z | 0, px: x | 0, pz: z | 0, rx: x | 0, ry: 0, rz: z | 0,
    face: 0, faceT: 0, afloat: 0, moved: 0, run: 1, energy: 100, act: 0, acting: 0, actSpan: 2, eq: eqArr || [], eqDirty: 1, q: [], path: [],
    walkPhase: 0, bobPhase: 0, swingPhase: 0, g: null, parts: null, plate: null, bubble: '', bubbleT: 0, lastSeen: tickN, lod: -1, k07: 0, arrT: tickN };
}
/* Only a positioned packet (ops 1 and 6 carry x,z) may conjure a remote: `undefined | 0`
   seated strangers at tile 0,0 — a phantom in your lap for anyone near the origin. Dropping
   the packet is safe: flush() re-sends an enter within 40 ms if they are genuinely near. */
function ensureRemote(pid, x, z) {
  if (pid === PID) return null;
  let R = remotes.get(pid);
  if (!R) {
    if (!Number.isFinite(x) || !Number.isFinite(z)) return null;
    remotes.set(pid, R = newRemote(pid, null, x, z, null)); remoteSort = 1;
  }
  R.lastSeen = tickN;
  return R;
}
const freeP = (o, k) => { if (o[k]) { freePlate(o[k]); o[k] = null; } };
function dropRemote(pid) {
  if (trade && trade.pid === pid) tradeClose(trade.name + ' has left.');   // an unopened request would otherwise soft-lock every later trade
  const R = remotes.get(pid); if (!R) return;
  if (R.g) { giveRig(R.g); R.g = null; R.parts = null; }
  if (R.skullSpr) { scene.remove(R.skullSpr); R.skullSpr = null; }
  freeP(R, 'plate'); freeP(R, 'bub');
  R.lod = -1;
  remotes.delete(pid); remoteSort = 1;
}
const clearRemotes = () => { for (const pid of [...remotes.keys()]) dropRemote(pid); };
function dressRemote(R) {
  R.eqDirty = 0;
  if (!R.parts) return;
  const e = R.eq || [];
  const it = s => { const id = e[EQ_SLOTS.indexOf(s)]; return (id && ITEMS[id]) || null; };
  if (R.parts.osrs) OSRSK.dress(R.parts, it); else dressRig(R.parts, REMOTE_LOOK, it);
}
const FAR_GEO = npcGeo([0.36, 0.42, 0.55], [0.82, 0.66, 0.5], 0.7, 1.7), POOL_FAR = Pool(FAR_GEO, 48, 1);
/* nameplates are pooled DOM; marker icons click through to the thing they float over */
const plateWrap = el('plates'), platePool = [];
on(plateWrap, 'click', e => {
  if (ctxAte) { ctxAte = 0; return; }
  const m = e.target.closest('.plate');
  if (!m || !m._obj) return;
  const opts = optionsFor(m._obj);
  if (opts.length) opts[0].f();
});
on(plateWrap, 'contextmenu', e => { const m = e.target.closest('.plate'); if (!m || !m._obj) return; e.preventDefault(); openCtx(e.clientX, e.clientY, optionsFor(m._obj)); });
function takePlate(owner, key) {
  for (const p of platePool) if (!p.live) { p.live = 1; p.own = owner; p.k = key; p.el.style.display = ''; return p; }
  const p = { el: div(plateWrap, 'plate'), live: 1, txt: '', claim: 1, own: owner, k: key }; platePool.push(p); return p;
}
const freePlate = p => { p.live = 0; p.el.style.display = 'none'; p.el._obj = null; if (p.own) { p.own[p.k] = null; p.own = null; } };   // release through the owner, or a reclaimed plate is held twice and steals the click
const _pv = new THREE.Vector3();
/* One projected label, pooled; false when behind the camera. `html` must be
   passed by the three call sites that compose their own markup — and ONLY those.
   It defaults off because two of the callers render text that came off the wire:
   a remote player's name and their chat bubble. The bubble was going into
   innerHTML, and sixty characters is more than enough for an onerror handler to
   read this origin's localStorage — where the account key lives, as the whole
   credential, with no rotation route at the time. It ran for everyone within
   forty-eight tiles and could rebroadcast itself through wsSend. */
function labelAt(owner, key, x, y, z, text, cls, html) {
  _pv.set(x, y, z).project(camera);
  if (_pv.z > 1) { freeP(owner, key); return false; }
  let q = owner[key];
  if (!q) q = owner[key] = takePlate(owner, key);
  q.claim = 1;
  if (q.txt !== text) { q.txt = text; if (html) q.el.innerHTML = text; else q.el.textContent = text; }
  if (q.cls !== cls) { q.cls = cls; q.el.className = cls; }
  q.el.style.transform = 'translate(' + ((_pv.x * 0.5 + 0.5) * innerWidth) + 'px,' + ((-_pv.y * 0.5 + 0.5) * innerHeight) + 'px) translate(-50%,0)';
  return true;
}
const DEATH_HTML = '<img src="' + _dmc.toDataURL() + '" alt=""> Your death';
const _markCache = new Map();
function markHtml(o) {
  const key = o.t === 5 ? 't5.' + o.k : o.t === 28 && o.gd ? 't28.' + o.gd.g.k : 't' + o.t;
  let h = _markCache.get(key);
  if (h) return h;
   /* A shop's key is its kind, exactly as the world map asks for it at 6003. This read `null` for o.t === 5, so the
       sprite branch below could never fire and every shop in every town drew a glyph — the one place the 07 sprites
       were wired up and then never reached. */
  const mk = o.t === 5 ? 'shop_' + SHOP_KINDS[o.k].k : o.t === 28 && o.gd ? 'guild_' + o.gd.g.k : MK_ART[o.t] ? o.t : o.t === 7 ? 'bank' : o.t === 9 ? 'barber' : o.t === 10 ? 'ge' : 'altar';
  const a = o.t === 5 ? [SHOP_KINDS[o.k].g, SHOP_KINDS[o.k].c, '#f0e6c8'] : MK_ART[mk] || MK_ART[o.t];
  _markCache.set(key, h = '<img src="' + (mk !== null && g07(MK07, mk) ? mk07p(MK07[mk]) : drawIcon(a[0], a[1], a[2])) + '" alt="">');
  return h;
}
function labelsBegin() { for (const g of allRigs) g.userData.claim = 0; for (const q of platePool) q.claim = 0; }
function labelsEnd() { for (const g of allRigs) if (!g.userData.claim && g.visible) giveRig(g); for (const q of platePool) if (!q.claim && q.live) freePlate(q); }
const lvlColour = (theirs, mine) => { const d = theirs - mine; return d <= -10 ? '#00ff00' : d <= -3 ? '#7fff2f' : d <= 2 ? '#ffff00' : d <= 9 ? '#ff9040' : '#ff3030'; };
let sortedRemotes = [], remoteSort = 1;   // a size test misses the compensating leave+enter the room batches into one message
/* ---- ONE TILE, ONE FIGURE: players stack — at a bank door, on a ladder, over a spawn — and a pile of rigs on one
   tile is z-fighting and a wall of nameplates and nothing else. OSRS's answer is that the last one onto the tile
   stands on top, so that is the one drawn and the rest are hidden entirely. Your own character always holds its own
   tile: being made invisible in your own world would be a bug, however the ordering fell. ---- */
const stackTop = new Map();
function stackPass() {
  stackTop.clear();
  stackTop.set(tk(P.tx, P.tz), null);   // null: yours, and no stranger may take it
  for (const R of remotes.values()) {
    const k = tk(R.tx, R.tz), cur = stackTop.get(k);
    if (cur === null) continue;
    if (!cur || R.arrT > cur.arrT || (R.arrT === cur.arrT && R.pid > cur.pid)) stackTop.set(k, R);   // pid breaks a tie, so every client hides the same one
  }
  /* ...with one exception: whoever you are actually dealing with. Losing sight of the player you are fighting,
     or trading with, because a passer-by stepped onto their tile is worse than any stack. Your own tile still
     outranks even that — being made invisible in your own world is never the right answer. */
  const busy = (P.task && P.task.o && P.task.o.remote) ? P.task.o : (trade && remotes.get(trade.pid)) || null;
  if (busy && stackTop.get(tk(busy.tx, busy.tz)) !== null) stackTop.set(tk(busy.tx, busy.tz), busy);
}
function hideRemote(R) {
  if (R.g) { giveRig(R.g); R.g = null; R.parts = null; }
  R.lod = -1;
  freeP(R, 'plate'); freeP(R, 'bub');
}
function updateRemotes(dt, alpha) {
  if (!remotes.size) { if (POOL_FAR.used) { poolReset(POOL_FAR); poolFlush(POOL_FAR); } return; }
  if ((tickN & 7) === 0 || remoteSort) {   // sort every 8 ticks: per-frame LOD churn would thrash the pool
    remoteSort = 0;
    sortedRemotes = [...remotes.values()].sort((a, b) => (Math.abs(a.tx - P.tx) + Math.abs(a.tz - P.tz)) - (Math.abs(b.tx - P.tx) + Math.abs(b.tz - P.tz)));
  }
  stackPass();
  poolReset(POOL_FAR);
  let plates = 0;
  const cut = RADIUS * CHUNK;
  for (let i = 0; i < sortedRemotes.length; i++) {
    const R = remotes.get(sortedRemotes[i].pid);   // resolve by id: a rejoined player is a new record under the same name
    if (!R) continue;
    let pkt = null;   // render a tick behind, so remote footfalls land on the same boundary as yours
    while (R.q.length && R.q[0].k <= tickN - 1) pkt = R.q.shift();
    if (R.lastTick !== tickN) {
      R.lastTick = tickN;
      R.px = R.tx; R.pz = R.tz;
      if (pkt) {
        const jump = Math.abs(pkt.x - R.tx) + Math.abs(pkt.z - R.tz);
        if (pkt.x !== R.tx || pkt.z !== R.tz) R.arrT = tickN;   // when they stepped onto the tile they are on: the stack order
        R.tx = pkt.x; R.tz = pkt.z;
        if (jump > 3) { R.px = R.tx; R.pz = R.tz; }
        R.moved = jump; R.faceT = pkt.f / 16 * TAU; R.afloat = pkt.s & 1; R.run = (pkt.s >> 1) & 1; R.lastSeen = tickN;
      } else R.moved = 0;
    }
    R.rx = R.px + (R.tx - R.px) * alpha; R.rz = R.pz + (R.tz - R.pz) * alpha; R.ry = R.afloat ? 0 : groundY(R.rx, R.rz);
    if (R.bubbleT > 0) R.bubbleT -= dt;   // ahead of the stack test: a bubble held frozen under a stack would pop out stale
    if (stackTop.get(tk(R.tx, R.tz)) !== R) { hideRemote(R); continue; }   // buried in a stack: kept up to date, drawn by nobody
    const far = Math.abs(R.rx - P.rx) > cut || Math.abs(R.rz - P.rz) > cut, wantLod = far ? 2 : (i < REMOTE_FULL ? 0 : 1);
    const k07 = wantLod === 0 ? osrsKind(R) : 0;
    const wrongKind = R.g && !!R.g.parts.osrs !== !!k07;   // the camera moved, or the setting did, under a rig already out
    if (wantLod !== R.lod || wrongKind) {
      if (R.g && (wantLod !== 0 || wrongKind)) { giveRig(R.g); R.g = null; R.parts = null; }
      if (wantLod === 0 && !R.g) { R.g = takeRig(k07); R.parts = R.g.parts; R.eqDirty = 1; }
      R.lod = wantLod;
    }
    if (wantLod === 0) {
      if (R.eqDirty) dressRemote(R);
      R.turn = R.g; R.rig = null;
      R.g.userData.claim = 1;
      R.g.position.set(R.rx, R.ry, R.rz);
      animate(R, R.parts, dt);
      R.g.rotation.y = R.face;
    } else if (wantLod === 1) {
      R.face += wrapA(R.faceT - R.face) * Math.min(1, dt * 12);
      poolPut(POOL_FAR, R.rx, R.ry, R.rz, R.face, 1, 1, 1, (R.eq && R.eq[1] && ITEMS[R.eq[1]]) ? hexInt(ITEMS[R.eq[1]].c) : 0x6a5a3f);
    }
    if (wantLod !== 2 && plates < 20) {
      const shown = labelAt(R, 'plate', R.rx, R.ry + 2.5, R.rz, R.name, 'plate');
      if (shown) plates++;
      if (R.bubbleT > 0) labelAt(R, 'bub', R.rx, R.ry + 2.5, R.rz, R.bubble, 'plate say'); else freeP(R, 'bub');
      if (!shown) freeP(R, 'plate');
    } else { freeP(R, 'plate'); freeP(R, 'bub'); }
  }
  poolFlush(POOL_FAR);
}
/* ---- 40. BOOT ---- */
freshCharacter();
osrsApply();   // the saved setting, now that the rig, the pools and the dresser are all up
if (!OPT.osrs) icons07Apply();   // the skills grid, the pvp tag and the map legend were all built before loadOpts read the setting
dressAvatar();
say('Welcome to Seedworld.', 'lv');
say('This whole world is four bytes. Everything else is arithmetic.');

/* ---- 41. WELCOME: the preview runs the same macroHeight and siting pass the world will use ---- */
const WEL = el('welcome'), welCan = el('welmap'), welCtx = welCan.getContext('2d'), WPX = welCan.width, WTILE = 8;
const rollSeed = () => WORDS[(Math.random() * WORDS.length) | 0] + WORDS[(Math.random() * WORDS.length) | 0] + (Math.random() * 900 + 99 | 0);
/* painted at half resolution and upscaled, one field sample per pixel (the row's neighbour doubles as the shading sample),
   a few milliseconds of rows per frame. A newer keystroke, Roll, or Enter simply abandons the job mid-paint. */
const welLow = document.createElement('canvas'); welLow.width = welLow.height = WPX >> 1;
const welLowCtx = welLow.getContext('2d'), welLowImg = welLowCtx.createImageData(WPX >> 1, WPX >> 1);
let welJob = 0;
function previewSeed(str) {
  const job = ++welJob, HPX = WPX >> 1, HT = WTILE * 2;
  const mySeed = hashSeed(str) | 0, myVc = new Map(), myNc = new Map();
  let j = 0, land = 0, keep, vc, nc;
  const enter = () => { keep = S; vc = villageCache; nc = nbrCache; S = mySeed; villageCache = myVc; nbrCache = myNc; resetLookups(); };
  const leave = () => { S = keep; villageCache = vc; nbrCache = nc; resetLookups(); };
  const rows = () => {
    if (job !== welJob) return;
    enter();
    const t0 = performance.now(), D = welLowImg.data;
    for (; j < HPX && performance.now() - t0 < 6; j++) {
      const z = (j - HPX / 2) * HT;
      let p = j * HPX * 4, h = macroHeight((-HPX / 2) * HT, z);
      for (let i = 0; i < HPX; i++) {
        const x = (i - HPX / 2) * HT, e = macroHeight(x + HT, z);
        let r, g, b;
        if (h < 0) { const t = clamp(-h / 16, 0, 1); r = 44 - t * 20; g = 88 - t * 42; b = 112 - t * 48; }
        else {
          land++;
          const sh = clamp(0.95 - (e - h) * 0.07, 0.45, 1.35), c = colorAt(x, z, h, Math.abs(e - h) / HT);
          r = c[0] * 255 * sh; g = c[1] * 255 * sh; b = c[2] * 255 * sh;
        }
        D[p++] = r; D[p++] = g; D[p++] = b; D[p++] = 255;
        h = e;
      }
    }
    if (j < HPX) { leave(); setTimeout(rows, 16); return; }   // setTimeout, not rAF: a hidden tab must still finish the paint
    welLowCtx.putImageData(welLowImg, 0, 0);
    welCtx.imageSmoothingEnabled = true;
    welCtx.drawImage(welLow, 0, 0, WPX, WPX);
    const cells = Math.ceil(WPX * WTILE / 2 / SETTLE_CELL) + 1, tally = [0, 0, 0, 0, 0];   // the settlements the siting stage approves of
    for (let a = -cells; a <= cells; a++) for (let b = -cells; b <= cells; b++) {
      const v = villageAt(a, b);
      if (!v) continue;
      tally[v.rank]++;
      const px = WPX / 2 + v.x / WTILE, pz = WPX / 2 + v.z / WTILE;
      if (px < -8 || pz < -8 || px > WPX + 8 || pz > WPX + 8) continue;
      welCtx.beginPath(); welCtx.arc(px, pz, Math.max(1.6, v.r / WTILE), 0, TAU);
      welCtx.fillStyle = DISC[v.rank]; welCtx.fill();
      welCtx.strokeStyle = 'rgba(30,20,10,.7)'; welCtx.lineWidth = 1; welCtx.stroke();
    }
    el('welStat').innerHTML = '<b>' + (tally[4] + tally[3]) + '</b> cities &nbsp; <b>' + tally[2] + '</b> towns &nbsp; <b>' + (tally[0] + tally[1]) + '</b> villages &nbsp;·&nbsp; <b>' +
      Math.round(land / (HPX * HPX) * 100) + '%</b> land';
    leave();
  };
  rows();
}
let welTimer = 0, welPopT = 0;
const welSeedEl = el('welSeed'), welGoEl = el('welGo');
const curSeed = () => welSeedEl.value || 'lumbridge';
function welSync() {   // the chosen world wears the highlight, wherever its button lives
  const s = curSeed().trim().toLowerCase();
  for (const b of document.querySelectorAll('.wof, .wchar')) b.classList.toggle('sel', (b.dataset.wof || b.dataset.seed || '').toLowerCase() === s);
}
const welPick = seed => { welSeedEl.value = seed; previewSeed(seed); pollPopulation(); };   // select; Enter this world commits
/* The preview is local arithmetic and can keep up with typing. The head-count is not: every unseen seed is a
   Durable Object woken to be asked how empty it is, and a half-typed world name is not a world. So the map
   follows the keys and the count waits for the typing to stop. */
on(welSeedEl, 'input', () => {
  welSync();
  clearTimeout(welTimer); welTimer = setTimeout(() => previewSeed(curSeed()), 180);
  clearTimeout(welPopT); welPopT = setTimeout(pollPopulation, 800);
});
el('welRoll').onclick = () => welPick(rollSeed());
welGoEl.onclick = () => enterWorld(curSeed());
for (const b of document.querySelectorAll('.wof')) b.onclick = () => welPick(b.dataset.wof);
on(welSeedEl, 'keydown', e => { if (e.key === 'Enter') welGoEl.click(); });
const setGo = (txt, off) => { welGoEl.disabled = !!off; welGoEl.textContent = txt; };
/* fetch the character for this seed, apply it, open the socket, reveal the world; every await has an offline fallback */
async function enterWorld(seed) {
  welJob++;   // abandon any preview mid-paint before the world takes the seed globals
  seed = (seed || 'lumbridge').trim().toLowerCase().slice(0, 32) || 'lumbridge';
  SEED = seed;
  welSeedEl.blur();
  setGo('Loading…', 1);
  let blob = null, isNew = 1, loaded = 0;
  saveArmed = 0; savedOnce = 0; saveFatal = 0;   // a fresh entry starts with a clean slate: last world's refusal must not follow us
  if (!OFFLINE && AUTH) {
    let j = null;
    for (let a = 0; a < 3 && !loaded; a++) {   // a blip must not cost the character: three tries
      if (a) await wait(400 * a);
      j = await api('/save?seed=' + encodeURIComponent(seed));
      if (j && !j.e) loaded = 1;
      else if (j && j.__html) j.e = 'HTTP ' + j.__status + ' — /save is not reaching the Worker';
    }
    if (loaded) { blob = j.save; isNew = j.isNew; NAME = j.name || NAME; }
    else if (!j) trouble('Could not reach Seedworld.', 'network failure on /save');
    else trouble('Could not load your character.', '/save said: ' + j.e);
  }
  el('seed').value = seed;
  loadSeed(seed);
  if (!OFFLINE && AUTH && !loaded) {   // read-only: never write a character that was never really loaded
    freshCharacter();
    say('Your saved character could not be loaded, so nothing will be stored', 'bad');
    say('this session. Your progress so far is safe — reload to try again.', 'bad');
  } else if (readableSave(blob) && !isNew) {
    applySave(blob);
    saveArmed = 1;
    if (Number.isInteger(blob.tx)) teleport(blob.tx, blob.tz, 300);   // resume where you stood
    say('Welcome back, ' + (NAME || 'Adventurer') + '.', 'lv');
  } else if (OFFLINE) {   // offline: this browser is the database
    let ob = null; try { ob = JSON.parse(store.get('seedworld.off.' + seed) || 'null'); } catch {}
    if (readableSave(ob)) {
      applySave(ob);
      if (Number.isInteger(ob.tx)) teleport(ob.tx, ob.tz, 300);
      say('Welcome back. This device remembered your character.', 'lv');
    } else { freshCharacter(); say('A new life begins in ' + seed + ', kept on this device.', 'lv'); }
    saveArmed = 1;
    store.set('seedworld.off.last', seed);
  } else if (isNew === 1 && !readableSave(blob)) {
    freshCharacter();
    saveArmed = 1;
    say('A new life begins in ' + seed + '.', 'lv');
  } else {
   /* The server said a row exists (isNew 0) but nothing usable came back, or it
       came back new AND carrying a blob. Either way this is not a blank account,
       and the branch above would have run freshCharacter() and then written a
       614-byte starter over a real character. Play, but write nothing. */
    freshCharacter();
    saveArmed = 0; saveFatal = 1;
    say('Your character is on the server but could not be read, so nothing will', 'bad');
    say('be stored this session. Reload to try again — your progress is safe.', 'bad');
  }
  dressAvatar();
  drawInv(); drawEq(); drawSk(); drawOrbs();
  WEL.classList.add('gone');
  setTimeout(() => { WEL.style.display = 'none'; }, 420);
  setGo('Enter this world', 0);
  started = 1;
  bgmPlay();   // the score belongs to the world, not to the login screen; this is where its four megabytes are asked for
  document.body.classList.add('ingame');
  el('adminBtn').style.display = SEED === 'lumbridge(sandbox)' ? '' : 'none';   // the sandbox wears its admin door openly
  if (!OFFLINE && AUTH) { connect(); if (isNew || !readableSave(blob)) markDirty(2); geGreet(); }   // a loaded character need not write back the byte-identical blob it just read
}
let started = 0;

/* ---- 42. TRADING: two offers, two confirmations, any change clears both ---- */
let trade = null;
const TR = () => el('tradeWrap');
/* ver counts my offer's edits, theirVer the last of theirs I have seen. An accept quotes both, so an offer that moved
   inside the round trip can never be settled against — the window that let one side settle alone. */
const newTrade = (pid, name) => ({ pid, name, mine: [], theirs: [], iOk: 0, theyOk: 0, open: 0, ver: 1, theirVer: 1 });   // BOTH start at 1: a side that offers nothing never sends an op 15, and a 0 here refused every gift trade
const tradeSend = (action, seen, mine) => { if (trade) wsSend([14, trade.pid, action, seen | 0, mine | 0]); };
function tradeRequest(R) {
  if (trade) return say('You are already trading.', 'bad');
  if (!ws || ws.readyState !== 1) return say('You need to be online to trade.', 'bad');
  if (!remotes.has(R.pid)) return say(R.name + ' is no longer here.', 'bad');
  trade = newTrade(R.pid, R.name);
  tradeSend(0);
  say('Sending a trade offer to ' + R.name + '…');
}
function tradeOpen() {
  trade.open = 1;
  P.task = null; P.path.length = 0;
  TR().classList.add('on');
  showTab('inv');
  drawTrade();
}
function tradeClose(msg) {
  if (trade && !trade.open) hideBye();   // a request cancelled before it opened would leave its dialog up, and its button throws on a null trade
  TR().classList.remove('on');
  closeCtx();
  trade = null;
  if (msg) say(msg);
  dirty.inv = 1;
}
function tradeCancel(tell) { if (!trade) return; if (tell) tradeSend(2); tradeClose('The trade was called off.'); }
function tradeTouch() { trade.iOk = 0; trade.theyOk = 0; trade.pend = null; wsSend([15, trade.pid, trade.mine, ++trade.ver]); drawTrade(); }
/* the pack must hold what is coming once what is going has left, so capacity cannot be judged before the offer is known */
function tradeFits() {
  let freed = 0, need = 0;
  for (const [id, k] of trade.mine) { const it = ITEMS[id]; freed += it && it.stack ? (invCount(id) <= k ? 1 : 0) : k; }
  for (const [id, k] of trade.theirs) { const it = ITEMS[id]; if (it) need += it.stack ? (invCount(id) ? 0 : 1) : k; }
  return need - freed <= invFree();
}
function tradeAdd(slot, k) {
  const st = inv[slot]; if (!st || !trade || !trade.open) return;
  k = Math.max(1, k | 0 || 1);
  const cap = ITEMS[st.id] && ITEMS[st.id].stack ? st.n : invCount(st.id), have = trade.mine.find(e => e[0] === st.id);   // the ceiling is what the pack holds in total
  if (have) {
    if (have[1] >= cap) return say('You have no more ' + ITEMS[st.id].name.toLowerCase() + ' to offer.', 'bad');
    have[1] = Math.min(cap, have[1] + k);
  } else {
    if (trade.mine.length >= 12) return say('You cannot offer more than twelve stacks.', 'bad');
    trade.mine.push([st.id, Math.min(cap, k)]);
  }
  tradeTouch();
}
function tradeRemove(i, k) {
  if (!trade || !trade.open) return;
  const e = trade.mine[i]; if (!e) return;
  e[1] -= Math.max(1, k | 0 || 1);
  if (e[1] <= 0) trade.mine.splice(i, 1);
  tradeTouch();
}
function tradeConfirm() {
  if (!trade || !trade.open || trade.iOk) return;
  if (P.dead) return say('You cannot trade right now.', 'bad');
  if (!tradeFits()) return say('You do not have room for that.', 'bad');   // refused here, before the wire ever hears an accept
   // the rows are frozen at the moment of acceptance: settlement quotes this, never the live lists, so a later edit
   // (or a death, or an X click) cannot make one side refuse a bargain the other has already performed
  trade.pend = { ver: trade.ver, theirVer: trade.theirVer, mine: trade.mine.map(r => r.slice()), theirs: trade.theirs.map(r => r.slice()) };
  trade.iOk = 1; tradeSend(3, trade.theirVer, trade.ver); drawTrade(); tradeSettle();
}
/* One side has to go first, or both can refuse independently and only one of them will have moved. The pids come from
   the room, so string order is a total order both clients agree on without asking: the leader settles, then says so on
   act 4, and the follower performs on that word alone — it never re-judges, it spills any overflow at its feet. */
const tradeLead = () => String(PID) < String(trade.pid);   // both are room-issued strings; String() keeps a null PID from making both sides followers
function tradeMove(spillOver) {
  const deal = trade.pend || trade;
  for (const [id, k] of deal.mine) invRemove(id, k);
  for (const [id, k] of deal.theirs) {
    if (!ITEMS[id]) continue;
    const got = invAdd(id, k) | 0;
    if (got < k && spillOver) { dropItem(id, k - got, P.tx, P.tz, 3000); say('Your pack was full — the rest falls at your feet.', 'bad'); }
  }
  const name = trade.name;
  markDirty(2);
  tradeClose('');
  say('Trade with ' + name + ' complete.', 'lv');
}
function tradeSettle() {
  if (!trade || !trade.iOk || !trade.theyOk) return;
  if (!tradeLead()) return;   // the follower waits for act 4: nothing of its own moves until the leader has moved
  const deal = trade.pend || trade;
  if (P.dead || !hasAll(deal.mine) || !tradeFits()) { say('You do not have room for that.', 'bad'); trade.iOk = 0; tradeSend(2); tradeClose('The trade was called off.'); return; }
  tradeSend(4, deal.theirVer, deal.ver);
  tradeMove(0);
}
const itemName = id => ITEMS[id] ? ITEMS[id].name : id;
function drawTrade() {
  if (!trade) return;
  const cell = (e, i, mine) => '<div class="tcell" ' + (mine ? 'data-rm="' + i + '"' : 'data-ex="' + i + '"') + ' title="' + itemName(e[0]) + ' x' + e[1] + '">' + img(e[0]) + stackLbl(e[1]) + '</div>';
  const worth = list => list.reduce((a, e) => a + (ITEMS[e[0]] ? (e[0] === 'coins' ? e[1] : sellPrice(ITEMS[e[0]]) * e[1]) : 0), 0);
  el('tradeTitle').textContent = 'Trading with ' + trade.name;
  el('tradeMine').innerHTML = trade.mine.map((e, i) => cell(e, i, 1)).join('') || '<p class="tnone">Click your pack to offer an item. Right-click it for 5, 10 or all.</p>';
  el('tradeTheirs').innerHTML = trade.theirs.map((e, i) => cell(e, i, 0)).join('') || '<p class="tnone">Nothing offered yet.</p>';
  el('tradeMineHd').textContent = 'Your offer (' + fmt(worth(trade.mine)) + ' gp)' + (trade.iOk ? ' ✓' : '');
  el('tradeTheirsHd').textContent = trade.name + ' (' + fmt(worth(trade.theirs)) + ' gp)' + (trade.theyOk ? ' ✓' : '');
  const b = el('tradeOk');
  b.textContent = trade.iOk ? 'Waiting for ' + trade.name : 'Accept trade';
  b.disabled = !!trade.iOk;
}
el('tradeOk').onclick = tradeConfirm;
el('tradeX').onclick = el('tradeNo').onclick = () => tradeCancel(1);
on(el('tradeMine'), 'click', e => { const c = e.target.closest('[data-rm]'); if (c) tradeRemove(+c.dataset.rm, 1); });
on(el('tradeMine'), 'contextmenu', e => {
  e.preventDefault();
  const c = e.target.closest('[data-rm]'); if (!c || !trade) return;
  const i = +c.dataset.rm, en = trade.mine[i]; if (!en) return;
  const nm = itemName(en[0]), opts = [];
  for (const k of [1, 5, 10]) if (en[1] >= k) opts.push(itm('Withdraw ' + k, nm, () => tradeRemove(i, k)));
  opts.push(itm('Withdraw all', nm, () => tradeRemove(i, 1e9)));
  openCtx(e.clientX, e.clientY, opts);
});
on(el('tradeTheirs'), 'click', e => {   // their side is theirs to change, but you can read it
  const c = e.target.closest('[data-ex]'); if (!c || !trade) return;
  const en = trade.theirs[+c.dataset.ex]; if (!en || !ITEMS[en[0]]) return;
  say(en[1] + ' x ' + ITEMS[en[0]].name + ' — ' + examine(ITEMS[en[0]]));
});

/* ---- 43. LEAVING PROPERLY: signing out is the one moment we can wait for the server to confirm the write ---- */
const BYE = el('bye');
const byeMsg = t => { el('byeMsg').textContent = t; };
const wait = ms => new Promise(r => setTimeout(r, ms));
let byeBusy = 0, ackResolve = null;
function showBye(title, msg, btns) {
  el('byeTitle').textContent = title;
  byeMsg(msg);
  el('byeBtns').innerHTML = '';
  for (const [txt, fn] of (btns || [])) { const b = document.createElement('button'); b.textContent = txt; b.onclick = fn; el('byeBtns').appendChild(b); }
  BYE.classList.add('on');
}
const hideBye = () => BYE.classList.remove('on');
async function saveAndConfirm(tries) {   // push a save and wait for the server to say it landed
  for (let i = 0; i < tries; i++) {
    if (!ws || ws.readyState !== 1) { byeMsg('Reconnecting…'); wsWant = 1; connect(); await wait(1400); }
    if (ws && ws.readyState === 1) {
      saveDirty = 1;
      const acked = new Promise(res => { ackResolve = res; });
      flushSave(3);   // sign-out is the one moment that waits for the write: skip every gap
      const ok = await Promise.race([acked, wait(4000).then(() => false)]);
      ackResolve = null;
      if (ok) return true;
    }
    if (i < tries - 1) { byeMsg('Still trying… attempt ' + (i + 2) + ' of ' + tries); await wait(900 + i * 600); }
  }
  return false;
}
const leaveAnyway = ['Leave anyway', () => { byeBusy = 0; toWorldSelect(); }];
async function signOut() {
  if (byeBusy || !started) return;
  byeBusy = 1;
  showBye('Signing out', 'Saving your character…');
  if (OFFLINE) offSave(1);
  /* saveFatal is checked first, and that ordering is the whole point. The
     !saveArmed short-circuit reports success without attempting anything, which
     is right when there was never anything to save (offline, no account) and a
     plain untruth once the server has refused a blob or the build has been
     declared too old. Telling somebody their character is saved when it is not
     is worse than telling them it failed. */
  const ok = saveFatal ? false : (OFFLINE || !AUTH || !saveArmed) ? true : await saveAndConfirm(5);
  if (ok) { byeBusy = 0; toWorldSelect(1); return; }
  showBye('Could not save', 'Seedworld is not responding. Leaving now may lose the last few minutes of progress.', [
    ['Keep trying', async () => { showBye('Signing out', 'Saving your character…'); const ok2 = await saveAndConfirm(5); byeBusy = 0; if (ok2) toWorldSelect(1); else signOutFailed(); }], leaveAnyway]);
  byeBusy = 0;
}
const askTrade = nm => showBye('Trade request', nm + ' wishes to trade with you.', [['Trade', () => { hideBye(); if (!trade) return say(nm + ' is no longer trading.', 'bad'); tradeSend(1); tradeOpen(); }], ['Decline', () => { hideBye(); tradeSend(2); tradeClose(''); }]]);
const signOutFailed = () => showBye('Could not save', 'Still no response. You can keep playing and try again later, or leave and lose recent progress.', [['Keep playing', hideBye], ['Leave anyway', () => toWorldSelect()]]);   // wrapped: showBye hands the handler a MouseEvent, which is truthy
function toWorldSelect(saved) {   // back to the world list, still signed in
  if (trade) tradeCancel(1);
  hideBye();
  started = 0;
  document.body.classList.remove('ingame');
  closeWorldMap();
  saveArmed = 0; wsWant = 0;
  clearTimeout(wsTimer);
  dropSocket();
  everConnected = 0;
  forgetSent();
  clearRemotes(); netStatus(0);
  closeOverlays(); closeCtx(); closeDev();
  P.task = null; P.path.length = 0;
  WEL.style.display = ''; WEL.classList.remove('gone');
  setGo('Enter this world', 0);
  if (!OFFLINE && AUTH) loadCharacterList(); else if (OFFLINE) offChars();
  pollPopulation();
  say(saved ? 'You have signed out. Your character is saved.' : 'You have signed out — recent progress was not saved.', saved ? 'lv' : 'bad');
}
el('signout').onclick = signOut;

/* ---- 44. LOGIN: who you are, then where you are; every branch has an offline exit ---- */
const LOG = el('login');
const msgTo = id => (m, cls) => { const d = el(id); d.textContent = m || ''; d.className = 'lmsg ' + (cls || ''); };
const lmsg = msgTo('lmsg'), rmsg = msgTo('rmsg');
function showLogin(which) {
  el('lgExisting').style.display = which === 'new' ? 'none' : '';
  el('lgNew').style.display = which === 'new' ? '' : 'none';
  lmsg(''); rmsg('');
}
let regKey = '', nameOK = '';
const syncCreate = () => { el('lgCreate').disabled = !(el('lgSaved').checked && regKey && nameOK && nameOK.toLowerCase() === el('lgName').value.trim().toLowerCase()); };
el('lgGen').onclick = () => {
  regKey = newKey();
  el('lgKeyOut').textContent = regKey;
  el('lgKeyBox').style.display = '';
  rmsg('Save this key. It is the only way back into the account.', 'warn');
  syncCreate();
};
el('lgCopy').onclick = async () => { try { await navigator.clipboard.writeText(regKey); rmsg('Key copied.', 'ok'); } catch { rmsg('Could not copy — select it and copy by hand.', 'bad'); } };
el('lgDl').onclick = () => {
  const b = new Blob(['Seedworld account key\n\n' + regKey + '\n\nThis is the only way to log in. There is no recovery.\n'], { type: 'text/plain' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(b); a.download = 'seedworld-key.txt'; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
};
el('lgSaved').onchange = syncCreate;
el('lgName').oninput = () => { nameOK = ''; rmsg(''); syncCreate(); };
el('lgCheck').onclick = async () => {
  const nm = el('lgName').value.trim(), j = await api('/name-check?name=' + encodeURIComponent(nm));
  if (!j) return rmsg('Cannot reach the server.', 'bad');
  if (!j.valid) return rmsg(j.e, 'bad');
  if (!j.available) { nameOK = ''; syncCreate(); return rmsg('"' + nm + '" is taken.', 'bad'); }
  nameOK = nm; syncCreate(); rmsg('"' + nm + '" is available.', 'ok');
};
el('lgCreate').onclick = async () => {
  if (!await useKey(regKey)) return rmsg('That key is malformed.', 'bad');
  rmsg('Creating account…');
  const j = await apiJson('/register', { auth: AUTH, pid: PID, name: el('lgName').value.trim() });
  if (!j) return rmsg('Cannot reach the server. Try Play offline.', 'bad');
  if (j.ok) { NAME = j.name; return afterLogin(); }
  if (j.e === 'key_registered') { NAME = j.name; rmsg('That key already has an account — logging you in.', 'warn'); return afterLogin(); }
  rmsg(j.e === 'name_taken' ? 'Name taken.' : j.e === 'rate_limited' ? 'Too many accounts from this address in the last hour.' : 'Could not register: ' + j.e, 'bad');
};
el('lgToNew').onclick = () => showLogin('new');
el('lgToOld').onclick = () => showLogin('old');
/* one account lookup serves the boot check, the login and the character list: name, last world and characters in a single request */
let acct = null;
async function fetchAccount() {
  let j = await api('/characters');
  if (!j || j.__status === 404) j = await api('/save?list=1');   // run_worker_first may not be deployed; /save always is
  if (j && !j.e) { acct = { key: KEY, name: j.name, last: j.last, characters: j.characters || [] }; NAME = j.name; if (j.last) SEED = j.last; }
  return j;
}
el('lgLogin').onclick = async () => {
  if (!await useKey(el('lgKey').value)) return lmsg('A key is 25 characters.', 'bad');
  if (acct && acct.key === KEY) return afterLogin();   // the boot check already answered for this key
  lmsg('Logging in…');
  const j = await fetchAccount();
  if (!j) return lmsg('Cannot reach the server. Try Play offline.', 'bad');
  if (j.e) return lmsg(j.__status === 401 ? 'No account for that key — register instead.' : j.e, 'bad');
  afterLogin();
};
el('lgOffline').onclick = () => { OFFLINE = 1; AUTH = null; afterLogin(); };
async function afterLogin() {
  LOG.classList.add('gone');
  setTimeout(() => { LOG.style.display = 'none'; }, 400);
  el('welWho').textContent = OFFLINE ? 'Playing offline — your characters live in this browser' : 'Signed in as ' + (NAME || 'Adventurer');
  welSeedEl.value = (OFFLINE ? store.get('seedworld.off.last') || SEED : SEED) || 'lumbridge';   // offline remembers the last world you stood in
  previewSeed(welSeedEl.value);
  if (OFFLINE) offChars(); else await loadCharacterList(1);
  pollPopulation();
}
let haveChars = new Set(), popTimer = 0;
async function loadCharacterList(cached) {   // existing characters become one-click entries
  const box = el('welChars');
  if (!(cached && acct && acct.key === KEY)) await fetchAccount();
  const list = acct && acct.key === KEY ? acct.characters : [];
  if (!list.length) { box.innerHTML = ''; return; }
  box.innerHTML = '<div class="wclab">Your characters</div>' + list.map(c => '<button class="wchar" data-seed="' + c.seed + '">' + c.seed + ' <u>combat ' + c.combat + ' · total ' + c.totalLevel + '</u></button>').join('');
  box.querySelectorAll('.wchar').forEach(b => b.onclick = () => welPick(b.dataset.seed));
  haveChars = new Set(list.map(c => c.seed));
}
function offChars() {   // the character list the server would send, read from this browser
  const box = el('welChars'), rows = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (!k || !k.startsWith('seedworld.off.') || k === 'seedworld.off.last') continue;
    let b = null; try { b = JSON.parse(localStorage[k]); } catch {}
    if (!readableSave(b)) continue;
    const xs = b.xp || [], L = si => levelFor(+xs[si] || 0);
    let tot = 0; for (let si = 0; si < NSK; si++) if (!SKILLS[si].locked) tot += L(si);
    const cb = Math.floor(0.25 * (L(SK.defence) + Math.max(10, L(SK.hitpoints)) + Math.floor(L(SK.prayer) / 2)) +
      Math.max(0.325 * (L(SK.attack) + L(SK.strength)), 0.325 * Math.floor(L(SK.ranged) * 1.5), 0.325 * Math.floor(L(SK.magic) * 1.5))) || 3;
    rows.push([k.slice(14), cb, tot]);
  }
  rows.sort((a, b2) => a[0] < b2[0] ? -1 : 1);
  haveChars = new Set(rows.map(r => r[0]));
  const nice = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
  box.innerHTML = rows.length ? '<div class="wclab">Your characters here</div>' + rows.map(([s, cb, tot]) =>
    '<button class="wchar" data-seed="' + nice(s) + '">' + nice(s) + ' <u>combat ' + cb + ' · total ' + tot + '</u></button>').join('') : '';
  box.querySelectorAll('.wchar').forEach(bt => bt.onclick = () => welPick(bt.dataset.seed));
}
async function pollPopulation() {   // only while the select screen is up; always speaks of the SELECTED world
  clearTimeout(popTimer);
  if (started) return;
  welSync();
  const seed = curSeed().trim().toLowerCase(), line = el('welPop'), mine = haveChars.has(seed) ? ' · you have a character here' : ' · new character';
  if (OFFLINE) { line.textContent = 'Offline' + mine; return; }
  let j = await api('/population?seed=' + encodeURIComponent(seed));
  if (!j || j.__status === 404) j = await api('/save?pop=1&seed=' + encodeURIComponent(seed));
  const ok = j && typeof j.n === 'number';
  line.textContent = (ok ? (j.n === 1 ? '1 player online' : j.n + ' players online') : 'population unknown') + mine;
  popTimer = setTimeout(pollPopulation, 30000);
}
(async () => {   // a saved key skips straight to a one-click login
  const saved = store.get('seedworld.key');
  if (saved && await useKey(saved)) {
    el('lgKey').value = saved;
    const j = await fetchAccount();
    if (j && !j.e) { el('lgLogin').textContent = 'Log in as ' + j.name; lmsg('Welcome back. Press log in to continue.', 'ok'); }
    else if (!j) lmsg('Server unreachable — you can still play offline.', 'warn');
    else lmsg('That saved key has no account here.', 'bad');
  }
  welSeedEl.value = 'lumbridge';
  previewSeed('lumbridge');
})();

/* ---- 45. SKILLS: one block a skill, in dependency order. A block defines its own items, recipes, objects and verbs, and registers what the world
   must know in TASKS, USE_ON, onKill, tickHooks, poolHooks, structHooks and pickLists. Everything above is shared; nothing above calls down here at load. ---- */

/* ---- ICONS for the skill items, in the 6c voice: 32x32, 1px K outlines, c primary, d shade ---- */
Object.assign(GLYPH, {
  plank(g, c, d) {
    g.save(); g.translate(16, 16); g.rotate(-0.35);
    fr(g, c, -14, -5, 28, 10); fr(g, d, 10.5, -5, 3.5, 10); ln(g, d, 1, [-12, -2, 9, -1.2], [-12, 2.2, 5, 1.6]); g.strokeStyle = K; g.strokeRect(-14, -5, 28, 10);
    g.restore();
  },
});

/* ---- WORLD SITES & TOWN AMENITIES: the furniture of the named places — mine rims, grove signs, waypoints between towns,
   and the amenities every settlement guarantees (shrine, bank booth, pen, pier, tavern stock, the chartered guilds). ---- */
defItem({ id: 'beer', name: 'Beer', g: 'mug', c: '#c9812a', c2: '#f0e6c8', val: 2, opt: ['Drink', () => {
  invRemove('beer', 1); sfx(2390);
  potBoost('strength', 1, 0.04); potDrain('attack', 2, 0.03);
  P.hp = Math.min(P.maxhp, P.hp + 1);
  say('You drink the beer. You feel slightly reinvigorated.');
  dirty.inv = dirty.sk = dirty.orb = 1; markDirty();
}] });
function emitShrine(B, s) {   // the church porch altar, freestanding on a sunken pad
  const { x, z, y } = s;
  B.add(BOX, x, y - 1.9, z, 4.6, 4.4, 4.6, 0, C_FOUND);
  B.add(BOX, x, y + 0.55, z, 2.0, 1.1, 0.9, 0, C_STONE2); B.add(BOX, x, y + 1.14, z, 2.2, 0.14, 1.05, 0, C_STONE);
  B.add(BOX, x, y + 1.24, z, 0.7, 0.1, 1.1, 0, C_BANNER);
  for (const sg of [-1, 1]) { B.add(BOX, x + sg * 0.85, y + 1.4, z, 0.14, 0.4, 0.14, 0, C_CLOTH); B.add(BOX, x + sg * 0.85, y + 1.66, z, 0.1, 0.14, 0.1, 0, [1, 0.78, 0.3]); }
}
function emitBooth(B, s) {   // a counter, the strongbox and a canopy: banking in the open air
  const { x, z, y } = s;
  B.add(BOX, x, y + 0.5, z + 0.8, 2.6, 1.0, 0.7, 0, C_STONE2); B.add(BOX, x, y + 1.04, z + 0.8, 2.7, 0.08, 0.8, 0, C_GOLD);
  B.add(BOX, x, y + 0.5, z - 0.6, 1.2, 1.0, 0.9, 0, C_DARK); B.add(BOX, x, y + 1.02, z - 0.6, 1.26, 0.1, 0.96, 0, C_GOLD);
  for (const sg of [-1, 1]) B.add(BOX, x + sg * 1.25, y + 1.5, z, 0.16, 3.0, 0.16, 0, C_BEAM);
  B.add(GABLE, x, y + 3.1, z, 3.4, 0.8, 2.4, 0, C_BANNER);
}
function emitPen(B, p, rec) {   // post-and-rail round the flock, a gate gap toward town, a trough
  const { x, z, w, d, fd } = p;
  for (let a = -w; a <= w; a++) for (let b = -d; b <= d; b++) {
    if (a !== -w && a !== w && b !== -d && b !== d) continue;
    if ((DDX[fd] ? a === DDX[fd] * w : b === DDZ[fd] * d) && Math.abs(DDX[fd] ? b : a) <= 1) continue;
    const px = x + a, pz = z + b, py = heightAt(px, pz);
    if (py < 1.4) continue;
    const ex = a === -w || a === w;
    if (((a + b) & 1) === 0) B.add(BOX, px, py + 0.5, pz, 0.18, 1.0, 0.18, 0, C_BEAM);
    B.add(BOX, px, py + 0.78, pz, ex ? 0.1 : 1.05, 0.1, ex ? 1.05 : 0.1, 0, C_BEAM);
    B.add(BOX, px, py + 0.42, pz, ex ? 0.1 : 1.05, 0.1, ex ? 1.05 : 0.1, 0, C_BEAM);
    if (rec) rec.blk.push(tk(px, pz));
  }
  if (p.bare) return;
  const ty = heightAt(x, z);
  B.add(BOX, x, ty + 0.3, z, 1.6, 0.4, 0.7, 0, C_BEAM); B.add(BOX, x, ty + 0.46, z, 1.4, 0.1, 0.5, 0, [0.35, 0.5, 0.55]);
}
function emitDock(B, dkk, rec) {   // planks out over the water; the spots hang off the pier head
  const { x, z, dx, dz, len } = dkk;
  for (let q = 1; q <= len; q++) {
    const px = x + dx * q, pz = z + dz * q;
    B.add(BOX, px, 0.72, pz, dx ? 1.04 : 1.4, 0.16, dx ? 1.4 : 1.04, 0, C_FLOOR);
    if (q % 2 === 1) for (const sg of [-1, 1]) B.add(BOX, px + (dz ? sg * 0.55 : 0), -0.4, pz + (dx ? sg * 0.55 : 0), 0.2, 2.4, 0.2, 0, C_BEAM);
  }
  const ex = x + dx * len, ez = z + dz * len;
  B.add(BOX, ex + dx, 1.0, ez + dz, 0.26, 1.2, 0.26, 0, C_BEAM);
  B.add(BOX, x + dx * (len - 1) + (dz ? 0.55 : 0), 1.08, z + dz * (len - 1) + (dx ? 0.55 : 0), 0.7, 0.55, 0.7, 0, C_SIGN);
  let put = 0;
  for (const [ax2, az2] of [[dx * (len + 2), dz * (len + 2)], [dx * (len + 1) + dz * 2, dz * (len + 1) + dx * 2], [dx * (len + 1) - dz * 2, dz * (len + 1) - dx * 2]]) {
    if (put >= 2) break;
    const sx = (x + ax2) & ~1, sz = (z + az2) & ~1, wy = heightAt(sx, sz);
    if (wy >= SEA) continue;
    rec.objs.push({ t: 2, k: wy < -4.5 ? 1 : 0, x: sx, z: sz, y: 0, key: tk(sx, sz), n: 'Fishing spot' }); put++;
  }
}
function emitGuild(B, g, rec) {   // a walled yard, gate arch and banner; the dark door judges your level
  const { x, z, y, R, fd } = g, horiz = !(fd & 1);
  for (let a = -R; a <= R; a++) for (let b = -R; b <= R; b++) {
    if (a !== -R && a !== R && b !== -R && b !== R) continue;
    if ((DDX[fd] ? a === DDX[fd] * R : b === DDZ[fd] * R) && Math.abs(DDX[fd] ? b : a) <= 1) continue;
    const px = x + a, pz = z + b, py = heightAt(px, pz);
    B.add(BOX, px, py + 1.0, pz, 1.02, 2.0, 1.02, 0, C_STONE);
    if (((a + b) & 1) === 0) B.add(BOX, px, py + 2.2, pz, 0.6, 0.4, 0.6, 0, C_STONE2);
    rec.blk.push(tk(px, pz));
  }
  const gx2 = x + DDX[fd] * R, gz2 = z + DDZ[fd] * R;
  for (const sg of [-2, 2]) B.add(BOX, gx2 + (horiz ? sg : 0), y + 1.5, gz2 + (horiz ? 0 : sg), 0.95, 3.0, 0.95, 0, C_STONE2);
  B.add(BOX, gx2, y + 3.2, gz2, horiz ? 4.9 : 0.95, 0.5, horiz ? 0.95 : 4.9, 0, C_STONE2);
  B.add(BOX, gx2, y + 3.95, gz2, 0.2, 1.0, 0.2, 0, C_BEAM); B.add(BOX, gx2 + 0.55, y + 4.15, gz2, 1.0, 0.6, 0.14, 0, C_BANNER);
  B.add(BOX, gx2, y + 1.15, gz2, horiz ? 2.0 : 0.34, 2.3, horiz ? 0.34 : 2.0, 0, C_DARK);
  for (const sg of [-1, 0, 1]) rec.blk.push(tk(gx2 + (horiz ? sg : 0), gz2 + (horiz ? 0 : sg)));
  rec.objs.push({ t: 28, k: 0, x: gx2, z: gz2, y, key: tk(gx2, gz2), n: g.name, gd: g });
  if (g.g.ranges) for (let q = 0; q < g.g.ranges; q++) {
    const fx = x - 2 + q * 4, fz = z - 2, fy = heightAt(fx, fz);
    emitForge(B, { t: 6, x: fx, y: fy, z: fz, in: null });
    rec.objs.push(keeperObj(6, 0, fx, fz, fy, 'Cooking range')); rec.blk.push(tk(fx, fz));
  }
}
/* the waypoint furniture: a few boxes each — the density between towns matters more than the fidelity */
function emitPOI(B, s, rec, h) {
  const { x, z, y, k } = s;
  const blk9 = () => { for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) rec.blk.push(tk(x + a, z + b)); };
  if (k === 0 || k === 8) {   // standing stones; the dark circle burns a brazier
    const n = 5 + (h & 3);
    for (let i = 0; i < n; i++) {
      const a = i / n * TAU + (h & 7), px = Math.round(x + Math.sin(a) * 3.4), pz = Math.round(z + Math.cos(a) * 3.4);
      const ht = 1.8 + ((h >>> (i * 3)) & 7) / 7 * 1.4, py = heightAt(px, pz);
      B.add(BOX, px, py + ht / 2 - 0.1, pz, 0.8, ht, 0.7, -a, k === 8 ? [0.2, 0.18, 0.24] : C_STONE2);
      rec.blk.push(tk(px, pz));
    }
    if (k === 8) { B.add(CYL8, x, y + 0.4, z, 0.8, 0.8, 0.8, 0, C_DARK); B.add(BLOB, x, y + 1.0, z, 0.55, 0.7, 0.55, 0, [0.62, 0.2, 0.72]); }
  } else if (k === 1) {   // an abandoned dig: timber portal and spoil heaps
    B.add(BOX, x - 1.1, y + 1.0, z, 0.3, 2.0, 0.3, 0, BARK2); B.add(BOX, x + 1.1, y + 1.0, z, 0.3, 2.0, 0.3, 0, BARK2);
    B.add(BOX, x, y + 2.0, z, 2.8, 0.3, 0.4, 0, BARK2); B.add(BLOB, x - 2.4, y + 0.3, z + 1.6, 1.8, 0.9, 1.8, 0, [0.4, 0.33, 0.24]);
  } else if (k === 2) {   // the hermit's rest: hut, stump seat, cold fire ring
    B.add(BOX, x, y + 0.9, z, 3.2, 1.8, 3.2, 0, BARK2); B.add(PYR, x, y + 2.4, z, 3.4 / 0.7071, 1.6, 3.4 / 0.7071, 0, C_THATCH);
    B.add(BOX, x, y + 0.8, z + 1.66, 1.0, 1.6, 0.2, 0, C_DARK);
    B.add(TRUNK, x + 2.6, y + 0.25, z + 2.2, 0.5, 0.5, 0.5, 0, BARK);
    for (let i = 0; i < 5; i++) { const a = i / 5 * TAU; B.add(BLOB, x + 2.6 + Math.sin(a), y + 0.12, z - 1.8 + Math.cos(a), 0.4, 0.3, 0.4, 0, STONE); }
    blk9();
  } else if (k === 3) {   // a shipwreck bleaching on the strand
    for (let i = -2; i <= 2; i++) B.add(BOX, x + i * 0.9, y + 0.7 + Math.abs(i) * 0.28, z, 0.24, 1.6 - Math.abs(i) * 0.34, 0.22, 0.5, BARK2);
    B.add(BOX, x, y + 0.25, z, 4.6, 0.5, 1.3, 0.5, BARK2); B.add(BOX, x + 1.6, y + 1.5, z + 0.4, 0.22, 2.6, 0.22, 0.7, BARK);
    B.add(BOX, x - 2.2, y + 0.4, z + 1.6, 0.8, 0.8, 0.8, 0, C_SIGN);
  } else if (k === 4) {   // a cart that never made town: tilted bed, one wheel gone, spilt sacks
    B.add(BOX, x, y + 0.7, z, 2.6, 0.24, 1.5, 0.3, BARK); B.add(BOX, x - 1.6, y + 0.5, z, 1.4, 0.16, 0.16, 0.3, BARK2);
    B.add(BOX, x + 0.9, y + 0.55, z + 0.8, 1.1, 1.1, 0.16, 0.3, BARK2); B.add(BOX, x + 0.9, y + 0.35, z - 0.9, 1.1, 0.7, 0.16, 0.9, BARK2);
    B.add(BLOB, x - 1.2, y + 0.25, z + 1.1, 0.7, 0.5, 0.7, 0, [0.62, 0.49, 0.20]); B.add(BLOB, x - 0.4, y + 0.2, z + 1.4, 0.6, 0.4, 0.6, 0, [0.62, 0.49, 0.20]);
  } else if (k === 5 || k === 9) {   // old bones; the barrow adds its headstones
    for (let i = 0; i < 4; i++) { const a = (h >>> i) % 6; B.add(BLOB, x + Math.sin(i * 2.2) * 1.4, y + 0.15, z + Math.cos(i * 2.2) * 1.4, 0.9 - i * 0.12, 0.3, 0.5, a, [0.85, 0.83, 0.74]); }
    if (k === 9) for (let i = 0; i < 5; i++) {
      const px = Math.round(x - 3 + (i % 3) * 3), pz = Math.round(z - 2 + Math.floor(i / 3) * 4), py = heightAt(px, pz);
      B.add(BOX, px, py + 0.55, pz, 0.9, 1.1, 0.24, 0, C_STONE2); B.add(BOX, px, py + 1.12, pz, 0.6, 0.3, 0.24, 0, C_STONE2);
      rec.blk.push(tk(px, pz));
    }
  } else if (k === 6) {   // a lone farm: fenced plot, scarecrow, a row of cabbages
    for (let a = -3; a <= 3; a++) for (let b = -2; b <= 2; b++) {
      if (a !== -3 && a !== 3 && b !== -2 && b !== 2) continue;
      if (b === 2 && Math.abs(a) <= 1) continue;
      const px = x + a, pz = z + b, py = heightAt(px, pz);
      if (((a + b) & 1) === 0) B.add(BOX, px, py + 0.45, pz, 0.16, 0.9, 0.16, 0, C_BEAM);
      B.add(BOX, px, py + 0.68, pz, a === -3 || a === 3 ? 0.1 : 1.05, 0.1, a === -3 || a === 3 ? 1.05 : 0.1, 0, C_BEAM);
      rec.blk.push(tk(px, pz));
    }
    B.add(BOX, x, y + 1.0, z, 0.16, 2.0, 0.16, 0, BARK); B.add(BOX, x, y + 1.55, z, 1.5, 0.14, 0.14, 0, BARK);
    B.add(BLOB, x, y + 2.0, z, 0.5, 0.5, 0.5, 0, [0.76, 0.66, 0.44]);
    for (let i = -1; i <= 1; i++) B.add(BLOB, x + i * 1.2, y + 0.2, z - 1, 0.55, 0.4, 0.55, 0, [0.28, 0.46, 0.18]);
  } else if (k === 7) {   // a fisher's shack with its drying rack; the shoal waits close in
    B.add(BOX, x, y + 0.85, z, 2.8, 1.7, 2.4, 0, BARK2); B.add(GABLE, x, y + 1.7, z, 3.4, 1.1, 3.0, 0, C_THATCH);
    B.add(BOX, x, y + 0.75, z + 1.26, 0.9, 1.5, 0.2, 0, C_DARK);
    B.add(BOX, x + 2.2, y + 0.9, z, 0.14, 1.8, 0.14, 0, BARK); B.add(BOX, x + 3.4, y + 0.9, z, 0.14, 1.8, 0.14, 0, BARK);
    B.add(BOX, x + 2.8, y + 1.7, z, 1.5, 0.1, 0.1, 0, BARK);
    blk9();
    let put = 0;
    for (let d2 = 0; d2 < 16 && put < 2; d2++) {
      const rr = d2 < 8 ? 7 : 12, a2 = (d2 & 7) / 8 * TAU;
      const sx = (x + Math.round(Math.cos(a2) * rr)) & ~1, sz = (z + Math.round(Math.sin(a2) * rr)) & ~1, wy = heightAt(sx, sz);
      if (wy >= SEA) continue;
      rec.objs.push({ t: 2, k: wy < -4.5 ? 1 : 0, x: sx, z: sz, y: 0, key: tk(sx, sz), n: 'Fishing spot' }); put++;
    }
  } else if (k === 10) {   // a watchtower over the road
    for (const [sx2, sz2] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) B.add(BOX, x + sx2 * 1.1, y + 2.2, z + sz2 * 1.1, 0.3, 4.4, 0.3, 0, C_BEAM);
    B.add(BOX, x, y + 4.5, z, 3.1, 0.35, 3.1, 0, C_FLOOR); B.add(PYR, x, y + 5.7, z, 3.6, 1.9, 3.6, 0, C_ROOF2);
    B.add(BOX, x, y + 5.1, z + 1.5, 3.1, 0.8, 0.16, 0, C_BEAM); B.add(BOX, x + 1.5, y + 5.1, z, 0.16, 0.8, 3.1, 0, C_BEAM);
    blk9();
  } else if (k === 12) {   // a roofless ruin kneeling in the ash: OSRS wilderness furniture
    for (const [dx2, dz2, w2, hh2, dd] of [[0, -2.2, 4.6, 2.2, 0.4], [-2.2, 0.5, 0.4, 1.5, 3.4], [2.2, 0, 0.4, 2.6, 4.2], [0.6, 2.2, 2.4, 1.1, 0.4]])
      B.add(BOX, x + dx2, y + hh2 / 2, z + dz2, w2, hh2, dd, 0, C_STONE2);
    B.add(BLOB, x - 1.4, y + 0.3, z + 1.6, 1.6, 0.7, 1.4, 1, STONE); B.add(BLOB, x + 1.2, y + 0.25, z - 1.2, 1.2, 0.5, 1.1, 2, STONE);
    for (const [a2, b2] of [[0, -2], [-2, 0], [2, 0]]) rec.blk.push(tk(x + a2, z + b2));
  } else if (k === 13) {   // a chaos temple: the dark altar still answers, whoever kneels
    B.add(BOX, x, y - 1.9, z, 7.0, 4.4, 7.0, 0, C_FOUND);
    B.add(BOX, x, y + 0.55, z, 2.0, 1.1, 0.9, 0, C_DARK); B.add(BOX, x, y + 1.14, z, 2.2, 0.14, 1.05, 0, [0.45, 0.10, 0.12]);
    for (let i2 = 0; i2 < 6; i2++) {
      const a2 = i2 / 6 * TAU, px = Math.round(x + Math.sin(a2) * 3.1), pz = Math.round(z + Math.cos(a2) * 3.1), bh = i2 % 2 ? 1.1 : 2.6;
      B.add(BOX, px, y + bh / 2, pz, 0.8, bh, 0.8, -a2, C_STONE2); rec.blk.push(tk(px, pz));
    }
    rec.objs.push(keeperObj(8, 0, x, z, y, 'Chaos altar')); rec.blk.push(tk(x, z));
  } else if (k === 14) {   // a fallen keep: one tower stands of the four
    B.add(CYL8, x - 2, y + 2.6, z - 2, 3.4, 5.2, 3.4, 0, C_STONE); B.add(DRUM8, x - 2, y + 5.4, z - 2, 3.9, 0.5, 3.9, 0, C_STONE2);
    B.add(BOX, x + 1.5, y + 1.0, z - 2, 4.0, 2.0, 1.0, 0, C_STONE); B.add(BOX, x - 2, y + 0.7, z + 1.5, 1.0, 1.4, 3.6, 0, C_STONE);
    B.add(BLOB, x + 2, y + 0.4, z + 1.8, 2.2, 0.9, 1.8, 1, STONE);
    B.add(BOX, x - 2, y + 6.6, z - 2, 0.18, 2.0, 0.18, 0, C_BEAM); B.add(BOX, x - 1.55, y + 7.2, z - 2, 0.8, 0.55, 0.1, 0, C_BANNER);
    for (const [a2, b2] of [[-2, -2], [-1, -2], [-3, -2], [-2, -1], [-2, -3], [-2, 1], [-2, 2]]) rec.blk.push(tk(x + a2, z + b2));
  } else {   // a camp: two tents, a smoking ring, a log to sit on
    B.add(GABLE, x - 2, y + 0.8, z, 2.6, 1.5, 2.2, 0, C_CLOTH); B.add(GABLE, x + 2.1, y + 0.7, z + 0.8, 2.3, 1.3, 2.0, 0.6, C_BANNER);
    for (let i = 0; i < 6; i++) { const a = i / 6 * TAU; B.add(BLOB, x + Math.sin(a) * 0.9, y + 0.12, z - 1.6 + Math.cos(a) * 0.9, 0.38, 0.3, 0.38, 0, STONE); }
    B.add(BOX, x, y + 0.35, z - 1.6, 0.5, 0.5, 0.5, 0, C_DARK);
    B.add(TRUNK, x, y + 0.25, z - 3.2, 0.45, 0.5, 1.8, 0, BARK);
    for (const [a2, b2] of [[-2, 0], [2, 1], [0, -2]]) rec.blk.push(tk(x + a2, z + b2));
  }
}
function emitSite(B, s, rec) {   // dispatch, plus every named place gets its signpost
  const { x, z, y } = s, h = hash2(x, z, S + 402);
  const post = (px, pz) => {
    const py = heightAt(px, pz);
    B.add(BOX, px, py + 0.75, pz, 0.18, 1.5, 0.18, 0, C_BEAM); B.add(BOX, px, py + 1.28, pz, 1.15, 0.42, 0.12, (h & 7) / 8, C_SIGN);
    rec.blk.push(tk(px, pz));
  };
  if (s.t === 1) {
    for (let i = 0; i < 7; i++) {   // the pit rim, and a timber headframe
      const a = i / 7 * TAU + (h & 7), rx = Math.round(x + Math.sin(a) * (s.r + 1)), rz = Math.round(z + Math.cos(a) * (s.r + 1));
      B.add(BLOB, rx, heightAt(rx, rz) + 0.2, rz, 1.15, 0.7, 1.15, a, STONE);
    }
    const hx = x + s.r, hz = z - 1;
    B.add(BOX, hx, y + 1.1, hz, 0.22, 2.2, 0.22, 0, C_BEAM); B.add(BOX, hx - 1.4, y + 1.1, hz, 0.22, 2.2, 0.22, 0, C_BEAM);
    B.add(BOX, hx - 0.7, y + 2.2, hz, 1.9, 0.24, 0.3, 0, C_BEAM);
    post(x - s.r - 1, z + 1);
  } else if (s.t === 2) {
    B.add(TRUNK, x, y + 0.28, z, 0.55, 0.6, 0.55, 0, BARK);
    post(x + 2, z + Math.round(s.r));
  } else emitPOI(B, s, rec, h);
}
structHooks.push((rec, vs, inChunk) => {
  batchInto(rec, B => {
    for (const v of vs) {
      if (v.shrine && inChunk(v.shrine.x, v.shrine.z)) { emitShrine(B, v.shrine); rec.objs.push(keeperObj(8, 0, v.shrine.x, v.shrine.z, v.shrine.y, 'Altar')); rec.blk.push(tk(v.shrine.x, v.shrine.z)); }
      if (v.booth && inChunk(v.booth.x, v.booth.z)) { emitBooth(B, v.booth); rec.objs.push(keeperObj(7, 0, v.booth.x, v.booth.z, v.booth.y + 0.13, 'Banker')); rec.blk.push(tk(v.booth.x, v.booth.z)); }
      if (v.pen && inChunk(v.pen.x, v.pen.z)) emitPen(B, v.pen, rec);
      if (v.dock && inChunk(v.dock.x, v.dock.z)) emitDock(B, v.dock, rec);
      if (v.guild && inChunk(v.guild.x, v.guild.z)) emitGuild(B, v.guild, rec);
      if (v.circle && inChunk(v.circle.x, v.circle.z)) emitPOI(B, v.circle, rec, hash2(v.circle.x, v.circle.z, S + 8));
    }
    const gx0 = Math.floor(rec.cx * CHUNK / SITE_CELL), gz0 = Math.floor(rec.cz * CHUNK / SITE_CELL);
    for (let a = 0; a <= 1; a++) for (let b = 0; b <= 1; b++) {   // a 32-chunk touches at most 2x2 of the 56-cells
      const s = siteAt(gx0 + a, gz0 + b);
      if (s && inChunk(s.x, s.z)) emitSite(B, s, rec);
    }
  });
});
MK_ART[28] = MK_ART[28] || ['lock', '#d8b04a', '#6b4e22', 'Guild']; MARK_H[28] = 4.6; PICK_R[28] = 1.9; PICK_Y[28] = 1.5;
OBJ_OPTS[28] = o => [{ t: 'Go through', o: o.n, f: act(o, o2 => {
  const g = o2.gd, ins = chebDist(P.tx, P.tz, g.x, g.z) <= g.R;   // stepping out is always allowed
  if (!ins && lvl[SK[g.g.sk]] < 60) return say('Only masters pass this door: you need level 60 ' + g.g.sk + '.', 'bad');
  teleport(g.x + DDX[g.fd] * (g.R + (ins ? 2 : -2)), g.z + DDZ[g.fd] * (g.R + (ins ? 2 : -2)), 60);
  sfx(62);
  say(ins ? 'You leave the guild.' : 'The doorkeeper waves you through.');
}) }];
/* the region and site rosters must name real kinds, or spawns silently vanish */
for (const A of REG) for (const k2 in A.mn) if (!NPC_BY[k2]) throw new Error('region favours unknown npc ' + k2);
for (const w of POI_T) if (w.sp) for (const k2 of w.sp) if (!NPC_BY[k2]) throw new Error('site spawns unknown npc ' + k2);
for (const row of PEN_K) for (const k2 of row) if (!NPC_BY[k2]) throw new Error('pen holds unknown npc ' + k2);

/* RUNECRAFT: a ruin per 192-tile lattice cell (half of them; deeper runes on dangerous ground) holds one rune altar; wizard's towers keep three
   essence rocks; the matching talisman or tiara opens the stones and every essence carried is bound at once. RUIN_CELL/ruinCache live in 2c. */
function ruinAt(gx, gz) {   // pure in (cell, S): every client raises the same ruin; the memo follows the seed
  if (ruinCache.S !== S) { ruinCache.clear(); ruinCache.S = S; }
  const key = gx * 8191 + gz;
  let R = ruinCache.get(key);
  if (R !== undefined) return R;
  R = null;
  const h = hash2(gx * 9 + 1, gz * 7 + 3, S + 300);
  if (gz * RUIN_CELL > 499000) { ruinCache.set(key, R); return R; }
  if (h % 100 < 50) for (let i = 0; i < 10 && !R; i++) {
    const hh = hash2(gx * 31 + i, gz * 17, S + 301 + i);
    const x = gx * RUIN_CELL + 20 + hh % (RUIN_CELL - 40), z = gz * RUIN_CELL + 20 + (hh >>> 9) % (RUIN_CELL - 40), y = heightAt(x, z);
    if (y < 2.2 || y > 58 || nearTown(x, z)) continue;
    const sp = spanHeights(x, z, 4, 2, (px, pz, py) => py >= 1.9);
    if (!sp || sp.hi - sp.lo > 2.5) continue;
    const p = powerAt(x, z), top = p < 0.3 ? 3 : p < 0.7 ? 5 : p < 1.2 ? 7 : p < 1.8 ? 9 : p < 2.6 ? 11 : p < 3.4 ? 12 : 13;   // the soul and wrath altars keep to the deepest ground
    R = { r: RC[(h >>> 8) % (top + 1)], x, z, y };
  }
  ruinCache.set(key, R);
  return R;
}
structHooks.push((rec, vs, inChunk) => {
  const R = ruinAt(Math.floor(rec.cx * CHUNK / RUIN_CELL), Math.floor(rec.cz * CHUNK / RUIN_CELL));   // a cell is six chunks: one per chunk
  batchInto(rec, B => {
    if (R && inChunk(R.x, R.z)) {   // sunken foundation, the altar with a slab in the rune's colour, a ring of six stones
      const { x, z, y, r } = R, h = hash2(x, z, S + 302), f1 = h % 6, f2 = (h >>> 3) % 6;
      rec.objs.push({ t: 11, k: r.i, x, z, y, key: tk(x, z), n: cap(r.k) + ' altar' }); rec.blk.push(tk(x, z));
      B.add(BOX, x, y - 1.9, z, 8.6, 4.4, 8.6, 0, C_FOUND);
      B.add(BOX, x, y + 0.5, z, 1.6, 1.0, 1.2, 0, C_STONE); B.add(BOX, x, y + 1.05, z, 1.8, 0.12, 1.4, 0, hexRgb(r.c));
      for (let i = 0; i < 6; i++) {
        const a = i * PI / 3, sx = Math.round(x + Math.sin(a) * 3.2), sz = Math.round(z + Math.cos(a) * 3.2), ht = 2.6 + ((h >>> (8 + i * 3)) & 7) / 7 * 0.8;
        rec.blk.push(tk(sx, sz));
        if (i === f1 || (i === f2 && h & 64)) B.add(BOX, sx, y + 0.3, sz, ht, 0.7, 0.8, -a, C_STONE2);   // toppled along the ring
        else B.add(BOX, sx, y + ht / 2 - 0.2, sz, 0.8, ht, 0.8, -a, C_STONE2);
      }
    }
    for (const v of vs) if (v.lm && v.lm.t === 2 && inChunk(v.lm.x, v.lm.z)) for (const [dx, dz] of [[5, 2], [-5, 2], [2, -5]]) {   // essence at the tower's foot
      const p = openNear(v.lm.x + dx, v.lm.z + dz, 2); if (!p) continue;
      const y = heightAt(p.x, p.z), key = tk(p.x, p.z);
      rec.objs.push({ t: 1, k: 9, x: p.x, z: p.z, y, key, n: 'Rune essence' }); rec.blk.push(key);
      B.add(ROCK_GEO, p.x, y - 0.15, p.z, 1.1, 0.94, 1.1, dx, hexRgb('#d8d8e8'));
    }
  });
});
/* the altar: the matching talisman (carried) or tiara (worn) lets you bind every essence in the pack; pure always, rune essence up to body */
function rcAltar(o) {
  const r = RC[o.k], k = r.k;
  if (ITEMS[k + '_talisman'] && !invCount(k + '_talisman') && !(eq.head && ITEMS[eq.head].tiara === k)) return say('The stones are silent to you. You need the ' + k + ' talisman or tiara.', 'bad');   // an altar with no talisman (wrath) asks only the level
  if (needLv('runecraft', r.lv)) return;
  const ess = invCount('pure_essence') + (r.i <= 5 ? invCount('rune_essence') : 0);
  if (!ess) return say('You have no essence to bind.');
  invRemove('pure_essence', ess); if (r.i <= 5) invRemove('rune_essence', ess);
  const runes = ess * runesPer(r);
  invAdd(r.id, runes); gainXp('runecraft', ess * r.xp);
  diaryBump('rc', 0, P.tx, P.tz, runes);
  say("You bind the temple's power into " + runes + ' ' + ITEMS[r.id].name.toLowerCase() + (runes > 1 ? 's.' : '.'));
  P.pose = 2; P.acting = 1; P.actSpan = 3;
  spellBurst(o.x, o.y + 1.2, o.z, hexInt(r.c));
}
function makeTiara(o) {   // a plain tiara and the talisman become the altar's tiara
  const r = RC[o.k], need = [['tiara', 1], [r.k + '_talisman', 1]];
  if (!hasAll(need)) return say('You need a tiara and the ' + r.k + ' talisman.', 'bad');
  for (const [id] of need) invRemove(id, 1);
  invAdd(r.k + '_tiara', 1); gainXp('runecraft', r.xp * 5);
  say('You bind the talisman into the tiara.');
}
USE_ON[11] = (o, uit) => uit.id === 'tiara' && invCount(RC[o.k].k + '_talisman') ? ['Altar', o2 => makeTiara(o2)] : null;
/* talismans fall only where the wiki puts them: the air/mind/body/water/earth/fire rows authored into men, imps, guards,
   farmers, wizards, skeletons and their kin, and the chaos/nature slots on the shared gem table. No blanket roll. */

/* ---- AGILITY: log balances over narrow water and climbing rocks up short cliffs, pure functions of the tile; a crossing lands you on the far end ---- */
structHooks.push((rec, vs, inChunk) => {
  const ox = rec.cx * CHUNK, oz = rec.cz * CHUNK, bk = new Set(rec.blk), objs = [], bridges = [];
  for (const o of rec.objs) bk.add(o.key);   // trees claim their tiles in populateChunk, so rec.blk alone no longer sees them
  const hAt = (x, z) => inChunk(x, z) ? recH(rec, x, z) : heightAt(x, z);
  const open = (x, z) => !bk.has(tk(x, z)) && dryOpen(x, z);   // this chunk's own claims are not in blocked yet
  for (let j = 1; j < CHUNK && objs.length < 3; j += 2) for (let i = 1; i < CHUNK && objs.length < 3; i += 2) {   // odd tiles never share a fishing spot's key
    const x = ox + i, z = oz + j, y = recH(rec, x, z), h = hash2(x, z, S + 320);
    if (y < SEA) {   // a log: open banks 3-4 tiles out on both sides, water between; such narrows are rare, so only space them
      if (objs.some(q => !q.k && chebDist(q.x, q.z, x, z) < 10) || bridges.some(q => chebDist(q.x, q.z, x, z) < 10)) continue;
      const bank = (dx, dz) => {   // first dry tile out; it must be 3-4 away, open, and walkable from the tile behind it
        for (let d = 1; d <= 4; d++) {
          const bx = x + dx * d, bz = z + dz * d, yb = hAt(bx, bz); if (yb < SEA) continue;
          const yn = hAt(bx + dx, bz + dz); return d >= 3 && yn >= SEA && Math.abs(yn - yb) <= CLIMB && open(bx, bz) ? d : 0;
        }
        return 0;
      };
      for (const [dx, dz] of [[1, 0], [0, 1]]) {
        const a = bank(-dx, -dz), b = a && bank(dx, dz);
        if (b) {
          const hA = hAt(x - dx * a, z - dz * a), hB = hAt(x + dx * b, z + dz * b), dy = clamp((hA + hB) / 2, 1.1, 2.6);
          if (hash2(x, z, S + 321) % 100 < 60 && Math.abs(hA - dy) <= 1.1 && Math.abs(hB - dy) <= 1.1) {   // most narrows are bridged for everyone; the rest keep their log
            bridges.push({ x: x - dx * a, z: z - dz * a, dx, dz, len: a + b - 1, y: dy });
            break;
          }
          const alv = clamp(1 + Math.round(Math.max(0, powerAt(x, z)) * 12), 1, 75);   // the deeper the ground, the surer the feet it asks — 2007 logs are levelled
          objs.push({ t: 16, k: 0, x, z, y: 0, key: tk(x, z), n: AGIL_N[0], lv: alv, xp: alv * 1.2 + 6, ax: x - dx * a, az: z - dz * a, bx: x + dx * b, bz: z + dz * b, noMark: 1 });
          break;
        }
      }
    } else if (!(h & 31) && open(x, z)) {   // rocks: a ledge 2.5-6 units up, two tiles over; the object sits on the step between
      for (const [dx, dz] of [[2, 0], [-2, 0], [0, 2], [0, -2]]) {
        const mx = x + dx / 2, mz = z + dz / 2, rise = hAt(x + dx, z + dz) - y;
        if (onDitchBank(x, z) || onDitchBank(x + dx, z + dz)) continue;   // the wilderness ditch is jumped at its own price, never scrambled for free
        if (rise < 2.5 || rise > 6 || !open(x + dx, z + dz) || !open(mx, mz)) continue;
        const lv = clamp(5 + Math.round(rise * 6), 5, 70);
        objs.push({ t: 16, k: 1, x: mx, z: mz, y: y + rise / 2, key: tk(mx, mz), n: AGIL_N[1], lv, xp: lv * 1.4 + 6, ax: x, az: z, bx: x + dx, bz: z + dz, noMark: 1 });
        break;
      }
    }
  }
  if (bridges.length) batchInto(rec, B => { for (const b of bridges) emitBridge(B, b, rec); });
  if (!objs.length) return;
  rec.objs.push(...objs);
  batchInto(rec, B => { for (const o of objs) {
    if (!o.k) { const L = chebDist(o.ax, o.az, o.bx, o.bz) + 0.8, ax = o.ax !== o.bx; B.add(BOX, (o.ax + o.bx) / 2, 0.18, (o.az + o.bz) / 2, ax ? L : 0.55, 0.45, ax ? 0.55 : L, 0, BARK); }
    else for (let q = 1; q <= 3; q++) { const f = q / 4, px = o.ax + (o.bx - o.ax) * f, pz = o.az + (o.bz - o.az) * f; B.add(BLOB, px, groundY(px, pz) + 0.3, pz, 1.25, 0.9, 1.25, q * 0.7, STONE); }
  } });
});
/* the task walks to the nearer end (a stand-in target carrying the far end), so the path never ends in the water beside a log */
function agilOpts(o) {
  return [{ t: ['Cross', 'Climb', 'Squeeze through'][o.k], o: o.n, f: () => {
    flashTarget(o, 0);
    const up = chebDist(P.tx, P.tz, o.ax, o.az) <= chebDist(P.tx, P.tz, o.bx, o.bz);   // b is the top of the rocks
    startTask({ x: up ? o.ax : o.bx, z: up ? o.az : o.bz, fx: up ? o.bx : o.ax, fz: up ? o.bz : o.az, up, key: o.key, ob: o }, 'agil');
  } }];
}
TASKS.agil = (t, o) => {   // first call starts the attempt, the next (ACT_TICKS later) resolves it
  const ob = o.ob;
  if (needLv('agility', ob.lv)) return;
  if (P.afloat) return fail("You can't do that from a boat.");
  if (!t.on) { t.on = 1; return; }
  if (!ob.k || Math.random() < rollChance(lvl[SK.agility], ob.lv, 3)) {
    teleport(o.fx, o.fz, 60);
    gainXp('agility', ob.xp);
    say(ob.k === 2 ? 'You squeeze through the gap in the rock.' : ob.k ? 'You scramble ' + (o.up ? 'up' : 'down') + ' the rocks.' : 'You walk carefully across the log.');
  } else { hurtPlayer(randInt(1, 3)); say('You slip and scrape yourself.', 'bad'); }
  P.task = null;
};
tickHooks.push(() => { const t = P.task; if (P.acting && t && t.k === 'agil') { P.pose = 4; P.faceT = Math.atan2(t.o.fx - P.tx, t.o.fz - P.tz); } });   // vault pose, facing the far end

/* ---- THIEVING: pockets and market stalls. A pick is one roll every two ticks until a stun, a full pack or a target that walks off;
   a stall is one grab, then a shared respawn clock. (dev) coins land straight in the pack, no pouches. ---- */
defStack('bread', 'Bread', 'crop', '#c8a060', '#7a5a2a', 12, { heal: 5 });
defStack('silk', 'Silk', 'wool', '#e8d8f0', '#8a6aa0', 24); defStack('fur', 'Fur', 'fur', '#8a6a48', '#4a3622', 12); defStack('spice', 'Spice', 'seed', '#d8702a', '#7a3a10', 90);
const STALLS = [['baker', "Baker's stall", 5, 16, 'bread', 4], ['silk', 'Silk stall', 20, 24, 'silk', 13], ['fur', 'Fur stall', 35, 45, 'fur', 25], ['silver', 'Silver stall', 50, 205, 'silver_ore', 50],
  ['spice', 'Spice stall', 65, 92, 'spice', 133], ['gem', 'Gem stall', 75, 408, null, 300]].map(([k, n, lv, xp, loot, rs]) => ({ k, n, lv, xp, loot, rs }));
const lootOf = T => { const d = rollTable(T); return [d[0], randInt(d[2] || 1, d[3] || d[2] || 1)]; };   // a weighted [id, w, min, max] row → [id, n]
const pickChance = (L, req) => clamp(0.55 + 0.39 * (L - req) / (99 - req), 0.55, 0.95);   // 55% at the requirement, 94% at 99, whoever the mark
TASKS.pick = (t, o) => {
  const p = o.t.pick;
  if (needLv('thieving', p.lv)) return;
  P.actT = 2;
  if (Math.random() < pickChance(eff('thieving'), p.lv) * (capeOn('thieving') ? 1.1 : 1)) {   // the thieving cape steadies the hand a tenth
    const [id, n] = lootOf(p.loot);
    if (!invAdd(id, n)) return fail(FULL);
    if (id === 'coins') { gpMade += n; sfx(2115, 0.8); }
    gainXp('thieving', p.xp);
    say('You pick the ' + o.name.toLowerCase() + "'s pocket.");
  } else {
    P.task = null; P.stun = 9;
    hurtPlayer(1 + Math.floor(p.lv / 25));
    say(o.name + ": What do you think you're doing?"); say("You've been stunned!", 'bad');
  }
};
TASKS.steal = (t, o) => {
  const s = STALLS[o.k];
  if (needLv('thieving', s.lv)) return;
  if (!invAdd(s.loot || rollTable(GEM_T)[0], 1)) return fail(FULL);
  gainXp('thieving', s.xp); deplete(o, s.rs); P.task = null;
  say('You steal from the ' + o.n.toLowerCase() + '.');
  let heard = 0;   // the watch within six tiles takes it personally
  for (const q of npcs) if ((q.t.k === 'guard' || q.t.k === 'watchman') && !q.target && chebDist(q.tx, q.tz, P.tx, P.tz) <= 6) {
    q.target = P; claimMon(q);
    if (!heard++) say(q.name + ': Hey! Get your hands off there!');
  }
};
/* the square's stalls sell by rank: towns bake and weave, cities deal in gems; the furniture pass already blocks the tile */
structHooks.push((rec, vs, inChunk) => {
  for (const v of vs) for (const fu of v.fur) if (fu.t === 0 && inChunk(fu.x, fu.z)) {
    const k = fu.k % Math.min(STALLS.length, 2 + v.rank);
    rec.objs.push({ t: 14, k, x: fu.x, z: fu.z, y: fu.y, key: tk(fu.x, fu.z), n: STALLS[k].n, noMark: 1 });
  }
});

/* ---- SLAYER: one master a settlement hands out a family to hunt; every kill of it pays its hitpoints in xp ---- */
const MASTERS = [['Turael', 0, 15, 50, 0, 25], ['Mazchna', 20, 40, 70, 10, 45], ['Vannaka', 40, 40, 120, 20, 80], ['Chaeldar', 70, 70, 130, 40, 130], ['Duradel', 100, 130, 200, 60, 1e9, 50]]
  .map(([n, cb, lo, hi, a, b, sl]) => ({ n, cb, lo, hi, a, b, sl: sl || 0 }));   // one a settlement rank: combat needed, task size, the band of base levels it assigns
const slayPool = m => NPC_TYPES.filter(t => !t.boss && !t.town && !t.flee && t.lv >= m.a && t.lv <= m.b && (!t.slayLv || lvl[SK.slayer] >= t.slayLv));
const plural = (s, n) => n === 1 ? s : s.replace(/^(.*?)( of .*)?$/, (_, w, of) => (/[mM]an$/.test(w) ? w.slice(0, -2) + 'en' : /f$/.test(w) ? w.slice(0, -1) + 'ves' : w + (/s$/.test(w) ? 'es' : 's')) + (of || ''));
let slayO = null;   // the master whose window is open
function slayerTalk(o) {
  const m = MASTERS[o.k], s = P.slay, ico = g07(MK07, 12) ? mk07p(MK07[12]) : drawIcon(...MK_ART[12]);
  const why = s ? 'Finish or give up the task you have before asking for another.' : combatLevel() < m.cb ? m.n + ' only assigns fighters of combat level ' + m.cb + ' or more.' : lvl[SK.slayer] < m.sl ? m.n + ' only serves slayers of level ' + m.sl + ' or more.' : '';
  slayO = o;
  showModal(m.n + ', Slayer Master', stRow('Task', s ? 'Kill ' + s.n + ' more ' + plural(NPC_BY[s.k].n, s.n) + '.' : 'No task assigned.') +
    liRow('data-sl="new"', 0, why, ico, 'New assignment', '', '<u>' + m.lo + '–' + m.hi + ' of a kind' + (m.cb ? ', combat ' + m.cb + '+' : '') + '</u>') +
    (s ? liRow('data-sl="drop"', 0, 0, ico, 'Give up task', '', '<u>the kills so far keep their xp</u>') : ''),
    why || 'Every kill of the assigned family pays its hitpoints in Slayer xp.');
}
on(modalBody, 'click', e => {
  const b = e.target.closest('[data-sl]'); if (!b || !slayO) return;
  const m = MASTERS[slayO.k], drop = b.dataset.sl === 'drop';
  if (drop ? !P.slay : P.slay || combatLevel() < m.cb || lvl[SK.slayer] < m.sl) return;
  if (drop) { P.slay = null; say('You give up your Slayer task.'); }
  else { const pool = slayPool(m), t = pool[Math.random() * pool.length | 0], n = randInt(m.lo, m.hi); P.slay = { k: t.k, n, m: slayO.k }; say('Your new task is to kill ' + n + ' ' + plural(t.n, n) + '.'); }
  markDirty(2); slayerTalk(slayO);
});
onKill.push(n => {
  const s = P.slay;
  if (!s || (n.t.base || n.t).k !== s.k) return;
  gainXp('slayer', n.t.hp);   // any rung of the family's ladder counts, at its own hitpoints
  if (--s.n > 0) return markDirty();
  say("You've completed your Slayer task. Return to a Slayer Master for another.", 'lv');
  diaryBump('slay', s.m, P.tx, P.tz, 1);
  P.slay = null; markDirty(2);
});
const slayerSpot = v => v.spots.length ? v.spots[(hash2(v.x, v.z, S + 310) >>> 4) % v.spots.length] : null;   // a street tile; the map reads it too
structHooks.push((rec, vs, inChunk) => {   // one master a settlement, facing the square
  for (const v of vs) {
    const s = slayerSpot(v), y = s && heightAt(s.x, s.z);
    if (s && inChunk(s.x, s.z) && !isWater(y)) rec.objs.push({ t: 12, k: v.rank, x: s.x, z: s.z, y, key: tk(s.x, s.z), n: MASTERS[v.rank].n, dir: Math.atan2(v.x - s.x, v.z - s.z) });
  }
});

/* crafting: gems to the chisel, hides to the needle, gold to the mould; the tanner and the spindle are verbs, not fixtures */
W('hardleather_body', 0, 'robe', 0, 'body', 35, { defence: 10 }, { def: 8 });
for (const g of GEMS) recipe(g.k, 'crafting', g.lv, g.xp, [['uncut_' + g.k, 1]], { tool: 'chisel', tk: 2, msg: 'You cut the ' + g.k + '.' });
/* needlework: a thread a piece; pieces that come in pairs say so */
const sew = (id, lv, xp, hide, n) => recipe(id, 'crafting', lv, xp, [[hide, n || 1], ['thread', 1]],
  { tool: 'needle', msg: id.endsWith('s') ? 'You make a pair of ' + ITEMS[id].name.toLowerCase() + '.' : undefined });
for (const [p, lv, xp] of [['gloves', 1, 13.8], ['boots', 7, 16.25], ['vambraces', 11, 22], ['body', 14, 25], ['chaps', 18, 27], ['coif', 38, 37]]) sew('leather_' + p, lv, xp, 'leather');
sew('hardleather_body', 28, 35, 'hard_leather');
for (const [c, lvs, xp] of [['green', [57, 60, 63], 62], ['blue', [66, 68, 71], 70], ['red', [73, 75, 77], 78], ['black', [79, 82, 84], 86]])
  DPIECE.forEach((p, i) => sew(c + '_dhide_' + p, lvs[i], xp * (i + 1), c + '_dragon_leather', i + 1));
/* the tanner: a hide and a fee, no xp, one a tick; a hide used on the crafting shopkeeper opens the list */
const tan = (id, hide, gp) => recipe(id, 'crafting', 1, 0, [[hide, 1], ['coins', gp]],
  { at: 'tan', tk: 1, name: ITEMS[id].name + ' (' + gp + ' gp)', msg: 'The tanner hands you some ' + ITEMS[id].name.toLowerCase() + '.' });
tan('leather', 'cowhide', 1); tan('hard_leather', 'cowhide', 3);
for (const c of ['green', 'blue', 'red', 'black']) tan(c + '_dragon_leather', c + '_dragonhide', 20);
USE_ON[5] = (o, uit) => SHOP_KINDS[o.k].k === 'craft' && RECIPES.some(r => r.at === 'tan' && usesItem(r, uit.id)) ? [o.n, o2 => openMake('tan', o2, uit.id)] : null;
/* the furnace: a gold bar in a mould, a gem on top, amulets strung as they are cast; silver makes a tiara */
for (const j of JEWEL) {
  const wool = j.k === 'amulet' ? [['ball_of_wool', 1]] : [], x = { at: 3, tool: j.k + '_mould' };
  recipe('gold_' + j.k, 'crafting', j.lv, j.xp, [['gold_bar', 1]].concat(wool), x);
  for (const g of GEMS) if (j.lvs[g.i] !== undefined) recipe(g.k + '_' + j.k, 'crafting', j.lvs[g.i], j.xps[g.i], [['gold_bar', 1], [g.k, 1]].concat(wool), x);   // onyx included at the wiki's 67/82/90; Lvl-6 Enchant finishes the fury and the berserker
}
recipe('tiara', 'crafting', 23, 52.5, [['silver_bar', 1]], { at: 3, tool: 'tiara_mould' });
/* spinning needs no wheel: a one-input recipe has nothing to be used on, so flax and wool carry a Spin verb */
for (const [id, src, lv, xp] of [['bow_string', 'flax', 10, 15], ['ball_of_wool', 'wool', 1, 2.5]]) { const r = recipe(id, 'crafting', lv, xp, [[src, 1]]); ITEMS[src].opt = ['Spin', () => startMake(r)]; }

/* ---- FLETCHING: a knife on logs, a string on a bow, feathers and tips on shafts; every row is a hand recipe (use one item on the other) ---- */
defStack('arrow_shaft', 'Arrow shaft', 'arrow', '#c4a06a', '#7a5a30', 1); defStack('headless_arrow', 'Headless arrow', 'arrow', '#c4a06a', '#e8e8e8', 1);
for (const b of BOWS) for (const f of BOWFORM) { const s = ITEMS[b.k + f.k]; defItem({ id: s.id + '_u', name: s.name + ' (u)', g: 'bow', c: b.c, c2: b.c2, val: s.val >> 1 }); }
/* a tree: [shortbow lv, xp, longbow lv, xp]; stringing repeats the cut's level and xp; a wood cuts 15 shafts a rung up from plain logs */
[[5, 5, 10, 10], [20, 16.5, 25, 25], [35, 33.3, 40, 41.5], [50, 50, 55, 58.3], [65, 67.5, 70, 75], [80, 83.3, 85, 91.5]].forEach((w, i) => {
  const log = TREES[i].log;
  recipe('arrow_shaft', 'fletching', [1, 15, 30, 45, 60, 75][i], 5 + 5 * i, [[log, 1]], { tool: 'knife', n: 15 + 15 * i, msg: 'You carefully cut the wood into ' + (15 + 15 * i) + ' arrow shafts.' });
  BOWFORM.forEach((f, j) => {
    const id = BOWS[i].k + f.k, lv = w[j * 2], xp = w[j * 2 + 1];
    recipe(id + '_u', 'fletching', lv, xp, [[log, 1]], { tool: 'knife', msg: 'You carefully cut the wood into a ' + f.n + '.' });
    recipe(id, 'fletching', lv, xp, [[id + '_u', 1], ['bow_string', 1]], { tk: 2, msg: 'You add a string to the bow.' });
  });
});
recipe('headless_arrow', 'fletching', 1, 15, [['arrow_shaft', 15], ['feather', 15]], { n: 15, tk: 1, msg: 'You attach feathers to 15 arrow shafts.' });
/* a metal: [arrow lv, xp, bolt lv, xp, dart lv, xp]; 15 arrows, 10 bolts or 10 darts a go */
for (const [k, al, ax, bl, bx, dl, dx] of [['bronze', 1, 19.5, 9, 5, 10, 18], ['iron', 15, 37.5, 39, 15, 22, 38], ['steel', 30, 75, 46, 35, 37, 75], ['mithril', 45, 112.5, 54, 50, 52, 112],
  ['adamant', 60, 150, 61, 70, 67, 150], ['rune', 75, 187.5, 69, 100, 81, 188], ['dragon', 90, 225, 84, 120, 95, 250]]) {
  recipe(k + '_arrow', 'fletching', al, ax, [['headless_arrow', 15], [k + '_arrowtips', 15]], { n: 15, tk: 1, msg: 'You attach arrowtips to 15 headless arrows.' });
  recipe(k + '_bolts', 'fletching', bl, bx, [[k + '_bolts_u', 10], ['feather', 10]], { n: 10, tk: 1 });
  recipe(k + '_dart', 'fletching', dl, dx, [[k + '_dart_tips', 10], ['feather', 10]], { n: 10, tk: 1 });
}

/* ---- HERBLORE: a vial of water takes a clean herb, the unfinished potion takes its secondary; a dose is one pack slot and a sip steps it down ---- */
const CORK = '#6a4a2a';
defStack('vial_of_water', 'Vial of water', 'vial', '#8ac8e8', CORK, 3);
for (const [id, name, g, c, c2, val] of [['eye_of_newt', 'Eye of newt', 'crop', '#d8c85a', '#2a2a1a', 3], ['unicorn_horn', 'Unicorn horn', 'bones', '#f0ece0', '#9a9484', 20],
  ['limpwurt_root', 'Limpwurt root', 'crop', '#c04a3a', '#6a2a1a', 15], ['red_spiders_eggs', "Red spiders' eggs", 'crop', '#d83a3a', '#7a1a1a', 8], ['white_berries', 'White berries', 'crop', '#f0f0f0', '#5a7a3a', 10],
  ['snape_grass', 'Snape grass', 'herb', '#6ab08a', '#3a6a4a', 6], ['mort_myre_fungus', 'Mort myre fungus', 'crop', '#9a8a6a', '#5a4a3a', 12], ['wine_of_zamorak', 'Wine of zamorak', 'vial', '#8a1a3a', CORK, 60],
  ['potato_cactus', 'Potato cactus', 'crop', '#6aa05a', '#3a6a2a', 25], ['dragon_scale_dust', 'Dragon scale dust', 'hide', '#6a8ad8', '#2a3a80', 45]]) defStack(id, name, g, c, c2, val);
defStack('coconut', 'Coconut', 'crop', '#8a6438', '#4a3620', 120, { heal: 2 });   // a herblore fruit in 2007, never eaten; a light snack here by design
defStack('supercompost', 'Supercompost', 'crop', '#4a3a28', '#2a2018', 90);   // inert trade good: this game's patches take no compost or disease (see FARMING)
defStack('steel_cannonball', 'Steel cannonball', 'bar', '#4a4a52', '#2a2a30', 50);   // no cannon exists here: a smithable trade good
defItem({ id: 'onyx_bolt_tips', name: 'Onyx bolt tips', g: 'bolt', c: '#2a2028', c2: '#141018', stack: 1, val: 1400 });
defItem({ id: 'blighted_anglerfish', name: 'Blighted anglerfish', g: 'cfish', c: '#4a4a5a', c2: '#3a2a3a', stack: 1, val: 140, heal: 22, blight: 1, ang: 1 });
ITEMS.anglerfish.ang = 1;   // both anglers heal by the wiki's Hitpoints-level table and past full
recipe('steel_cannonball', 'smithing', 35, 25.6, [['steel_bar', 1]], { at: 4, tool: 'hammer', n: 4, msg: 'You pour the molten metal into the mould; four cannonballs clatter out.' });
recipe('onyx_bolt_tips', 'fletching', 73, 9.4, [['onyx', 1]], { tool: 'chisel', n: 24, msg: 'You carefully chip the onyx into 24 bolt tips.' });
/* onyx bolts: the tips finally attach to something — runite bolts, fletching 73, +120, as in 2007 */
W('onyx_bolts', 0, 'bolt', 0, 'ammo', 1800, { ranged: 61 }, { stack: 1, ammo: 1, aT: 'bolt', rst: 120, rat: 0 });
recipe('onyx_bolts', 'fletching', 73, 94, [['rune_bolts', 10], ['onyx_bolt_tips', 10]], { n: 10, tk: 1, msg: 'You attach onyx tips to 10 runite bolts.' });
/* cleaning: a verb on each grimy herb starts its one-input recipe, one leaf a tick */
for (const h of HERBS) { const r = recipe(h.k, 'herblore', h.lv, h.xp, [[h.grimy, 1]], { tk: 1, msg: 'You clean the dirt from the ' + h.n + ' leaf.' }); ITEMS[h.grimy].opt = ['Clean', () => startMake(r)]; }
/* effects: a boost counts from the base level and never stacks (re-drinking resets it to the full amount); gameTick walks it back a point a minute */
const potBoost = (k, b, f) => { const i = SK[k]; bst[i] = Math.max(bst[i], b + Math.floor(lvl[i] * f)); };
const potDrain = (k, b, f) => { const i = SK[k]; bst[i] = Math.max(-lvl[i], bst[i] - b - Math.floor(Math.max(0, lvl[i] + bst[i]) * f)); dirty.sk = 1; };   // wiki drains bite the current level, and stack
const potRestore = (f, b, all) => { for (let i = 0; i < NSK; i++) if (bst[i] < 0 && (all || i === SK.attack || i === SK.strength || i === SK.defence || i === SK.ranged || i === SK.magic)) bst[i] = Math.min(0, bst[i] + b + Math.floor(lvl[i] * f)); dirty.sk = 1; };   // b + f x base, never past base; plain restore touches the five combat stats only
const potPray = (b, f) => { P.pray = Math.min(P.maxpray, P.pray + b + Math.floor(P.maxpray * ((f || 0.25) + (capeOn('prayer') || eq.ring === 'ring_of_the_gods' ? 0.02 : 0)))); };   // the prayer cape and the imbued ring of the gods each work a holy wrench: two points more in the hundred
function drink(i) {
  const it = ITEMS[inv[i].id], p = it.pot, d = it.dose;
  if (P.potT > tickN) return;   // a sip is a consumption like a bite: its own three-tick clock, and it delays the next swing
  P.potT = tickN + 3; P.actT += 3; P.atkT = Math.max(P.atkT, tickN + 3);
  p.fx(); sfx(2390);
  inv[i] = d > 1 ? { id: p.k + '_' + (d - 1), n: 1 } : null;   // the vial keeps its slot
  say('You drink some of your ' + p.n.toLowerCase() + '.' + (d > 1 ? ' You have ' + (d - 1) + (d > 2 ? ' doses' : ' dose') + ' left.' : ' You have finished your potion.'));
  dirty.inv = dirty.sk = dirty.orb = 1; markDirty();
}
defStack('goat_horn', 'Goat horn', 'horn', '#d8ccb0', '#8a7a5a', 12);   // every goat carries a pair; ground dust in all but name
defStack('egg', 'Egg', 'egg', '#f0e8d0', '#b0a070', 4);
/* [key, name, herb, secondary, level, xp, colour, effect]; ranarr shares one unfinished potion between defence and prayer */
const POTS_R = [
  ['attack', 'Attack potion', 'guam', 'eye_of_newt', 3, 25, '#4aa0d8', () => potBoost('attack', 3, .1)],
  ['antipoison', 'Antipoison', 'marrentill', 'unicorn_horn', 5, 37.5, '#3a9a5a', () => { P.psn = 0; P.psnImm = tickN + 150; say('The poison leaves your body.'); }],   // horn stands in for its ground dust
  ['strength', 'Strength potion', 'tarromin', 'limpwurt_root', 12, 50, '#d03a6a', () => potBoost('strength', 3, .1)],
  ['restore', 'Restore potion', 'harralander', 'red_spiders_eggs', 22, 62.5, '#d86a5a', () => potRestore(.3, 10)],
  ['energy', 'Energy potion', 'harralander', 'eye_of_newt', 26, 67.5, '#c8b03a', () => { P.energy = Math.min(100, P.energy + 10); }],   // newt eye stands in for chocolate dust
  ['defence', 'Defence potion', 'ranarr', 'white_berries', 30, 75, '#2a8a6a', () => potBoost('defence', 3, .1)],
  ['prayer', 'Prayer potion', 'ranarr', 'snape_grass', 38, 87.5, '#3ad0d0', () => potPray(7)],
  ['super_attack', 'Super attack', 'irit', 'eye_of_newt', 45, 100, '#2a5ad8', () => potBoost('attack', 5, .15)],
  ['super_energy', 'Super energy', 'avantoe', 'mort_myre_fungus', 52, 117.5, '#c8d03a', () => { P.energy = Math.min(100, P.energy + 20); }],
  ['super_strength', 'Super strength', 'kwuarm', 'limpwurt_root', 55, 125, '#e878a8', () => potBoost('strength', 5, .15)],
  ['super_restore', 'Super restore', 'snapdragon', 'red_spiders_eggs', 63, 142.5, '#d83a3a', () => { potRestore(.25, 8, 1); potPray(8); }],
  ['sanfew', 'Sanfew serum', 'snapdragon', 'snape_grass', 65, 160, '#8ad0a0', () => { potRestore(.3, 4, 1); potPray(4, 0.3); P.psn = 0; }],   // snape grass stands in for the dust and nails of 2007; every skill 4 + 30%, the wiki's own split
  ['super_defence', 'Super defence', 'cadantine', 'white_berries', 66, 150, '#3ab04a', () => potBoost('defence', 5, .15)],
  ['antifire', 'Antifire potion', 'lantadyme', 'dragon_scale_dust', 69, 157.5, '#d8903a', () => { P.afire = tickN + 600; }],
  ['ranging', 'Ranging potion', 'dwarf_weed', 'wine_of_zamorak', 72, 162.5, '#6a8a5a', () => potBoost('ranged', 4, .1)],
  ['magic', 'Magic potion', 'lantadyme', 'potato_cactus', 76, 172.5, '#6a3ad0', () => potBoost('magic', 4, 0)],
  ['combat', 'Combat potion', 'harralander', 'goat_horn', 36, 84, '#a8783a', () => { potBoost('attack', 3, .1); potBoost('strength', 3, .1); }],   // the horn stands in for its ground dust
  ['super_antipoison', 'Superantipoison', 'irit', 'unicorn_horn', 48, 106.3, '#2a8a4a', () => { P.psn = 0; P.psnImm = tickN + 600; say('The poison leaves your body.'); }],
  ['antidote_p', 'Antidote+', 'toadflax', 'coconut', 68, 155, '#4aa08a', () => { P.psn = 0; P.psnImm = tickN + 900; say('You feel proofed against poison.'); }],   // coconut stands in for its milk and the yew roots
  ['stamina', 'Stamina potion', 'avantoe', 'potato_cactus', 77, 102, '#d87a2a', () => { P.energy = Math.min(100, P.energy + 20); P.stamT = tickN + 200; dirty.orb = 1; }],   // cactus stands in for amylase; two minutes of light feet
  ['zamorak_brew', 'Zamorak brew', 'torstol', 'wine_of_zamorak', 78, 175, '#8a2a2a', () => {
    potBoost('attack', 2, .2); potBoost('strength', 2, .12);
    potDrain('defence', 2, .1);
    P.hp = Math.max(1, P.hp - (2 + Math.floor(P.hp * .1)));
    P.pray = Math.min(P.maxpray, P.pray + Math.floor(P.maxpray * .1)); dirty.orb = 1;
  }],   // the wine stands in for jangerberries; the lord of chaos takes his cut of your blood
  ['antidote_pp', 'Antidote++', 'irit', 'coconut', 79, 177.5, '#3ab0a0', () => { P.psn = 0; P.psnImm = tickN + 1200; say('You feel thoroughly proofed against poison.'); }],   // wiki: irit and magic roots in coconut milk
  ['saradomin_brew', 'Saradomin brew', 'toadflax', 'egg', 81, 180, '#d8c84a', () => {
    const hb = 2 + Math.floor(P.maxhp * .15);
    P.hp = Math.min(P.maxhp + hb, P.hp + hb);   // wiki: 2 + 15% healed, and that far past full
    potBoost('defence', 2, .2);   // wiki: Defence up 2 + 20%
    for (const k of ['attack', 'strength', 'magic', 'ranged']) potDrain(k, 2, .1);   // the rest down 2 + 10% of current, stacking
    dirty.orb = dirty.sk = 1;
  }]   // the egg stands in for a crushed nest; heals and armours past full, at the cost of your edge
];
POTS_R.map(([k, n, herb, sec, lv, xp, c, fx]) => {
  const p = { k, n, herb, sec, lv, xp, fx }, unf = herb + '_potion_u', hn = ITEMS[herb].name;
  if (!ITEMS[unf]) {
    defItem({ id: unf, name: hn + ' potion (unf)', g: 'vial', c: '#7aa86a', c2: CORK, val: ITEMS[herb].val + 3 });
    recipe(unf, 'herblore', { toadflax: 34, avantoe: 50 }[herb] || Math.min(...POTS_R.filter(r => r[2] === herb).map(r => r[4])), 0, [[herb, 1], ['vial_of_water', 1]], { tk: 2, msg: 'You put the ' + hn.toLowerCase() + ' leaf into the vial of water.' });
  }
  for (let d = 4; d >= 1; d--) defItem({ id: k + '_' + d, name: n + '(' + d + ')', g: 'vial' + d, c, c2: CORK, val: (20 + lv * 4) * d, dose: d, pot: p, opt: ['Drink', drink] });
  recipe(k + '_3', 'herblore', lv, xp, [[unf, 1], [sec, 1]], { tk: 2, msg: 'You mix the ' + ITEMS[sec].name.toLowerCase() + ' into your potion.' });   // a mixed potion holds three doses, as ever; four-dose stock falls from monsters
  return p;
});

/* ---- FARMING: four patches on every settlement's field ring; sow, let the shared clock run, harvest. No weeds, compost or disease. ---- */
for (const c of CROPS) if (c.t === 2) c.tree = TREES.find(t => t.k === c.k);   // canopy tint and woodcutting xp
const cropStage = o => { const s = P.farm[o.key]; return s ? clamp((tickN - s[1]) / CROPS[s[0]].grow, 0, 1) : 0; };
function farmPatches(v) {   // two allotments, a herb and a tree patch, hashed onto the field strips (computed once)
  if (v.patches) return v.patches;
  const out = v.patches = [];
  for (let i = 0; i < 24 && out.length < 4; i++) {
    const h = hash2(v.x + i * 53, v.z - i * 29, S + 151), a = (h & 1023) / 1024 * TAU, d = v.r * (1.05 + (h >>> 10 & 255) / 255 * 0.45);
    const [x, z] = townPt(v, a, d), y = heightAt(x, z), g = hash2(x, z, S + 101);
    if (y < 1.9 || (g & 1023) < 8 || (g >>> 3 & 4095) < 82 || !fieldAt(x, z, { v, d: villageDist(v, x, z) }) || highwayAt(x, z) || out.some(p => chebDist(p.x, p.z, x, z) < 3)) continue;   // g: the tile must not roll a tree or a vein
    const k = [0, 0, 1, 2][out.length];
    out.push({ t: 15, k, x, z, y, key: tk(x, z), n: PATCH_N[k], noMark: 1 });
  }
  return out;
}
structHooks.push((rec, vs, inChunk) => {
  const mine = [];
  for (const v of vs) for (const p of farmPatches(v)) if (inChunk(p.x, p.z)) { mine.push(p); rec.objs.push(p); rec.blk.push(p.key); }
  if (mine.length) batchInto(rec, B => { for (const p of mine) {
    if (p.k < 2) B.add(BOX, p.x, p.y + 0.17, p.z, 2.2, 0.35, 2.2, 0, [0.30, 0.20, 0.12]);
    else for (let i = 0; i < 4; i++) B.add(BOX, p.x + (i & 1 ? 0.8 : -0.8), p.y + 0.15, p.z + (i & 2 ? 0.8 : -0.8), 0.5, 0.3, 0.5, 0, C_STONE);
  } });
});
USE_ON[15] = (o, uit) => { const c = CROPS.find(c => c.seed === uit.id); return c ? [o.n, o2 => plantSeed(o2, c)] : null; };
function plantSeed(o, c) {
  const n = c.t ? 1 : 3;   // an allotment takes three seeds
  if (c.t !== o.k) return say("That won't grow here.", 'bad');
  if (P.farm[o.key]) return say('There is something growing there.', 'bad');
  if (needLv('farming', c.lv)) return;
  if (invCount(c.seed) < n) return say('You need ' + n + ' seeds to plant an allotment.', 'bad');
  invRemove(c.seed, n); sfx(2442);
  P.farm[o.key] = [c.i, tickN];
  gainXp('farming', c.plant); markDirty(1);
  say('You plant the seeds.');
}
function farmOpts(o) {
  const s = P.farm[o.key], c = s && CROPS[s[0]], g = cropStage(o);
  const insp = { t: 'Inspect', o: o.n, f: () => say(!s ? 'An empty ' + o.n.toLowerCase() + '. Use seeds on it.'
    : g < 1 ? c.n + ' is growing here; about ' + Math.ceil((c.grow - tickN + s[1]) * TICK / 60000) + ' minutes to go.' : 'The ' + c.n.toLowerCase() + ' is fully grown.') };
  return g < 1 ? [insp] : [{ t: c.t === 2 ? 'Check health' : 'Harvest', o: o.n, f: act(o, c.t === 2 ? 'checktree' : 'harvest') }, insp];
}
/* one item a go; the lives ride along as a third element, saved from the first go. A tree pays its farming xp on the check, then five logs with woodcutting xp */
TASKS.harvest = TASKS.checktree = (t, o) => {
  const s = P.farm[o.key], c = s && CROPS[s[0]];
  if (!c || cropStage(o) < 1) { P.task = null; return; }
  if (s.length < 3) {
    s[2] = c.t === 2 ? 5 : 3 + Math.floor(lvl[SK.farming] / 20) + randInt(0, 2);
    markDirty(1);   // the count is saved from here on, so the check's xp is paid once a planting, not once a reload
    if (c.t === 2) { gainXp('farming', c.xp); return say('You check the tree: it has grown well.'); }
  }
  if (!invAdd(c.yield, 1)) return fail(FULL);
  gainXp(c.t === 2 ? 'woodcutting' : 'farming', c.t === 2 ? c.tree.xp : c.xp);
  sfx(2442, 0.8);
  say((c.t === 2 ? 'You get some ' : 'You harvest some ') + ITEMS[c.yield].name.toLowerCase() + '.');
  if (--s[2] <= 0) { delete P.farm[o.key]; markDirty(1); say('The patch is cleared.'); P.task = null; }   // invAdd above already flagged the routine save that carries the count
};
/* what grows: a blob on the bed that swells and takes the produce's colour, or a sapling in the species' tint */
const CROP_GEO = bakeW(shift(octa(0.5), 0.5)), SAPLING_GEO = merge([shade(shift(cyl(0.12, 0.16, 1, 5, 1), 0.5), BARK2), bakeW(shift(octa(0.55, 1), 1.3))]);
const POOL_CROP = Pool(CROP_GEO, 16, 1), POOL_SAPLING = Pool(SAPLING_GEO, 8, 1);
POOLS.push(POOL_CROP, POOL_SAPLING);
poolHooks.push(() => {
  for (const o of nearObjs) {
    if (o.t !== 15 || !P.farm[o.key]) continue;
    const c = CROPS[P.farm[o.key][0]], g = cropStage(o), s = 0.3 + g * 1.5;
    if (c.t === 2) poolPut(POOL_SAPLING, o.x, o.y, o.z, o.x, s, s, s, c.tree.tint);
    else poolPut(POOL_CROP, o.x, o.y + 0.35, o.z, o.x, 0.5 + g * 1.2, 0.3 + g * 0.6, 0.5 + g * 1.2, g < 1 ? 0x4a8a3a : hexInt(ITEMS[c.yield].c));
  }
});

/* ---- HUNTER: traps laid on open ground beyond the town edge; a tick hook rolls each against the best catch your level allows ---- */
defItem({ id: 'bird_snare', name: 'Bird snare', g: 'trap', c: '#c8b080', c2: '#6a5a3a', val: 6, opt: ['Lay', i => layTrap(0, i)] });
defItem({ id: 'box_trap', name: 'Box trap', g: 'trap', c: '#8a6438', c2: '#5b4123', val: 38, opt: ['Lay', i => layTrap(1, i)] });
defItem({ id: 'ferret', name: 'Ferret', g: 'fur', c: '#e8dcc8', c2: '#9a8a70', val: 50 });
defStack('kebbit_fur', 'Kebbit fur', 'fur', '#a07848', '#5b4123', 40);
ITEMS.knife.opt = ['Set deadfall', () => layTrap(2)];   // on the knife, so logs keep Use as their first option
/* creatures: trap kind (0 snare, 1 box, 2 deadfall), level, xp; birds give feathers and bones, box traps the animal, kebbits their fur */
const HUNT = [[0, 'Crimson swift', 1, 34], [0, 'Golden warbler', 5, 47], [0, 'Copper longtail', 9, 61.2], [0, 'Cerulean twitch', 11, 64.5], [0, 'Tropical wagtail', 19, 95.2],
  [1, 'Ferret', 27, 115.2, 'ferret'], [1, 'Chinchompa', 53, 198.4, 'chinchompa'], [1, 'Carnivorous chinchompa', 63, 265, 'red_chinchompa'],
  [2, 'Barb-tailed kebbit', 33, 134.4], [2, 'Prickly kebbit', 37, 147.2], [2, 'Sabre-toothed kebbit', 51, 160]].map(([k, n, lv, xp, loot], i) => ({ k, n, lv, xp, loot, i }));
const huntLoot = c => c.k === 0 ? [['feather', randInt(5, 12)], ['bones', 1]] : c.k === 1 ? [[c.loot, 1]] : [['kebbit_fur', randInt(1, 2)]];
const traps = []; pickLists.push(traps);   // { t: 17, k, n, x, z, y, t0, got: null set | -1 collapsed | HUNT index }
const trapCap = () => 1 + Math.floor(lvl[SK.hunter] / 20);
const invRoom = rows => invFree() >= rows.filter(([id]) => !(ITEMS[id].stack && invCount(id))).length;   // slots the rows would take
const kneel = () => { P.acting = 1; P.actSpan = 2; P.pose = 3; };
function layTrap(k, i) {
  const n = trapCap();
  if (lvl[SK.hunter] < TRAP_LV[k]) return say('You need Hunter level ' + TRAP_LV[k] + ' to set a ' + TRAP_N[k].toLowerCase() + '.', 'bad');
  if (k === 2 && !invCount('logs')) return say('You need logs to set a deadfall.', 'bad');
  if (townCore(P.tx, P.tz)) return say("You can't lay traps in town.", 'bad');
  if (!dryOpen(P.tx, P.tz) || traps.some(t => t.x === P.tx && t.z === P.tz)) return say("You can't lay a trap here.", 'bad');
  if (traps.length >= n) return say("You can't set more than " + n + ' trap' + (n > 1 ? 's' : '') + ' at your level.', 'bad');
  invRemove(k === 2 ? 'logs' : inv[i].id, 1);
  traps.push({ t: 17, k, n: TRAP_N[k], x: P.tx, z: P.tz, y: walkY(P.tx, P.tz), t0: tickN, got: null });
  stopWalk(); P.task = null; kneel();
  say('You set up the ' + TRAP_N[k].toLowerCase() + '.');
}
/* the best creature the kind and your level allow, the second best on half the tiles */
const huntBest = t => { const ok = HUNT.filter(c => c.k === t.k && lvl[SK.hunter] >= c.lv); return ok[Math.max(0, ok.length - 1 - (hash2(t.x, t.z, S) & 1))]; };
tickHooks.push(() => {
  for (let i = traps.length - 1; i >= 0; i--) {
    const t = traps[i];
    if (chebDist(P.tx, P.tz, t.x, t.z) > 64) { traps.splice(i, 1); continue; }   // out of sight, out of mind
    if (t.got !== null || tickN - t.t0 < 8) continue;
    const c = huntBest(t);
    if (c && Math.random() < 0.015 + 0.003 * (lvl[SK.hunter] - c.lv)) t.got = c.i;
    else if (tickN - t.t0 > 250 || Math.random() < 0.004) t.got = -1;
  }
});
/* check or dismantle: the trap comes up either way, a snare or box back into the pack, a deadfall's logs spent */
function trapPick(o) {
  const i = traps.indexOf(o); if (i < 0) return;
  const c = HUNT[o.got] || null, rows = c ? huntLoot(c) : [];
  if (o.k < 2) rows.push([['bird_snare', 'box_trap'][o.k], 1]);
  if (!invRoom(rows)) return say(FULL, 'bad');
  for (const [id, n] of rows) invAdd(id, n);
  traps.splice(i, 1); kneel();
  if (c) { say("You've caught a " + c.n.toLowerCase() + '.'); gainXp('hunter', c.xp); } else say('You dismantle the ' + o.n.toLowerCase() + '.');
}
const trapReset = o => { if (traps.includes(o)) { o.got = null; o.t0 = tickN; kneel(); say('You reset the ' + o.n.toLowerCase() + '.'); } };
OBJ_OPTS[17] = o => HUNT[o.got] ? [{ t: 'Check', o: o.n, f: act(o, trapPick) }]
  : (o.got === null ? [] : [{ t: 'Reset', o: o.n, f: act(o, trapReset) }]).concat({ t: 'Dismantle', o: o.n, f: act(o, trapPick) });
/* a cage: lid on four posts and a trip stick, white-baked so one pool tints by state; scaled by kind (snare tall, deadfall squat) */
const TRAP_GEO = merge([bakeW(shift(box(0.9, 0.08, 0.9), 0.5)), bakeW(shift(box(0.06, 0.9, 0.06), 0.45).rotateZ(0.55).translate(0.6, 0, 0.1))]
  .concat([[1, 1], [1, -1], [-1, 1], [-1, -1]].map(([a, b]) => bakeW(shift(box(0.08, 0.5, 0.08), 0.25).translate(a * 0.41, 0, b * 0.41)))));
const POOL_TRAP = Pool(TRAP_GEO, 6, 1); POOLS.push(POOL_TRAP);
poolHooks.push(() => { for (const t of traps) { const s = [0.7, 1, 1.25][t.k]; poolPut(POOL_TRAP, t.x, t.y, t.z, hash2(t.x, t.z, S) & 3, s, [1.2, 1, 0.55][t.k], s, t.got === null ? 0xa07848 : HUNT[t.got] ? 0xffd66a : 0x6e6e6e); } });

/* construction: the sawmill cuts planks for a fee; planks and a hammer raise a campsite (fire pit, workbench, altar) that stands a quarter hour; flatpacks come off the bench */
const aOrAn = n => (/^[aeiou]/i.test(n) ? 'an ' : 'a ') + n.toLowerCase();
for (const [id, name, log, gp, c, c2] of [['plank', 'Plank', 'logs', 100, '#d2b074', '#8a6a3a'], ['oak_plank', 'Oak plank', 'oak_logs', 250, '#a8813f', '#6b4e22'],
  ['mahogany_plank', 'Mahogany plank', 'mahogany_logs', 1500, '#7a3a2a', '#4a1f16']]) {
  defStack(id, name, 'plank', c, c2, gp, { opt: ['Build', () => showMake('Build', BUILDS)] });
  recipe(id, 'construction', 1, 0, [[log, 1], ['coins', gp]], { at: 13, tk: 1, name: name + ' (' + gp + ' gp)', msg: 'The sawmill cuts your logs into ' + aOrAn(name) + '.' });
}
/* campsite pieces go up where you stand: open ground outside town, one thing a tile; a bad site hands the materials back */
const builds = []; pickLists.push(builds);
function campBuild(r, e) {
  const x = P.tx, z = P.tz;
  P.task = null;
  if (townCore(x, z) || !dryOpen(x, z) || fires.concat(builds).some(b => b.x === x && b.z === z)) { for (const [id, n] of r.need) invAdd(id, n); say("You can't build here.", 'bad'); return null; }
  (e.fire ? fires : builds).push(Object.assign(e, { x, z, y: walkY(x, z), until: tickN + 1500 }));
  return [];
}
const BUILDS = [['firepit', 'Fire pit', 'flame', 1, 58, [['plank', 2], ['logs', 1]], { fire: 1, t: 6, pit: 1 }], ['workbench', 'Workbench', 'hammer', 17, 143, [['plank', 5]], { t: 18 }],
  ['camp_altar', 'Altar', 'star', 45, 240, [['oak_plank', 4]], { t: 8 }]].map(([id, name, g, lv, xp, need, e]) => {
  defItem({ id, name, g, c: '#d2b074', c2: '#8a6a3a', val: 0 });
  return recipe(id, 'construction', lv, xp, need, { tool: 'hammer', fn: r => campBuild(r, Object.assign({ n: name }, e)), msg: 'You build ' + aOrAn(name) + '.' });
});
/* flatpacks: made at the bench, sold anywhere */
for (const [pl, rows] of [['plank', [['crude_chair', 'Crude wooden chair', 1, 2, 58, 20], ['wooden_bookcase', 'Wooden bookcase', 4, 4, 115, 60], ['wooden_chair', 'Wooden chair', 8, 3, 87, 40]]],
  ['oak_plank', [['oak_chair', 'Oak chair', 19, 2, 120, 120], ['oak_table', 'Oak table', 22, 4, 240, 260], ['oak_bookcase', 'Oak bookcase', 29, 3, 180, 220], ['oak_larder', 'Oak larder', 33, 8, 480, 600]]]])
  for (const [id, name, lv, n, xp, val] of rows) { defItem({ id, name, g: 'plank', c: ITEMS[pl].c, c2: ITEMS[pl].c2, val }); recipe(id, 'construction', lv, xp, [[pl, n]], { at: 18, tool: 'hammer', msg: 'You make ' + aOrAn(name) + '.' }); }
OBJ_OPTS[18] = ['Work at', null, o => openMake(18, o)];
/* on screen: a stone ring round a pit, a candle on a slab, a bench on four legs; a piece that burns out ends any work at it */
const POOL_RING = Pool(merge([...Array(8)].map((_, i) => shade(new THREE.DodecahedronGeometry(0.2, 0).translate(Math.cos(i * PI / 4) * 0.95, 0.1, Math.sin(i * PI / 4) * 0.95), STONE))), 16);
const POOL_ALTAR = Pool(merge([shade(shift(box(1.6, 0.9, 0.9), 0.45), C_STONE), shade(shift(box(1.8, 0.12, 1.1), 0.96), C_STONE2),
  shade(shift(cyl(0.06, 0.06, 0.5, 5), 1.27), [0.95, 0.9, 0.7]), shade(shift(cone(0.1, 0.22, 5), 1.62), [1, 0.8, 0.3])]), 8);
const POOL_BENCH = Pool(merge([shade(shift(box(2.0, 0.14, 1.0), 0.9), C_FLOOR), shade(box(0.5, 0.2, 0.3).translate(0.6, 1.07, 0), C_STONE2)]
  .concat([-1, 1].flatMap(a => [-1, 1].map(b => shade(box(0.18, 0.86, 0.18).translate(a * 0.85, 0.43, b * 0.38), C_BEAM))))), 8);
POOLS.push(POOL_RING, POOL_ALTAR, POOL_BENCH);
poolHooks.push(() => { for (const f of fires) if (f.pit) poolPut(POOL_RING, f.x, f.y, f.z, 0, 1); for (const b of builds) poolPut(b.t === 8 ? POOL_ALTAR : POOL_BENCH, b.x, b.y, b.z, 0, 1); });
tickHooks.push(() => { for (let i = builds.length - 1; i >= 0; i--) if (tickN >= builds[i].until) builds.splice(i, 1)[0].dead = 1; });

/* ---- CONSTRUCTION II: THE PLAYER HOUSE ----
   One house per character, claimed on any flat open ground with a deed (1000 gp, the estate agent's price).
   A 3x3 room grid, one floor — the level-1 OSRS house extent. Rooms and furniture are wiki rows verbatim;
   anything needing teak, clay, glass, clockwork or rope is left out (no source here) and noted inline.
   Nails are steel in every recipe (the guide tier; any-nail substitution skipped). No garden room — the
   world outside the door is the garden — and no portals of any kind, by design. */
GLYPH.house = (g, c, d) => { poly(g, [16, 3, 29, 14, 3, 14], d, K); fr(g, c, 7, 14, 18, 13); fr(g, d, 13, 19, 6, 8); };
defItem({ id: 'saw', name: 'Saw', g: 'knife', c: '#a8a8ac', c2: '#6b4e22', val: 13 });
defItem({ id: 'house_deed', name: 'House deed', g: 'house', c: '#e8d9b0', c2: '#6b4e22', val: 1000, opt: ['Claim land', () => claimHouse()] });
SHOP_KINDS[0].base.push('saw', 'house_deed');
/* building supplies, sold at the sawmill at the stonemason's book prices */
for (const [id, name, gp, gl, c, c2] of [['bolt_of_cloth', 'Bolt of cloth', 650, 'wool', '#d8cba0', '#8a7a50'], ['limestone_brick', 'Limestone brick', 26, 'bar', '#c2bba6', '#807a66'],
  ['gold_leaf', 'Gold leaf', 130000, 'leaf', '#f2c94c', '#8a6a14'], ['marble_block', 'Marble block', 325000, 'bar', '#e0dedb', '#8a8880'], ['magic_stone', 'Magic stone', 975000, 'gem', '#4ad8d0', '#1a6a66']]) {
  defStack(id, name, gl, c, c2, gp);
  recipe(id, 'construction', 1, 0, [['coins', gp]], { at: 13, tk: 1, name: name + ' (' + gp + ' gp)', msg: 'You buy ' + aOrAn(name) + '.' });
}
const RS = 8, HGRID = 1;   // room size in tiles; grid runs -1..1 (nine rooms, the level-1 extent)
/* Where a house may stand, as a pure function of the tile. Worldgen is derived
   from the seed alone, so every client computes the same answer — which is what
   lets a house arriving over the wire be held to exactly the rule its builder
   was held to. Before this, the local build refused town squares and king's
   roads and the RECEIVE path checked only that the numbers were numbers, so a
   modified client could park a walled lot over a bank door for everyone else.
   Takes the centre tile; returns a refusal to say aloud, or 0. */
function hSiteBad(cx, cz) {
  const nv = nearVillage(cx, cz);
  if (nv && nv.d < nv.v.r * 1.6) return 'Too close to town: the guilds keep this land.';
  if (wildLvAt(cx, cz)) return 'The Wilderness holds no ground for a home.';
  if (highwayAt(cx, cz) > 0.15) return "You cannot build on the king's road.";
  return 0;
}
const hMe = () => PID || 'me';
const ro2 = (dx, dz, r) => { const c = Math.cos(r), s = Math.sin(r); return [dx * c - dz * s, dx * s + dz * c]; };
/* the furniture book: wiki rows [id, name, lv, xp, materials, shape, tint, extra]; xp already includes the materials' worth.
   extra: t = interactive object type, pm = altar multiplier (bare, before burners), pre = must upgrade from that id. */
{
  const p = 'plank', o = 'oak_plank', m = 'mahogany_plank', n = 'steel_nails', st = 'steel_bar', cl = 'bolt_of_cloth', ls = 'limestone_brick', gl = 'gold_leaf', mb = 'marble_block', ms = 'magic_stone';
  var HF = {}, HOPT = {};   // id -> recipe row; hotspot key -> option ids
  const F = (list, rows) => { HOPT[list] = rows.map(r => r[0]); for (const r of rows) HF[r[0]] = r; };
  F('chair', [['crude_chair', 'Crude wooden chair', 1, 58, [[p, 2], [n, 2]], 'chair', HW.p], ['wooden_chair', 'Wooden chair', 8, 87, [[p, 3], [n, 3]], 'chair', HW.p],
    ['rocking_chair', 'Rocking chair', 14, 87, [[p, 3], [n, 3]], 'chair', HW.p], ['oak_chair', 'Oak chair', 19, 120, [[o, 2]], 'chair', HW.o],
    ['oak_armchair', 'Oak armchair', 26, 180, [[o, 3]], 'chair', HW.o], ['mahogany_armchair', 'Mahogany armchair', 50, 280, [[m, 2]], 'chair', HW.m]]);   // teak armchair: no teak in this world
  F('bookcase', [['wooden_bookcase', 'Wooden bookcase', 4, 115, [[p, 4], [n, 4]], 'bookcase', HW.p], ['oak_bookcase', 'Oak bookcase', 29, 180, [[o, 3]], 'bookcase', HW.o],
    ['mahogany_bookcase', 'Mahogany bookcase', 40, 420, [[m, 3]], 'bookcase', HW.m]]);
  F('fireplace', [['stone_fireplace', 'Stone fireplace', 33, 40, [[ls, 2]], 'fireplace', HW.ls], ['marble_fireplace', 'Marble fireplace', 63, 500, [[mb, 1]], 'fireplace', HW.mb]]);   // clay fireplace: no clay
  F('rug', [['brown_rug', 'Brown rug', 2, 30, [[cl, 2]], 'rug', [0.45, 0.33, 0.2]], ['rug', 'Rug', 13, 60, [[cl, 4]], 'rug', [0.55, 0.2, 0.2]],
    ['opulent_rug', 'Opulent rug', 65, 360, [[cl, 4], [gl, 1]], 'rug', [0.6, 0.15, 0.3]]]);
  F('larder', [['wooden_larder', 'Wooden larder', 9, 228, [[p, 8], [n, 8]], 'larder', HW.p], ['oak_larder', 'Oak larder', 33, 480, [[o, 8]], 'larder', HW.o]]);   // teak larder dropped
  F('stove', [['small_oven', 'Small oven', 24, 80, [[st, 4]], 'stove', HW.st], ['large_oven', 'Large oven', 29, 100, [[st, 5]], 'stove', HW.st],
    ['steel_range', 'Steel range', 34, 120, [[st, 6]], 'stove', HW.st], ['fancy_range', 'Fancy range', 42, 160, [[st, 8]], 'stove', HW.g]]);   // clay firepits dropped
  for (const id of HOPT.stove) HF[id][7] = { t: 6 };   // every stove cooks
  F('ktable', [['kitchen_table', 'Kitchen table', 12, 87, [[p, 3], [n, 3]], 'table', HW.p], ['oak_kitchen_table', 'Oak kitchen table', 32, 180, [[o, 3]], 'table', HW.o]]);
  F('shelf', [['wooden_shelves', 'Wooden shelves', 6, 87, [[p, 3], [n, 3]], 'shelves', HW.p]]);   // higher shelves need clay
  F('sink', [['pump_and_drain', 'Pump and drain', 7, 100, [[st, 5]], 'sink', HW.st], ['pump_and_tub', 'Pump and tub', 27, 200, [[st, 10]], 'sink', HW.st],
    ['sink', 'Sink', 47, 300, [[st, 15]], 'sink', HW.ls]]);
  F('barrel', [['beer_barrel', 'Beer barrel', 7, 87, [[p, 3], [n, 3]], 'barrel', HW.o]]);   // the ale barrels want a brewery
  F('dtable', [['wood_dining_table', 'Wood dining table', 10, 115, [[p, 4], [n, 4]], 'bigtable', HW.p], ['oak_table', 'Oak dining table', 22, 240, [[o, 4]], 'bigtable', HW.o],
    ['carved_oak_table', 'Carved oak table', 31, 360, [[o, 6]], 'bigtable', HW.o], ['mahogany_table', 'Mahogany table', 52, 840, [[m, 6]], 'bigtable', HW.m],
    ['opulent_table', 'Opulent table', 72, 3100, [[m, 6], [cl, 4], [gl, 4], [mb, 2]], 'bigtable', HW.g]]);   // teak tables dropped
  F('dbench', [['wooden_bench', 'Wooden bench', 10, 115, [[p, 4], [n, 4]], 'bench', HW.p], ['oak_bench', 'Oak bench', 22, 240, [[o, 4]], 'bench', HW.o],
    ['carved_oak_bench', 'Carved oak bench', 31, 240, [[o, 4]], 'bench', HW.o], ['mahogany_bench', 'Mahogany bench', 52, 560, [[m, 4]], 'bench', HW.m],
    ['gilded_bench', 'Gilded bench', 61, 1760, [[m, 4], [gl, 4]], 'bench', HW.g]]);
  F('wdecor', [['oak_decoration', 'Oak wall decoration', 16, 120, [[o, 2]], 'decor', HW.o], ['gilded_decoration', 'Gilded decoration', 56, 1020, [[m, 3], [gl, 2]], 'decor', HW.g]]);
  F('bed', [['wooden_bed', 'Wooden bed', 20, 117, [[p, 3], [n, 3], [cl, 2]], 'bed', HW.p], ['oak_bed', 'Oak bed', 30, 210, [[o, 3], [cl, 2]], 'bed', HW.o],
    ['large_oak_bed', 'Large oak bed', 34, 330, [[o, 5], [cl, 2]], 'bed', HW.o], ['four_poster', '4-poster', 53, 450, [[m, 3], [cl, 2]], 'bed', HW.m],
    ['gilded_four_poster', 'Gilded 4-poster', 60, 1330, [[m, 5], [cl, 2], [gl, 2]], 'bed', HW.g]]);
  for (const id of HOPT.bed) HF[id][7] = { t: 20 };   // a bed makes this house home
  F('wardrobe', [['shoe_box', 'Shoe box', 20, 58, [[p, 2], [n, 2]], 'wardrobe', HW.p], ['oak_drawers', 'Oak drawers', 27, 120, [[o, 2]], 'wardrobe', HW.o],
    ['oak_wardrobe', 'Oak wardrobe', 39, 180, [[o, 3]], 'wardrobe', HW.o], ['mahogany_wardrobe', 'Mahogany wardrobe', 75, 420, [[m, 3]], 'wardrobe', HW.m],
    ['gilded_wardrobe', 'Gilded wardrobe', 87, 720, [[m, 3], [gl, 1]], 'wardrobe', HW.g]]);
  F('lectern', [['oak_lectern', 'Oak lectern', 40, 60, [[o, 1]], 'lectern', HW.o], ['eagle_lectern', 'Eagle lectern', 47, 120, [[o, 2]], 'lectern', HW.o],
    ['mahogany_eagle_lectern', 'Mahogany eagle lectern', 67, 580, [[m, 2], [gl, 1]], 'lectern', HW.m],
    ['marble_lectern', 'Marble lectern', 77, 1800, [[mb, 1], [ms, 1], [gl, 1]], 'lectern', HW.mb]]);   // no tablets to write here: the scholar's pride alone
  F('globe', [['globe', 'Globe', 41, 180, [[o, 3]], 'globe', [0.3, 0.5, 0.7]], ['armillary_sphere', 'Armillary sphere', 77, 960, [[m, 2], [gl, 2], [st, 4]], 'globe', HW.g],
    ['small_orrery', 'Small orrery', 86, 1320, [[m, 3], [gl, 3]], 'globe', HW.g], ['large_orrery', 'Large orrery', 95, 1420, [[m, 3], [gl, 5]], 'globe', HW.g]]);
  F('chart', [['alchemical_chart', 'Alchemical chart', 43, 30, [[cl, 2]], 'chart', [0.6, 0.5, 0.3]], ['astronomical_chart', 'Astronomical chart', 63, 45, [[cl, 3]], 'chart', [0.3, 0.4, 0.6]],
    ['infernal_chart', 'Infernal chart', 83, 60, [[cl, 4]], 'chart', [0.6, 0.25, 0.2]]]);
  F('altar', [['oak_altar', 'Oak altar', 45, 240, [[o, 4]], 'altar', HW.o], ['mahogany_altar', 'Mahogany altar', 60, 590, [[m, 4], [cl, 2]], 'altar', HW.m],
    ['limestone_altar', 'Limestone altar', 64, 910, [[m, 6], [cl, 2], [ls, 2]], 'altar', HW.ls], ['marble_altar', 'Marble altar', 70, 1030, [[mb, 2], [cl, 2]], 'altar', HW.mb],
    ['gilded_altar', 'Gilded altar', 75, 2230, [[mb, 2], [cl, 2], [gl, 4]], 'altar', HW.g]]);   // teak and cloth altars dropped
  const ALT_PM = { oak_altar: 1, mahogany_altar: 1.5, limestone_altar: 1.75, marble_altar: 2, gilded_altar: 2.5 };   // wiki: bury multiplier bare, +0.5 a lit burner
  for (const id of HOPT.altar) HF[id][7] = { t: 8, pm: ALT_PM[id] };
  F('burner', [['oak_burners', 'Oak incense burners', 61, 280, [[o, 4], [st, 2]], 'burner', HW.o], ['mahogany_burners', 'Mahogany incense burners', 65, 600, [[m, 4], [st, 2]], 'burner', HW.m],
    ['marble_burners', 'Marble incense burners', 69, 1600, [[mb, 2], [st, 2]], 'burner', HW.mb]]);   // torches and candlesticks feed no prayer: left out
  for (const id of HOPT.burner) HF[id][7] = { t: 21 };
  F('cstatue', [['small_statue', 'Small statue', 49, 40, [[ls, 2]], 'statue', HW.ls], ['medium_statue', 'Medium statue', 69, 500, [[mb, 1]], 'statue', HW.mb],
    ['large_statue', 'Large statue', 89, 1500, [[mb, 3]], 'statue', HW.mb]]);
  F('music', [['windchimes', 'Windchimes', 49, 323, [[o, 4], [n, 4], [st, 4]], 'chimes', HW.o], ['organ', 'Organ', 69, 680, [[m, 4], [st, 6]], 'organ', HW.m]]);   // bells are teak
  F('wbench', [['wooden_workbench', 'Wooden workbench', 17, 143, [[p, 5], [n, 5]], 'bench2', HW.p], ['oak_workbench', 'Oak workbench', 32, 300, [[o, 5]], 'bench2', HW.o],
    ['steel_framed_bench', 'Steel framed bench', 46, 440, [[o, 6], [st, 4]], 'bench2', HW.st],
    ['bench_with_vice', 'Bench with vice', 62, 140, [[o, 2], [st, 1]], 'bench2', HW.st, { pre: 'steel_framed_bench' }],
    ['bench_with_lathe', 'Bench with lathe', 77, 140, [[o, 2], [st, 1]], 'bench2', HW.st, { pre: 'bench_with_vice' }]]);
  for (const id of HOPT.wbench) HF[id][7] = Object.assign({ t: 18 }, HF[id][7]);
  F('wrepair', [['repair_bench', 'Repair bench', 15, 120, [[o, 2]], 'wheel', HW.o], ['whetstone', 'Whetstone', 35, 260, [[o, 4], [ls, 1]], 'wheel', HW.ls],
    ['armour_stand', 'Armour stand', 55, 500, [[o, 8], [ls, 1]], 'astand', HW.ls]]);   // nothing here breaks: built for the xp, as ever
  F('wtools', [['tool_store', 'Tool store', 15, 120, [[o, 2]], 'toolrack', HW.o]]);
  for (const id of HOPT.wtools) HF[id][7] = { t: 22 };
}
/* the rooms: [key, name, lv, cost, doors NESW, hotspots [list, lx, lz, lrot]]; wiki level and price, doors as published */
const H_N = 1, H_E = 2, H_S = 4, H_W = 8;
const ROOMS = [
  ['parlour', 'Parlour', 1, 1000, H_E | H_S | H_W, [['chair', 2, 2, 0], ['chair', 5, 2, 0], ['bookcase', 2, 6, PI], ['fireplace', 4, 6, PI], ['rug', 3, 3, 0]]],
  ['kitchen', 'Kitchen', 5, 5000, H_E | H_S, [['larder', 1, 5, PI / 2], ['stove', 4, 6, PI], ['sink', 6, 4, -PI / 2], ['ktable', 3, 2, 0], ['shelf', 1, 2, PI / 2], ['barrel', 6, 1, 0]]],
  ['dining', 'Dining room', 10, 5000, H_E | H_S | H_W, [['dtable', 3, 3, 0], ['dbench', 3, 1, 0], ['dbench', 3, 5, PI], ['fireplace', 3, 6, PI], ['wdecor', 5, 6, PI]]],
  ['workshop', 'Workshop', 15, 10000, H_N | H_S, [['wbench', 2, 5, PI], ['wrepair', 5, 5, PI], ['wtools', 6, 2, -PI / 2]]],
  ['bedroom', 'Bedroom', 20, 10000, H_E | H_S, [['bed', 2, 5, PI], ['wardrobe', 5, 6, PI], ['rug', 4, 2, 0], ['fireplace', 1, 3, PI / 2]]],
  ['study', 'Study', 40, 50000, H_E | H_S | H_W, [['lectern', 3, 6, PI], ['globe', 1, 2, 0], ['chart', 6, 4, -PI / 2], ['bookcase', 1, 5, PI / 2]]],
  ['chapel', 'Chapel', 45, 50000, H_E | H_S, [['altar', 3, 5, PI], ['burner', 1, 5, PI], ['burner', 6, 5, PI], ['cstatue', 1, 1, 0], ['music', 6, 1, 0]]]
];   // garden left out (the world is the garden); portal chamber and throne room out of scope; no upstairs
const ROOM_BY = {}; ROOMS.forEach((r, i) => ROOM_BY[r[0]] = i);
/* recipe rows: furniture and rooms flow through the ordinary make engine; the fn reads the hotspot off the task */
const hexC = a => '#' + a.map(v => Math.round(v * 255).toString(16).padStart(2, '0')).join('');
const defIf = (id, name, c) => { if (!ITEMS[id]) defItem({ id, name, g: 'plank', c, c2: '#4a3a26', val: 0 }); };
for (const id in HF) {
  const [, name, lv, xp, mats, , tint] = HF[id];
  defIf(id, name, hexC(tint));
  recipe(id, 'construction', lv, xp, mats, { at: 'hs', tool: ['hammer', 'saw'], tk: 2, fn: r => furnBuild(id, r), msg: 'You build ' + aOrAn(name) + '.' });
}
const ROOM_RECIPES = ROOMS.map((R, i) => {
  defIf('room_' + R[0], R[1], '#e8d9b0');
  return recipe('room_' + R[0], 'construction', R[2], 0, [['coins', R[3]]], { at: 'hsRoom', tk: 2, name: R[1] + ' (' + R[3] + ' gp)', fn: r => roomBuild(i, r), msg: 'You build a ' + R[1].toLowerCase() + '.' });
});
const HREC = {}; for (const r of RECIPES) if (r.at === 'hs') HREC[r.id] = r;

/* one registry for every standing house, the player's own included; one floorMap record a house, so the whole roof lifts */
const housesReg = new Map();   // pid -> { h, rec, meshes, roof }
const hsObjs = [], hghosts = []; pickLists.push(hsObjs, hghosts);
const litMap = new Map();   // burner key -> lit-until tick (local flavour, not synced)
let bmOn = 0, moveSel = null;
const rotMask = (m, r) => { for (let i = 0; i < (r & 3); i++) m = ((m >> 1) | ((m & 1) << 3)) & 15; return m; };
const rotL = (lx, lz, r) => { for (let i = 0; i < (r & 3); i++) { const t = lx; lx = RS - 1 - lz; lz = t; } return [lx, lz]; };
const SIDE = [[H_N, 0, 1], [H_E, 1, 0], [H_S, 0, -1], [H_W, -1, 0]];
const roomAt = (h, gx, gz) => h.rm.find(r => r[1] === gx && r[2] === gz);
/* a house record from the wire or an old save must be sound before it renders: one bad row would throw mid-frame for everyone */
/* Clamped to the grid the builder actually offers: it admitted twelve rooms on a five-wide grid, so a hand-made record
   off the wire could stand two rooms further out than any house this client can build. */
const hValid = h => Number.isFinite(h.x) && Number.isFinite(h.z) && Number.isFinite(h.y) && Math.abs(h.y) <= 1000 &&
  Array.isArray(h.rm) && h.rm.length >= 1 && h.rm.length <= (HGRID * 2 + 1) ** 2 &&
  h.rm.every(r => Array.isArray(r) && Number.isInteger(r[0]) && ROOMS[r[0]] && Number.isInteger(r[1]) && Math.abs(r[1]) <= HGRID &&
    Number.isInteger(r[2]) && Math.abs(r[2]) <= HGRID && Number.isInteger(r[3]) && r[3] >= 0 && r[3] <= 3 && Array.isArray(r[4]));
/* houses stand only while their owner walks this world: the character save is the one true record, the room a live mirror.
   Conflicts weigh the ACTUAL rooms of both houses, not the old blanket radius — a one-room cottage slips in where a mansion cannot. */
const hRects = (h, e) => e ? [[h.x - RS, h.z - RS, RS * 3]] : h.rm.map(r => [h.x + r[1] * RS, h.z + r[2] * RS, RS]);   // e: the whole potential nine-room lot
function hClash(a, b, e) {
  for (const [ax, az, aw] of hRects(a, e)) for (const [bx, bz, bw] of hRects(b, e))
    if (ax < bx + bw + 2 && bx < ax + aw + 2 && az < bz + bw + 2 && bz < az + aw + 2) return 1;   // two tiles of daylight between any two walls
  return 0;
}
function hBlocked(h, skip, e) { for (const [pid, r] of housesReg) if (pid !== skip && r.h && hClash(h, r.h, e)) return pid; return 0; }
const NOBLOCK = { rug: 1, chart: 1, decor: 1 };   // flat or wall-hung: walked over
function clearHouse(pid) {
  const r = housesReg.get(pid);
  if (!r) return;
  for (const k of r.blk) unblock(k);
  for (const k of r.flr) floorMap.delete(k);
  for (const m of r.meshes) { scene.remove(m); m.geometry.dispose(); }
  for (let i = hsObjs.length - 1; i >= 0; i--) if (hsObjs[i].house === pid) { hsObjs[i].dead = 1; hsObjs.splice(i, 1); }
  housesReg.delete(pid);
}
/* baked chunks keep the trees they scattered; rebuilding the covered chunks makes scatter respect the house tiles */
function dirtyLot(h) {
  for (let cx = Math.floor((h.x - RS) / CHUNK); cx <= Math.floor((h.x + RS * 2) / CHUNK); cx++)
    for (let cz = Math.floor((h.z - RS) / CHUNK); cz <= Math.floor((h.z + RS * 2) / CHUNK); cz++) {
      const key = ck(cx, cz), rec = chunks.get(key);
      if (rec) { disposeChunk(rec); chunks.delete(key); }
    }
  /* dropping a chunk is only half the job: nothing re-lays it until the player crosses a chunk line, and a
     player standing in a fresh house crosses nothing. Re-queue here and lay the ground back the same frame. */
  refresh();
  pump(40);
  while (popQueue.length) { const r = popQueue.shift(); if (!r.pop && r.mesh.parent) populateChunk(r); }
  nearDirty = 1;
}
function applyHouse(pid, h) {
  if (h && (h.z > DUN_MIN || !hValid(h))) h = null;   // no holding stands below, and a malformed record is no house at all
  const old = housesReg.get(pid), oldSig = old && old.sig, oldH = old && old.h;
  clearHouse(pid);
  if (!h || !h.rm || !h.rm.length) { if (oldH) dirtyLot(oldH); if (pid === hMe()) refreshGhosts(); return; }
  const hy = h.y, fy = hy + FLOOR_TOP, own = pid === hMe();
  const rec = { y: hy, shop: null, bank: 0, house: pid, h, blk: [], flr: [] };
  const B = new Batch();   // batches share one scratch buffer: body first, roof after
  h.rm.forEach((rm, ri) => {
    const [ti, gx, gz, rot, f] = rm, R = ROOMS[ti], mask = rotMask(R[4], rot);
    const x0 = h.x + gx * RS, z0 = h.z + gz * RS, cx = x0 + (RS - 1) / 2, cz = z0 + (RS - 1) / 2;
    for (let lx = 0; lx < RS; lx++) for (let lz = 0; lz < RS; lz++) {   // walls block, floors carry the record
      const x = x0 + lx, z = z0 + lz, k = tk(x, z);
      const sN = lz === RS - 1, sS = lz === 0, sE = lx === RS - 1, sW = lx === 0;
      const mid = v => v === 3 || v === 4;
      const door = (sN && (mask & H_N) && mid(lx)) || (sS && (mask & H_S) && mid(lx)) || (sE && (mask & H_E) && mid(lz)) || (sW && (mask & H_W) && mid(lz));
      if ((sN || sS || sE || sW) && !door) { block(k); rec.blk.push(k); } else { floorMap.set(k, rec); rec.flr.push(k); }
    }
   // shell: slab, skirt, walls with door gaps, corner posts, beams
    B.add(BOX, cx, hy + FLOOR_TOP - 0.81, cz, RS, 1.6, RS, 0, C_FLOOR);
    B.add(BOX, cx, hy - 0.2, cz, RS + 0.3, 0.6, RS + 0.3, 0, C_FOUND);
    for (const [bit, dx, dz] of SIDE) {
      const along = dz !== 0, wx = cx + dx * ((RS - 1) / 2), wz = cz + dz * ((RS - 1) / 2);
      const segs = (mask & bit) ? [[-2.5, 3], [2.5, 3]] : [[0, RS]];
      for (const [off, len] of segs) B.add(BOX, along ? cx + off : wx, fy + 1.25, along ? wz : cz + off, along ? len : 0.35, 2.5, along ? 0.35 : len, 0, C_WALL);
      for (const [oy, bh, bw] of [[0.22, 0.44, 0.58], [2.36, 0.26, 0.56]])   // timber sits a clear tenth proud of the plaster, its top a hair under the wall top
        B.add(BOX, along ? cx : wx, fy + oy, along ? wz : cz, along ? RS : bw, bh, along ? bw : RS, 0, C_BEAM);
      if (mask & bit) B.add(BOX, along ? cx : wx, fy + 2.1, along ? wz : cz, along ? 2.3 : 0.56, 0.35, along ? 0.56 : 2.3, 0, C_BEAM);
    }
    for (const a of [0, RS - 1]) for (const b of [0, RS - 1]) B.add(BOX, x0 + a, fy + 1.3, z0 + b, 0.66, 2.6, 0.66, 0, C_BEAM);
   // furniture: built options render, interactive ones become real objects
    R[5].forEach((hs, hi) => {
      const id = f[hi];
      if (!id || !HF[id]) return;
      const [, name, , , , shape, tint, xtr] = HF[id];
      const [lx, lz] = rotL(hs[1], hs[2], rot), x = x0 + lx, z = z0 + lz, fr = hs[3] + rot * PI / 2;
      const lk = pid + ':' + ri + ':' + hi;
      FSHAPE[shape](B, x, fy, z, fr, tint, litMap.get(lk) > tickN);
      if (!NOBLOCK[shape]) { const k = tk(x, z); block(k); rec.blk.push(k); floorMap.delete(k); const fi = rec.flr.indexOf(k); if (fi >= 0) rec.flr.splice(fi, 1); }
      if (xtr && xtr.t && !(own && bmOn)) {   // build mode suspends your own fixtures, as ever
        const ob = { t: xtr.t, k: 0, x, z, y: fy, n: name, house: pid, ri, lk };
        if (xtr.t === 8) ob.pm = () => xtr.pm + 0.5 * hsObjs.filter(b => b.t === 21 && b.house === pid && b.ri === ri && litMap.get(b.lk) > tickN).length;
        hsObjs.push(ob);
      }
    });
  });
  const body = B.mesh();
  const RB = new Batch();
  for (const rm of h.rm) {
    const cx = h.x + rm[1] * RS + (RS - 1) / 2, cz = h.z + rm[2] * RS + (RS - 1) / 2;
    RB.add(BOX, cx, fy + 2.56, cz, RS + 1.4, 0.16, RS + 1.4, 0, C_ROOF2);
    RB.add(PYR, cx, fy + 2.66, cz, RS + 1.5, 2.3, RS + 1.5, 0, C_ROOF4);   // base floats 0.02 above the eave: coplanar bases flicker
  }
  const roof = RB.mesh();
  rec.meshes = [body, roof].filter(Boolean);
  for (const m of rec.meshes) scene.add(m);
  rec.roof = roof;
  if (roof) roof.visible = roofShown(rec);
  rec.sig = h.x + '|' + h.z + '|' + h.rm.map(r => r[1] + ':' + r[2]).sort().join(',');
  housesReg.set(pid, rec);
  if (rec.sig !== oldSig) dirtyLot(h);   // rebuild covered chunks only when the footprint changed
  if (own) refreshGhosts();
  wmDirty = 1;
}
/* claiming: flat, dry, open ground clear of towns, roads and other holdings; the deed is the estate agent's fee.
   With a house already owned, the deed pays the movers instead: the whole house — rooms, doors, furnishings — at your feet. */
function claimHouse() {
  if (P.hs) {
    if (hsMoveTo(1)) { invRemove('house_deed', 1); say('The estate agent takes the deed; the movers do the rest.', 'lv'); }
    return;
  }
  if (inDunPlane(P.tz)) return say('No deed covers the underworld.', 'bad');
  const x0 = P.tx - (RS >> 1), z0 = P.tz - (RS >> 1);
  const bad = hSiteBad(P.tx, P.tz);
  if (bad) return hsNo(bad);
  if (hBlocked({ x: x0, z: z0, rm: H33 }, hMe(), 1)) return hsNo('Another house stands too near.');   // a new home and its neighbours are each held apart as a potential nine-room lot
  let lo = 1e9, hi = -1e9;
  for (let a = -RS; a < RS * 2; a++) for (let b = -RS; b < RS * 2; b++) {   // the whole nine-room lot must fit
    const y = heightAt(x0 + a, z0 + b);
    if (y < 1.2) return hsNo('The lot runs into water.');
    if (floorMap.has(tk(x0 + a, z0 + b))) return hsNo('Something already stands on this ground.');
    lo = Math.min(lo, y); hi = Math.max(hi, y);
  }
  if (hi - lo > 2.2) return hsNo('The ground is too uneven to build on. Seek flatter land.');
  let felled = 0;   // trees and stones make way for the deed: the chunk rebuild sweeps them off
  for (let a = 0; a < RS; a++) for (let b = 0; b < RS; b++) if (blocked.has(tk(x0 + a, z0 + b))) felled++;
  if (felled) say('The builders clear ' + felled + ' trees and stones as the walls rise.');
  invRemove('house_deed', 1);
  P.hs = { x: x0, z: z0, y: Math.round(hi * 4) / 4, rev: 1, rm: [[0, 0, 0, 0, []]] };
  applyHouse(hMe(), P.hs);
  houseSync();
  say('The land is yours. A parlour rises around you — step outside and press Build to extend it.', 'lv');
  if (OFFLINE || !AUTH || !saveArmed) say('Built on sand: nothing is being saved this session, so the house will not survive a reload.', 'bad');
}
function houseSync() { markDirty(1); if (!OFFLINE && srvBuild >= 6) wsSend([23, P.hs || 0]); }
function hFinish() { P.hs.rev = (P.hs.rev || 0) + 1; applyHouse(hMe(), P.hs); houseSync(); P.task = null; }
const hConnected = rms => {   // every room must reach the first by shared sides
  if (!rms.length) return true;
  const key = r => r[1] + ':' + r[2], seen = new Set([key(rms[0])]), q = [rms[0]];
  while (q.length) { const c = q.pop(); for (const r of rms) if (!seen.has(key(r)) && Math.abs(r[1] - c[1]) + Math.abs(r[2] - c[2]) === 1) { seen.add(key(r)); q.push(r); } }
  return rms.every(r => seen.has(key(r)));
};
const hRefuse = (r, why) => {   // a refused build hands the materials back and ends the job
  for (const [id, n] of r.need) { invAdd(id, n); if (id === 'coins') gpSunk -= n; }
  if (why) say(why, 'bad');
  P.task = null;
  return null;
};
/* Which way a new room should face: score each rotation by how many of its doors meet a neighbour's door, and how many
   of its solid walls block one. Laying every room at rot 0 could seal it off the moment it was paid for. */
function doorFit(ti, gx, gz) {
  let best = 0, bs = -1e9;
  for (let rot = 0; rot < 4; rot++) {
    const mask = rotMask(ROOMS[ti][4], rot);
    let sc = 0;
    SIDE.forEach(([bit, dx, dz], i2) => {
      const nb = roomAt(P.hs, gx + dx, gz + dz); if (!nb) return;
      const open = rotMask(ROOMS[nb[0]][4], nb[3]) & SIDE[(i2 + 2) & 3][0];
      sc += open ? ((mask & bit) ? 2 : -2) : ((mask & bit) ? -1 : 0);
    });
    if (sc > bs) { bs = sc; best = rot; }
  }
  return best;
}
function roomBuild(i, r) {
  const g = P.task && P.task.o;
  if (!g || g.gk !== 'room' || !P.hs || roomAt(P.hs, g.gx, g.gz) || P.hs.rm.length >= 9) return hRefuse(r);
  let felled = 0;
  for (let a = 0; a < RS; a++) for (let b = 0; b < RS; b++) {
    const k = tk(P.hs.x + g.gx * RS + a, P.hs.z + g.gz * RS + b);
    if (floorMap.has(k) && floorMap.get(k).house !== hMe()) return hRefuse(r, 'Something else already stands on that ground.');
    if (blocked.has(k)) felled++;   // trees and stones give way to the room; the rebuild clears them
  }
  if (felled) say('The builders fell ' + felled + ' trees and stones to make room.');
  P.hs.rm.push([i, g.gx, g.gz, doorFit(i, g.gx, g.gz), []]);   // face the doorway it was built against
  hFinish();
  return [];
}
function furnBuild(id, r) {
  const g = P.task && P.task.o;
  if (!g || (g.gk !== 'furn' && g.gk !== 'rem') || !P.hs) return hRefuse(r);
  const rm = P.hs.rm[g.ri];
  if (!rm) return hRefuse(r);
  const cur = rm[4][g.hi] || null, pre = HF[id][7] && HF[id][7].pre;
  if (pre ? cur !== pre : cur) return hRefuse(r, 'There is already something built there.');
  rm[4][g.hi] = id;
  hFinish();
  return [];
}
/* build mode: ghost markers for room doors, empty hotspots, and removals; your own fixtures stand down meanwhile */
function refreshGhosts() {
  hghosts.forEach(g => g.dead = 1); hghosts.length = 0;
  const h = P.hs;
  if (!bmOn || !h) return;
  const fy = h.y + FLOOR_TOP, cells = new Set();
  h.rm.forEach((rm, ri) => {
    const [ti, gx, gz, rot, f] = rm, R = ROOMS[ti], mask = rotMask(R[4], rot);
    const x0 = h.x + gx * RS, z0 = h.z + gz * RS;
    for (const [bit, dx, dz] of SIDE) {   // a door with nothing beyond it is where a room can grow
      const nx = gx + dx, nz = gz + dz, ck2 = nx + ':' + nz;
      if (!(mask & bit) || Math.abs(nx) > HGRID || Math.abs(nz) > HGRID || roomAt(h, nx, nz) || cells.has(ck2)) continue;
      cells.add(ck2);
      hghosts.push({ t: 19, gk: 'room', gx: nx, gz: nz, x: h.x + nx * RS + 3.5, z: h.z + nz * RS + 3.5, y: fy, n: 'Room space' });
    }
    hghosts.push({ t: 19, gk: 'ctl', ri, x: x0 + 3.5, z: z0 + 3.5, y: fy, n: R[1] });
    R[5].forEach((hs, hi) => {
      const [lx, lz] = rotL(hs[1], hs[2], rot), x = x0 + lx, z = z0 + lz, id = f[hi];
      if (id) hghosts.push({ t: 19, gk: 'rem', ri, hi, x, z, y: fy, n: HF[id] ? HF[id][1] : id, hs });
      else hghosts.push({ t: 19, gk: 'furn', ri, hi, x, z, y: fy, n: 'Build ' + hs[0], hs });
    });
  });
}
const furnOptsFor = g => {   // fresh builds when empty, the chain's next step when not
  const rm = P.hs.rm[g.ri], cur = rm[4][g.hi] || null;
  return HOPT[g.hs[0]].map(id => HREC[id]).filter(r => { const pre = HF[r.id][7] && HF[r.id][7].pre; return pre ? cur === pre : !cur; });
};
OBJ_OPTS[19] = o => {
  if (moveSel && (!P.hs || !P.hs.rm.includes(moveSel))) moveSel = null;   // the armed room came down under us: an index would now name a different room
  if (o.gk === 'room') return moveSel
    ? [{ t: 'Move room', o: 'here', f: act(o, o2 => { const rm = moveSel; moveSel = null; const was = [rm[1], rm[2]]; rm[1] = o2.gx; rm[2] = o2.gz; if (!hConnected(P.hs.rm)) { rm[1] = was[0]; rm[2] = was[1]; return say('The rooms must stay joined.', 'bad'); } hFinish(); say('The room is moved.'); }) },
       { t: 'Cancel move', o: 'room', f: () => { moveSel = null; say('The room stays where it is.'); } }]
    : [{ t: 'Build', o: 'New room', f: act(o, o2 => showMake('Build a room', ROOM_RECIPES, o2)) }];
  if (o.gk === 'furn') return [{ t: 'Build', o: o.n.slice(6), f: act(o, o2 => { const rows = furnOptsFor(o2); rows.length ? showMake(o2.n, rows, o2) : say('Nothing can be built there yet.'); }) }];
  if (o.gk === 'rem') {
    const up = furnOptsFor(o);   // the chain's next step builds over what stands (vice on the steel bench)
    const opts2 = up.length ? [{ t: 'Upgrade', o: o.n, f: act(o, o2 => showMake(o2.n, furnOptsFor(o2), o2)) }] : [];
    return opts2.concat([{ t: 'Remove', o: o.n, f: act(o, o2 => { P.hs.rm[o2.ri][4][o2.hi] = null; hFinish(); say('You tear it out. The materials are past saving.'); }) }]);
  }
  const opts = [{ t: 'Rotate', o: o.n, f: act(o, o2 => { const rm = P.hs.rm[o2.ri]; rm[3] = (rm[3] + 1) & 3; hFinish(); say('The room turns a quarter to the ' + ['north', 'east', 'south', 'west'][rm[3]] + '.'); }) },
    { t: 'Move', o: o.n, f: () => { moveSel = P.hs.rm[o.ri] || null; say('Now click a room space to set it down.', 'lv'); } }];
  opts.push(P.hs.rm.length === 1
    ? { t: 'Demolish', o: 'house', f: () => askDemolish() }
    : { t: 'Remove', o: o.n + ' (room)', f: act(o, o2 => { const rms = P.hs.rm.slice(); rms.splice(o2.ri, 1); if (!hConnected(rms)) return say('That room holds the house together.', 'bad'); P.hs.rm.splice(o2.ri, 1); hFinish(); say('The room comes down; its furniture is lost.'); }) });
  return opts;
};
function askDemolish() {
  showModal('Demolish the house',
    '<p class="smsg">The house and <b>everything built in it</b> will be gone for good. The land returns to the wild. No materials come back.</p>' +
    '<div class="wrow2"><button id="demoGo">Demolish</button><button id="demoNo">Keep it</button></div>', '');
  el('demoGo').onclick = () => { closeOverlays(); P.hs = null; applyHouse(hMe(), null); markDirty(2); if (!OFFLINE && srvBuild >= 6) wsSend([23, 0]); bmOn = 0; say('The house comes down.'); };
  el('demoNo').onclick = closeOverlays;
}
/* land taken at login: our house folds away (the save keeps every room and stick) and the owner chooses —
   move it for free from a small standing bar, or leave it to try the same ground next arrival */
let hsAsked = 0, hsBarEl = null;
function hsBarShow(on) {
  if (!hsBarEl) {
    hsBarEl = div(document.body, 'hsbar', 'Your house is unplaced &nbsp;<button id="hsPlace">Place here</button><button id="hsLater">Later</button>');
    hsBarEl.style.cssText = 'position:fixed;left:50%;top:12px;transform:translateX(-50%);z-index:6;padding:6px 10px;background:#1d1a14e6;border:1px solid #6b5a34;font:inherit;font-size:11px';
    el('hsPlace').onclick = hsTryHere;
    el('hsLater').onclick = () => { hsBarShow(0); say('Your house waits below the soil; it will try its old land when next you arrive.'); };
  }
  hsBarEl.style.display = on ? '' : 'none';
}
function hsYield() {
  applyHouse(hMe(), null);   // only the standing shape folds; P.hs is untouched
  if (!OFFLINE && srvBuild >= 6) wsSend([23, 0]);   // retract our hello announce from the room
  if (hsAsked) { hsBarShow(1); return say('Another house stands on your land; yours folds away again.', 'bad'); }   // the popup is spent: the bar alone carries the choice
  hsAsked = 1;
  showModal('Your land is taken',
    '<p class="smsg">Another adventurer\'s house stands where yours would rise. Nothing is lost — <b>every room and furnishing</b> rests safe in your save.</p>' +
    '<p class="smsg">Move it now for free, keeping all of it, or leave it: it will try the same land when next you arrive.</p>' +
    '<div class="wrow2"><button id="hsMoveGo">Move it (free)</button><button id="hsStay">Leave it</button></div>', '');
  el('hsMoveGo').onclick = () => { closeOverlays(); hsBarShow(1); hsHintShow(P.hs.rm, 0); say('Stand where the house should rise and press Place here.', 'lv'); };
  el('hsStay').onclick = () => { closeOverlays(); say('Your house waits below the soil; it will try the same land when next you arrive.'); };
}
/* moving (free after a conflict, or by spending a deed): the claim's ground rules, measured over the ACTUAL rooms.
   The layout tries the land exactly as it stands on the map; only if that fails do the other three quarter-turns
   try in random order (doors and furniture turn with the walls) before giving up. */
const hsSpin = rm => rm.map(r => [r[0], -r[2], r[1], (r[3] + 1) & 3, r[4]]);   // one quarter-turn CCW: the east wing walks to north
/* The hint scan sweeps 529 candidate lots whose room rings overlap, so the same tiles are asked for again and again —
   tens of thousands of heightAt calls in one blocking frame. A memo lives only for the length of a scan, so nothing
   can go stale underneath it. */
let _hfC = null;
const hFy = (k, x, z) => { if (!_hfC) return heightAt(x, z); let y = _hfC.get(k); if (y === undefined) _hfC.set(k, y = heightAt(x, z)); return y; };
function hsFit(rm, x0, z0, e, coarse) {   // a refusal string, or { y, felled }; coarse samples every third tile for the hint scan
  if (hBlocked({ x: x0, z: z0, rm }, hMe(), e)) return 'Another house stands too near.';
  if (wildLvAt(x0, z0)) return 'The Wilderness holds no ground for a home.';
  let lo = 1e9, hi = -1e9, felled = 0;
  const st = coarse ? 3 : 1;
  for (const r of rm) for (let a = -1; a <= RS; a += st) for (let b = -1; b <= RS; b += st) {   // each room and a doorstep ring
    const x = x0 + r[1] * RS + a, z = z0 + r[2] * RS + b, k = tk(x, z), y = hFy(k, x, z);
    if (y < 1.2) return 'The lot runs into water.';
    if (floorMap.has(k) && floorMap.get(k).house !== hMe()) return 'Something else already stands on that ground.';
    if (blocked.has(k)) felled++;
    lo = Math.min(lo, y); hi = Math.max(hi, y);
  }
  return hi - lo > 2.2 ? 'The ground is too uneven to build on. Seek flatter land.' : { y: Math.round(hi * 4) / 4, felled };
}
function hsMoveTo(spin) {   // place the whole house at the player's feet; 1 on success
  const h = P.hs;
  if (!h) { hsBarShow(0); return 0; }
  if (inDunPlane(P.tz)) { say('No deed covers the underworld.', 'bad'); return 0; }
  const nv = nearVillage(P.tx, P.tz);
  if (nv && nv.d < nv.v.r * 1.6) { say('Too close to town: the guilds keep this land.', 'bad'); return 0; }
  if (highwayAt(P.tx, P.tz) > 0.15) { say("You cannot build on the king's road.", 'bad'); return 0; }
  const x0 = P.tx - (RS >> 1), z0 = P.tz - (RS >> 1);
  let lay = h.rm, fit = hsFit(lay, x0, z0, 0);
  if (typeof fit === 'string' && spin) for (const k of [1, 2, 3].sort(() => Math.random() - 0.5)) {
    let rm2 = h.rm; for (let i = 0; i < k; i++) rm2 = hsSpin(rm2);
    const f2 = hsFit(rm2, x0, z0, 0);
    if (typeof f2 !== 'string') { lay = rm2; fit = f2; say('The house turns a little to take the land.'); break; }
  }
  if (typeof fit === 'string') { say(fit, 'bad'); hsHintShow(h.rm, 0); return 0; }
  if (fit.felled) say('The builders clear ' + fit.felled + ' trees and stones as the walls rise.');
  h.x = x0; h.z = z0; h.y = fit.y; h.rm = lay; h.rev = (h.rev || 0) + 1;
  applyHouse(hMe(), h);
  markDirty(1);
  if (!OFFLINE && srvBuild >= 6) wsSend([23, h]);
  hsBarShow(0); hsHintClear();
  say('Your house settles on this land, every room and stick of it.', 'lv');
  return 1;
}
const hsTryHere = () => { hsMoveTo(1); };
/* the ground speaks: after a refused placement, green pads mark every nearby spot that takes the house (or, for a fresh
   claim, a full nine-room lot). The scan samples coarsely — a rare false pad simply refuses again with fresh hints. */
const H33 = []; for (let gx = -1; gx <= 1; gx++) for (let gz = -1; gz <= 1; gz++) H33.push([0, gx, gz, 0, []]);
let hintMesh = null, hintT = 0;
function hsHintClear() { if (hintMesh) { scene.remove(hintMesh); hintMesh.geometry.dispose(); hintMesh.material.dispose(); hintMesh = null; } }
function hsHintShow(rm, e) {
  hsHintClear();
  const pads = [];
  _hfC = new Map();   // one memo for the whole sweep
  for (let dx = -44; dx <= 44; dx += 4) for (let dz = -44; dz <= 44; dz += 4) {
    const cx = P.tx + dx, cz = P.tz + dz;
    if (inDunPlane(cz)) continue;
    const nv = nearVillage(cx, cz);
    if (nv && nv.d < nv.v.r * 1.6) continue;
    if (highwayAt(cx, cz) > 0.15) continue;
    const f = hsFit(rm, cx - (RS >> 1), cz - (RS >> 1), e, 1);
    if (typeof f !== 'string') pads.push([cx, cz, f.y]);
  }
  _hfC = null;   // the memo dies with the sweep
  if (!pads.length) return say('No open ground within sight takes the house; wander further and try again.', 'bad');
  hintMesh = new THREE.Mesh(merge(pads.map(([x, z, y]) => tint(box(3.2, 0.24, 3.2), [0.27, 0.85, 0.45]).translate(x, y + 0.4, z))),
    new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.5, depthWrite: false, fog: false }));
  hintMesh.renderOrder = 5;
  scene.add(hintMesh);
  hintT = tickN + 40;   // the pads outlive the moment by ~24 s, or until a placement lands
  say('Green pads mark ground that takes the house: stand on one and place.', 'lv');
}
function hsNo(msg) { say(msg, 'bad'); hsHintShow(H33, 1); } // a refused fresh claim hints with the full nine-room lot
tickHooks.push(() => { if (hintMesh && tickN > hintT) hsHintClear(); });
/* the fixtures a house offers */
OBJ_OPTS[20] = ['Rest at', 'Bed', o => { if (o.house !== hMe()) return say('That is not your bed.'); P.home.x = o.x; P.home.z = o.z; markDirty(1); say('Home is where this bed stands: death and the home teleport return here.', 'lv'); }];
OBJ_OPTS[21] = ['Light', 'Incense burner', o => {
  if (!invCount('tinderbox')) return say('You need a tinderbox.', 'bad');
  if (!invCount('marrentill')) return say('You need a clean marrentill to burn.', 'bad');
  invRemove('marrentill', 1);
  const fm = lvl[SK.firemaking];
  litMap.set(o.lk, tickN + 200 + fm + randInt(0, Math.max(0, fm - 1)));   // the wiki's burner clock: 200 + FM + rand(FM)
  const hr = housesReg.get(o.house);
  say('The burner takes the flame; sweet smoke fills the room.', 'lv');
  if (hr) { const src = o.house === hMe() ? P.hs : hr.h; if (src) applyHouse(o.house, src); }
}];
OBJ_OPTS[22] = ['Search', 'Tool store', () => {
  let got = 0;
  for (const t of ['hammer', 'saw']) if (!invCount(t) && invAdd(t, 1)) got = 1;
  say(got ? 'You take a hammer and saw from the store.' : 'Every slot of it is tools you already have.');
}];
/* the Build button lives by the minimap whenever you stand on your own floor */
const bmBtn = document.createElement('button');
bmBtn.id = 'bmBtn'; bmBtn.textContent = 'Build';
bmBtn.style.cssText = 'position:fixed;right:12px;top:150px;display:none;z-index:5;padding:6px 14px;font:inherit;cursor:pointer';
document.body.appendChild(bmBtn);
bmBtn.onclick = () => { bmOn ^= 1; bmBtn.classList.toggle('on', !!bmOn); moveSel = null; if (P.hs) applyHouse(hMe(), P.hs); say(bmOn ? 'Building mode: click the yellow posts.' : 'Building mode off.'); };
tickHooks.push(() => {
  const inMine = indoors && indoors.house === hMe();
  bmBtn.style.display = inMine || (bmOn && P.hs) ? '' : 'none';
  if (bmOn && !P.hs) { bmOn = 0; refreshGhosts(); }
});
const POOL_GH = Pool(merge([shade(cyl(0.05, 0.07, 1.0, 4).translate(0, 0.5, 0), [0.2, 0.2, 0.2]), shade(octa(0.3).translate(0, 1.15, 0), WHITE)]), 96, 1);
POOLS.push(POOL_GH);
poolHooks.push(t => { if (bmOn) for (const g of hghosts) poolPut(POOL_GH, g.x, g.y, g.z, t * 1.4, 0.9 + Math.sin(t * 4 + g.x) * 0.08, 1, 0.9, g.gk === 'rem' ? 0xd83a2a : g.gk === 'furn' ? 0xffe14a : 0x4ad8ff); });

/* ---- DUNGEONS: every castle's black door opens on one. They live on a far band of the same plane (z > 500000, inside the
   wire clamp), so chunks, walls-as-terrain, pathing, the minimap, depletion sync and multiplayer all come along for free.
   Each dungeon is a pure function of its city: same door, same maze, forever; different doors, wildly different halls. ---- */
const DUN_Z = 524288, DUN_MIN = 500000;
const inDunPlane = z => z > DUN_MIN;
/* the dungeon a castle owns: sized and powered off the city's ground, themed by hash from what that power allows */
function dunOf(v) {
  if (v.dun) return v.dun;
  const h = hash2(v.x, v.z, S + 700);
  const pw = powerAt(v.x, v.z) * 1.1 + 0.35 + ((h >>> 20) & 63) / 64 * 0.9;   // strictly meaner than the streets above
  const cx = Math.floor(v.x * INV_CELL), cz = Math.floor(v.z * INV_CELL);
  let near2 = 1e9;   // two courts must never overlap: size is capped by the nearest castle
  for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
    if (!a && !b) continue;
    const q = villageAt(cx + a, cz + b);
    if (q && q.rank >= 3) near2 = Math.min(near2, Math.hypot(q.x - v.x, q.z - v.z));
  }
  const E = Math.max(44, Math.min(Math.floor(near2 / 2) - 6, 56 + ((h >>> 8) & 3) * 10 + Math.round(Math.min(14, pw * 6))));
  const pool = DUN_THEMES.filter(t => pw >= t.min);
  const th = pool[(h >>> 13) % pool.length];
  return v.dun = { v, ox: v.x, oz: v.z + DUN_Z, seed: h, E, pw, th, name: 'The ' + villageName(v).split(' ').pop() + ' ' + th.pl };
}
/* ---- WILDERNESS CAVES: the rings keep their own doors down — a gaping cave mouth or a half-buried trapdoor on a
   288-tile lattice, each owning a dungeon like a castle does. Only these dungeons raise the wilderness masters. ---- */
const WILD_BS = ['callisto', 'venenatis', 'vetion', 'scorpia', 'kbd'];
for (const k of WILD_BS) if (NPC_BY[k]) NPC_BY[k].wildOnly = 1;   // and nowhere above ground or under a city
const CAVE_CELL = 288, caveCache = new Map();
function caveAt(gx, gz) {
  if (caveCache.S !== S) { caveCache.clear(); caveCache.S = S; }
  const key = gx * 8191 + gz;
  let c = caveCache.get(key);
  if (c !== undefined) return c;
  c = null;
  const h = hash2(gx * 9 + 2, gz * 7 + 4, S + 810);
  if (gz * CAVE_CELL > 499000 - CAVE_CELL || h % 100 >= 52) { caveCache.set(key, c); return c; }
  for (let i = 0; i < 8 && !c; i++) {
    const hh = hash2(gx * 23 + i, gz * 19 - i, S + 811 + i);
    const x = gx * CAVE_CELL + 20 + hh % (CAVE_CELL - 40), z = gz * CAVE_CELL + 20 + (hh >>> 9) % (CAVE_CELL - 40);
    const y = heightAt(x, z);
    if (y < 2.2 || y > 55 || wildLvAt(x, z) < 3) continue;   // a door well inside the wilds, on ground firm enough to hold it
    let vNear = 0;   // never under a castle's court: their dungeons must not overlap
    const cx2 = Math.floor(x * INV_CELL), cz2 = Math.floor(z * INV_CELL);
    for (let a = -1; a <= 1 && !vNear; a++) for (let b = -1; b <= 1; b++) { const v = villageAt(cx2 + a, cz2 + b); if (v && v.rank >= 3 && Math.hypot(v.x - x, v.z - z) < 260) { vNear = 1; break; } }
    if (vNear) continue;
    const sp = spanHeights(x, z, 3, 2, (px, pz, py) => py >= 1.8);
    if (!sp || sp.hi - sp.lo > 2.4) continue;
    c = { x, z, y, k: (h >>> 5) & 1, gx, gz, dun: null };   // k: a yawning cave mouth, or a trapdoor in the ash
  }
  caveCache.set(key, c);
  return c;
}
function caveDun(c) {
  if (c.dun) return c.dun;
  const h = hash2(c.x, c.z, S + 700);
  const pw = powerAt(c.x, c.z) * 1.05 + 0.3 + ((h >>> 20) & 63) / 64 * 0.8;
  let near2 = 1e9;
  for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
    if (!a && !b) continue;
    const q = caveAt(c.gx + a, c.gz + b);
    if (q) near2 = Math.min(near2, Math.max(Math.abs(q.x - c.x), Math.abs(q.z - c.z)));   // the halls are square, so the cap is measured square
  }
  const E = Math.max(16, Math.min(Math.floor(near2 / 2) - 4, 52 + ((h >>> 8) & 3) * 8 + Math.round(Math.min(12, pw * 5))));   // the floor used to override the cap, so two neighbouring caves could overlap
  const pool = DUN_THEMES.filter(t => pw >= t.min), th0 = pool[(h >>> 13) % pool.length];
  return c.dun = { v: { x: c.x, z: c.z }, cave: c, ox: c.x, oz: c.z + DUN_Z, seed: h, E, pw,
    th: Object.assign({}, th0, { bs: WILD_BS }), name: 'The ' + wordOf(h, regionAt(c.x, c.z).a) + ' ' + th0.pl };
}
/* which dungeon owns a plane tile: the mirrored surface cell scan — castles first, then the wilderness doors — memoised per tile */
let _dfx = 1e9, _dfz = 1e9, _dfd = null;
function dunFor(x, z) {
  const tx = Math.round(x), tz = Math.round(z);
  if (tx === _dfx && tz === _dfz) return _dfd;
  _dfx = tx; _dfz = tz; _dfd = null;
  const cx = Math.floor(tx * INV_CELL), cz = Math.floor((tz - DUN_Z) * INV_CELL);
  for (let a = -1; a <= 1 && !_dfd; a++) for (let b = -1; b <= 1; b++) {
    const v = villageAt(cx + a, cz + b);
    if (!v || v.rank < 3) continue;
    const d = dunOf(v);
    if (Math.abs(tx - d.ox) <= d.E && Math.abs(tz - d.oz) <= d.E) { _dfd = d; break; }
  }
  if (!_dfd) {
    const kx = Math.floor(tx / CAVE_CELL), kz = Math.floor((tz - DUN_Z) / CAVE_CELL);
    for (let a = -1; a <= 1 && !_dfd; a++) for (let b = -1; b <= 1; b++) {
      const c = caveAt(kx + a, kz + b);
      if (!c) continue;
      const d = caveDun(c);
      if (Math.abs(tx - d.ox) <= d.E && Math.abs(tz - d.oz) <= d.E) { _dfd = d; break; }
    }
  }
  return _dfd;
}
/* the maze: an organic outline of hashed radii, big chambers, wide corridors, and a braided labyrinth filling the rock between */
function layoutDun(d) {
  if (d.G) return d;
  const E = d.E, W = E * 2 + 1, G = new Uint8Array(W * W), h0 = d.seed;
  let rs = h0 | 0;   // a private LCG, so every client deals the same cards in the same order
  const rnd = () => (rs = (Math.imul(rs, 1103515245) + 12345) | 0, (rs >>> 16) / 65536);
  // 0. the outline: twelve hashed radii swept smoothly round the compass — no two dungeons share a silhouette
  const CRN = 12, CR = Array.from({ length: CRN }, () => E * (0.62 + rnd() * 0.36));
  const radAt = (dx, dz) => {
    const a = (Math.atan2(dz, dx) + PI) / TAU * CRN, i0 = Math.floor(a) % CRN, t = a - Math.floor(a), s = (1 - Math.cos(t * PI)) / 2;
    return CR[i0] * (1 - s) + CR[(i0 + 1) % CRN] * s;
  };
  const mask = new Uint8Array(W * W);
  for (let z = 0; z < W; z++) for (let x = 0; x < W; x++) if (Math.hypot(x - E, z - E) <= radAt(x - E, z - E)) mask[z * W + x] = 1;
  const at = (x, z) => (x < 2 || z < 2 || x > W - 3 || z > W - 3) ? 0 : G[z * W + x];
  const set = (x, z, c) => { if (x > 1 && z > 1 && x < W - 2 && z < W - 2 && mask[z * W + x]) G[z * W + x] = c; };
  const set0 = (x, z, c) => { if (x > 1 && z > 1 && x < W - 2 && z < W - 2) G[z * W + x] = c; };   // walls may stand outside the line
  const carve = (x0, z0, w, ht) => { for (let z = z0; z < z0 + ht; z++) for (let x = x0; x < x0 + w; x++) set(x, z, 2); };
  const inMask = (x, z) => x > 1 && z > 1 && x < W - 2 && z < W - 2 && mask[z * W + x];
  // 1. halls: the entry sits just inside the southern edge, the master's hall against the north, big chambers between
  const Rs = radAt(0, -1) | 0, Rn = radAt(0, 1) | 0;
  const enZ = Math.max(4, E - Rs + 4);
  const entry = { x: E, z: enZ + 3 };
  carve(E - 5, enZ, 11, 8);
  const rooms = [entry];
  const boss = { x: E + Math.round((rnd() - 0.5) * E * 0.5), z: E + Rn - 11 };
  while (!inMask(boss.x, boss.z)) boss.x += boss.x > E ? -2 : 2;   // slide the hall along until the outline holds it
  carve(boss.x - 7, boss.z - 7, 15, 15); rooms.push(boss);
  const nR = 10 + Math.floor(rnd() * 6) + ((E - 56) >> 3);
  for (let i = 0; i < nR * 4 && rooms.length < nR + 2; i++) {
    const w = 9 + Math.floor(rnd() * 11), ht = 9 + Math.floor(rnd() * 11);
    const x = 3 + Math.floor(rnd() * (W - w - 6)), z = enZ + 9 + Math.floor(rnd() * Math.max(4, W - ht - enZ - 20));
    if (!inMask(x + (w >> 1), z + (ht >> 1)) || !inMask(x, z) || !inMask(x + w, z + ht)) continue;
    carve(x, z, w, ht); rooms.push({ x: x + (w >> 1), z: z + (ht >> 1) });
  }
  // 2. corridors: three tiles wide as a rule, an L between rooms; pinch-points remembered for obstacles
  const pinches = [];
  const corridor = (a, b, loop) => {
    const wide = rnd() < 0.5 ? 3 : 2;
    const seg = (fx, tx2, fz, tz2, horiz) => { for (let x = Math.min(fx, tx2); x <= Math.max(fx, tx2); x++) for (let z = Math.min(fz, tz2); z <= Math.max(fz, tz2); z++) for (let o = 0; o < wide; o++) set(x + (horiz ? 0 : o), z + (horiz ? o : 0), 2); };
    seg(a.x, b.x, a.z, a.z, 1); seg(b.x, b.x, a.z, b.z, 0);
    pinches.push({ x: Math.round((a.x + b.x) / 2), z: a.z, hx: 1, wide, loop });
    pinches.push({ x: b.x, z: Math.round((a.z + b.z) / 2), hx: 0, wide, loop });
  };
  const done = [rooms[0]], todo = rooms.slice(1);
  while (todo.length) {   // nearest-neighbour chain keeps halls local
    let bi = 0, bj = 0, bd = 1e9;
    done.forEach((a, i2) => todo.forEach((b, j) => { const dd = Math.abs(a.x - b.x) + Math.abs(a.z - b.z); if (dd < bd) { bd = dd; bi = i2; bj = j; } }));
    corridor(done[bi], todo[bj], 0);
    done.push(todo.splice(bj, 1)[0]);
  }
  for (let i = 0; i < (nR >> 1) + 2; i++) corridor(rooms[Math.floor(rnd() * rooms.length)], rooms[Math.floor(rnd() * rooms.length)], 1);
  // 3. the labyrinth: a braided maze fills the rock between the halls — three-tile walkways on a four-tile pitch
  const MP = 4, MB = 3, MC = Math.floor((W - 4) / MP), cOpen = new Uint8Array(MC * MC);   // bit 1 E open, bit 2 S open, bit 4 visited
  const cSolid = (i, j) => {
    for (let z = 2 + j * MP; z < 2 + j * MP + MB; z++) for (let x = 2 + i * MP; x < 2 + i * MP + MB; x++) { const q = z * W + x; if (G[q] || !mask[q]) return 0; }
    return 1;
  };
  const stack = [];
  for (let sj = 0; sj < MC; sj++) for (let si = 0; si < MC; si++) {
    if (!cSolid(si, sj) || (cOpen[sj * MC + si] & 4)) continue;
    stack.length = 0; stack.push([si, sj]); cOpen[sj * MC + si] |= 4;   // a fresh island of rock: wander it out
    while (stack.length) {
      const [i2, j2] = stack[stack.length - 1], dirs = [];
      for (const [dx2, dz2] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const ni = i2 + dx2, nj = j2 + dz2;
        if (ni >= 0 && nj >= 0 && ni < MC && nj < MC && cSolid(ni, nj) && !(cOpen[nj * MC + ni] & 4)) dirs.push([dx2, dz2, ni, nj]);
      }
      if (!dirs.length) { stack.pop(); continue; }
      const [dx2, dz2, ni, nj] = dirs[Math.floor(rnd() * dirs.length)];
      cOpen[(dz2 > 0 ? j2 : dz2 < 0 ? nj : Math.min(j2, nj)) * MC + (dx2 > 0 ? i2 : dx2 < 0 ? ni : Math.min(i2, ni))] |= (dx2 !== 0 ? 1 : 2);
      cOpen[nj * MC + ni] |= 4;
      stack.push([ni, nj]);
    }
  }
  for (let j = 0; j < MC; j++) for (let i = 0; i < MC; i++) {   // carve the visited cells and their openings
    if (!(cOpen[j * MC + i] & 4)) continue;
    carve(2 + i * MP, 2 + j * MP, MB, MB);
    if (cOpen[j * MC + i] & 1) carve(2 + i * MP + MB, 2 + j * MP, MP - MB, MB);
    if (cOpen[j * MC + i] & 2) carve(2 + i * MP, 2 + j * MP + MB, MB, MP - MB);
  }
  // 4. braid and join: knock through a share of the one-thick walls with floor on both sides, so there is rarely only one way
  for (let z = 3; z < W - 3; z++) for (let x = 3; x < W - 3; x++) {
    if (G[z * W + x] || !mask[z * W + x]) continue;
    const H = at(x - 1, z) === 2 && at(x + 1, z) === 2, V = at(x, z - 1) === 2 && at(x, z + 1) === 2;
    if ((H || V) && rnd() < 0.18) set(x, z, 2);
  }
  // 4b. no hall left behind: anything the entry cannot reach gets a spoke through the centre (a star shape always allows it)
  const seen = new Uint8Array(W * W), q2 = [entry.z * W + entry.x];
  seen[q2[0]] = 1;
  while (q2.length) {
    const c = q2.pop(), x = c % W, z = (c / W) | 0;
    for (const [dx2, dz2] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx2, nz = z + dz2, g = at(nx, nz);
      if ((g === 2 || g === 8) && !seen[nz * W + nx]) { seen[nz * W + nx] = 1; q2.push(nz * W + nx); }
    }
  }
  const C = { x: E, z: E };
  for (const r of rooms) if (!seen[r.z * W + r.x]) { corridor(r, C, 0); corridor(C, entry, 0); }
  for (let z = boss.z - 7; z <= boss.z + 7; z++) for (let x = boss.x - 7; x <= boss.x + 7; x++) if (at(x, z) === 2) set(x, z, 8);
  // 5. obstacles: a wall thrown across a trunk corridor with one barred gap — the labyrinth always offers a way round
  d.obs = [];
  for (const m of pinches) {
    if (d.obs.length >= 3 + (E >> 4)) break;
    if (Math.hypot(m.x - entry.x, m.z - entry.z) < 12 || Math.hypot(m.x - boss.x, m.z - boss.z) < 10) continue;
    if (d.obs.some(o => Math.abs(o.gx - m.x) + Math.abs(o.gz - m.z) < 10)) continue;
    if (rnd() > (m.loop ? 0.6 : 0.45)) continue;
    const ax = m.hx ? 1 : 0, az = m.hx ? 0 : 1;   // corridor axis; the pinch wall runs across it
    let ok = at(m.x - ax, m.z - az) === 2 && at(m.x + ax, m.z + az) === 2 && at(m.x, m.z) === 2;
    for (let o = 1; o < m.wide && ok; o++) ok = at(m.x + az * o, m.z + ax * o) === 2;
    if (!ok) continue;
    const kind = m.loop ? 5 : 4;
    set(m.x, m.z, kind);
    for (let o = 1; o < m.wide; o++) set(m.x + az * o, m.z + ax * o, 1);
    d.obs.push({ gx: m.x, gz: m.z, t: kind, hx: ax });
  }
  // 6. ore against the walls
  for (let i = 0, want = 5 + (E >> 4); i < 260 && want > 0; i++) {
    const x = 3 + Math.floor(rnd() * (W - 6)), z = 3 + Math.floor(rnd() * (W - 6));
    if (at(x, z) !== 2) continue;
    const wn = !at(x - 1, z) + !at(x + 1, z) + !at(x, z - 1) + !at(x, z + 1);
    if (!wn) continue;
    if (d.obs.some(o => Math.abs(o.gx - x) + Math.abs(o.gz - z) < 4)) continue;
    set(x, z, 6); want--;
  }
  set0(E, enZ - 2, 7);   // the way back out, cut into the outline's own edge
  set0(E, enZ - 1, 2);
  const w2 = x => d.ox - E + x, w3 = z => d.oz - E + z;
  d.en = { x: w2(E), z: w3(enZ + 1) }; d.ex = { x: w2(E), z: w3(enZ - 2) };
  d.bossAt = { x: w2(boss.x), z: w3(boss.z) };
  d.G = G; d.W = W;
  return d;
}
const dunCode = (d, x, z) => { const gx = Math.round(x) - (d.ox - d.E), gz = Math.round(z) - (d.oz - d.E); return (gx < 0 || gz < 0 || gx >= d.W || gz >= d.W) ? 0 : d.G[gz * d.W + gx]; };
const DUN_FLOOR = 8;
function dunHeight(x, z) {
  const d = dunFor(x, z);
  if (!d) return 46;   // the dark between the halls: sheer rock to every horizon
  layoutDun(d);
  const g = dunCode(d, x, z);
  return g === 0 || g === 1 ? DUN_FLOOR + 9.5 : g === 5 ? DUN_FLOOR + 3.4 : DUN_FLOOR;
}
function dunColor(x, z, h, slope) {
  const d = dunFor(x, z);
  let c;
  if (!d || h > DUN_FLOOR + 6) c = [0.24, 0.22, 0.25];   // wall rock: the steep faces shade themselves down to dusk
  else {
    const g = dunCode(d, x, z), hs = hash2(Math.round(x), Math.round(z), S + 730) & 255;
    c = g === 8 ? [0.36, 0.20, 0.19] : g === 5 ? [0.34, 0.33, 0.31] : d.th.fc;
    if (g === 2 && hs < 7) c = [0.55, 0.52, 0.44];   // old bones on the floor
    else if (g === 2 && hs > 247) c = [0.60, 0.26, 0.08];   // ember glow
  }
  const j = 0.90 + (hash2(Math.round(x * 2), Math.round(z * 2), S + 77) & 255) / 255 * 0.2;
  out[0] = c[0] * j; out[1] = c[1] * j; out[2] = c[2] * j;
  return out;
}
function dunPower(x, z) {
  const d = dunFor(x, z);
  return d ? d.pw + 0.4 * Math.min(1, Math.hypot(x - d.en.x, z - d.en.z) / (d.E * 1.6)) : 3;   // deeper halls bite harder
}
const dunVein = (x, z) => { const d = dunFor(x, z); if (!d || dunCode(d, x, z) !== 6) return -1; return d.pw < 0.6 ? 3 : d.pw < 1.1 ? 4 : d.pw < 1.8 ? 5 : 6; };
function dunSnap(x, z) {   // deterministic: every client walks the same spiral to the same floor tile
  const d = dunFor(x, z);
  if (!d || !layoutDun(d)) return null;
  for (let r = 0; r <= 7; r++) for (let i = -r; i <= r; i++) for (let j = -r; j <= r; j++) {
    if (Math.max(Math.abs(i), Math.abs(j)) !== r) continue;
    const g = dunCode(d, x + i, z + j);
    if (g === 2 || g === 8) return { x: x + i, z: z + j };
  }
  return null;
}
/* the theme's own spawn lottery, aimed a step above the surface's target for this power */
function dunTab(d) {
  if (d.tab) return d.tab;
  const target = Math.max(5, SPAWN_MAXLV * Math.tanh(4 * Math.pow(1 + d.pw, 3) / SPAWN_MAXLV) * 1.25);
  const ks = new Set(d.th.ks);
  let sum = 0;
  const cum = [], types = [];
  for (const q of SPAWNABLE) {
    if (!ks.has((q.base || q).k)) continue;
    const r = Math.log(q.lv / target), sg = r < 0 ? 0.8 : 0.5;
    sum += q.vw / Math.pow(1 + Math.pow(r / sg, 2), 2);
    cum.push(sum); types.push(q);
  }
  return d.tab = types.length ? { cum, types, sum } : spawnTable(d.pw + 0.5, 0);
}
function dunPick(d, h) {
  const t = dunTab(d);
  if (!t.sum) return null;
  const u = ((h >>> 11) & 1048575) / 1048576 * t.sum, c = t.cum;
  let lo = 0, hi = c.length - 1;
  while (lo < hi) { const m = (lo + hi) >> 1; if (c[m] < u) lo = m + 1; else hi = m; }
  return t.types[lo];
}
/* doors: the castle's black door goes down, the standing door below comes back up */
MK_ART[23] = ['lock', '#0a0a0e', '#b8b0a0', 'Dungeon'];
MK_ART[25] = ['wheat', '#d8c05a', '#8a7a2a', 'Windmill'];
PICK_R[23] = 1.9; PICK_Y[23] = 1.5;   // the pick tables end at t16: without these the door cannot be clicked at all
PICK_R[24] = 1.4; PICK_Y[24] = 1.2;
function enterDun(o) {
  let d;
  if (o.cv) d = layoutDun(caveDun(o.cv));   // a wilderness door goes down into its own dark
  else {
    const nv = nearVillage(o.x, o.z);
    if (!nv || nv.v.rank < 3) return say('The door refuses to open.');
    d = layoutDun(dunOf(nv.v));
  }
  P.dunRet = { x: o.x, z: o.z };   // the daylight side of the door: every teleport below reckons from here
  markDirty();
  sfx(62); setTimeout(() => sfx(60, 0.8), 800);   // the door swings, and shuts behind you
  teleport(d.en.x, d.en.z, 400);
  say((o.cv ? 'You climb down into ' : 'You step through the black door, down into ') + d.name + '.', 'lv');
  say('The dark presses close. Everything here means you harm.', 'bad');
  if (d.cave) say('The Wilderness follows you below: other players can reach you here.', 'bad');
}
function leaveDun(o) {
  const d = dunFor(o.x, o.z);
  if (!d) return;
  let spot;
  if (d.cave) spot = openNear(d.cave.x + 2, d.cave.z + 2, 6);   // back out into the ash beside the mouth
  else {
    villageBuildings(d.v);
    const c = d.v.keep, k = c.hall;
    spot = openNear(Math.round(k.x + DDX[c.gate] * (k.w / 2 + 2)), Math.round(k.z + DDZ[c.gate] * (k.d / 2 + 2)), 4);
  }
  if (spot) { sfx(62); setTimeout(() => sfx(60, 0.8), 800); teleport(spot.x, spot.z, 400); say('You climb back into the daylight.'); }
}
OBJ_OPTS[23] = o => [{ t: o.k ? 'Leave' : 'Enter', o: 'Dungeon', f: act(o, o.k ? leaveDun : enterDun) }];
OBJ_OPTS[24] = ['Slash', 'Web', o => {
  if (!eq.weapon && !invCount('knife')) return say('You need a blade to cut through it.', 'bad');
  deplete(o, 1500);
  unblock(o.key);
  say('You slash the web apart.');
  const key = ck(Math.floor(o.x / CHUNK), Math.floor(o.z / CHUNK)), rec = chunks.get(key);   // rebake so the strands fall away
  if (rec) { disposeChunk(rec); chunks.delete(key); refresh(); }
}];
const webCleared = key => { const w = dunWebs.get(key); if (w) { unblock(key); const k2 = ck(Math.floor(w.x / CHUNK), Math.floor(w.z / CHUNK)), rec = chunks.get(k2); if (rec) { disposeChunk(rec); chunks.delete(k2); refresh(); } } };
/* the wilderness doors above ground: a rock maw or a half-buried trapdoor, each the same Enter a castle's black door gives */
structHooks.push((rec, vs, inChunk) => {
  const oz = rec.cz * CHUNK;
  if (inDunPlane(oz)) return;
  const gx0 = Math.floor(rec.cx * CHUNK / CAVE_CELL), gz0 = Math.floor(oz / CAVE_CELL);
  for (let a = 0; a <= 1; a++) for (let b = 0; b <= 1; b++) {
    const c = caveAt(gx0 + a, gz0 + b);
    if (!c || !inChunk(c.x, c.z)) continue;
    rec.objs.push({ t: 23, k: 0, x: c.x, z: c.z, y: c.y, key: tk(c.x, c.z), n: 'Dungeon', cv: c });
    batchInto(rec, B => {
      if (c.k === 0) {   // the maw: scorched rock heaped over a black mouth that faces south
        for (let i = 0; i < 7; i++) { const a2 = (i + 0.5) / 7 * PI + PI; B.add(BLOB, c.x + Math.sin(a2) * 2.4, c.y + 0.7, c.z + Math.cos(a2) * 2.0 - 0.4, 2.0, 2.1 - Math.abs(Math.sin(a2)) * 0.7, 2.0, a2, [0.16, 0.145, 0.135]); }
        B.add(BLOB, c.x, c.y + 2.0, c.z - 1.0, 3.6, 1.8, 3.0, 0, [0.13, 0.12, 0.11]);
        B.add(BOX, c.x, c.y + 0.8, c.z + 0.4, 2.0, 1.6, 1.0, 0, C_DARK);
        for (const [dx2, dz2] of [[-1, -1], [0, -1], [1, -1], [-2, 0], [2, 0]]) rec.blk.push(tk(c.x + dx2, c.z + dz2));
      } else {   // the trapdoor: a framed hatch flush with the ash, iron ring and all
        B.add(BOX, c.x, c.y + 0.10, c.z, 2.3, 0.22, 2.3, 0, BARK2);
        B.add(BOX, c.x, c.y + 0.18, c.z, 1.6, 0.14, 1.6, 0, C_DARK);
        B.add(BOX, c.x + 0.45, c.y + 0.28, c.z, 0.42, 0.1, 0.18, 0, C_STONE2);
      }
    });
  }
});
/* ---- BRIDGES: now and then a plank crossing over a narrow water — or, in the wilds, over lava — where both banks
   agree. A sparse lattice keeps them rare enough to matter; the deck rides the floor map, so it simply walks. ---- */
const BRIDGE_CELL = 176, bridgeCache = new Map();
function bridgeAt(gx, gz) {
  if (bridgeCache.S !== S) { bridgeCache.clear(); bridgeCache.S = S; }
  const key = gx * 8191 + gz;
  let c = bridgeCache.get(key);
  if (c !== undefined) return c;
  c = null;
  const h = hash2(gx * 11 + 6, gz * 13 + 2, S + 820);
  const wildC = wildLvAt(gx * BRIDGE_CELL + 88, gz * BRIDGE_CELL + 88) > 0;   // the wilds bridge their lava more eagerly than the safelands their brooks
  if (gz * BRIDGE_CELL > 499000 - BRIDGE_CELL || h % 100 >= (wildC ? 74 : 55)) { bridgeCache.set(key, c); return c; }
  for (let i = 0; i < 14 && !c; i++) {
    const hh = hash2(gx * 37 + i, gz * 41 - i, S + 821 + i);
    const ax = gx * BRIDGE_CELL + 12 + hh % (BRIDGE_CELL - 24), az = gz * BRIDGE_CELL + 12 + (hh >>> 9) % (BRIDGE_CELL - 24);
    const dx = (hh >>> 20) & 1 ? 1 : 0, dz = 1 - dx;
    let bank = null, w = 0;   // walk the axis: firm bank, a 3-12 tile channel, firm bank again
    for (let k2 = 0; k2 < 30; k2++) {
      const x = ax + dx * k2, z = az + dz * k2, y = heightAt(x, z);
      if (y >= SEA) { if (w) { if (w >= 3 && w <= 12 && bank) { const hA = heightAt(bank.x, bank.z), hB = y; const dy = clamp((hA + hB) / 2, 1.1, 2.6);
          if (hA > 1.2 && hA < 3.4 && hB > 1.2 && hB < 3.4 && Math.abs(hA - dy) <= 1.1 && Math.abs(hB - dy) <= 1.1) { c = { x: bank.x, z: bank.z, dx, dz, len: w, y: dy }; } }
          break; }
        bank = { x, z }; }
      else { if (!bank) break; w++; }
    }
    if (c) {
      const nv = nearVillage(c.x, c.z);
      if ((nv && nv.d < nv.v.r * 1.05) || onDitchBank(c.x, c.z)) c = null;   // towns build their own; the ditch line stays bare
    }
  }
  bridgeCache.set(key, c);
  return c;
}
structHooks.push((rec, vs, inChunk) => {
  if (inDunPlane(rec.cz * CHUNK)) return;
  const gx0 = Math.floor(rec.cx * CHUNK / BRIDGE_CELL), gz0 = Math.floor(rec.cz * CHUNK / BRIDGE_CELL);
  for (let a = 0; a <= 1; a++) for (let b2 = 0; b2 <= 1; b2++) {
    const b = bridgeAt(gx0 + a, gz0 + b2);
    if (!b || !inChunk(b.x, b.z)) continue;
    batchInto(rec, B => emitBridge(B, b, rec));
  }
});
/* a plank bridge: deck, rails and posts from one bank tile across len water tiles; the deck registers as a floor so walking just works */
function emitBridge(B, b, rec) {
  const wild = wildLvAt(b.x, b.z) > 0, deckC = wild ? [0.30, 0.24, 0.20] : C_FLOOR, railC = wild ? [0.20, 0.17, 0.15] : C_BEAM;
  const dk = { y: b.y - FLOOR_TOP, deck: 1 };
  {
    {
      for (let q = 1; q <= b.len; q++) {
        const px = b.x + b.dx * q, pz = b.z + b.dz * q;
        floorMap.set(tk(px, pz), dk);
        B.add(BOX, px, b.y - 0.1, pz, b.dx ? 1.04 : 1.6, 0.18, b.dx ? 1.6 : 1.04, 0, deckC);
        for (const sg of [-1, 1]) {
          B.add(BOX, px + (b.dz ? sg * 0.72 : 0), b.y + 0.5, pz + (b.dx ? sg * 0.72 : 0), b.dx ? 1.06 : 0.12, 0.1, b.dx ? 0.12 : 1.06, 0, railC);
          if (q & 1) {
            B.add(BOX, px + (b.dz ? sg * 0.68 : 0), b.y - 0.9, pz + (b.dx ? sg * 0.68 : 0), 0.2, 2.0, 0.2, 0, railC);
            B.add(BOX, px + (b.dz ? sg * 0.72 : 0), b.y + 0.22, pz + (b.dx ? sg * 0.72 : 0), 0.13, 0.55, 0.13, 0, railC);
          }
        }
      }
      B.add(BOX, b.x, heightAt(b.x, b.z) + 0.1, b.z, 1.4, 0.2, 1.4, 0, C_STONE2);   // a stone step at each end
      const ex = b.x + b.dx * (b.len + 1), ez = b.z + b.dz * (b.len + 1);
      B.add(BOX, ex, heightAt(ex, ez) + 0.1, ez, 1.4, 0.2, 1.4, 0, C_STONE2);
    }
  }
}
const dunWebs = new Map();   // web tile key -> {x, z}: so a slash heard over the wire opens the way here too
/* fixtures into the chunks: the way out, webs that bar and boulders to squeeze past */
structHooks.push((rec, vs, inChunk) => {
  const oz = rec.cz * CHUNK;
  if (!inDunPlane(oz + CHUNK)) return;
  let d = null;
  for (const [px, pz] of [[16, 16], [1, 1], [30, 1], [1, 30], [30, 30]]) { d = dunFor(rec.cx * CHUNK + px, oz + pz); if (d) break; }
  if (!d) return;
  layoutDun(d);
  const B = [];
  if (inChunk(d.ex.x, d.ex.z)) {
    rec.objs.push({ t: 23, k: 1, x: d.ex.x, z: d.ex.z, y: DUN_FLOOR, key: tk(d.ex.x, d.ex.z), n: 'Dungeon exit' });
    B.push(['door', d.ex.x, d.ex.z]);
  }
  for (const ob of d.obs) {
    const x = d.ox - d.E + ob.gx, z = d.oz - d.E + ob.gz;
    if (!inChunk(x, z)) continue;
    const key = tk(x, z);
    if (ob.t === 4) {
      if (!depleted.has(key)) { rec.blk.push(key); rec.objs.push({ t: 24, k: 0, x, z, y: DUN_FLOOR, key, n: 'Web', noMark: 1 }); dunWebs.set(key, { x, z }); B.push(['web', x, z, ob.hx]); }
    } else {
      const lv = clamp(Math.round(6 + d.pw * 16), 1, 75);
      rec.objs.push({ t: 16, k: 2, x, z, y: DUN_FLOOR + 1.6, key, n: 'Narrow gap', lv, xp: lv * 1.4 + 6, noMark: 1,
        ax: x - ob.hx, az: z - (1 - ob.hx), bx: x + ob.hx, bz: z + (1 - ob.hx) });
    }
  }
  if (B.length) batchInto(rec, W2 => { for (const [t, x, z, hx] of B) {
    if (t === 'door') { W2.add(BOX, x, DUN_FLOOR + 1.5, z, 2.2, 3.4, 0.5, 0, C_DARK); W2.add(BOX, x, DUN_FLOOR + 3.3, z, 3.0, 0.5, 0.9, 0, C_STONE2); for (const s of [-1, 1]) W2.add(BOX, x + s * 1.35, DUN_FLOOR + 1.6, z, 0.55, 3.2, 0.9, 0, C_STONE2); }
    else { const a = hx ? 0 : PI / 2; W2.add(BOX, x, DUN_FLOOR + 1.5, z, 0.16, 3.0, 2.6, a, [0.88, 0.88, 0.84]); W2.add(BOX, x, DUN_FLOOR + 1.5, z, 0.16, 2.6, 3.0, a + PI / 4, [0.80, 0.80, 0.76]); W2.add(BOX, x, DUN_FLOOR + 1.5, z, 0.16, 2.6, 3.0, a - PI / 4, [0.80, 0.80, 0.76]); }
  } });
});
/* the sky follows you down: near-black, close fog; applyOpts re-asserts it after any settings change */
let dunSkyOn = 0;
function dunSky() {
  renderer.setClearColor(new THREE.Color(0x0d0c14));
  if (scene.fog) { scene.fog.color.setHex(0x0d0c14); scene.fog.near = 30; scene.fog.far = 110; }
}
tickHooks.push(() => {
  const on = inDunPlane(P.tz) ? 1 : 0;
  if (on === dunSkyOn) return;
  dunSkyOn = on;
  if (on) dunSky(); else { applyOpts(); P.dunRet = null; }
});
/* while below ground, anything that hunts for "the nearest" measures from the daylight side: the remembered door,
   else the castle that owns this dungeon, else the mirrored surface — a teleport is never left without an origin */
function tpFrom() {
  if (!inDunPlane(P.tz)) return { x: P.tx, z: P.tz };
  if (P.dunRet) return P.dunRet;
  const d = dunFor(P.tx, P.tz);
  return d ? { x: d.v.x, z: d.v.z } : { x: P.tx, z: P.tz - DUN_Z };
}
/* applyOpts predates houses and dungeons: teach it to refresh house roofs (the roofs toggle was leaving them stuck)
   and to re-assert the dark sky when settings change below ground */
const applyOpts0 = applyOpts;
applyOpts = function (r) {
  applyOpts0(r);
  for (const rec of housesReg.values()) if (rec.roof) rec.roof.visible = roofShown(rec);
  if (dunSkyOn) dunSky();
};

/* ---- MAGIC: blasts, waves and curses are SPELLS rows; the utility spells below are armed as P.uspell (item spells) or fire at once (teleports) ---- */
P.uspell = null; P.homeT = -1e9;
/* THE THREE SPELLBOOKS. A book is a filter over SPELLS and USPELLS, not a separate table: P.spell keeps indexing
   SPELLS so the wire and the armed autocast are untouched by a switch. P.books is the unlocked set (bit per book,
   standard always lit); P.book is the one in hand. Both ride the save. */
const BOOKS = [{ k: 'standard', n: 'Standard', ico: 'spellbookStandard', tint: 0x6a8ad8 },
  { k: 'ancient', n: 'Ancient', ico: 'spellbookAncient', tint: 0x8a1a24 },
  { k: 'lunar', n: 'Lunar', ico: 'spellbookLunar', tint: 0xa8c8e8 }];
P.book = 0; P.books = 1;
const bookHas = b => (P.books >> b) & 1;
function setBook(b, quiet) {
  if (!bookHas(b)) return say('That spellbook is closed to you.', 'bad');
  if (P.book === b) return 1;
  P.book = b; P.spell = null; P.uspell = null;   // the armed spell belonged to the book you just closed
  drawSpells(); drawStyles(); markDirty(1);
  if (!quiet) say('You open the ' + BOOKS[b].n + ' spellbook.', 'lv');
  return 1;
}
/* OSRS gates the two books behind Desert Treasure and Lunar Diplomacy and switches them at an altar. This world has no
   quests, so the altar is the whole ceremony: study it and it teaches whichever book your Magic can already carry —
   the level of that book's lowest spell, 50 for Ancients and 65 for Lunars. Switching afterwards is free, as it is there. */
const BOOK_LV = [1, 50, 65];
function altarStudy() {
  const rows = BOOKS.map((b, i) => {
    const known = bookHas(i), can = lvl[SK.magic] >= BOOK_LV[i];
    const note = P.book === i ? 'in hand' : known ? 'open it' : can ? 'learn it' : 'Magic ' + BOOK_LV[i];
    return '<div class="mk' + (known || can ? '' : ' no') + '"' + (known || can ? ' data-bkalt="' + i + '"' : '') + '>'
      + '<img src="' + (g07(MK07, 'book_' + b.k) ? mk07p(MK07['book_' + b.k]) : OPT.osrs ? c07p('altarIcon') : drawIcon(...MK_ART.altar.slice(0, 3))) + '" alt="">'
      + '<span>' + b.n + '</span><b class="gp">' + note + '</b></div>';
  }).join('');
  showModal('The altar', rows, 'An altar remembers every book you have learned at one.');
}
on(modalBody, 'click', e => {
  const b = e.target.closest('[data-bkalt]'); if (!b) return;
  const i = +b.dataset.bkalt;
  if (lvl[SK.magic] < BOOK_LV[i]) return say('You need Magic level ' + BOOK_LV[i] + ' to hold that book.', 'bad');
  unlockBook(i); closeOverlays();
});
function unlockBook(b) {
  if (bookHas(b)) return setBook(b);
  P.books |= 1 << b; markDirty(2);
  say('The ' + BOOKS[b].n + ' spellbook is yours to open.', 'good');
  return setBook(b, 1);
}
/* a landing tile at about the wilderness level asked for: the ancient teleports are the wiki's own deep destinations,
   so they carry you IN rather than out — the TP_CAP gate above still refuses to carry you back. */
function wildLanding(lv) {
  for (let i = 0; i < 600; i++) {
    const h = hash2(lv * 977 + i, 31, S + 808);
    const a = (h % 65536) / 65536 * TAU, r = lv * 26 + ((h >>> 16) % 40) - 20;
    const x = Math.round(ORIGIN.x + Math.cos(a) * r), z = Math.round(ORIGIN.z + Math.sin(a) * r);
    if (Math.abs(wildLvAt(x, z) - lv) > 2) continue;
    const y = heightAt(x, z);
    if (y < 1.6 || y > 60 || nearTown(x, z)) continue;
    return { x, z };
  }
  return null;
}
const tpAt = (q, what, cap) => q ? tpTo(q.x, q.z, /^(to|into|home)/.test(what) ? what : 'to the nearest ' + what, cap) : say('Nothing like that lies within the scan.', 'bad');   // a bare place name reads as a sentence
const tpWild = (lv, what) => tpAt(wildLanding(lv), what);

defWear({ id: 'ring_of_dueling', name: 'Ring of dueling', g: 'ring', c: '#3aa05a', c2: '#9a7414', slot: 'ring', val: 1800, opt: ['Rub', () => villageTp(TP_CAP_ITEM)] });
RING_NOTES.ring_of_dueling = ' Rub it to be carried to the nearest settlement.';
ITEMS.amulet_of_glory.opt = ['Rub', () => cityTp(TP_CAP_ITEM)];   // the glory carries you to the nearest city, its 2007 role — and it is on the wiki's level-30 exempt list
RING_NOTES.amulet_of_glory = ' Rub it to be carried to the nearest city.';
/* the enchanted necklaces, Lvl-1 to Lvl-5: each keeps its 2007 role, anchored to this world's nearest counterpart
   where the role names a place. The phoenix works at death's door and crumbles (hurtPlayer); binding's own work
   — combination runes — has no counterpart here, so it stands as jewellery and its examine says so. */
defWear({ id: 'games_necklace', name: 'Games necklace', g: 'amulet', c: '#3a64c8', c2: '#9a7414', slot: 'neck', val: 700, opt: ['Rub', () => tpAt(nearestOf(SITE_CELL, 30, (a, b) => { const w = siteAt(a, b); return w && w.t === 3 ? w : null; }), 'waypoint camp', TP_CAP_ITEM)] });
RING_NOTES.games_necklace = ' Rub it to be carried to the nearest waypoint camp.';
defWear({ id: 'binding_necklace', name: 'Binding necklace', g: 'amulet', c: '#3aa05a', c2: '#9a7414', slot: 'neck', val: 1400 });
RING_NOTES.binding_necklace = ' Its old work — binding combination runes — has no counterpart in this world.';
defWear({ id: 'digsite_pendant', name: 'Digsite pendant', g: 'amulet', c: '#c82a3a', c2: '#9a7414', slot: 'neck', val: 2600, opt: ['Rub', () => tpAt(nearestOf(RUIN_CELL, 30, ruinAt), 'ruins', TP_CAP_ITEM)] });
RING_NOTES.digsite_pendant = ' Rub it to be carried to the nearest ruins.';
defWear({ id: 'phoenix_necklace', name: 'Phoenix necklace', g: 'amulet', c: '#e8a03a', c2: '#9a7414', slot: 'neck', val: 4800 });
RING_NOTES.phoenix_necklace = ' Below a fifth of your health it restores three tenths, and crumbles to dust.';
defWear({ id: 'skills_necklace', name: 'Skills necklace', g: 'amulet', c: '#b04ad0', c2: '#9a7414', slot: 'neck', val: 8800, opt: ['Rub', () => tpAt(nearestOf(SETTLE_CELL, 40, vFind(v => v.guild && v.guild)), 'guild city', TP_CAP_ITEM)] });
RING_NOTES.skills_necklace = ' Rub it to be carried to the nearest guild city.';
ENCH[0].neck = 'games_necklace'; ENCH[1].neck = 'binding_necklace'; ENCH[2].neck = 'digsite_pendant'; ENCH[3].neck = 'phoenix_necklace'; ENCH[4].neck = 'skills_necklace';
/* teleports: every one ends what you were doing and lands you on a street tile */
function tpTo(x, z, where, cap) {
  const wl = wildLvAt(P.tx, P.tz);
  if (wl > (cap || TP_CAP)) return say('A mysterious force blocks your teleport — the Wilderness is too deep here.', 'bad');   // falsy: cast() keeps the runes
  closeOverlays(); sfx(200); teleport(x, z, 400); say('You teleport ' + where + '.'); return 1;
}
const tpV = (v, what, cap) => { if (!v) return say('There is no ' + what + ' near enough to reach.', 'bad'); const s = safeSpotIn(v); return tpTo(s.x, s.z, 'to ' + villageName(v), cap); };
const nearCity = R => nearestOf(SETTLE_CELL, R, (a, b) => { const v = villageAt(a, b); return v && v.rank >= 3 ? v : null; });   // nearest settlement of city rank, R cells out
function villageTp(cap) { const f = tpFrom(); return tpV(nearestVillageTo(f.x, f.z, 12), 'settlement', cap); }
function cityTp(cap) { return tpV(nearCity(6), 'city', cap); }
function homeTp() {
  const left = 3000 - (tickN - P.homeT);   // half an hour between casts
  if (left > 0) return say('You need to wait another ' + Math.ceil(left / 100) + ' minutes to cast this spell.', 'bad');
  const r = tpTo(P.home.x, P.home.z, 'home');
  if (r) P.homeT = tickN;   // a teleport the Wilderness refused must not burn the half hour
  return r;
}
function houseTp(cap) {   // the wiki's Teleport to House, shared with the construction cape
  if (!P.hs) return say('You have no house to answer the call.', 'bad');
  const r = tpTo(P.hs.x + P.hs.rm[0][1] * RS + (RS >> 1), P.hs.z + P.hs.rm[0][2] * RS + (RS >> 1), 'to your house', cap);
  if (r && !housesReg.has(hMe())) say('Only bare land answers: the house itself is folded away.', 'bad');
  return r;
}
/* item spells take the pack slot and return 1 when the runes should burn; they say why when they do not */
function alch(i, m) {
  const s = inv[i], it = ITEMS[s.id];
  if (s.id === 'coins') return say('Coins are already made of gold.', 'bad');
  if (!it.val) return say('You cannot alchemise that.', 'bad');
  if (s.n > 1 && !invCount('coins') && !invFree()) return say(FULL, 'bad');
  const got = Math.max(1, Math.round(it.val * m));
  invRemove(s.id, 1); invAdd('coins', got); gpMade += got;
  return 1;
}
function superheat(i) {
  const id = inv[i].id, rows = RECIPES.filter(r => r.at === 3 && r.sk === 'smithing' && r.need[0][0] === id);
  if (!rows.length) return say('You need to cast superheat item on ore.', 'bad');
  const r = rows.filter(mkOk).pop() || rows[0];   // the best bar the pack and the level allow: iron ore and coal make steel
  return mkOk(r) ? craft(r) : say('You need ' + mkWhy(r) + ' to smelt that.', 'bad');
}
function enchant(i, t) {
  const id = inv[i].id, e = ENCH[t];
  if (id === e.g + '_bolts') {   // the crossbow spell was always cast over a set of ten
    if (inv[i].n < 10) return say('The spell needs a set of ten ' + e.g + ' bolts.', 'bad');
    if (!invSwap(e.g + '_bolts_e', 10, id, 10)) return say(FULL, 'bad');   // falsy: the runes stay in the pack
    say('The ' + e.g + ' bolts take the enchantment and glow faintly.');
    return 1;
  }
  const out = id === e.g + '_ring' ? e.ring : id === e.g + '_amulet' ? e.amu : id === e.g + '_necklace' ? e.neck : 0;
  if (!out) return say(id.startsWith(e.g) ? 'That piece takes no enchantment.' : 'This spell can only enchant ' + e.g + ' jewellery or bolts.', 'bad');
  inv[i] = { id: out, n: 1 }; dirty.inv = 1; markDirty();
  say('You enchant the ' + ITEMS[id].name.toLowerCase() + '.');
  return 1;
}
/* name, level, xp, runes, tint, glyph, what it does (the tooltip), cast(slot), item: wants a pack item, grp: book order —
   0 enchants, 1 alchemy, 2 the grab, 3 bones, 4 teleports last with the free ride first */
const USPELLS = [
  ['Home Teleport', 1, 0, [], 0xd8e4ee, 'star', 'no runes, once every 30 minutes', homeTp, 0, 4],
  ['Greater Home Teleport', 31, 41, [['law_rune', 1], ['earth_rune', 1], ['air_rune', 3]], 0x6a8ad8, 'star', 'home at once, for runes, no waiting', () => tpTo(P.home.x, P.home.z, 'home'), 0, 4],
  ['House Teleport', 40, 30, [['law_rune', 1], ['earth_rune', 1], ['air_rune', 1]], 0xe8d9b0, 'house', 'inside your house, wherever it stands', houseTp, 0, 4],
  ['City Teleport', 45, 55.5, [['law_rune', 1], ['air_rune', 5]], 0x6a8ad8, 'star', 'the nearest city', cityTp, 0, 4],
  ['Low Level Alchemy', 21, 31, [['nature_rune', 1], ['fire_rune', 3]], 0xe0b436, 'coins', 'an item → coins, 40% of its value', i => alch(i, 0.4), 1, 1],
  ['Superheat Item', 43, 53, [['nature_rune', 1], ['fire_rune', 4]], 0xd05a2a, 'bar', 'an ore → its bar, coal and all', superheat, 1, 1],
  ['High Level Alchemy', 55, 65, [['nature_rune', 1], ['fire_rune', 5]], 0xe0b436, 'coins', 'an item → coins, 60% of its value', i => alch(i, 0.6), 1, 1],
  ['Bones to Bananas', 15, 25, [['nature_rune', 1], ['water_rune', 2], ['earth_rune', 2]], 0xe8d44a, 'banana', 'every bone in the pack becomes a banana', () => b2fruit('banana'), 0, 3],
  ['Telekinetic Grab', 33, 43, [['law_rune', 1], ['air_rune', 1]], 0x9a7ad0, 'coins', 'take a ground item from up to ten tiles away', teleArm, 0, 2],
  ['Bones to Peaches', 60, 35.5, [['nature_rune', 2], ['water_rune', 4], ['earth_rune', 4]], 0xe8a05a, 'peach', 'every bone in the pack becomes a peach', () => b2fruit('peach'), 0, 3],
  ...ENCH.map((e, t) => ['Lvl-' + (t + 1) + ' Enchant', e.lv, e.xp, e.need, parseInt(GEMS[t].c.slice(1), 16), e.ring ? 'ring' : 'amulet', e.g + ' jewellery or bolts', i => enchant(i, t), 1, 0]),
/* ANCIENT TELEPORTS (bk 1), wiki levels/xp/runes. Their OSRS destinations are the deep places — four of the eight are
   Wilderness — so here they carry you IN at the wiki's own depths rather than out; tpTo still refuses to carry you back. */
  ['Paddewwa Teleport', 54, 64, [['law_rune', 2], ['air_rune', 1], ['fire_rune', 1]], 0x8a1a24, 'lock', 'the nearest dungeon door', () => tpAt(nearestOf(SETTLE_CELL, 24, vFind(v => v.castle && v.castle.dun)), 'dungeon'), 0, 4, 1],
  ['Senntisten Teleport', 60, 70, [['law_rune', 2], ['soul_rune', 1]], 0x8a1a24, 'rune', 'the nearest rune altar', () => tpAt(nearestOf(RUIN_CELL, 30, ruinAt), 'rune altar'), 0, 4, 1],
  ['Kharyrll Teleport', 66, 76, [['law_rune', 2], ['blood_rune', 1]], 0x8a1a24, 'star', 'the nearest settlement', () => villageTp(), 0, 4, 1],
  ['Lassar Teleport', 72, 82, [['law_rune', 2], ['water_rune', 4]], 0x8a1a24, 'star', 'the nearest city', () => cityTp(), 0, 4, 1],
  ['Dareeyak Teleport', 78, 88, [['law_rune', 2], ['air_rune', 2], ['fire_rune', 3]], 0x8a1a24, 'skull', 'the Wilderness, about level 13', () => tpWild(13, 'into the Wilderness'), 0, 4, 1],
  ['Carrallanger Teleport', 84, 94, [['law_rune', 2], ['soul_rune', 2]], 0x8a1a24, 'skull', 'the Wilderness, about level 18', () => tpWild(18, 'into the Wilderness'), 0, 4, 1],
  ['Annakarl Teleport', 90, 100, [['law_rune', 2], ['blood_rune', 2]], 0x8a1a24, 'skull', 'the Wilderness, about level 29', () => tpWild(29, 'into the Wilderness'), 0, 4, 1],
  ['Ghorrock Teleport', 96, 106, [['law_rune', 2], ['water_rune', 8]], 0x8a1a24, 'skull', 'the Wilderness, about level 50', () => tpWild(50, 'deep into the Wilderness'), 0, 4, 1],
/* LUNAR (bk 2), wiki levels/xp/runes. Every one costs astral runes, which is what gates the book. */
  ['Monster Examine', 66, 61, [['astral_rune', 1], ['cosmic_rune', 1], ['mind_rune', 1]], 0xa8c8e8, 'skull', "read a nearby creature's stat block", monsterExamine, 0, 3, 2],
  ['Cure Me', 71, 69, [['astral_rune', 2], ['cosmic_rune', 2], ['law_rune', 1]], 0x5aa04a, 'leaf', 'cures your own poison, with no immunity after', () => { if (!P.psn) return say('You are not poisoned.', 'bad'); P.psn = 0; P.psnN = 0; say('The poison leaves you.', 'good'); return 1; }, 0, 3, 2],
  ['Hunter Kit', 71, 70, [['astral_rune', 2], ['earth_rune', 2]], 0x8a6a3a, 'box', 'a bird snare and a box trap', hunterKit, 0, 3, 2],
  ['Spin Flax', 76, 75, [['astral_rune', 1], ['nature_rune', 2], ['air_rune', 5]], 0xe8d44a, 'rope', 'five flax become five bow strings', spinFlax, 0, 3, 2],
  ['Dream', 79, 82, [['astral_rune', 2], ['cosmic_rune', 1], ['body_rune', 5]], 0xa8c8e8, 'star', 'sleep: wounds close three times as fast', dreamSleep, 0, 3, 2],
  ['Magic Imbue', 82, 86, [['astral_rune', 2], ['fire_rune', 7], ['water_rune', 7]], 0xd05a2a, 'rune', 'twenty-one ticks with no opposing rune', magicImbue, 0, 3, 2],
  ['Fertile Soil', 83, 87, [['astral_rune', 3], ['earth_rune', 15], ['nature_rune', 2]], 0x5aa04a, 'leaf', 'three more harvests from the patch you stand at', fertileSoil, 0, 3, 2],
  ['Plank Make', 86, 90, [['astral_rune', 2], ['nature_rune', 1], ['earth_rune', 15]], 0xd8b070, 'log', 'one log becomes its plank, for the sawmill fee', plankMake, 0, 3, 2],
  ['Vengeance', 94, 112, [['astral_rune', 4], ['earth_rune', 10], ['death_rune', 2]], 0x8a1a24, 'shield', 'the next blow rebounds 75% of itself', vengeance, 0, 3, 2],
  ['Spellbook Swap', 96, 130, [['astral_rune', 3], ['cosmic_rune', 2], ['law_rune', 1]], 0xa8c8e8, 'star', 'open another book you know', bookSwap, 0, 3, 2],
  ['Moonclan Teleport', 69, 66, [['astral_rune', 2], ['law_rune', 1], ['earth_rune', 2]], 0xa8c8e8, 'rune', 'the nearest rune altar', () => tpAt(nearestOf(RUIN_CELL, 30, ruinAt), 'rune altar'), 0, 4, 2],
  ['Ourania Teleport', 71, 69, [['astral_rune', 2], ['law_rune', 1], ['earth_rune', 6]], 0xa8c8e8, 'rune', 'the nearest rune essence mine', () => tpAt(nearestOf(SETTLE_CELL, 30, vFind(v => v.lm && v.lm.t === 1 && v.lm)), 'essence mine'), 0, 4, 2],
  ['Waterbirth Teleport', 72, 71, [['astral_rune', 2], ['law_rune', 1], ['water_rune', 1]], 0xa8c8e8, 'star', 'the nearest fishing water', () => tpAt(nearestOf(SETTLE_CELL, 30, vFind(v => v.f && v.f.find(f2 => f2.t === 2))), 'fishing spot'), 0, 4, 2],
  ['Barbarian Teleport', 75, 76, [['astral_rune', 2], ['law_rune', 2], ['fire_rune', 3]], 0xa8c8e8, 'star', 'the nearest settlement', () => villageTp(), 0, 4, 2],
  ['Khazard Teleport', 78, 80, [['astral_rune', 2], ['law_rune', 2], ['water_rune', 4]], 0xa8c8e8, 'star', 'the nearest city', () => cityTp(), 0, 4, 2],
  ['Fishing Guild Teleport', 85, 89, [['astral_rune', 3], ['law_rune', 3], ['water_rune', 10]], 0xa8c8e8, 'cfish', 'the nearest fishing guild waters', () => tpAt(nearestOf(SETTLE_CELL, 40, vFind(v => v.guild && v.guild.g.k === 'cook' && v.guild)), 'guild'), 0, 4, 2],
  ['Catherby Teleport', 87, 92, [['astral_rune', 3], ['law_rune', 3], ['water_rune', 10]], 0xa8c8e8, 'star', 'your house', () => houseTp(), 0, 4, 2],
  ['Ice Plateau Teleport', 89, 96, [['astral_rune', 3], ['law_rune', 3], ['water_rune', 8]], 0xa8c8e8, 'skull', 'the Wilderness, about level 53', () => tpWild(53, 'onto the Ice Plateau'), 0, 4, 2]
].map(([n, lv, xp, need, tint, g, d, f, item, grp, bk]) => ({ n, lv, xp, need, tint, g, d, f, item, grp, bk: bk || 0 })).sort((a, b) => (a.grp - b.grp) || (a.lv - b.lv));
/* skillcape perks with a live counterpart (wiki): ranged catches arrows like the accumulator, defence escapes like the ring of life,
   agility energises once a day, construction answers the house call; cooking, hitpoints, woodcutting, mining, thieving and prayer speak at their own sites */
ITEMS.skillcape_ranged.save = 0.72;
ITEMS.skillcape_construction.opt = ['Teleport', () => houseTp(TP_CAP_ITEM)];   // itemOptions passes a pack index, which is not a cap
ITEMS.skillcape_agility.opt = ['Energise', () => {
  if (tickN - (P.agiCapeT || -1e9) < 144000) return say('The cape has nothing more to give today.', 'bad');
  P.agiCapeT = tickN; P.energy = 100; P.stamT = tickN + 100; dirty.orb = 1;
  say('The cape restores your run energy and lightens your step.', 'lv');
}];
/* ---- LUNAR: the spells whose OSRS effect has a counterpart in this world. Levels, xp and runes are the wiki's own.
   Omitted deliberately, with no system to land on: Superglass Make and Humidify (no sand, no empty vials), Tan Leather
   (no raw hides), Bake Pie (no uncooked pies), and every group/other-player spell (Cure Other/Group, Heal Other/Group,
   Stat Spy, Energy Transfer, Vengeance Other, the Tele Group family) — this client has no wire lane to target a peer. */
function monsterExamine() {
  const o = P.task && P.task.o;
  const n = (o && o.npc) ? o : npcs.filter(q => !q.dead).sort((a, b) => chebDist(a.tx, a.tz, P.tx, P.tz) - chebDist(b.tx, b.tz, P.tx, P.tz))[0];
  if (!n || chebDist(n.tx, n.tz, P.tx, P.tz) > 10) return say('No creature close enough to read.', 'bad');
  const t = n.t.base || n.t;
  say(n.name + ' — combat ' + (t.lv || '?') + ', hitpoints ' + n.hp + '/' + n.maxhp + ', attack ' + t.atk + ', strength ' + t.str + ', defence ' + t.def + ', magic ' + t.mag + '.', 'lv');
  say('  max hit ' + (t.max !== null && t.max !== undefined ? t.max : maxFrom(t.str + 1, t.sbon)) + ', styles ' + (t.at || 'm') + (t.slayLv ? ', slayer ' + t.slayLv : '') + '.', 'lv');
  return 1;
}
function hunterKit() {
  if (invFree() < 2) return say(FULL, 'bad');
  invAdd('bird_snare', 1); invAdd('box_trap', 1);
  say('A hunter kit falls into your pack.');
  return 1;
}
function spinFlax() {
  const n = Math.min(5, invCount('flax'));
  if (!n) return say('You have no flax to spin.', 'bad');
  if (!invSwap('bow_string', n, 'flax', n)) return say(FULL, 'bad');
  gainXp('crafting', 15 * n);
  say('You spin ' + n + ' flax into bow string.');
  return 1;
}
function plankMake() {
  const rows = [['logs', 'plank', 70], ['oak_logs', 'oak_plank', 175], ['mahogany_logs', 'mahogany_plank', 1050]];
  for (const [log, plank, fee] of rows) {
    if (!invCount(log)) continue;
    if (coins() < fee) return say('Plank Make asks ' + fee + ' coins for that log.', 'bad');
    invRemove('coins', fee);
    if (!invSwap(plank, 1, log, 1)) { invAdd('coins', fee); return say(FULL, 'bad'); }
    gpSunk += fee;
    say('The log knits itself into a ' + ITEMS[plank].name.toLowerCase() + '.');
    return 1;
  }
  return say('You have no logs Plank Make knows.', 'bad');
}
function fertileSoil() {
  let key = null, bd = 9;
  for (const k in P.farm) { const [px, pz] = [k >> 16, (k << 16) >> 16]; const d = chebDist(px, pz, P.tx, P.tz); if (d < bd) { bd = d; key = k; } }
  const o = P.task && P.task.o;
  if (o && o.key !== undefined && P.farm[o.key]) key = o.key;
  const s2 = key !== null && P.farm[key];
  if (!s2) return say('Stand at a patch you have sown, then cast it.', 'bad');
  if (s2.length < 3) s2[2] = 3 + Math.floor(lvl[SK.farming] / 20) + randInt(0, 2);
  s2[2] += 3; markDirty(1);
  gainXp('farming', 18);
  say('The soil darkens and richens: three more harvests in it.');
  return 1;
}
function dreamSleep() {
  if (P.hp >= P.maxhp) return say('You have no wounds to sleep off.', 'bad');
  P.dreamT = tickN + 100;   // a minute of triple regeneration, and it ends the moment anything strikes you
  say('You drift into a Moonclan dream. Your wounds close three times as fast.', 'lv');
  return 1;
}
function magicImbue() { P.imbueT = tickN + 21; say('Your staff hums: for twenty-one ticks it supplies every element.', 'lv'); return 1; }
function vengeance() {
  if (tickN < (P.vengCd || 0)) return say('You must wait ' + Math.ceil((P.vengCd - tickN) * TICK / 1000) + ' more seconds to cast that.', 'bad');
  P.veng = 1; P.vengCd = tickN + 500;   // the wiki's thirty seconds between casts
  say('You brace: the next blow rebounds three quarters of itself.', 'lv');
  return 1;
}
function bookSwap() {
  const open = BOOKS.map((b, i) => i).filter(i => i !== P.book && bookHas(i));
  if (!open.length) return say('You know no other spellbook.', 'bad');
  showModal('Spellbook Swap', open.map(i => '<div class="mk" data-bkswap="' + i + '"><span>' + BOOKS[i].n + '</span><b class="gp">open</b></div>').join(''),
    'The swap lasts until you change it again.');
  return 1;
}
const usRow = s => liRow('data-us="' + USPELLS.indexOf(s) + '" title="' + s.need.map(n => n[1] + ' ' + ITEMS[n[0]].name).concat(s.d).join(', ') + '"', P.uspell === s, lvl[SK.magic] < s.lv,
  g07(US07, s.n) ? c07p(US07[s.n]) : drawIcon(s.g, '#' + s.tint.toString(16).padStart(6, '0'), '#f0e6c8'), s.n, '<u>' + (lvl[SK.magic] < s.lv ? 'level ' + s.lv : spellReady(s) ? 'ready' : 'no runes') + '</u>');
function cast(s, i) {   // runes first; the effect burns them only when it lands
  if (P.dead || P.stun > 0) return;
  if (!spellReady(s)) return say('You do not have the runes for that spell.', 'bad');
  if (!s.f(i)) return;
  spendRunes(s); if (s.xp) gainXp('magic', s.xp);
  const uid = s.n === 'High Level Alchemy' ? 97 : s.n === 'Low Level Alchemy' ? 98 : s.n === 'Superheat Item' ? 190 : 0;
  if (uid) sfx(uid);
  spellBurst(P.rx, P.ry + 1.1, P.rz, s.tint); P.acting = 1; P.pose = 2;
}
function castItem(i) { const s = P.uspell; P.uspell = null; cast(s, i); showTab('mg'); }
/* The two armed states are independent and must stay that way. A combat spell is spent on a TARGET, an item spell on a
   PACK SLOT, and a teleport is spent the moment it is clicked — none of them is a mode the others share. Clearing
   P.spell here is what made a single teleport put your autocast away and send you back to the book to re-arm it. */
on(spellGrid, 'click', e => {   // runs after the combat handler, which owns [data-sp]
  const d = e.target.closest('[data-us]');
  if (!d) return;
  const s = USPELLS[+d.dataset.us];
  if (eff('magic') < s.lv) return say('You need Magic level ' + s.lv + ' to cast that.', 'bad');
  if (!s.item) cast(s);   // a teleport or a pack-wide spell fires at once and arms nothing
  else if (P.uspell === s) { P.uspell = null; say('You put ' + s.n + ' away.'); }
  else { P.uspell = s; clearUse(); say('You ready ' + s.n + '. Choose an item in your pack.'); showTab('inv'); }
  drawSpells();
});

/* ---- THE OLD BOOK'S MISSING PAGES: holds and grabs, gem bolts, the famous weapons, the baker's economy, prayer on the cloth ---- */
/* the new faces, drawn like the rest */
GLYPH.wheat = (g, c, d) => { for (const x of [10, 16, 22]) { poly(g, [x, 28, x, 12], null, d); for (let y = 6; y < 14; y += 3) { poly(g, [x, y + 4, x - 3, y], null, c); poly(g, [x, y + 4, x + 3, y], null, c); } } };
/* the risen dead, marked so Crumble Undead and the like know their own */
for (const k of ['skeleton', 'skelwarrior', 'giantskeleton', 'zombie', 'ghost', 'shade', 'ghoul', 'banshee', 'spectre', 'revenant', 'vetion']) if (NPC_BY[k]) NPC_BY[k].undead = 1;

/* bones to fruit: every bone in the pack, one cast */
defStack('banana', 'Banana', 'banana', '#e8d44a', '#9a8a1e', 2, { heal: 2 });
defStack('peach', 'Peach', 'peach', '#e8a05a', '#a05a2a', 8, { heal: 8 });
function b2fruit(fruit) {
  let n = 0;
  for (let i = 0; i < INV_N; i++) if (inv[i] && ITEMS[inv[i].id].bury) { n += inv[i].n; inv[i] = { id: fruit, n: inv[i].n }; }
  if (!n) return say('You have no bones to offer the spell.', 'bad');
  const merged = [];   // collapse the converted stacks
  for (let i = 0; i < INV_N; i++) if (inv[i] && inv[i].id === fruit) { merged.push(inv[i].n); inv[i] = null; }
  invAdd(fruit, merged.reduce((a, b) => a + b, 0));
  dirty.inv = 1; markDirty();
  say('The bones wriggle and swell into ' + (n > 1 ? n + ' ' + fruit + 's.' : 'a ' + fruit + '.'));
  return 1;
}
/* telekinetic grab: armed, then thrown at a ground item; walls mean nothing to it */
function teleArm() { P.teleG = 1; say('You ready Telekinetic Grab. Click an item on the ground.'); return 0; }   // arming spends nothing
function teleGrab(d2) {
  const s = USPELLS.find(u => u.n === 'Telekinetic Grab');
  P.teleG = 0;
  if (chebDist(P.tx, P.tz, d2.x, d2.z) > MAGIC_RANGE) return say('That lies beyond the spell\'s reach.', 'bad');
  if (!spellReady(s)) return say('You do not have the runes for that spell.', 'bad');
  if ((!ITEMS[d2.id].stack && !invFree())) return say(FULL, 'bad');
  spendRunes(s); gainXp('magic', s.xp);
  spellBurst(d2.x, Math.max(walkY(d2.x, d2.z), 0) + 0.6, d2.z, s.tint);
  takeDrop(d2);
  P.pose = 2; P.acting = 1;
}

for (const [gm, base, lv, tipXp, boltXp, rst, req] of EBOLT) {
  const G = GEMS.find(q => q.k === gm), N = cap(gm);
  defStack(gm + '_bolt_tips', N + ' bolt tips', 'bolt', G.c, G.c2, Math.round(ITEMS[gm].val / 10));
  recipe(gm + '_bolt_tips', 'fletching', lv, tipXp, [[gm, 1]], { tool: 'chisel', n: 12, msg: 'You chip the ' + gm + ' into 12 bolt tips.' });
  defWear({ id: gm + '_bolts', name: N + ' bolts', g: 'bolt', c: G.c, c2: ITEMS[base].c2, slot: 'ammo', stack: 1, ammo: 1, aT: 'bolt', rst, rat: ITEMS[base].rat, req: { ranged: req }, val: ITEMS[base].val + Math.round(ITEMS[gm].val / 8) });
  recipe(gm + '_bolts', 'fletching', lv, boltXp, [[base, 10], [gm + '_bolt_tips', 10]], { n: 10, tk: 1, msg: 'You pin ' + gm + ' tips to 10 bolts.' });
  if (!ITEMS[gm + '_bolts_e']) defWear(Object.assign({}, ITEMS[gm + '_bolts'], { id: gm + '_bolts_e', name: N + ' bolts (e)', c2: '#c8f0e8', val: ITEMS[gm + '_bolts'].val + 20 }));
  ITEMS[gm + '_bolts_e'].eb = gm;
}
defWear(Object.assign({}, ITEMS.onyx_bolts, { id: 'onyx_bolts_e', name: 'Onyx bolts (e)', c2: '#c8f0e8', val: ITEMS.onyx_bolts.val + 100, eb: 'onyx' }));
ITEMS.diamond_bolts_e.eb = 'diamond';   // the drop-only stock joins the family
/* what an enchanted tip does when the bolt lands; the rates are the commonly kept ones — TODO: verify against the book */
function boltProc(o, dmg, ch, M) {
  const a = eq.ammo && ITEMS[eq.ammo];
  if (!a || !a.eb || !o.npc) return dmg;
  const r = Math.random();
  if (a.eb === 'sapphire' && r < 0.05) { P.pray = Math.min(P.maxpray, P.pray + 5); dirty.orb = 1; say('Your bolt sips at the spirit.', 'lv'); }
  else if (a.eb === 'emerald' && r < 0.55 && !o.psn) { o.psn = 5; o.psnN = 0; o.psnT = tickN + 30; say('Your bolt carries venom into the ' + o.name + '.'); }
  else if (a.eb === 'ruby' && r < 0.06) { dmg = Math.max(dmg, Math.min(100, Math.floor(o.hp * 0.2))); P.hp = Math.max(1, P.hp - Math.floor(P.hp * 0.1)); say('Blood for blood: your bolt bites deep!', 'lv'); }
  else if (a.eb === 'diamond' && r < 0.10) { dmg = randInt(1, Math.ceil(M * 1.15)); say('Your bolt shears clean through armour!', 'lv'); }
  else if (a.eb === 'dragonstone' && r < 0.06 && !(o.t.fire)) { dmg += Math.floor(lvl[SK.ranged] * 0.2); say('Dragonfire erupts from your bolt!', 'lv'); }
  else if (a.eb === 'onyx' && r < 0.11 && dmg > 0) { dmg = Math.floor(dmg * 1.2); P.hp = Math.min(P.maxhp, P.hp + Math.floor(dmg * 0.25)); dirty.orb = 1; say('Life drains back along your bolt.', 'lv'); }
  return dmg;
}

/* the famous absences, armed and placed. Sources borrow the nearest kin of owners this world lacks. */
W('abyssal_whip', 0, 'whip', 0, 'weapon', 120000, { attack: 70 }, { atk: 82, str: 82, spd: 4 });
SPEC.abyssal_whip = { cost: 50, acc: 1.25 };   // Energy Drain: the accuracy is the point of it here
W('granite_maul', 0, 'wham', 0, 'weapon', 35000, { attack: 50, strength: 50 }, { two: 1, atk: 81, str: 79, spd: 7 });
SPEC.granite_maul = { cost: 60, acc: 1, quick: 1 };   // Quick Smash: the next blow follows at once
W('dark_bow', 0, 'bow', 0, 'weapon', 150000, { ranged: 60 }, { bow: 1, two: 1, spd: 9, rng: 10, rat: 95 });
SPEC.dark_bow = { cost: 55, rng: 1, n: 2, dmg: 1.3, min: 5, ddmg: 1.5, dmin: 8 };   // Descent of Darkness: min 5 an arrow; dragon arrows 1.5x, min 8, capped 48
W('saradomin_sword', 0, 'lsword', 0, 'weapon', 90000, { attack: 70 }, { two: 1, atk: 82, str: 82, spd: 4, pb: 2 });
SPEC.saradomin_sword = { cost: 100, acc: 1, dmg: 1.1, bonus: [1, 16] };   // Saradomin's Lightning: a tenth more steel, 1-16 of the god's own
defWear(Object.assign({}, ITEMS.dragon_dagger, { id: 'dragon_dagger_p', name: 'Dragon dagger (p)', c2: '#3aa04a', psn: 4, val: ITEMS.dragon_dagger.val + 500 }));   // plain weapon poison bites 4, as the wiki's (p) does
SPEC.dragon_dagger_p = SPEC.dragon_dagger;
defItem({ id: 'weapon_poison', name: 'Weapon poison', g: 'vial', c: '#3aa04a', c2: CORK, val: 300, opt: ['Apply', () => {
  const i = inv.findIndex(s2 => s2 && s2.id === 'dragon_dagger');
  if (i < 0) return say('You have no dragon dagger to envenom.', 'bad');
  invRemove('weapon_poison', 1); inv[i] = { id: 'dragon_dagger_p', n: 1 }; dirty.inv = 1; markDirty();
  say('You coat the dagger. The edge glistens green.');
}] });
recipe('weapon_poison', 'herblore', 60, 137.5, [['kwuarm', 1], ['dragon_scale_dust', 1], ['vial_of_water', 1]], { tk: 2, msg: 'You brew a vial of weapon poison.' });
(LOOT.blackdemon.tert = LOOT.blackdemon.tert || []).push(['abyssal_whip', 512]);   // game-economy: the black demon stands in for its abyssal kin
(LOOT.trollgeneral.tert = LOOT.trollgeneral.tert || []).push(['granite_maul', 256]);   // game-economy: the general stands in for the gargoyles
(LOOT.venenatis.tert = LOOT.venenatis.tert || []).push(['dark_bow', 512]);   // game-economy: the great spider keeps the dark bow
(LOOT.hero.tert = LOOT.hero.tert || []).push(['saradomin_sword', 512]);   // game-economy: a hero carries the god's blade

/* ---- ARMOURY II: beyond rune. Barrows, the god wars, and the treasure tiers. Icons ship from i07/ (icons07-map.csv);
   worn tints are sampled from those sprites. Weapon atk/str follow the wiki's best style, armour def its melee mean.
   Drops are wired in the ARMOURY II DROPS block below; barrows set effects, mdmg gear and the trident's own spell are live.
   Re-audited against the wiki Aug 27: the rebalance-era channels folded in (small mdmg on the mage sets, gear ranged
   strength on anguish/assembler/pegasians, occult at 5%). Armour attack penalties and weapon shield-hand defence stay
   unmodelled by convention. Tbow scaling, dhcb dragonbane and the obsidian charm now land in swing()/maxHit(). */
/* barrows: the four melee brothers share the smith's measures; Verac alone carries the god's favour */
armSeg('seg1');
/* the god wars: four blades of one hilt, and the generals' plate */
W('armadyl_godsword', 0, 'sword2h', 0, 'weapon', 500000, { attack: 75 }, { two: 1, atk: 132, str: 132, spd: 6, pb: 8 });
SPEC.armadyl_godsword = { cost: 50, acc: 2, dmg: 1.375 };   // the Judgment
SPEC.bandos_godsword = { cost: 50, acc: 2, dmg: 1.21, drainFlat: 1 };   // Warstrike drains Defence by the damage dealt, as the wiki has it
SPEC.saradomin_godsword = { cost: 50, acc: 2, dmg: 1.1, heal: 0.5, pheal: 0.25 };   // Healing Blade: half the damage back as health (min 10), a quarter as prayer (min 5)
SPEC.zamorak_godsword = { cost: 50, acc: 2, dmg: 1.1, stun: 33 };   // Ice Cleave: the wiki's 20-second freeze
armSeg('seg2');
/* the abyss, the volcano, and Zamorak's arsenal */
W('abyssal_dagger', 0, 'dagger', 0, 'weapon', 90000, { attack: 70 }, { stab: 1, atk: 75, str: 75, spd: 4, mag: 1 });
SPEC.abyssal_dagger = { cost: 25, n: 2, acc: 1.25, dmg: 0.85 };
W('abyssal_bludgeon', 0, 'wham', 0, 'weapon', 200000, { attack: 70, strength: 70 }, { two: 1, atk: 102, str: 85, spd: 4 });
W('abyssal_tentacle', 0, 'whip', 0, 'weapon', 250000, { attack: 75 }, { atk: 90, str: 86, spd: 4 });
SPEC.abyssal_tentacle = SPEC.abyssal_whip;
armSeg('seg3');
/* the treasure tiers: what the richest monsters and deepest vaults will one day pay out */
armSeg('seg4');
/* the far shore of ranged: what outranges the dark bow */
W('armadyl_crossbow', 0, 'cbow', 0, 'weapon', 600000, { ranged: 70 }, { bow: 1, ammoT: 'bolt', spd: 6, rng: 8, rat: 100, pb: 1 });
W('dragon_hunter_crossbow', 0, 'cbow', 0, 'weapon', 500000, { ranged: 70 }, { bow: 1, ammoT: 'bolt', spd: 6, rng: 8, rat: 95 });   // its dragonbane bite (30% acc, 25% dmg) lands in swing()
W('toxic_blowpipe', 0, 'pipe', 0, 'weapon', 700000, { ranged: 75 }, { bow: 1, two: 1, selfAmmo: 1, spd: 3, rng: 7, rat: 30, rst: 35, psn: 6, venom: 1 });   // the darts are abstracted into the pipe; the venom is its own
SPEC.toxic_blowpipe = { cost: 50, dmg: 1.5, heal: 0.5 };   // the spec drinks half of what it deals
W('twisted_bow', 0, 'bow', 0, 'weapon', 1200000, { ranged: 85 }, { bow: 1, two: 1, spd: 6, rng: 10, rat: 70, rst: 20 });   // scales off the target's Magic in swing(), the wiki's own curves
W('crystal_bow', 0, 'bow', 0, 'weapon', 350000, { ranged: 70 }, { bow: 1, two: 1, selfAmmo: 1, spd: 5, rng: 10, rat: 100, rst: 78 });
W('crystal_shield', 0, 'shield', 0, 'shield', 250000, { defence: 70 }, { def: 53 });
/* the far shore of magic */
W('ancient_staff', 0, 'staff', 0, 'weapon', 90000, { magic: 50, attack: 50 }, { atk: 40, str: 50, mag: 15, spd: 4 });
W('staff_of_the_dead', 0, 'staff', 0, 'weapon', 400000, { magic: 75, attack: 75 }, { atk: 70, str: 72, mag: 17, mdmg: 15, spd: 4 });
W('toxic_staff_of_the_dead', 0, 'staff', 0, 'weapon', 500000, { magic: 75, attack: 75 }, { atk: 70, str: 72, mag: 25, mdmg: 15, psn: 6, venom: 1, spd: 4 });
defStaff('kodai_wand', 'Kodai wand', '#654e98', '#3f179f', 0, 0, 28, 80, 800000, 'water_rune', 'wand');
armSeg('seg5');
/* 3rd age: the treasure trails' impossible metal, in all three disciplines */
armSeg('seg6');
defStaff('third_age_wand', '3rd age wand', '#6f7a7a', '#151111', 0, 0, 20, 65, 900000, undefined, 'wand');
W('third_age_amulet', '3rd age amulet', 'amulet', 0, 'neck', 600000, 0, { mag: 15, def: 0 });

/* ---- ARMOURY II DROPS: every treasure above now has a home. GWD pieces sit at the wiki's own 1/381 armour and 1/508
   hilt rates on the generals this world has; where the true owner is absent the nearest kin stands in (each commented).
   The shared tables roll with no empty weight: a tert that names one always pays a piece. ---- */
SUBTABLES.barrows = () => rollTable(BARROWS_SUB);
SUBTABLES.raid = () => rollTable(RAID_SUB);
ITEMS.kodai_wand.mdmg = 15;   // the magic-damage carriers among the staves
if (ITEMS.smoke_battlestaff) ITEMS.smoke_battlestaff.mdmg = 10;
if (ITEMS.mystic_smoke_staff) ITEMS.mystic_smoke_staff.mdmg = 10;
const bossTert = (k, ...rows) => (LOOT[k].tert = LOOT[k].tert || []).push(...rows);
for (const [k, ...rows] of BTERT) bossTert(k, ...rows);
/* the slayer's mask and the mystic leftovers ride the task-only tertiary, like the robes before them */
W('black_mask', 0, 'skull', '#33343c.#15161b', 'head', 40000, { defence: 10, strength: 20 }, { def: 9 });   // on assignment its wearer's melee bites 7/6 harder (swing reads it)
NPC_BY.banshee.slayLv = 15; NPC_BY.spectre.slayLv = 60;   // the wiki's slayer gates: the pool and the attack path both honour them
(LOOT.banshee.taskTert = LOOT.banshee.taskTert || []).push(['black_mask', 512], ['mystic_hat', 150]);   // the cave horror's 1/512, on its wailing kin
(LOOT.spectre.taskTert = LOOT.spectre.taskTert || []).push(['mystic_gloves', 112], ['mystic_boots', 112]);
/* mystic combo staves: the furnace-smith refits a combo battlestaff for coin, as Thormac once did */
for (const ck of ['lava', 'steam', 'smoke', 'mist', 'dust', 'mud']) if (ITEMS['mystic_' + ck + '_staff'])
  recipe('mystic_' + ck + '_staff', 'magic', 40, 0, [[ck + '_battlestaff', 1], ['coins', 40000]], { at: 3, msg: 'The furnace-smith refits your battlestaff in mystic fashion.' });
/* onyx jewellery joins the gold bench (67/82/90 crafting, per the wiki); Lvl-6 Enchant turns amulet and necklace into the fury and the berserker */
ENCH[5].amu = 'amulet_of_fury'; ENCH[5].neck = 'berserker_necklace';

/* ---- ARMOURY III: the remaining famous absences, wiki-audited Aug 27 (infoboxes fetched, every stat exact).
   Absent owners borrow the nearest kin, as ARMOURY II does (each commented). Icons ship from i07/ via the CSV;
   the dead-code sweep had taken the glyph slots these items wear, so their eight draw fns return here as fallbacks. ---- */
GLYPH.helm = (g, c, d) => { poly(g, [16, 5, 25, 12, 25, 18, 7, 18, 7, 12], c, K); fr(g, d, 6, 18, 20, 3); fr(g, d, 14, 8, 4, 10); };
GLYPH.fhelm = (g, c, d) => { poly(g, [16, 3, 25, 9, 25, 26, 20, 28, 12, 28, 7, 26, 7, 9], c, K); fr(g, d, 10, 14, 12, 3); fr(g, d, 14, 17, 4, 9); };
GLYPH.robe = (g, c, d) => { poly(g, [12, 5, 20, 5, 26, 10, 24, 15, 22, 13, 22, 27, 10, 27, 10, 13, 8, 15, 6, 10], c, K); fr(g, d, 10, 22, 12, 2); };
GLYPH.skirt = (g, c, d) => { poly(g, [11, 6, 21, 6, 25, 27, 7, 27], c, K); fr(g, d, 11, 6, 10, 3); ln(g, d, 1, [16, 10, 16, 26]); };
GLYPH.legs = (g, c, d) => { poly(g, [10, 5, 22, 5, 23, 28, 18, 28, 16, 14, 14, 28, 9, 28], c, K); fr(g, d, 10, 5, 12, 3); };
GLYPH.glove = (g, c, d) => { poly(g, [12, 8, 20, 8, 22, 18, 25, 14, 27, 16, 22, 24, 12, 24], c, K); fr(g, d, 12, 8, 8, 3); };
GLYPH.cape = (g, c, d) => { poly(g, [10, 4, 22, 4, 26, 28, 16, 24, 6, 28], c, K); fr(g, d, 10, 4, 12, 3); };
GLYPH.amulet = (g, c, d) => { circ(g, 16, 11, 7, null, K); poly(g, [16, 17, 21, 23, 16, 29, 11, 23], c, K); fr(g, d, 14, 21, 4, 4); };
/* the dragonfire shield: the old shield takes the fallen dragon's face at the anvil; it counts as the anti-dragon shield against breath */
defItem({ id: 'draconic_visage', name: 'Draconic visage', g: 'shield', c: '#a02c1e', c2: '#6b1a10', val: 700000 });
W('dragonfire_shield', 0, 'shield', 0, 'shield', 900000, { defence: 75 }, { def: 72, str: 7 });   // its breath charge is not modelled
recipe('dragonfire_shield', 'smithing', 90, 2000, [['anti_dragon_shield', 1], ['draconic_visage', 1]], { at: 4, tool: 'hammer', msg: 'You rivet the visage to the shield; it stirs with heat.' });
bossTert('kbd', ['draconic_visage', 5000]); bossTert('vorkath', ['draconic_visage', 5000]);   // the wiki's own 1/5000 heads
/* the slayer's helmet: mask and helm forged into one — its bite is the mask's, read by the same swing */
W('slayer_helmet', 0, 'skull', 0, 'head', 50000, { defence: 10 }, { def: 30 });
recipe('slayer_helmet', 'crafting', 55, 0, [['black_mask', 1], ['steel_full_helm', 1], ['leather', 2]], { tk: 2, msg: 'You fit the mask to the helm: the slayer helmet glowers back.' });   // game-economy: the four protective masks fold into the forging
/* the void knights' kit: no pest control here — the great pest herself yields it. The set speaks in swing() */
for (const [id, name, g, slot, def2, val] of [['void_melee_helm', 'Void melee helm', 'helm', 'head', 6, 45000], ['void_ranger_helm', 'Void ranger helm', 'helm', 'head', 6, 45000],
  ['void_mage_helm', 'Void mage helm', 'helm', 'head', 6, 45000], ['void_knight_top', 'Void knight top', 'robe', 'body', 45, 120000],
  ['void_knight_robe', 'Void knight robe', 'skirt', 'legs', 30, 100000], ['void_knight_gloves', 'Void knight gloves', 'glove', 'hands', 6, 40000]]) {
  defWear({ id, name, g, c: '#4a4038', c2: '#241f1a', slot, def: def2, req: { defence: 42 }, val });   // one 42 gate stands in for the wiki's 42-wide requirement
  bossTert('kalphitequeen', [id, 64]);   // game-economy: the great pest pays the pest-hunters' kit
}
/* granite: the maul's kin */
W('granite_shield', 0, 'shield', 0, 'shield', 55000, { defence: 50, strength: 50 }, { def: 40 });
W('granite_body', 0, 'body', 0, 'body', 95000, { defence: 50, strength: 50 }, { def: 83 });
W('granite_legs', 0, 'legs', 0, 'legs', 60000, { defence: 50, strength: 50 }, { def: 43 });
bossTert('trollgeneral', ['granite_shield', 128], ['granite_legs', 128], ['granite_body', 256]);   // game-economy: the general keeps his quarry's plate beside his maul
/* the volcano's remainder */
W('toktz_ket_xil', 'Toktz-ket-xil', 'shield', 0, 'shield', 65000, { defence: 60 }, { def: 40, str: 5 });
W('obsidian_cape', 0, 'cape', 0, 'cape', 90000, 0, { def: 9 });
W('toktz_mej_tal', 'Toktz-mej-tal', 'staff', 0, 'weapon', 70000, { attack: 60, magic: 60 }, { two: 1, atk: 55, str: 55, mag: 15, pb: 5, spd: 6 });
bossTert('branda', ['toktz_ket_xil', 128], ['obsidian_cape', 128], ['toktz_mej_tal', 200]);
/* the salve amulet: a sixth harder against the risen dead, read in swing() beside the mask — the two never stack */
W('salve_amulet', 0, 'amulet', 0, 'neck', 40000, 0, { def: 3, pb: 3 });
bossTert('shade', ['salve_amulet', 128]); bossTert('revenant', ['salve_amulet', 64]);   // game-economy: no haunted mine — the dead themselves surrender its crystal
/* the god books, completed: the holy shields, the unholy strikes, the balance does a little of each */
W('holy_book', 0, 'shield', 0, 'shield', 30000, 0, { def: 8, pb: 5 });
W('unholy_book', 0, 'shield', 0, 'shield', 30000, 0, { atk: 8, rat: 8, mag: 8, pb: 5 });
W('book_of_balance', 0, 'shield', 0, 'shield', 30000, 0, { atk: 4, def: 4, rat: 4, mag: 4, pb: 5 });
bossTert('paladin', ['holy_book', 200]); bossTert('darkwizard', ['unholy_book', 200]); bossTert('druid', ['book_of_balance', 200]);   // game-economy: each faith's wanderers carry their own word
/* the fighters' plate: worn freely, as the wiki has it */
W('fighter_torso', 0, 'body', 0, 'body', 120000, 0, { def: 70, str: 4 });
bossTert('bktitan', ['fighter_torso', 256]);   // game-economy: no barbarian assault — the titan's honour guard yields it
/* the temple knights' prayer plate, initiate then proselyte (the wiki's quest gates have no counterpart here) */
for (const [pre, nm, dfm, pbs, rq, w, ex] of [['initiate', 'Initiate', [13, 43, 22], [3, 6, 5], { defence: 20 }, 64, 0],
  ['proselyte', 'Proselyte', [19, 61, 31], [4, 8, 6], { defence: 30 }, 128, 12000]])
  [['sallet', 'fhelm', 'head'], ['hauberk', 'body', 'body'], ['cuisse', 'legs', 'legs']].forEach(([p, g, slot], i) => {
    defWear({ id: pre + '_' + p, name: nm + ' ' + p, g, c: '#d9dde3', c2: '#6a7078', slot, def: dfm[i], pb: pbs[i], req: rq, val: 9000 + i * 9000 + ex });
    bossTert('paladin', [pre + '_' + p, w]);   // game-economy: the god's paragons wear it under their tabards
  });
/* the karambwan: eaten alongside ordinary food, on its own bite clock */
defStack('cooked_karambwan', 'Cooked karambwan', 'cfish', '#b06a4a', '#6a3a2a', 160, { heal: 18, combo: 1 });
SHOP_KINDS[4].base.push('cooked_karambwan');   // game-economy: the fishmonger keeps the exotic shelf until its spots exist
/* the holidays that never came: pure vanity, alch-worthless; their rows ride MEGA_DROPS */
W('partyhat', 'Blue partyhat', 'hat', 0, 'head', 1);
W('santa_hat', 0, 'hat', 0, 'head', 1);
W('hween_mask', "Green h'ween mask", 'skull', 0, 'head', 1);

/* the baker's economy: wheat from the allotments, the windmill grinds at last, the range bakes */
OBJ_OPTS[25] = ['Mill at', 'Windmill', o => openMake(25, o)];
defStack('grain', 'Grain', 'wheat', '#d8c05a', '#8a7a2a', 3);
defStack('flour', 'Pot of flour', 'sack', '#e8e0d0', '#9a8a70', 6);
defStack('bucket_of_milk', 'Bucket of milk', 'bucket', '#a8a8b0', '#f0ece4', 12);   // game-economy: no milking yet, the store keeps a churn
defStack('cheese', 'Cheese', 'cheese', '#e8c84a', '#a08a1e', 8);
defStack('grapes', 'Grapes', 'grapes', '#8a4ad0', '#4a2a70', 15);   // game-economy: the vineyard is the store shelf
recipe('flour', 'cooking', 1, 0, [['grain', 1]], { at: 25, tk: 1, msg: 'The stones grind your grain to flour.' });
defItem({ id: 'bread_dough', name: 'Bread dough', g: 'sack', c: '#e8dcc0', c2: '#a89a78', val: 8 });
defItem({ id: 'pastry_dough', name: 'Pastry dough', g: 'sack', c: '#e8d4a8', c2: '#a89a78', val: 8 });
for (const [id, msg] of [['bread_dough', 'You knead the flour and water into dough.'], ['pastry_dough', 'You work the flour into a short pastry.']])
  recipe(id, 'cooking', 1, 0, [['flour', 1], ['vial_of_water', 1]], { at: 6, tk: 1, msg });   // the vial stands in for a jug
const BAKES = [   // [id, name, glyph, colour, lv, xp, heal, need, extra]; pies skip the dish and eat in one go
  ['bread', 0, 0, 0, 1, 40, 0, [['bread_dough', 1]]],
  ['meat_pie', 'Meat pie', 'pie', '#c8a060', 20, 110, 12, [['pastry_dough', 1], ['cooked_meat', 1]]],
  ['stew', 'Stew', 'bowl', '#a86a3a', 25, 117, 11, [['potato', 1], ['cooked_meat', 1]]],
  ['garden_pie', 'Garden pie', 'pie', '#8ab04a', 34, 138, 12, [['pastry_dough', 1], ['tomato', 1], ['onion', 1], ['cabbage', 1]], { boost: ['farming', 3] }],
  ['wine', 'Wine', 'wine', '#8a2a4a', 35, 200, 11, [['grapes', 1], ['vial_of_water', 1]]],
  ['plain_pizza', 'Plain pizza', 'pizza', '#e8a05a', 35, 143, 14, [['bread_dough', 1], ['tomato', 1], ['cheese', 1]]],
  ['cake', 'Cake', 'cake', '#e8b0c8', 40, 180, 12, [['flour', 1], ['egg', 1], ['bucket_of_milk', 1]]],
  ['meat_pizza', 'Meat pizza', 'pizza', '#c86a3a', 45, 26, 16, [['plain_pizza', 1], ['cooked_meat', 1]]],
  ['fish_pie', 'Fish pie', 'pie', '#6a9ab0', 47, 164, 12, [['pastry_dough', 1], ['trout', 1], ['salmon', 1], ['potato', 1]], { boost: ['fishing', 3] }],   // salmon stands in for cod
  ['anchovy_pizza', 'Anchovy pizza', 'pizza', '#8a8ab0', 55, 39, 18, [['plain_pizza', 1], ['anchovies', 1]]],
  ['admiral_pie', 'Admiral pie', 'pie', '#4a6ab0', 70, 210, 16, [['pastry_dough', 1], ['salmon', 1], ['tuna', 1], ['potato', 1]], { boost: ['fishing', 5] }],
  ['summer_pie', 'Summer pie', 'pie', '#e8c84a', 95, 260, 22, [['pastry_dough', 1], ['strawberry', 1], ['watermelon', 1], ['banana', 1]], { boost: ['agility', 5], energy: 20 }]   // banana stands in for the orchard apple
];
for (const [id, name, gl, c, lv, xp, heal, need, x] of BAKES) {
  if (name) defItem(Object.assign({ id, name, g: gl, c, c2: '#6b4e22', val: 6 + lv * 3, heal }, x));
  recipe(id, 'cooking', lv, xp, need, { at: 6, tk: 2, msg: name ? 'You bake ' + aOrAn(name) + '.' : 'You bake a loaf of bread.' });   // no burning at the bakes
}
SHOP_KINDS[0].base.push('wheat_seed', 'cheese', 'bucket_of_milk', 'grapes');
(LOOT.goat.alw = LOOT.goat.alw || []).push(['goat_horn', 1]);
LOOT.chicken.tert = (LOOT.chicken.tert || []).concat([['egg', 2]]);

/* prayer finally rides the cloth: pb stretches every drain by a thirtieth per point */
W('monk_robe_top', "Monk's robe top", 'robe', 0, 'body', 40, 0, { def: 0, pb: 6 });   // TODO: verify — the top/bottom split of the pair
W('monk_robe_bottom', "Monk's robe bottom", 'skirt', 0, 'legs', 32, 0, { def: 0, pb: 5 });
W('holy_symbol', 0, 'amulet', 0, 'neck', 120, 0, { pb: 8, def: 2 });
defItem({ id: 'holy_mould', name: 'Holy mould', g: 'mould', c: '#9aa0a8', c2: '#5b5f66', val: 5 });
SHOP_KINDS.filter(s2 => s2.k === 'craft')[0].base.push('holy_mould');
recipe('holy_symbol', 'crafting', 16, 50, [['silver_bar', 1], ['ball_of_wool', 1]], { at: 3, tool: 'holy_mould', msg: 'You cast and string a holy symbol.' });
LOOT.monk.den = 128; LOOT.monk.main = [['monk_robe_top', 8], ['monk_robe_bottom', 8]];   // game-economy: the brothers surrender their habit

/* ---- ARMOURY IV: the modern top tier, wiki-audited Sep 9 (every infobox fetched, every number exact). The engine
   models one attack scalar and one defence scalar, so each row keeps `atk` = the wiki's best attack style and
   `def` = the rounded mean of its stab/slash/crush, exactly as ARMOURY II and III do. Magic is the one axis where
   the wiki's attack and defence part company badly (a Justiciar chestguard reads -40 attack and -16 defence), so
   `mag` stays magic ATTACK and a new `mdef` carries only the difference; bonus('mag') + bonus('mdef') is the guard.
   Rows live in data07.js seg7..seg10. Passives that had a home in this world are wired below; the rest are named
   as unmodelled where they are. ---- */
/* the pieces that upgrade a weapon or a boot into its famous form, each the wiki's own recipe */
for (const [id, name, g, c, c2, val] of [
  ['avernic_defender_hilt', 'Avernic defender hilt', 'sword', '#b8963a', '#4a3c14', 900000],
  ['magic_fang', 'Magic fang', 'skull', '#3aa04a', '#164a20', 60000],
  ['ancient_icon', 'Ancient icon', 'rune', '#8a1a24', '#3a0a10', 120000],
  ['black_tourmaline_core', 'Black tourmaline core', 'rune', '#2a2a34', '#6a5ac8', 250000],
  ['blood_shard', 'Blood shard', 'rune', '#c82030', '#6a1018', 200000],
  ['crystal_weapon_seed', 'Crystal weapon seed', 'star', '#8ae8e0', '#2e7a76', 700000],
  ['harmonised_orb', 'Harmonised orb', 'star', '#8ae8c8', '#2e7a5e', 500000],
  ['volatile_orb', 'Volatile orb', 'star', '#e86a2a', '#7a2e0a', 500000],
  ['eldritch_orb', 'Eldritch orb', 'star', '#8a4ac8', '#421e6a', 500000]
]) defItem({ id, name, g, c, c2, val });

armSeg('seg7');   // melee: the raid blades, Zarosian and Justiciar plate, the Inquisitor's crush kit, the granite quarry
armSeg('seg8');   // ranged: the crystal and Zaryte launchers, Masori, the arrow-catching shields
armSeg('seg9');   // magic: the powered staves, the Nightmare orbs, Virtus, the bark armours
armSeg('seg10');  // worn by all three disciplines

/* SPECIALS. Only what the spec engine already speaks: an accuracy multiplier, a damage multiplier, repeat hits, a
   floor, a stun, a defence drain, a heal. `mag: 1` marks a spec that fires through the spell you have armed. */
SPEC.osmumtens_fang = { cost: 25, acc: 1.5 };   // Eviscerate: half again the accuracy, and the roll opens to the fang's true maximum instead of its 15-85% band
SPEC.elder_maul = { cost: 50, acc: 1.25, drainDef: 0.65 };   // Pulverize: a superior dragon warhammer, 35% off the current guard
SPEC.voidwaker = { cost: 50, sure: 1, dmg: 1.5, minFrac: 1 / 3 };   // Disrupt: it never misses, and deals 50-150% of the melee maximum
SPEC.saradomins_blessed_sword = { cost: 65, dmg: 1.25, bonus: [1, 12] };   // Saradomin's Lightning, the blessed edge: a quarter more steel and the god's own
SPEC.barrelchest_anchor = { cost: 50, acc: 2, dmg: 1.1, drainDef: 0.9 };   // Sunder: double accuracy, a tenth more, and the guard caves
SPEC.zamorakian_hasta = SPEC.dragon_spear;   // Shove, shared with the spear it is forged from
SPEC.soulreaper_axe = { cost: 0, souls: 1 };   // Behead: no energy at all, only the souls the axe has drunk
SPEC.zaryte_crossbow = { cost: 75, rng: 1, acc: 2 };   // Evoke: doubled accuracy (its guaranteed bolt effect is not modelled)
SPEC.webweaver_bow = { cost: 50, rng: 1, n: 4, acc: 2, dmg: 0.4 };   // Swarm: four shafts at two fifths apiece
SPEC.volatile_nightmare_staff = { cost: 55, mag: 1, acc: 1.5, max: 58 };   // Immolate (its rune-free clause is not modelled: the armed spell still pays)
SPEC.eldritch_nightmare_staff = { cost: 55, mag: 1, max: 44, pheal: 0.5 };   // Invocate: half the wound back as prayer, to the wiki's cap of 120
/* named and left unmodelled: the scythe's and crystal blade's charges, the wyvern shield's and dragonfire ward's
   charged blasts, the Spectral's prayer-drain halving, the amulet of the damned's barrows upgrades, and the
   leaf-bladed battleaxe's turoth/kurask bite (neither creature walks in this world). */

/* RECIPES: the wiki's own joins, and the two barks the runecrafter presses out of magic logs */
recipe('avernic_defender', 'smithing', 70, 0, [['dragon_defender', 1], ['avernic_defender_hilt', 1]], { at: 4, tool: 'hammer', msg: 'You seat the hilt: the defender answers with a black edge.' });
recipe('trident_of_the_swamp', 'crafting', 59, 0, [['trident_of_the_seas', 1], ['magic_fang', 1]], { tk: 2, msg: 'The fang bites into the fork; the water in it turns green.' });
recipe('ancient_sceptre', 'magic', 70, 0, [['ancient_staff', 1], ['ancient_icon', 1]], { tk: 2, msg: 'The icon settles into the staff-head and the old words come easier.' });
recipe('guardian_boots', 'smithing', 60, 0, [['granite_boots', 1], ['black_tourmaline_core', 1]], { at: 4, tool: 'hammer', msg: 'The core sinks into the granite; the boots grow heavier and kinder.' });
recipe('amulet_of_blood_fury', 'crafting', 80, 0, [['amulet_of_fury', 1], ['blood_shard', 1]], { tk: 2, msg: 'The shard drinks its way into the onyx. The fury has a thirst now.' });
recipe('bow_of_faerdhinen', 'smithing', 82, 0, [['crystal_weapon_seed', 1]], { at: 4, tool: 'hammer', msg: 'The seed unfolds along your arm into a bow of singing crystal.' });
recipe('zamorakian_hasta', 'smithing', 1, 0, [['zamorakian_spear', 1], ['coins', 300000]], { at: 4, tool: 'hammer', msg: 'The smith shortens the haft and rebalances the head.' });   // the wiki's 300,000 to Otto Godblessed
for (const [orb, staff, what] of [['harmonised_orb', 'harmonised_nightmare_staff', 'quickens'], ['volatile_orb', 'volatile_nightmare_staff', 'smoulders'], ['eldritch_orb', 'eldritch_nightmare_staff', 'hollows']])
  recipe(staff, 'magic', 82, 0, [['nightmare_staff', 1], [orb, 1]], { tk: 2, msg: 'The orb seats itself in the staff, and the wood ' + what + '.' });
/* bark armour: the wiki presses splitbark into it at the blood and nature altars. No splitbark walks here, so the
   magic logs go straight to the altar instead, at the wiki's own runecrafting levels. */
for (const [pre, sk2, rune, lv, n, xp] of [['swampbark', 'nature', 'nature_rune', 46, 15, 60], ['bloodbark', 'blood', 'blood_rune', 60, 40, 90]])
  for (const [p2, cost] of [['helm', 1], ['body', 3], ['legs', 2], ['gauntlets', 1], ['boots', 1]])
    recipe(pre + '_' + p2, 'runecraft', lv, xp * cost, [['magic_logs', cost], [rune, n * cost]], { at: 11, msg: 'The altar presses the ' + sk2 + ' into the wood.' });

/* SOURCES: every piece above has a home. The three later vaults roll like the raid chest already does; where the
   wiki's owner never walked in this world the nearest kin stands in, each named. */
const ARM4_LOG = new Set(['elder_maul', 'twisted_buckler', 'crystal_weapon_seed']
  .concat(TOB_SUB.map(d => d[0]), TOA_SUB.map(d => d[0]), NM_SUB.map(d => d[0])));   // CLOG_ORDER is a save format: see the collection log
SUBTABLES.tob = () => rollTable(TOB_SUB);
SUBTABLES.toa = () => rollTable(TOA_SUB);
SUBTABLES.nm = () => rollTable(NM_SUB);
MEGA_DROPS.push(['crystal_weapon_seed', 1]);   // the seed joins the crystal bow on the mega table
for (const [k, ...rows] of [
  ['sarachnis', ['tob', 20], ['amulet_of_rancour', 512]],   // the spider matriarch stands in for Verzik Vitur, and her brood for Araxxor
  ['kalphitequeen', ['toa', 25]],   // the desert's own queen stands in for the Tombs of Amascut
  ['vetion', ['nm', 24], ['bellator_ring', 400], ['ring_of_the_gods', 400], ['soulreaper_axe', 900], ['voidwaker', 700]],   // the wiki's own ring of the gods; the undead terror stands in for the Nightmare
  ['callisto', ['ultor_ring', 400], ['tyrannical_ring', 400], ['voidwaker', 700]],   // the wiki's own tyrannical ring
  ['venenatis', ['treasonous_ring', 400], ['voidwaker', 700], ['serpentine_helm', 512], ['magic_fang', 512]],   // the wiki's own treasonous ring; her venom keeps Zulrah's helm and fang
  ['scorpia', ['magus_ring', 400], ['ring_of_suffering', 300]],
  ['kril', ['torva_full_helm', 381], ['torva_platebody', 381], ['torva_platelegs', 381], ['virtus_mask', 381], ['virtus_robe_top', 381],
    ['virtus_robe_bottom', 381], ['zaryte_crossbow', 508], ['zaryte_vambraces', 400]],   // Zamorak's general keeps Nex's chamber
  ['jungledemon', ['ferocious_gloves', 400], ['brimstone_ring', 512], ['boots_of_brimstone', 256], ['tormented_bracelet', 512], ['dragon_hunter_lance', 1000]],   // the demonic kin stand in for the hydras
  ['skotizo', ['elysian_spirit_shield', 512], ['arcane_spirit_shield', 512], ['spectral_spirit_shield', 512]],   // the dark warden stands in for the Corporeal Beast
  ['vorkath', ['ancient_wyvern_shield', 512], ['dragonfire_ward', 512]],   // the undead dragon stands in for the skeletal wyverns
  ['revenant', ['craws_bow', 700], ['webweaver_bow', 700], ['ancient_icon', 500]],   // the restless dead keep the ether weapons, as the wiki has them
  ['kbd', ['venator_bow', 700], ['venator_ring', 400]],   // the black king stands in for the Phantom Muspah and the Leviathan both
  ['icetroll', ['helm_of_neitiznot', 128], ['neitiznot_faceguard', 512]],   // the Fremennik ice stands in for Neitiznot
  ['trollgeneral', ['granite_helm', 128], ['granite_boots', 128], ['granite_gloves', 128], ['granite_ring', 128], ['black_tourmaline_core', 400]],   // the quarry's kin, beside the maul he already keeps
  ['branda', ['infernal_cape', 500]],   // no Inferno here: the fire queen pays the cape beyond her own
  ['elvarg', ['mythical_cape', 128]],   // the Myths' Guild cape, from the myth herself
  ['paladin', ['imbued_saradomin_cape', 512], ['saradomins_blessed_sword', 700]],
  ['darkwizard', ['imbued_zamorak_cape', 512], ['book_of_darkness', 200]],
  ['druid', ['imbued_guthix_cape', 512]],
  ['shade', ['amulet_of_the_damned', 256], ['blood_shard', 512]],   // the crypt-dead keep the trekker's amulet and the vampyre's shard
  ['hero', ['barrows_gloves', 300]],   // no Recipe for Disaster here: the culinaromancer's champions wear them out
  ['eldric', ['infinity_gloves', 350]],
  ['kalphitesoldier', ['leaf_bladed_battleaxe', 128]],   // the slayer shelf has no counterpart: its own chitinous kin pay the blade
  ['pirate', ['barrelchest_anchor', 512]],
  ['bandit', ['spiked_manacles', 128]],
  ['monk', ['holy_sandals', 128]],
  ['zamorakmonk', ['devout_boots', 200]]
]) { bossTert(k, ...rows); for (const r of rows) if (ITEMS[r[0]]) ARM4_LOG.add(r[0]); }

/* ---- THE LONG GAME: boss pets, the collection log, combat feats, town diaries, and the world's small surprises ---- */
GLYPH.paw = (g, c, d) => { for (const [x, y2, r] of [[10, 10, 3], [16, 8, 3], [22, 10, 3], [7, 16, 2.6], [25, 16, 2.6]]) { g.fillStyle = c; g.strokeStyle = d; g.beginPath(); g.arc(x, y2, r, 0, TAU); g.fill(); g.stroke(); } g.fillStyle = c; g.strokeStyle = d; g.beginPath(); g.ellipse(16, 21, 7, 6, 0, 0, TAU); g.fill(); g.stroke(); };
let devRandMul = 1;
P.pet = null; P.ins = []; P.petLost = []; P.cl = new Set(); P.dy = {}; P.ca = {};

for (const b of BOSSES) {
  const k = b[0], t = NPC_BY[k], c = t.tint ? '#' + (t.tint & 0xffffff).toString(16).padStart(6, '0') : '#c8a878';
  defItem({ id: 'pet_' + k, name: t.n + ' pet', g: 'paw', c, c2: '#3a3026', val: 0, opt: ['Follow', () => petFollow('pet_' + k)] });
  (LOOT[k].tert = LOOT[k].tert || []).push(['pet_' + k, PET_RATE[k] || 3000]);
}
for (const k in VISAGE_RATE) (LOOT[k].tert = LOOT[k].tert || []).push(['draconic_visage', VISAGE_RATE[k]]);   // the dragonkind's own rarity, beside the two the wyrms already carried
function petFollow(id) {
  if (P.pet === id) { P.pet = null; say('Your pet climbs back into the pack.'); }
  else { P.pet = id; say('The ' + ITEMS[id].name.toLowerCase() + ' pads along at your heel.', 'lv'); }
  markDirty();
}
let petMesh = null, petFor = '';
let petR = 0.5;   // the pet's half-footprint: it heels at arm's length, never inside you
let petO7 = null, petV7 = -1, petT7 = null, petH7 = 1;   // the pet's 2007 look: -1 until the pack can answer
const petA = { walkPhase: 0, kh: 5, atkT: 0, tx: 1, px: 1, tz: 0, pz: 0, limbs: null, mesh: null };   // stand-in npc state: animateNpc reads only these
const petFree7 = () => { if (petO7) { scene.remove(petO7); OSRSK.npcFree(petO7); petO7 = null; } petV7 = -1; };
/* the miniature wears the same setting: exactly while your own rig does, at the miniature's measured height */
function pet7() {
  if (petV7 < 0 && osrsOn) petV7 = OSRSK.npcVariants(petT7.n);
  const on = osrsSelf && petV7 > 0 ? 1 : 0;
  if (on && !petO7) { petO7 = OSRSK.npcMesh(petT7.n, hashSeed(petFor) % petV7, petH7, npcPlan(petT7)); scene.add(petO7); }
  if (petO7) {
    petO7.visible = !!on;
    if (on) { petO7.position.copy(petMesh.position); petO7.rotation.copy(petMesh.rotation); }
  }
  petMesh.visible = !on;
}
function petFrame(dt) {
  if (!P.pet || !invCount(P.pet)) {
    if (petMesh) { scene.remove(petMesh); petMesh = null; petFor = ''; petFree7(); }
    if (P.pet && !invCount(P.pet)) P.pet = null;
    return;
  }
  if (petFor !== P.pet) {
    if (petMesh) scene.remove(petMesh);
    petFree7();
    const t = NPC_BY[P.pet.slice(4)], base = t.base || t;
    if (!base.rig) base.rig = base.build(base.body);
    if (t.tint && !t.mat) t.mat = basicMat({ color: t.tint });
    petMesh = riggedMesh(base.rig, t.mat || null);
    petMesh.scale.setScalar(0.42 * Math.min(t.scale || 1, 1.5));
    const sz = new THREE.Box3().setFromObject(petMesh).getSize(new THREE.Vector3());
    const shrink = Math.min(1, 1.05 / sz.y, 1.5 / Math.max(sz.x, sz.z));   // a pet is a miniature, whatever giant it mimics
    if (shrink < 1) petMesh.scale.multiplyScalar(shrink);
    petR = Math.max(0.35, Math.max(sz.x, sz.z) * shrink * 0.5);
    petMesh.position.set(P.rx + 1 + petR, Math.max(P.ry, 0), P.rz + 1);
    scene.add(petMesh);
    petFor = P.pet; petA.walkPhase = 0;
    petT7 = t; petH7 = sz.y * shrink;
  }
  if (petHop) {   // the little one takes the ditch at a bound, right behind you
    const t = (tSec - petHop.s) / 0.45;
    if (t >= 1) petHop = null;
    else {
      petMesh.position.x = petHop.x0 + (petHop.x1 - petHop.x0) * t;
      petMesh.position.z = petHop.z0 + (petHop.z1 - petHop.z0) * t;
      petMesh.position.y = Math.max(groundY(petHop.x1, petHop.z1), 0) + Math.sin(t * PI) * 1.35;
      petMesh.rotation.y = Math.atan2(petHop.x1 - petHop.x0, petHop.z1 - petHop.z0);
      pet7();
      return;
    }
  }
  const keep = 1.1 + petR;
  const dx = petMesh.position.x - P.rx, dz = petMesh.position.z - P.rz, dd = Math.hypot(dx, dz) || 1;
  if (dd > 14) petMesh.position.set(P.rx + keep, 0, P.rz + 1);   // pets do not get lost; they get impatient
  const ox = petMesh.position.x, oz = petMesh.position.z;
  const gx = P.rx + dx / dd * keep, gz = P.rz + dz / dd * keep, e = Math.min(1, dt * 5);
  petMesh.position.x += (gx - petMesh.position.x) * e;
  petMesh.position.z += (gz - petMesh.position.z) * e;
  const moved = Math.hypot(petMesh.position.x - ox, petMesh.position.z - oz) > dt * 0.9;
  petMesh.position.y = Math.max(groundY(petMesh.position.x, petMesh.position.z), 0) + (moved ? 0 : Math.sin(tSec * 3.2) * 0.05);
  petMesh.rotation.y = Math.atan2(P.rx - petMesh.position.x, P.rz - petMesh.position.z);
  const pl = (petO7 && petO7.visible ? petO7 : petMesh).limbs;   // whichever rig is on show walks
  if (pl && pl.length) {   // the miniature walks like its monster: wings beat, spider legs row, paws trot
    petA.limbs = pl; petA.mesh = petMesh; petA.px = moved ? 0 : 1;
    animateNpc(petA, dt, pl);
  }
  pet7();
}
/* the insurer keeps her ledger in every city; the price is the book's — TODO: verify the 2007 figures */
const INSURE_GP = 500000, RECLAIM_GP = 1000000;
KEEP_TINT[26] = 0xe8a0c8;
MK_ART[26] = ['paw', '#e8a0c8', '#6b3050', 'Pet insurer']; MARK_H[26] = 3.4; PICK_R[26] = 1.2; PICK_Y[26] = 0.9;
MK_ART[27] = ['scroll', '#d8c890', '#6b4e22', 'Achievement board']; MARK_H[27] = 3.2; PICK_R[27] = 1.4; PICK_Y[27] = 1.0;
const insurerSpot = v => v.spots.length > 1 ? v.spots[((hash2(v.x, v.z, S + 311) >>> 4) + 1) % v.spots.length] : null;
const boardSpot = v => v.spots.length > 2 ? v.spots[((hash2(v.x, v.z, S + 312) >>> 4) + 2) % v.spots.length] : null;
structHooks.push((rec, vs, inChunk) => {
  for (const v of vs) {
    if (v.rank >= 3) { const s = insurerSpot(v); if (s && inChunk(s.x, s.z)) rec.objs.push({ t: 26, k: 0, x: s.x, z: s.z, y: heightAt(s.x, s.z), key: tk(s.x, s.z), n: 'Petra the pet insurer', dir: Math.atan2(v.x - s.x, v.z - s.z) }); }
    if (v.rank >= 2) {
      const s = boardSpot(v);
      if (s && inChunk(s.x, s.z)) {
        const y = heightAt(s.x, s.z);
        rec.objs.push({ t: 27, k: 0, x: s.x, z: s.z, y, key: tk(s.x, s.z), n: villageName(v) + ' achievements', vx: v.x, vz: v.z });
        batchInto(rec, B => { for (const a of [-0.7, 0.7]) B.add(BOX, s.x + a, y + 0.9, s.z, 0.18, 1.8, 0.18, 0, C_BEAM); B.add(BOX, s.x, y + 1.5, s.z, 2.1, 1.1, 0.14, 0, C_FLOOR); B.add(BOX, s.x, y + 1.5, s.z, 1.8, 0.85, 0.18, 0, C_CLOTH); });
      }
    }
  }
});
OBJ_OPTS[26] = ['Talk to', null, o => petInsurance()];
OBJ_OPTS[27] = ['Read', null, o => diaryBoard(o)];
function petInsurance() {
  const rows = [];
  for (let i = 0; i < INV_N; i++) if (inv[i] && inv[i].id.startsWith('pet_')) {
    const id = inv[i].id, ins = P.ins.includes(id);
    rows.push(mkRow(ins ? '' : 'data-pins="' + id + '"', id, ITEMS[id].name, ins ? 'insured' : 'click to insure — ' + fmt(INSURE_GP) + ' gp', ins ? '<b class="gp">✓</b>' : '', ins ? ' no' : ''));
  }
  for (const id of P.petLost) rows.push(mkRow('data-prec="' + id + '"', id, ITEMS[id].name, 'lost — reclaim for ' + fmt(RECLAIM_GP) + ' gp', '<b class="gp">' + fmt(RECLAIM_GP) + '</b>'));
  showModal('Petra, pet insurer', rows.join('') || '<p class="smsg">No pets in your pack, none on my books. Go and charm something.</p>',
    'Insurance survives death: a lost insured pet waits here. Uninsured pets are gone for good.');
}
on(modalBody, 'click', e => {
  const pi = e.target.closest('[data-pins]'), pr = e.target.closest('[data-prec]');
  if (pi) {
    if (coins() < INSURE_GP) return say('Insurance costs ' + fmt(INSURE_GP) + ' gp.', 'bad');
    invRemove('coins', INSURE_GP); gpSunk += INSURE_GP;
    P.ins.push(pi.dataset.pins); markDirty(2); say('Petra notes the ' + ITEMS[pi.dataset.pins].name.toLowerCase() + ' in her ledger.', 'lv');
    petInsurance();
  } else if (pr) {
    if (coins() < RECLAIM_GP) return say('Reclaiming a pet costs ' + fmt(RECLAIM_GP) + ' gp.', 'bad');
    if (!invSwap(pr.dataset.prec, 1, 'coins', RECLAIM_GP)) return say(FULL, 'bad');   // paying can free the coin slot the pet lands in
    gpSunk += RECLAIM_GP;
    P.petLost = P.petLost.filter(x => x !== pr.dataset.prec);
    markDirty(2); say('Your ' + ITEMS[pr.dataset.prec].name.toLowerCase() + ' leaps back to you!', 'lv');
    petInsurance();
  }
});

/* the collection log: every notable drop this character has ever seen, held against everything the world can give */
const CLOG = new Map(), CLOG_ALL = new Set();
for (const k in LOOT) {
  const T = LOOT[k], ids = new Set();
  for (const d of (T.alw || []).concat(T.main || [], T.tert || [], T.taskTert || [])) {
    const id = d[0];
    if (ARM4_LOG.has(id)) continue;   // held back below: logging it here would shift every bit after it
    if (ITEMS[id] && id !== 'coins' && (ITEMS[id].equip || ITEMS[id].val >= 100 || id.startsWith('pet_'))) ids.add(id);
  }
  if (ids.size) { CLOG.set(k, [...ids]); for (const id of ids) CLOG_ALL.add(id); }
}
CLOG.set('treasure', ['rune_full_helm_t', 'rune_platebody_t', 'rune_platelegs_t', 'rune_plateskirt_t', 'rune_kiteshield_t',
  'rune_full_helm_g', 'rune_platebody_g', 'rune_platelegs_g', 'rune_plateskirt_g', 'rune_kiteshield_g']);
for (const id of CLOG.get('treasure')) CLOG_ALL.add(id);
/* The prestige sub-tables are reached through a divert token — LOOT holds 'barrows'/'raid'/'vault', not the pieces —
   so ITEMS['barrows'] is undefined and the loop above skipped every one of them: the whole barrows set, the raid vault
   and the third-age chest could never be logged. Appended AFTER the derived order, so no existing bit moves. */
const CLOG_NAME = { treasure: 'Treasure Trails', barrows: 'Barrows chest', raid: 'Raid vault', vault: 'Shining casket', armoury4: 'The modern armoury' };
for (const [k, ids] of [['barrows', BARROWS_SUB.map(d => d[0])], ['raid', RAID_SUB.map(d => d[0])],
                        ['vault', VAULT_SUB.map(d => d[0]).concat('ranger_boots')]]) {
  const fresh = ids.filter(id => ITEMS[id] && !CLOG_ALL.has(id) && !ARM4_LOG.has(id));
  if (fresh.length) { CLOG.set(k, fresh); for (const id of fresh) CLOG_ALL.add(id); }
}
/* ARMOURY IV last of all. Its drops were pushed onto families that already had entries, and every bit after an
   insertion belongs to a different item than it did — so the whole armoury is held back and appended here instead,
   exactly as the sub-table families above are, and no log written by an older build is rewritten. */
{
  const fresh = [...ARM4_LOG].filter(id => ITEMS[id] && !CLOG_ALL.has(id) && (ITEMS[id].equip || ITEMS[id].val >= 100));
  if (fresh.length) { CLOG.set('armoury4', fresh); for (const id of fresh) CLOG_ALL.add(id); }
}

/* CLOG_ORDER IS A SAVE FORMAT. The collection log rides the blob as one bit per
   entry, indexed by position here, so this order is wire — append, never insert,
   exactly as NPCS, CROPS and PRAYERS are. It falls out of LOOT's key order and
   each family's drop rows in order, so adding a new FAMILY to the end of LOOT is
   safe and free; adding a drop row to the middle of an EXISTING family's table
   would shift every id after it and silently rewrite everybody's log. Append to
   that family's table instead.

   `cln` rides the save so a log written by an older, shorter build still decodes
   against its own length: entries added since simply read as not-yet-logged,
   which is what they were. */
const CLOG_ORDER = [...CLOG_ALL];
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
function clogPack() {
  let s = '';
  for (let i = 0; i < CLOG_ORDER.length; i += 6) {   // six bits a character, so no padding rules to get wrong
    let v = 0;
    for (let b = 0; b < 6; b++) if (P.cl.has(CLOG_ORDER[i + b])) v |= 1 << b;
    s += B64[v];
  }
  return s.replace(/A+$/, '');   // trailing empty groups say nothing
}
function clogUnpack(s, n) {
  const out = new Set();
  if (typeof s !== 'string') return out;
  const lim = Math.min(n || CLOG_ORDER.length, CLOG_ORDER.length);
  for (let c = 0; c < s.length; c++) {
    const v = B64.indexOf(s[c]);
    if (v < 0) continue;
    for (let b = 0; b < 6; b++) { const i = c * 6 + b; if (i < lim && (v & (1 << b))) out.add(CLOG_ORDER[i]); }
  }
  return out;
}

/* Town diaries, compacted. A board that has been read but never progressed says
   nothing a fresh visit would not say, and there is one board per settlement in
   an endless world — this was the only field in the blob with no ceiling at all.
   A row is [key, r, done, ...counters]; a fully-claimed diary drops its counters
   because nothing reads them again. */
/* Every board with a single counter used to serialise forever, and one finished slayer task promotes every board of
   its rank at once, so honest exploration could walk the blob past SAVE_CAP and disarm saving for the session. A
   claimed tier is kept always — it is a reward — while merely-progressed boards keep only the DY_KEEP most recent. */
const DY_KEEP = 60;
function dyPack() {
  const out = [], part = [];
  for (const key in P.dy) {
    const e = P.dy[key], done = e.done | 0, c = e.c || [];
    if (!done && !c.some(v => v > 0)) continue;   // merely read: not worth a byte
    const row = done === 7 ? [key, e.r | 0, 7] : [key, e.r | 0, done, ...c.map(v => v | 0)];
    if (done) out.push(row); else part.push([e.t | 0, row]);
  }
  part.sort((a, b) => b[0] - a[0]);
  for (const [, row] of part.slice(0, DY_KEEP)) out.push(row);
  return out;
}
function dyUnpack(d) {
  const out = {};
  if (Array.isArray(d)) for (const row of d) {
    if (!Array.isArray(row) || typeof row[0] !== 'string') continue;
    out[row[0]] = { r: row[1] | 0, done: (row[2] | 0) & 7, c: row.slice(3).map(v => v | 0), t: tickN };
  } else if (d && typeof d === 'object') {   // v1: an object of {r, c, done}
    for (const k in d) { const e = d[k]; if (e && typeof e === 'object') out[k] = { r: e.r | 0, done: (e.done | 0) & 7, c: Array.isArray(e.c) ? e.c.map(v => v | 0) : [], t: tickN };
    }
  }
  return out;
}
function clogAdd(id) {
  if (P.cl.has(id) || !CLOG_ALL.has(id)) return;
  P.cl.add(id);
  say('New collection log entry: ' + ITEMS[id].name + '.', 'lv');
  markDirty();
}
function clogModal() {
  const fams = [...CLOG.keys()].sort((a, b) => {
    const ab = NPC_BY[a] && NPC_BY[a].boss ? 0 : 1, bb = NPC_BY[b] && NPC_BY[b].boss ? 0 : 1;
    return ab - bb || a.localeCompare(b);
  });
  let got = 0;
  for (const id of CLOG_ALL) if (P.cl.has(id)) got++;
  const rows = fams.map(k => {
    const ids = CLOG.get(k), have = ids.filter(id => P.cl.has(id)).length;
    if (!have && !(NPC_BY[k] && NPC_BY[k].boss) && k !== 'treasure') return '';   // quiet families stay folded until the first drop
    const name = CLOG_NAME[k] || (NPC_BY[k] ? NPC_BY[k].n : k);
    return '<div class="mk"><span>' + name + '<u>' + have + ' / ' + ids.length + '</u></span></div><div style="display:flex;flex-wrap:wrap;gap:2px;margin:0 0 6px 4px">' +
      ids.map(id => '<span title="' + ITEMS[id].name + '" style="' + (P.cl.has(id) ? '' : 'opacity:.22;filter:grayscale(1)') + '">' + img(id) + '</span>').join('') + '</div>';
  });
  showModal('Collection log — ' + got + ' / ' + CLOG_ALL.size, rows.join('') || '<p class="smsg">Nothing logged yet.</p>',
    'Drops from kills and caskets are logged the first time they fall to you.');
}
el('clogBtn').onclick = clogModal;

onKill.push(n => {
  if (!n.t.boss) return;
  const k = n.t.k, had = P.ca[k] || 0;
  let bits = had | 1;
  if (!n.caHurt) bits |= 2;
  if (n.caSt === 1 || n.caSt === 2 || n.caSt === 4) bits |= 4;
  if (n.caT0 && tickN - n.caT0 <= Math.max(34, Math.ceil(n.t.hp / 3))) bits |= 8;   // an invented pace: hp/3 ticks — no book to copy
  if (bits === had) return;
  P.ca[k] = bits;
  for (const [b2, nm] of CA_BITS) if ((bits & b2) && !(had & b2)) say('Feat: ' + nm + ' — ' + n.t.n + '.', 'lv');
  markDirty();
});
function caModal() {
  let done = 0, all = 0;
  const rows = BOSSES.map(b => {
    const k = b[0], bits = P.ca[k] || 0;
    all += 4;
    const badges = CA_BITS.map(([b2, nm]) => { if (bits & b2) done++; return '<u style="' + (bits & b2 ? 'color:var(--amber)' : 'opacity:.3') + ';margin-right:8px">' + nm + '</u>'; }).join('');
    return '<div class="mk"><span>' + NPC_BY[k].n + ' <span class="lvl">(level ' + NPC_BY[k].lv + ')</span><br>' + badges + '</span></div>';
  });
  showModal('Combat feats — ' + done + ' / ' + all, rows.join(''), 'Flawless: take no damage. One style: never switch. Swift: beat the sand-glass.');
}
el('caBtn').onclick = caModal;

/* town diaries: each settlement reads its own hinterland and asks for what is actually there; the cloak is the receipt */
function diaryOf(v) {
  if (v.dyT) return v.dyT;
  let bestTree = 0, bestOre = 2, fish = null, deepW = 0, shallowW = 0;
  for (let i = 0; i < 48; i++) {   // the same survey trick the map reader uses: hashed samples, no chunks needed
    const hh = hash2(v.x + i * 37, v.z - i * 53, S + 901);
    const ang = (hh & 1023) / 1024 * TAU, rad = v.r * 1.2 + ((hh >>> 10) & 255) / 255 * v.r * 2.2;
    const x = Math.round(v.x + Math.cos(ang) * rad), z = Math.round(v.z + Math.sin(ang) * rad), y = heightAt(x, z);
    if (y < SEA) { if (y < -4.5) deepW = 1; else shallowW = 1; continue; }
    if (y < 1.7 || y > 70) continue;
    bestTree = Math.max(bestTree, treeKind(y, biomeAt(x, z), hh));
    const ok = oreKind(y, hh);
    if (ok <= 6) bestOre = Math.max(bestOre, ok);
  }
  const fl = 12 + v.rank * 14;
  for (let i = FISH.length - 1; i >= 0 && !fish; i--) if (FISH[i].lv <= fl && ((FISH[i].deep && deepW) || (!FISH[i].deep && shallowW))) fish = FISH[i];
  const T = [];
  const add = (tier, t, p, n, txt) => T.push({ tier, t, p, n, txt });
  add(0, 'chop', 0, 12, 'Chop 12 trees in the hinterland');
  add(0, 'mine', 2, 10, 'Mine 10 iron ores nearby');
  add(0, 'kill', 0, 15, 'Defeat 15 creatures around the town');
  add(1, 'mine', bestOre, 12, 'Mine 12 ' + ORES[bestOre].n.toLowerCase() + 's hereabouts');
  if (fish) add(1, 'fish', fish.k, 10, 'Catch 10 ' + fish.n.toLowerCase() + ' in local waters');
  else add(1, 'bake', 0, 8, 'Bake 8 things at a range here');
  add(1, 'slay', v.rank, 1, 'Finish a task from ' + MASTERS[v.rank].n);
  add(2, 'chop', bestTree, 15, 'Chop 15 ' + TREES[bestTree].n.toLowerCase() + 's hereabouts');
  add(2, v.lm && v.lm.t === 0 ? 'bones' : 'rc', 0, 15, v.lm && v.lm.t === 0 ? 'Offer 15 bones at the church altar' : 'Bind 15 runes at the nearest ruin');
  if (v.rank >= 3) add(2, 'dboss', 'bD' + v.x + '_' + v.z, 1, 'Slay the master of the castle dungeon');
  else add(2, 'kill', 0, 50, 'Defeat 50 creatures around the town');
  return v.dyT = T;
}
const dyKey = v => v.x + '_' + v.z;
function diaryBump(t, p, x, z, amt) {
  for (const key in P.dy) {
    const e = P.dy[key], [vx, vz] = key.split('_').map(Number);
    if (e.done === 7) continue;   // every tier claimed: nothing left to count, and this loop runs on every chop, mine and kill
    if (t !== 'slay' && t !== 'dboss' && Math.max(Math.abs(x - vx), Math.abs(z - vz)) > e.r * 3.5) continue;
    const v = villageAt(Math.floor(vx * INV_CELL), Math.floor(vz * INV_CELL));
    if (!v || v.x !== vx || v.z !== vz) continue;
    diaryOf(v).forEach((task, i) => {
      if (task.t !== t || e.c[i] >= task.n) return;
      if ((t === 'chop' || t === 'mine') && p < task.p) return;   // a finer tree or ore counts for the lesser ask
      if ((t === 'fish' || t === 'dboss') && p !== task.p) return;
      if (t === 'slay' && p !== task.p) return;
      e.c[i] = Math.min(task.n, e.c[i] + (amt || 1)); e.t = tickN;   // last touched, so dyPack knows which boards are still live
      if (e.c[i] >= task.n) say('Diary task complete: ' + task.txt + '.', 'lv');
      markDirty();
    });
  }
}
function diaryBoard(o) {
  const v = nearVillage(o.x, o.z);
  if (!v) return;
  const key = dyKey(v.v), T = diaryOf(v.v);
  if (!P.dy[key]) { P.dy[key] = { r: v.v.r, c: new Array(T.length).fill(0), done: 0, t: tickN }; say('You take note of what ' + villageName(v.v) + ' asks of its heroes.', 'lv'); }
  else if (P.dy[key].c.length < T.length) P.dy[key].c = T.map((_, i) => P.dy[key].c[i] | 0);   // a fully-claimed diary saves without its counters; the panel wants them back
  const e = P.dy[key], TIERN = ['Easy', 'Medium', 'Hard'];
  let html = '';
  for (let tier = 0; tier < 3; tier++) {
    const claimed = e.done & (1 << tier);   // a claimed tier saves without its counters, so read the tasks off the done bit rather than the zeros
    const rows = T.map((t2, i) => t2.tier === tier ? '<div class="mk' + (claimed || e.c[i] >= t2.n ? '' : ' no') + '"><span>' + t2.txt + '<u>' + (claimed ? t2.n : e.c[i]) + ' / ' + t2.n + '</u></span></div>' : '').join('');
    const full = T.every((t2, i) => t2.tier !== tier || e.c[i] >= t2.n);
    html += '<div class="mk"><span><b>' + TIERN[tier] + '</b></span>' + (e.done & (1 << tier) ? '<b class="gp">✓ claimed</b>' : full ? '<b class="gp" data-dyc="' + key + ':' + tier + '">CLAIM</b>' : '') + '</div>' + rows;
  }
  showModal(villageName(v.v) + ' — achievement diary', html, 'Finish a tier and claim its cloak. The cloak carries you back to any town whose diary you have finished.');
}
on(modalBody, 'click', e => {
  const c = e.target.closest('[data-dyc]');
  if (!c) return;
  const [key, tier] = c.dataset.dyc.split(':'), en = P.dy[key];
  if (!en || (en.done & (1 << +tier))) return;
  if (!invFree()) return say(FULL, 'bad');
  en.done |= 1 << +tier;
  invAdd('town_cloak_' + (+tier + 1), 1);
  say('You claim the tier ' + (+tier + 1) + ' cloak!', 'lv');
  markDirty(2);
  closeOverlays();
});
for (const [tier, def2, pb2, x2] of [[1, 2, 0, {}], [2, 4, 1, {}], [3, 6, 2, { atk: 2, str: 2 }]])
  defWear(Object.assign({ id: 'town_cloak_' + tier, name: 'Town cloak ' + tier, g: 'cape', c: ['#4a8ad8', '#b04ad0', '#e8b43a'][tier - 1], c2: '#2a2a30', slot: 'cape', def: def2, pb: pb2, val: 0,
    opt: ['Rub', () => cloakTp(tier)] }, x2));   // game-economy: the diary cloak in this world's shape — its rub rides home to any finished town
function cloakTp(tier) {
  let best = null, bd = 1e18;
  const f = tpFrom();
  for (const key in P.dy) {
    if (!(P.dy[key].done & ((1 << tier) - 1))) continue;   // any claimed tier at or below carries you
    const [vx, vz] = key.split('_').map(Number), d2 = Math.hypot(vx - f.x, vz - f.z);
    if (d2 < bd) { bd = d2; best = { x: vx, z: vz }; }
  }
  if (!best) return say('The cloak only knows towns whose diary you have finished.', 'bad');
  const v = nearestVillageTo(best.x, best.z, 2);
  if (v) { const s = safeSpotIn(v); tpTo(s.x, s.z, 'home to ' + villageName(v), TP_CAP_ITEM); }   // the cloak is a worn item, not a spell
}

/* the world's small surprises: honest work draws the genie; slaughter draws the Evil Chicken */
const impT2 = NPC_BY.imp;
const genieT = { k: 'genie', n: 'Genie', town: 1, lv: 1, hp: 6, atk: 1, str: 1, def: 1, db: 0, abon: 0, sbon: 0, max: 0, fmax: 0, at: 'm', rng: 1, spd: 8, mspd: 0.06,
  sz: impT2.sz, scale: impT2.scale, tint: 0x4a8ad8, body: impT2.body, build: impT2.build, mag: 1, mdb: 0 };
NPC_TYPES.push(genieT); NPC_BY.genie = genieT; LOOT.genie = { nb: 1 };
defItem({ id: 'genie_lamp', name: 'Genie lamp', g: 'lamp', c: '#e8c34a', c2: '#8a6a14', val: 0, opt: ['Rub', i => lampRub(i)] });
function spawnGenie() {
  if (npcs.some(n2 => n2.t.k === 'genie')) return;
  const s = openNear(P.tx + 1, P.tz + 1, 3);
  if (!s) return;
  spawnNpc(NPC_BY.genie, s.x, s.z, null, 0);
  const g = npcs[npcs.length - 1];
  if (g && g.t.k === 'genie') g.despawn = tickN + 200;
  say('A genie appears in a puff of smoke!', 'lv');
}
onKill.push(n => {   // the diaries hear every local kill, and the castle dungeon's master by name
  if (n.key && String(n.key).startsWith('bD')) diaryBump('dboss', n.key, n.tx, n.tz, 1);
  if (!n.t.town && !n.t.flee) diaryBump('kill', 0, n.tx, n.tz, 1);
});
onKill.push(n => {   // the Evil Chicken has always taken slaughter personally
  if (n.t.boss || n.t.town || n.t.flee) return;
  if (Math.random() >= devRandMul / 2000) return;
  const s = openNear(P.tx - 2, P.tz - 2, 4);
  if (!s || npcs.some(q => q.t.k === 'evilchicken')) return;
  spawnNpc(NPC_BY.evilchicken, s.x, s.z, null, Math.max(0, powerAt(P.tx, P.tz)));
  const g = npcs[npcs.length - 1];
  if (g && g.t.k === 'evilchicken') { g.despawn = tickN + 300; g.target = P; }
  say('The Evil Chicken descends, shrieking!', 'bad');
});
tickHooks.push(() => { for (let i = npcs.length - 1; i >= 0; i--) if (npcs[i].despawn && npcs[i].despawn <= tickN && !npcs[i].dead) removeNpc(npcs[i]); });
function lampRub(i) {
  const rows = SKILLS.map((s, si) => s.locked ? '' : liRow('data-lamp="' + si + '"', 0, 0, skIcon(si), s.n, '<u>+' + lvl[si] * 10 + ' xp</u>')).join('');
  showModal('The lamp glows...', rows, 'Choose a skill: it grants ten times its level in experience.');
}
on(modalBody, 'click', e => {
  const l = e.target.closest('[data-lamp]');
  if (!l || !invCount('genie_lamp')) return;
  const si = +l.dataset.lamp;
  invRemove('genie_lamp', 1);
  gainXp(SKILLS[si].k, lvl[si] * 10);
  say('The lamp crumbles to dust in your hands.', 'lv');
  closeOverlays();
});
const devRandEl = el('devRand');
if (devRandEl) devRandEl.oninput = () => { devRandMul = parseFloat(devRandEl.value) || 1; };

/* ---- TREASURE TRAILS: a clue falls from a kill and names a spot a walk away; a spade there turns up a casket. One trail at a time ---- */
const CLUE_T = [['easy', 120, 320], ['medium', 300, 700], ['hard', 600, 1400]].map(([n, lo, hi], i) => {   // tier: name, how far it sends you
  defItem({ id: 'clue_' + i, name: 'Clue scroll (' + n + ')', g: 'scroll', c: '#e8dcc0', c2: '#8a6a3a', val: 0, opt: ['Read', () => readClue(i)] });
  defItem({ id: 'casket_' + i, name: 'Casket (' + n + ')', g: 'casket', c: '#6b4a2a', c2: '#8a6a3a', val: 0, opt: ['Open', s => openCasket(s, i)] });
  return { n, lo, hi };
});
defItem({ id: 'spade', name: 'Spade', g: 'spade', c: '#75767a', c2: '#4a4b4f', val: 3, opt: ['Dig', dig] });
for (const p of ['full_helm', 'platebody', 'platelegs', 'plateskirt', 'kiteshield']) for (const [sfx, c, nm, val] of [['_t', null, ' (t)', 12000], ['_g', '#e8c34a', ' (g)', 30000]]) {
  const b = ITEMS['rune_' + p]; defWear(Object.assign({}, b, { id: b.id + sfx, name: b.name + nm, c: c || b.c, c2: c ? '#9a7414' : '#e8c34a', val }));   // trimmed and gilded rune: the trail's prestige
}
/* fail fast on any loot, pickpocket, casket or shop id that does not resolve: a typo in a table would otherwise
   crash mid-session at kill time (dropItem reads ITEMS[id].name), and a shop typo would silently never stock.
   Runs here because it must see the whole larder — food, potions and clue items are defined late. */
(() => {
  const bad = [], chk = (id, where) => { if (!ITEMS[id] && !SUBTABLES[id]) bad.push(where + ':' + id); };
  for (const k in LOOT) { const T = LOOT[k]; for (const d of (T.alw || []).concat(T.main || [], T.tert || [], T.taskTert || [])) chk(d[0], k); if (T.main) { const w = T.main.reduce((a, d) => a + d[1], 0); if (w > (T.den || w)) bad.push('overweight:' + k); } }
  for (const [tbl, n] of [[RARE_DROPS, 'rdt'], [MEGA_DROPS, 'mega'], [GEM_DROPS, 'gem'], [HERB_SUB, 'herb'], [SEED_SUB, 'seed'], [USEED_SUB, 'useed'], [RSEED_SUB, 'rseed'],
    [BARROWS_SUB, 'barrows'], [RAID_SUB, 'raid'], [VAULT_SUB, 'vault']])
    for (const d of tbl) chk(d[0], n);
  for (const t of CLUE_LOOT) for (const d of t) chk(d[0], 'casket');
  for (const t of NPC_TYPES) if (t.pick) for (const d of t.pick.loot) chk(d[0], 'pick:' + t.k);
  for (const s of SHOP_KINDS) for (const id of (s.base || [])) chk(id, 'shop:' + s.k);
  if (bad.length) throw new Error('unresolvable loot ids: ' + bad.join(', '));
})();
const holdsClue = () => CLUE_T.some((c, i) => invCount('clue_' + i) || bank.some(b => b.id === 'clue_' + i));
function clueSpot(i, x, z) {   // dry, wild ground a tier's walk from (x, z)
  if (inDunPlane(z)) z -= DUN_Z;   // a scroll found below points at the daylight above the castle
  for (let k = 0, T = CLUE_T[i]; k < 40; k++) {
    const a = Math.random() * TAU, r = randInt(T.lo, T.hi), sx = Math.round(x + Math.sin(a) * r), sz = Math.round(z + Math.cos(a) * r), y = heightAt(sx, sz);
    if (y > 1.5 && y < 45 && !nearTown(sx, sz)) return [sx, sz, i];
  }
  return null;
}
/* the drop chance is the monster's own LOOT.clue row ([tier, 1-in-N], wiki rates); this hook owns only the
   one-trail-at-a-time gate and the dig spot. Monsters without a row drop no clues, as in 2007. */
onKill.push((n, drop) => {
  const T = LOOT[n.t.k + '@' + n.t.lv] || LOOT[n.t.k], c = T && T.clue;
  if (c && Math.random() * c[1] < 1 && !holdsClue() && (P.clue = clueSpot(c[0], n.tx, n.tz))) { drop('clue_' + c[0], 1); markDirty(1); }
});
function readClue(i) {   // a scroll without a spot (an old save) is given one from where you stand
  const c = P.clue && P.clue[2] === i ? P.clue : (P.clue = clueSpot(i, P.tx, P.tz));
  if (!c) return say('The ink has run; you cannot make the scroll out here.');
  const dx = c[0] - P.tx, dz = c[1] - P.tz;
  say('The scroll reads: "Dig at ' + c[0] + ', ' + c[1] + '" — about ' + Math.round(Math.hypot(dx, dz)) + ' tiles ' + COMPASS[Math.round(Math.atan2(dx, -dz) / (PI / 4)) & 7].split(' ')[0] + ' of here.', 'lv');
  if (!invCount('spade') && !bank.some(b => b.id === 'spade')) say('You will need a spade to dig it up — any General Store sells one.', 'lv');
}
function dig() {
  const c = P.clue;
  kneel(); sfx(1470);
  if (!c || !invCount('clue_' + c[2]) || chebDist(P.tx, P.tz, c[0], c[1]) > 2) return say('You dig a hole, and find nothing.');
  invRemove('clue_' + c[2], 1); invAdd('casket_' + c[2], 1); P.clue = null; markDirty(2);
  say('You dig up a casket!', 'lv');
}
function openCasket(s, i) {   // two rolls, three, four by tier; only stackable spoils swell with it; a full pack spills to the ground
  inv[s] = null; dirty.inv = 1;
  for (let k = 0; k < 2 + i; k++) {
    const d = rollTable(CLUE_LOOT[i]), n = randInt(d[2] || 1, d[3] || d[2] || 1) * (ITEMS[d[0]].stack ? 1 + i : 1);
    if (d[0] === 'coins') gpMade += n;
    clogAdd(d[0]);
    if (!invAdd(d[0], n)) dropItem(d[0], n, P.tx, P.tz);
  }
  const rare = i === 2 && Math.random() < 1 / 1000 ? rollTable(VAULT_SUB) : i === 1 && Math.random() < 1 / 280 ? ['ranger_boots'] : null;
  if (rare) { clogAdd(rare[0]); if (!invAdd(rare[0], 1)) dropItem(rare[0], 1, P.tx, P.tz); say('Something ancient glitters among the spoils: ' + ITEMS[rare[0]].name + '!', 'lv'); }
  say('You open the casket. Its treasures are yours.', 'lv'); markDirty(2);
}

/* ---- DEV TELEPORTS: the nearest settlement reader (laid out on the way), lattice finder, or spawn of a chosen kind; one spiral serves them all ---- */
const vFind = fn => (a, b) => { const v = villageAt(a, b); return (v && villageBuildings(v) && fn(v)) || null; };
const PLACES = [['Rune altar', ruinAt, RUIN_CELL, 30], ['Grand Exchange', vFind(v => v.ge)], ['Bank', vFind(v => v.b.find(b => b.bank))], ['Barber', vFind(v => v.b.find(b => b.barber))],
  ...Object.keys(FIX_NAME).map(t => [FIX_NAME[t], vFind(v => v.f.find(f => f.t === +t))]), ['Church altar', vFind(v => v.lm && v.lm.t === 0 && v.lm)], ['Rune essence rocks', vFind(v => v.lm && v.lm.t === 2 && v.lm)],
  ['Slayer master', vFind(slayerSpot)], ['Farming patches', vFind(v => farmPatches(v)[0])], ['Market stall', vFind(v => v.fur.find(f => f.t === 0))], ...SHOP_KINDS.map(s => [s.n, vFind(v => v.b.find(b => b.shop === s.i))])];
function tpNear(p, what) {
  if (!p) return say('No ' + what + ' within the scan.', 'bad');
  teleport(p.x, p.z, 400);
  const o = openNear(p.x, p.z, 8); if (o) placePlayer(o.x, o.z);   // the chunks are in now: step off the thing itself
  say('Warped to the nearest ' + what + ' at ' + P.tx + ', ' + P.tz + '.', 'lv');
}
Object.assign(DEV, {
  city() { tpV(nearCity(40), 'city'); },
  ge() { tpNear(nearestOf(SETTLE_CELL, 40, vFind(v => v.ge)), 'Grand Exchange'); },
  place() { const [n, fn, cell, rings] = PLACES[+el('devTpPlace').value]; tpNear(nearestOf(cell || SETTLE_CELL, rings || 40, fn), n.toLowerCase()); },
  npc() {   // wild packs, settlements and boss lairs each answer with their nearest; the closest wins
    const k = el('devTpNpc').value, t = NPC_BY[k];
    let best = [nearestOf(WILD_CELL, 64, (a, b) => { const pk = wildPack(a, b); if (!pk || pk.t.k !== k) return null; for (let i = 0; i < pk.n; i++) { const o = wildSpot(a, b, i); if (heightAt(o.x, o.z) >= SEA) return o; } return null; }),
      nearestOf(SETTLE_CELL, 16, (a, b) => { const v = villageAt(a, b); for (let i = 0, n = v ? villageSpawnN(v) : 0; i < n; i++) { const o = villageSpawn(v, i); if (o.t.k === k) return o; } return null; }),
      t.boss ? nearestOf(BOSS_CELL, 8, (a, b) => { const L = bossAt(a, b); return L && L.t.k === k ? L : null; }) : null
    ].filter(Boolean).sort((p, q) => Math.hypot(p.x - P.tx, p.z - P.tz) - Math.hypot(q.x - P.tx, q.z - P.tz))[0];
    if (best && best.v) { villageBuildings(best.v); best = villageSpawn(best.v, best.i); }   // the exact street, now the plan is known
    tpNear(best && { x: best.x + 2, z: best.z + 2 }, t.n);   // beside it, not on it
  }
});
el('devTpNpc').innerHTML = NPC_TYPES.slice().sort((a, b) => a.n.localeCompare(b.n)).map(t => '<option value="' + t.k + '">' + t.n + (t.boss ? ' (boss)' : '') + '</option>').join('');
el('devTpPlace').innerHTML = PLACES.map((p, i) => '<option value="' + i + '">' + p[0] + '</option>').join('');

/* ---- SKILL GUIDES: what each level unlocks, read off the data tables; a click on a skill opens its page. Recipes and the 99 cape join every list ---- */
const tools = t => TIERS.filter(q => q.tool < 99).map(q => [q.tool, q.n + ' ' + t]), wpn = TIERS.filter(t => !t.armourOnly);
const GUIDE = {
  attack: wpn.map(t => [t.req, t.n + ' weapons']), strength: wpn.map(t => [t.req, t.n + ' warhammer']),
  defence: TIERS.map(t => [t.req, t.n + ' armour']).concat(HIDES.map(h => [h.df, h.n + ' armour']), ROBE_TIERS.map(t => [t.def, t.n + ' robes'])),
  ranged: BOWS.map(b => [b.lv, (b.n || 'Wooden ') + 'bows']).concat(XBOWS.map(b => [b.lv, TIER[b.k].n + ' crossbow']), ARROWS.map(a => [a.lv, ITEMS[a.k + '_arrow'].name + 's']),
    BOLTS.map(a => [a.lv, ITEMS[a.k + '_bolts'].name]), HIDES.map(h => [h.lv, h.n + ' armour']), [[30, "Ava's attractor"], [50, "Ava's accumulator"]],
    Object.values(ITEMS).filter(it => it.thrown).map(it => [it.req.ranged, it.name.replace(/fe$/, 've') + 's'])),
  prayer: PRAYERS.map(p => [p.lv, p.n]),
  magic: SPELLS.map(s => [s.lv, s.n]).concat(USPELLS.map(s => [s.lv, s.n]), STAFF_TIERS.map(t => [t.lv, t.n.replace(/ of$/, 's')]), ROBE_TIERS.map(t => [t.mlv, t.n + ' robes']),
    Object.values(ITEMS).filter(it => it.g === 'wand').map(it => [it.req.magic, it.name])),
  runecraft: RC.map(r => [r.lv, cap(r.k) + ' runes']), hitpoints: [[10, 'Every blow you land feeds it']], agility: [[1, 'Log balances; run energy returns faster with every level'], [5, 'Climbing rocks — the higher, the harder']],
  thieving: NPC_TYPES.filter(t => t.pick).map(t => [t.pick.lv, t.n]).concat(STALLS.map(s => [s.lv, s.n])), slayer: MASTERS.map(m => [1, m.n + (m.cb ? ' (combat ' + m.cb + ')' : '')]),
  hunter: HUNT.map(c => [c.lv, c.n]), mining: ORES.map(o => [o.lv, o.n]).concat(tools('pickaxe')), fishing: FISH.map(f => [f.lv, f.n]), cooking: COOK.map(c => [c.cookLv, ITEMS[c.done].name]),
  firemaking: TREES.map(t => [t.lv, ITEMS[t.log].name]), woodcutting: TREES.map(t => [t.lv, t.n]).concat(tools('hatchet')), farming: CROPS.map(c => [c.lv, c.n + ['', ' herb', ' tree'][c.t]]),
  sailing: [[1, 'Deep water puts you in a rowboat']]
};
function skillGuide(i) {
  const k = SKILLS[i].k, by = new Map();
  for (const [lv, n] of (GUIDE[k] || []).concat(RECIPES.filter(r => r.sk === k).map(r => [r.lv, mkName(r)]), [[99, SKILLS[i].f + ' cape']])) by.set(lv, (by.get(lv) || new Set()).add(n));
  showModal(SKILLS[i].f + ' guide', [...by].sort((a, b) => a[0] - b[0]).map(([lv, set]) => '<div class="stRow g' + (lvl[i] < lv ? ' no' : '') + '"><i>Level ' + lv + '</i><b>' + [...set].join(', ') + '</b></div>').join(''),
    'Level ' + lvl[i] + ' · ' + Math.floor(xp[i]).toLocaleString() + ' xp' + (lvl[i] < MAXL ? ' · ' + Math.ceil(XP_TABLE[lvl[i] + 1] - xp[i]).toLocaleString() + ' to the next' : ''), 1);
}
on(skGrid, 'click', e => { const d = e.target.closest('.sk.live'); if (d) skillGuide(skEls.indexOf(d)); });

/* worn/drop tints sampled per-part from the 07 sprites (a staff's c is its orb, a blade's its edge) so the model
   matches the icon; the TINT07 data lives in icons07.js — `node icons07-tint.mjs` after changing sprites, map, or glyphs csv */
for (const id in TINT07) { const it = ITEMS[id]; if (it) { const [a, b] = TINT07[id].split('.'); it.c = '#' + a; it.c2 = '#' + b; } }
dressAvatar();

requestAnimationFrame(frame);
el('boot').classList.add('gone');

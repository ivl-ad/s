"use strict";
/* SEEDWORLD data tables, extracted verbatim from index.html (same globals, loaded first).
   Pure data + leaf drawing helpers only: nothing here may reference a binding from the main script at load time.
   Edit rows here; decoders and consumers live in index.html. */
/* style bonuses are the 2007 additives to the effective level (+3/+1/+0), not multipliers */
const STYLES = [
  { n: 'Accurate', d: 'Trains Attack', g: 'sword', xp: ['attack'], acc: 3, str: 0 },
  { n: 'Aggressive', d: 'Trains Strength', g: 'fist', xp: ['strength'], acc: 0, str: 3 },
  { n: 'Defensive', d: 'Trains Defence', g: 'shield', xp: ['defence'], acc: 0, str: 0, def: 3 },
  { n: 'Controlled', d: 'Trains all three, slower', g: 'scim', xp: ['attack', 'strength', 'defence'], acc: 1, str: 1, def: 1 }
];
const RSTYLES = [
  { n: 'Accurate', d: 'Trains Ranged', g: 'arrow', xp: ['ranged'], acc: 3, str: 3 },
  { n: 'Rapid', d: 'Trains Ranged, faster', g: 'bow', xp: ['ranged'], acc: 0, str: 0, spd: -1 },
  { n: 'Longrange', d: 'Trains Ranged and Defence', g: 'shield', xp: ['ranged', 'defence'], acc: 0, str: 0, rng: 2, def: 3 }
];
/* a staff or wand shows the 2007 magic options: cast rows pick what autocasting trains, strike rows are its melee swing */
const CSTYLES = [
  { n: 'Spell', d: 'Trains Magic, autocasting', g: 'rune', cs: 0 },
  { n: 'Spell (Defensive)', d: 'Trains Magic and Defence, autocasting', g: 'shield', cs: 1 },
  { n: 'Bash', d: 'Trains Attack, striking', g: 'sword', st: 0 },
  { n: 'Pound', d: 'Trains Strength, striking', g: 'fist', st: 1 },
  { n: 'Focus', d: 'Trains Defence, striking', g: 'shield', st: 2 }
];
const WOODC = '#6b4a26', K = '#000';
function poly(g, pts, fill, stroke) {
  g.beginPath(); g.moveTo(pts[0], pts[1]);
  for (let i = 2; i < pts.length; i += 2) g.lineTo(pts[i], pts[i + 1]);
  g.closePath();
  if (fill) { g.fillStyle = fill; g.fill(); }
  if (stroke) { g.strokeStyle = stroke; g.lineWidth = 1; g.stroke(); }
}
/* canvas micro-helpers: fill rect, (stroked) circle/ellipse, polyline, rounded rect */
const fr = (g, c, x, y, w, h) => { g.fillStyle = c; g.fillRect(x, y, w, h); };
const paint = (g, c, s) => { if (c) { g.fillStyle = c; g.fill(); } if (s) { g.strokeStyle = s; g.stroke(); } };
const circ = (g, x, y, r, c, s, a0, a1) => { g.beginPath(); g.arc(x, y, r, a0 || 0, a1 === undefined ? TAU : a1); paint(g, c, s); };
const ell = (g, x, y, rx, ry, rot, c, s) => { g.beginPath(); g.ellipse(x, y, rx, ry, rot, 0, TAU); paint(g, c, s); };
const ln = (g, s, w, ...segs) => {
  g.strokeStyle = s; g.lineWidth = w; g.beginPath();
  for (const p of segs) { g.moveTo(p[0], p[1]); for (let i = 2; i < p.length; i += 2) g.lineTo(p[i], p[i + 1]); }
  g.stroke(); g.lineWidth = 1;
};
const rrect = (g, x, y, w, h, r, c, s) => { g.beginPath(); g.roundRect ? g.roundRect(x, y, w, h, r) : g.rect(x, y, w, h); paint(g, c, s); };
const qcurve = (g, pts, c, s) => {   // moveTo then quadratic segments [cx, cy, x, y]...
  g.beginPath(); g.moveTo(pts[0], pts[1]);
  for (let i = 2; i < pts.length; i += 4) g.quadraticCurveTo(pts[i], pts[i + 1], pts[i + 2], pts[i + 3]);
  g.closePath(); paint(g, c, s);
};
const GLYPH = {
  sword(g, c, d) { poly(g, [16, 2, 19, 8, 19, 20, 13, 20, 13, 8], c, K); poly(g, [16, 2, 16, 20], null, d); fr(g, d, 9, 20, 14, 3); fr(g, WOODC, 14.5, 23, 3, 6); fr(g, d, 13, 28, 6, 2); },
  scim(g, c, d) {
    qcurve(g, [7, 26, 6, 8, 24, 4, 16, 14, 12, 26], c, K);
    g.strokeStyle = d; g.beginPath(); g.moveTo(9, 24); g.quadraticCurveTo(9, 10, 22, 6); g.stroke();
    fr(g, d, 5, 25, 10, 3); fr(g, WOODC, 6, 28, 4, 3);
  },
  axe(g, c, d) {
    g.fillStyle = WOODC; g.save(); g.translate(16, 16); g.rotate(0.42); g.fillRect(-2, -13, 4, 27); g.restore();
    poly(g, [9, 4, 22, 7, 24, 15, 12, 15, 8, 9], c, K); poly(g, [11, 6, 21, 8.5, 22, 13, 13, 13], d, null);
  },
  pick(g, c, d) { fr(g, WOODC, 14, 8, 4, 22); qcurve(g, [2, 12, 16, 2, 30, 12, 16, 7, 2, 12], c, K); fr(g, d, 12, 7, 8, 4); },
  body(g, c, d) { poly(g, [10, 6, 22, 6, 27, 11, 24, 13, 24, 27, 8, 27, 8, 13, 5, 11], c, K); fr(g, d, 14, 7, 4, 20); poly(g, [10, 6, 22, 6, 20, 10, 12, 10], d, null); },
  shield(g, c, d) { poly(g, [16, 3, 26, 8, 23, 22, 16, 29, 9, 22, 6, 8], c, K); ln(g, d, 2, [16, 6, 16, 25], [9, 11, 23, 11]); },
  log(g, c, d) {
    ell(g, 16, 16, 13, 7, -0.35, c, K); ell(g, 21.5, 11.5, 4.4, 6.2, -0.35, d, K); ell(g, 21.5, 11.5, 2.2, 3.1, -0.35, null, c);
  },
  fish(g, c) {
    ell(g, 15, 16, 11, 6, -0.1, c, K); poly(g, [26, 10, 30, 16, 26, 22], c, K); circ(g, 8, 14, 1.3, K);
    ln(g, 'rgba(0,0,0,.35)', 1, [14, 11, 18, 16, 14, 21]);
  },
  cfish(g, c, d) { GLYPH.fish(g, c); ln(g, d, 1.6, [7, 13, 22, 19], [8, 20, 21, 12]); },
  scroll(g, c, d) { fr(g, c, 8, 4, 16, 24); g.strokeStyle = K; g.strokeRect(8, 4, 16, 24); for (const y of [10, 14, 18, 22]) ln(g, d, 1, [11, y, 21, y]); ell(g, 16, 4, 8, 2.4, 0, d, K); ell(g, 16, 28, 8, 2.4, 0, d, K); },
  coins(g, c, d) { for (const p of [[11, 21, 6], [21, 20, 5.4], [16, 13, 6.4]]) { circ(g, p[0], p[1], p[2], c, K); circ(g, p[0], p[1], p[2] * 0.45, d); } },
  hammer(g, c, d) { fr(g, WOODC, 14, 12, 4, 18); fr(g, c, 6, 5, 20, 8); g.strokeStyle = K; g.strokeRect(6, 5, 20, 8); fr(g, d, 6, 5, 20, 3); },
  net(g, c, d) {
    for (let i = 0; i <= 4; i++) { ln(g, c, 1.4, [5 + i * 5.5, 7, 7 + i * 4.4, 26]); ln(g, c, 1.4, [5, 7 + i * 4.8, 27, 7 + i * 4.8]); }
    g.strokeStyle = d; g.lineWidth = 2; g.strokeRect(5, 7, 22, 19); g.lineWidth = 1;
  },
  flame(g, c, d, cx, cy, s) {
    g.save(); g.translate(cx || 16, cy || 17); g.scale(s || 1, s || 1);
    qcurve(g, [0, -13, 9, -3, 7, 5, 6, 12, 0, 13, -6, 12, -7, 5, -9, -3, 0, -13], c, K);
    qcurve(g, [0, -5, 4, 1, 3, 6, 0, 10, -3, 6, -4, 1, 0, -5], d);
    g.restore();
  },
  heart(g, c, d) {
    g.beginPath(); g.moveTo(16, 27); g.bezierCurveTo(2, 17, 5, 5, 16, 11); g.bezierCurveTo(27, 5, 30, 17, 16, 27); paint(g, c, K);
    ell(g, 11, 13, 2.4, 3.2, -0.5, d);
  },
  mug(g, c, d) {   // a tankard for the tavern
    g.lineWidth = 3; g.beginPath(); g.arc(24, 17, 4.5, -PI / 2, PI / 2); g.strokeStyle = d; g.stroke(); g.lineWidth = 1;
    fr(g, c, 7, 9, 14, 18); g.strokeStyle = K; g.strokeRect(7, 9, 14, 18); ln(g, d, 1.4, [11, 12, 11, 24], [17, 12, 17, 24]);
    ell(g, 14, 9, 8, 2.8, 0, '#f0e6c8', K); ell(g, 9, 7.4, 2.2, 1.8, 0, '#f0e6c8'); ell(g, 19, 7.2, 2.6, 2, 0, '#f0e6c8');
  },
  fist(g, c, d) {
    rrect(g, 7, 10, 18, 14, 4, c, K);
    for (let i = 0; i < 3; i++) ln(g, d, 1, [11 + i * 5, 11, 11 + i * 5, 17]);
    circ(g, 7, 19, 4, c, d);
  },
  bow(g, c, d) {
    circ(g, 9, 16, 11, null, null, -1.05, 1.05); g.strokeStyle = d; g.lineWidth = 3; g.stroke();
    g.strokeStyle = c; g.lineWidth = 2; g.stroke();
    ln(g, '#efe4c4', 1, [14.6, 6.4, 14.6, 25.6]);
    ln(g, d, 2, [12, 16, 27, 16], [27, 16, 23, 13], [27, 16, 23, 19]);
  },
  arrow(g, c, d) { ln(g, WOODC, 2, [7, 25, 23, 9]); poly(g, [23, 9, 27, 5, 25, 12], c, K); poly(g, [7, 25, 5, 20, 11, 22], d, K); },
  star(g, c, d) {
    g.beginPath();
    for (let i = 0; i < 10; i++) { const a = -PI / 2 + i * PI / 5, r = i % 2 ? 5 : 12; g[i ? 'lineTo' : 'moveTo'](16 + Math.cos(a) * r, 16 + Math.sin(a) * r); }
    g.closePath(); paint(g, c, K); circ(g, 16, 16, 3, d);
  },
  rune(g, c, d) { poly(g, [16, 3, 27, 12, 23, 27, 9, 27, 5, 12], c, K); ln(g, d, 2, [16, 8, 16, 22], [11, 13, 21, 18]); },
  ring(g, c, d) { g.lineWidth = 3.4; circ(g, 16, 19, 9, null, c); g.lineWidth = 1; poly(g, [16, 4, 20, 9, 16, 13, 12, 9], d, K); },
  skull(g, c, d) {
    g.beginPath(); g.arc(16, 14, 10, PI, 0); g.lineTo(24, 21); g.lineTo(8, 21); g.closePath(); paint(g, c, K);
    fr(g, c, 11, 21, 10, 5); g.strokeRect(11, 21, 10, 5);
    circ(g, 12, 14, 3, '#15120e'); circ(g, 20, 14, 3, '#15120e');
  },
  leaf(g, c, d) {
    qcurve(g, [6, 26, 4, 8, 26, 5, 24, 25, 6, 26], c, K);
    g.strokeStyle = d; g.beginPath(); g.moveTo(6, 26); g.quadraticCurveTo(16, 14, 25, 6); g.stroke();
  },
  boot(g, c, d) { poly(g, [10, 4, 18, 4, 18, 18, 28, 22, 28, 27, 10, 27], c, K); fr(g, d, 10, 24, 18, 3); },
  anchor(g, c, d) {
    ln(g, c, 2.6, [16, 8, 16, 26]); ln(g, c, 2.6, [9, 12, 23, 12]);
    g.lineWidth = 2.6; circ(g, 16, 22, 9, null, c, 0.25 * PI, 0.75 * PI); g.lineWidth = 1;
    circ(g, 16, 6, 3.4, null, d);
  },
  lock(g, c, d) { g.lineWidth = 2.6; circ(g, 16, 14, 5.5, null, c, PI, 0); g.lineWidth = 1; fr(g, d, 9, 14, 14, 12); g.strokeStyle = K; g.strokeRect(9, 14, 14, 12); },
  staff(g, c, d) {
    ln(g, WOODC, 3, [9, 30, 21, 7]); circ(g, 22, 6, 5.2, c, K); circ(g, 20.4, 4.6, 2.0, d); ln(g, d, 1.6, [17, 11, 27, 11]);
  },
  hat(g, c, d) {
    poly(g, [16, 2, 25, 23, 7, 23], c, K); fr(g, d, 4, 23, 24, 5); g.strokeStyle = K; g.strokeRect(4, 23, 24, 5);
    circ(g, 16, 15, 2.4, d); circ(g, 13, 9, 1.5, d);
  },
};
const SK_C = ['#c9453a', '#3f9a4a', '#4a72c9', '#7a9a3a', '#d8c86a', '#4a8ad8', '#a07ad8', '#a3794a', '#c9453a', '#4a9ad8', '#4faa4a', '#a05ad0',
  '#c99a4a', '#4aaa9a', '#8a8a8a', '#8a7a4a', '#8a94a3', '#b0733a', '#5aa3c9', '#d05a9a', '#e08a2a', '#4f9a3a', '#3faa5a', '#2f8fb0',
  '#5a5348', '#5a5348', '#5a5348', '#5a5348'];
/* weapons cut from the same icon outlines: icon space (grip near the bottom) → weapon space (grip at origin, blade along -Y) */
const WSC = 1 / 19, WDEP = 2.2;
function xtr(pts, rgb, gx, gy) {
  const sh = new THREE.Shape();
  sh.moveTo(pts[0], pts[1]);
  for (let i = 2; i < pts.length; i += 2) sh.lineTo(pts[i], pts[i + 1]);
  sh.closePath();
  const g = new THREE.ExtrudeGeometry(sh, { depth: WDEP, bevelEnabled: false });
  g.translate(-gx, -gy, -WDEP / 2); g.scale(WSC, WSC, WSC);
  return shade(g, rgb);
}
const xrect = (x, y, w, h, rgb, gx, gy) => xtr([x, y, x + w, y, x + w, y + h, x, y + h], rgb, gx, gy);
const xcirc = (cx, cy, r, rgb, gx, gy) => { const o = []; for (let i = 0; i < 14; i++) { const a = i / 14 * TAU; o.push(cx + Math.cos(a) * r, cy + Math.sin(a) * r); } return xtr(o, rgb, gx, gy); };
function qpts(x0, y0, cx, cy, x1, y1, k) {
  const o = [];
  for (let i = 0; i <= k; i++) { const t = i / k, u = 1 - t; o.push(u * u * x0 + 2 * u * t * cx + t * t * x1, u * u * y0 + 2 * u * t * cy + t * t * y1); }
  return o;
}
const WOOD = [0.42, 0.29, 0.15], STRING = [0.94, 0.90, 0.78];
const WGRIP = { sword: [16, 26], dagger: [16, 25], scim: [8, 28], axe: [11.5, 26], pick: [16, 26], staff: [16, 26], bow: [20, 16], lsword: [16, 27], sword2h: [16, 27],
  mace: [16, 26], baxe: [10, 28], wham: [16, 26], claws: [16, 28], halberd: [16, 24], spear: [16, 24], cbow: [16, 17], wand: [10.5, 26.5], whip: [16, 26], scythe: [16, 24] };
/* hangs point-down at half scale, edge-on to the chest */
const WHANG = new Set(['sword', 'dagger', 'scim', 'axe', 'pick', 'rod', 'lsword', 'sword2h', 'mace', 'baxe', 'wham', 'claws', 'wand', 'whip']);
const WUP = new Set(['staff', 'halberd', 'spear', 'scythe']);   // held tip-up: a thrust lowers them first
const WFLIP = new Set(['scim', 'rod', 'wand']);   // tips that lean right in the icon are turned to lean forward in the hand
const TWO_A = -1.0, TWO_Z = 0.9;   // the two-hand hold: both arms swung forward and in, hands met at the waist
const WFWD = { staff: 0.19, bow: 0.03, halberd: 0.19, spear: 0.19, cbow: 0.08, scythe: 0.19 }, WOUT = { staff: -0.10, halberd: -0.10, spear: -0.10, scythe: -0.10 };
const WEAPON = {
  sword: (c, d, x, y) => [xtr([16, 2, 19.5, 9, 19.5, 20, 12.5, 20, 12.5, 9], c, x, y), xrect(9, 20, 14, 3, d, x, y), xrect(14.5, 23, 3, 6, WOOD, x, y), xrect(13, 28.5, 6, 2, d, x, y)],
  dagger: (c, d, x, y) => [xtr([16, 5, 19, 11, 19, 19, 13, 19, 13, 11], c, x, y), xrect(10, 19, 12, 3, d, x, y), xrect(14.5, 22, 3, 6, WOOD, x, y)],
  scim: (c, d, x, y) => [xtr(qpts(7, 26, 6, 8, 24, 4, 7).concat(qpts(24, 4, 16, 14, 12, 26, 7)), c, x, y), xrect(5, 25, 10, 3, d, x, y), xrect(6, 28, 4, 3.5, WOOD, x, y)],
  axe: (c, d, x, y) => [xtr([19.48, 3.31, 23.13, 4.95, 12.12, 29.60, 8.47, 27.97], WOOD, x, y), xtr([9, 4, 22, 7, 24, 15, 12, 15, 8, 9], c, x, y), xtr([11, 6, 21, 8.5, 22, 13, 13, 13], d, x, y)],
  pick: (c, d, x, y) => [xrect(14, 8, 4, 22, WOOD, x, y), xtr(qpts(2, 12, 16, 2, 30, 12, 7).concat(qpts(30, 12, 16, 7, 2, 12, 7)), c, x, y), xrect(12, 7, 8, 4, d, x, y)],
  rod: (c, d, x, y) => [xtr([20.5, 2, 23, 4.5, 12.5, 29, 10, 26.5], c, x, y), xrect(12, 21.5, 4, 4, d, x, y)],
  staff: (c, d, x, y) => [xrect(14.6, 7, 2.8, 23, WOOD, x, y), xcirc(16, 6, 5, c, x, y), xcirc(14.4, 4.6, 2, d, x, y), xrect(11, 10.4, 10, 1.8, d, x, y)],
  bow: (c, d, x, y) => {
    const out = [], inn = [];
    for (let i = 0; i <= 12; i++) { const a = -1.15 + i / 12 * 2.3; out.push(9 + Math.cos(a) * 11.8, 16 + Math.sin(a) * 11.8); inn.unshift(9 + Math.cos(a) * 9.6, 16 + Math.sin(a) * 9.6); }
    return [xtr(out.concat(inn), c, x, y), xtr([12.9, 6.2, 13.6, 6.2, 13.6, 25.8, 12.9, 25.8], STRING, x, y), xrect(18.6, 13.4, 3.2, 5.2, d, x, y)];
  },
  lsword: (c, d, x, y) => [xtr([16, 1, 18.5, 6, 18.5, 22, 13.5, 22, 13.5, 6], c, x, y), xrect(9, 22, 14, 2.6, d, x, y), xrect(14.6, 24.6, 2.8, 5, WOOD, x, y), xrect(13.5, 29.2, 5, 1.8, d, x, y)],
  sword2h: (c, d, x, y) => [xtr([16, 1, 20.5, 7, 20.5, 20, 11.5, 20, 11.5, 7], c, x, y), xrect(7, 20, 18, 3, d, x, y), xrect(14.5, 23, 3, 7, WOOD, x, y), xrect(13, 29.4, 6, 2, d, x, y)],
  mace: (c, d, x, y) => [xrect(14.6, 12, 2.8, 18, WOOD, x, y), xcirc(16, 8.5, 5.4, c, x, y), xrect(14.4, 1.6, 3.2, 3.2, d, x, y), xrect(9.2, 6.9, 3.2, 3.2, d, x, y), xrect(19.6, 6.9, 3.2, 3.2, d, x, y)],
  baxe: (c, d, x, y) => [xtr([20.4, 3.6, 23.6, 5.6, 11.4, 29.4, 8.2, 27.4], WOOD, x, y), xtr([7, 3, 24, 6, 26, 16, 12, 16, 6, 9], c, x, y), xtr([10, 5.4, 22, 7.6, 23.4, 14, 13.4, 14], d, x, y)],
  wham: (c, d, x, y) => [xrect(14.6, 10, 2.8, 20, WOOD, x, y), xrect(8, 2, 16, 10, c, x, y), xrect(8, 5.4, 16, 3.2, d, x, y)],
  claws: (c, d, x, y) => [xrect(8, 24, 16, 3.4, d, x, y), xrect(9, 27.4, 14, 2.6, WOOD, x, y),
    ...[10.5, 16, 21.5].map(cx => xtr(qpts(cx - 2.2, 24, cx - 3, 12, cx + 1.6, 5, 6).concat(qpts(cx + 1.6, 5, cx + 1.4, 14, cx + 2.2, 24, 6)), c, x, y))],
  halberd: (c, d, x, y) => [xrect(14.8, 3, 2.4, 27, WOOD, x, y), xtr([16, 0.5, 18.6, 4.6, 16, 8, 13.4, 4.6], c, x, y), xtr([17.2, 8, 26, 9.5, 27, 16, 17.2, 17.5], c, x, y), xtr([19, 10.4, 24.6, 11.4, 25.2, 14.4, 19, 15.4], d, x, y)],
  spear: (c, d, x, y) => [xrect(14.8, 8, 2.4, 22, WOOD, x, y), xtr([16, 1, 19.4, 7.6, 16, 12, 12.6, 7.6], c, x, y), xrect(13.4, 12, 5.2, 1.8, d, x, y)],
  cbow: (c, d, x, y) => [xrect(14.4, 8, 3.2, 18, WOOD, x, y), xtr(qpts(4, 12, 16, 3, 28, 12, 8).concat(qpts(28, 12, 16, 8, 4, 12, 8)), c, x, y),
    xtr([4.5, 11.6, 16, 14.6, 27.5, 11.6, 27.5, 12.4, 16, 15.4, 4.5, 12.4], STRING, x, y), xrect(13.4, 15, 5.2, 4, d, x, y)],
  wand: (c, d, x, y) => [xtr([19.4, 9, 22, 11.6, 12, 28, 9.4, 25.4], c, x, y), xcirc(22.5, 8.5, 3.4, d, x, y)],
  whip: (c, d, x, y) => [xrect(14.4, 22, 3.2, 8, d, x, y), xrect(13.6, 20.6, 4.8, 2, WOOD, x, y),   // handle and collar; the lash curls up and over in a tapering ribbon
    xtr(qpts(14.6, 21, 4, 2, 20, 5.5, 12).concat(qpts(21.6, 7.5, 7.5, 4.5, 17.4, 21, 12)), c, x, y),
    xcirc(21, 6.8, 1.6, d, x, y)],
  pipe: (c, d, x, y) => [xtr([14, 2, 18, 2, 17.2, 27, 14.8, 27], c, x, y), xrect(13.2, 1, 5.6, 2.6, d, x, y), xrect(13.8, 10, 4.4, 2.6, d, x, y), xrect(14.4, 27, 3.2, 3, d, x, y)],
  trident: (c, d, x, y) => [xrect(14.8, 9, 2.4, 21, WOOD, x, y), xrect(11, 8.6, 10, 2, c, x, y),
    xtr([16, 0.5, 17.6, 4.5, 16, 9, 14.4, 4.5], c, x, y), xrect(11.2, 2.5, 1.8, 7, c, x, y), xrect(19, 2.5, 1.8, 7, c, x, y),
    xrect(11.2, 2.5, 1.8, 2, d, x, y), xrect(19, 2.5, 1.8, 2, d, x, y)],
  /* the scythe: a long haft, a collar, and a crescent that sweeps out and back over the head — the one silhouette
     in this armoury no existing shape could honestly stand in for */
  scythe: (c, d, x, y) => [xrect(14.9, 6, 2.2, 24, WOOD, x, y), xrect(12.4, 5.2, 7.2, 2.4, d, x, y),
    xtr(qpts(16, 5.2, 28, 1.6, 30.4, 15.5, 10).concat(qpts(30.4, 15.5, 23.5, 7.4, 16, 9.6, 10)), c, x, y),
    xtr(qpts(16, 5.8, 26.4, 3.2, 28.2, 14, 8).concat(qpts(28.2, 14, 22.6, 7.6, 16, 9, 8)), d, x, y),
    xrect(14.4, 26.4, 3.2, 2.2, d, x, y)]
};
/* Magic level and magic defence bonus per the wiki, for the rows where they are not 1/0: casters attack with mag, and
   every monster defends spells with it (a Magic-1 brute is easy to splash-proof hit; a +700 titan shrugs casts off). */
const MAGIC_STATS = { wizard: [10, 0], darkwizard: [22, 0], druid: [25, 0], zamorakmonk: [25, 0], spectre: [105, 0], revenant: [104, 0], jungledemon: [170, -10],
  greendragon: [68, 30], bluedragon: [1, 60], reddragon: [1, 60], blackdragon: [100, 60], bronzedragon: [100, 30], irondragon: [100, 30], steeldragon: [100, 30],
  mithrildragon: [168, 30], adamantdragon: [186, 30], runedragon: [196, 30], babygreendragon: [1, 40], babybluedragon: [1, 40],
  lesserdemon: [1, -10], greaterdemon: [1, -10], blackdemon: [1, -10], troll: [1, 200], blackknight: [1, -11], whiteknight: [1, -11], guard: [1, -4],
  paladin: [1, -10], hero: [1, -10], earthwarrior: [1, 10], icewarrior: [1, 10], chaosdwarf: [1, 10], ghost: [1, -5], kalphiteworker: [1, 10], kalphitesoldier: [1, 50],
  elvarg: [70, 30], obor: [1, 20], bryophyta: [90, 0], evilchicken: [200, 0], scurrius: [50, 10], scorpia: [1, 44], eldric: [100, 700], branda: [100, 700],
  kbd: [240, 80], sarachnis: [150, 150], skotizo: [280, 80], kalphitequeen: [150, 100], vorkath: [150, 240], vetion: [300, 250], venenatis: [300, 300],
  callisto: [140, 0], galvek: [160, 0], graardor: [80, 298], kril: [200, 80] };
const LADDERS = {
  chicken: [1], cow: [2], duck: [1], sheep: [1], camel: [1], ram: [2], goat: [23], pig: [8],
  rat: [3, [6, 10, 6, 5, 2], [26, 25, 22, 23, 22]], spider: [2, [27, 32, 20, 24, 21, 0], [50, 50, 41, 51, 31, 10]], smallspider: [1, [24, 22, 21, 21, 21, 58]],
  goblin: [5, [2, 5, 1, 1, 1, -15], [13, 16, 12, 13, 7, 0]], redgoblin: [5, [2, 5, 1, 1, 1, -15], [13, 16, 12, 13, 7, 0]], imp: [2, [7, 10, 5, 5, 6, -37]],
  barbarian: [8], zombie: [13, [18, 24, 13, 13, 18], [24, 30, 19, 21, 16, 7]], bandit: [22, [57, 50, 50, 50, 50, 0], [74, 65, 65, 65, 65, 0], [130, 155, 27, 27, 27, 52, 12]],
  skeleton: [21, [22, 29, 15, 18, 17], [25, 17, 24, 24, 24, 14], [45, 59, 32, 35, 36, 14]], ghost: [19], guard: [21], scorpion: [32],
  smallscorpion: [14, [37, 37, 31, 32, 31], [59, 55, 50, 52, 50]], wolf: [25, [11, 10, 10, 10, 10], [14, 15, 10, 15, 10], [64, 69, 50, 55, 52]],
  whitewolf: [25, [38, 44, 30, 31, 32]], bigwolf: [73], bear: [19, [15, 20, 10, 15, 10]], grizzly: [21, [33, 35, 30, 26, 25], [42, 35, 35, 35, 35, 0, 5]],
  hobgoblin: [28, [42, 49, 33, 31, 36, 10], [47, 52, 39, 39, 35]], hillgiant: [28], mossgiant: [42, [48, 85, 30, 30, 30, 31], [84, 120, 60, 60, 60, 62]],
  icegiant: [53, [67, 100, 40, 60, 40, 31]], ogre: [53, [58, 70, 46, 48, 43, 21], [63, 60, 54, 54, 54, 6]], ogrechief: [81], jogre: [53, [58, 70, 46, 48, 43, 21]],
  troll: [69, [71, 90, 40, 90, 25, 20]], icetroll: [74, [82, 80, 80, 80, 40, 60], [100, 80, 100, 100, 60, 60]], trollgeneral: [113],
  greendragon: [79, [88, 100, 68, 75, 68]], firegiant: [86, [104, 130, 65, 65, 120, 20], [109, 150, 90, 80, 65, 31]],
  lesserdemon: [82, [87, 87, 80, 70, 71], [94, 98, 80, 70, 85]], greaterdemon: [92, [100, 115, 90, 70, 80], [101, 120, 90, 90, 50], [113, 130, 120, 90, 50]],
  blackdemon: [172, [178, 160, 145, 148, 175], [184, 170, 155, 158, 162]], jungledemon: [195], blackdragon: [227, [247, 250, 200, 215, 200]],
  man: [2], woman: [2], mugger: [6], farmer: [7], dwarf: [10], thug: [10], pirate: [23, [26, 23, 23, 23, 23, 10], [57, 52, 49, 50, 50, 0]],
  blackknight: [33], ghoul: [42], whiteknight: [42, [36, 52, 27, 29, 21, 31], [38, 52, 30, 29, 25, 31], [39, 52, 32, 29, 27, 31]], chaosdwarf: [48],
  earthwarrior: [51], cyclops: [56, [76, 100, 47, 50, 26], [106, 150, 47, 50, 26]], icewarrior: [57], paladin: [62], hero: [69],
  masterfarmer: [32], rogue: [15], watchman: [33],
  monk: [5, [3, 5, 2, 2, 3]], wizard: [9], darkwizard: [20, [7, 12, 5, 2, 5, 0, 2], [11, 15, 5, 5, 10, 0, 5]], banshee: [23, [89, 100, 75, 85, 50, 0, null]],
  druid: [33, [13, 20, 8, 8, 12], [129, 150, 98, 98, 65, 0, 17]], shade: [40, [60, 56, 64, 47, 42], [80, 76, 88, 55, 60], [100, 90, 102, 84, 70], [120, 110, 120, 100, 85]],
  zamorakmonk: [17], spectre: [96],
  revenant: [90, [7, 10, 5, 5, 4, 0, 2], [15, 14, 13, 14, 14, 8], [52, 48, 60, 40, 33, 0], [60, 72, 50, 50, 41, 24], [82, 110, 60, 73, 49, 64], [98, 80, 83, 76, 80, 50],
    [105, 105, 99, 100, 60, 55], [120, 140, 93, 110, 80, 60], [126, 143, 100, 119, 80, 71], [135, 155, 106, 126, 87, 78]],
  skelwarrior: [45], giantskeleton: [84],   // TODO: verify — giantskeleton has no sourced OSRS block
  jackal: [21], unicorn: [15, [27, 29, 21, 23, 23]], wilddog: [63], boar: [5, [7, 12, 6, 5, 4]],
  kalphiteworker: [28], redspider: [34], shadowspider: [52], poisonspider: [64, [31, 25, 28, 28, 28]], kalphitesoldier: [85, [141, 170, 110, 110, 110]],
  babygreendragon: [48], babybluedragon: [48], bluedragon: [111], bronzedragon: [131, [143, 122, 130, 130, 112]], reddragon: [152],
  irondragon: [189, [215, 195, 185, 185, 185]], steeldragon: [246, [274, 250, 235, 235, 235]], mithrildragon: [304], adamantdragon: [338], runedragon: [380]
};
const LOOT = {
  /* Where a row leaves 2007 (many of these monsters drop nothing there), the table is a deliberate game-economy
     addition: this world's slayer masters assign them and its wilds sic them on travellers, so their kills must pay.
     Shapes and sizes borrow from same-band wiki tables; each such entry says so. */
  chicken: { den: 128, main: [['feather', 64, 5], ['feather', 32, 15]], alw: [['raw_chicken', 1]] },
  cow: { alw: [['cowhide', 1], ['raw_beef', 1]] },
  duck: { nb: 1 }, sheep: { alw: [['wool', 1]] }, camel: {}, ram: {}, pig: {}, rat: {},
  goat: { den: 128, main: [['coins', 25, 12], ['water_rune', 4, 6], ['seed', 12], ['herb', 4]] },   // game-economy: bones-only in 2007
  spider: { tert: [['red_spiders_eggs', 2]] }, smallspider: {}, smallscorpion: {},
  scorpion: { den: 128, main: [['coins', 20, 18], ['copper_ore', 4], ['iron_ore', 4], ['coal', 3], ['herb', 5], ['gem', 3]] },   // game-economy: a mine-dweller pays in ore
  goblin: { den: 128, main: [['bronze_sq_shield', 3], ['body_rune', 5, 7], ['water_rune', 6, 6], ['earth_rune', 3, 4], ['bronze_bolts', 3, 8], ['hammer', 15], ['air_talisman', 1],
    ['coins', 28, 5], ['coins', 3, 9], ['coins', 3, 15], ['coins', 2, 20], ['coins', 1, 1], ['gem', 1]] },
  imp: { nb: 1, den: 128, main: [['bronze_bolts', 8, 1], ['wizard_hat', 8], ['raw_chicken', 5], ['bread', 1], ['cooked_meat', 1], ['hammer', 8], ['tinderbox', 5], ['shears', 4],
    ['ball_of_wool', 8], ['mind_talisman', 7], ['cabbage', 2]] },
  man: { den: 128, main: [['bronze_med_helm', 2], ['iron_dagger', 1], ['bronze_bolts', 22, 2, 12], ['bronze_arrow', 3, 7], ['earth_rune', 2, 4], ['fire_rune', 2, 6], ['mind_rune', 2, 9],
    ['chaos_rune', 1, 2], ['coins', 38, 3], ['coins', 9, 5], ['coins', 4, 15], ['coins', 1, 25], ['copper_ore', 2], ['earth_talisman', 2], ['cabbage', 1], ['herb', 23]] },
  mugger: { den: 128, main: [['bronze_bolts', 27, 2, 12], ['mind_rune', 3, 9], ['water_rune', 2, 6], ['earth_rune', 2, 5], ['knife', 1], ['copper_ore', 2], ['bronze_med_helm', 2],
    ['cabbage', 1], ['coins', 12, 5], ['coins', 3, 15], ['coins', 1, 25], ['herb', 13]] },
  farmer: { den: 128, main: [['earth_rune', 2, 4], ['fire_rune', 2, 6], ['mind_rune', 2, 9], ['chaos_rune', 1, 2], ['coins', 38, 3], ['coins', 1, 25], ['earth_talisman', 2],
    ['herb', 11], ['seed', 27]] },
  barbarian: { den: 128, main: [['bronze_hatchet', 6], ['staff', 4], ['iron_mace', 1], ['chaos_rune', 4, 2], ['bronze_arrow', 3, 15], ['earth_rune', 3, 2], ['fire_rune', 2, 5],
    ['mind_rune', 2, 5], ['law_rune', 1, 2], ['coins', 42, 5], ['coins', 9, 8], ['coins', 5, 17], ['coins', 3, 27], ['tin_ore', 1], ['fur', 1], ['cooked_meat', 1], ['ring_mould', 1], ['gem', 1]] },
  zombie: { den: 128, main: [['bronze_med_helm', 4], ['bronze_longsword', 1], ['iron_hatchet', 1], ['iron_arrow', 7, 5], ['body_rune', 5, 6], ['mind_rune', 5, 5], ['air_rune', 4, 13],
    ['iron_arrow', 4, 8], ['steel_arrow', 2, 5], ['nature_rune', 1, 6], ['coins', 11, 10], ['coins', 4, 4], ['coins', 3, 18], ['coins', 2, 13], ['coins', 2, 28], ['copper_ore', 2], ['herb', 25]] },
  bandit: { den: 128, main: [['iron_scimitar', 4], ['steel_sq_shield', 2], ['steel_hatchet', 1], ['chaos_rune', 3, 6], ['water_rune', 3, 9], ['air_rune', 2, 10], ['death_rune', 2, 2],
    ['law_rune', 2, 3], ['blood_rune', 1, 2], ['mind_rune', 1, 2], ['nature_rune', 1, 2], ['coins', 26, 35], ['coins', 13, 12], ['coins', 10, 53], ['coins', 7, 1], ['coins', 2, 80],
    ['coal', 6], ['herb', 37], ['gem', 3]] },
  skeleton: { den: 128, main: [['iron_med_helm', 6], ['iron_sword', 4], ['iron_hatchet', 2], ['iron_scimitar', 1], ['air_rune', 3, 12, 15], ['water_rune', 3, 9], ['chaos_rune', 3, 5],
    ['iron_arrow', 2, 12], ['law_rune', 2, 2], ['cosmic_rune', 1, 2], ['bronze_bar', 5], ['coins', 24, 10], ['coins', 25, 5], ['coins', 8, 25], ['coins', 4, 45], ['coins', 3, 65],
    ['coins', 2, 1], ['herb', 20], ['gem', 2]] },
  // game-economy: ghosts and ghouls drop nothing (or bones alone) in 2007; a thin spectral purse keeps their tasks worth taking
  ghost: { nb: 1, den: 128, main: [['air_rune', 6, 5], ['mind_rune', 5, 7], ['chaos_rune', 3, 3], ['death_rune', 1, 2], ['coins', 30, 15], ['coins', 10, 45], ['herb', 6], ['gem', 1]] },
  ghoul: { den: 128, main: [['coins', 26, 40], ['air_rune', 4, 10], ['earth_rune', 4, 10], ['herb', 10], ['seed', 8], ['gem', 2]], tert: [['mort_myre_fungus', 3]] },
  guard: { den: 128, main: [['iron_bolts', 10, 2, 12], ['steel_arrow', 4, 1], ['bronze_arrow', 3, 1], ['air_rune', 2, 6], ['earth_rune', 2, 3], ['fire_rune', 2, 2], ['blood_rune', 1, 1],
    ['chaos_rune', 1, 1], ['nature_rune', 1, 1], ['steel_arrow', 1, 5], ['bronze_arrow', 2, 2], ['coins', 19, 1], ['coins', 16, 7], ['coins', 9, 12], ['coins', 8, 4], ['coins', 4, 25],
    ['coins', 4, 17], ['coins', 2, 30], ['iron_dagger', 6], ['body_talisman', 3], ['iron_ore', 1], ['seed', 18]] },
  // game-economy: every canid leaves a pelt (2007 gives wolf bones alone); the deep-band dog also carries a traveller's purse
  wolf: { alw: [['fur', 1]] }, whitewolf: { alw: [['fur', 1]] }, bigwolf: { alw: [['fur', 2]], den: 128, main: [['coins', 26, 60], ['herb', 10], ['useed', 8], ['gem', 3]] },
  jackal: { alw: [['fur', 1]] },
  wilddog: { alw: [['fur', 1]], den: 128, main: [['coins', 30, 55], ['nature_rune', 4, 6], ['herb', 10], ['useed', 10], ['gem', 3]] },
  boar: {},
  bear: { alw: [['fur', 1]] }, grizzly: { alw: [['fur', 1]] },
  hobgoblin: { den: 128, main: [['limpwurt_root', 22], ['iron_sword', 3], ['steel_dagger', 3], ['steel_longsword', 1], ['law_rune', 3, 2], ['water_rune', 2, 2], ['fire_rune', 2, 7],
    ['body_rune', 2, 6], ['chaos_rune', 2, 3], ['nature_rune', 2, 4], ['cosmic_rune', 1, 2], ['herb', 7], ['seed', 18], ['coins', 16, 15], ['coins', 12, 28], ['coins', 12, 5],
    ['coins', 4, 62], ['coins', 3, 42], ['coins', 1, 1], ['gem', 2]] },
  hillgiant: { den: 128, main: [['iron_dagger', 4], ['iron_full_helm', 5], ['iron_kiteshield', 3], ['steel_longsword', 2], ['iron_arrow', 6, 3], ['fire_rune', 3, 15], ['water_rune', 3, 7],
    ['law_rune', 3, 2], ['steel_arrow', 2, 10], ['mind_rune', 2, 3], ['cosmic_rune', 2, 2], ['nature_rune', 2, 6], ['chaos_rune', 1, 2], ['death_rune', 1, 2], ['herb', 7], ['seed', 18],
    ['limpwurt_root', 11], ['body_talisman', 2], ['coins', 14, 38], ['coins', 10, 52], ['coins', 8, 15], ['coins', 6, 8], ['coins', 2, 88], ['gem', 3]] },
  mossgiant: { den: 128, main: [['black_sq_shield', 5], ['staff', 2], ['steel_med_helm', 2], ['mithril_sword', 2], ['mithril_spear', 2], ['steel_kiteshield', 1], ['law_rune', 4, 3],
    ['air_rune', 3, 18], ['earth_rune', 3, 27], ['chaos_rune', 3, 7], ['nature_rune', 3, 6], ['cosmic_rune', 2, 3], ['iron_arrow', 2, 15], ['steel_arrow', 1, 30], ['death_rune', 1, 3],
    ['blood_rune', 1, 1], ['herb', 5], ['useed', 35], ['steel_bar', 6], ['coal', 1], ['coins', 19, 37], ['coins', 8, 2], ['coins', 10, 119], ['coins', 2, 300], ['gem', 4]] },
  'mossgiant@84': { den: 128, main: [['mithril_sq_shield', 5], ['mithril_med_helm', 2], ['adamant_spear', 2], ['adamant_sword', 2], ['battlestaff', 2], ['mithril_kiteshield', 1],
    ['law_rune', 4, 10, 25], ['air_rune', 3, 40, 80], ['earth_rune', 3, 40, 80], ['chaos_rune', 3, 10, 30], ['nature_rune', 3, 6, 25], ['cosmic_rune', 2, 10, 25], ['mithril_arrow', 1, 20, 30],
    ['adamant_arrow', 2, 10, 15], ['death_rune', 1, 10, 20], ['blood_rune', 1, 6, 10], ['herb', 5], ['useed', 35], ['coins', 19, 60], ['coins', 10, 100, 1000], ['coins', 8, 20],
    ['coins', 2, 500, 1500], ['mithril_bar', 6], ['coal', 1, 2, 6], ['gem', 4]] },
  icegiant: { den: 128, main: [['iron_2h_sword', 5], ['black_kiteshield', 4], ['steel_hatchet', 4], ['steel_sword', 4], ['iron_platelegs', 1], ['mithril_mace', 1], ['mithril_sq_shield', 1],
    ['adamant_arrow', 6, 5], ['nature_rune', 4, 6], ['mind_rune', 3, 24], ['body_rune', 3, 37], ['law_rune', 2, 3], ['water_rune', 1, 12], ['cosmic_rune', 1, 4], ['death_rune', 1, 3],
    ['blood_rune', 1, 2], ['useed', 8], ['mithril_ore', 1], ['coins', 32, 117], ['coins', 12, 53], ['coins', 10, 196], ['coins', 7, 8], ['coins', 6, 22], ['coins', 2, 400], ['gem', 4]] },
  'icegiant@67': { den: 62, main: [['mithril_hatchet', 4], ['adamant_sword', 4], ['mithril_platelegs', 1], ['adamant_dagger', 1], ['adamant_mace', 1], ['adamant_sq_shield', 1],
    ['adamant_kiteshield', 1], ['rune_dagger', 1], ['adamant_arrow', 6, 5, 14], ['nature_rune', 4, 6], ['death_rune', 3, 5], ['law_rune', 2, 3], ['blood_rune', 2, 5], ['cosmic_rune', 1, 4],
    ['chaos_rune', 1, 15], ['death_rune', 1, 3], ['useed', 13], ['coins', 6, 100], ['mithril_ore', 1, 3], ['gem', 4]] },
  firegiant: { den: 128, main: [['steel_hatchet', 3], ['mithril_sq_shield', 2], ['battlestaff_of_fire', 1], ['rune_scimitar', 1], ['fire_rune', 10, 150], ['chaos_rune', 7, 5],
    ['rune_arrow', 5, 12], ['blood_rune', 4, 5], ['fire_rune', 1, 37], ['law_rune', 1, 2], ['herb', 19], ['lobster', 3], ['steel_bar', 2], ['coins', 40, 60], ['coins', 7, 15],
    ['coins', 6, 25], ['coins', 2, 300], ['coins', 1, 50], ['rdt', 1], ['gem', 11]] },
  ogre: { den: 128, main: [['seed', 19]] }, ogrechief: { den: 128, main: [['seed', 19]] },
  jogre: { nb: 1, alw: [['big_bones', 1]], den: 129, main: [['bronze_spear', 30], ['iron_spear', 4], ['nature_rune', 10, 2], ['nature_rune', 2, 10], ['nature_rune', 2, 5], ['steel_javelin', 2, 5], ['knife', 5],
    ['herb', 6], ['seed', 15], ['bones', 3], ['big_bones', 2, 3], ['gem', 1]] },
  troll: { den: 128, main: [['steel_med_helm', 4], ['black_warhammer', 3], ['steel_warhammer', 3], ['adamant_med_helm', 1], ['adamant_warhammer', 1], ['mithril_sq_shield', 1],
    ['earth_rune', 8, 60], ['nature_rune', 5, 7], ['law_rune', 3, 2], ['earth_rune', 1, 45], ['earth_rune', 1, 25], ['herb', 15], ['seed', 19], ['coal', 3, 3], ['coins', 29, 35],
    ['coins', 10, 100], ['coins', 7, 8], ['coins', 6, 50], ['coins', 1, 250], ['gem', 5]] },
  icetroll: { den: 128, main: [['adamant_full_helm', 10], ['steel_platebody', 10], ['mithril_warhammer', 5], ['adamant_hatchet', 5], ['rune_kiteshield', 2], ['rune_warhammer', 1],
    ['earth_rune', 10, 8, 14], ['earth_rune', 10, 12, 36], ['nature_rune', 5, 4, 12], ['law_rune', 5, 4, 8], ['herb', 2], ['useed', 11], ['coins', 20, 200], ['raw_shark', 10, 2, 8],
    ['ball_of_wool', 10, 18, 42], ['gem', 1]] },
  trollgeneral: { den: 128, main: [['steel_platebody', 4], ['black_warhammer', 3], ['steel_warhammer', 3], ['adamant_hatchet', 2], ['adamant_sq_shield', 1], ['mithril_platebody', 1],
    ['rune_warhammer', 1], ['earth_rune', 8, 80], ['nature_rune', 5, 16], ['law_rune', 3, 4], ['earth_rune', 1, 65], ['earth_rune', 1, 25], ['herb', 15], ['coal', 3, 6], ['raw_tuna', 2, 4],
    ['coins', 29, 40], ['coins', 25, 135], ['coins', 10, 190], ['coins', 4, 20], ['coins', 1, 420], ['gem', 5]] },
  lesserdemon: { nb: 1, den: 128, main: [['steel_full_helm', 4], ['steel_hatchet', 4], ['steel_scimitar', 3], ['mithril_sq_shield', 1], ['mithril_chainbody', 1], ['rune_med_helm', 1],
    ['fire_rune', 8, 60], ['chaos_rune', 5, 12], ['death_rune', 3, 3], ['fire_rune', 1, 30], ['herb', 1], ['gold_ore', 2], ['coins', 40, 120], ['coins', 29, 40], ['coins', 10, 200],
    ['coins', 7, 10], ['coins', 1, 450], ['gem', 4]] },
  greaterdemon: { nb: 1, den: 128, main: [['steel_2h_sword', 4], ['steel_hatchet', 3], ['steel_battleaxe', 3], ['mithril_kiteshield', 1], ['adamant_platelegs', 1], ['rune_full_helm', 1],
    ['fire_rune', 8, 75], ['chaos_rune', 3, 15], ['death_rune', 3, 5], ['fire_rune', 1, 37], ['tuna', 3], ['gold_bar', 2], ['thread', 1, 10], ['coins', 40, 132], ['coins', 29, 44],
    ['coins', 10, 220], ['coins', 7, 11], ['coins', 1, 460], ['gem', 5]] },
  blackdemon: { nb: 1, den: 128, main: [['black_sword', 4], ['steel_battleaxe', 3], ['black_hatchet', 2], ['mithril_kiteshield', 1], ['rune_med_helm', 1], ['rune_chainbody', 1],
    ['air_rune', 8, 50], ['chaos_rune', 7, 10], ['blood_rune', 4, 7], ['fire_rune', 1, 37], ['law_rune', 1, 3], ['herb', 23], ['lobster', 3], ['adamant_bar', 2], ['coins', 40, 132],
    ['coins', 7, 30], ['coins', 6, 44], ['coins', 6, 220], ['coins', 1, 460], ['dragon_sword', 1], ['rdt', 1], ['gem', 5]] },   // the sword fills the empty slot: game bridge
  jungledemon: { nb: 1 },
  thug: { den: 128, main: [['iron_med_helm', 4], ['iron_battleaxe', 2], ['steel_hatchet', 1], ['nature_rune', 13, 2], ['chaos_rune', 4, 2], ['cosmic_rune', 1, 2], ['law_rune', 1, 2],
    ['death_rune', 1, 2], ['iron_ore', 4], ['iron_bar', 3], ['coal', 2], ['coins', 23, 8], ['coins', 12, 15], ['coins', 2, 30], ['coins', 1, 20], ['herb', 24]] },
  pirate: { den: 128, main: [['iron_dagger', 6], ['bronze_scimitar', 4], ['iron_platebody', 1], ['iron_bolts', 10, 2, 12], ['chaos_rune', 6, 2], ['nature_rune', 5, 2], ['bronze_arrow', 3, 9],
    ['bronze_arrow', 2, 12], ['air_rune', 2, 10], ['earth_rune', 2, 9], ['fire_rune', 2, 5], ['law_rune', 1, 2], ['coins', 29, 4], ['coins', 13, 25], ['coins', 8, 7], ['coins', 6, 12],
    ['coins', 4, 35], ['coins', 1, 55], ['iron_bar', 1], ['gem', 1]] },
  blackknight: { den: 128, main: [['iron_sword', 4], ['iron_full_helm', 2], ['steel_mace', 1], ['mithril_arrow', 4, 3], ['body_rune', 3, 9], ['chaos_rune', 3, 6], ['earth_rune', 3, 10],
    ['death_rune', 2, 2], ['law_rune', 2, 3], ['cosmic_rune', 1, 7], ['mind_rune', 1, 2], ['steel_bar', 6], ['tin_ore', 1], ['bread', 1], ['coins', 21, 35], ['coins', 11, 6],
    ['coins', 10, 58], ['coins', 9, 12], ['coins', 2, 80], ['herb', 3], ['seed', 18], ['gem', 3]] },
  whiteknight: { den: 128, main: [['iron_longsword', 2], ['steel_med_helm', 2], ['steel_sword', 2], ['mind_rune', 3, 12], ['mithril_arrow', 5, 9], ['nature_rune', 4, 7],
    ['body_rune', 3, 15, 24], ['chaos_rune', 3, 5], ['water_rune', 3, 40, 47], ['adamant_arrow', 3, 5], ['blood_rune', 1, 3], ['law_rune', 1, 3], ['iron_bar', 5, 2], ['iron_bar', 2],
    ['iron_ore', 1], ['coins', 13, 51, 55], ['coins', 11, 15], ['coins', 10, 65, 73], ['coins', 6, 8], ['coins', 5, 50, 69], ['coins', 3, 120], ['coins', 1, 1], ['herb', 7], ['seed', 26], ['gem', 2]] },
  dwarf: { den: 128, main: [['bronze_pickaxe', 13], ['bronze_med_helm', 4], ['bronze_battleaxe', 2], ['iron_battleaxe', 1], ['bronze_bolts', 7, 2, 12], ['chaos_rune', 4, 2],
    ['nature_rune', 4, 2], ['coins', 20, 4], ['coins', 15, 10], ['coins', 2, 30], ['hammer', 10], ['bronze_bar', 7], ['iron_ore', 4], ['tin_ore', 3], ['copper_ore', 3], ['iron_bar', 3],
    ['coal', 2], ['gem', 1]] },
  chaosdwarf: { den: 128, main: [['steel_full_helm', 2], ['mithril_longsword', 1], ['mithril_sq_shield', 1], ['law_rune', 4, 3], ['air_rune', 3, 24], ['chaos_rune', 3, 10],
    ['mind_rune', 3, 37], ['nature_rune', 3, 9], ['cosmic_rune', 2, 3], ['death_rune', 1, 3], ['water_rune', 1, 10], ['coins', 40, 92], ['coins', 18, 47], ['coins', 11, 25],
    ['coins', 10, 150], ['coins', 2, 350], ['coins', 2, 15], ['coal', 1], ['mithril_bar', 6], ['tomato', 1], ['gem', 5]] },
  earthwarrior: { nb: 1, den: 128, main: [['steel_spear', 3], ['staff_of_earth', 2], ['earth_rune', 13, 12], ['nature_rune', 9, 3], ['chaos_rune', 7, 3], ['law_rune', 6, 2],
    ['death_rune', 4, 2], ['earth_rune', 3, 60], ['blood_rune', 1, 2], ['coins', 18, 12], ['herb', 14], ['useed', 18], ['gem', 2]] },
  icewarrior: { nb: 1, den: 128, main: [['iron_battleaxe', 3], ['mithril_mace', 1], ['nature_rune', 10, 4], ['chaos_rune', 8, 3], ['law_rune', 7, 2], ['cosmic_rune', 5, 2],
    ['mithril_arrow', 5, 3], ['adamant_arrow', 2, 2], ['death_rune', 3, 2], ['blood_rune', 1, 2], ['coins', 39, 15], ['herb', 10], ['useed', 18], ['gem', 3]] },
  paladin: { den: 128, main: [['steel_sword', 2], ['steel_longsword', 1], ['steel_full_helm', 1], ['water_rune', 13, 30], ['blood_rune', 1, 1], ['iron_bar', 9], ['steel_bar', 1],
    ['mithril_bar', 1], ['coins', 40, 48], ['coins', 19, 15], ['coins', 16, 2], ['coins', 10, 8], ['coins', 2, 120], ['herb', 8], ['gem', 2]] },
  // game-economy: a slain hero spills the purse he pickpockets for — bones-only in 2007, but he is a level-69 slayer target here
  hero: { den: 128, main: [['coins', 40, 200, 300], ['death_rune', 6, 2], ['law_rune', 4, 2], ['chaos_rune', 5, 8], ['uncut_ruby', 3], ['uncut_diamond', 1],
    ['gold_ore', 3], ['herb', 12], ['gem', 4], ['rdt', 1]] },
  cyclops: { den: 105, main: [['bronze_defender', 2], ['iron_defender', 2], ['steel_defender', 2], ['black_defender', 2], ['mithril_defender', 2], ['adamant_defender', 2],
    ['rune_defender', 2], ['black_knife', 16, 4, 13], ['steel_chainbody', 2], ['iron_2h_sword', 2], ['iron_chainbody', 2], ['steel_dagger', 2], ['steel_mace', 2], ['steel_sword', 2],
    ['steel_battleaxe', 2], ['steel_2h_sword', 2], ['steel_longsword', 2], ['steel_med_helm', 2], ['black_2h_sword', 1], ['mithril_dagger', 1], ['mithril_longsword', 1],
    ['adamant_mace', 1], ['black_sword', 1], ['black_longsword', 1], ['black_dagger', 1], ['adamant_2h_sword', 1], ['coins', 31, 3, 102], ['coins', 10, 5, 204], ['herb', 3], ['useed', 1], ['gem', 2]] },
  'cyclops@106': { den: 100, main: [['adamant_2h_sword', 4], ['mithril_dart', 6, 12], ['adamant_dagger', 5], ['black_full_helm', 5], ['black_mace', 5], ['mithril_scimitar', 5],
    ['mithril_kiteshield', 5], ['steel_platebody', 5], ['steel_chainbody', 7], ['black_knife', 4, 22], ['mithril_platelegs', 4], ['black_dagger', 5], ['rune_med_helm', 3],
    ['adamant_sq_shield', 1], ['rune_full_helm', 1], ['coins', 11, 96], ['coins', 8, 350, 449], ['herb', 4], ['useed', 3], ['rdt', 2]], tert: [['dragon_defender', 100]] },
  monk: {}, watchman: {}, masterfarmer: {},
  wizard: { den: 128, main: [['staff', 8], ['wizard_robe_top', 7], ['wizard_hat', 3], ['chaos_rune', 8, 2], ['nature_rune', 8, 2], ['air_rune', 3, 5], ['body_rune', 3, 5],
    ['earth_rune', 3, 5], ['fire_rune', 3, 5], ['mind_rune', 3, 5], ['water_rune', 3, 5], ['air_rune', 2, 12], ['body_rune', 2, 12], ['earth_rune', 2, 12], ['fire_rune', 2, 12],
    ['mind_rune', 2, 12], ['water_rune', 2, 12], ['blood_rune', 1, 2], ['law_rune', 1, 2], ['water_talisman', 3], ['mind_talisman', 3], ['coins', 23, 1], ['coins', 9, 2],
    ['coins', 7, 18], ['coins', 1, 30]] },
  darkwizard: { den: 128, main: [['staff', 4], ['wizard_hat', 6], ['earth_rune', 4, 36], ['air_rune', 3, 10], ['water_rune', 3, 10], ['earth_rune', 3, 10], ['fire_rune', 3, 10],
    ['air_rune', 2, 18], ['water_rune', 2, 18], ['earth_rune', 2, 18], ['fire_rune', 2, 18], ['nature_rune', 7, 4], ['chaos_rune', 6, 4], ['mind_rune', 3, 10], ['body_rune', 3, 10],
    ['mind_rune', 2, 18], ['body_rune', 2, 18], ['blood_rune', 2, 2], ['cosmic_rune', 1, 2], ['law_rune', 1, 3], ['coins', 17, 1], ['coins', 16, 2], ['coins', 9, 4], ['coins', 3, 29],
    ['coins', 1, 30], ['water_talisman', 2], ['fire_talisman', 2]] },
  banshee: { nb: 1, den: 128, main: [['iron_mace', 2], ['iron_dagger', 2], ['iron_kiteshield', 1], ['air_rune', 3, 3], ['cosmic_rune', 3, 2], ['chaos_rune', 2, 3], ['fire_rune', 1, 7],
    ['chaos_rune', 1, 7], ['coins', 10, 13], ['coins', 8, 26], ['coins', 8, 35], ['pure_essence', 22, 13], ['iron_ore', 1], ['eye_of_newt', 1], ['herb', 34], ['gem', 2]],
    taskTert: [['mystic_robe_bottom', 512]] },   // on-task only: the slayer's own spoils
  druid: { den: 128, main: [['earth_rune', 4, 27], ['water_rune', 2, 9], ['earth_rune', 2, 9], ['fire_rune', 2, 9], ['chaos_rune', 2, 3], ['law_rune', 1, 2], ['coins', 10, 2],
    ['coins', 4, 4], ['coins', 3, 1], ['coins', 3, 15], ['coins', 1, 20], ['iron_dagger', 6], ['limpwurt_root', 3], ['herb', 26]] },
  'druid@13': { den: 128, main: [['law_rune', 7, 2], ['mithril_bolts', 4, 2, 12], ['air_rune', 3, 36], ['body_rune', 2, 9], ['earth_rune', 2, 9], ['mind_rune', 2, 12],
    ['nature_rune', 1, 3], ['coins', 5, 3], ['coins', 5, 8], ['coins', 3, 29], ['coins', 1, 35], ['vial_of_water', 10], ['bronze_longsword', 1], ['snape_grass', 1], ['herb', 47], ['gem', 1]] },
  'druid@129': { den: 129, main: [['mithril_bolts', 6, 8, 28], ['law_rune', 7, 6], ['air_rune', 5, 56], ['body_rune', 5, 19], ['chaos_rune', 5, 7], ['earth_rune', 5, 19],
    ['mind_rune', 5, 22], ['nature_rune', 1, 12], ['coins', 7, 80], ['coins', 6, 250], ['vial_of_water', 10, 4], ['steel_longsword', 5], ['snape_grass', 1, 4], ['herb', 55], ['rdt', 1]] },
  shade: { nb: 1, den: 128, main: [['chaos_rune', 4, 5], ['death_rune', 3, 2], ['blood_rune', 1, 2], ['coins', 28, 48], ['herb', 8], ['gem', 2]],
    tert: [['mort_myre_fungus', 3]] },   // game-economy: its remains hold a little grave-wealth
  zamorakmonk: { tert: [['wine_of_zamorak', 2]] },
  spectre: { nb: 1, den: 128, main: [['steel_hatchet', 3], ['mithril_kiteshield', 1], ['lava_battlestaff', 1], ['adamant_platelegs', 1], ['rune_full_helm', 1], ['coins', 1, 460],
    ['herb', 78], ['rseed', 19], ['gem', 5]], taskTert: [['mystic_robe_bottom', 512]] },   // on-task only
  revenant: { den: 1000, main: [['coins', 65, 1, 276], ['coal', 56, 30, 60], ['adamant_bar', 56, 4, 6], ['battlestaff', 47, 4], ['law_rune', 47, 20, 45], ['death_rune', 47, 30, 60],
    ['blood_rune', 47, 50, 100], ['runite_ore', 38, 2, 4], ['black_dragonhide', 38, 4], ['yew_logs', 38, 20, 40], ['rune_bar', 28, 2, 3], ['rune_full_helm', 19, 2],
    ['rune_platebody', 19, 2], ['rune_platelegs', 19, 2], ['rune_kiteshield', 19, 2], ['rune_warhammer', 19, 2], ['magic_logs', 19, 8, 16]] },   // knight-tier rates for the family
  skelwarrior: { den: 128, main: [['iron_med_helm', 6], ['iron_sword', 4], ['iron_hatchet', 2], ['iron_scimitar', 1], ['air_rune', 3, 12, 15], ['water_rune', 3, 9], ['chaos_rune', 3, 5],
    ['iron_arrow', 2, 12], ['law_rune', 2, 2], ['cosmic_rune', 1, 2], ['coins', 24, 10], ['coins', 25, 5], ['coins', 8, 25], ['coins', 4, 45], ['coins', 3, 65], ['herb', 20], ['gem', 2]] },
  unicorn: { alw: [['unicorn_horn', 1]] },
  kalphiteworker: { den: 128, main: [['iron_sword', 3], ['iron_javelin', 1, 5], ['steel_dagger', 3], ['steel_longsword', 1], ['hardleather_body', 2], ['body_rune', 2, 6],
    ['cosmic_rune', 1, 2], ['chaos_rune', 2, 3], ['fire_rune', 2, 7], ['water_rune', 2, 2], ['law_rune', 3, 2], ['nature_rune', 2, 4], ['herb', 7], ['coins', 8, 1], ['coins', 12, 5],
    ['coins', 34, 15], ['coins', 12, 28], ['coins', 3, 42], ['coins', 4, 62], ['gem', 2]], tert: [['potato_cactus', 3]] },
  kalphitesoldier: { den: 128, main: [['steel_full_helm', 4], ['steel_scimitar', 3], ['steel_hatchet', 4], ['mithril_chainbody', 1], ['mithril_sq_shield', 1], ['adamant_med_helm', 1],
    ['fire_rune', 1, 30], ['fire_rune', 8, 60], ['chaos_rune', 5, 12], ['death_rune', 3, 3], ['nature_rune', 2, 1, 4], ['herb', 1], ['coins', 7, 10], ['coins', 29, 40],
    ['coins', 40, 120], ['coins', 10, 200], ['coins', 1, 450], ['gem', 4]] },
  'kalphitesoldier@141': { den: 128, main: [['mithril_sword', 4], ['steel_battleaxe', 3], ['mithril_hatchet', 2], ['adamant_dagger', 2], ['mithril_kiteshield', 1], ['rune_med_helm', 1],
    ['rune_chainbody', 1], ['air_rune', 8, 50], ['chaos_rune', 7, 10], ['blood_rune', 4, 7], ['fire_rune', 1, 37], ['law_rune', 1, 3], ['herb', 23], ['lobster', 3], ['coins', 40, 132],
    ['coins', 7, 30], ['coins', 6, 44], ['coins', 6, 220], ['coins', 1, 460], ['rdt', 1], ['gem', 5]] },
  redspider: { tert: [['red_spiders_eggs', 2]] },
  // game-economy: the 52-64 spiders drop nothing in 2007; here they pay in the herb/seed subtables their band expects
  shadowspider: { den: 128, main: [['coins', 24, 44], ['nature_rune', 4, 4], ['law_rune', 2, 2], ['herb', 12], ['useed', 8], ['gem', 3]] },
  poisonspider: { den: 128, main: [['coins', 28, 55], ['chaos_rune', 5, 8], ['death_rune', 3, 3], ['herb', 12], ['useed', 10], ['gem', 3]] },
  babygreendragon: { den: 128, main: [['coins', 22, 35], ['air_rune', 3, 15], ['water_rune', 3, 15], ['herb', 6], ['gem', 3]] },   // game-economy: a whelp's pocket lining
  greendragon: { alw: [['green_dragonhide', 1]], den: 128, main: [['steel_platelegs', 4], ['steel_battleaxe', 3], ['mithril_hatchet', 3], ['mithril_spear', 2], ['mithril_kiteshield', 1],
    ['adamant_full_helm', 1], ['rune_dagger', 1], ['water_rune', 8, 75], ['fire_rune', 1, 37], ['nature_rune', 5, 15], ['law_rune', 3, 3], ['herb', 15], ['coins', 29, 44],
    ['coins', 25, 132], ['coins', 10, 200], ['coins', 5, 11], ['coins', 1, 440], ['bass', 3], ['adamantite_ore', 3], ['gem', 5]] },
  'greendragon@88': { alw: [['green_dragonhide', 1]], den: 128, main: [['mithril_2h_sword', 5], ['mithril_platelegs', 2], ['mithril_battleaxe', 1], ['adamant_dagger', 1],
    ['adamant_sword', 1], ['adamant_full_helm', 1], ['adamant_kiteshield', 1], ['law_rune', 3, 3, 10], ['nature_rune', 1, 10], ['death_rune', 1, 15], ['blood_rune', 1, 5], ['herb', 15],
    ['coins', 29, 100, 199], ['coins', 25, 250, 499], ['coins', 14, 500, 749], ['coins', 6, 110], ['coins', 6, 500, 999], ['monkfish', 7], ['mithril_ore', 3, 2], ['gem', 5]] },
  bluedragon: { alw: [['blue_dragonhide', 1]], den: 128, main: [['steel_platelegs', 4], ['mithril_hatchet', 3], ['steel_battleaxe', 3], ['mithril_spear', 2], ['adamant_full_helm', 1],
    ['mithril_kiteshield', 1], ['rune_dagger', 1], ['water_rune', 8, 75], ['nature_rune', 5, 15], ['law_rune', 3, 3], ['fire_rune', 1, 37], ['herb', 15], ['coins', 29, 44],
    ['coins', 25, 132], ['coins', 10, 200], ['coins', 5, 11], ['coins', 1, 440], ['adamantite_ore', 3], ['bass', 3], ['gem', 5]] },
  reddragon: { alw: [['red_dragonhide', 1]], den: 128, main: [['mithril_2h_sword', 4], ['mithril_hatchet', 3], ['mithril_battleaxe', 3], ['rune_dart', 3, 8], ['mithril_javelin', 1, 20],
    ['mithril_kiteshield', 1], ['adamant_platebody', 1], ['rune_longsword', 1], ['rune_arrow', 8, 4], ['law_rune', 5, 4], ['blood_rune', 4, 2], ['death_rune', 3, 5], ['herb', 2],
    ['coins', 40, 196], ['coins', 29, 66], ['coins', 1, 690], ['dragon_javelin', 10, 10], ['adamant_bar', 1], ['gem', 5]] },
  blackdragon: { alw: [['black_dragonhide', 1]], den: 128, main: [['mithril_2h_sword', 4], ['mithril_hatchet', 3], ['mithril_battleaxe', 3], ['rune_knife', 3, 2], ['mithril_kiteshield', 1],
    ['adamant_platebody', 1], ['rune_longsword', 1], ['adamant_javelin', 20, 30], ['adamant_dart', 7, 16], ['fire_rune', 8, 50], ['blood_rune', 3, 15], ['air_rune', 1, 75],
    ['law_rune', 5, 10], ['coins', 40, 196], ['coins', 10, 330], ['coins', 1, 690], ['dragon_javelin', 6, 10], ['adamant_bar', 3], ['rdt', 2], ['gem', 3]] },
  'blackdragon@247': { alw: [['black_dragonhide', 1]], den: 128, main: [['adamant_platebody', 20], ['rune_knife', 7, 15], ['adamant_2h_sword', 4], ['adamant_battleaxe', 3],
    ['rune_hatchet', 3], ['rune_knife', 3, 5], ['rune_med_helm', 1], ['rune_kiteshield', 1], ['rune_longsword', 1], ['death_rune', 8, 10], ['law_rune', 5, 10], ['blood_rune', 3, 10],
    ['chaos_rune', 1, 25], ['coins', 40, 500, 999], ['coins', 10, 1000, 1999], ['coins', 1, 690], ['dragon_javelin', 6, 25], ['adamant_bar', 3], ['monkfish', 3, 2], ['rdt', 2], ['gem', 3]] },
  bronzedragon: { alw: [['bronze_bar', 5]], den: 128, main: [['adamant_dart', 7, 16], ['mithril_2h_sword', 4], ['mithril_hatchet', 3], ['mithril_battleaxe', 3], ['rune_knife', 3, 2],
    ['mithril_kiteshield', 1], ['adamant_platebody', 1], ['rune_longsword', 1], ['adamant_javelin', 20, 30], ['fire_rune', 8, 50], ['mithril_bolts', 6, 2, 12], ['law_rune', 5, 10],
    ['blood_rune', 3, 15], ['death_rune', 1, 25], ['coins', 40, 196], ['coins', 10, 330], ['coins', 1, 690], ['adamant_bar', 3], ['swordfish', 2, 2], ['swordfish', 1], ['rdt', 1], ['gem', 4]],
    tert: [['dragon_platelegs', 2048], ['dragon_plateskirt', 2048]] },
  irondragon: { alw: [['iron_bar', 5]], den: 128, main: [['rune_dart', 7, 9], ['adamant_2h_sword', 4], ['adamant_hatchet', 3], ['adamant_battleaxe', 3], ['rune_knife', 3, 5],
    ['adamant_sq_shield', 1], ['rune_med_helm', 1], ['rune_battleaxe', 1], ['rune_javelin', 20, 4], ['blood_rune', 19, 15], ['adamant_bolts', 6, 2, 12], ['diamond_bolts_e', 3, 8, 15], ['coins', 20, 270],
    ['coins', 10, 550], ['coins', 1, 990], ['adamant_bar', 3, 2], ['rdt', 2], ['gem', 3]], tert: [['dragon_platelegs', 1024], ['dragon_plateskirt', 1024]] },
  steeldragon: { alw: [['steel_bar', 5]], den: 128, main: [['rune_dart', 7, 12], ['rune_mace', 4], ['adamant_kiteshield', 2], ['rune_knife', 3, 7], ['rune_hatchet', 2],
    ['rune_full_helm', 1], ['blood_rune', 19, 20], ['rune_javelin', 20, 7], ['rune_bolts', 6, 2, 12], ['diamond_bolts_e', 3, 8, 15], ['coins', 17, 470], ['dragon_javelin', 5, 12], ['rune_bar', 3], ['rdt', 4],
    ['gem', 4]], tert: [['dragon_platelegs', 512], ['dragon_plateskirt', 512]] },
  mithrildragon: { alw: [['mithril_bar', 3]], den: 128, main: [['rune_battleaxe', 8], ['rune_dart', 7, 14], ['rune_battleaxe', 4], ['rune_knife', 3, 8], ['rune_mace', 3],
    ['rune_spear', 2], ['rune_full_helm', 1], ['blood_rune', 19, 27], ['rune_javelin', 14, 8], ['rune_bolts', 6, 10, 21], ['rune_arrow', 3, 8], ['shark', 6], ['shark', 2, 6],
    ['coins', 17, 600], ['dragon_javelin', 7, 15], ['rune_bar', 3, 2], ['dragon_hatchet', 1], ['rdt', 1], ['gem', 4]], tert: [['dragon_full_helm', 32768]] },
  adamantdragon: { alw: [['adamant_bar', 2]], den: 110, main: [['adamant_platebody', 9], ['rune_mace', 7], ['rune_scimitar', 7], ['dragon_med_helm', 1], ['dragon_platelegs', 1],
    ['dragon_plateskirt', 1], ['adamant_arrow', 8, 30, 40], ['chaos_rune', 7, 60, 120], ['death_rune', 7, 30, 60], ['herb', 8], ['adamant_javelin', 8, 40, 50],
    ['adamant_bolts_u', 11, 20, 40], ['diamond', 7, 1, 3], ['dragon_javelin', 7, 20, 30], ['adamantite_ore', 6, 8, 20], ['adamant_bar', 4, 5, 35], ['dragon_bolts_u', 1, 15, 20], ['dragon_thrownaxe', 1, 3, 7], ['rdt', 1]] },
  runedragon: { alw: [['rune_bar', 1]], den: 127, main: [['rune_platebody', 9], ['rune_longsword', 8], ['rune_mace', 7], ['rune_scimitar', 7], ['rune_warhammer', 7],
    ['rune_platelegs', 6], ['dragon_platelegs', 1], ['dragon_plateskirt', 1], ['dragon_med_helm', 1], ['rune_arrow', 8, 30, 40], ['chaos_rune', 7, 75, 150], ['death_rune', 7, 50, 100],
    ['herb', 8], ['rune_bolts_u', 11, 20, 30], ['rune_javelin', 10, 20, 30], ['dragonstone', 7], ['runite_ore', 6, 2, 5], ['dragon_javelin', 5, 30, 40], ['dragon_bolts_u', 1, 20, 40], ['dragon_knife', 1, 2, 5], ['rdt', 1]] },
  // ---- bosses ----
  obor: { den: 135, main: [['iron_full_helm', 5], ['iron_dagger', 4], ['iron_kiteshield', 3], ['steel_longsword', 2], ['iron_arrow', 6, 3], ['fire_rune', 3, 15], ['water_rune', 3, 7],
    ['law_rune', 3, 2], ['steel_arrow', 2, 10], ['mind_rune', 2, 3], ['cosmic_rune', 2, 2], ['nature_rune', 2, 6], ['chaos_rune', 1, 2], ['death_rune', 1, 2], ['herb', 7], ['seed', 18],
    ['coins', 14, 38], ['coins', 10, 52], ['coins', 8, 15], ['coins', 6, 8], ['coins', 2, 88], ['limpwurt_root', 11], ['body_talisman', 2], ['gem', 3]],
    tert: [['rune_2h_sword', 118]] },   // the hill giant club's slot
  bryophyta: { den: 128, main: [['black_sq_shield', 5], ['staff', 2], ['steel_med_helm', 2], ['mithril_sword', 2], ['mithril_spear', 2], ['steel_kiteshield', 1], ['law_rune', 4, 3],
    ['air_rune', 3, 18], ['earth_rune', 3, 27], ['chaos_rune', 3, 7], ['nature_rune', 3, 6], ['cosmic_rune', 2, 3], ['iron_arrow', 2, 15], ['steel_arrow', 1, 30], ['death_rune', 1, 3],
    ['blood_rune', 1, 1], ['herb', 5], ['useed', 35], ['coins', 19, 37], ['coins', 8, 2], ['coins', 10, 119], ['coins', 2, 300], ['steel_bar', 6], ['coal', 1]],
    tert: [['mystic_mud_staff', 128]] },   // TODO: verify — her staff comes from the chest, not a drop rate
  scurrius: { den: 100, main: [['coins', 6, 1000, 9000], ['rune_platebody', 6], ['rune_med_helm', 6], ['rune_full_helm', 6], ['rune_sq_shield', 6], ['rune_chainbody', 6],
    ['rune_battleaxe', 6], ['adamant_arrow', 6, 20, 50], ['rune_arrow', 6, 20, 50], ['chaos_rune', 6, 70, 125], ['death_rune', 3, 40, 90], ['law_rune', 3, 10, 30]] },
  scorpia: { den: 128, main: [['coins', 7, 25002, 34962], ['battlestaff', 6, 5, 8], ['rune_2h_sword', 5], ['rune_pickaxe', 5], ['rune_kiteshield', 5], ['dragon_scimitar', 1],
    ['dragon_2h_sword', 1], ['death_rune', 8, 100, 150], ['blood_rune', 8, 100, 150], ['chaos_rune', 8, 150, 200], ['grimy_kwuarm', 5, 10, 15], ['grimy_dwarf_weed', 5, 10, 15],
    ['grimy_torstol', 5, 10, 15], ['grimy_snapdragon', 5, 4, 7], ['uncut_ruby', 6, 15, 20], ['uncut_diamond', 4, 10, 15], ['runite_ore', 4, 3]],
    tert: [['dragon_claws', 128]] },   // the odium/malediction shard slot
  eldric: { den: 56, rolls: 2, main: [['coins', 2, 10000, 30000], ['mystic_of_water', 2, 4], ['battlestaff_of_water', 2, 6], ['rune_plateskirt', 2], ['rune_platelegs', 2],
    ['rune_scimitar', 2], ['rune_sq_shield', 2], ['rune_hatchet', 2], ['rune_pickaxe', 1], ['water_rune', 2, 1500, 3000], ['chaos_rune', 2, 100, 200], ['death_rune', 2, 50, 100],
    ['nature_rune', 2, 50, 100], ['law_rune', 2, 50, 100], ['blood_rune', 2, 50, 100]], tert: [['dragon_warhammer', 75], ['dragon_kiteshield', 75], ['amulet_of_power', 16]] },
  branda: { den: 55, rolls: 2, main: [['coins', 2, 10000, 30000], ['mystic_of_fire', 2, 4], ['battlestaff_of_fire', 2, 6], ['rune_plateskirt', 2], ['rune_platelegs', 2],
    ['rune_scimitar', 2], ['rune_sq_shield', 2], ['rune_hatchet', 2], ['rune_pickaxe', 2], ['fire_rune', 2, 1500, 3000], ['chaos_rune', 2, 100, 200], ['death_rune', 2, 50, 100],
    ['nature_rune', 2, 50, 100], ['law_rune', 2, 50, 100], ['blood_rune', 2, 50, 100]], tert: [['dragon_halberd', 75], ['dragon_platelegs', 75], ['amulet_of_power', 16]] },
  kbd: { alw: [['black_dragonhide', 2]], den: 128, main: [['rune_longsword', 10], ['adamant_platebody', 9], ['air_rune', 10, 300], ['fire_rune', 5, 300], ['iron_arrow', 10, 690],
    ['rune_bolts', 10, 10, 20], ['law_rune', 5, 30], ['blood_rune', 5, 30], ['yew_logs', 10, 150], ['rune_bar', 3], ['amulet_of_power', 7], ['dragon_arrowtips', 5, 5, 14],
    ['dragon_dart_tips', 5, 5, 14], ['dragon_javelin', 5, 15], ['dragon_med_helm', 1]], tert: [['dragon_pickaxe', 1000]] },
  sarachnis: { nb: 1, den: 800, main: [['battlestaff', 16, 8, 10], ['rune_platebody', 16], ['rune_med_helm', 16], ['rune_2h_sword', 16], ['blood_rune', 40, 80, 100], ['chaos_rune', 40, 175, 200],
    ['cosmic_rune', 40, 125, 150], ['death_rune', 40, 80, 100], ['mithril_arrow', 16, 450, 600], ['mithril_bolts', 16, 175, 225], ['maple_seed', 8, 2], ['yew_seed', 8], ['rseed', 16],
    ['grimy_kwuarm', 15, 10, 15], ['grimy_dwarf_weed', 12, 10, 15], ['grimy_cadantine', 12, 10, 15], ['grimy_avantoe', 10, 5, 10], ['grimy_lantadyme', 9, 10, 15],
    ['grimy_snapdragon', 8, 5, 10], ['grimy_ranarr', 8, 5, 10], ['grimy_torstol', 6, 5, 10], ['mithril_ore', 48, 60, 90], ['red_dragonhide', 40, 15, 25], ['uncut_sapphire', 32, 20, 30],
    ['adamantite_ore', 24, 30, 40], ['uncut_emerald', 24, 20, 30], ['uncut_ruby', 16, 20, 30], ['runite_ore', 8, 4, 6], ['uncut_diamond', 8, 20, 30], ['coins', 48, 17000, 25000],
    ['dragon_bones', 40, 10, 15], ['gem', 8]], tert: [['dragon_med_helm', 192], ['dragon_battleaxe', 384]] },   // the cudgel slot
  skotizo: { nb: 1, den: 100, main: [['rune_platebody', 7, 3], ['rune_platelegs', 7, 3], ['rune_plateskirt', 7, 3], ['death_rune', 7, 500], ['blood_rune', 7, 450],
    ['adamantite_ore', 7, 75], ['grimy_snapdragon', 7, 20], ['grimy_torstol', 7, 20], ['raw_anglerfish', 7, 60], ['rune_bar', 7, 20], ['battlestaff', 7, 25]],
    tert: [['uncut_dragonstone', 111, 10], ['uncut_onyx', 1000]] },
  kalphitequeen: { den: 126, main: [['battlestaff', 5, 10], ['rune_chainbody', 4], ['red_dhide_body', 4], ['rune_knife', 4, 25], ['lava_battlestaff', 2], ['death_rune', 6, 150],
    ['blood_rune', 6, 100], ['mithril_arrow', 5, 500], ['rune_arrow', 3, 250], ['grimy_toadflax', 2, 25], ['grimy_ranarr', 2, 25], ['grimy_snapdragon', 2, 25], ['grimy_torstol', 2, 25],
    ['torstol_seed', 4, 2], ['watermelon_seed', 3, 25], ['magic_seed', 3, 2], ['rune_bar', 5, 3], ['gold_ore', 4, 250], ['magic_logs', 4, 60], ['uncut_emerald', 3, 25],
    ['uncut_ruby', 3, 25], ['uncut_diamond', 3, 25], ['wine_of_zamorak', 10, 60], ['potato_cactus', 8, 100], ['coins', 5, 15000, 20000], ['rdt', 1]],
    tert: [['dragon_chainbody', 128], ['dragon_2h_sword', 256], ['dragon_pickaxe', 400], ['monkfish', 9, 3], ['shark', 9, 2], ['dark_crab', 9, 2]] },
  vorkath: { nb: 1, alw: [['dragon_bones', 2], ['blue_dragonhide', 2]], den: 150, rolls: 2, main: [['rune_longsword', 5, 2, 3], ['rune_kiteshield', 5, 2, 3], ['battlestaff', 4, 5, 15],
    ['dragon_battleaxe', 2], ['dragon_longsword', 2], ['dragon_platelegs', 2], ['dragon_plateskirt', 2], ['chaos_rune', 6, 250, 350], ['death_rune', 6, 200, 300],
    ['blue_dragonhide', 8, 25, 30], ['green_dragonhide', 7, 25, 30], ['red_dragonhide', 7, 20, 25], ['black_dragonhide', 7, 15, 25], ['dragon_bolts_u', 8, 50, 100],
    ['dragon_dart', 6, 10, 50], ['dragon_arrowtips', 3, 25, 50], ['rune_dart', 3, 75, 100], ['adamantite_ore', 7, 10, 30], ['coins', 5, 20000, 80000], ['magic_logs', 5, 50],
    ['dragon_bones', 4, 15, 20], ['diamond', 4, 10, 20], ['dragonstone', 3, 2, 3], ['raw_shark', 4, 35, 55], ['snapdragon_seed', 1], ['torstol_seed', 1], ['rdt', 5]] },
  venenatis: { nb: 1, den: 126, alw: [['big_bones', 1]], main: [
    ['mystic_of_air', 2, 4], ['rune_pickaxe', 8, 5], ['rune_dart', 3, 150], ['rune_knife', 5, 150],
    ['rune_platelegs', 2, 4], ['rune_sq_shield', 2, 4], ['dragon_dagger', 2, 6],
    ['chaos_rune', 7, 500], ['death_rune', 7, 700], ['blood_rune', 7, 900],
    ['diamond_bolts_e', 5, 300], ['steel_cannonball', 4, 600],
    ['uncut_ruby', 1, 50], ['uncut_diamond', 8, 25], ['gold_ore', 6, 675], ['onyx_bolt_tips', 5, 150],
    ['magic_logs', 5, 225], ['limpwurt_root', 5, 100], ['red_spiders_eggs', 3, 500], ['unicorn_horn', 1, 225],
    ['uncut_dragonstone', 2, 5], ['grimy_ranarr', 1, 45], ['grimy_snapdragon', 1, 100], ['grimy_toadflax', 1, 45],
    ['battlestaff', 2, 12], ['coins', 10, 50000], ['supercompost', 4, 225], ['antipoison_4', 3, 20],
    ['super_restore_4', 5, 10], ['dark_crab', 5, 50], ['blighted_anglerfish', 1, 100], ['law_rune', 3, 60]],
    tert: [['dragon_2h_sword', 256], ['dragon_pickaxe', 256], ['ring_of_wealth', 512]] },
  callisto: { nb: 1, den: 126, alw: [['big_bones', 1]], main: [
    ['mystic_of_earth', 2, 4], ['mystic_robe_top', 2, 4], ['mystic_robe_bottom', 2, 4], ['rune_pickaxe', 8, 5],
    ['rune_2h_sword', 3, 3], ['rune_kiteshield', 2, 4], ['rune_platebody', 2, 4],
    ['blood_rune', 7, 500], ['death_rune', 7, 700], ['chaos_rune', 7, 900], ['soul_rune', 5, 450],
    ['steel_cannonball', 4, 600],
    ['uncut_ruby', 4, 50], ['uncut_diamond', 3, 25], ['uncut_dragonstone', 2, 5], ['limpwurt_root', 5, 100],
    ['magic_logs', 5, 225], ['mahogany_logs', 6, 600], ['red_dragonhide', 3, 170], ['coconut', 2, 135],
    ['grimy_toadflax', 1, 100], ['grimy_dwarf_weed', 1, 45], ['grimy_ranarr', 1, 45], ['grimy_snapdragon', 1, 45],
    ['ranarr_seed', 5, 11], ['snapdragon_seed', 5, 5],
    ['coins', 10, 50000], ['dark_crab', 5, 50], ['super_restore_4', 5, 10], ['supercompost', 4, 225],
    ['dragon_bones', 3, 75], ['blighted_anglerfish', 1, 100], ['law_rune', 3, 60]],
    tert: [['dragon_2h_sword', 256], ['dragon_pickaxe', 256], ['ring_of_wealth', 512]] },
  vetion: { nb: 1, den: 126, alw: [['big_bones', 1]], main: [
    ['mystic_of_fire', 2, 4], ['mystic_of_water', 2, 4], ['mystic_robe_top', 2, 4], ['mystic_robe_bottom', 2, 4],
    ['rune_full_helm', 2, 4], ['rune_pickaxe', 8, 5], ['rune_dart', 3, 150], ['rune_knife', 3, 150],
    ['chaos_rune', 7, 900], ['death_rune', 7, 700], ['blood_rune', 7, 500], ['steel_cannonball', 4, 550],
    ['uncut_ruby', 4, 50], ['uncut_diamond', 3, 25], ['uncut_dragonstone', 2, 5], ['gold_ore', 6, 675],
    ['limpwurt_root', 5, 60], ['wine_of_zamorak', 5, 100], ['magic_logs', 5, 225], ['oak_plank', 5, 400],
    ['dragon_bones', 3, 150], ['mort_myre_fungus', 2, 450], ['grimy_ranarr', 1, 100], ['grimy_dwarf_weed', 1, 45],
    ['grimy_snapdragon', 1, 45], ['grimy_toadflax', 1, 45],
    ['coins', 10, 50000], ['supercompost', 4, 225], ['super_restore_4', 5, 10], ['blighted_anglerfish', 1, 100],
    ['sanfew_4', 5, 20], ['dark_crab', 5, 50], ['law_rune', 3, 60]],
    tert: [['dragon_2h_sword', 256], ['dragon_pickaxe', 256], ['ring_of_wealth', 512]] },
  graardor: { den: 127, main: [['coins', 32, 19500, 20000], ['rune_longsword', 8], ['rune_2h_sword', 8], ['rune_platebody', 8], ['rune_pickaxe', 6], ['grimy_snapdragon', 8, 3],
    ['nature_rune', 8, 65, 70]], tert: [['dragon_warhammer', 381], ['dragon_chainbody', 381], ['dragon_boots', 381], ['dragon_platebody', 508]] },   // the dragon pieces predate the true Bandos set (added below at the same wiki rates); both now fall
  kril: { nb: 1, den: 127, main: [['coins', 37, 19500, 20000], ['adamant_arrow', 8, 295, 300], ['rune_scimitar', 8], ['adamant_platebody', 8], ['rune_platelegs', 7],
    ['dragon_dagger', 2], ['death_rune', 8, 120, 125], ['blood_rune', 8, 80, 85], ['grimy_lantadyme', 8, 10]],
    tert: [['steam_battlestaff', 127], ['dragon_spear', 127], ['master_wand', 508], ['dragon_mace', 128]] },   // the true zamorakian spear and staff of the dead join below at the wiki's rates; these older slots still pay
  evilchicken: { alw: [['raw_chicken', 1], ['feather', 90, 242]], tert: [['dragon_spear', 128], ['amulet_of_glory', 128]] },   // TODO: verify — random-event boss, no OSRS table
  slashbash: { nb: 1, alw: [['big_bones', 5]], tert: [['dragon_spear', 128], ['dragon_hasta', 128]] },   // TODO: verify — two zogre and three ourg bones stand in as big bones
  bktitan: { den: 128, main: [['iron_full_helm', 5], ['iron_dagger', 4], ['iron_kiteshield', 3], ['steel_longsword', 2], ['iron_arrow', 6, 3], ['fire_rune', 3, 15], ['water_rune', 3, 7],
    ['law_rune', 3, 2], ['nature_rune', 2, 6], ['chaos_rune', 1, 2], ['death_rune', 1, 2], ['herb', 7], ['seed', 18], ['limpwurt_root', 11], ['body_talisman', 2], ['coins', 14, 38],
    ['coins', 10, 52], ['coins', 8, 15], ['coins', 6, 8], ['coins', 2, 88]], tert: [['dragon_longsword', 128], ['dragon_full_helm', 128]] }   // TODO: verify — quest boss signatures
};
const SHOP_FOR_RANK = [['general'], ['general', 'pub', 'weapon', 'craft'], ['general', 'pub', 'weapon', 'smith', 'archery', 'craft'],
  ['general', 'pub', 'weapon', 'armour', 'smith', 'magic', 'archery', 'craft'], ['general', 'pub', 'weapon', 'armour', 'smith', 'magic', 'archery', 'food', 'craft']];
/* picking: a sphere test per nearby thing; index by object type t */
const PICK_R = [1.7, 1.15, 1.5, 2.4, 1.5, 1.1, 1.6, 1.1, 1.5, 1.1, 1.2, 1.8, 1.1, 1.5, 1.6, 1.3, 1.4], PICK_Y = [2.4, 0.55, 0.05, 1.6, 0.9, 0.9, 1.0, 0.9, 0.8, 0.9, 0.9, 1.0, 0.9, 0.8, 1.0, 0.3, 0.6];
const EQ_SLOTS = ['head', 'body', 'legs', 'weapon', 'shield', 'ammo', 'hands', 'feet', 'cape', 'neck', 'ring'];   // append-only: saves are positional
const TOWNFOLK = [['man', 'woman', 'farmer', 'goblin', 'masterfarmer', 'chicken', 'cow', 'sheep'], ['man', 'woman', 'farmer', 'monk', 'dwarf', 'barbarian', 'masterfarmer', 'chicken', 'cow', 'duck'],
  ['man', 'woman', 'farmer', 'monk', 'dwarf', 'guard', 'masterfarmer', 'watchman', 'chicken', 'cow', 'duck'], ['man', 'woman', 'monk', 'wizard', 'thug', 'guard', 'watchman', 'rogue', 'chicken', 'duck'],
  ['man', 'woman', 'wizard', 'pirate', 'thug', 'guard', 'watchman', 'rogue', 'chicken', 'duck']];
const EQ_LAY = ['cape', 'head', 'ammo', 'weapon', 'body', 'shield', 'hands', 'legs', 'feet', 'neck', null, 'ring'];
const RING_NOTES = { anti_dragon_shield: ' Turns dragonfire aside.', ring_of_recoil: ' Bites back a tenth of every blow.', ring_of_life: ' Carries you to safety at a tenth of your health, once.', ring_of_wealth: ' Clears the empty slots from the rare drop tables.' };
const KEY_TAB = { KeyI: 'inv', KeyE: 'eq', KeyK: 'sk', KeyC: 'cb', KeyM: 'mg', KeyP: 'pr' };
/* icon art per place kind: [glyph, colour, shade, label]; MK07 gives most a real 07 map sprite */
const MK_ART = { bank: ['coins', '#ffd94a', '#9a7414', 'Bank'], ge: ['coins', '#ffb02a', '#b05a10', 'Grand Exchange'], barber: ['hat', '#e87ac8', '#8a3a72', 'Barber'],
  3: ['flame', '#ff8c2a', '#ffd9a0', 'Furnace'], 4: ['hammer', '#d8dbe2', '#8a8f98', 'Anvil'], 6: ['cfish', '#ffb04a', '#7a4a20', 'Cooking range'], altar: ['star', '#fff2b0', '#c9a24a', 'Altar'],
  11: ['rune', '#e8e8ff', '#6a6a9a', 'Rune altar'], 12: ['skull', '#e8e0c8', '#5a5348', 'Slayer master'], 13: ['log', '#d8b070', '#6a4a26', 'Sawmill'], 14: ['coins', '#d8b04a', '#7a5a1a', 'Market stall'],
  15: ['leaf', '#7ad04a', '#2f6a28', 'Farming patch'], 16: ['boot', '#9ad0e8', '#3a6a8a', 'Agility obstacle'],
  mine: ['pick', '#e8c86a', '#6b5436', 'Mine'], grove: ['log', '#8ad04a', '#2f6a28', 'Grove'], 28: ['lock', '#d8b04a', '#6b4e22', 'Guild'],
  house: ['house', '#e8d9b0', '#6b4e22', 'Your house'], skull: ['skull', '#f4ead0', '#1a1a1a', 'Where you fell'],
  pvp: ['skull', '#ff5a3a', '#ffd9c9', 'Wilderness'] };   // the wilderness tag's badge, not a map marker
const KEEP_TINT = { 7: 0x9fb4e8, 9: 0xf2b8d8, 10: 0xf2cf6a, 5: 0xffffff, 12: 0xd8c8a0 };
const COMPASS = ['N ↑', 'NE ↗', 'E →', 'SE ↘', 'S ↓', 'SW ↙', 'W ←', 'NW ↖'];
/* voices: the weapon in hand picks the wav */
const WSND = { mace: 2508, wham: 2508, staff: 2560, wand: 2560, trident: 2560, whip: 2720 };
const ACT_CODE = { chop: 1, mine: 2, fish: 3, cook: 4, smelt: 4, smith: 4, attack: 5 };   // 6 cast, 7 draw, 8 thrust
const REMOTE_LOOK = { skin: 0, shirt: 0, legs: 0 };   // the barber's look does not travel
const MARK_H = [0, 0, 0, 4.6, 2.9, 3.4, 3.1, 3.4, 3.0, 3.4, 3.6, 3.2, 3.4, 3.0, 3.4, 1.5, 2.0, 0, 0, 0, 0, 0, 0, 4.4, 0, 4.2];   // float height by object type; a missing entry is a NaN plate stuck to the sky
const WORDS = ['ash', 'fen', 'mor', 'var', 'dun', 'kel', 'thorn', 'bry', 'loch', 'gald', 'riven', 'oak', 'stow', 'mere', 'harrow', 'cairn', 'wyn', 'drake', 'elm', 'vale'];
const DISC = ['rgba(255,220,140,.55)', 'rgba(255,214,110,.6)', 'rgba(255,190,70,.68)', 'rgba(255,150,40,.78)', 'rgba(255,96,32,.88)'];
const AGIL_N = ['Log balance', 'Climbing rocks'];
const DPIECE = ['vambraces', 'chaps', 'body'];   // one, two, three dragon leathers
const PATCH_N = ['Allotment', 'Herb patch', 'Tree patch'];
const TRAP_N = ['Bird snare', 'Box trap', 'Deadfall'], TRAP_LV = [1, 27, 33];
/* wood tints for the shape builders */
const HW = { p: [0.82, 0.69, 0.45], o: [0.66, 0.51, 0.25], m: [0.48, 0.23, 0.16], g: [0.95, 0.78, 0.25], mb: [0.88, 0.87, 0.83], ls: [0.76, 0.73, 0.65], st: [0.52, 0.53, 0.56], cl: [0.74, 0.71, 0.61] };
/* a theme is a family of monsters and a palette; min is the ground power it starts appearing at */
const DUN_THEMES = [
  { pl: 'Crypt', min: 0, fc: [0.27, 0.30, 0.25], ks: ['rat', 'skeleton', 'zombie', 'ghost', 'shade', 'ghoul', 'skelwarrior', 'spectre', 'banshee', 'giantskeleton'], bs: ['scurrius', 'vetion'] },
  { pl: 'Den', min: 0, fc: [0.30, 0.27, 0.24], ks: ['rat', 'smallspider', 'spider', 'redspider', 'poisonspider', 'shadowspider'], bs: ['sarachnis', 'venenatis'] },
  { pl: 'Warren', min: 0, fc: [0.29, 0.26, 0.21], ks: ['goblin', 'redgoblin', 'hobgoblin', 'ogre', 'jogre', 'ogrechief', 'troll', 'hillgiant', 'mossgiant', 'cyclops'], bs: ['obor', 'slashbash', 'bryophyta', 'graardor'] },
  { pl: 'Hive', min: 0.4, fc: [0.33, 0.29, 0.19], ks: ['smallscorpion', 'scorpion', 'kalphiteworker', 'kalphitesoldier', 'jackal'], bs: ['scorpia', 'kalphitequeen'] },
  { pl: 'Abyss', min: 0.8, fc: [0.31, 0.21, 0.21], ks: ['imp', 'darkwizard', 'zamorakmonk', 'lesserdemon', 'greaterdemon', 'blackdemon', 'jungledemon'], bs: ['skotizo', 'kril'] },
  { pl: 'Hold', min: 0.5, fc: [0.27, 0.26, 0.27], ks: ['mugger', 'thug', 'rogue', 'bandit', 'pirate', 'darkwizard', 'blackknight', 'hero'], bs: ['bktitan'] },
  { pl: 'Depths', min: 0.9, fc: [0.24, 0.27, 0.31], ks: ['icewarrior', 'icegiant', 'icetroll', 'whitewolf', 'firegiant', 'earthwarrior'], bs: ['eldric', 'branda', 'trollking'] },
  { pl: 'Lair', min: 1.2, fc: [0.31, 0.24, 0.19], ks: ['babygreendragon', 'babybluedragon', 'greendragon', 'bluedragon', 'reddragon', 'blackdragon', 'bronzedragon', 'irondragon', 'steeldragon'], bs: ['elvarg', 'kbd', 'vorkath', 'galvek'] }
];
const ENCH = [['sapphire', 7, 17.5, [['cosmic_rune', 1], ['water_rune', 1]], 'ring_of_recoil', 'amulet_of_magic'],
  ['emerald', 27, 37, [['cosmic_rune', 1], ['air_rune', 3]], 'ring_of_dueling', 'amulet_of_defence'],
  ['ruby', 49, 59, [['cosmic_rune', 1], ['fire_rune', 5]], 0, 'amulet_of_strength'],
  ['diamond', 57, 67, [['cosmic_rune', 1], ['earth_rune', 10]], 'ring_of_life', 'amulet_of_power'],
  ['dragonstone', 68, 78, [['cosmic_rune', 1], ['water_rune', 15], ['earth_rune', 15]], 'ring_of_wealth', 'amulet_of_glory'],
  ['onyx', 87, 97, [['cosmic_rune', 1], ['earth_rune', 20], ['fire_rune', 20]], 0, 0]]   // the onyx amulet and necklace gain their products post-hoc: the fury and the berserker
  .map(([g, lv, xp, need, ring, amu]) => ({ g, lv, xp, need, ring, amu }));
/* gem-tipped bolts: cut the tips, pin them to the matching metal, enchant ten at a time. Strengths are the book's own. */
const EBOLT = [['sapphire', 'mithril_bolts', 56, 4, 47, 83, 36], ['emerald', 'mithril_bolts', 58, 5.5, 55, 85, 36], ['ruby', 'adamant_bolts', 63, 6.3, 63, 103, 46],
  ['diamond', 'adamant_bolts', 65, 7, 70, 105, 46], ['dragonstone', 'rune_bolts', 71, 8.2, 82, 117, 61]];
const BARROWS_SUB = [['dharoks_helm', 1], ['dharoks_platebody', 1], ['dharoks_platelegs', 1], ['dharoks_greataxe', 1],
  ['guthans_helm', 1], ['guthans_platebody', 1], ['guthans_chainskirt', 1], ['guthans_warspear', 1],
  ['torags_helm', 1], ['torags_platebody', 1], ['torags_platelegs', 1], ['torags_hammers', 1],
  ['veracs_helm', 1], ['veracs_brassard', 1], ['veracs_plateskirt', 1], ['veracs_flail', 1],
  ['karils_coif', 1], ['karils_leathertop', 1], ['karils_leatherskirt', 1], ['karils_crossbow', 1],
  ['ahrims_hood', 1], ['ahrims_robetop', 1], ['ahrims_robeskirt', 1], ['ahrims_staff', 1]];
const RAID_SUB = [['dragon_hunter_crossbow', 4], ['ancestral_hat', 3], ['ancestral_robe_top', 3], ['ancestral_robe_bottom', 3], ['kodai_wand', 2], ['twisted_bow', 2],
  ['elder_maul', 2], ['twisted_buckler', 3]];   // the raid vault's own weights
/* the three later vaults, each on the wiki's own relative rarity within its chest */
const TOB_SUB = [['avernic_defender_hilt', 6], ['justiciar_faceguard', 4], ['justiciar_chestguard', 3], ['justiciar_legguards', 3],
  ['ghrazi_rapier', 4], ['sanguinesti_staff', 3], ['blade_of_saeldor', 3], ['scythe_of_vitur', 1]];
const TOA_SUB = [['osmumtens_fang', 4], ['lightbearer', 4], ['masori_mask', 3], ['elidinis_ward', 3], ['masori_body', 2], ['masori_chaps', 2], ['tumekens_shadow', 1]];
const NM_SUB = [['nightmare_staff', 6], ['inquisitors_great_helm', 4], ['inquisitors_plateskirt', 4], ['inquisitors_hauberk', 3], ['inquisitors_mace', 3],
  ['harmonised_orb', 2], ['eldritch_orb', 2], ['volatile_orb', 2]];
/* every boss walks again in miniature; wiki rates where the pet exists, 1/3000 where 2007 never granted one — TODO: verify */
/* the visage, at each dragon's own wiki odds; bronze/red/green/blue are excluded there and stay so here */
const VISAGE_RATE = { irondragon: 10000, steeldragon: 10000, mithrildragon: 10000, blackdragon: 10000, adamantdragon: 9000, runedragon: 8000 };
const PET_RATE = { skotizo: 65, scorpia: 2016, vetion: 1500, venenatis: 1500, callisto: 1500, kbd: 3000, vorkath: 3000, sarachnis: 3000, kalphitequeen: 3000, scurrius: 3000, graardor: 5000, kril: 5000 };
/* combat feats: four badges a boss — the kill, the flawless kill, the one-style kill, and the swift kill */
const CA_BITS = [[1, 'Slain'], [2, 'Flawless'], [4, 'One style'], [8, 'Swift']];
/* one reward table a tier: staples everywhere, trimmed rune from medium, gilded only out of hard caskets */
const CLUE_STAPLES = [['coins', 30, 800, 6000], ['nature_rune', 10, 20, 60], ['law_rune', 8, 10, 40], ['death_rune', 6, 10, 40], ['blood_rune', 3, 5, 20], ['sapphire', 8, 1, 4],
  ['emerald', 6, 1, 3], ['ruby', 5, 1, 2], ['diamond', 3]];
const CLUE_TRIM = [['rune_full_helm_t', 2], ['rune_platelegs_t', 2], ['rune_plateskirt_t', 1], ['rune_kiteshield_t', 2], ['rune_platebody_t', 1]];
const CLUE_LOOT = [CLUE_STAPLES, CLUE_STAPLES.concat([['dragonstone', 1]], CLUE_TRIM),
  CLUE_STAPLES.concat([['dragonstone', 2]], CLUE_TRIM, [['rune_full_helm_g', 1], ['rune_platelegs_g', 1], ['rune_kiteshield_g', 1], ['rune_platebody_g', 0.5], ['rune_plateskirt_g', 0.5]])];
/* the vault's impossible metal: 3rd age at the wiki's spirit (about 1/15,000 a piece — the true 1/42k would never land at this
   game's pace), the gilded tools beside it; ranger boots keep the wiki's medium-casket odds. Rolled in openCasket. */
const VAULT_SUB = [['third_age_full_helmet', 1], ['third_age_platebody', 1], ['third_age_platelegs', 1], ['third_age_kiteshield', 1], ['third_age_longsword', 1],
  ['third_age_range_coif', 1], ['third_age_range_top', 1], ['third_age_range_legs', 1], ['third_age_vambraces', 1], ['third_age_bow', 1],
  ['third_age_mage_hat', 1], ['third_age_robe_top', 1], ['third_age_robe', 1], ['third_age_wand', 1], ['third_age_amulet', 1],
  ['gilded_hatchet', 3], ['gilded_pickaxe', 3]];

/* ARM: wearable rows consumed by armSeg() in index.html — W(id, name|0, glyph, c.c2|0, slot, val, req?|0, rest?).
   Segment order and row order are ITEMS insertion order: append within a segment, never resort. */
const ARM = {
  seg0: [
    ['gilded_hatchet', 0, 'axe', 0, 'weapon', 882, { woodcutting: 41 }, { tier: 6, tname: 'Gilded', spd: 5, atk: 28, str: 35, tool: 'woodcutting' }],
    ['gilded_pickaxe', 0, 'pick', 0, 'weapon', 764, { mining: 41 }, { tier: 6, tname: 'Gilded', spd: 5, atk: 21, str: 28, tool: 'mining' }],
    ['leather_gloves', 0, 'glove', 0, 'hands', 6, { defence: 1 }, { def: 1 }],
    ['leather_boots', 0, 'boot', 0, 'feet', 9, { defence: 1 }, { def: 2 }],
    ['anti_dragon_shield', 'Anti-dragon shield', 'shield', 0, 'shield', 120, 0, { def: 8 }],
    ['snakeskin_boots', 0, 'boot', 0, 'feet', 85, { ranged: 30, defence: 30 }, { def: 1, rat: 3 }],
  ],
  seg1: [
    ['dharoks_helm', "Dharok's helm", 'fhelm', 0, 'head', 60000, { defence: 70 }, { def: 46 }],
    ['dharoks_platebody', "Dharok's platebody", 'body', 0, 'body', 180000, { defence: 70 }, { def: 116 }],
    ['dharoks_platelegs', "Dharok's platelegs", 'legs', 0, 'legs', 120000, { defence: 70 }, { def: 83 }],
    ['dharoks_greataxe', "Dharok's greataxe", 'baxe', 0, 'weapon', 150000, { attack: 70, strength: 70 }, { two: 1, atk: 103, str: 105, spd: 7 }],
    ['guthans_helm', "Guthan's helm", 'fhelm', 0, 'head', 60000, { defence: 70 }, { def: 56 }],
    ['guthans_platebody', "Guthan's platebody", 'body', 0, 'body', 180000, { defence: 70 }, { def: 116 }],
    ['guthans_chainskirt', "Guthan's chainskirt", 'skirt', 0, 'legs', 110000, { defence: 70 }, { def: 73 }],
    ['guthans_warspear', "Guthan's warspear", 'spear', 0, 'weapon', 130000, { attack: 70 }, { two: 1, stab: 1, atk: 75, str: 75, spd: 5 }],
    ['torags_helm', "Torag's helm", 'fhelm', 0, 'head', 60000, { defence: 70 }, { def: 56 }],
    ['torags_platebody', "Torag's platebody", 'body', 0, 'body', 180000, { defence: 70 }, { def: 116 }],
    ['torags_platelegs', "Torag's platelegs", 'legs', 0, 'legs', 120000, { defence: 70 }, { def: 83 }],
    ['torags_hammers', "Torag's hammers", 'wham', 0, 'weapon', 100000, { attack: 70, strength: 70 }, { two: 1, atk: 85, str: 72, spd: 5 }],
    ['veracs_helm', "Verac's helm", 'fhelm', 0, 'head', 70000, { defence: 70 }, { def: 56, pb: 3 }],
    ['veracs_brassard', "Verac's brassard", 'body', 0, 'body', 170000, { defence: 70 }, { def: 87, pb: 5 }],
    ['veracs_plateskirt', "Verac's plateskirt", 'skirt', 0, 'legs', 130000, { defence: 70 }, { def: 83, pb: 4 }],
    ['veracs_flail', "Verac's flail", 'mace', 0, 'weapon', 120000, { attack: 70 }, { two: 1, atk: 82, str: 72, spd: 5, pb: 6 }],
    ['karils_coif', "Karil's coif", 'hat', 0, 'head', 50000, { ranged: 70, defence: 70 }, { def: 9, rat: 7 }],
    ['karils_leathertop', "Karil's leathertop", 'robe', 0, 'body', 170000, { ranged: 70, defence: 70 }, { def: 46, rat: 30 }],
    ['karils_leatherskirt', "Karil's leatherskirt", 'legs', 0, 'legs', 110000, { ranged: 70, defence: 70 }, { def: 25, rat: 17 }],
    ['karils_crossbow', "Karil's crossbow", 'cbow', 0, 'weapon', 140000, { ranged: 70 }, { bow: 1, two: 1, ammoT: 'bolt', spd: 4, rng: 8, rat: 84 }],
    ['ahrims_hood', "Ahrim's hood", 'hat', 0, 'head', 50000, { magic: 70, defence: 70 }, { def: 15, mag: 6, mdmg: 1 }],
    ['ahrims_robetop', "Ahrim's robetop", 'robe', 0, 'body', 170000, { magic: 70, defence: 70 }, { def: 51, mag: 30, mdmg: 1 }],
    ['ahrims_robeskirt', "Ahrim's robeskirt", 'skirt', 0, 'legs', 110000, { magic: 70, defence: 70 }, { def: 33, mag: 22, mdmg: 1 }],
    ['ahrims_staff', "Ahrim's staff", 'staff', 0, 'weapon', 130000, { attack: 70, magic: 70 }, { atk: 65, str: 68, mag: 15, mdmg: 5, spd: 6 }],
  ],
  seg2: [
    ['bandos_godsword', 0, 'sword2h', 0, 'weapon', 350000, { attack: 75 }, { two: 1, atk: 132, str: 132, spd: 6, pb: 8 }],
    ['saradomin_godsword', 0, 'sword2h', 0, 'weapon', 300000, { attack: 75 }, { two: 1, atk: 132, str: 132, spd: 6, pb: 8 }],
    ['zamorak_godsword', 0, 'sword2h', 0, 'weapon', 280000, { attack: 75 }, { two: 1, atk: 132, str: 132, spd: 6, pb: 8 }],
    ['bandos_chestplate', 0, 'body', 0, 'body', 300000, { defence: 65 }, { def: 99, str: 4, pb: 1 }],
    ['bandos_tassets', 0, 'legs', 0, 'legs', 280000, { defence: 65 }, { def: 67, str: 2, pb: 1 }],
    ['bandos_boots', 0, 'boot', 0, 'feet', 40000, { defence: 65 }, { def: 18, str: 0, pb: 1 }],
    ['armadyl_helmet', 0, 'hat', 0, 'head', 300000, { ranged: 70, defence: 70 }, { def: 8, rat: 10, pb: 1 }],
    ['armadyl_chestplate', 0, 'robe', 0, 'body', 500000, { ranged: 70, defence: 70 }, { def: 55, rat: 33, pb: 1 }],
    ['armadyl_chainskirt', 0, 'skirt', 0, 'legs', 450000, { ranged: 70, defence: 70 }, { def: 31, rat: 20, pb: 1 }],
  ],
  seg3: [
    ['zamorakian_spear', 0, 'spear', 0, 'weapon', 180000, { attack: 70 }, { two: 1, stab: 1, atk: 85, str: 75, spd: 4, pb: 2 }],
    ['toktz_xil_ak', 'Toktz-xil-ak', 'sword', 0, 'weapon', 60000, { attack: 60 }, { stab: 1, atk: 47, str: 49, spd: 4 }],
    ['tzhaar_ket_om', 'Tzhaar-ket-om', 'wham', 0, 'weapon', 75000, { strength: 60 }, { two: 1, atk: 80, str: 85, spd: 7 }],
    ['berserker_necklace', 0, 'amulet', 0, 'neck', 70000, 0, { atk: -10, str: 7, def: -20, pb: 3 }],   // its obsidian charm lands in maxHit()
  ],
  seg4: [
    ['amulet_of_fury', 0, 'amulet', 0, 'neck', 200000, 0, { atk: 10, str: 8, def: 15, mag: 10, rat: 10, pb: 5 }],
    ['amulet_of_torture', 0, 'amulet', 0, 'neck', 300000, 0, { atk: 15, str: 10, pb: 2 }],
    ['necklace_of_anguish', 0, 'amulet', 0, 'neck', 300000, 0, { rat: 15, rst: 5, pb: 2 }],
    ['occult_necklace', 0, 'amulet', 0, 'neck', 400000, 0, { mag: 12, mdmg: 5, pb: 2 }],   // the wiki's rebalanced 5% magic damage, through bonus('mdmg')
    ['berserker_ring', 0, 'ring', 0, 'ring', 120000, 0, { str: 4, def: 1 }],
    ['warrior_ring', 0, 'ring', 0, 'ring', 60000, 0, { atk: 4, def: 1 }],
    ['archers_ring', 0, 'ring', 0, 'ring', 100000, 0, { rat: 4, def: 0 }],
    ['seers_ring', 0, 'ring', 0, 'ring', 80000, 0, { mag: 6, mdmg: 0.2, def: 0 }],
    ['primordial_boots', 0, 'boot', 0, 'feet', 300000, { defence: 75 }, { def: 22, str: 5, atk: 2 }],
    ['pegasian_boots', 0, 'boot', 0, 'feet', 350000, { ranged: 75, defence: 75 }, { def: 5, rat: 12, rst: 1 }],
    ['eternal_boots', 0, 'boot', 0, 'feet', 250000, { magic: 75, defence: 75 }, { def: 5, mag: 8, mdmg: 1 }],
    ['ranger_boots', 0, 'boot', 0, 'feet', 200000, { ranged: 40 }, { def: 3, rat: 8 }],
    ['fire_cape', 0, 'cape', 0, 'cape', 80000, 0, { atk: 1, str: 4, def: 11, mag: 1, rat: 1, pb: 2 }],
    ['avas_assembler', "Ava's assembler", 'cape', 0, 'cape', 90000, { ranged: 70 }, { rat: 8, rst: 2, save: 0.8, def: 1 }],
    ['saradomin_cape', 0, 'cape', 0, 'cape', 20000, { magic: 60 }, { mag: 10, def: 1 }],
    ['zamorak_cape', 0, 'cape', 0, 'cape', 20000, { magic: 60 }, { mag: 10, def: 1 }],
    ['guthix_cape', 0, 'cape', 0, 'cape', 20000, { magic: 60 }, { mag: 10, def: 1 }],
  ],
  seg5: [
    ['trident_of_the_seas', 0, 'trident', 0, 'weapon', 300000, { magic: 75 }, { mag: 15, spd: 4, pstaff: 1 }],   // a powered staff: casts its own bolt, four ticks, max = magic/3 - 5
    ['mages_book', "Mage's book", 'shield', 0, 'shield', 120000, { magic: 60 }, { mag: 15, mdmg: 2 }],
    ['infinity_hat', 0, 'hat', 0, 'head', 120000, { magic: 50, defence: 25 }, { def: 0, mag: 6, mdmg: 1 }],
    ['infinity_top', 0, 'robe', 0, 'body', 300000, { magic: 50, defence: 25 }, { def: 0, mag: 22, mdmg: 1 }],
    ['infinity_bottoms', 0, 'legs', 0, 'legs', 250000, { magic: 50, defence: 25 }, { def: 0, mag: 17, mdmg: 1 }],
    ['infinity_boots', 0, 'boot', 0, 'feet', 80000, { magic: 50, defence: 25 }, { def: 0, mag: 5 }],
    ['ancestral_hat', 0, 'hat', 0, 'head', 500000, { magic: 75, defence: 65 }, { def: 12, mag: 8, mdmg: 3 }],
    ['ancestral_robe_top', 0, 'robe', 0, 'body', 900000, { magic: 75, defence: 65 }, { def: 41, mag: 35, mdmg: 3 }],
    ['ancestral_robe_bottom', 0, 'legs', 0, 'legs', 800000, { magic: 75, defence: 65 }, { def: 27, mag: 26, mdmg: 3 }],
  ],
  seg6: [
    ['third_age_full_helmet', '3rd age full helmet', 'fhelm', 0, 'head', 500000, { defence: 65 }, { def: 46 }],
    ['third_age_platebody', '3rd age platebody', 'body', 0, 'body', 900000, { defence: 65 }, { def: 106 }],
    ['third_age_platelegs', '3rd age platelegs', 'legs', 0, 'legs', 700000, { defence: 65 }, { def: 79 }],
    ['third_age_kiteshield', '3rd age kiteshield', 'shield', 0, 'shield', 600000, { defence: 65 }, { def: 63 }],
    ['third_age_longsword', '3rd age longsword', 'lsword', 0, 'weapon', 800000, { attack: 65 }, { atk: 72, str: 75, spd: 5 }],
    ['third_age_range_coif', '3rd age range coif', 'hat', 0, 'head', 500000, { ranged: 65 }, { def: 7, rat: 9 }],
    ['third_age_range_top', '3rd age range top', 'robe', 0, 'body', 900000, { ranged: 65 }, { def: 54, rat: 30 }],
    ['third_age_range_legs', '3rd age range legs', 'legs', 0, 'legs', 700000, { ranged: 65 }, { def: 30, rat: 17 }],
    ['third_age_vambraces', '3rd age vambraces', 'glove', 0, 'hands', 400000, { ranged: 65 }, { def: 6, rat: 11 }],
    ['third_age_bow', '3rd age bow', 'bow', 0, 'weapon', 900000, { ranged: 65 }, { bow: 1, two: 1, spd: 4, rng: 9, rat: 80 }],
    ['third_age_mage_hat', '3rd age mage hat', 'hat', 0, 'head', 500000, { magic: 65 }, { def: 0, mag: 8, mdmg: 1 }],
    ['third_age_robe_top', '3rd age robe top', 'robe', 0, 'body', 900000, { magic: 65 }, { def: 0, mag: 24, mdmg: 1 }],
    ['third_age_robe', '3rd age robe', 'skirt', 0, 'legs', 800000, { magic: 65 }, { def: 0, mag: 19, mdmg: 1 }],
  ],
  /* seg7 — MELEE, the far shore: the raid blades, the Zarosian and Justiciar plate, the Inquisitor's crush kit.
     atk is the wiki's best attack style, def the rounded mean of its stab/slash/crush, mdef the amount by which its
     magic DEFENCE parts from its magic attack (the engine folds the two into `mag`, so only the gap needs a key). */
  seg7: [
    ['elder_maul', 0, 'wham', 0, 'weapon', 1449000, { attack: 75, strength: 75 }, { two: 1, atk: 135, str: 147, spd: 6 }],
    ['soulreaper_axe', 0, 'baxe', 0, 'weapon', 1500000, { attack: 80, strength: 80 }, { two: 1, atk: 134, str: 125, spd: 5, souls: 1 }],
    ['osmumtens_fang', "Osmumten's fang", 'dagger', 0, 'weapon', 1268000, { attack: 82 }, { stab: 1, atk: 105, str: 103, spd: 5, fang: 1 }],
    ['scythe_of_vitur', 'Scythe of vitur', 'scythe', 0, 'weapon', 1500000, { attack: 80, strength: 90 }, { two: 1, atk: 125, str: 75, def: 5, mag: -6, mdef: 6, spd: 5, reach: 2, big3: 1 }],
    ['inquisitors_mace', "Inquisitor's mace", 'mace', 0, 'weapon', 1500000, { attack: 80 }, { atk: 102, str: 96, pb: 2, spd: 4 }],
    ['ghrazi_rapier', 0, 'sword', 0, 'weapon', 1301000, { attack: 80 }, { stab: 1, atk: 100, str: 93, spd: 4 }],
    ['blade_of_saeldor', 0, 'lsword', 0, 'weapon', 1465000, { attack: 80 }, { atk: 100, str: 93, spd: 4 }],
    ['barrelchest_anchor', 0, 'wham', 0, 'weapon', 230000, { attack: 60, strength: 40 }, { two: 1, atk: 92, str: 100, spd: 6 }],
    ['saradomins_blessed_sword', "Saradomin's blessed sword", 'lsword', 0, 'weapon', 290000, { attack: 75 }, { two: 1, atk: 100, str: 88, pb: 2, spd: 4 }],
    ['zamorakian_hasta', 0, 'spear', 0, 'weapon', 1451000, { attack: 70 }, { stab: 1, atk: 85, str: 75, def: 13, pb: 2, spd: 4, reach: 2 }],
    ['voidwaker', 0, 'sword', 0, 'weapon', 1351000, { attack: 75 }, { atk: 80, str: 80, mag: 5, spd: 4 }],
    ['leaf_bladed_battleaxe', 'Leaf-bladed battleaxe', 'baxe', 0, 'weapon', 72000, { attack: 65, slayer: 55 }, { atk: 72, str: 92, spd: 5 }],
    ['dragon_hunter_lance', 0, 'spear', 0, 'weapon', 1376000, { attack: 78 }, { stab: 1, atk: 85, str: 70, spd: 4, reach: 2, dbane: 1 }],
    ['torva_full_helm', 0, 'fhelm', 0, 'head', 200000, { defence: 80 }, { str: 8, def: 60, rat: -5, mag: -5, pb: 1 }],
    ['justiciar_faceguard', 0, 'fhelm', 0, 'head', 1031000, { defence: 75 }, { def: 61, rat: -2, mag: -6, pb: 2 }],
    ['serpentine_helm', 0, 'helm', 0, 'head', 110000, { defence: 75 }, { str: 5, def: 55, rat: -5, mag: -5, mdef: 5, psnImm: 1, envenom: 1 }],
    ['neitiznot_faceguard', 0, 'fhelm', 0, 'head', 550000, { defence: 70 }, { str: 6, def: 36, pb: 3 }],
    ['helm_of_neitiznot', 0, 'helm', 0, 'head', 50000, { defence: 55 }, { str: 3, def: 31, pb: 3 }],
    ['inquisitors_great_helm', "Inquisitor's great helm", 'fhelm', 0, 'head', 500000, { strength: 70, defence: 30 }, { atk: 10, str: 6, def: 17, rat: -5, mag: -5, pb: 1, mdef: 5 }],
    ['granite_helm', 0, 'fhelm', 0, 'head', 46000, { defence: 50, strength: 50 }, { def: 31, rat: -7, mag: -9, mdef: 8 }],
    ['torva_platebody', 0, 'body', 0, 'body', 600000, { defence: 80 }, { str: 6, def: 115, rat: -14, mag: -18, pb: 1, mdef: 7 }],
    ['justiciar_chestguard', 0, 'body', 0, 'body', 1151000, { defence: 75 }, { def: 126, rat: -20, mag: -40, pb: 4, mdef: 24 }],
    ['inquisitors_hauberk', "Inquisitor's hauberk", 'body', 0, 'body', 1000000, { strength: 70, defence: 30 }, { atk: 16, str: 4, def: 64, rat: -10, mag: -11, pb: 2, mdef: 11 }],
    ['torva_platelegs', 0, 'legs', 0, 'legs', 400000, { defence: 80 }, { str: 4, def: 81, rat: -11, mag: -24, pb: 1, mdef: 15 }],
    ['justiciar_legguards', 0, 'legs', 0, 'legs', 1119000, { defence: 75 }, { def: 93, rat: -17, mag: -31, pb: 4, mdef: 17 }],
    ['inquisitors_plateskirt', "Inquisitor's plateskirt", 'skirt', 0, 'legs', 750000, { strength: 70, defence: 30 }, { atk: 12, str: 2, def: 40, rat: -5, mag: -9, pb: 2, mdef: 9 }],
    ['granite_gloves', 0, 'glove', 0, 'hands', 34000, { defence: 50, strength: 50 }, { atk: 9, str: 7, def: 8, rat: -1, mag: -3 }],
    ['spiked_manacles', 0, 'glove', 0, 'hands', 3000, 0, { str: 4, rat: -1, mag: -3 }],
    ['ferocious_gloves', 0, 'glove', 0, 'hands', 100000, { attack: 80, defence: 80 }, { atk: 16, str: 14, rat: -16, mag: -16, mdef: 16 }],
    ['guardian_boots', 0, 'boot', 0, 'feet', 305000, { defence: 75 }, { str: 3, def: 32, rat: -1, mag: -3, pb: 2 }],
    ['granite_boots', 0, 'boot', 0, 'feet', 13000, { defence: 50, strength: 50 }, { str: 3, def: 16, rat: -1, mag: -3 }],
    ['elysian_spirit_shield', 0, 'shield', 0, 'shield', 1031000, { defence: 75, prayer: 75 }, { def: 68, pb: 3, elys: 1 }],
    ['avernic_defender', 0, 'defender', 0, 'shield', 1055000, { attack: 70, defence: 70 }, { atk: 30, str: 8, def: 29, rat: -4, mag: -5 }],
    ['infernal_cape', 0, 'cape', 0, 'cape', 80000, 0, { atk: 4, str: 8, def: 12, rat: 1, mag: 1, pb: 2, mdef: 11 }],
    ['mythical_cape', 0, 'cape', 0, 'cape', 10000, 0, { atk: 6, str: 1, def: 8, pb: 1, mdef: 8 }],
    ['amulet_of_blood_fury', 0, 'amulet', 0, 'neck', 402000, 0, { atk: 10, str: 8, def: 15, rat: 10, mag: 10, pb: 5, mdef: 5, bfury: 1 }],
    ['amulet_of_rancour', 0, 'amulet', 0, 'neck', 400000, { hitpoints: 90 }, { atk: 25, str: 12, rat: -8, mag: -6, pb: 2, mdef: 6 }],
    ['bellator_ring', 0, 'ring', 0, 'ring', 140000, 0, { atk: 20, str: 6 }],
    ['ultor_ring', 0, 'ring', 0, 'ring', 140000, 0, { str: 12 }],
    ['tyrannical_ring', 0, 'ring', 0, 'ring', 50000, 0, { atk: 8, def: 3 }],
    ['treasonous_ring', 0, 'ring', 0, 'ring', 50000, 0, { atk: 8, def: 3 }],
  ],
  /* seg8 — RANGED: the crystal and Zaryte launchers (all four of the bows carry their own ammunition), Masori,
     and the shields that trade melee guard for arrows. */
  seg8: [
    ['bow_of_faerdhinen', 'Bow of faerdhinen', 'bow', 0, 'weapon', 1131000, { ranged: 80 }, { two: 1, rat: 128, rst: 106, spd: 5, bow: 1, selfAmmo: 1, rng: 10 }],
    ['zaryte_crossbow', 0, 'cbow', 0, 'weapon', 990000, { ranged: 80 }, { def: 13, rat: 110, pb: 1, mdef: 15, spd: 6, bow: 1, ammoT: 'bolt', rng: 8 }],
    ['venator_bow', 0, 'bow', 0, 'weapon', 750000, { ranged: 80 }, { two: 1, rat: 90, rst: 25, spd: 5, bow: 1, selfAmmo: 1, rng: 6, bounce: 1 }],
    ['webweaver_bow', 0, 'bow', 0, 'weapon', 175000, { ranged: 70 }, { two: 1, rat: 85, rst: 65, spd: 4, bow: 1, selfAmmo: 1, rng: 9, wild: 1.5 }],
    ['craws_bow', "Craw's bow", 'bow', 0, 'weapon', 120000, { ranged: 60 }, { two: 1, rat: 75, rst: 60, spd: 4, bow: 1, selfAmmo: 1, rng: 9, wild: 1.5 }],
    ['masori_mask', 0, 'hat', 0, 'head', 800000, { ranged: 80, defence: 30 }, { def: 3, rat: 12, rst: 2, mag: -1, mdef: 7 }],
    ['masori_body', 0, 'robe', 0, 'body', 1200000, { ranged: 80, defence: 30 }, { def: 37, rat: 43, rst: 4, mag: -4, mdef: 29 }],
    ['masori_chaps', 0, 'legs', 0, 'legs', 1000000, { ranged: 80, defence: 30 }, { def: 26, rat: 27, rst: 2, mag: -2, mdef: 21 }],
    ['zaryte_vambraces', 0, 'glove', 0, 'hands', 200000, { ranged: 80, defence: 45 }, { atk: -8, def: 8, rat: 18, rst: 2, pb: 1, mdef: 5 }],
    ['twisted_buckler', 0, 'shield', 0, 'shield', 90000, { ranged: 75, defence: 75 }, { atk: -7, def: 23, rat: 18, rst: 10, mag: -10, mdef: 36 }],
    ['dragonfire_ward', 0, 'shield', 0, 'shield', 1031000, { ranged: 70, defence: 75 }, { atk: -10, str: -2, def: 28, rat: 15, rst: 8, mag: -10, mdef: 38 }],
    ['venator_ring', 0, 'ring', 0, 'ring', 140000, 0, { rat: 10, rst: 2 }],
  ],
  /* seg9 — MAGIC: the powered staves (pmax is their own max-hit offset off magic/3), the Nightmare orbs,
     Virtus, and the bark armours the runecrafter presses out of magic logs. */
  seg9: [
    ['ancient_sceptre', 0, 'staff', 0, 'weapon', 211000, { magic: 70, strength: 60, attack: 50 }, { two: 1, atk: 50, str: 60, def: 2, mag: 20, mdmg: 10, pb: -1, mdef: -5, spd: 4 }],
    ['tumekens_shadow', "Tumeken's shadow", 'staff', 0, 'weapon', 1167000, { magic: 85 }, { two: 1, mag: 35, pb: 1, mdef: -15, spd: 5, pstaff: 1, pmax: 1, ptint: 0xe8c86a, m3: 1 }],
    ['trident_of_the_swamp', 0, 'trident', 0, 'weapon', 79000, { magic: 78 }, { def: 2, mag: 25, mdef: -10, spd: 4, pstaff: 1, pmax: -2, ptint: 0x6ac84a, psn: 6, venom: 1 }],
    ['sanguinesti_staff', 0, 'trident', 0, 'weapon', 1131000, { magic: 82 }, { def: 2, rat: -4, mag: 25, mdef: -10, spd: 4, pstaff: 1, pmax: -1, ptint: 0xc8203a, sang: 1 }],
    ['harmonised_nightmare_staff', 0, 'staff', 0, 'weapon', 1122000, { magic: 82, hitpoints: 50 }, { two: 1, mag: 16, mdmg: 15, spd: 5, fastcast: 1 }],
    ['volatile_nightmare_staff', 0, 'staff', 0, 'weapon', 1122000, { magic: 82, hitpoints: 50 }, { two: 1, mag: 16, mdmg: 15, spd: 5 }],
    ['eldritch_nightmare_staff', 0, 'staff', 0, 'weapon', 1122000, { magic: 82, hitpoints: 50 }, { two: 1, mag: 16, mdmg: 15, spd: 5 }],
    ['nightmare_staff', 0, 'staff', 0, 'weapon', 600000, { magic: 72, hitpoints: 50 }, { two: 1, mag: 16, mdmg: 15, spd: 5 }],
    ['bloodbark_helm', 0, 'helm', 0, 'head', 15000, { magic: 60, defence: 60 }, { def: 16, mag: 5, mdmg: 1 }],
    ['virtus_mask', 0, 'hat', 0, 'head', 200000, { magic: 78, defence: 75 }, { def: 15, rat: -3, mag: 8, mdmg: 2, pb: 1 }],
    ['swampbark_helm', 0, 'helm', 0, 'head', 15000, { magic: 50, defence: 50 }, { def: 13, mag: 4 }],
    ['bloodbark_body', 0, 'robe', 0, 'body', 120000, { magic: 60, defence: 60 }, { def: 52, mag: 21, mdmg: 1 }],
    ['virtus_robe_top', 0, 'robe', 0, 'body', 600000, { magic: 78, defence: 75 }, { def: 46, rat: -11, mag: 35, mdmg: 2, pb: 2 }],
    ['swampbark_body', 0, 'robe', 0, 'body', 120000, { magic: 50, defence: 50 }, { def: 43, mag: 15, mdef: 6 }],
    ['bloodbark_legs', 0, 'legs', 0, 'legs', 80000, { magic: 60, defence: 60 }, { def: 34, mag: 16, mdmg: 1 }],
    ['virtus_robe_bottom', 0, 'skirt', 0, 'legs', 400000, { magic: 78, defence: 75 }, { def: 31, rat: -9, mag: 26, mdmg: 2, pb: 1 }],
    ['swampbark_legs', 0, 'legs', 0, 'legs', 80000, { magic: 50, defence: 50 }, { def: 22, mag: 10, mdef: 5 }],
    ['tormented_bracelet', 0, 'glove', 0, 'hands', 201000, { hitpoints: 75 }, { mag: 10, mdmg: 5, pb: 2, mdef: -10 }],
    ['bloodbark_gauntlets', 0, 'glove', 0, 'hands', 10000, { magic: 60, defence: 60 }, { def: 5, mag: 4 }],
    ['swampbark_gauntlets', 0, 'glove', 0, 'hands', 10000, { magic: 50, defence: 50 }, { def: 4, mag: 3 }],
    ['infinity_gloves', 0, 'glove', 0, 'hands', 12000, { magic: 50, defence: 25 }, { mag: 5 }],
    ['bloodbark_boots', 0, 'boot', 0, 'feet', 10000, { magic: 60, defence: 60 }, { def: 5, mag: 4 }],
    ['swampbark_boots', 0, 'boot', 0, 'feet', 10000, { magic: 50, defence: 50 }, { def: 4, mag: 3 }],
    ['arcane_spirit_shield', 0, 'shield', 0, 'shield', 1031000, { defence: 75, prayer: 70, magic: 65 }, { def: 60, mag: 20, mdmg: 3, pb: 3, mdef: -18 }],
    ['ancient_wyvern_shield', 0, 'shield', 0, 'shield', 1031000, { defence: 75, magic: 70 }, { atk: -10, str: -2, def: 76, rat: -10, mag: 15, mdmg: 2 }],
    ['elidinis_ward', "Elidinis' ward", 'shield', 0, 'shield', 1131000, { magic: 80, defence: 80, prayer: 80 }, { def: 6, mag: 5, mdmg: 3, pb: 1, mdef: -5 }],
    ['book_of_darkness', 0, 'shield', 0, 'shield', 30000, 0, { mag: 10, pb: 5, mdef: -10 }],
    ['imbued_saradomin_cape', 0, 'cape', 0, 'cape', 80000, { magic: 75 }, { def: 3, mag: 15, mdmg: 2 }],
    ['imbued_zamorak_cape', 0, 'cape', 0, 'cape', 80000, { magic: 75 }, { def: 3, mag: 15, mdmg: 2 }],
    ['imbued_guthix_cape', 0, 'cape', 0, 'cape', 80000, { magic: 75 }, { def: 3, mag: 15, mdmg: 2 }],
    ['magus_ring', 0, 'ring', 0, 'ring', 140000, 0, { mag: 15, mdmg: 2, mdef: -15 }],
  ],
  /* seg10 — WORN BY ALL THREE: the gloves, the prayer boots, the rings that ask nothing and give much. */
  seg10: [
    ['barrows_gloves', 0, 'glove', 0, 'hands', 100000, 0, { atk: 12, str: 12, def: 12, rat: 12, mag: 6 }],
    ['boots_of_brimstone', 0, 'boot', 0, 'feet', 20000, { slayer: 44, defence: 70, magic: 70, ranged: 70 }, { atk: 3, def: 10, rat: 5, mag: 3 }],
    ['devout_boots', 0, 'boot', 0, 'feet', 20000, { prayer: 60 }, { pb: 5 }],
    ['holy_sandals', 0, 'boot', 0, 'feet', 2000, { prayer: 31 }, { pb: 3 }],
    ['spectral_spirit_shield', 0, 'shield', 0, 'shield', 1031000, { defence: 75, prayer: 70, magic: 65 }, { def: 60, pb: 3, mdef: 30 }],
    ['ardougne_max_cape', 0, 'cape', 0, 'cape', 99000, 0, { atk: 6, def: 2, mag: 6, pb: 6, reqMax: 1 }],
    ['max_cape', 0, 'cape', 0, 'cape', 99000, 0, { def: 9, pb: 4, mdef: 9, reqMax: 1 }],
    ['amulet_of_the_damned', 0, 'amulet', 0, 'neck', 58000, 0, { atk: 10, str: 6, def: 3, rat: 10, mag: 10, pb: 3, mdef: -7 }],
    ['brimstone_ring', 0, 'ring', 0, 'ring', 10000, 0, { atk: 4, str: 4, def: 4, rat: 4, mag: 6, mpierce: 1 }],
    ['ring_of_suffering', 0, 'ring', 0, 'ring', 201000, 0, { def: 20, pb: 4, mdef: 20 }],
    ['granite_ring', 0, 'ring', 0, 'ring', 15000, { defence: 50, strength: 50 }, { def: 2 }],
    ['ring_of_the_gods', 0, 'ring', 0, 'ring', 50000, 0, { def: 1, pb: 8, wrench: 1 }],
    ['lightbearer', 0, 'ring', 0, 'ring', 1000000, 0, { fastspec: 1 }],
  ],};

/* NPCS: bestiary rows consumed in index.html — [k, n, lv, hp, atk, str, def, abon, sz, body, build, rest?].
   Colours are 6-digit strings, two digits a channel, /100 ("929086" -> [0.92, 0.90, 0.86]) — decoded exactly in C3().
   build is ['H'|'Q'|'SP'|'DR'|'SKEL'|'GH', ...factory args]; row order is the wire contract, append only. */
const NPCS = [
  // livestock and vermin
  ['chicken', 'Chicken', 1, 3, 1, 1, 1, -47, 0.7, '929086', ['Q', 0.34, 0.5, 0.5, { head: '908680', leg: '856220', tail: '959390' }], { sbon: -42, flee: 1, meat: 'raw_chicken' }],
  ['rat', 'Giant rat', 3, 5, 2, 3, 2, 0, 0.8, '423325', ['Q', 0.62, 0.5, 1, { legs: 0, head: '504030', tail: '604540' }]],
  ['cow', 'Cow', 2, 8, 1, 1, 1, -15, 1.1, '888682', ['Q', 0.9, 1.15, 1.6, { head: '302624', leg: '302624', tail: '302624', horns: 1, snout: 1 }], { sbon: -15, flee: 1, meat: 'raw_beef' }],
  ['spider', 'Giant spider', 2, 5, 1, 1, 1, -10, 0.9, '241820', ['SP', 0.8, undefined, '361414', '161213'], { sbon: -10 }],
  ['goblin', 'Goblin', 5, 12, 3, 1, 4, 12, 0.9, '365026', ['H', 0.6, 1.25, { skin: '456230', ears: 1 }], { sbon: 12, spd: 6 }],
  ['imp', 'Imp', 2, 8, 1, 1, 1, -42, 0.7, '622820', ['H', 0.44, 0.9, { skin: '723424', horns: 1, ears: 1 }], { sbon: -37, mspd: 1.2 }],
  // the middle of the game
  ['barbarian', 'Barbarian', 8, 14, 6, 5, 5, 8, 0.95, '554228', ['H', 0.72, 1.62, { skin: '806246', belt: '282014' }], { sbon: 10, spd: 6 }],
  ['zombie', 'Zombie', 13, 22, 8, 9, 10, 0, 0.95, '384232', ['H', 0.66, 1.55, { skin: '505642', arm: '343830' }], { agg: 1, mspd: 0.8 }],
  ['bandit', 'Bandit', 22, 27, 17, 17, 17, 11, 0.9, '282422', ['H', 0.7, 1.6, { skin: '786045', belt: '501414' }], { agg: 1, sbon: 12, human: 1, pick: { lv: 45, xp: 65, loot: [['coins', 1, 40]] } }],
  ['skeleton', 'Skeleton', 21, 24, 17, 17, 17, 0, 0.9, '878679', ['SKEL', 0.66, 1.6], { agg: 1, at: 'mr', rng: 5, arrow: 14208942, db: 5 }],
  ['ghost', 'Ghost', 19, 25, 13, 13, 18, 0, 0.95, '626874', ['GH', 0.72, 1.7, '768084'], { agg: 1, db: 5, mspd: 0.9 }],
  ['guard', 'Guard', 21, 22, 19, 18, 14, 4, 0.95, '424450', ['H', 0.76, 1.7, { skin: '786045', belt: '303034' }], { db: 25, sbon: 5, human: 1, pick: { lv: 40, xp: 46.8, loot: [['coins', 1, 30]] } }],
  ['scorpion', 'King scorpion', 32, 30, 30, 29, 23, 0, 1, '503416', ['SP', 1, undefined, '604220', '422814'], { agg: 1 }],
  ['wolf', 'Wolf', 25, 34, 20, 16, 22, 0, 1, '424245', ['Q', 0.7, 1, 1.5, { head: '343437', leg: '303033', tail: '464649', snout: 1 }], { agg: 1, mspd: 1.5 }],
  ['bear', 'Black bear', 19, 25, 15, 16, 13, 0, 1.2, '161413', ['Q', 1.05, 1.35, 1.8, { head: '201816', leg: '131110', snout: 1 }], { agg: 1, mspd: 1.1 }],
  ['hobgoblin', 'Hobgoblin', 28, 29, 22, 24, 24, 0, 1, '404430', ['H', 0.86, 1.95, { skin: '505632', ears: 1, belt: '302216' }], { agg: 1 }],
  // the big ones
  ['hillgiant', 'Hill giant', 28, 35, 18, 22, 26, 18, 1.9, '625036', ['H', 1.9, 4, { skin: '746045', belt: '342416' }], { agg: 1, sbon: 16, spd: 6, mspd: 0.6, big: 1 }],
  ['mossgiant', 'Moss giant', 42, 60, 30, 30, 30, 33, 2.1, '294021', ['H', 2.1, 4.3, { skin: '374825', belt: '202814' }], { agg: 1, sbon: 31, spd: 6, mspd: 0.6, big: 1 }],
  ['ogre', 'Ogre', 53, 60, 43, 43, 43, 22, 2, '555030', ['H', 2, 3.8, { skin: '666036', belt: '302214' }], { agg: 1, sbon: 20, spd: 6, mspd: 0.6, big: 1 }],
  ['icegiant', 'Ice giant', 53, 70, 40, 40, 40, 29, 2.2, '627686', ['H', 2.2, 4.6, { skin: '728592', belt: '405568' }], { agg: 1, db: 3, sbon: 31, spd: 5, mspd: 0.6, big: 1 }],
  ['troll', 'Mountain troll', 69, 90, 40, 75, 40, 20, 2.2, '444240', ['H', 2.2, 4.2, { skin: '525046', horns: 1, belt: '302826' }], { agg: 1, at: 'mr', rng: 6, arrow: 9077881, sbon: 20, spd: 6, mspd: 0.6, big: 1 }],
  ['greendragon', 'Green dragon', 79, 75, 68, 68, 68, 0, 2.6, '223820', ['DR', 1.6, 2.6, '284524', '173016'], { agg: 1, fire: 1, at: 'mg', rng: 6, bolt: 7327818, db: 40, mspd: 0.7, big: 1 }],
  ['lesserdemon', 'Lesser demon', 82, 79, 68, 70, 71, 0, 2.3, '551612', ['H', 2, 4.4, { skin: '662014', horns: 1, wings: 1, wing: '301010', belt: '200806' }], { agg: 1, mspd: 0.9, big: 1 }],
  ['firegiant', 'Fire giant', 86, 111, 65, 65, 65, 29, 2.4, '723412', ['H', 2.3, 4.8, { skin: '824616', belt: '401606' }], { agg: 1, db: 3, sbon: 31, spd: 5, mspd: 0.6, big: 1 }],
  ['greaterdemon', 'Greater demon', 92, 87, 76, 78, 81, 0, 2.6, '351014', ['H', 2.4, 5.2, { skin: '501416', horns: 1, wings: 1, wing: '200608', belt: '160506' }], { agg: 1, mspd: 0.9, big: 1 }],
  ['blackdragon', 'Black dragon', 227, 190, 200, 200, 200, 0, 3, '131215', ['DR', 2, 3.2, '191822', '090811'], { agg: 1, fire: 1, at: 'mg', rng: 7, bolt: 12602076, db: 70, mspd: 0.7, big: 1 }],
  // folk of the road
  ['man', 'Man', 2, 7, 1, 1, 1, 0, 0.95, '504230', ['H', 0.72, 1.6, { skin: '806246' }], { human: 1, pick: { lv: 1, xp: 8, loot: [['coins', 1, 3]] } }],
  ['woman', 'Woman', 2, 7, 1, 1, 1, 0, 0.9, '563442', ['H', 0.66, 1.55, { skin: '826448' }], { human: 1, pick: { lv: 1, xp: 8, loot: [['coins', 1, 3]] } }],
  ['mugger', 'Mugger', 6, 8, 5, 5, 5, 0, 0.95, '343026', ['H', 0.7, 1.6, { skin: '745642' }], { agg: 1, sbon: -21 }],
  ['farmer', 'Farmer', 7, 12, 3, 4, 8, 5, 0.95, '625532', ['H', 0.7, 1.6, { skin: '786044' }], { sbon: 6, spd: 6, human: 1, pick: { lv: 10, xp: 14.5, loot: [['coins', 9, 9], ['potato_seed', 1]] } }],
  ['redgoblin', 'Red goblin', 5, 12, 3, 1, 4, 12, 0.9, '552420', ['H', 0.6, 1.25, { skin: '583024', ears: 1 }], { agg: 1, sbon: 12, spd: 6 }],
  ['dwarf', 'Dwarf', 10, 16, 8, 8, 6, 5, 0.85, '453525', ['H', 0.8, 1.15, { skin: '806246', belt: '302214' }], { sbon: 7, spd: 5, mspd: 0.9 }],
  ['thug', 'Thug', 10, 18, 7, 5, 9, 5, 0.95, '302830', ['H', 0.72, 1.62, { skin: '725540', belt: '201816' }], { agg: 1, sbon: 5 }],
  ['pirate', 'Pirate', 23, 20, 21, 21, 21, 8, 0.95, '202434', ['H', 0.72, 1.65, { skin: '765842', belt: '551414' }], { agg: 1, sbon: 10, spd: 5 }],
  ['blackknight', 'Black Knight', 33, 42, 25, 25, 25, 18, 0.95, '141416', ['H', 0.78, 1.72, { skin: '745642', belt: '101012' }], { agg: 1, db: 76, sbon: 16, spd: 5 }],
  ['ghoul', 'Ghoul', 42, 50, 30, 40, 30, 0, 0.95, '444638', ['H', 0.68, 1.7, { skin: '606250', arm: '404234' }], { agg: 1, mspd: 1.1 }],
  ['whiteknight', 'White Knight', 42, 55, 32, 35, 27, 30, 0.95, '848690', ['H', 0.78, 1.72, { skin: '786045', belt: '555866' }], { agg: 1, db: 76, sbon: 31, spd: 7, human: 1, pick: { lv: 55, xp: 84.3, loot: [['coins', 1, 50]] } }],
  ['chaosdwarf', 'Chaos dwarf', 48, 61, 38, 42, 28, 13, 0.9, '481816', ['H', 0.85, 1.2, { skin: '664434', belt: '281009' }], { agg: 1, db: 34, sbon: 9, mspd: 0.9 }],
  ['earthwarrior', 'Earth warrior', 51, 54, 42, 42, 42, 0, 0.95, '383020', ['H', 0.74, 1.65, { skin: '484028', belt: '241812' }], { agg: 1, db: 40 }],
  ['jogre', 'Jogre', 53, 60, 43, 43, 43, 22, 2, '344624', ['H', 2, 3.8, { skin: '445630', belt: '223014' }], { agg: 1, sbon: 20, spd: 6, mspd: 0.6, big: 1 }],
  ['cyclops', 'Cyclops', 56, 75, 47, 50, 26, 0, 1.85, '524844', ['H', 1.8, 3.4, { skin: '625852' }], { agg: 1, mspd: 0.7, big: 1 }],
  ['icewarrior', 'Ice warrior', 57, 59, 47, 47, 47, 0, 0.95, '567284', ['H', 0.76, 1.7, { skin: '708492', belt: '365064' }], { agg: 1, db: 40 }],
  ['paladin', 'Paladin', 62, 57, 54, 54, 54, 20, 0.95, '726634', ['H', 0.8, 1.75, { skin: '786045', belt: '464018' }], { agg: 1, db: 84, sbon: 22, spd: 5, human: 1, pick: { lv: 70, xp: 151.75, loot: [['coins', 9, 80], ['chaos_rune', 1, 2]] } }],
  ['hero', 'Hero', 69, 82, 54, 55, 54, 20, 0.95, '304462', ['H', 0.8, 1.75, { skin: '786045', belt: '625628' }], { agg: 1, db: 84, sbon: 22, spd: 5, human: 1, pick: { lv: 80, xp: 273.3, loot: [['coins', 6, 200, 300], ['death_rune', 1, 2], ['diamond', 1], ['gold_ore', 1]] } }],
  ['icetroll', 'Ice troll', 74, 60, 60, 70, 70, 60, 2.2, '607280', ['H', 2.2, 4.2, { skin: '708288', horns: 1, belt: '405058' }], { agg: 1, db: 60, sbon: 60, mspd: 0.6, big: 1 }],
  ['ogrechief', 'Ogre chieftain', 81, 60, 75, 71, 75, 5, 2.3, '605230', ['H', 2.3, 4.4, { skin: '706236', belt: '402012' }], { agg: 1, sbon: 7, mspd: 0.6, big: 1 }],
  ['jungledemon', 'Jungle demon', 195, 170, 170, 170, 170, 50, 2.3, '244422', ['H', 2, 4.4, { skin: '325426', horns: 1, wings: 1, wing: '163014', belt: '142612' }], { agg: 1, sbon: 50, spd: 6, mspd: 0.9, big: 1 }],
  ['trollgeneral', 'Troll general', 113, 140, 70, 140, 40, 60, 2.5, '383642', ['H', 2.5, 4.8, { skin: '464450', horns: 1, belt: '262428' }], { agg: 1, sbon: 100, mspd: 0.6, big: 1 }],
  ['blackdemon', 'Black demon', 172, 157, 145, 148, 152, 0, 2.8, '110912', ['H', 2.7, 5.8, { skin: '181418', horns: 1, wings: 1, wing: '070508', belt: '060507' }], { agg: 1, mspd: 0.9, big: 1 }],
  // unattackable in 2007: flavour stats
  ['masterfarmer', 'Master Farmer', 32, 64, 23, 24, 21, 11, 0.95, '465026', ['H', 0.72, 1.62, { skin: '765842', belt: '302214' }], { town: 1, db: 12, spd: 5, human: 1, pick: { lv: 38, xp: 43, loot: 'CROPSEEDS' } }],
  ['rogue', 'Rogue', 15, 17, 13, 13, 13, 5, 0.95, '222024', ['H', 0.68, 1.6, { skin: '745642', belt: '121012' }], { town: 1, sbon: 5, human: 1, pick: { lv: 32, xp: 35.5, loot: [['coins', 8, 25, 40], ['air_rune', 1, 8], ['sapphire', 1], ['flax', 1, 3]] } }],
  ['watchman', 'Watchman', 33, 22, 31, 31, 31, 0, 0.95, '243046', ['H', 0.76, 1.7, { skin: '786045', belt: '504220' }], { town: 1, human: 1, pick: { lv: 65, xp: 137.5, loot: [['coins', 9, 60], ['bread', 1]] } }],
  // the robed
  ['monk', 'Monk', 5, 15, 2, 2, 3, 0, 0.95, '483624', ['GH', 0.7, 1.65, '806246']],
  ['wizard', 'Wizard', 9, 14, 8, 8, 5, 0, 0.95, '242856', ['GH', 0.7, 1.7, '806246', 1], { agg: 1, at: 'mg', rng: 5, bolt: 6970064, max: 4, stay: 1 }],
  ['darkwizard', 'Dark wizard', 20, 24, 17, 17, 14, 0, 0.95, '141220', ['GH', 0.7, 1.7, '725642', 1], { agg: 1, at: 'mg', rng: 5, bolt: 6970064, max: 6, stay: 1 }],
  ['banshee', 'Banshee', 23, 22, 22, 15, 22, 0, 0.95, '727466', ['GH', 0.68, 1.72, '848678'], { agg: 1, db: 5, max: 6, mspd: 0.9 }],
  ['druid', 'Druid', 33, 30, 28, 28, 32, 0, 0.95, '244024', ['GH', 0.72, 1.7, '786044'], { agg: 1, at: 'mg', rng: 5, bolt: 5951594, stay: 1 }],
  ['shade', 'Shade', 40, 38, 45, 30, 26, 0, 0.95, '161618', ['GH', 0.7, 1.7, '262628'], { agg: 1, mspd: 0.9 }],
  ['zamorakmonk', 'Monk of Zamorak', 17, 10, 8, 8, 12, 0, 0.95, '361012', ['GH', 0.72, 1.7, '745642'], { agg: 1, at: 'mg', rng: 5, bolt: 13654618, max: 5, stay: 1 }],
  ['spectre', 'Spectre', 96, 90, 1, 1, 90, 0, 1, '404852', ['GH', 0.74, 1.8, '566468'], { agg: 1, at: 'mg', rng: 5, bolt: 10145898, max: 8, mspd: 0.9, stay: 1 }],
  ['revenant', 'Revenant', 90, 80, 76, 80, 80, 38, 1.05, '284230', ['GH', 0.78, 1.9, '425842'], { agg: 1, at: 'mrg', rng: 6, bolt: 9097306, arrow: 12648384, sbon: 40, spd: 5, mspd: 1.1 }],
  // the hellhound rung leads the family
  ['skelwarrior', 'Skeleton warrior', 45, 59, 32, 35, 36, 15, 1, '828072', ['SKEL', 0.9, 2.1], { agg: 1, db: 5, sbon: 14 }],
  // the armed lv-45 Skeleton's block
  ['giantskeleton', 'Giant skeleton', 84, 202, 60, 63, 55, 0, 1.7, '706858', ['SKEL', 1.4, 3.2], { agg: 1, db: 5, mspd: 0.7, big: 1 }],
  // TODO: verify — no standard OSRS stat block sourced for this one
  // beasts of field and fell
  // sheep, camels and pigs cannot be fought in OSRS; their rows here are game furniture at flavour levels
  ['duck', 'Duck', 1, 3, 1, 1, 1, -47, 0.5, '929086', ['Q', 0.28, 0.4, 0.4, { head: '284226', leg: '866218', tail: '959390' }], { sbon: -42, flee: 1 }],
  ['sheep', 'Sheep', 1, 2, 1, 1, 1, 0, 1, '908985', ['Q', 0.8, 1, 1.4, { head: '262422', leg: '262422' }], { spd: 7, flee: 1 }],
  ['camel', 'Camel', 1, 2, 1, 1, 1, 0, 1.3, '786440', ['Q', 1, 1.7, 1.7, { head: '725836', leg: '665434', tail: '705634', snout: 1 }], { spd: 7, flee: 1 }],
  ['ram', 'Ram', 2, 8, 1, 1, 1, -15, 1.05, '868478', ['Q', 0.85, 1.05, 1.45, { head: '323026', leg: '323026', horns: 1 }], { sbon: -15 }],
  ['goat', 'Goat', 23, 21, 20, 20, 20, 10, 0.95, '625850', ['Q', 0.7, 0.95, 1.2, { head: '504640', leg: '444034', horns: 1, snout: 1 }], { sbon: 29, mspd: 1.1 }],
  ['pig', 'Pig', 8, 16, 6, 6, 5, 3, 1, '866664', ['Q', 0.9, 1, 1.4, { head: '887068', leg: '705250', tail: '887068', snout: 1 }], { spd: 6, flee: 1 }],
  ['jackal', 'Jackal', 21, 27, 17, 18, 15, 0, 0.85, '625032', ['Q', 0.6, 0.85, 1.3, { head: '544327', leg: '483824', tail: '584630', snout: 1 }], { agg: 1, mspd: 1.5 }],
  ['unicorn', 'Unicorn', 15, 19, 11, 13, 13, 0, 1.2, '949392', ['Q', 0.8, 1.5, 1.6, { head: '969594', leg: '908988', tail: '868490', horns: 1 }], { mspd: 1.2 }],
  ['wilddog', 'Wild dog', 63, 62, 53, 54, 54, 0, 0.85, '443628', ['Q', 0.6, 0.9, 1.3, { head: '383124', leg: '342822', tail: '403326', snout: 1 }], { agg: 1, mspd: 1.5 }],
  ['boar', 'Boar', 5, 8, 5, 4, 3, 0, 1.1, '322622', ['Q', 1, 1.15, 1.5, { head: '282319', leg: '242016', snout: 1, horns: 1 }], { agg: 1, mspd: 1.2, meat: 'raw_beef' }],
  // beef stands in for its 2007 boar meat
  ['whitewolf', 'White wolf', 25, 34, 20, 16, 22, 0, 1, '848688', ['Q', 0.72, 1.05, 1.55, { head: '767882', leg: '707276', tail: '889092', snout: 1 }], { agg: 1, mspd: 1.5 }],
  ['grizzly', 'Grizzly bear', 21, 27, 17, 18, 15, 0, 1.3, '362415', ['Q', 1.15, 1.5, 1.95, { head: '422918', leg: '281912', snout: 1 }], { agg: 1, mspd: 1.1 }],
  ['bigwolf', 'Big wolf', 73, 74, 60, 61, 62, 0, 1.25, '282832', ['Q', 0.95, 1.35, 2, { head: '222226', leg: '202024', tail: '323236', snout: 1 }], { agg: 1, mspd: 1.5 }],
  // the many-legged
  ['smallspider', 'Spider', 1, 2, 1, 1, 1, -35, 0.55, '201618', ['SP', 0.5, 0.5, '301212', '141112'], { sbon: -58 }],
  ['smallscorpion', 'Scorpion', 14, 17, 11, 12, 11, 0, 0.75, '463216', ['SP', 0.7, 0.6, '564020', '382613'], { agg: 1 }],
  ['kalphiteworker', 'Kalphite worker', 28, 40, 20, 20, 20, 0, 1, '726230', ['SP', 1, 0.9, '807036', '605024'], { agg: 1, db: 5, mspd: 1.1 }],
  ['redspider', 'Deadly red spider', 34, 35, 30, 25, 30, 0, 0.9, '521010', ['SP', 0.85, 0.75, '661412', '340808'], { agg: 1, mspd: 1.2 }],
  ['shadowspider', 'Shadow spider', 52, 55, 44, 42, 44, 0, 1.05, '121116', ['SP', 1, 0.85, '181624', '090812'], { agg: 1, mspd: 1.2 }],
  ['poisonspider', 'Poison spider', 64, 64, 50, 58, 52, 0, 0.95, '224218', ['SP', 0.9, 0.8, '305422', '163013'], { agg: 1, mspd: 1.1 }],
  ['kalphitesoldier', 'Kalphite soldier', 85, 90, 70, 70, 70, 0, 1.7, '625022', ['SP', 1.6, 1.5, '705826', '504018'], { agg: 1, db: 25, big: 1 }],
  // dragonkind
  ['babygreendragon', 'Baby green dragon', 48, 50, 40, 40, 40, 0, 1.3, '244022', ['DR', 0.9, 1.5, '304826', '183217'], { agg: 1, db: 50, mspd: 0.9 }],
  ['babybluedragon', 'Baby blue dragon', 48, 50, 40, 40, 40, 0, 1.3, '203252', ['DR', 0.9, 1.5, '264060', '152440'], { agg: 1, db: 50, mspd: 0.9 }],
  ['bluedragon', 'Blue dragon', 111, 105, 95, 95, 95, 0, 2.6, '183054', ['DR', 1.6, 2.6, '243862', '132242'], { agg: 1, fire: 1, at: 'mg', rng: 6, bolt: 4882384, db: 70, mspd: 0.7, big: 1 }],
  ['bronzedragon', 'Bronze dragon', 131, 122, 112, 112, 112, 0, 2.7, '523618', ['DR', 1.8, 2.9, '604322', '382613'], { agg: 1, fire: 1, at: 'mg', rng: 6, bolt: 13668426, db: 70, mspd: 0.7, big: 1 }],
  ['reddragon', 'Red dragon', 152, 140, 130, 130, 130, 0, 2.7, '521412', ['DR', 1.7, 2.8, '621915', '381009'], { agg: 1, fire: 1, at: 'mg', rng: 6, bolt: 13650474, db: 70, mspd: 0.7, big: 1 }],
  ['irondragon', 'Iron dragon', 189, 165, 165, 165, 165, 0, 2.9, '343538', ['DR', 1.9, 3, '424346', '262729'], { agg: 1, fire: 1, at: 'mg', rng: 7, bolt: 10134704, db: 70, mspd: 0.6, big: 1 }],
  ['steeldragon', 'Steel dragon', 246, 210, 215, 215, 215, 0, 3.1, '666974', ['DR', 2, 3.2, '747782', '505358'], { agg: 1, fire: 1, at: 'mg', rng: 7, bolt: 14213354, db: 70, mspd: 0.6, big: 1 }],
  ['mithrildragon', 'Mithril dragon', 304, 254, 268, 268, 268, 0, 3.2, '363972', ['DR', 2.1, 3.3, '444780', '283058'], { agg: 1, fire: 1, at: 'mrg', rng: 7, bolt: 9081576, arrow: 10133759, db: 100, mspd: 0.6, big: 1 }],
  ['adamantdragon', 'Adamant dragon', 338, 295, 280, 280, 272, 0, 3.3, '314932', ['DR', 2.2, 3.4, '385840', '223824'], { agg: 1, fire: 1, at: 'mrg', rng: 7, bolt: 7319664, arrow: 9097354, db: 110, mspd: 0.6, big: 1 }],
  ['runedragon', 'Rune dragon', 380, 330, 284, 284, 276, 0, 3.4, '237177', ['DR', 2.3, 3.5, '308086', '165560'], { agg: 1, fire: 1, at: 'mrg', rng: 7, bolt: 3847876, arrow: 8052970, db: 115, mspd: 0.6, big: 1 }],
];

/* SPELLS_R rows: [k, lv, xp, max, tint, need [rune-sans-_rune, n]..., drain?, hold?, undead?, bk?, fx?].
   Display name derives from k (underscores to spaces, words capitalised); decoder restores the _rune suffix.
   bk is the spellbook: 0 standard (default), 1 ancient. fx carries the ancient element's rider — see the block below. */
const SPELLS_R = [
  ['wind_strike', 1, 5.5, 2, 0xd8e4ee, [['air', 1], ['mind', 1]]],
  ['water_strike', 5, 7.5, 4, 0x4f8fd0, [['water', 1], ['air', 1], ['mind', 1]]],
  ['earth_strike', 9, 9.5, 6, 0x8a6a3a, [['earth', 2], ['air', 1], ['mind', 1]]],
  ['fire_strike', 13, 11.5, 8, 0xd05a2a, [['fire', 3], ['air', 2], ['mind', 1]]],
  ['wind_bolt', 17, 13.5, 9, 0xd8e4ee, [['air', 2], ['chaos', 1]]],
  ['water_bolt', 23, 16.5, 10, 0x4f8fd0, [['water', 2], ['air', 2], ['chaos', 1]]],
  ['earth_bolt', 29, 19.5, 11, 0x8a6a3a, [['earth', 3], ['air', 2], ['chaos', 1]]],
  ['fire_bolt', 35, 22.5, 12, 0xd05a2a, [['fire', 4], ['air', 3], ['chaos', 1]]],
  ['wind_blast', 41, 25.5, 13, 0xd8e4ee, [['air', 3], ['death', 1]]],
  ['water_blast', 47, 28.5, 14, 0x4f8fd0, [['water', 3], ['air', 3], ['death', 1]]],
  ['earth_blast', 53, 31.5, 15, 0x8a6a3a, [['earth', 4], ['air', 3], ['death', 1]]],
  ['fire_blast', 59, 34.5, 16, 0xd05a2a, [['fire', 5], ['air', 4], ['death', 1]]],
  ['wind_wave', 62, 36, 17, 0xd8e4ee, [['air', 5], ['blood', 1]]],
  ['water_wave', 65, 37.5, 18, 0x4f8fd0, [['water', 7], ['air', 5], ['blood', 1]]],
  ['earth_wave', 70, 40, 19, 0x8a6a3a, [['earth', 7], ['air', 5], ['blood', 1]]],
  ['fire_wave', 75, 42.5, 20, 0xd05a2a, [['fire', 7], ['air', 5], ['blood', 1]]],
  ['confuse', 3, 13, 0, 0x9a7ad0, [['body', 1], ['earth', 2], ['water', 3]], "atk"],
  ['weaken', 11, 21, 0, 0x9a7ad0, [['body', 1], ['earth', 2], ['water', 3]], "str"],
  ['curse', 19, 29, 0, 0x9a7ad0, [['body', 1], ['earth', 3], ['water', 2]], "def"],
  ['crumble_undead', 39, 24.5, 15, 0xd8cfa0, [['earth', 2], ['air', 2], ['chaos', 1]], null, 0, 1],
  ['bind', 20, 30, 0, 0x3aa04a, [['nature', 2], ['earth', 3], ['water', 3]], "hold", 8],
  ['snare', 50, 60, 0, 0x2a8a3a, [['nature', 3], ['earth', 4], ['water', 4]], "hold", 16],
  ['entangle', 79, 89, 0, 0x1e7a2e, [['nature', 4], ['earth', 5], ['water', 5]], "hold", 24],
  ['wind_surge', 81, 44.5, 21, 0xcfd8e0, [['air', 7], ['wrath', 1]]], ['water_surge', 85, 46.5, 22, 0x4f8fd0, [['water', 10], ['air', 7], ['wrath', 1]]],
  ['earth_surge', 90, 48.5, 23, 0x8a6a3a, [['earth', 10], ['air', 7], ['wrath', 1]]], ['fire_surge', 95, 50.5, 24, 0xd05a2a, [['fire', 10], ['air', 7], ['wrath', 1]]],
/* ANCIENT MAGICKS (bk 1), wiki-exact. Four elements x four tiers: Rush single, Burst 3x3, Blitz single, Barrage 3x3.
   Every ancient cast is speed 5, the same as the standard book. The element rides in fx, and unlike a curse these deal
   damage AND apply their effect, so `drain` stays null and the damage branch reads fx:
     psn  poison severity applied on a 1/8 hit (10 = 15 total damage, 20 = 50)
     atk  fraction of the target's Attack drained, once — it does not stack down to nothing
     lch  fraction of damage dealt returned to the caster as hitpoints
     frz  freeze in ticks (8 / 16 / 24 / 32), then 5 ticks of immunity before it can be frozen again
     aoe  radius in tiles: 1 is the wiki's 3x3 around the primary target, rolled separately per victim */
  ['smoke_rush', 50, 30, 13, 0x8a8f98, [['death', 2], ['chaos', 2], ['air', 1], ['fire', 1]], null, 0, 0, 1, { psn: 10 }],
  ['shadow_rush', 52, 31, 14, 0x5a4a7a, [['death', 2], ['chaos', 2], ['air', 1], ['soul', 1]], null, 0, 0, 1, { atk: 0.10 }],
  ['blood_rush', 56, 33, 15, 0x8a1a24, [['death', 2], ['chaos', 2], ['blood', 1]], null, 0, 0, 1, { lch: 0.25 }],
  ['ice_rush', 58, 34, 16, 0x9fd8ee, [['death', 2], ['chaos', 2], ['water', 2]], null, 0, 0, 1, { frz: 8 }],
  ['smoke_burst', 62, 36, 17, 0x8a8f98, [['death', 2], ['chaos', 4], ['air', 2], ['fire', 2]], null, 0, 0, 1, { psn: 10, aoe: 1 }],
  ['shadow_burst', 64, 37, 18, 0x5a4a7a, [['death', 2], ['chaos', 4], ['air', 1], ['soul', 2]], null, 0, 0, 1, { atk: 0.10, aoe: 1 }],
  ['blood_burst', 68, 39, 21, 0x8a1a24, [['death', 2], ['chaos', 4], ['blood', 2]], null, 0, 0, 1, { lch: 0.25, aoe: 1 }],
  ['ice_burst', 70, 40, 22, 0x9fd8ee, [['death', 2], ['chaos', 4], ['water', 4]], null, 0, 0, 1, { frz: 16, aoe: 1 }],
  ['smoke_blitz', 74, 42, 23, 0x8a8f98, [['death', 2], ['blood', 2], ['air', 2], ['fire', 2]], null, 0, 0, 1, { psn: 20 }],
  ['shadow_blitz', 76, 43, 24, 0x5a4a7a, [['death', 2], ['blood', 2], ['air', 2], ['soul', 2]], null, 0, 0, 1, { atk: 0.15 }],
  ['blood_blitz', 80, 45, 25, 0x8a1a24, [['death', 2], ['blood', 4]], null, 0, 0, 1, { lch: 0.25 }],
  ['ice_blitz', 82, 46, 26, 0x9fd8ee, [['death', 2], ['blood', 2], ['water', 3]], null, 0, 0, 1, { frz: 24 }],
  ['smoke_barrage', 86, 48, 27, 0x8a8f98, [['death', 4], ['blood', 2], ['air', 4], ['fire', 4]], null, 0, 0, 1, { psn: 20, aoe: 1 }],
  ['shadow_barrage', 88, 49, 28, 0x5a4a7a, [['death', 4], ['blood', 2], ['air', 4], ['soul', 3]], null, 0, 0, 1, { atk: 0.15, aoe: 1 }],
  ['blood_barrage', 92, 51, 29, 0x8a1a24, [['death', 4], ['blood', 4], ['soul', 1]], null, 0, 0, 1, { lch: 0.25, aoe: 1 }],
  ['ice_barrage', 94, 52, 30, 0x9fd8ee, [['death', 4], ['blood', 2], ['water', 6]], null, 0, 0, 1, { frz: 32, aoe: 1 }]
];

const PRAYERS_R = [
  ['thick_skin', 'Thick Skin', 1, 0.0167, { def: 1.05 }, 'shield'], ['burst_str', 'Burst of Str', 4, 0.0167, { str: 1.05 }, 'fist'], ['clarity', 'Clarity', 7, 0.0167, { atk: 1.05 }, 'sword'],
  ['rock_skin', 'Rock Skin', 10, 0.1, { def: 1.10 }, 'shield'], ['superhuman', 'Superhuman', 13, 0.1, { str: 1.10 }, 'fist'], ['improved_refl', 'Improved Refl.', 16, 0.1, { atk: 1.10 }, 'sword'],
  ['steel_skin', 'Steel Skin', 28, 0.2, { def: 1.15 }, 'shield'], ['ultimate_str', 'Ultimate Str', 31, 0.2, { str: 1.15 }, 'fist'],
  // appended, never inserted: the bit is the row's index in the save. The effect object: atk/str/def/rng/mag multiply; prot names the monster style turned
  // aside (0 on the other overheads, so they share its slot); heal, restore, preserve, item, retri, redeem and smite are flags; a seventh column is a Defence requirement
  ['rapid_heal', 'Rapid Heal', 22, 0.0333, { heal: 1 }, 'heart'], ['prot_magic', 'Protect Magic', 37, 0.2, { prot: 'g' }, 'rune'], ['prot_missiles', 'Protect Missiles', 40, 0.2, { prot: 'r' }, 'arrow'],
  ['prot_melee', 'Protect Melee', 43, 0.2, { prot: 'm' }, 'sword'], ['eagle_eye', 'Eagle Eye', 44, 0.2, { rng: 1.15, rngs: 1.15 }, 'bow'], ['mystic_might', 'Mystic Might', 45, 0.2, { mag: 1.15, mdmg: 2 }, 'staff'],
  ['sharp_eye', 'Sharp Eye', 8, 0.0167, { rng: 1.05, rngs: 1.05 }, 'arrow'], ['mystic_will', 'Mystic Will', 9, 0.0167, { mag: 1.05 }, 'rune'], ['rapid_restore', 'Rapid Restore', 19, 0.0167, { restore: 1 }, 'leaf'],
  ['prot_item', 'Protect Item', 25, 0.0333, { item: 1 }, 'ring'], ['hawk_eye', 'Hawk Eye', 26, 0.1, { rng: 1.10, rngs: 1.10 }, 'arrow'], ['mystic_lore', 'Mystic Lore', 27, 0.1, { mag: 1.10, mdmg: 1 }, 'rune'],
  ['incredible_refl', 'Incredible Refl.', 34, 0.2, { atk: 1.15 }, 'sword'], ['retribution', 'Retribution', 46, 0.05, { retri: 1, prot: 0 }, 'skull'], ['redemption', 'Redemption', 49, 0.1, { redeem: 1, prot: 0 }, 'heart'],
  ['preserve', 'Preserve', 55, 0.0333, { preserve: 1 }, 'vial'], ['chivalry', 'Chivalry', 60, 0.2, { def: 1.20, str: 1.18, atk: 1.15 }, 'fhelm', 65],
  ['piety', 'Piety', 70, 0.4, { def: 1.25, str: 1.23, atk: 1.20 }, 'star', 70], ['rigour', 'Rigour', 74, 0.4, { rng: 1.20, rngs: 1.23, def: 1.25 }, 'bow', 70], ['augury', 'Augury', 77, 0.4, { mag: 1.25, def: 1.25, mdmg: 4 }, 'staff', 70],
  ['smite', 'Smite', 52, 0.3, { smite: 1, prot: 0 }, 'star']
];

const BOSSES = [
  ['elvarg', 'Elvarg', 'greendragon', 83, 80, 70, 70, 70, 0, 0, 0, null, 70, 'mg', 6, 4, 0.8, 1.7, 0xa8e090, 0x6fd04a, null],
  ['obor', 'Obor', 'hillgiant', 106, 120, 90, 100, 60, 40, 100, 68, null, null, 'mr', 5, 6, 0.8, 1.6, 0xb09070, null, 0x8a6a4a],
  ['slashbash', 'Slash Bash', 'ogre', 111, 100, 100, 120, 60, 0, 22, 0, null, null, 'mr', 5, 6, 0.8, 1.6, 0xa0a888, null, 0x8a8a6a],
  ['bktitan', 'Black Knight Titan', 'blackknight', 120, 142, 91, 100, 91, 0, 27, 22, null, null, 'm', 5, 7, 0.9, 2.0, null, 0x8a2f27, null],
  ['trollking', 'Ice Troll King', 'icetroll', 122, 150, 100, 100, 80, 0, 60, 60, null, null, 'mrg', 5, 4, 0.8, 1.6, null, 0x80e0ff, 0xc0e0ff],
  ['bryophyta', 'Bryophyta', 'mossgiant', 128, 115, 130, 100, 100, 0, 33, 31, null, null, 'mg', 5, 6, 0.8, 1.6, 0x8ac070, 0x5ad06a, null],
  ['evilchicken', 'Evil Chicken', 'chicken', 159, 120, 200, 1, 126, 0, 0, 0, 21, null, 'g', 6, 4, 1.4, 4.5, 0x3a3438, 0xffe14a, null],   // atk is its magic level; it only ever casts
  ['scurrius', 'Scurrius', 'rat', 166, 500, 300, 100, 60, 20, 150, 10, null, null, 'mrg', 5, 4, 1.2, 3.2, 0x8a9a8a, 0x8a8aff, 0x9a9a6a],
  ['scorpia', 'Scorpia', 'scorpion', 225, 200, 250, 150, 180, 284, 60, 0, null, null, 'm', 5, 4, 1.1, 2.4, 0xa89a48, null, 0x80c040],
  ['eldric', 'Eldric the Ice King', 'icegiant', 250, 600, 300, 250, 100, 12, 150, 0, null, null, 'mg', 6, 7, 0.8, 1.6, null, 0x80e0ff, null],
  ['branda', 'Branda the Fire Queen', 'firegiant', 250, 600, 300, 250, 100, 12, 150, 0, null, null, 'mg', 6, 7, 0.8, 1.6, null, 0xff7030, null],
  ['kbd', 'King Black Dragon', 'blackdragon', 276, 240, 240, 240, 240, 90, 0, 0, null, 65, 'mg', 7, 4, 0.8, 1.8, null, 0xd04a2a, null],
  ['sarachnis', 'Sarachnis', 'redspider', 318, 400, 200, 240, 150, 40, 30, 0, 31, null, 'mr', 6, 4, 1.3, 4.2, 0xd08888, null, 0xe0e0a0],
  ['skotizo', 'Skotizo', 'blackdemon', 321, 450, 240, 250, 200, 80, 160, 31, null, null, 'mg', 6, 4, 0.9, 1.8, 0xd07070, 0xc040ff, null],
  ['kalphitequeen', 'Kalphite Queen', 'kalphitesoldier', 333, 255, 300, 300, 300, 50, 0, 0, null, null, 'mrg', 6, 4, 0.9, 2.0, 0xb8a868, 0x60d0c0, 0xd0b060],
  ['vorkath', 'Vorkath', 'bluedragon', 392, 750, 560, 308, 214, 108, 16, 0, null, 80, 'mrg', 7, 5, 0.8, 2.0, 0xa8c0d0, 0x4ad0ff, 0xc0e0ff],
  ['vetion', "Vet'ion", 'giantskeleton', 454, 255, 430, 430, 395, 200, 0, 0, null, null, 'mg', 6, 6, 0.9, 2.0, 0xb090e0, 0xc060ff, null],
  ['venenatis', 'Venenatis', 'shadowspider', 464, 850, 300, 200, 321, 100, 0, 0, 35, null, 'mrg', 6, 4, 1.2, 2.6, 0xa070b0, 0x40e080, 0x8ae08a],
  ['callisto', 'Callisto', 'grizzly', 470, 1000, 350, 300, 225, 130, 0, 0, 55, null, 'mrg', 6, 4, 1.1, 2.4, 0xa08060, 0x9ad0ff, 0xc0b090],
  ['galvek', 'Galvek', 'steeldragon', 608, 1200, 632, 268, 188, 0, 34, 0, null, 121, 'mrg', 7, 6, 0.8, 2.0, 0xd8b890, 0xff9040, 0xffd080],
  ['graardor', 'General Graardor', 'ogrechief', 624, 255, 280, 350, 250, 90, 120, 43, null, null, 'mr', 6, 6, 1.0, 1.9, 0x909880, null, 0x8a8a6a],
  ['kril', "K'ril Tsutsaroth", 'greaterdemon', 650, 255, 340, 300, 270, 80, 160, 31, null, null, 'mg', 6, 6, 1.0, 1.9, 0xe05050, 0xff2a2a, null]
];

const SHOP_KINDS = [
  { k: 'general', n: 'General Store', g: 'coins', c: '#c9a24a', base: ['tinderbox', 'hammer', 'small_net', 'fishing_rod', 'bronze_hatchet', 'bronze_pickaxe',
    'logs', 'oak_logs', 'bronze_bar', 'copper_ore', 'tin_ore', 'shrimps', 'spade', 'staff', 'wizard_hat', 'wizard_robe_top', 'wizard_robe_bottom', 'shortbow', 'leather_body'] },
  { k: 'smith', n: 'Smithing Supply', g: 'hammer', c: '#8a5a3a', tools: 1 },
  { k: 'weapon', n: 'Sword Shop', g: 'scim', c: '#9b2f24', weapons: 1 },
  { k: 'armour', n: 'Armour Shop', g: 'body', c: '#3b5ea8', armour: 1 },
  { k: 'food', n: 'Fishing Shop', g: 'cfish', c: '#4f8fa8', base: ['small_net', 'fishing_rod', 'harpoon', 'shrimps', 'trout'] },
  { k: 'magic', n: 'Magic Guild', g: 'staff', c: '#6a5ab0', mage: 1 },
  { k: 'archery', n: 'Archery Shop', g: 'bow', c: '#5f7a3a', range: 1 },
  { k: 'craft', n: 'Crafting Shop', g: 'ring', c: '#b08a4a', base: ['needle', 'thread', 'chisel', 'knife', 'shears', 'ring_mould', 'necklace_mould', 'amulet_mould', 'tiara_mould',
    'bow_string', 'ball_of_wool', 'flax', 'vial_of_water', 'eye_of_newt', 'snape_grass', 'white_berries', 'limpwurt_root', 'dragon_scale_dust', 'bird_snare', 'box_trap'] },
  { k: 'pub', n: 'Tavern', g: 'mug', c: '#c9812a', base: ['beer', 'wine', 'bread', 'stew', 'cooked_meat'] }   // appended: shop indexes ride the town plans
];

/* BTERT: boss tertiary drops, fed to bossTert() in index.html — [bossKey, [item, 1/w]...].
   Comments name the wiki owner each stand-in covers (game-economy additions). */
const BTERT = [
  ['vetion', ['barrows', 12]],
  ['scurrius', ['barrows', 30]],   // the crypt keepers deal the brothers' war-gear (the 2007 chest paid ~1/17)
  ['graardor', ['bandos_chestplate', 381], ['bandos_tassets', 381], ['bandos_boots', 381], ['bandos_godsword', 508], ['raid', 250]],
  ['kril', ['zamorakian_spear', 128], ['staff_of_the_dead', 508], ['zamorak_godsword', 508], ['raid', 250]],
  ['galvek', ['armadyl_helmet', 381], ['armadyl_chestplate', 381], ['armadyl_chainskirt', 381], ['armadyl_godsword', 508], ['armadyl_crossbow', 508], ['raid', 250]],   // the sky dragon stands in for Kree'arra
  ['hero', ['saradomin_godsword', 1024]],   // the god's own paragon carries his blade
  ['venenatis', ['toxic_blowpipe', 512], ['toxic_staff_of_the_dead', 512], ['abyssal_tentacle', 400]],   // the venom queen stands in for Zulrah, and her arms for the kraken's
  ['eldric', ['trident_of_the_seas', 512], ['mages_book', 350], ['infinity_top', 350], ['infinity_boots', 500]],   // the sea-ice king keeps the kraken's fork and the scholar's shelf
  ['branda', ['toktz_xil_ak', 128], ['tzhaar_ket_om', 128], ['fire_cape', 128], ['infinity_bottoms', 350], ['infinity_hat', 500]],   // the fire queen holds the volcano's arsenal
  ['skotizo', ['primordial_boots', 128], ['pegasian_boots', 128], ['eternal_boots', 128], ['master_wand', 350]],   // the dark warden stands in for Cerberus (crystals 1/128 each)
  ['jungledemon', ['amulet_of_torture', 512], ['necklace_of_anguish', 512], ['soul_talisman', 128]],   // the jungle demon stands in for the demonic gorillas; the soul altar answers to him
  ['spectre', ['occult_necklace', 512], ['black_mask', 512]],   // the smoke devil's own 1/512, on its misty kin; the mask keeps the cave horror's 1/512 (no horrors here, and the spectre is the slayer-gated kin)
  ['blackdemon', ['abyssal_dagger', 512], ['abyssal_bludgeon', 750]],   // the abyssal kin keep the sire's arms (unsired odds ~1/492)
  ['revenant', ['ancient_staff', 512]],   // the restless dead keep the old magicks
  ['obor', ['berserker_ring', 128]],
  ['bktitan', ['warrior_ring', 128]],
  ['slashbash', ['archers_ring', 128]],
  ['bryophyta', ['seers_ring', 128]],   // the four lesser bosses split the Dagannoth Kings' rings, each at the Kings' 1/128
  ['vorkath', ['avas_assembler', 50], ['raid', 300]],   // the assembler is the wiki's own 1/50 head, sewn straight on
  ['kalphitequeen', ['raid', 300]],
  ['paladin', ['saradomin_cape', 128], ['law_talisman', 64]],   // no mage arena here — the god capes fall from their faithful, the far altars' keys with them
  ['darkwizard', ['zamorak_cape', 128], ['teacher_wand', 128]],
  ['druid', ['guthix_cape', 128]],
  ['shade', ['death_talisman', 80]],
  ['greaterdemon', ['blood_talisman', 100]],
  ['blackknight', ['black_dart_tips', 32, 8, 16]],
];

const hAdd = (B, geo, x, y, z, dx, dz, sx, sy, sz, r, col) => { const [ax, az] = ro2(dx, dz, r); B.add(geo, x + ax, y, z + az, sx, sy, sz, r, col); };
/* furniture on screen: one small builder per shape, tinted by tier */
const FSHAPE = {
  chair(B, x, y, z, r, c) { B.add(BOX, x, y + 0.34, z, 0.62, 0.14, 0.62, r, c); hAdd(B, BOX, x, y + 0.62, z, 0, -0.26, 0.62, 0.7, 0.1, r, c); B.add(BOX, x, y + 0.14, z, 0.5, 0.28, 0.5, r, C_DARK); },
  bench(B, x, y, z, r, c) { B.add(BOX, x, y + 0.3, z, 1.7, 0.12, 0.5, r, c); B.add(BOX, x, y + 0.12, z, 1.5, 0.24, 0.34, r, C_DARK); },
  table(B, x, y, z, r, c) { B.add(BOX, x, y + 0.62, z, 1.3, 0.1, 0.9, r, c); for (const a of [-1, 1]) for (const b of [-1, 1]) { hAdd(B, BOX, x, y + 0.3, z, a * 0.5, b * 0.3, 0.14, 0.6, 0.14, r, c); } },
  bigtable(B, x, y, z, r, c) { B.add(BOX, x, y + 0.66, z, 2.6, 0.12, 1.2, r, c); for (const a of [-1, 1]) { hAdd(B, BOX, x, y + 0.3, z, a * 1.05, 0, 0.2, 0.6, 0.9, r, c); } },
  bookcase(B, x, y, z, r, c) { B.add(BOX, x, y + 0.85, z, 1.2, 1.7, 0.4, r, c); hAdd(B, BOX, x, y + 0.85, z, 0, 0.06, 1.0, 1.4, 0.34, r, C_CLOTH); },
  larder(B, x, y, z, r, c) { B.add(BOX, x, y + 0.8, z, 1.3, 1.6, 0.8, r, c); B.add(BOX, x, y + 1.66, z, 1.44, 0.12, 0.94, r, C_DARK); hAdd(B, BOX, x, y + 0.7, z, 0, 0.34, 0.1, 0.9, 0.14, r, C_DARK); },
  shelves(B, x, y, z, r, c) { B.add(BOX, x, y + 0.6, z, 1.1, 1.2, 0.45, r, c); hAdd(B, BOX, x, y + 1.0, z, 0, 0.1, 1.0, 0.1, 0.3, r, C_CLOTH); },
  stove(B, x, y, z, r, c) { B.add(BOX, x, y + 0.42, z, 1.2, 0.84, 0.8, r, HW.st); B.add(BOX, x, y + 0.9, z, 1.3, 0.1, 0.9, r, C_DARK); hAdd(B, CYL8, x, y + 1.5, z, 0, -0.2, 0.24, 1.2, 0.24, r, C_DARK); hAdd(B, BOX, x, y + 0.5, z, 0, 0.36, 0.5, 0.3, 0.1, r, [1, 0.55, 0.15]); if (c !== HW.st) B.add(BOX, x, y + 0.96, z, 0.9, 0.06, 0.6, r, c); },
  sink(B, x, y, z, r, c) { B.add(BOX, x, y + 0.4, z, 1.0, 0.8, 0.7, r, c); B.add(BOX, x, y + 0.84, z, 0.8, 0.1, 0.5, r, [0.55, 0.68, 0.75]); },
  barrel(B, x, y, z, r, c) { B.add(TRUNK, x, y + 0.4, z, 0.7, 0.8, 0.7, r, c); B.add(CYL8, x, y + 0.82, z, 0.6, 0.05, 0.6, r, C_DARK); },
  bed(B, x, y, z, r, c) { B.add(BOX, x, y + 0.25, z, 1.1, 0.5, 1.9, r, c); B.add(BOX, x, y + 0.56, z, 1.0, 0.14, 1.8, r, C_CLOTH); hAdd(B, BOX, x, y + 0.68, z, 0, -0.65, 0.7, 0.12, 0.4, r, [0.95, 0.93, 0.86]); hAdd(B, BOX, x, y + 0.6, z, 0, -0.95, 1.14, 0.8, 0.1, r, c); },
  wardrobe(B, x, y, z, r, c) { B.add(BOX, x, y + 0.95, z, 1.3, 1.9, 0.6, r, c); hAdd(B, BOX, x, y + 0.95, z, 0, 0.31, 0.06, 1.7, 0.04, r, C_DARK); },
  rug(B, x, y, z, r, c) { B.add(BOX, x, y + 0.03, z, 2.4, 0.05, 1.7, r, c); B.add(BOX, x, y + 0.055, z, 1.9, 0.05, 1.2, r, C_CLOTH); },
  fireplace(B, x, y, z, r, c) { for (const a of [-1, 1]) hAdd(B, BOX, x, y + 0.55, z, a * 0.55, 0, 0.3, 1.1, 0.55, r, c); hAdd(B, BOX, x, y + 1.2, z, 0, 0, 1.5, 0.22, 0.55, r, c); hAdd(B, BOX, x, y + 0.3, z, 0, 0.05, 0.8, 0.6, 0.3, r, C_DARK); hAdd(B, BOX, x, y + 0.18, z, 0, 0.1, 0.5, 0.16, 0.2, r, [1, 0.55, 0.15]); },
  decor(B, x, y, z, r, c) { B.add(BOX, x, y + 1.5, z, 0.9, 0.7, 0.12, r, c); B.add(BOX, x, y + 1.5, z, 0.6, 0.4, 0.16, r, C_CLOTH); },
  lectern(B, x, y, z, r, c) { B.add(BOX, x, y + 0.5, z, 0.3, 1.0, 0.3, r, c); B.add(BOX, x, y + 1.05, z, 0.8, 0.1, 0.6, r, c); hAdd(B, BOX, x, y + 1.14, z, 0, 0.05, 0.6, 0.06, 0.4, r, [0.95, 0.93, 0.86]); },
  globe(B, x, y, z, r, c) { B.add(TRUNK, x, y + 0.4, z, 0.24, 0.8, 0.24, r, HW.o); B.add(BLOB, x, y + 1.1, z, 0.7, 0.7, 0.7, r, c); },
  chart(B, x, y, z, r, c) { B.add(BOX, x, y + 1.6, z, 1.1, 0.9, 0.08, r, [0.9, 0.87, 0.78]); B.add(BOX, x, y + 1.6, z, 1.2, 1.0, 0.05, r, c); },
  altar(B, x, y, z, r, c) { B.add(BOX, x, y + 0.45, z, 1.6, 0.9, 0.9, r, c); B.add(BOX, x, y + 0.96, z, 1.8, 0.12, 1.1, r, c === HW.g ? HW.g : C_STONE2); hAdd(B, CYL8, x, y + 1.27, z, 0.5, 0, 0.06, 0.5, 0.06, r, [0.95, 0.9, 0.7]); hAdd(B, CONE8, x, y + 1.62, z, 0.5, 0, 0.1, 0.22, 0.1, r, [1, 0.8, 0.3]); },
  burner(B, x, y, z, r, c, lit) { B.add(CYL8, x, y + 0.5, z, 0.2, 1.0, 0.2, r, c); B.add(CONE8, x, y + 1.1, z, 0.5, -0.3, 0.5, r, c); if (lit) B.add(CONE8, x, y + 1.25, z, 0.24, 0.5, 0.24, r, [1, 0.62, 0.12]); },
  statue(B, x, y, z, r, c) { B.add(BOX, x, y + 0.25, z, 0.9, 0.5, 0.9, r, c); B.add(SPIRE, x, y + 1.3, z, 0.55, 1.6, 0.55, r, c); },
  organ(B, x, y, z, r, c) { B.add(BOX, x, y + 0.5, z, 1.4, 1.0, 0.7, r, c); for (let i = -1; i <= 1; i++) hAdd(B, CYL8, x, y + 1.4 + (i === 0 ? 0.3 : 0), z, i * 0.4, 0.1, 0.2, 1.0 + (i === 0 ? 0.6 : 0), 0.2, r, HW.st); },
  chimes(B, x, y, z, r, c) { for (const a of [-1, 1]) hAdd(B, BOX, x, y + 0.8, z, a * 0.5, 0, 0.1, 1.6, 0.1, r, c); B.add(BOX, x, y + 1.55, z, 1.2, 0.1, 0.1, r, c); for (let i = -1; i <= 1; i++) hAdd(B, CYL8, x, y + 1.1, z, i * 0.3, 0, 0.06, 0.7, 0.06, r, HW.st); },
  bench2(B, x, y, z, r, c) { B.add(BOX, x, y + 0.45, z, 2.0, 0.14, 1.0, r, c); hAdd(B, BOX, x, y + 1.0, z, 0.6, 0, 0.5, 0.2, 0.3, r, C_STONE2); for (const a of [-1, 1]) for (const b of [-1, 1]) hAdd(B, BOX, x, y + 0.2, z, a * 0.85, b * 0.38, 0.18, 0.4, 0.18, r, C_BEAM); },
  toolrack(B, x, y, z, r, c) { B.add(BOX, x, y + 0.8, z, 1.2, 1.6, 0.35, r, c); for (let i = -1; i <= 1; i++) hAdd(B, BOX, x, y + 1.0 + i * 0.25, z, i * 0.3, 0.16, 0.16, 0.4, 0.06, r, HW.st); },
  astand(B, x, y, z, r, c) { B.add(CYL8, x, y + 0.6, z, 0.16, 1.2, 0.16, r, c); B.add(BOX, x, y + 1.1, z, 0.7, 0.55, 0.4, r, HW.st); B.add(BLOB, x, y + 1.6, z, 0.4, 0.4, 0.4, r, HW.st); },
  wheel(B, x, y, z, r, c) { B.add(BOX, x, y + 0.3, z, 1.0, 0.6, 0.6, r, HW.o); B.add(CYL8, x, y + 0.75, z, 0.7, 0.16, 0.7, r, c); }
};

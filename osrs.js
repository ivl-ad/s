/* ---- OSRS 2007 MODELS -------------------------------------------------------------------------------------
   The 2007 client's own player kit — and its monsters and world objects — worn when "2007 models" is on in
   SETUP. assets/osrs/{player.json,models.bin} are prebuilt from the game cache (the `modl` project): one packed
   chunk per model, plus each item's wear slots, recolours, the parts it conceals, and `src` — the seedworld
   display name it was resolved by, so this file needs no name-matching rules of its own. The `npcs` section
   (tools/osrs-npcs.mjs) is keyed by this game's monster display name the same way: each name carries one or
   more variants {m, rc, ws, hs, amb, con}, and npcMesh() serves one as a plain unskinned mesh fitted to the
   height the caller measured off the box rig, so a 2007 monster stands exactly as tall as the one it replaces.
   The `locs` section (tools/osrs-locs.mjs) is scenery, keyed by display name again: each variant {m, rc, rt,
   s, o, amb, con, w, d, sp} is a loc def with the spent (chopped/mined) state riding along as sp. locMesh()
   serves one as a plain mesh at the cache's own tile scale (128 units = 1 tile), lit as the client lights
   scenery; locBatch() serves the same triangles as flat arrays for game.js's chunk batcher.

   The client composes a player by merging up to twelve models into one mesh and baking the light into the face
   colours; everything below is that pass, ported. What a still viewer never needed is the skeleton: every vertex
   in the cache carries the client's own bone label, so the merged mesh is skinned to five joints — body, two
   arms, two legs — laid out like buildAvatar's boxes. That is the point of doing it this way: section 34's
   poses drive this rig with no changes at all.

   Nothing here runs until the setting is switched on; load() is the only entry that touches the network. ---- */
const OSRSK = (() => {
'use strict';

/* JagexColor's brightness exponent. The client offers 0.6-0.9 and the wiki's equipped renders use 0.6, which is
   also the only value at which every sampled wiki pixel resolves to an exact palette entry. */
const BRIGHT = 0.6;
/* cache units -> tiles. A naked player is 196 units tall and the box rig is 1.90, so the toggle changes how the
   character looks without changing its size against the world or anything standing next to it. */
const S = 1 / 103;

/* ---- packed HSL -> RGB (net.runelite.cache.models.JagexColor) ---- */
const HUE_OFF = 0.5 / 64, SAT_OFF = 0.5 / 8;
function adjustRGB(rgb, b) {
  return (Math.trunc(Math.pow((rgb >> 16 & 255) / 256, b) * 256) << 16)
    | (Math.trunc(Math.pow((rgb >> 8 & 255) / 256, b) * 256) << 8)
    | Math.trunc(Math.pow((rgb & 255) / 256, b) * 256);
}
function buildPalette(b) {
  const pal = new Int32Array(65536);
  for (let i = 0; i < 65536; i++) {
    const hue = (i >> 10 & 63) / 64 + HUE_OFF, sat = (i >> 7 & 7) / 8 + SAT_OFF, lum = (i & 127) / 128;
    const c = (1 - Math.abs(2 * lum - 1)) * sat, x = c * (1 - Math.abs((hue * 6) % 2 - 1)), m = lum - c / 2;
    let r = m, g = m, bl = m;
    switch (Math.trunc(hue * 6)) {
      case 0: r += c; g += x; break; case 1: g += c; r += x; break; case 2: g += c; bl += x; break;
      case 3: bl += c; g += x; break; case 4: bl += c; r += x; break; default: r += c; bl += x;
    }
    const v = adjustRGB((Math.trunc(r * 256) << 16) | (Math.trunc(g * 256) << 8) | Math.trunc(bl * 256), b);
    pal[i] = v === 0 ? 1 : v;
  }
  return pal;
}

/* ---- model chunks: views into models.bin, never copies (layout in tools/lib/pack.mjs of the modl project) ---- */
const F_TEX = 8, F_TYPES = 1, F_ALPHA = 2, F_PRIOS = 4, F_TCOORD = 16, F_VGROUP = 32;
function readModel(buf, at) {
  const dv = new DataView(buf, at);
  const vc = dv.getUint16(0, true), fc = dv.getUint16(2, true), ttc = dv.getUint16(4, true), fl = dv.getUint8(6);
  let o = at + 8;
  const verts = new Int16Array(buf, o, vc * 3); o += vc * 6;
  const indices = new Uint16Array(buf, o, fc * 3); o += fc * 6;
  const colors = new Uint16Array(buf, o, fc); o += fc * 2;
  let textures = null;
  if (fl & F_TEX) { textures = new Uint16Array(buf, o, fc); o += fc * 2; }
  o += ttc * 6;                                                    /* texture triangles: v1 paints averages, not maps */
  let types = null, alphas = null;
  if (fl & F_TYPES) { types = new Int8Array(buf, o, fc); o += fc; }
  if (fl & F_ALPHA) { alphas = new Int8Array(buf, o, fc); o += fc; }
  if (fl & F_PRIOS) o += fc;                                       /* draw order; the depth buffer handles it here */
  if (fl & F_TCOORD) o += fc;
  o += ttc;                                                        /* texture triangle types */
  const vg = (fl & F_VGROUP) ? new Uint8Array(buf, o, vc) : null;
  return { vc, fc, verts, indices, colors, textures, types, alphas, vg };
}

/* ---- the skeleton ------------------------------------------------------------------------------------------
   The labels are the client's own, read off all 1304 models in the set: 1-3 head and jaw, 4-16 torso, waist and
   cape, 17-21 the -x arm, 22-26 the +x arm, 27/28 the hands, 29-30 + 39-42 the waist ring, 31-34 the -x leg,
   35-38 the +x leg, 43/44 the robed or armoured thigh, 45-48 the feet, 50-88 whatever the hand holds, 161 the
   shield arm. Everything unlisted stays on the body, which is where a vertex that never moves belongs. ---- */
const B_BODY = 0, B_ARML = 1, B_ARMR = 2, B_LEGL = 3, B_LEGR = 4;
const G2B = new Uint8Array(256);
const label = (b, gs) => { for (const g of gs) G2B[g] = b; };
label(B_ARMR, [17, 18, 19, 20, 21, 27, 60, 67, 92, 50, 51, 52, 53, 54, 55, 56, 61, 62, 63, 64, 65, 66, 70, 87, 88]);
label(B_ARML, [22, 23, 24, 25, 26, 28, 58, 59, 68, 91, 133, 161]);
label(B_LEGR, [31, 32, 33, 34, 44, 45, 48, 77, 80, 83, 166]);
label(B_LEGL, [35, 36, 37, 38, 43, 46, 47, 76, 78, 81, 82, 167]);
const isArm = b => b === B_ARML || b === B_ARMR;

/* Joints, in tiles, taken off the naked kit: the shoulder at the top of the upper arm, the hip at the waist
   ring, and the body's twist at the belt so a swing turns the chest and leaves the legs planted. */
const PB = 105 * S, PA = [19 * S, 159 * S], PL = [9 * S, 95 * S];

/* ---- appearance --------------------------------------------------------------------------------------------
   Slots 0..11: head cape amulet weapon torso shield arms legs hair hands feet jaw. An item writes itself into
   its own slot and blanks the body parts it covers — a full helm takes hair and jaw, a platebody the arms. ---- */
const EMPTY = 0, KIT = 256, ITEM = 512;
function appearance(body, ids) {
  const arr = new Array(12).fill(EMPTY), bod = D.bodies[body];
  for (const s in bod) arr[s] = KIT + bod[s];
  for (const id of ids) { const it = D.items[id]; if (it && it[body]) arr[it.slot] = ITEM + id; }
  for (const id of ids) {
    const it = D.items[id];
    if (it && it[body]) for (const s of it.hide) if (arr[s] < ITEM) arr[s] = EMPTY;
  }
  return arr;
}

/* One entry per model, recolours resolved and the vertical offset folded in, carrying the bone its arm-labelled
   vertices are pinned to. Whatever the hand holds goes on one arm however the cache labelled it: this rig swings
   its arms in opposition, so a two-hander split across both hands would stretch between them. */
function parts(arr, body) {
  const out = [];
  const push = (ids, off, rc, pin) => {
    for (const id of ids) { const m = models.get(id); if (m) out.push(makePart(m, off, rc, pin)); }
  };
  for (const e of arr) {
    if (e === EMPTY) continue;
    if (e < ITEM) { const k = D.kits[e - KIT]; if (k) push(k.m, 0, k.rc, 0); }
    else {
      const it = D.items[e - ITEM], b = it && it[body];
      if (b) push(b.m, b.off, it.rc, it.slot === 3 ? B_ARMR : it.slot === 5 ? B_ARML : 0);
    }
  }
  return out;
}
function makePart(m, off, rc, pin) {
  let verts = m.verts, colors = m.colors;
  if (off) { verts = Int16Array.from(m.verts); for (let i = 1; i < verts.length; i += 3) verts[i] += off; }
  if (rc && rc.length) {
    colors = Uint16Array.from(m.colors);
    for (let i = 0; i < colors.length; i++) for (const p of rc) if (colors[i] === p[0]) { colors[i] = p[1]; break; }
  }
  return { m, verts, colors, pin };
}

/* ---- merge (ModelData(ModelData[], int)) --------------------------------------------------------------------
   Concatenate the faces but fold vertices that land on the same coordinate, which is what lets the normals smooth
   across the seam between, say, the torso kit and the arms kit. The first vertex to claim a coordinate settles
   its bone too, exactly as the client keeps the first skin. ---- */
function merge(list) {
  let vcMax = 0, fc = 0, anyT = false, anyA = false, anyX = false;
  for (const p of list) {
    vcMax += p.m.vc; fc += p.m.fc;
    if (p.m.types) anyT = true;
    if (p.m.alphas) anyA = true;
    if (p.m.textures || p.tex) anyX = true;
  }
  const vx = new Int32Array(vcMax), vy = new Int32Array(vcMax), vz = new Int32Array(vcMax), vb = new Uint8Array(vcMax);
  const idx = new Int32Array(fc * 3), colors = new Uint16Array(fc);
  const types = anyT ? new Int8Array(fc) : null, alphas = anyA ? new Int8Array(fc) : null;
  const textures = anyX ? new Uint16Array(fc) : null;
  const seen = new Map();
  let vc = 0, f = 0;
  for (const p of list) {
    const m = p.m, pin = p.pin;
    const vertex = i => {
      const x = p.verts[i * 3], y = p.verts[i * 3 + 1], z = p.verts[i * 3 + 2];
      const key = (x + 32768) * 4294967296 + (y + 32768) * 65536 + (z + 32768);   /* an int16 triple, exact in one double */
      const hit = seen.get(key);
      if (hit !== undefined) return hit;
      let b = m.vg ? G2B[m.vg[i]] : B_BODY;
      if (pin && isArm(b)) b = pin;
      vx[vc] = x; vy[vc] = y; vz[vc] = z; vb[vc] = b;
      seen.set(key, vc);
      return vc++;
    };
    const mt = p.tex || m.textures;   /* a loc's retexture list swaps texture ids per part */
    for (let i = 0; i < m.fc; i++, f++) {
      if (types) types[f] = m.types ? m.types[i] : 0;
      if (alphas) alphas[f] = m.alphas ? m.alphas[i] : 0;
      if (textures) textures[f] = mt ? mt[i] : 0;
      colors[f] = p.colors[i];
      idx[f * 3] = vertex(m.indices[i * 3]);
      idx[f * 3 + 1] = vertex(m.indices[i * 3 + 1]);
      idx[f * 3 + 2] = vertex(m.indices[i * 3 + 2]);
    }
  }
  return { vc, fc, vx, vy, vz, vb, idx, colors, types, alphas, textures };
}

/* ---- lighting (ModelDefinition.computeNormals + toModel) ----------------------------------------------------
   Baked after the merge, never per part, or the folded seams at neck, shoulder and waist light up as edges. ---- */
function computeNormals(g) {
  const nx = new Int32Array(g.vc), ny = new Int32Array(g.vc), nz = new Int32Array(g.vc), mag = new Int32Array(g.vc);
  const faceN = new Int32Array(g.fc * 3);
  for (let f = 0; f < g.fc; f++) {
    const a = g.idx[f * 3], b = g.idx[f * 3 + 1], c = g.idx[f * 3 + 2];
    const ax = g.vx[b] - g.vx[a], ay = g.vy[b] - g.vy[a], az = g.vz[b] - g.vz[a];
    const bx = g.vx[c] - g.vx[a], by = g.vy[c] - g.vy[a], bz = g.vz[c] - g.vz[a];
    let cx = ay * bz - by * az, cy = az * bx - bz * ax, cz = ax * by - bx * ay;
    while (cx > 8192 || cy > 8192 || cz > 8192 || cx < -8192 || cy < -8192 || cz < -8192) { cx >>= 1; cy >>= 1; cz >>= 1; }
    let len = Math.trunc(Math.sqrt(cx * cx + cy * cy + cz * cz)); if (len <= 0) len = 1;
    cx = Math.trunc(cx * 256 / len); cy = Math.trunc(cy * 256 / len); cz = Math.trunc(cz * 256 / len);
    const type = g.types ? g.types[f] : 0;
    if (type === 0) {
      nx[a] += cx; ny[a] += cy; nz[a] += cz; mag[a]++;
      nx[b] += cx; ny[b] += cy; nz[b] += cz; mag[b]++;
      nx[c] += cx; ny[c] += cy; nz[c] += cz; mag[c]++;
    } else if (type === 1) { faceN[f * 3] = cx; faceN[f * 3 + 1] = cy; faceN[f * 3 + 2] = cz; }
  }
  return { nx, ny, nz, mag, faceN };
}
const clampL = v => v < 2 ? 2 : v > 126 ? 126 : v;
const shadeHsl = (hsl, l) => (hsl & 65408) + clampL(((hsl & 127) * l) >> 7);
const LIT = { ambient: 64, contrast: 850, x: -30, y: -50, z: -30 };   /* the client's player light: toModel(64,850,-30,-50,-30) */
const LOC_LIT = { ambient: 64, contrast: 768, x: -50, y: -10, z: -50 };   /* scenery is static world geometry: ObjectComposition.getEntity */
/* a monster adds its own ambient/contrast on top (NPCComposition.getModel), same direction; a loc does the same over LOC_LIT */
function light(g, amb, con, base) {
  const L = base || LIT;
  const ambient = L.ambient + (amb || 0), x = L.x, y = L.y, z = L.z, n = computeNormals(g);
  const att = (Math.trunc(Math.sqrt(x * x + y * y + z * z)) * (L.contrast + (con || 0))) >> 8, flatDiv = Math.trunc(att / 2) + att;
  const c1 = new Int32Array(g.fc), c2 = new Int32Array(g.fc), c3 = new Int32Array(g.fc);
  for (let f = 0; f < g.fc; f++) {
    let type = g.types ? g.types[f] : 0;
    const alpha = g.alphas ? g.alphas[f] : 0, tex = g.textures ? g.textures[f] - 1 : -1;
    if (alpha === -2) type = 3; else if (alpha === -1) type = 2;
    const vl = v => Math.trunc((y * n.ny[v] + z * n.nz[v] + x * n.nx[v]) / (att * n.mag[v])) + ambient;
    const fl = () => Math.trunc((y * n.faceN[f * 3 + 1] + z * n.faceN[f * 3 + 2] + x * n.faceN[f * 3]) / flatDiv) + ambient;
    if (tex === -1) {
      if (type === 0) { const h = g.colors[f]; c1[f] = shadeHsl(h, vl(g.idx[f * 3])); c2[f] = shadeHsl(h, vl(g.idx[f * 3 + 1])); c3[f] = shadeHsl(h, vl(g.idx[f * 3 + 2])); }
      else if (type === 1) { c1[f] = shadeHsl(g.colors[f], fl()); c3[f] = -1; }
      else if (type === 3) { c1[f] = 128; c3[f] = -1; }
      else c3[f] = -2;                                             /* -2: the face is not drawn at all */
    } else if (type === 0) { c1[f] = clampL(vl(g.idx[f * 3])); c2[f] = clampL(vl(g.idx[f * 3 + 1])); c3[f] = clampL(vl(g.idx[f * 3 + 2])); }
    else if (type === 1) { c1[f] = clampL(fl()); c3[f] = -1; }
    else c3[f] = -2;
  }
  return { c1, c2, c3 };
}

/* ---- geometry ----------------------------------------------------------------------------------------------
   Cache space is +Y down and +Z away from the viewer, so negating both stands the model up facing +Z, the way the
   box rig faces. That is a half turn about X, not a mirror, so the winding is unchanged.
   Opaque faces come first so the mesh can draw as two groups: writing depth for the whole thing when a handful of
   faces are see-through sorts the solid body wrongly. ---- */
function toGeometry(g, lit, o) {
  const sX = o ? o.sx : S, sY = o ? o.sy : S, sZ = o ? o.sz : S;   /* o: a monster — its own scale, its own bone map in g.vb */
  const solid = [], clear = [];
  for (let f = 0; f < g.fc; f++) {
    if (lit.c3[f] === -2) continue;
    ((g.alphas && (g.alphas[f] & 255)) ? clear : solid).push(f);
  }
  const draw = solid.concat(clear), n = draw.length;
  const position = new Float32Array(n * 9), color = new Float32Array(n * 12);
  const si = new Uint16Array(n * 12), sw = new Float32Array(n * 12);
  let lo = 1e9, hi = -1e9, rad = 0;
  for (let i = 0; i < n; i++) {
    const f = draw[i], flat = lit.c3[f] === -1;
    const textured = g.textures ? g.textures[f] > 0 : false, t = textured ? texAvg(g.textures[f] - 1) : 0;
    const opacity = g.alphas ? 1 - (g.alphas[f] & 255) / 256 : 1;
    for (let k = 0; k < 3; k++) {
      const v = g.idx[f * 3 + k], p = i * 9 + k * 3;
      const px = g.vx[v] * sX, py = -g.vy[v] * sY, pz = -g.vz[v] * sZ;
      position[p] = px; position[p + 1] = py; position[p + 2] = pz;
      if (py < lo) lo = py;
      if (py > hi) hi = py;
      const r2 = px * px + pz * pz; if (r2 > rad) rad = r2;
      const c = i * 12 + k * 4;
      si[c] = g.vb[v]; sw[c] = 1;                                  /* one bone a vertex: the cache labels them singly */
      const l = flat || k === 0 ? lit.c1[f] : k === 1 ? lit.c2[f] : lit.c3[f];
      let rgb;
      if (textured) {                                              /* v1: the texture's average, modulated by the baked light */
        const s = l / 128;
        rgb = ((Math.min(255, (t >> 16 & 255) * s) | 0) << 16) | ((Math.min(255, (t >> 8 & 255) * s) | 0) << 8) | (Math.min(255, (t & 255) * s) | 0);
      } else rgb = PAL[l & 0xffff];
      color[c] = (rgb >> 16 & 255) / 255; color[c + 1] = (rgb >> 8 & 255) / 255; color[c + 2] = (rgb & 255) / 255; color[c + 3] = opacity;
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(position, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(color, 4));
  geo.setAttribute('skinIndex', new THREE.BufferAttribute(si, 4));
  geo.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
  geo.addGroup(0, solid.length * 3, 0);
  if (clear.length) geo.addGroup(solid.length * 3, clear.length * 3, 1);
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, (lo + hi) / 2, 0), Math.hypot(Math.sqrt(rad), (hi - lo) / 2) + 0.6);
  return geo;
}

/* ---- assets ---------------------------------------------------------------------------------------------- */
let D = null, models = null, PAL = null, loading = null;
const byName = new Map();                                          /* seedworld display name -> cache item id */
const nByName = new Map();                                         /* seedworld monster name -> its variant list */
const lByName = new Map();                                         /* seedworld scenery name -> its variant list */
const texCache = new Map();
function texAvg(id) {
  let v = texCache.get(id);
  if (v === undefined) texCache.set(id, v = adjustRGB(D.textures[id] || 0, BRIGHT));
  return v;
}
/* The model pack, off the wire as small as it will go. The edge compresses by content type and will not touch an
   application/octet-stream, so the raw file crosses at its full two megabytes — which the default-on setting now
   makes everybody's first-load cost. tools/gzip-osrs.mjs writes the 700 KB copy this prefers; the raw file stays
   beside it for a browser with no DecompressionStream, and for a deployment where the .gz has not landed yet. */
function modelBin() {
  const raw = () => fetch('assets/osrs/models.bin').then(r => r.ok ? r.arrayBuffer() : Promise.reject(new Error('models.bin ' + r.status)));
  if (typeof DecompressionStream !== 'function') return raw();
  return fetch('assets/osrs/models.bin.gz')
    .then(r => r.ok ? new Response(r.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer() : Promise.reject(r.status))
    .catch(raw);
}
function load() {
  if (loading) return loading;
  return loading = Promise.all([
    fetch('assets/osrs/player.json').then(r => r.ok ? r.json() : Promise.reject(new Error('player.json ' + r.status))),
    modelBin()
  ]).then(a => {
    D = a[0];
    models = new Map();
    for (const id in D.models) models.set(+id, readModel(a[1], D.models[id].o));
    for (const id in D.items) byName.set(D.items[id].src.toLowerCase(), +id);
    for (const n in D.npcs || {}) nByName.set(n.toLowerCase(), D.npcs[n]);
    for (const n in D.locs || {}) lByName.set(n.toLowerCase(), D.locs[n]);
    PAL = buildPalette(BRIGHT);
    return true;
  }).catch(e => { loading = null; throw e; });
}

/* Rings and every kind of ammunition have no worn model in the cache, so a miss here is usually the right
   answer rather than a gap; the lookup is cached per item id either way. */
const resolved = new Map();
function idFor(it) {
  if (!it) return 0;
  let m = resolved.get(it.id);
  if (m === undefined) resolved.set(it.id, m = byName.get(it.name.toLowerCase()) || 0);
  return m;
}

/* ---- geometry cache: a loadout is worth building once, however many people are wearing it ---- */
const geoCache = new Map(), GEO_MAX = 40, live = [];   // live: every rig's mesh, so eviction can see what is worn
function geometryFor(ids, body) {
  const key = body + '|' + ids.join(',');
  let geo = geoCache.get(key);
  if (geo) { geoCache.delete(key); geoCache.set(key, geo); return geo; }   /* re-inserted: Map keeps insertion order, so this is an LRU */
  const g = merge(parts(appearance(body, ids), body));
  geo = toGeometry(g, light(g));
  geoCache.set(key, geo);
  if (geoCache.size > GEO_MAX) {
    // oldest first, but never one a rig is still wearing: dispose frees the buffers out from under it
    for (const [k, g2] of geoCache) {
      if (k === key || live.some(m => m.geometry === g2)) continue;
      g2.dispose(); geoCache.delete(k); break;
    }
  }
  return geo;
}

/* ---- the rig -----------------------------------------------------------------------------------------------
   Five bones laid out like buildAvatar's boxes, so section 34 drives this rig and that one with the same code.
   The arms hang off the body, which the boxes do not — on one continuous mesh a twist that left the arms behind
   would pull them out of their sockets. ---- */
let matOpaque = null, matClear = null;
const brightness = v => {
  if (matOpaque) { matOpaque.color.setScalar(v); matClear.color.setScalar(v); }
  if (nMatO) { nMatO.color.setScalar(v); nMatC.color.setScalar(v); }
  if (lMatO) { lMatO.color.setScalar(v); lMatC.color.setScalar(v); }
};
function materials() {
  if (!matOpaque) {
    matOpaque = basicMat({ skinning: true });
    matClear = basicMat({ skinning: true, transparent: true, depthWrite: false });
    brightness(OPT.brightness);
  }
  return [matOpaque, matClear];
}

/* animate() and the POSES read p.wep to decide how a weapon is carried. There is no separate weapon mesh here —
   the weapon is part of the skin — so a stand-in carries the one fact the poses need, whether both hands are on
   it, and swallows the rotations meant for a mesh that does not exist. */
const wepStub = () => ({ userData: { two: 0 }, rotation: { x: 0, y: 0, z: 0, set() {} } });

/* animate() hides the legs when you climb into a boat. There is no separate leg mesh to hide, so the bone
   collapses instead and takes its vertices into the hip, under the hull. The lift animate() applies with them
   is tuned to the box rig, whose lowest seated piece is the bottom of the torso; the waist sits higher than
   that, so the mesh drops by the difference and the figure sits in the hull rather than over it. */
const SEAT = 0.35;
function collapsible(bone, mesh) {
  Object.defineProperty(bone, 'visible', {
    get() { return bone.scale.x > 0.5; },
    set(v) { bone.scale.setScalar(v ? 1 : 1e-4); mesh.position.y = v ? 0 : -SEAT; }
  });
  return bone;
}
function rig() {
  const g = new THREE.Group();
  const mesh = new THREE.SkinnedMesh(new THREE.BufferGeometry(), materials());
  const body = new THREE.Bone(), armL = new THREE.Bone(), armR = new THREE.Bone();
  const legL = collapsible(new THREE.Bone(), mesh), legR = collapsible(new THREE.Bone(), mesh);
  body.position.y = PB;
  armL.position.set(PA[0], PA[1] - PB, 0); armR.position.set(-PA[0], PA[1] - PB, 0);
  legL.position.set(PL[0], PL[1], 0); legR.position.set(-PL[0], PL[1], 0);
  body.add(armL, armR);
  mesh.add(body, legL, legR);
  mesh.frustumCulled = false;                                      /* the bones move vertices past any resting bound */
  mesh.updateMatrixWorld(true);                                    /* bound at the origin, so bindMatrix is the identity */
  mesh.bind(new THREE.Skeleton([body, armL, armR, legL, legR]));
  live.push(mesh);
  g.add(mesh);
  g.parts = { torso: body, armL, armR, legL, legR, head: body, mesh, wep: wepStub(), legHid: 0, osrs: 1 };
  return g;
}

/* Rebuild a rig's mesh for what it is wearing. `it(slot)` is the same reader dressRig takes, so both dressers are
   fed identically; ammo and rings are skipped because the cache has no worn model for either. */
const WORN = ['head', 'cape', 'neck', 'body', 'legs', 'weapon', 'shield', 'hands', 'feet'];
function dress(parts, it, body) {
  const ids = [];
  for (const s of WORN) { const m = idFor(it(s)); if (m) ids.push(m); }
  ids.sort((a, b) => a - b);
  parts.mesh.geometry = geometryFor(ids, body || 'A');
  const w = it('weapon');
  parts.wep.userData.two = w && w.two ? 1 : 0;   // a two-hander is carried in both hands, idle and mid-swing alike
}

/* ---- 2007 monsters -----------------------------------------------------------------------------------------
   One skinned mesh per (name, variant): the box rig underneath keeps walking the ticks and this mesh rides its
   transform, so the lunge, the rear and the walking bob all carry over for free — and its bones are laid out
   from the box rig's own limb plan (kinds, phases, hip heights), so 34's animateNpc drives both rigs with the
   same code. The cache draws a monster at its own scale (ws/hs, applied to the lit model); here the shape is
   kept but the whole thing is refitted so the top of the head lands exactly where the box rig's does — the
   world's sizes are this game's own, not 2007's. Materials are the kit's pair, so brightness covers both. */
let nMatO = null, nMatC = null;
function nMats() {
  if (!nMatO) {
    nMatO = basicMat({ skinning: true });
    nMatC = basicMat({ skinning: true, transparent: true, depthWrite: false });
    nMatO.color.setScalar(OPT.brightness); nMatC.color.setScalar(OPT.brightness);
  }
  return [nMatO, nMatC];
}
/* The cache carries no vertex groups for monsters, so the limb split is geometric, guided by the plan (limb
   kinds and hip heights as fractions of the rig's height): legs are the connected components under the hip
   cut, wings the lateral spans above it, spider legs radial sectors round the body. Arms stay on the body —
   without the cache's labels a hand is not reliably told from a thigh, and a still arm beats a torn one. */
function boneMap(g, plan, h, sxz, sy) {
  const vc = g.vc, wx = new Float32Array(vc), wy = new Float32Array(vc), wz = new Float32Array(vc);
  for (let i = 0; i < vc; i++) { wx[i] = g.vx[i] * sxz; wy[i] = -g.vy[i] * sy; wz[i] = -g.vz[i] * sxz; }
  const vb = new Uint8Array(vc), piv = plan.map(() => null), acc = plan.map(() => [0, 0, 0, 0]);
  const take = (i, b) => { vb[i] = b + 1; const s = acc[b]; s[0] += wx[i]; s[1] += wy[i]; s[2] += wz[i]; s[3]++; };
  const slegs = [], legs = [], wings = [];
  let hasArm = 0;
  plan.forEach((p, i) => {
    if (p.kind === 'sleg') slegs.push(i);
    else if (p.kind === 'leg' || p.kind === 'qleg') legs.push(i);
    else if (p.kind === 'wing') wings.push(i);
    else if (p.kind !== 'tail') hasArm = 1;   // a tail is not an arm: it must not put the wings on the armed path
  });
  let zc = 0;
  for (let i = 0; i < vc; i++) zc += wz[i];
  zc /= vc || 1;

  if (slegs.length) {   /* sectors round the body, front to back, one rank of hips a side */
    let maxR = 0;
    const rr = new Float32Array(vc);
    for (let i = 0; i < vc; i++) { rr[i] = Math.hypot(wx[i], wz[i] - zc); if (rr[i] > maxR) maxR = rr[i]; }
    const core = maxR * 0.45;
    const sl = [slegs.filter(i => plan[i].s > 0), slegs.filter(i => plan[i].s < 0)];
    for (let i = 0; i < vc; i++) {
      if (rr[i] <= core) continue;
      const list = wx[i] >= 0 ? sl[0] : sl[1];
      if (!list.length) continue;
      const a = Math.atan2(Math.abs(wx[i]), wz[i] - zc);   /* 0 straight ahead .. PI behind */
      take(i, list[Math.min(list.length - 1, Math.floor(a / Math.PI * list.length))]);
    }
    for (const i of slegs) {
      const s = acc[i];
      if (!s[3]) continue;
      const dx = s[0] / s[3], dz = s[2] / s[3] - zc, dl = Math.hypot(dx, dz) || 1;
      piv[i] = [dx / dl * core, plan[i].y * h, zc + dz / dl * core];   /* the hip: on the body's edge, under the leg */
    }
  } else if (legs.length) {
    /* The plan's hip height is a first guess: a belly or a tunic that dips below it welds the legs into one
       lump, so the cut steps down until the ground-standing pieces come apart. A piece only counts as a leg
       when it actually reaches the floor and spans most of the cut — a drooping wing tip does neither. */
    const parent = new Int32Array(vc);
    const find = i => { while (parent[i] !== i) i = parent[i] = parent[parent[i]]; return i; };
    const slice = cut => {
      for (let i = 0; i < vc; i++) parent[i] = i;
      for (let f = 0; f < g.fc; f++) {
        const a = g.idx[f * 3], b = g.idx[f * 3 + 1], c = g.idx[f * 3 + 2];
        if (wy[a] < cut && wy[b] < cut && wy[c] < cut) { parent[find(a)] = find(b); parent[find(c)] = find(b); }
      }
      const comps = new Map();   /* root -> [n, sx, sz, loY, hiY] */
      for (let i = 0; i < vc; i++) {
        if (wy[i] >= cut) continue;
        const r = find(i);
        let s = comps.get(r);
        if (!s) comps.set(r, s = [0, 0, 0, 1e9, -1e9]);
        s[0]++; s[1] += wx[i]; s[2] += wz[i];
        if (wy[i] < s[3]) s[3] = wy[i];
        if (wy[i] > s[4]) s[4] = wy[i];
      }
      let maxAX = 0;
      const stand = new Map();
      for (const [r, s] of comps) {
        if (s[3] > cut * 0.4 || s[4] - s[3] < cut * 0.5) continue;   /* floating, or a shallow sliver */
        stand.set(r, s);
        maxAX = Math.max(maxAX, Math.abs(s[1] / s[0]));
      }
      for (const [r, s] of stand) if (Math.abs(s[1] / s[0]) < maxAX * 0.3) stand.delete(r);   /* the midline is a tail */
      return stand;
    };
    const cut0 = Math.max.apply(null, legs.map(i => plan[i].y)) * h, want = Math.min(legs.length, 4);
    let cut = cut0, kept = slice(cut0);
    for (let c2 = cut0 * 0.78; kept.size < want && c2 > cut0 * 0.1; c2 *= 0.78) {
      const k2 = slice(c2);
      if (k2.size > kept.size && k2.size <= 4) { kept = k2; cut = c2; }   /* <= 4: past that it is toes, not legs */
    }
    slice(cut);   /* deterministic, so re-running the winning cut makes find() agree with kept's roots */
    const biped = plan[legs[0]].kind === 'leg';
    if (kept.size === 1) {   /* legs that never come apart (a plump hen): split the lump down the midline */
      const r0 = kept.keys().next().value;
      const half = sgn => biped ? legs.find(i => (plan[i].s > 0) === sgn) : legs.find(i => (plan[i].x >= 0) === sgn);
      for (let i = 0; i < vc; i++) if (wy[i] < cut && find(i) === r0) take(i, half(wx[i] >= 0));
    } else {
      let zs = 0, zn = 0;
      for (const s of kept.values()) { zs += s[2]; zn += s[0]; }
      zs /= zn || 1;
      const two = kept.size <= 2, pick = new Map();
      let xs = 0;   /* a leaning model can put both feet past the midline: sides are relative to the pair, not to x 0 */
      for (const s of kept.values()) xs += s[1] / s[0];
      xs /= kept.size;
      for (const [r, s] of kept) {
        const right = s[1] / s[0] >= (two ? xs : 0), czq = s[2] / s[0] >= zs ? 1 : -1;
        const b = biped ? legs.find(i => (plan[i].s > 0) === right)
          : legs.find(i => (plan[i].x >= 0) === right && (two || (plan[i].z >= 0) === (czq > 0)));
        if (b !== undefined) pick.set(r, b);
      }
      for (let i = 0; i < vc; i++) {
        if (wy[i] >= cut) continue;
        const b = pick.get(find(i));
        if (b !== undefined) take(i, b);
      }
    }
    for (const i of legs) { const s = acc[i]; if (s[3]) piv[i] = [s[0] / s[3], cut, s[2] / s[3]]; }
  }
  if (wings.length) {   /* whatever spreads past the body's own width, behind the middle when there are arms.
       No arms means a dragon: its wing is an upright fan rising from the spine with the head carried low and
       forward, so everything well above the barrel is wing too — gated off the neck by x (the fan starts past
       the spine's width) and off a raised head (Vorkath) by z. The pivot then sits at the fan's root, not the
       flank, so the beat sweeps the whole fan instead of shearing its outer half. */
    const hip = legs.length ? Math.max.apply(null, legs.map(i => plan[i].y)) * h : h * 0.3;
    let edge = 0;
    for (let i = 0; i < vc; i++) if (vb[i]) edge = Math.max(edge, Math.abs(wx[i]));
    edge = edge ? edge * 1.1 : h * 0.22;
    const inX = hasArm ? edge : edge * 0.45;
    for (let i = 0; i < vc; i++) {
      if (vb[i] || wy[i] <= hip) continue;
      const ax = Math.abs(wx[i]);
      if (ax > edge ? (hasArm && wz[i] >= zc) : (hasArm || ax <= inX || wy[i] <= hip * 1.4 || wz[i] >= zc + h * 0.3)) continue;
      const b = wings.find(j => (plan[j].s > 0) === (wx[i] >= 0));
      if (b !== undefined) take(i, b);
    }
    for (const i of wings) {
      const s = acc[i];
      if (s[3]) piv[i] = [(plan[i].s > 0 ? 1 : -1) * inX, s[1] / s[3], s[2] / s[3]];
    }
  }
  const ti = plan.findIndex(p => p.kind === 'tail');
  if (ti >= 0) {   /* the tail: whatever is left behind the plan's own hinge — on a dragon a thin midline run */
    const tz = plan[ti].z * h;
    for (let i = 0; i < vc; i++) if (!vb[i] && wz[i] < tz) take(i, ti);
    if (acc[ti][3]) piv[ti] = [0, plan[ti].y * h, tz];
  }
  return { vb, piv };
}
const nGeoCache = new Map(), NGEO_MAX = 48, nLive = [];   /* same LRU discipline as the loadouts */
function npcVariants(name) { const v = nByName.get(name.toLowerCase()); return v ? v.length : 0; }
function npcGeometry(v, key, h, plan) {
  let e = nGeoCache.get(key);
  if (e) { nGeoCache.delete(key); nGeoCache.set(key, e); return e; }
  const list = [];
  for (const id of v.m) { const m = models.get(id); if (m) list.push(makePart(m, 0, v.rc, 0)); }
  const g = merge(list);
  let top = 1;
  for (let i = 0; i < g.vc; i++) if (-g.vy[i] > top) top = -g.vy[i];   /* cache +Y is down: the head is the most negative y */
  const sy = h / top, sxz = sy * (v.ws || 128) / (v.hs || 128);        /* the fit sets the height; ws/hs only keeps the aspect */
  let piv = plan.map(() => null);
  if (plan.length) { const r = boneMap(g, plan, h, sxz, sy); g.vb = r.vb; piv = r.piv; }
  e = { geo: toGeometry(g, light(g, v.amb, v.con), { sx: sxz, sy, sz: sxz }), piv };
  nGeoCache.set(key, e);
  if (nGeoCache.size > NGEO_MAX) for (const [k2, e2] of nGeoCache) {
    if (k2 === key || nLive.some(m => m.geometry === e2.geo)) continue;
    e2.geo.dispose(); nGeoCache.delete(k2); break;
  }
  return e;
}
/* The rig: one body bone that never moves, one bone per plan limb, flat under the mesh. Spider hips bind at
   their resting yaw, because animateNpc steers slegs to base + sweep where every other kind swings from 0. */
function npcMesh(name, vi, h, plan) {
  const n = npcVariants(name);
  if (!n) return null;
  plan = plan || [];
  const key = name.toLowerCase() + '|' + (vi % n) + '|' + h.toFixed(2);
  const e = npcGeometry(nByName.get(name.toLowerCase())[vi % n], key, h, plan);
  const mesh = new THREE.SkinnedMesh(e.geo, nMats());
  const bones = [new THREE.Bone()];
  mesh.limbs = [];
  plan.forEach((p, i) => {
    const b = new THREE.Bone(), pv = e.piv[i];
    if (pv) b.position.set(pv[0], pv[1], pv[2]);
    if (p.kind === 'sleg') b.rotation.y = p.base || 0;
    bones.push(b);
    mesh.limbs.push({ m: b, kind: p.kind, s: p.s, ph: p.ph || 0, base: p.base || 0, a: p.a });
  });
  for (const b of bones) mesh.add(b);
  mesh.updateMatrixWorld(true);   /* bound at the origin, so bindMatrix is the identity */
  mesh.bind(new THREE.Skeleton(bones));
  nLive.push(mesh);
  return mesh;
}
function npcFree(mesh) { const i = nLive.indexOf(mesh); if (i >= 0) nLive.splice(i, 1); }

/* ---- 2007 world objects ------------------------------------------------------------------------------------
   Scenery is simpler than a monster: no skeleton, no height fit. A loc model is authored on the tile grid —
   128 units = 1 tile, base at y 0, centred on its footprint — so 1/128 stands it on its tile at the cache's
   own size and the caller only adds flavour scale. The def's own resize/offset (s, o) is folded into the
   vertices before lighting, exactly as ObjectComposition does, and the light is the client's scenery light
   (LOC_LIT), not the actor light. locMesh() is the near-LOD overlay for an instanced tree or vein (spent = the
   chopped/mined state, when the pack carries one); locBatch() hands the same lit triangles to game.js's chunk
   batcher as flat arrays, colours already final, for the fixtures that live inside merged chunk meshes. */
const S128 = 1 / 128;
function locPart(m, st) {
  let verts = m.verts;
  const s = st.s, o = st.o;
  if (s || o) {
    const sx = s ? s[0] : 128, sy = s ? s[1] : 128, sz = s ? s[2] : 128;
    const ox = o ? o[0] : 0, oy = o ? o[1] : 0, oz = o ? o[2] : 0;
    verts = Int16Array.from(m.verts);
    for (let i = 0; i < verts.length; i += 3) {
      verts[i] = Math.trunc(verts[i] * sx / 128) + ox;
      verts[i + 1] = Math.trunc(verts[i + 1] * sy / 128) + oy;
      verts[i + 2] = Math.trunc(verts[i + 2] * sz / 128) + oz;
    }
  }
  let colors = m.colors;
  if (st.rc && st.rc.length) {
    colors = Uint16Array.from(m.colors);
    for (let i = 0; i < colors.length; i++) for (const p of st.rc) if (colors[i] === p[0]) { colors[i] = p[1]; break; }
  }
  let tex = null;
  if (st.rt && st.rt.length && m.textures) {   /* stored +1 so 0 means untextured */
    tex = Uint16Array.from(m.textures);
    for (let i = 0; i < tex.length; i++) for (const p of st.rt) if (tex[i] === p[0] + 1) { tex[i] = p[1] + 1; break; }
  }
  return { m, verts, colors, pin: 0, tex };
}
let lMatO = null, lMatC = null;
function lMats() {
  if (!lMatO) {
    lMatO = basicMat({});
    lMatC = basicMat({ transparent: true, depthWrite: false });
    lMatO.color.setScalar(OPT.brightness); lMatC.color.setScalar(OPT.brightness);
  }
  return [lMatO, lMatC];
}
const lGeoCache = new Map(), LGEO_MAX = 96, lLive = [];   /* same LRU discipline again */
function locVariants(name) { const v = lByName.get(name.toLowerCase()); return v ? v.length : 0; }
function locState(name, vi, spent) {
  const list = lByName.get(name.toLowerCase());
  if (!list || !list.length) return null;
  const v = list[vi % list.length];
  return spent ? v.sp || null : v;   /* no spent look in the cache: the caller keeps its own */
}
function locGeometry(name, vi, spent) {
  const st = locState(name, vi, spent);
  if (!st) return null;
  const key = name.toLowerCase() + '|' + vi + '|' + (spent ? 1 : 0);
  let e = lGeoCache.get(key);
  if (e) { lGeoCache.delete(key); lGeoCache.set(key, e); return e; }
  const list = [];
  for (const id of st.m) { const m = models.get(id); if (m) list.push(locPart(m, st)); }
  if (!list.length) return null;
  const g = merge(list);
  e = { geo: toGeometry(g, light(g, st.amb, st.con, LOC_LIT), { sx: S128, sy: S128, sz: S128 }) };
  lGeoCache.set(key, e);
  if (lGeoCache.size > LGEO_MAX) for (const [k2, e2] of lGeoCache) {
    if (k2 === key || lLive.some(m => m.geometry === e2.geo)) continue;
    e2.geo.dispose(); lGeoCache.delete(k2); break;
  }
  return e;
}
function locMesh(name, vi, spent) {
  const e = locGeometry(name, vi, spent);
  if (!e) return null;
  const mesh = new THREE.Mesh(e.geo, lMats());
  lLive.push(mesh);
  return mesh;
}
function locFree(mesh) { const i = lLive.indexOf(mesh); if (i >= 0) lLive.splice(i, 1); }
/* the batcher's view: positions and 3-component colours, copied out synchronously by Batch.add07, so the
   arrays may be LRU'd along with their geometry without ceremony */
function locBatch(name, vi) {
  const e = locGeometry(name, vi, 0);
  if (!e) return null;
  if (!e.bt) {
    const c4 = e.geo.attributes.color.array, n = c4.length / 4, c3 = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { c3[i * 3] = c4[i * 4]; c3[i * 3 + 1] = c4[i * 4 + 1]; c3[i * 3 + 2] = c4[i * 4 + 2]; }
    e.bt = { pos: e.geo.attributes.position.array, col: c3 };
  }
  return e.bt;
}

return { load, rig, dress, brightness, idFor, npcVariants, npcMesh, npcFree, locVariants, locMesh, locFree, locBatch, ready: () => !!D };
})();

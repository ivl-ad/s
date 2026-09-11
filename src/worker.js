/* ===========================================================================
   SEEDWORLD — multiplayer relay
   ---------------------------------------------------------------------------
   One Durable Object per world seed. It does not simulate anything: clients
   own their own movement, the room takes deltas, clamps the obvious nonsense,
   and fans them out to whoever is close enough to care.

   The 600 ms synchronisation does NOT happen here. Clients derive their tick
   number from wall clock (Date.now() + offset), and this Worker's only role in
   that is echoing timestamps for the offset estimate. That is deliberate — a
   server-side tick loop would keep the Durable Object awake permanently and
   an empty world would cost money.

   The seed is the world. One account, one character per seed: `players` holds
   who you are, `characters` holds who you are *there*.
   =========================================================================== */

import { DurableObject } from 'cloudflare:workers';

const VIEW = 48;   // interest radius in tiles; render radius is ~7 chunks
const LEAVE = VIEW + 6;   // hysteresis: enter at VIEW, leave six tiles later, so a player walking the boundary is not popped in and out
const RATE = 25;   // client messages per second before we start dropping
const MAXSAVE = 8192; // save blob ceiling, enforced here not client-side
/* The room drains its queue on this beat rather than 40 ms. Clients interpolate
   between frames anyway and the latency-sensitive ops (11, 14, 15) bypass flush
   entirely, so five sweeps a second buys the same feel for a fifth of the wake. */
const FLUSH_MS = 200;
/* Budgets, all per connection. Every one of these guards a lane that a modified
   client could otherwise open at RATE: a save is a D1 write, a world edit is a
   row of shared state, a death pile is items on other people's ground. */
const SAVE_MIN = 2500;   // ms between accepted saves; a later blob supersedes, never drops (see case 8)
const PILE_MIN = 5000;   // ms between death piles; an honest client sends one per death
const EDIT_RATE = 120, EDIT_WIN = 60000;   // world edits (ops 20/22) per minute — generous for a maxed woodcutter
const EDIT_MAX = 1000;   // ticks a client may hold a node down: ten minutes, over the longest honest respawn
const HIT_MAX = 130;   // a single pvp hit: a claws cascade off a max-hit 59 reaches 116
const HIT_WIN = 6000, HIT_SUM = 150;   // and a sustained budget over six seconds, above any legitimate dps
const TRADE_MAX = 2147483647;   // per-stack ceiling on a trade offer; the pack cannot carry more than an int
const GE_MIN = 2000, GE_BURST = 6;   // exchange mutations: one every two seconds, six in hand
const HOUSE_TTL = 604800000;   // a week: past that a house row is history, not a standing building
/* Movement is the root budget. Every other gate in this file measures against me.x/me.z — near() for ops 11/14/15,
   the pile's reach for 12, the leash for 21, the interest set in flush() — and nothing bounded how fast those two
   fields could move, so a modified client could stand on any victim and swing. Credit accrues at MV_TILE per tick of
   wall clock and banks to MV_CAP, which covers the catch-up burst a backgrounded tab sends on its way back. A jump
   past the credit is a teleport, and teleports are real and announce nothing of their own (a ladder, a spell, a boat,
   the respawn), so they are counted rather than refused. */
const MV_TILE = 6;      // manhattan tiles one tick may cover: three steps of a sailed boat, each diagonal
const MV_CAP = 64;      // the most credit a connection may bank
const WARP_WIN = 30000, WARP_MAX = 8;   // teleports per half minute, over any honest run of ladders
const WARP_LOCK = 3000; // and no blade lands for five ticks after arriving by one
/* Only a fault the next attempt cannot survive may disarm a session. Everything else — a dropped connection, an
   overloaded database — is a reason to come back in a moment, and used to cost the whole session's play: one blanket
   catch sent op 7, and op 7 is terminal on the client. Unrecognised means transient on purpose: a wrong "permanent"
   costs a session, a wrong "transient" costs a retry. */
const SAVE_PERM = /no such table|no such column|syntax error|constraint|too large|not authorized/i;
const DEAD_WIN = 5000;  // a death pile needs a corpse: op 13 reported this player at zero, this recently
const PILE_GRACE = 100; // per row, for what was picked up since the last save; past that the save's own count is the ceiling
const PILE_SUM = 1000000;   // and the whole pile, summed

/* ===================== THE ARCHIVE (D1 is a cache) =======================
   D1 is capped at 10 GB and the cap cannot be raised, so `characters` cannot be
   where ten million saves live. It is instead a hot cache: a character sits in
   D1 while it is being played and for ARCH_IDLE afterwards, then a cron sweep
   writes the blob to R2 and deletes the row. The table therefore never grows
   past roughly the concurrent player count, whatever the account count is — and
   because it stays small, the sweep's `WHERE updated < ?` can scan it without an
   index, which matters: indexing `updated` would put a written row back on every
   save, the exact cost this whole design removes.

   R2 is the permanent copy and is never pruned. Storage is $0.015/GB-month
   against D1's $0.75 — fifty times cheaper — with no ceiling to plan around.

   The key is keyed by player FIRST so that one prefix list gives a player every
   character they have ever had, which is what the world-select screen needs once
   their rows have left D1.

   Everything here degrades: with no R2 binding the game runs exactly as it did
   before, in D1 alone. */
const ARCH_IDLE = 5 * 60 * 1000;   // a character idle this long is moved to R2
const ARCH_BATCH = 200;            // characters archived per cron tick
const archKey = (pid, seed) => 'char/' + pid + '/' + seed + '.json';
/* Two limits, because a save is a different animal from a chat line. The
   transport cap has to clear MAXSAVE plus its wrapper or a save can never
   arrive at all; movement and chat stay on a tight leash. A single cap of 512
   silently ate every save from a character with more than a few items in the
   pack, which is every character that has actually been played. */
const MAXMSG = MAXSAVE + 2048;   // hard transport ceiling
const MAXSMALL = 512;   // everything that is not a save

/* The one distance test outside flush(): ops 11, 14 and 15 are delivered straight
   to one socket by pid, bypassing interest management — unchecked, a trade request
   or a pvp hit crossed the whole map. */
const near = (a, b) => Math.abs(a.x - b.x) <= VIEW && Math.abs(a.z - b.z) <= VIEW;

const encoder = new TextEncoder();
const toHex = b => [...new Uint8Array(b)].map(v => v.toString(16).padStart(2, '0')).join('');
const sha256 = async s => toHex(await crypto.subtle.digest('SHA-256', encoder.encode(s)));
const cleanSeed = s => (String(s || '').trim().toLowerCase().slice(0, 32)) || 'lumbridge';

/* Bumped whenever the wire contract changes. The client reads it out of the
   socket hello, because a stale Worker deployment is otherwise independently
   invisible from the browser: assets update instantly and the Worker does not,
   so the game looks new while the server is months old and silently dropping
   everything it does not understand. */
const BUILD = 12;   // 7: wider house lane, op 24 refusal echo; 8: houses stand only while owner connected; 9: op 12 killer+tick elements, eq lane 14 (skull rider); 10: server-stamped op 12 clock, op 21 ownership from the sender, budgeted saves and world edits; 11: op 16 pile claims, trade offer versions on 14/15; 12: op 18 spell index widened to 63 for the ancient book

/* The schema, in one place, so it is reproducible. /health runs exactly this
   list, which makes it the migration: every statement is IF NOT EXISTS and a
   second run is a no-op. sql/schema.sql is the same text for a cold start.

   The indexes are deliberately few. D1 bills a row written per index the write
   touches, so a column that changes on every save must not appear in one:
   `characters` therefore carries no secondary index at all — its (pid, seed)
   primary key already serves both `WHERE pid=?` (leading prefix) and the
   per-seed lookup, and nothing in the save upsert's SET list is indexed, so a
   save bills exactly one row. `houses` is keyed (seed, pid) rather than
   (pid, seed)'s natural order because the only read is by seed; that lets the
   primary key do the work an extra index used to. `ge_book` is partial on the
   live offers alone, so a fill that does not finish an offer touches no index
   and the book never scans rows that have already left it. */
const DDL = {
  players: `CREATE TABLE IF NOT EXISTS players (
     pid TEXT PRIMARY KEY,
     auth_hash TEXT NOT NULL UNIQUE,
     name TEXT NOT NULL,
     ip_hash TEXT,
     seed TEXT,
     created INTEGER NOT NULL,
     updated INTEGER NOT NULL)`,
  // uniqueness is the index's job, not a racing SELECT's
  playersName: 'CREATE UNIQUE INDEX IF NOT EXISTS idx_players_name ON players (name COLLATE NOCASE)',
  playersIp: 'CREATE INDEX IF NOT EXISTS idx_players_ip ON players (ip_hash, created)',
  characters: `CREATE TABLE IF NOT EXISTS characters (
     pid TEXT NOT NULL,
     seed TEXT NOT NULL,
     save TEXT NOT NULL,
     combat INTEGER NOT NULL DEFAULT 3,
     total_level INTEGER NOT NULL DEFAULT 32,
     created INTEGER NOT NULL,
     updated INTEGER NOT NULL,
     PRIMARY KEY (pid, seed))`,
  houses: `CREATE TABLE IF NOT EXISTS houses (
     seed TEXT NOT NULL,
     pid TEXT NOT NULL,
     x INTEGER, z INTEGER, data TEXT, updated INTEGER,
     PRIMARY KEY (seed, pid))`,
  geOffers: `CREATE TABLE IF NOT EXISTS ge_offers (
     pid TEXT NOT NULL, slot INTEGER NOT NULL, kind INTEGER NOT NULL,
     item TEXT NOT NULL, price INTEGER NOT NULL, qty INTEGER NOT NULL,
     filled INTEGER NOT NULL DEFAULT 0, coins_box INTEGER NOT NULL DEFAULT 0,
     items_box INTEGER NOT NULL DEFAULT 0, state INTEGER NOT NULL DEFAULT 0,
     created INTEGER NOT NULL, updated INTEGER NOT NULL,
     PRIMARY KEY (pid, slot))`,
  geBook: 'CREATE INDEX IF NOT EXISTS ge_book ON ge_offers (item, kind, price) WHERE state = 0'
};
const SCHEMA = Object.values(DDL);

/* The spawn-table revision this deployment expects, echoed in the socket hello
   (element 6). A client whose own SPAWN_REV differs keeps its world private
   rather than sharing keys that name different monsters. Keep in step with the
   client's SPAWN_REV when deploying both. */
const SPAWN_REV = 10;   // 10: castles refuse a sloping site, moving some keeps and their garrisons. 9: town outlines, plans and charters (Lumbridge/Varrock). 8: region layer + named sites (mines/groves/waypoints), tame() removed, pen/waypoint spawns

/* The clients' shared clock, mirrored so world deadlines can be sanity-checked
   and expired entries pruned. Same epoch, same 600 ms tick. */
const W_EPOCH = 1735689600000;
const wTick = () => Math.floor((Date.now() - W_EPOCH) / 600);

/* The 2007 xp curve, server side, so /characters can summarise a blob without
   trusting the client to report its own combat level. */
const XP_TABLE = new Float64Array(100);
for (let L = 2, acc = 0; L <= 99; L++) {
  acc += Math.floor((L - 1) + 300 * Math.pow(2, (L - 1) / 7));
  XP_TABLE[L] = Math.floor(acc / 4);
}
function levelFor(xp) {
  let L = 1;
  while (L < 99 && xp >= XP_TABLE[L + 1]) L++;
  return L;
}
/* Indices match the client's SKILLS array: attack 0, strength 1, defence 2,
   ranged 3, prayer 4, magic 5, hitpoints 8; 24-27 are locked reserved slots the
   client's totalLevel() skips. The formula mirrors the client's combatLevel()
   exactly — prayer half-counts, and ranged/magic builds take the best branch. */
function summarise(save) {
  const xp = Array.isArray(save && save.xp) ? save.xp : [];
  let total = 0;
  const lv = [];
  for (let i = 0; i < 28; i++) { let L = levelFor(+xp[i] || 0); if (i === 8 && L < 10) L = 10; lv[i] = L; if (i < 24) total += L; }   // hitpoints starts at 10, the same floor applySave applies
  const base = 0.25 * (lv[2] + lv[8] + Math.floor(lv[4] / 2));
  const melee = 0.325 * (lv[0] + lv[1]);
  const range = 0.325 * Math.floor(lv[3] * 1.5), mage = 0.325 * Math.floor(lv[5] * 1.5);
  const combat = Math.floor(base + Math.max(melee, range, mage)) || 3;
  return { combat, totalLevel: total };
}

/* What the character was last saved CARRYING: worn gear, the quiver and the pack. The bank is deliberately absent —
   banked items cannot fall on the ground. This is the ceiling a death pile is clamped to, so op 12 can no longer be
   made to spawn items nobody ever owned. `inv` is flat (slot, id, n) triples; an older row-array save still reads. */
function carried(save) {
  const m = new Map();
  const add = (id, n) => { if (typeof id === 'string' && id && n > 0) m.set(id, Math.min(TRADE_MAX, (m.get(id) || 0) + n)); };
  const rows = Array.isArray(save && save.inv) ? save.inv : [];
  if (Array.isArray(rows[0])) for (const r of rows) add(r[1], r[2] | 0);
  else for (let i = 0; i + 2 < rows.length; i += 3) add(rows[i + 1], rows[i + 2] | 0);
  const eq = Array.isArray(save && save.eq) ? save.eq : [];
  for (let i = 0; i < eq.length; i++) add(eq[i], i === 5 ? Math.max(1, save.ammoN | 0) : 1);   // slot 5 is the quiver; its count rides ammoN
  return m;
}

/* =========================== THE ROOM ==================================== */

export class World extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.players = new Map();   // pid -> record
    this.pending = new Map();   // dedupe key -> message
    this.timer = null;
   /* Every per-player budget the room enforces, kept OUTSIDE the socket record. Inheriting from the live record only
       covers a second socket racing a live one; an ordinary reconnect deletes that record first, so redialling used to
       refresh the teleport bucket, the save cooldown and the pile ceiling. pid -> {t, mvT, mvB, wT, wN, own, saveT, pileT}. */
    this.budget = new Map();

   /* Shared world state: nodes depleted and monsters dead, each a key mapped
       to the shared tick it comes back on. In memory only, self-expiring, and
       bounded by what players near each other have touched lately — if the
       object hibernates and loses them, the cost is a node reappearing a
       little early, which nobody will ever prove. */
    this.depleted = new Map();
    this.monDead = new Map();

   /* Player houses: pid -> {x, z, d} where d is the client's compact house
       object. Loaded from D1 once per object lifetime, written back only when
       an edit has sat for a few seconds — a build session costs one read and
       a handful of writes, not a write per wall. */
    this.houses = null;   // null until loadHouses has run
    this.hDirty = new Set();
    this.hFlushT = 0;

   // With the hibernation API this object can be evicted between messages and
   // rebuilt. Per-connection state therefore lives on the socket, not here.
    for (const ws of ctx.getWebSockets()) {
      const a = ws.deserializeAttachment();
      if (a) this.players.set(a.pid, { ws, ...a, seen: new Set(), n: 0, t0: 0 });
    }
  }

  async fetch(req) {
    const u = new URL(req.url);

   // cheap population probe for the world-select screen; no socket involved
    if (u.pathname === '/count') {
      return new Response(JSON.stringify({ n: this.players.size }),
        { headers: { 'content-type': 'application/json' } });
    }

    const pid = u.searchParams.get('pid');
    const name = u.searchParams.get('name') || 'Adventurer';
    if (!pid) return new Response('no pid', { status: 400 });

    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server);   // NOT server.accept() — that kills hibernation

    const seed = cleanSeed(u.searchParams.get('seed'));

   /* A reconnecting pid is a new socket wearing an old name. If the previous
       close was missed — an abrupt tab kill, or this object hibernating in
       between — the survivors still list this pid as seen and will therefore
       never be sent an enter for it again. Forget it everywhere so the next
       flush rediscovers them. */
   /* The older socket is told why it is going: 4001 means "your account
       just arrived on another connection". A client that hears it stands
       down rather than reconnecting — otherwise the two windows kick each
       other off every second for as long as both stay open. */
    const old = this.players.get(pid);
    if (old && old.ws !== server) { try { old.ws.close(4001, 'replaced'); } catch {} }
    for (const q of this.players.values()) q.seen.delete(pid);

   // savedSeed starts as what the players row already says, so a session in
   // the same world never rewrites it — that UPDATE used to fire once per
   // connection (and again after every hibernation wake) for nothing.
   /* A reconnecting pid keeps its last known position and gear, and `pos` — has this
       connection ever reported a position — rides the record so nobody is announced,
       or seated at 0,0, before a real move arrives. */
    const rec = { pid, name, seed, x: (old && old.x) | 0, z: (old && old.z) | 0,
                  pos: (old && old.pos) ? 1 : 0, face: 0, flags: 0, eq: (old && old.eq) || [],
                  savedSeed: u.searchParams.get('last') || null };
    server.serializeAttachment(rec);
   /* The movement clock, the teleport bucket and the pile ceiling ride the record rather than the attachment, so a
       reconnecting pid inherits them and dropping the socket is not a way to buy a fresh budget. */
    const bud = old || this.budget.get(pid) || {};
    this.players.set(pid, { ws: server, ...rec, seen: new Set(), n: 0, t0: 0,
                            mvT: bud.mvT || 0, mvB: bud.mvB || 0, wT: bud.wT || 0, wN: bud.wN | 0,
                            own: bud.own || null, saveT: bud.saveT || 0, pileT: bud.pileT || 0 });

   // extra fields appended, so older clients reading only [1] and [2] still work
   // element 7 is the pvp ceiling: the client carried its own copy and the two drifted (60 against 130)
    server.send(JSON.stringify([[0, pid, Date.now(), name, seed, BUILD, SPAWN_REV, HIT_MAX]]));

   /* A late arrival must see the stumps and absences everyone else does.
       Snapshots go only to the joiner; live traffic covers everyone else. */
    this.pruneWorld(1);
    const snap = [];
    for (const [k, d] of this.depleted) snap.push([20, k, d]);
    for (const [k, d] of this.monDead) snap.push([22, k, d]);
    for (let i = 0; i < snap.length; i += 100) {
      try { server.send(JSON.stringify(snap.slice(i, i + 100))); } catch {}
    }
   /* every standing house, in pages — and a house stands only while its owner is connected,
       so the joiner sees just the living (their own record they ignore client-side).
       Off the handshake: the first join of an object's life pays a D1 SELECT for this, and the socket has nothing
       to do with houses. Awaiting it here put a whole database round trip between the player and the world. The
       socket is already accepted, so these sends queue behind the hello either way. */
    this.ctx.waitUntil(this.loadHouses(seed).then(() => {
      const hs = [];
      for (const [hp, h] of this.houses) if (this.players.has(hp)) hs.push([23, hp, h.d]);
      for (let i = 0; i < hs.length; i += 20) {
        try { server.send(JSON.stringify(hs.slice(i, i + 20))); } catch {}
      }
    }));

   /* Interest management only runs inside flush(), and flush only runs when
       somebody queues traffic. Without this, a join is invisible to a room
       where nobody happens to be moving. */
    if (!this.timer) this.timer = setTimeout(() => this.flush(), FLUSH_MS);
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws, raw) {
    const att = ws.deserializeAttachment();
    if (!att) return;
    const me = this.players.get(att.pid);
    if (!me || typeof raw !== 'string') return;
    if (raw.length > MAXMSG) {
      console.log('over transport cap', raw.length, me.pid);
      try { ws.send(JSON.stringify([[7, 'save too large (' + raw.length + ' bytes)']])); } catch {}
      return;
    }

    const now = Date.now();
    if (now - me.t0 > 1000) { me.t0 = now; me.n = 0; }

    let m;
    try { m = JSON.parse(raw); } catch { return; }
    if (!Array.isArray(m)) return;
   // Size is judged after the type is known, and a rejection is never silent:
   // a save that vanishes without a word is indistinguishable from one that
   // was never sent, which is exactly how this went unnoticed.
   /* Build 5 clients pack a tick's routine traffic into ONE socket send — an
       array of messages instead of a message — so a fighting player costs one
       billable request a tick instead of several. Inner messages still count
       against the rate, and saves never ride a batch (their own size lane). */
    const batch = Array.isArray(m[0]);
    const msgs = batch ? m.slice(0, 16) : [m];
    if ((me.n += msgs.length) > RATE) return;
    if (m[0] !== 8 && m[0] !== 23 && raw.length > (batch ? MAXSMALL * 4 : MAXSMALL)) {   // 23 has its own 4000-byte lane in handle()
      console.log('oversize', batch ? 'batch' : m[0], raw.length, me.pid);
      return;
    }
    for (const one of msgs) if (Array.isArray(one)) await this.handle(me, ws, one, now);
  }

  saveAtt(ws, me) {
    try {
      ws.serializeAttachment({
        pid: me.pid, name: me.name, seed: me.seed, x: me.x, z: me.z, pos: me.pos ? 1 : 0,
        face: me.face, flags: me.flags, eq: me.eq, savedSeed: me.savedSeed || null
      });
    } catch {}
  }

  async handle(me, ws, m, now) {
    switch (m[0]) {

      case 1: {   // move
        const [, tick, x, z, face, flags] = m;
        if (!Number.isInteger(x) || !Number.isInteger(z)) return;
        if (Math.abs(x) > 1e6 || Math.abs(z) > 1e6) return;
        const jump = Math.abs(x - me.x) + Math.abs(z - me.z);
   /* Spend the credit, or spend a warp. Out of warps the claim is dropped and the room goes on holding the last
           honest position — credit keeps banking and the bucket refills, so a client that overspends is ghosted for a
           window, never for the session. */
   /* A fresh record is seated at the origin while the client's first op 1 carries its real position, thousands of tiles
           away — so without this every login spent a teleport token and stamped the blade lock. me.pos is exactly the flag
           for "this connection has reported a position". */
        if (!me.pos) { me.mvB = MV_CAP; me.mvT = now; me.wpT = now; }
        else {
        me.mvB = me.mvT ? Math.min(MV_CAP, (me.mvB || 0) + (now - me.mvT) / 600 * MV_TILE) : MV_CAP;
        me.mvT = now;
        if (jump > me.mvB) {
          if (now - (me.wT || 0) > WARP_WIN) { me.wT = now; me.wN = 0; }
          if ((me.wN || 0) >= WARP_MAX) return;
          me.wN = (me.wN || 0) + 1; me.wpT = now; me.mvB = 0;   // arriving by teleport also stays the blade (case 11)
        } else { me.mvB -= jump; if (jump > MV_TILE) me.wpT = now; }   // a bank full of credit still cannot buy an instant blink onto a victim: one message, one tick's worth
        }
        const first = !me.pos;
        me.x = x; me.z = z; me.pos = 1;
        me.face = (face | 0) & 15;
        me.flags = (flags | 0) & 3;
        this.queue('1:' + me.pid, [1, [[me.pid, tick | 0, x, z, me.face, me.flags]]]);
   /* The attachment refreshes every 16th step: a walk needs no precision across a
           hibernation wake — the next move fixes it. A teleport is not a step: hibernate
           before the next boundary and the object wakes holding the pre-respawn position,
           and flush() hands out an enter for a player who is towns away (the ghost). So a
           jump past a walk's reach, and the first move of a session, write through now. */
        me.mvN = ((me.mvN || 0) + 1) & 15;
        if (first || jump > VIEW || me.mvN === 0) this.saveAtt(ws, me);
        return;
      }

      case 2:   // action animation
        this.queue('2:' + me.pid, [2, me.pid, (m[2] | 0) & 255]);
        return;

      case 3:   // equipment — 11 slots plus riders (d: defence, sk: skull) past them
        me.eq = Array.isArray(m[1])
          ? m[1].slice(0, 14).map(v => (v == null ? null : String(v).slice(0, 32)))
          : [];
        this.queue('3:' + me.pid, [3, me.pid, me.eq]);
        this.saveAtt(ws, me);   // gear matters across a wake: onlookers dress you from it
        return;

      case 19: {   // an arrow was loosed, and where
        this.queue('19:' + me.pid + ':' + now,
          [19, me.pid, m[1] | 0, m[2] | 0, (m[3] | 0) & 0xffffff]);
        break;
      }

      case 20:   // a node was depleted
      case 22: {   // a monster was killed
        const key = String(m[1] || '').slice(0, 48);
        const due = m[2] | 0, gt = wTick();
   /* The deadline used to reach 20000 ticks — three hours a client could hold
           any tile of the world down, at RATE, for as many tiles as it liked. The
           ceiling is now the longest honest respawn and the rate is a bucket, so a
           flood costs the flooder its own budget instead of the room's state. */
        if (!key || due <= gt || due > gt + EDIT_MAX) return;
        if (now - (me.eT || 0) > EDIT_WIN) { me.eT = now; me.eN = 0; }
        if ((me.eN || 0) >= EDIT_RATE) return;   // check, then spend: a refusal must not keep charging the bucket
        me.eN = (me.eN || 0) + 1;
        (m[0] === 20 ? this.depleted : this.monDead).set(key, due);
        this.pruneWorld();
        this.queue(m[0] + ':' + key, [m[0], key, due, me.pid]);
        break;
      }

      case 21: {   // a live monster, owner-driven
        const key = String(m[1] || '').slice(0, 48);
        if (!key) return;
   /* Ownership is the sender's, not whatever the sender claims. The honest
           client already puts its own PID in element 6, so this substitution is
           invisible to it — and it ends the trick where one socket names itself
           the owner of every monster in the room and nobody else may fight.
           act 255 is the release signal and carries no owner; the client honours it
           only when element 8 — the sender the relay stamps itself — is the pid it
           already holds as owner, so a stranger cannot heal a monster mid-fight. */
        const act = (m[7] | 0) & 255, owner = act === 255 ? '' : me.pid;
        const mx = m[2] | 0, mz = m[3] | 0;
        if (Math.abs(mx - me.x) > VIEW * 2 || Math.abs(mz - me.z) > VIEW * 2) return;   // you may only drive a monster you could see
        this.queue('21:' + key,
          [21, key, mx, mz, (m[4] | 0) & 15, m[5] | 0, owner, act, me.pid]);
        break;
      }

      case 18: {   // a spell was cast, and at what
   // 63, not 31: the ancient book took SPELLS past 32 rows, and this index only picks the bolt art an onlooker draws
        this.queue('18:' + me.pid + ':' + now,
          [18, me.pid, (m[1] | 0) & 63, m[2] | 0, m[3] | 0]);
        break;
      }

      case 13: {   // hitpoints, so onlookers can draw a bar
        const hp = m[1] | 0, mx = m[2] | 0;
        if (hp <= 0) me.hp0 = now;   // hurtPlayer reports zero immediately before die() spills, in the same batch
        this.queue('13:' + me.pid, [13, me.pid, hp, mx]);
        break;
      }

   /* Trading is two private conversations, not a broadcast: only the other
         party hears an offer, and only they can answer it. */
      case 14: {   // trade signal
        const other = this.players.get(String(m[1] || ''));
        const act = (m[2] | 0) & 7;
   // act 2 is "called off" and must always land, or the other party is stranded in an open trade window
   // an accept quotes the two offer versions it was made against; the client refuses to settle on a mismatch
        if (other && (act === 2 || act === 4 || near(me, other))) {   // act 4 says the leader has already moved: it must land even if they stepped apart
          try { other.ws.send(JSON.stringify([[14, me.pid, me.name, act, m[3] | 0, m[4] | 0]])); } catch {}
        }
        return;
      }

      case 15: {   // trade offer
        const other = this.players.get(String(m[1] || ''));
   // quantity is clamped to what a pack slot can physically carry: an int, not a wish
        const offer = Array.isArray(m[2]) ? m[2].slice(0, 28).map(it => [
          String((it && it[0]) || '').slice(0, 32), Math.min(TRADE_MAX, Math.max(0, (it && it[1] | 0) || 0))
        ]) : [];
        if (other && near(me, other)) {
          try { other.ws.send(JSON.stringify([[15, me.pid, offer, m[3] | 0]])); } catch {}
        }
        return;
      }

      case 11: {   // pvp hit, delivered to one player
   /* Attacker-authoritative by design, but budgeted. The old pair of numbers was
           wrong in both directions: a 60 ceiling silently ate every top-tier special
           (a claws cascade off a max hit of 59 lands 116, an armadyl godsword 81, a
           Dharok's at one hitpoint 96) while 110 per four ticks still permitted almost
           twice the highest honest damage per second. The ceiling now clears the
           hardest real hit and the window is the one that actually holds the line —
           and a refusal is echoed, because a spec that vanishes without a word is how
           this went unnoticed for so long. */
   // no masking before the test: & 255 wrapped 256 to a free pass at zero, and a negative would have healed
        const d = m[2] | 0;
        if (d < 0 || d > HIT_MAX) { try { ws.send(JSON.stringify([[7, 'hit of ' + d + ' refused (ceiling ' + HIT_MAX + ')']])); } catch {} return; }
        if (now - (me.wpT || 0) < WARP_LOCK) return;   // arrived by teleport a moment ago: the blade waits five ticks
        if (now - (me.dmgT || 0) > HIT_WIN) { me.dmgT = now; me.dmgSum = 0; }
        if ((me.dmgSum = (me.dmgSum || 0) + d) > HIT_SUM) return;
        const target = this.players.get(String(m[1] || ''));
        if (target && near(me, target)) {
          const cls = typeof m[4] === 'string' ? m[4].slice(0, 1) : 0;   // element 4 carries the attack class so the victim's overhead can answer
          try { target.ws.send(JSON.stringify([[11, me.pid, d, m[3] ? 1 : 0, cls]])); } catch {}   // element 3 carries Smite
        }
        return;
      }

      case 12: {   // died here, dropped this; element 4 names the killer (loot is theirs for a minute), 5 stamps the tick
   /* Three things the sender no longer chooses. The clock is stamped here: a
           client-supplied 0 took the receiver's instant-drop branch, which turned a
           death message into "spawn these items on that ground, now", at RATE, at any
           coordinates in the cell. The rows are shaped and clamped. And the corpse has
           to fall where the sender stands — die() computes the spot before the respawn
           teleport, which happens a second and a half later, so an honest death is
           comfortably inside the reach. */
        const dx = m[1] | 0, dz = m[2] | 0;
        if (Math.abs(dx - me.x) > 8 || Math.abs(dz - me.z) > 8) return;
   /* And three more gates. A pile needs a corpse — op 13 put this player at zero moments ago — and the flag is
           spent, so one death buys one pile. The rows may only carry what the last save says the character was holding,
           with PILE_GRACE apiece for anything picked up since: every receiving client materialises this pile and
           takeDrop -> invAdd persists it into an honest player's character, so at TRADE_MAX a row it was an item
           printer. And the killer is a player standing here, not a name the corpse chose — their client is the one that
           takes the instant-drop branch. */
        if (now - (me.hp0 || 0) > DEAD_WIN) return;
        me.hp0 = 0;
   /* me.own is only written by writeSave, so before the session's first save there was no ceiling at all and the clamp
       fell through to the whole-pile bound — one million of any id a row, every PILE_MIN, forever. Read it once. */
        if (!me.own) {
          try {
            const r = await this.env.DB.prepare('SELECT save FROM characters WHERE pid=? AND seed=?').bind(me.pid, me.seed).first();
            me.own = r && r.save ? carried(JSON.parse(r.save)) : new Map();
          } catch { me.own = new Map(); }
        }
        if (now - (me.pileT || 0) < PILE_MIN) return;
        me.pileT = now;
        const items = [];
        let sum = 0;
        for (const it of (Array.isArray(m[3]) ? m[3].slice(0, 40) : [])) {
          const id = String((it && it[0]) || '').slice(0, 32);
   /* The grace is ADDED to what the save knows, not a fallback for rows it does not name — a gatherer who filled a
             stack since the last flush must still drop it. And until a save has actually landed this connection there is
             no ceiling to measure against, so the whole-pile bound is the only one that applies: clamping an unknown
             character to PILE_GRACE a row would have quietly shrunk the pile of anyone who died within a minute of
             logging in, and a pvp pile exists ONLY on the wire. */
          const cap = (me.own.get(id) || 0) + PILE_GRACE;
          const n = Math.min(cap, Math.max(0, (it && it[1] | 0) || 0), PILE_SUM - sum);
          if (id && n > 0) { items.push([id, n]); sum += n; }
        }
        const kp = this.players.get(String(m[4] || ''));
   /* What the room believes is lying there, so a claim can be clamped to it. Keyed by tile AND owner: two players
           die a tile apart in a chokepoint routinely, and a claim must not reach the wrong heap. */
        if (!this.piles) this.piles = new Map();
        this.piles.set(dx + ':' + dz + ':' + me.pid, { t: now, rows: new Map(items) });
        if (this.piles.size > 500) for (const [k, v] of this.piles) if (now - v.t > 960000) this.piles.delete(k);   // a pile lives 1500 ticks
        this.queue('12:' + me.pid + ':' + now, [12, me.pid, dx, dz, items, kp && near(me, kp) ? kp.pid : '', wTick()]);
        break;
      }

      case 16: {   // rows taken off a broadcast pile, so the other mirrors of it can retract
   /* op 12 is a CREATE and is rightly gated on locality; this is a DELETE, and a mirror lives a quarter of an hour —
           long enough to walk well past VIEW and back — so a retraction that only reaches the neighbourhood leaves the
           pile standing and lootable a second time. It goes room-wide in flush(), which is safe because a claim can only
           ever remove, and is bounded by the ledger below rather than by the sender's word. */
        if (now - (me.eT || 0) > EDIT_WIN) { me.eT = now; me.eN = 0; }   // roll the window: case 20/22 does, and copying only the check meant the bucket never refilled
        const px = m[1] | 0, pz = m[2] | 0, own = String(m[4] || '').slice(0, 40);
        if (Math.abs(px - me.x) > 12 || Math.abs(pz - me.z) > 12 || !own) return;   // you can only pick up what you can reach
        const led = this.piles && this.piles.get(px + ':' + pz + ':' + own);
        if (!led) return;   // the room never announced a pile there: nothing exists to retract
        const rows = [];
        for (const it of (Array.isArray(m[3]) ? m[3].slice(0, 12) : [])) {
          const id = String((it && it[0]) || '').slice(0, 32);
          const have = led.rows.get(id) || 0;
   // the room, not the sender, says how much is on that tile — the same rule op 12 now applies through me.own
          const n = Math.min(have, Math.max(0, (it && it[1] | 0) || 0));
          if (id && n > 0) { rows.push([id, n]); led.rows.set(id, have - n); }
        }
        if (!rows.length) return;
        if ((me.eN || 0) >= EDIT_RATE) return;   // check, then spend, and only once the claim is known good
        me.eN = (me.eN || 0) + 1;
        me.pSeq = (me.pSeq || 0) + 1;   // one tile's claims chunk into several messages in one batch; pending is last-write-wins
        this.queue('16:' + me.pid + ':' + now + ':' + me.pSeq, [16, me.pid, px, pz, rows, own]);
        break;
      }

      case 4: {   // chat
        const text = String(m[1] ?? '').slice(0, 120);
        if (text) this.queue('4:' + me.pid + ':' + now, [4, me.pid, text]);
        break;
      }

      case 8: {   // save blob
   /* The seed is the connection's, never the message's. It used to be read
           straight off the wire, and a client that rotated it turned every save into
           an INSERT of a fresh row — four billed rows apiece, storage that nothing
           ever reclaims, and the month's whole write allowance inside six hours.
           The socket already knows which world it joined. Element 1 is still read
           past for the payload, so the shape [8, seed, blob] is unchanged. */
        const seed = me.seed || 'lumbridge';
        const payload = typeof m[1] === 'string' ? m[2] : m[1];
        let blob;
        try { blob = JSON.stringify(payload); } catch { return; }
        if (!blob || blob.length > MAXSAVE) {
          try { ws.send(JSON.stringify([[7, 'blob over ' + MAXSAVE + ' bytes']])); } catch {}
          return;
        }
        if (!this.env.DB) {
          try { ws.send(JSON.stringify([[7, 'no D1 binding on the durable object']])); } catch {}
          return;
        }
   /* A save budget that never loses a save. An honest client can legitimately
           produce two inside the window — it saves, then the tab is hidden a second
           later and the unload path skips its own gap — so an early blob is held
           rather than dropped, and the newest one lands when the window is up. The
           ack is deferred with it, so the client's watchdog still measures a real
           round trip. */
        if (now - (me.saveT || 0) < SAVE_MIN) {
          me.saveQ = { blob, payload, seed };
          if (!me.saveW) {
            me.saveW = 1;
            const wait = SAVE_MIN - (now - (me.saveT || 0));
            this.ctx.waitUntil(new Promise(r => setTimeout(r, wait)).then(() => {
              me.saveW = 0;
              const q = me.saveQ; me.saveQ = null;
              if (q && this.players.get(me.pid) === me) return this.writeSave(ws, me, q.seed, q.blob, q.payload);
            }));
          }
          return;
        }
        await this.writeSave(ws, me, seed, blob, payload);
        return;   // no attachment change
      }

      case 23: {   // house claimed, edited or demolished: [23, houseObj | 0]
        const h = m[1];
        await this.loadHouses(me.seed);
        if (!h) { this.houses.delete(me.pid); }
        else {
          if (!Number.isInteger(h.x) || !Number.isInteger(h.z) || Math.abs(h.x) > 1e6 || Math.abs(h.z) > 1e6 || !Array.isArray(h.rm)) return;
          let d; try { d = JSON.stringify(h); } catch { return; }
   /* a refusal must never be silent: the owner keeps seeing their own copy and would never learn the world holds a stale one */
          if (d.length > 4000 || h.rm.length > 12) { try { ws.send(JSON.stringify([[24, d.length]])); } catch {} return; }
          this.houses.set(me.pid, { x: h.x, z: h.z, d: h });
        }
        this.hDirty.add(me.pid);
        this.flushHouses();
        this.queue('23:' + me.pid, [23, me.pid, h || 0]);
        break;
      }

      case 9:   // clock ping
        ws.send(JSON.stringify([[9, m[1], Date.now()]]));
        return;

      default:
        return;
    }
  }

  /* The one D1 write on the hot path, so every clause here is a line on the bill.
     `characters` carries no secondary index and nothing in this SET list is
     indexed, so the statement costs exactly one row.

     `updated` moves on EVERY save, even one whose blob is byte-identical. There
     used to be a `WHERE characters.save <> excluded.save` predicate here making
     an unchanged blob free, and it had to go: `updated` is now the liveness
     signal the archive sweep reads, and a player standing still with full
     hitpoints produces an identical blob for minutes at a time. Under the old
     predicate that player's timestamp would freeze and the sweep would archive
     them mid-session. The predicate was worth a few percent of saves; being
     wrong about who is online is worth rather more.

     A save also restores an archived character implicitly: the row may have been
     deleted by the sweep, in which case this INSERTs it back. */
  async writeSave(ws, me, seed, blob, payload) {
    const now = Date.now();
    me.saveT = now;
    try {
      const s = summarise(payload);
      me.own = carried(payload);   // the pile ceiling moves with the character, not with what a dying client asks for
   // an upsert of one row by primary key, so a retry is free of consequence
      const put = this.env.DB.prepare(
        'INSERT INTO characters (pid, seed, save, combat, total_level, created, updated) VALUES (?,?,?,?,?,?,?) ' +
        'ON CONFLICT(pid, seed) DO UPDATE SET save=excluded.save, combat=excluded.combat, ' +
        'total_level=excluded.total_level, updated=excluded.updated'
      ).bind(me.pid, seed, blob, s.combat, s.totalLevel, now, now);
      for (let a = 0; ; a++) {
        try { await put.run(); break; }
        catch (e) { if (a >= 2 || SAVE_PERM.test(String(e))) throw e; await new Promise(r => setTimeout(r, 150 * (a + 1))); }
      }
   // Remember the last world played so login can preselect it — but only
   // when it actually changes. Writing it on every flush doubled the D1
   // cost of a save for a column that changes once a session.
   /* Its own try, and after the character row is already safe: this is a preference column, and a failure here used
         to disarm the session over which world to preselect at login. savedSeed moves first, so a broken column costs
         one statement a session rather than one per save. */
      if (me.savedSeed !== seed) {
        me.savedSeed = seed;
        try {
          await this.env.DB.prepare('UPDATE players SET seed=?, updated=? WHERE pid=?').bind(seed, now, me.pid).run();
          this.saveAtt(ws, me);
        } catch (e) { console.log('seed note failed', me.pid, String(e).slice(0, 80)); }
      }
   // confirm the write, so a client can tell "saved" from "swallowed"
      try { ws.send(JSON.stringify([[10, seed, blob.length]])); } catch {}
    } catch (e) {
   // Silence here is how a missing table costs somebody their session.
      const msg = String(e);
      console.log('save failed', me.pid, msg);
      try {
        ws.send(JSON.stringify(SAVE_PERM.test(msg)
          ? [[7, /no such table/i.test(msg)
              ? 'the characters table does not exist — run the schema in sql/schema.sql' : msg.slice(0, 120)]]
          : [[25, msg.slice(0, 120)]]));   // op 25: keep the blob and come back — the session stays armed
      } catch {}
    }
  }

  /* One-shot timer only, never a repeating alarm. A repeating alarm keeps the
     object awake forever and blocks hibernation, which is where the bill is. */
  pruneWorld(force) {
    const t = Date.now();
    if (!force && t - (this.lastPrune || 0) < 5000) return;   // entries self-expire; a sweep every few seconds is plenty
    this.lastPrune = t;
    const gt = wTick();
    for (const [k, d] of this.depleted) if (d <= gt) this.depleted.delete(k);
    for (const [k, d] of this.monDead) if (d <= gt) this.monDead.delete(k);
   // a runaway client cannot grow these without bound: oldest entries fall off
    while (this.depleted.size > 800) this.depleted.delete(this.depleted.keys().next().value);
    while (this.monDead.size > 800) this.monDead.delete(this.monDead.keys().next().value);
  }

  /* One SELECT per object lifetime; the table self-creates the first time a
     world ever sees a house. Rows hold the client's compact JSON. */
  async loadHouses(seed) {
    if (this.houses) return;
    this.houses = new Map();
    this.housesSeed = seed;
    if (!this.env.DB) return;
    try {
   // seed leads the primary key, so this is a range walk on it and needs no second index
   // bounded: a busy seed's whole history was read on every join, and a house nobody has touched in a week is gone anyway
      const cut = Date.now() - HOUSE_TTL;
      const q = () => this.env.DB.prepare('SELECT pid, data FROM houses WHERE seed=? AND updated>? ORDER BY updated DESC LIMIT 400').bind(seed, cut).all();
      let rows;
      try { rows = await q(); } catch (e) {
        if (!/no such table/i.test(String(e))) throw e;
        await this.env.DB.prepare(DDL.houses).run().catch(() => {});
        rows = await q();
      }
      for (const r of (rows.results || [])) {
        try { const h = JSON.parse(r.data); this.houses.set(r.pid, { x: h.x | 0, z: h.z | 0, d: h }); } catch {}
      }
    } catch (e) { console.log('loadHouses failed', String(e).slice(0, 120)); }
  }

  /* Dirty pids drain to D1 in one burst, at most every 10 s; force on a
     player's disconnect so a finished build session cannot be lost to
     hibernation. Fire-and-forget: a miss costs a house edit, not a session. */
  flushHouses(force) {
    if (!this.hDirty.size || !this.env.DB || !this.houses) return;
    const t = Date.now();
    if (!force && t - this.hFlushT < 10000) return;
    this.hFlushT = t;
    const dirty = [...this.hDirty]; this.hDirty.clear();
   /* One batch, not a round trip per pid: a build session that touched three
       houses used to be three sequential awaits inside waitUntil. The statements
       are independent, so ordering does not matter and a batch is one subrequest. */
    const stmts = [];
    for (const pid of dirty) {
      const h = this.houses.get(pid);
      stmts.push(h
        ? this.env.DB.prepare('INSERT INTO houses (seed, pid, x, z, data, updated) VALUES (?,?,?,?,?,?) ON CONFLICT(seed, pid) DO UPDATE SET x=excluded.x, z=excluded.z, data=excluded.data, updated=excluded.updated')
            .bind(this.housesSeed, pid, h.x, h.z, JSON.stringify(h.d), t)
        : this.env.DB.prepare('DELETE FROM houses WHERE seed=? AND pid=?').bind(this.housesSeed, pid));
    }
    if (!stmts.length) return;
    this.ctx.waitUntil((async () => {
      try { await this.env.DB.batch(stmts); } catch (e) {
        if (/no such table/i.test(String(e))) {
          await this.env.DB.prepare(DDL.houses).run().catch(() => {});
          await this.env.DB.batch(stmts).catch(e2 => console.log('house write failed', String(e2).slice(0, 120)));
        } else console.log('house write failed', String(e).slice(0, 120));
      }
    })());
  }

  queue(key, msg) {
    this.pending.set(key, msg);
    if (!this.timer) this.timer = setTimeout(() => this.flush(), FLUSH_MS);
  }

  flush() {
    this.timer = null;
    const msgs = [...this.pending.values()];
    this.pending.clear();

   /* Interest management on a VIEW-sized grid: anyone within the view radius of p
       sits in p's 3x3 cell neighbourhood, so each player scans local density, not
       the whole room. Leaves (and reaping the departed) fall out of the seen set. */
    const grid = new Map();
    for (const q of this.players.values()) {
      const c = Math.floor(q.x / VIEW) + ':' + Math.floor(q.z / VIEW);
      const a = grid.get(c); if (a) a.push(q); else grid.set(c, [q]);
    }

    for (const p of this.players.values()) {
      const out = [];

      for (const pid of p.seen) {
        const q = this.players.get(pid);
   // leave six tiles past the entry radius: an op 5 tears the rig down, so a
   // player pacing the boundary used to pop out and back in every other flush
        if (!q || Math.abs(q.x - p.x) > LEAVE || Math.abs(q.z - p.z) > LEAVE) { p.seen.delete(pid); out.push([5, pid]); }
      }

      const bx = Math.floor(p.x / VIEW), bz = Math.floor(p.z / VIEW);
      for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
        const cell = grid.get((bx + a) + ':' + (bz + b));
        if (!cell) continue;
        for (const q of cell) {
          if (q.pid === p.pid || p.seen.has(q.pid) || !q.pos) continue;   // an unreported position is not a location to announce
          if (Math.abs(q.x - p.x) <= VIEW && Math.abs(q.z - p.z) <= VIEW) {
            p.seen.add(q.pid);
            out.push([6, q.pid, q.name, q.x, q.z, q.eq]);
          }
        }
      }

      for (const m of msgs) {
   /* A death spills loot and teleports the corpse away in the same breath.
           Judging that message by whether the dead player is still visible
           loses it exactly when it matters, so ground items are delivered by
           where they fell rather than by who dropped them. */
        if (m[0] === 12) {
          const dx = m[2] | 0, dz = m[3] | 0;
          if (m[1] !== p.pid && Math.abs(dx - p.x) <= VIEW && Math.abs(dz - p.z) <= VIEW) out.push(m);
          continue;
        }
   // op 16 is a retraction: it must reach everyone still holding a mirror, including the victim the pile belongs to,
   // who die() has already teleported to town and out of any proximity window
        if (m[0] === 16) { if (m[1] !== p.pid) out.push(m); continue; }
   /* World state is room-wide: a stump matters to whoever walks up next,
           seen-set or not. Live monster frames only matter near the fight. */
        if (m[0] === 20 || m[0] === 22) {
          if (m[3] !== p.pid) out.push(m);
          continue;
        }
        if (m[0] === 23) {   // houses are landscape: everyone in the room hears of one
          if (m[1] !== p.pid) out.push(m);
          continue;
        }
        if (m[0] === 21) {
          if (m[8] !== p.pid &&
              Math.abs((m[2] | 0) - p.x) <= VIEW * 2 && Math.abs((m[3] | 0) - p.z) <= VIEW * 2) out.push(m);
          continue;
        }
        const owner = m[0] === 1 ? m[1][0][0] : m[1];
        if (owner !== p.pid && p.seen.has(owner)) out.push(m);
      }

      if (out.length) { try { p.ws.send(JSON.stringify(out)); } catch {} }
    }
  }

  webSocketClose(ws) { this.drop(ws); }
  webSocketError(ws) { this.drop(ws); }

  drop(ws) {
    const a = ws.deserializeAttachment();
    if (!a) return;
   /* A reconnect replaces the record and closes the old socket, and that
       close lands here later wearing the same pid. Deleting by pid alone
       would evict the live connection — the room then ignores everything it
       sends, saves included. Only the socket that owns the record removes it. */
    const cur = this.players.get(a.pid);
    if (!cur || cur.ws !== ws) return;
    this.players.delete(a.pid);
   /* A save held back by SAVE_MIN is the newest thing this player owns; letting the close throw it away lost the whole
       window's play. The parked waiter finds a null saveQ and does nothing, so this cannot double-write. */
    const q = cur.saveQ;
    if (q) { cur.saveQ = null; cur.saveW = 0; this.ctx.waitUntil(this.writeSave(ws, cur, q.seed, q.blob, q.payload)); }
   // the budgets outlive the socket, or a reconnect is a way to buy a fresh one
    const bt = Date.now();
    this.budget.set(a.pid, { t: bt, mvT: cur.mvT || 0, mvB: cur.mvB || 0, wT: cur.wT || 0, wN: cur.wN | 0,
                             own: cur.own || null, saveT: cur.saveT || 0, pileT: cur.pileT || 0 });
    if (this.budget.size > 4000) for (const [k, v] of this.budget) if (bt - v.t > 600000) this.budget.delete(k);
   /* the leaver's house folds with them: houses stand only while their owner walks the world.
       Their record leaves memory and D1 too — the character blob is the one true copy, and the
       client re-announces it on every join. A row surviving an evicted object without this close
       is filtered from snapshots by the connected-pids check above. */
   /* A close can land on a wake where the map was never loaded, and dropping it there orphaned the row for good —
       an empty house standing in everyone's world with no owner to fold it. */
    if (this.houses) { if (this.houses.delete(a.pid)) this.hDirty.add(a.pid); }
    else if (this.env.DB && a.seed) this.ctx.waitUntil(this.loadHouses(a.seed).then(() => {
      if (this.houses.delete(a.pid)) { this.hDirty.add(a.pid); this.flushHouses(1); }
    }).catch(() => {}));
    this.flushHouses(1);   // a leaver's pending house edits (now including the fold) go to disk
    this.queue('23:' + a.pid, [23, a.pid, 0]);
    for (const p of this.players.values()) {
      if (p.seen.delete(a.pid)) {
        try { p.ws.send(JSON.stringify([[5, a.pid]])); } catch {}
      }
    }
  }
}

/* ======================== THE GRAND EXCHANGE ============================= */
/* One Durable Object for every world: the order book is global, so a seller
   on one seed meets a buyer on another, and a sale completes with the seller
   asleep three worlds away. The book lives in D1 and survives hibernation;
   the object holds nothing worth keeping — it exists to be the till. Every
   request funnels through one instance and queues on one lock, so two
   crossing offers can never both spend the same coins.

   The matching rule is the 2007 exchange's: a new offer sweeps the book
   best-price-first, each trade striking at the *resting* offer's price. A
   buy above the ask pays the ask and banks the difference for collection; a
   sell below the bid is paid the bid. Escrow is taken by the client when the
   offer is placed, so completion needs nobody online: proceeds sit in the
   offer's collection box until their owner comes back for them, and only an
   emptied, finished offer frees its slot. */

const GE_SLOTS = 8;
const GE_MAXQ = 100000;   // per offer; arrows are the volume case
const GE_MAXP = 1000000000;   // coins per item
const GE_MAXV = 2147483647;   // and the whole offer: price x qty alone reached 1e14, which the fill path pays out as real coins

export class Exchange extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.lock = Promise.resolve();
    this.tables = null;   // the ensure() promise, memoised — see below
    this.buckets = new Map();   // pid -> {t, n} token bucket on mutations
    this.recent = new Map();    // memo key -> [when, reply]: a retry of a lost reply is answered, not re-run
  }
  /* Every mutation in the game queues on one promise chain in one object, so an
     unthrottled client could hold the world's order book to itself. This runs
     BEFORE serial() and before any INSERT, which matters: the client refunds its
     escrow when a place is refused, so a limiter that fired after the row existed
     would duplicate rather than protect. */
  allow(pid) {
    const t = Date.now(), b = this.buckets.get(pid);
    if (!b) { this.buckets.set(pid, { t, n: 1 }); return 1; }
   // one token back every GE_MIN, capped at GE_BURST in hand
    const gained = Math.floor((t - b.t) / GE_MIN);
    if (gained) { b.n = Math.max(0, b.n - gained); b.t += gained * GE_MIN; }
    if (b.n >= GE_BURST) return 0;
    b.n++;
    if (this.buckets.size > 4000) for (const [k, v] of this.buckets) { if (t - v.t > 600000) this.buckets.delete(k); }
    return 1;
  }
  /* D1 calls are subrequests, not DO storage, so the platform's input gate
     does not serialise them — this chain does. Handlers run strictly in turn. */
  serial(fn) {
    const p = this.lock.then(fn, fn);
    this.lock = p.then(() => {}, () => {});
    return p;
  }
  /* The table makes itself on first use: no migration to run, nothing to
     forget. The index is what the matching query lives on. */
  ensure() {
   /* Memoise the PROMISE, not a flag set after the awaits — every request that
       landed inside the cold-start window used to re-run both statements. And
       clear it on rejection, or one transient failure poisons the object for the
       rest of its life. */
    if (!this.tables) {
      this.tables = this.env.DB.batch([
        this.env.DB.prepare(DDL.geOffers), this.env.DB.prepare(DDL.geBook)
      ]).catch(e => { this.tables = null; throw e; });
    }
    return this.tables;
  }
  row(pid, slot) {
    return this.env.DB.prepare('SELECT * FROM ge_offers WHERE pid=? AND slot=?')
      .bind(pid, slot).first();
  }
  /* A debit commits before the reply is built, so a dropped response is indistinguishable from a refusal — and the
     retry meets a row that is already empty, or deleted. The reply is memoised against the client's token instead:
     a repeat is answered, not re-run. Object memory, not D1, because the window this closes is one round trip. */
  replay(k) { const h = this.recent.get(k); return h ? h[1] : null; }
  remember(k, r) {
    this.recent.set(k, [Date.now(), r]);
   // a hard cap, not a trigger: above a couple of mutations a second the age test alone freed nothing and rescanned every call.
   // Map iterates in insertion order, so the oldest are a prefix.
    if (this.recent.size > 512) {
      const cut = Date.now() - 300000;
      for (const [kk, v] of this.recent) { if (v[0] >= cut && this.recent.size <= 512) break; this.recent.delete(kk); }
    }
    return r;
  }
  async fetch(req) {
    const u = new URL(req.url);
    const pid = u.searchParams.get('pid') || '';
    if (!pid) return Response.json({ e: 'no pid' }, { status: 400 });
   /* The 10-second poll from every open GE panel is a plain read: serving it
       outside the lock means the whole world's polls no longer queue behind
       one player's fills. A read racing a fill sees the book a beat stale,
       which the next poll corrects. Mutations still run strictly in turn. */
    if (u.pathname === '/ge') {
      try { await this.ensure(); return Response.json(await this.state(pid)); }
      catch (e) { console.log('ge error', String(e)); return Response.json({ e: 'exchange error' }, { status: 500 }); }
    }
   /* The body is read here, once, because the memo has to be consulted BEFORE the limiter: a retry of a request whose
       reply was lost is not new work, and answering it 429 is exactly how the collected goods went missing — the box was
       already empty and collect() was never entered to say so. */
    let b = {};
    if (req.method === 'POST') { try { b = await req.json(); } catch {} }
    const tok = String(b.tok || '').slice(0, 48);
    const pre = u.pathname === '/ge/place' ? 'p:' : u.pathname === '/ge/collect' ? 'c:' : '';
    const memoKey = tok && pre ? pre + pid + ':' + tok : '';
    if (memoKey) { const was = this.replay(memoKey); if (was) return Response.json(was); }
   // the bucket is spent before the lock is taken and before anything is inserted
    if (!this.allow(pid)) return Response.json({ e: 'too many exchange requests' }, { status: 429 });
    return this.serial(async () => {
      try {
        await this.ensure();
        if (u.pathname === '/ge/place') return Response.json(await this.place(pid, b));
        if (u.pathname === '/ge/abort') return Response.json(await this.abort(pid, b));
        if (u.pathname === '/ge/collect') return Response.json(await this.collect(pid, b));
        return Response.json({ e: 'no such path' }, { status: 404 });
      } catch (e) {
        console.log('ge error', String(e));
        return Response.json({ e: 'exchange error' }, { status: 500 });
      }
    });
  }
  async state(pid) {
    const r = await this.env.DB.prepare('SELECT * FROM ge_offers WHERE pid=?').bind(pid).all();
    const slots = new Array(GE_SLOTS).fill(null);
    for (const o of (r.results || [])) if (o.slot >= 0 && o.slot < GE_SLOTS) slots[o.slot] = o;
    return { slots };
  }
  async place(pid, b) {
    const tok = String(b.tok || '').slice(0, 48), key = tok && 'p:' + pid + ':' + tok;
    if (key) { const was = this.replay(key); if (was) return was; }   // a lost reply must not look like "slot in use"
    const slot = b.slot | 0, kind = b.kind | 0;
    const item = String(b.item || '');
    const price = Math.floor(+b.price || 0), qty = Math.floor(+b.qty || 0);
    if (slot < 0 || slot >= GE_SLOTS) return { e: 'bad slot' };
    if (kind !== 0 && kind !== 1) return { e: 'bad kind' };
    if (!/^[a-z0-9_]{1,32}$/.test(item) || item === 'coins') return { e: 'bad item' };
    if (!(price >= 1 && price <= GE_MAXP)) return { e: 'bad price' };
    if (price * qty > GE_MAXV) return { e: 'offer too large' };
    if (!(qty >= 1 && qty <= GE_MAXQ)) return { e: 'bad quantity' };
    if (await this.row(pid, slot)) return { e: 'slot in use' };
    const now = Date.now();
    await this.env.DB.prepare(
      'INSERT INTO ge_offers (pid, slot, kind, item, price, qty, filled, coins_box, items_box, state, created, updated) ' +
      'VALUES (?,?,?,?,?,?,0,0,0,0,?,?)').bind(pid, slot, kind, item, price, qty, now, now).run();

   /* One page of candidates in one query, matches bounded per request: a large
       order against a fragmented book fills against up to twenty resting offers
       now and meets the rest of the book on later placements, instead of holding
       the global lock for a round-trip per row. */
   /* `created` is deliberately absent from the ORDER BY. It is not in the index,
       so asking for it materialised every row at the marginal price into a temp
       b-tree before the LIMIT could apply. Within an index prefix SQLite walks in
       rowid order, and rowid is assigned at INSERT under this same lock, so the
       result is the same first-in-first-out the column was there to express — and
       strictly better, since two placements in one millisecond had no defined
       order before. `state` is gone from the WHERE because the index is now
       partial on state = 0: it holds only live offers, so finished ones are never
       walked at all. */
    let remaining = qty, mineFilled = 0;
    const page = await this.env.DB.prepare(kind === 0
      ? 'SELECT * FROM ge_offers WHERE item=? AND kind=1 AND state=0 AND price<=? AND pid<>? ORDER BY price ASC LIMIT 20'
      : 'SELECT * FROM ge_offers WHERE item=? AND kind=0 AND state=0 AND price>=? AND pid<>? ORDER BY price DESC LIMIT 20'
    ).bind(item, price, pid).all();

   /* Two statements, chosen so a fill that does not finish an offer never names
       `state` — which is what keeps it out of the partial index and off the bill.
       And the placer's own row is accumulated and written ONCE at the end: the old
       loop rewrote it on every iteration, nineteen of them immediately superseded,
       and awaited a round trip for each while holding the world's only lock. */
    const updLive = 'UPDATE ge_offers SET filled=filled+?, coins_box=coins_box+?, items_box=items_box+?, updated=? WHERE pid=? AND slot=?';
    const updDone = 'UPDATE ge_offers SET filled=filled+?, coins_box=coins_box+?, items_box=items_box+?, state=1, updated=? WHERE pid=? AND slot=?';
    const stmts = [];
    let myCoins = 0, myItems = 0;
    for (const c of (page.results || [])) {
      if (remaining <= 0) break;
      const t = Math.min(remaining, c.qty - c.filled);
      if (t <= 0) continue;   // a corrupt row must not spin forever
      const tp = c.price;   // the resting offer sets the price
      const done = c.filled + t >= c.qty;
      stmts.push(this.env.DB.prepare(done ? updDone : updLive).bind(
        t, kind === 0 ? t * tp : 0, kind === 0 ? 0 : t, now, c.pid, c.slot));   // seller paid the ask, or buyer's offer receives goods
      mineFilled += t;
      if (kind === 0) { myCoins += t * (price - tp); myItems += t; }   // buyer gets goods and the change
      else myCoins += t * tp;   // seller is paid the bid
      remaining -= t;
    }
    if (mineFilled) {
      stmts.push(this.env.DB.prepare(mineFilled >= qty ? updDone : updLive)
        .bind(mineFilled, myCoins, myItems, now, pid, slot));
   // one transaction over the whole sweep: every trade lands, or none of them does
      await this.env.DB.batch(stmts);
    }
    const done = { offer: await this.row(pid, slot) };
    return key ? this.remember(key, done) : done;
  }
  async abort(pid, b) {
    const o = await this.row(pid, b.slot | 0);
    if (!o) return { e: 'no offer' };
    if (o.state !== 0) return { offer: o };   // already finished: nothing to abort
   // the unfilled escrow comes back through the collection box, as it did in 2007
    const backC = o.kind === 0 ? (o.qty - o.filled) * o.price : 0;
    const backI = o.kind === 1 ? (o.qty - o.filled) : 0;
   // RETURNING folds the read-back into the write: one round trip, not two
    const offer = await this.env.DB.prepare(
      'UPDATE ge_offers SET state=1, coins_box=coins_box+?, items_box=items_box+?, updated=? WHERE pid=? AND slot=? RETURNING *'
    ).bind(backC, backI, Date.now(), o.pid, o.slot).first();
    return { offer };
  }
  async collect(pid, b) {
    const tok = String(b.tok || '').slice(0, 48), key = tok && 'c:' + pid + ':' + tok;
    if (key) { const was = this.replay(key); if (was) return was; }
    const o = await this.row(pid, b.slot | 0);
    if (!o) return { e: 'no offer' };
   /* The client asks for what its pack can hold; the box keeps the rest.
       Clamped here, so a hopeful request can never mint anything. The clamp stays
       a read rather than moving into the WHERE: as a predicate an over-ask would
       match nothing and come back "no offer", where today it collects what is
       actually there, which is the behaviour the client is written against. */
    const tc = Math.max(0, Math.min(Math.floor(+b.coins || 0), o.coins_box));
    const ti = Math.max(0, Math.min(Math.floor(+b.items || 0), o.items_box));
    const left = await this.env.DB.prepare(
      'UPDATE ge_offers SET coins_box=coins_box-?, items_box=items_box-?, updated=? WHERE pid=? AND slot=? RETURNING *'
    ).bind(tc, ti, Date.now(), o.pid, o.slot).first();
    if (left && left.state === 1 && left.coins_box === 0 && left.items_box === 0) {
      await this.env.DB.prepare('DELETE FROM ge_offers WHERE pid=? AND slot=?').bind(o.pid, o.slot).run();
      return key ? this.remember(key, { coins: tc, items: ti, item: o.item, offer: null }) : { coins: tc, items: ti, item: o.item, offer: null };
    }
    const out = { coins: tc, items: ti, item: o.item, offer: left };
    return key ? this.remember(key, out) : out;
  }
}

/* ============================ THE WORKER ================================= */

function cors(origin) {
  return {
    'access-control-allow-origin': origin || '*',
    'access-control-allow-methods': 'GET,POST,OPTIONS',
    'access-control-allow-headers': 'authorization,content-type',
    'access-control-max-age': '86400'
  };
}

const json = (body, status, origin) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json', ...cors(origin) }
});

/* Resolve an auth token to an account row. Every authed route needs this
   and every one of them wants the same 401 on failure. */
/* The key is the whole credential, so it belongs in a header rather than on the query string, where Cloudflare's own
   request logs, wrangler tail, Logpush, browser history and any Referer all keep a copy. The query form is still read
   so a client and a worker can be deployed in either order. */
const bearer = req => (req.headers.get('Authorization') || '').replace(/^Bearer /i, '');
async function whoami(env, auth) {
  if (!/^[0-9a-f]{64}$/.test(auth || '')) return { e: 'bad auth', code: 400 };
  let row;
  try {
    row = await env.DB.prepare('SELECT pid, name, seed FROM players WHERE auth_hash=?')
      .bind(await sha256('v1|' + auth)).first();
  } catch (e) { console.log('db error', String(e)); return { e: 'db error', code: 500 }; }
  if (!row) return { e: 'unknown key', code: 401 };
  return { row };
}

/* The same thing, plus the one query that needed the pid it resolved — in ONE trip to D1.
   Every authed route is shaped "resolve the key, then read something belonging to that account", and sent as two
   statements that is two waits stacked end to end. Login pays for three of them before the world appears, which is
   what a player feels. Naming the account in a subquery makes the second statement stand on its own, so the pair
   rides one batch and the second wait disappears.

   `sql` binds the auth hash first and whatever `tail` adds after it. A batch is all-or-nothing, so a failure here
   returns `retry` rather than an error: the caller falls back to its own serial path, which is the one that can
   tell a missing table from a broken database. */
async function authQuery(env, auth, sql, tail) {
  if (!/^[0-9a-f]{64}$/.test(auth || '')) return { e: 'bad auth', code: 400 };
  try {
    const h = await sha256('v1|' + auth);
    const r = await env.DB.batch([
      env.DB.prepare('SELECT pid, name, seed FROM players WHERE auth_hash=?').bind(h),
      env.DB.prepare(sql).bind(h, ...(tail || []))
    ]);
    const row = (r[0].results || [])[0];
    return row ? { row, rows: r[1].results || [] } : { e: 'unknown key', code: 401 };
  } catch (e) { return { retry: String(e).slice(0, 120) }; }
}
const SUB_PID = '(SELECT pid FROM players WHERE auth_hash=?)';

async function population(env, u, origin, ctx) {
  const seed = cleanSeed(u.searchParams.get('seed'));
  /* Every open world-select screen polls this; without a cache each poll
     instantiates the seed's Durable Object. Eight seconds of staleness on a
     head-count costs nothing and absorbs the whole crowd into one request. */
  const ck = new Request('https://population.cache/?seed=' + encodeURIComponent(seed));
  try {
    const hit = await caches.default.match(ck);
    if (hit) return json(await hit.json(), 200, origin);
  } catch {}
  let body;
  try {
    const stub = env.WORLD.get(env.WORLD.idFromName('world:' + seed));
    const r = await stub.fetch(new Request('https://do/count'));
    const j = await r.json();
    body = { seed, n: j.n | 0, build: BUILD };
  } catch {
   // an empty world has never been instantiated; that is not an error
    body = { seed, n: 0, build: BUILD };
  }
  /* The miss is cached too. The seed comes straight off the query string, so
     without this a stream of invented seeds misses every time and each miss
     spins up a fresh Durable Object — an unauthenticated way to bill the
     account, from a route that needs no account at all. And the write goes
     through waitUntil so it is not in the reader's latency. */
  const put = caches.default.put(ck, new Response(JSON.stringify(body),
    { headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=8' } })).catch(() => {});
  if (ctx && ctx.waitUntil) ctx.waitUntil(put); else await put;
  return json(body, 200, origin);
}
async function characters(env, u, origin, tok) {
  const auth = tok || u.searchParams.get('auth') || '';

  /* combat and total_level are written as columns at save time, so this selects
     three small values instead of parsing forty 8 KB blobs. The blob is never
     read here. ORDER BY updated has no index behind it deliberately — indexing a
     column that changes on every save would double the cost of every save to
     spare a sort over at most forty rows, which is the wrong trade by three
     orders of magnitude.

     It rides the account lookup's own batch: this is the request the login screen
     waits on before it can even name you, so it is worth one round trip, not two. */
  const CHARS = 'SELECT seed, updated, combat, total_level FROM characters WHERE pid=' + SUB_PID +
                ' ORDER BY updated DESC LIMIT 40';
  const a = await authQuery(env, auth, CHARS);
  let row, chars;
  if (a.retry) {   // the batch died as a unit; sort out which half by hand, the way this route always did
    const who = await whoami(env, auth);
    if (who.e) return json({ e: who.e }, who.code, origin);
    row = who.row;
    try { chars = (await env.DB.prepare(CHARS.replace(SUB_PID, '?')).bind(row.pid).all())?.results || []; }
    catch {
   // no table yet: an account with no characters, not a server fault
      return json({ pid: row.pid, name: row.name, last: row.seed, characters: [], build: BUILD }, 200, origin);
    }
  } else {
    if (a.e) return json({ e: a.e }, a.code, origin);
    row = a.row; chars = a.rows;
  }
  const bySeed = new Map();
  for (const r of chars)
    bySeed.set(r.seed, { seed: r.seed, updated: r.updated, combat: r.combat, totalLevel: r.total_level });

  /* The archived ones. Without this the world-select screen would show nothing
     for anybody who has been away longer than the sweep interval — their rows are
     gone from D1 and the character would look deleted. The R2 key is keyed by
     player first precisely so this is one prefix list rather than a lookup per
     seed, and the summary rides customMetadata so no blob has to be fetched or
     parsed to draw the list. A live row always wins: it is the newer copy. */
  if (env.ARCHIVE) {
    try {
      const ls = await env.ARCHIVE.list({ prefix: 'char/' + row.pid + '/', limit: 200 });
      for (const o of (ls.objects || [])) {
        const seed = o.key.slice(('char/' + row.pid + '/').length).replace(/\.json$/, '');
        if (!seed || bySeed.has(seed)) continue;
        const m = o.customMetadata || {};
        bySeed.set(seed, { seed, updated: +m.updated || +new Date(o.uploaded) || 0,
                           combat: +m.combat || 3, totalLevel: +m.totalLevel || 32, archived: 1 });
      }
    } catch (e) { console.log('archive list failed', row.pid, String(e).slice(0, 120)); }
  }
  const list = [...bySeed.values()].sort((a, b) => b.updated - a.updated).slice(0, 40);
  return json({ pid: row.pid, name: row.name, last: row.seed, characters: list, build: BUILD }, 200, origin);
}

/* ---------------------------- THE SWEEP ----------------------------------
   A Workers cron trigger, not a Durable Object alarm: it runs, does its work and
   stops, so it never keeps a room awake — the thing this file's header goes out
   of its way to avoid.

   The delete carries `AND updated = ?`. That is the whole concurrency story: if
   the player saved between the SELECT and the DELETE their timestamp moved, the
   predicate matches nothing, and the live row survives with the R2 copy merely a
   beat stale — which the next sweep corrects. Without it there is a window where
   a save lands and is then deleted. */
async function sweepArchive(env, limit) {
  if (!env.ARCHIVE || !env.DB) return { skipped: 'no archive binding' };
  const cutoff = Date.now() - ARCH_IDLE;
  let rows;
  try {
    rows = await env.DB.prepare(
      'SELECT pid, seed, save, combat, total_level, created, updated FROM characters ' +
      'WHERE updated < ? ORDER BY updated ASC LIMIT ?'
    ).bind(cutoff, limit || ARCH_BATCH).all();
  } catch (e) { console.log('sweep select failed', String(e).slice(0, 120)); return { e: 'select' }; }

  const found = rows?.results || [];
  if (!found.length) return { archived: 0, scanned: 0 };

  const done = [];
  for (const r of found) {
    if (!r.save) { done.push(r); continue; }   // nothing to keep; just let the delete take it
    try {
      await env.ARCHIVE.put(archKey(r.pid, r.seed), r.save, {
        httpMetadata: { contentType: 'application/json' },
        customMetadata: { combat: String(r.combat | 0), totalLevel: String(r.total_level | 0),
                          created: String(r.created | 0), updated: String(r.updated | 0) }
      });
      done.push(r);
    } catch (e) { console.log('archive put failed', r.pid, r.seed, String(e).slice(0, 120)); }
  }
  if (!done.length) return { archived: 0, scanned: found.length };

  // one batch, and each delete is guarded by the timestamp it was read at
  try {
    await env.DB.batch(done.map(r => env.DB.prepare(
      'DELETE FROM characters WHERE pid=? AND seed=? AND updated=?'
    ).bind(r.pid, r.seed, r.updated)));
  } catch (e) { console.log('sweep delete failed', String(e).slice(0, 120)); return { e: 'delete' }; }
  return { archived: done.length, scanned: found.length };
}

export default {
  /* The cron trigger. Keeps sweeping while it is still filling batches, so a
     backlog after a quiet deploy drains in one tick rather than over hours, but
     stops the moment a batch comes back short. */
  async scheduled(event, env, ctx) {
    ctx.waitUntil((async () => {
      let total = 0;
      for (let pass = 0; pass < 20; pass++) {
        const r = await sweepArchive(env, ARCH_BATCH);
        total += r.archived || 0;
        if (!r.archived || r.archived < ARCH_BATCH) break;
      }
      if (total) console.log('archived', total, 'characters to R2');
    })());
  },

  async fetch(req, env, ctx) {
    const u = new URL(req.url);
    const origin = req.headers.get('Origin') || '';
    const list = (env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);

   /* Browsers omit Origin entirely on same-origin GET requests, and always send
       it for POST and for anything cross-origin. So an absent Origin means the
       request is same-origin (or not from a browser at all, where an Origin
       check was never a security boundary anyway — it can simply be forged).
       An Origin equal to our own is same-origin by definition. */
    const originOk =
      !origin ||   // same-origin GET
      origin === u.origin ||   // same-origin, header present
      list.length === 0 ||   // allow-list disabled
      list.includes(origin);   // explicitly permitted cross-origin

    if (req.method === 'OPTIONS') {
      return new Response(null, { headers: cors(originOk ? origin : 'null') });
    }

   /* ---------------- /ws : the only hot path ---------------- */
    if (u.pathname === '/ws') {
   // WebSocket upgrades skip CORS preflight entirely, so check this yourself
      if (!originOk) return new Response('forbidden origin', { status: 403 });
   // case-insensitive: some proxies send "WebSocket"
      if ((req.headers.get('Upgrade') || '').toLowerCase() !== 'websocket') {
        return new Response('expected websocket', { status: 426 });
      }

      const auth = u.searchParams.get('auth') || '';
      const seed = cleanSeed(u.searchParams.get('seed'));
      if (!/^[0-9a-f]{64}$/.test(auth)) return new Response('bad auth', { status: 400 });

      const who = await whoami(env, auth);
      if (who.e) return new Response(who.e, { status: who.code });

      const target = new URL(req.url);
      target.searchParams.set('pid', who.row.pid);
      target.searchParams.set('name', who.row.name || 'Adventurer');
      target.searchParams.set('seed', seed);
      target.searchParams.set('last', who.row.seed || '');

      const stub = env.WORLD.get(env.WORLD.idFromName('world:' + seed));
      return stub.fetch(new Request(target, req));
    }

   /* ---------------- /ge : the grand exchange ---------------- */
    if (u.pathname === '/ge' || u.pathname.startsWith('/ge/')) {
      if (!originOk) return json({ e: 'origin' }, 403, 'null');
      let body = null;
      if (req.method === 'POST') {
        try { body = await req.json(); } catch { return json({ e: 'bad json' }, 400, origin); }
      }
      const who = await whoami(env, (body && body.auth) || bearer(req) || u.searchParams.get('auth') || '');
      if (who.e) return json({ e: who.e }, who.code, origin);
      try {
        const stub = env.EXCHANGE.get(env.EXCHANGE.idFromName('ge'));
        const r = await stub.fetch(new Request('https://do' + u.pathname + '?pid=' + who.row.pid, {
          method: req.method,
          headers: { 'content-type': 'application/json' },
          body: body ? JSON.stringify(body) : undefined
        }));
        let j; try { j = await r.json(); } catch { j = { e: 'exchange error' }; }
        return json(j, r.status, origin);
      } catch (e) {
        console.log('ge route failed', String(e));
        return json({ e: 'exchange unavailable' }, 500, origin);
      }
    }

   /* ---------------- /register ---------------- */
    if (u.pathname === '/register' && req.method === 'POST') {
      if (!originOk) return json({ e: 'origin' }, 403, 'null');

      let b;
      try { b = await req.json(); } catch { return json({ e: 'bad json' }, 400, origin); }
      const { auth, pid, name } = b || {};

      if (!/^[0-9a-f]{64}$/.test(auth || '')) return json({ e: 'bad auth' }, 400, origin);
      if (!/^[0-9a-f]{12}$/.test(pid || '')) return json({ e: 'bad pid' }, 400, origin);
      if (!/^[A-Za-z0-9 ]{2,12}$/.test(name || '')) return json({ e: 'bad name' }, 400, origin);

   /* Bucket an IPv6 address by its /64, not its full 128 bits. A single
           residential v6 allocation hands out 2^64 addresses, so per-exact-address
           counting made the five-per-hour limit free to walk straight past —
           and sybil accounts are what fund every other abuse in this file.
           IPv4 keeps its exact address; a /64 has no meaning there. */
      const ip = req.headers.get('cf-connecting-ip') || '';
      const ipKey = ip.includes(':') ? ip.split(':').slice(0, 4).join(':') + '::/64' : ip;
      const ipHash = await sha256('ip|' + ipKey);
      const hourAgo = Date.now() - 3600e3;

      const authHash = await sha256('v1|' + auth);

      try {
   // Is this key already an account? Then the answer is "log in", not "error".
        const mine = await env.DB.prepare('SELECT pid, name FROM players WHERE auth_hash=?')
          .bind(authHash).first();
        if (mine) return json({ e: 'key_registered', pid: mine.pid, name: mine.name }, 409, origin);

   // Name uniqueness is case-insensitive, so Vlad and vlad cannot coexist.
        const taken = await env.DB.prepare(
          'SELECT 1 AS x FROM players WHERE name = ? COLLATE NOCASE'
        ).bind(name).first();
        if (taken) return json({ e: 'name_taken' }, 409, origin);

        const c = await env.DB.prepare(
          'SELECT COUNT(*) AS n FROM players WHERE ip_hash=? AND created>?'
        ).bind(ipHash, hourAgo).first();
        if ((c?.n ?? 0) >= 5) return json({ e: 'rate_limited' }, 429, origin);

        await env.DB.prepare(
          'INSERT INTO players (pid, auth_hash, name, ip_hash, created, updated) VALUES (?,?,?,?,?,?)'
        ).bind(pid, authHash, name, ipHash, Date.now(), Date.now()).run();
      } catch (e) {
        const msg = String(e);
        if (msg.includes('UNIQUE')) return json({ e: 'name_taken' }, 409, origin);
        console.log('register failed', msg);
        return json({ e: 'db error' }, 500, origin);
      }

      return json({ ok: 1, pid, name }, 200, origin);
    }

   /* ---------------- /name-check ---------------- */
    if (u.pathname === '/name-check' && req.method === 'GET') {
      if (!originOk) return json({ e: 'origin' }, 403, 'null');
      const name = (u.searchParams.get('name') || '').trim();
      if (!/^[A-Za-z0-9 ]{2,12}$/.test(name)) {
        return json({ valid: 0, e: 'Name must be 2-12 letters, digits or spaces.' }, 200, origin);
      }
      try {
        const taken = await env.DB.prepare(
          'SELECT 1 AS x FROM players WHERE name = ? COLLATE NOCASE'
        ).bind(name).first();
        return json({ valid: 1, available: taken ? 0 : 1, name }, 200, origin);
      } catch { return json({ e: 'db error' }, 500, origin); }
    }

   /* ---------------- /rotate : a new key for the same account ----------------
       The key IS the credential, so before this route a leak — a shoulder-surf,
       a shared screenshot, a script that reads localStorage — was permanent and
       total. Proving you hold the old key is the only authority needed, which is
       the same authority every other route already accepts. One indexed column
       changes; the old key stops working the moment it lands. */
    if (u.pathname === '/rotate' && req.method === 'POST') {
      if (!originOk) return json({ e: 'origin' }, 403, 'null');
      let b; try { b = await req.json(); } catch { return json({ e: 'bad json' }, 400, origin); }
      const { auth, next } = b || {};
      if (!/^[0-9a-f]{64}$/.test(next || '')) return json({ e: 'bad new key' }, 400, origin);
      const who = await whoami(env, auth || '');
      if (who.e) return json({ e: who.e }, who.code, origin);
      if (auth === next) return json({ e: 'that is the same key' }, 400, origin);
      try {
        await env.DB.prepare('UPDATE players SET auth_hash=?, updated=? WHERE pid=?')
          .bind(await sha256('v1|' + next), Date.now(), who.row.pid).run();
      } catch (e) {
        if (/UNIQUE/i.test(String(e))) return json({ e: 'that key already belongs to an account' }, 409, origin);
        console.log('rotate failed', String(e));
        return json({ e: 'db error' }, 500, origin);
      }
      return json({ ok: 1, pid: who.row.pid, name: who.row.name }, 200, origin);
    }

   /* ---------------- /save : one character, per seed ---------------- */
    if (u.pathname === '/save' && req.method === 'GET') {
      if (!originOk) return json({ e: 'origin' }, 403, 'null');

   // ?pop=1 needs no account, so answer before authenticating
      if (u.searchParams.get('pop')) return population(env, u, origin, ctx);
      if (u.searchParams.get('list')) return characters(env, u, origin, bearer(req));

      const auth = bearer(req) || u.searchParams.get('auth') || '';
   // no seed given means "wherever I was last" — and that answer lives in the account row, so only a named
   // seed can ride the account lookup's batch. Entering a world always names one, which is the case login waits on.
      const asked = u.searchParams.get('seed');
      const CHAR = 'SELECT save FROM characters WHERE pid=' + SUB_PID + ' AND seed=?';

   /* The catch here used to be unconditional, and that cost characters. Any
           transient D1 error — a timeout, a storage blip — returned
           {save:{}, isNew:1} at HTTP 200 with no error field, the client read that
           as "brand new account", ran freshCharacter() and wrote a 614-byte starter
           blob over a real character seconds later. A missing table is the one
           genuinely-empty case; everything else is a failure and must say so, so
           the client retries and then refuses to arm saving. */
      let row, seed, ch = null, missing = 0;
      if (asked) {
        seed = cleanSeed(asked);
        const a = await authQuery(env, auth, CHAR, [seed]);
        if (!a.retry) {
          if (a.e) return json({ e: a.e }, a.code, origin);
          row = a.row; ch = a.rows[0] || null;
        }
      }
      if (!row) {   // no seed named, or the batch failed as a unit: resolve the two halves separately
        const who = await whoami(env, auth);
        if (who.e) return json({ e: who.e }, who.code, origin);
        row = who.row;
        seed = cleanSeed(asked || row.seed);
        try {
          ch = await env.DB.prepare(CHAR.replace(SUB_PID, '?')).bind(row.pid, seed).first();
        } catch (e) {
          if (!/no such table/i.test(String(e))) {
            console.log('character read failed', row.pid, String(e).slice(0, 120));
            return json({ e: 'character read failed' }, 503, origin);
          }
          missing = 1;
        }
      }

   /* THE ARCHIVE READ. A row absent from D1 does not mean a new player — it
           means the sweep has been past. This lookup must resolve BEFORE isNew is
           decided, because isNew:1 is what tells the client to run freshCharacter()
           and write a starter blob. Get this wrong and every returning player whose
           row has aged out comes back to a bronze sword.

           Only a D1 miss pays for it, so a player who was here in the last few
           minutes never waits. A restore is a real hit and costs one R2 GET plus
           one D1 write; the R2 object is deliberately left in place, so it stays a
           permanent copy and the next sweep simply overwrites it. An R2 failure is
           NOT treated as "no character" — it is a 503, for the same reason the D1
           failure above is. */
      let restored = 0;
      if (!ch && env.ARCHIVE) {
        let obj;
        try { obj = await env.ARCHIVE.get(archKey(row.pid, seed)); }
        catch (e) {
          console.log('archive read failed', row.pid, seed, String(e).slice(0, 120));
          return json({ e: 'character read failed' }, 503, origin);
        }
        if (obj) {
          let text = null;
          try { text = await obj.text(); } catch {}
          if (!text) return json({ e: 'character read failed' }, 503, origin);
          ch = { save: text };
          restored = 1;
          const m = obj.customMetadata || {};
   /* Bring it home. ON CONFLICT DO NOTHING because two tabs can log in at
               once and the second must not clobber the first — and because a save may
               already have raced ahead of this restore, in which case the newer row
               wins and this is correctly a no-op. */
          ctx.waitUntil(env.DB.prepare(
            'INSERT INTO characters (pid, seed, save, combat, total_level, created, updated) ' +
            'VALUES (?,?,?,?,?,?,?) ON CONFLICT(pid, seed) DO NOTHING'
          ).bind(row.pid, seed, text, (+m.combat || 3), (+m.totalLevel || 32),
                 (+m.created || Date.now()), Date.now()).run()
            .catch(e => console.log('restore failed', row.pid, seed, String(e).slice(0, 120))));
        }
      }

      let save = {}, bad = 0;
      try { save = JSON.parse((ch && ch.save) || '{}'); } catch { bad = 1; }
   /* isNew is the server's judgement, not something the client infers from an
           empty object: a row that exists but will not parse is NOT a new character,
           and saying so is what stops it being overwritten. */
      const body = { pid: row.pid, name: row.name, seed, save, isNew: ch ? 0 : 1 };
      if (missing) body.note = 'characters table missing — run sql/schema.sql';
      if (restored) body.note = 'restored from the archive';
      if (bad) return json({ e: 'character blob is corrupt' }, 503, origin);
   /* Every login stamps the account, whether or not anything about the character
           changed. players.updated used to move only when somebody switched worlds,
           which made it useless as a "when were they last here" signal. Fire and
           forget — login must not wait on it. */
      ctx.waitUntil(env.DB.prepare('UPDATE players SET updated=? WHERE pid=?')
        .bind(Date.now(), row.pid).run().catch(() => {}));
      return json(body, 200, origin);
    }

   /* ---------------- /characters and /population ---------------- */
    if (u.pathname === '/characters' && req.method === 'GET') {
      if (!originOk) return json({ e: 'origin' }, 403, 'null');
      return characters(env, u, origin, bearer(req));
    }
    if (u.pathname === '/population' && req.method === 'GET') {
      if (!originOk) return json({ e: 'origin' }, 403, 'null');
      return population(env, u, origin, ctx);
    }

   /* ---------------- /health ---------------- */
    if (u.pathname === '/health') {
      try {
        await env.DB.prepare('SELECT 1').first();
   /* /health runs the schema, which makes it the one-call migration after a
           deploy. Every statement is IF NOT EXISTS, so a second run is free.
           Notably absent: the old idx_characters_pid on (pid, updated). `updated`
           changes on every save, so that index doubled the billed rows of the
           single hottest statement in the system to buy a sort over at most forty
           rows. If it is still in your database, drop it — see sql/schema.sql. */
        const errs = [];
        for (const q of SCHEMA) { try { await env.DB.prepare(q).run(); } catch (e) { errs.push(String(e).slice(0, 100)); } }
   /* Name the leftovers rather than leaving them to be discovered on an invoice.
       Stated as a whitelist, not a blacklist: this database has carried two
       generations of hand-made index names (idx_auth, idx_name_lc, idx_char_pid…)
       alongside the ones an older /health created, and a list of known-bad names
       will always be one deployment behind. Anything on these four tables that is
       not one of the three the schema declares is reported, whatever it is called. */
        const KEEP = ['idx_players_name', 'idx_players_ip', 'ge_book'];
        const stale = await env.DB.prepare(
          "SELECT name, tbl_name FROM sqlite_master WHERE type='index' AND name NOT LIKE 'sqlite_%' " +
          "AND tbl_name IN ('players','characters','houses','ge_offers')"
        ).all().then(r => (r.results || []).filter(x => !KEEP.includes(x.name))
                                           .map(x => x.tbl_name + '.' + x.name)).catch(() => []);
        return json({ ok: 1, db: 'up', now: Date.now(), build: BUILD, spawnRev: SPAWN_REV,
                      schema: SCHEMA.length, errs, staleIndexes: stale }, 200, origin);
      } catch (e) {
        return json({ ok: 0, db: 'down', err: String(e) }, 500, origin);
      }
    }

   /* ---------------- /archive : run the sweep by hand ----------------
       Same code the cron runs, so you can watch it work without waiting five
       minutes. Read-only about the world; it only moves cold rows to R2. */
    if (u.pathname === '/archive') {
      if (!originOk) return json({ e: 'origin' }, 403, 'null');
   /* Authenticated, because an origin check is not one: browsers omit Origin on
       same-origin GETs, so `!origin` waves through every curl. Unguarded, this is
       an anonymous lever on your own D1 reads and R2 writes, and it hands out a
       live player count. Any valid account key will do — it triggers only the work
       the cron already does on a schedule. */
      const who = await whoami(env, bearer(req) || u.searchParams.get('auth') || '');
      if (who.e) return json({ e: who.e }, who.code, origin);
      const r = await sweepArchive(env, Math.min(1000, Math.max(1, +u.searchParams.get('limit') || ARCH_BATCH)));
      const live = await env.DB.prepare('SELECT COUNT(*) AS n FROM characters').first().catch(() => null);
      return json({ ...r, idleMs: ARCH_IDLE, liveRowsLeft: live ? live.n : null,
                    archiveBound: !!env.ARCHIVE }, 200, origin);
    }

   /* ---------------- /play : friendly alias for the game ---------------- */
    if (u.pathname === '/play' || u.pathname === '/play/') {
      return env.ASSETS.fetch(new Request(new URL('/seedworld.html', u), req));
    }

   /* ---------------- everything else: static files ----------------
       Your own index.html at the repo root is served at / untouched, apart from
       three headers. index.html carries the content policy itself, but
       frame-ancestors is ignored in a <meta> — it only counts as a header — and
       clickjacking is worth closing on a page that holds an account key. */
    const asset = await env.ASSETS.fetch(req);
    const ct = asset.headers.get('content-type') || '';
    if (!ct.includes('text/html')) return asset;
    const h = new Headers(asset.headers);
    h.set('content-security-policy', "frame-ancestors 'self'");
    h.set('x-content-type-options', 'nosniff');
    h.set('referrer-policy', 'same-origin');   // the key rides some URLs; do not leak them to anywhere we link
    return new Response(asset.body, { status: asset.status, statusText: asset.statusText, headers: h });
  }
};

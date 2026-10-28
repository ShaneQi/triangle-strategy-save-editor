// Triangle Strategy (PC, UE4.27 "Newera") save codec + edit model, used by the web app.
// Runs in Node (real Buffer) and browsers (load bytes.js and s1parse.js first).
//
// File layout:
//   GVAS header (UE SaveGame) -> class /Script/Newera.SaveGameData | SaveSystemData
//   one property `bulkData` : ArrayProperty<ByteProperty>  (then "None" + 4 zero bytes)
//   bulkData = NWER blob:
//     0x00 u32  magic 'NWER'
//     0x04 u16  version (0x26..0x27 when kind==0, 0x11..0x39 when kind==1)
//     0x06 u16  must be 1
//     0x08 u8   kind (0 = system data, 1 = game data)
//     0x09 u8, 0x0a u8, 0x0b u8  flags
//     0x0c u8[20] SHA-1 of plaintext[0x40 .. len-20]; also the cipher key
//     0x20 u8[32] reserved (zero)
//     0x40 ...   ciphertext; plaintext ends with a copy of the 20-byte SHA-1
//
//   Cipher (FUN_141155230 / FUN_141141530 in the shipping exe):
//     T = identity[256]; for r in 0..127, j in 0..n-1: swap T[(K[(j+1)%n]+r)&255], T[(K[j]+r)&255]
//     INV[T[i]] = i
//     decrypt: p[i] = INV[c[i] ^ K[i % n]]    (i counts from 0x40)
//     encrypt: c[i] = T[p[i]] ^ K[i % n]
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    let cat = null; try { cat = require('./catalog.js'); } catch { }
    module.exports = factory(require('./s1parse.js'), cat);
  } else root.TSCore = factory(root.TSParse, root.TSCatalog || null);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (S1, CATALOG) {
  'use strict';

  // ---- SHA-1 (sync, dependency free) --------------------------------------------------------
  function sha1(bytes) {
    const n = bytes.length, words = ((n + 8) >>> 6) + 1, w = new Uint32Array(words * 16);
    for (let i = 0; i < n; i++) w[i >>> 2] |= bytes[i] << (24 - (i & 3) * 8);
    w[n >>> 2] |= 0x80 << (24 - (n & 3) * 8);
    w[words * 16 - 1] = (n * 8) >>> 0; w[words * 16 - 2] = Math.floor(n / 0x20000000);
    let h0 = 0x67452301, h1 = 0xefcdab89, h2 = 0x98badcfe, h3 = 0x10325476, h4 = 0xc3d2e1f0;
    const x = new Uint32Array(80);
    for (let blk = 0; blk < w.length; blk += 16) {
      for (let t = 0; t < 16; t++) x[t] = w[blk + t];
      for (let t = 16; t < 80; t++) { const v = x[t - 3] ^ x[t - 8] ^ x[t - 14] ^ x[t - 16]; x[t] = (v << 1) | (v >>> 31); }
      let a = h0, b = h1, c = h2, d = h3, e = h4;
      for (let t = 0; t < 80; t++) {
        const f = t < 20 ? ((b & c) | (~b & d)) + 0x5a827999 : t < 40 ? (b ^ c ^ d) + 0x6ed9eba1 : t < 60 ? ((b & c) | (b & d) | (c & d)) + 0x8f1bbcdc : (b ^ c ^ d) + 0xca62c1d6;
        const tmp = (((a << 5) | (a >>> 27)) + f + e + x[t]) >>> 0;
        e = d; d = c; c = (b << 30) | (b >>> 2); b = a; a = tmp;
      }
      h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0; h4 = (h4 + e) >>> 0;
    }
    const out = Buffer.alloc(20);
    [h0, h1, h2, h3, h4].forEach((h, i) => { out[i * 4] = h >>> 24; out[i * 4 + 1] = h >>> 16; out[i * 4 + 2] = h >>> 8; out[i * 4 + 3] = h; });
    return out;
  }

  function tables(K) {
    const n = K.length, T = new Uint8Array(256), INV = new Uint8Array(256);
    for (let i = 0; i < 256; i++) T[i] = i;
    for (let r = 0; r < 128; r++)
      for (let j = 0; j < n; j++) {
        const a = (K[(j + 1) % n] + r) & 255, b = (K[j % n] + r) & 255;
        const t = T[a]; T[a] = T[b]; T[b] = t;
      }
    for (let i = 0; i < 256; i++) INV[T[i]] = i;
    return { T, INV };
  }

  // Locate bulkData byte array inside the GVAS container.
  //   FString "bulkData", FString "ArrayProperty", u64 size(=count+4), FString "ByteProperty",
  //   u8 hasGuid(0), int32 count, <count bytes NWER blob>, FString "None", u32 0
  function locate(buf) {
    if (buf.toString('latin1', 0, 4) !== 'GVAS') throw new Error('not a GVAS (UE SaveGame) file');
    const nw = buf.indexOf('NWER');
    if (nw < 0) throw new Error('NWER blob not found: not a Triangle Strategy save');
    const len = buf.readUInt32LE(nw - 4); // ByteProperty inner array count
    const ap = buf.lastIndexOf('ArrayProperty\0', nw);
    const sizeAt = ap + 14;
    if (ap < 0 || Number(buf.readBigUInt64LE(sizeAt)) !== len + 4) throw new Error('unexpected bulkData property layout');
    return { off: nw, len, countAt: nw - 4, sizeAt };
  }
  // Replace the NWER blob, fixing the GVAS array count and property size when the length changes.
  function replaceBlob(orig, blob) {
    const { off, len, countAt, sizeAt } = locate(orig);
    const res = Buffer.concat([orig.subarray(0, off), blob, orig.subarray(off + len)]);
    res.writeInt32LE(blob.length, countAt);
    res.writeBigUInt64LE(BigInt(blob.length + 4), sizeAt);
    return res;
  }

  function decode(blob) {
    const K = blob.subarray(12, 32);
    const { INV } = tables(K);
    const out = Buffer.from(blob);
    for (let i = 0x40; i < blob.length; i++) out[i] = INV[blob[i] ^ K[(i - 0x40) % 20]];
    const sha = sha1(out.subarray(0x40, out.length - 20));
    const ok = sha.equals(K) && out.subarray(out.length - 20).equals(K);
    return { out, ok };
  }

  function encode(plain) {
    const p = Buffer.from(plain);
    const sha = sha1(p.subarray(0x40, p.length - 20));
    sha.copy(p, 12); sha.copy(p, p.length - 20);
    const { T } = tables(sha);
    const out = Buffer.from(p);
    for (let i = 0x40; i < p.length; i++) out[i] = T[p[i]] ^ sha[(i - 0x40) % 20];
    return out;
  }

  // ---- plaintext readers ------------------------------------------------------------------------
  function rdFString(p, o) {
    const n = p.readInt32LE(o);
    if (n === 0) return { s: '', e: o + 4 };
    if (n > 0) return { s: p.toString('latin1', o + 4, o + 4 + n - 1), e: o + 4 + n };
    return { s: p.toString('utf16le', o + 4, o + 4 - 2 * n - 2), e: o + 4 - 2 * n };
  }
  const ticksToDate = t => new Date(Number((t - 621355968000000000n) / 10000n));

  // Game-data plaintext = header(0x40) + 3 x TArray<uint8> sections + SHA-1(20).
  //  s0 slot preview  (FUN_140e0dfa0)
  //  s1 game state    (FUN_140d3c7e0 -> FUN_140d5cea0, FUN_140d3b260, FUN_140d39a50, FUN_140d5c7e0, FUN_140d5ce30, FUN_140ef66e0)
  //  s2 field/battle  (int32 present flag + object vtable+0x6c8 serializer)
  function sections(p) {
    const out = []; let o = 0x40;
    for (let k = 0; k < 3; k++) { const n = p.readInt32LE(o); out.push({ off: o + 4, len: n }); o += 4 + n; }
    return out;
  }
  function preview(p, s0) {
    let o = s0.off;
    const r = {};
    r.savedAt = ticksToDate(p.readBigUInt64LE(o)); o += 8;          // FDateTime ticks
    r.playSeconds = Number(p.readBigUInt64LE(o)); o += 8;           // play time, seconds
    r.u16_10 = p.readUInt16LE(o); o += 2;                             // probably leader level
    r.u8_12 = p[o]; o += 1;                                           // unknown
    let f = rdFString(p, o); r.leader = f.s; o = f.e;                 // leader name
    f = rdFString(p, o); r.location = f.s; o = f.e;                   // location / save point
    const tn = p.readInt32LE(o); r.thumb = { off: o + 4, len: tn }; o += 4 + tn; // BGRA pixels
    r.thumbW = p.readFloatLE(o); r.thumbH = p.readFloatLE(o + 4); o += 8;
    f = rdFString(p, o); r.title = f.s; o = f.e;                      // FName as string
    f = rdFString(p, o); r.subtitle = f.s; o = f.e;
    r.tailBytes = [...p.subarray(o, s0.off + s0.len)];
    return r;
  }

  // ---- high level: open / summarize / edit / save ----------------------------------------------
  // Unit parameter block (FUN_140df76a0, 16 int32 at unit+0xc4). Indices verified against the save;
  // names for 9..15 follow the game's stat order (STR/INT/DEF/MDF + DEX/AGI from buff items, LUK from accessories).
  // Unit stat array (unit +0xC4, 16 int32). [2..15] are a copy of the GOP_Battle_UnitGrowth row for the
  // unit's level and class rank, rewritten by the game on level-up and class change. [2] is movement × 100,
  // [4] is jump down; [7] speed and [8] TP per turn are floats.
  const UNIT_STAT = { level: 0, exp: 1, move: 2, jump: 3, hp: 5, tp: 6, str: 9, int: 10, dex: 11, agi: 12, luk: 13, def: 14, mdf: 15 };
  const CONVICTION = { liberty: 1, utility: 2, morality: 3 };   // game enum: 1 FREEDOM, 2 BENEFIT, 3 MORAL
  const INVENTORY_TABLES = ['keyItems', 'battleItems', 'table2', 'materials', 'medals'];

  // file bytes -> { buf, p (plaintext), ok, kind, version, ss, s1 }
  function open(fileBytes) {
    const buf = Buffer.from(fileBytes);
    const { off, len } = locate(buf);
    const { out: p, ok } = decode(buf.subarray(off, off + len));
    const save = { buf, p, ok, kind: p[8], version: p.readUInt16LE(4) };
    if (ok && save.kind === 1) reparse(save);
    return save;
  }
  function reparse(save) {
    save.ss = sections(save.p);
    save.s1 = S1.parseS1(save.p, save.ss[1].off, save.ss[1].len, { version: save.version });
    save.s2 = S1.parseS2(save.p, save.ss[2].off, save.ss[2].len);   // read-only; s2.error if not understood
    return save;
  }

  function summarize(p, ss, s1) {
    const w = s1.world, pv = preview(p, ss[0]);
    const conv = w.f3bb00.a.map(x => x.v);
    const inv = {};
    w.f5bd60.forEach((m, i) => { inv[INVENTORY_TABLES[i]] = Object.fromEntries(m.map(x => [x.id, x.v.v])); });
    return {
      savedAt: pv.savedAt.toISOString(), playTimeSeconds: pv.playSeconds, leader: pv.leader,
      chapter: pv.title, money: w.tail.money.v,
      convictions: { liberty: conv[1], utility: conv[2], morality: conv[3] },
      inventory: inv,
      accessories: Object.fromEntries(w.f39570[0].map(x => [x.id, x.v.v])),
      lifetimeCounters: Object.fromEntries(w.fc68e10.set.map(x => [x.a, x.v.v])),
      units: w.units.map(u => {
        const st = u.p.stats.map(x => x.v), o = { id: u.p.base.master, class: u.list430.map(x => x.id).join(',') };
        for (const [k, i] of Object.entries(UNIT_STAT)) o[k] = st[i];
        o.speed = Buffer.from(Int32Array.of(st[7]).buffer).readFloatLE(0);
        o.attendance = u.i440.v;
        o.equippedAccessories = u.accessories;
        return o;
      }),
    };
  }

  // Item ids the game uses, collected from everything in the save (for "add item" suggestions).
  function knownItemIds(s1) {
    const w = s1.world, ids = new Set();
    for (const m of [...w.f5bd60, ...w.f39570]) for (const x of m) ids.add(x.id);
    for (const x of w.f5caf0) if (/^(ITEM|BATTLE_ACCESSARY)_/.test(x.id)) ids.add(x.id);
    for (const u of w.units) for (const a of u.accessories) ids.add('BATTLE_' + a);
    if (CATALOG) for (const id of CATALOG.ids) ids.add(id);
    return [...ids].sort();
  }

  // ---- edit keys --------------------------------------------------------------------------------
  // Every editable value has a key that resolves (against a fresh parse) to { at, type }.
  //   money | conviction.<liberty|utility|morality> | bonusconv.<…> | unit.<P001>.<stat>
  //   unit.<P001>.attendance battles the unit has fought (unit +0x440; character-story requirements)
  //   item.<ID> (existing; a missing ITEM_/BATTLE_ACCESSARY_ id is appended)
  //   note.<ID>              0|1: note owned (inventory map 0); 1 appends the entry, 0 deletes it
  //   counter.<n>            lifetime/achievement counter (FUN_140c68e10)
  //   flag.<NAME>            story/event flag (flag manager table)
  //   story.<NODE>.<0-3>     story-chart node bools (FUN_140d5e9a0)
  //   choice.<ID>            dialogue/decision choice bool (FUN_140d5e370)
  //   nameflag.<ID>          FUN_140d3a4e0 bool set
  //   order.<ID>.<count|on>  battle orders (FUN_140d39000)
  //   place.<ID>             place-name table int (FUN_140d5df20)
  //   unitdata.<k>.<ID>      FUN_140d5d170 maps
  //   shop.<index>           shop stock count (FUN_140d5caf0)
  //   charach.<P002>.<f6|f7|f8|slot>  character-story achievement tracker bytes (FUN_140c68e10 map; u8)
  function resolveKey(s1, key) {
    const w = s1.world, k = key.split('.'), I = x => x && { at: x.at, type: 'i32' }, B = x => x && { at: x.at, type: 'bool' };
    const find = (arr, id) => arr && arr.find(x => x.id === id);
    switch (k[0]) {
      case 'money': return I(w.tail.money);
      case 'conviction': return k[1] in CONVICTION ? I(w.f3bb00.a[CONVICTION[k[1]]]) : null;
      case 'bonusconv': return k[1] in CONVICTION ? I(w.f3bb00.b[CONVICTION[k[1]]]) : null;
      case 'unit': {
        const u = w.units.find(u => u.p.base.master.endsWith('_' + k[1]) || u.p.base.master === k[1]);
        if (u && k[2] === 'attendance') return I(u.i440);
        return u && k[2] in UNIT_STAT ? I(u.p.stats[UNIT_STAT[k[2]]]) : null;
      }
      case 'item': { const id = k.slice(1).join('.'); for (const m of [...w.f5bd60, ...w.f39570]) { const e = find(m, id); if (e) return I(e.v); } return null; }
      case 'counter': { const e = w.fc68e10.set.find(x => x.a === +k[1]); return e ? I(e.v) : null; }
      case 'flag': { const id = k.slice(1).join('.'); const e = s1.flags && find(s1.flags.entries, id); return e ? I(e.v) : null; }
      case 'story': { const e = w.storyChart[k[1]]; return e ? B(e[+k[2]]) : null; }
      case 'choice': { const id = k.slice(1).join('.'); return id in w.selections ? B(w.selections[id]) : null; }
      case 'nameflag': { const e = find(w.f3a4e0, k.slice(1).join('.')); return e ? B(e.v) : null; }
      case 'order': { const e = find(w.f39000, k[1]); return e ? (k[2] === 'on' ? B(e.f) : I(e.v)) : null; }
      case 'place': { const e = find(w.f5df20, k.slice(1).join('.')); return e ? I(e.v) : null; }
      case 'unitdata': { const m = w.f5d170[+k[1]]; const e = m && find(m, k.slice(2).join('.')); return e ? I(e.v) : null; }
      case 'shop': { const e = w.f5caf0[+k[1]]; return e ? I(e.c) : null; }
      case 'charach': {   // charach.<P002>.<f6|f7|f8|slot>: per-unit character-story achievement tracker (u8)
        const e = w.fc68e10.map.find(x => x.id === 'UNIT_MASTER_CH_' + k[1] || x.id === k[1]);
        const i = CHARACH_FIELD[k[2]];
        return e && i !== undefined ? { at: e.b[i].at, type: 'u8', max: i === 3 ? 28 : 1 } : null;
      }
    }
    return null;
  }
  const CHARACH_FIELD = { f6: 0, f7: 1, f8: 2, slot: 3 };
  function readKey(p, s1, key) {
    if (key.startsWith('note.')) { const e = noteEntry(s1.world, key.slice(5)); return e && e.v.v > 0 ? 1 : 0; }
    const r = resolveKey(s1, key); return !r ? undefined : r.type === 'u8' ? p[r.at] : p.readInt32LE(r.at);
  }

  // ---- notes: inventory map 0 (FUN_140d5bd60 #0, world+0x7d8 -> +0x00) ----------------------------
  // The game adds a note with FUN_140d0ca50, which clamps its count to 0..1 and deletes the entry at 0,
  // so a note is owned exactly when it has an entry. ACHIEVEMENT_047 (NOTE_COMPLETE, FUN_140c5ae20) needs
  // every GOP_Note row here, and the game checks it only when it adds a note.
  const NOTE_IDS = CATALOG && CATALOG.groups && CATALOG.groups.notes ? CATALOG.groups.notes.map(x => x[0]) : null;
  const noteEntry = (w, id) => w.f5bd60[0].find(x => x.id === id);
  function editNote(p, ss, w, id, v) {
    if (v !== 0 && v !== 1) throw new Error(`note.${id}: must be 0 or 1`);
    const m = w.f5bd60[0], e = noteEntry(w, id);
    if (e) {
      if (v === 1) { if (e.v.v !== 1) p.writeInt32LE(1, e.v.at); return null; }
      // delete the entry: FString id (int32 length, latin1 bytes, NUL), then int32 count
      const start = e.v.at - 4 - (id.length + 1), end = e.v.at + 4;
      if (p.readInt32LE(start) !== id.length + 1) throw new Error(`note.${id}: unexpected entry layout`);
      const np = Buffer.concat([p.subarray(0, start), p.subarray(end)]);
      np.writeInt32LE(m.length - 1, m.countAt);
      np.writeInt32LE(ss[1].len - (end - start), ss[1].off - 4);   // s1 TArray length
      return np;
    }
    if (v === 0) return null;
    if (!/^[A-Z0-9_]+$/.test(id) || (NOTE_IDS ? !NOTE_IDS.includes(id) : !id.startsWith('NOTE_'))) throw new Error(`"${id}" is not a note id (GOP_Note)`);
    return appendEntry(p, ss, m, id, 1);
  }
  // append {FString id, int32 v} to a TMap<FName,int32> read by nameIntMap; returns the new plaintext
  function appendEntry(p, ss, m, id, v) {
    const entry = Buffer.alloc(4 + id.length + 1 + 4); entry.writeInt32LE(id.length + 1, 0); entry.write(id, 4, 'latin1'); entry.writeInt32LE(v, 4 + id.length + 1);
    const np = Buffer.concat([p.subarray(0, m.endAt), entry, p.subarray(m.endAt)]);
    np.writeInt32LE(m.length + 1, m.countAt);
    np.writeInt32LE(ss[1].len + entry.length, ss[1].off - 4);   // s1 TArray length
    return np;
  }

  // Apply one edit. Returns a new plaintext buffer when the size changed, otherwise patches in place and returns null.
  function applyEdit(p, ss, s1, key, v) {
    if (!Number.isInteger(v) || v < -2147483648 || v > 2147483647) throw new Error(`${key}: value must be a 32-bit integer`);
    const w = s1.world, k = key.split('.');
    if (k[0] === 'conviction' && (v < 0 || v > 9999)) throw new Error('convictions are clamped to 0..9999 by the game');
    if (k[0] === 'note') return editNote(p, ss, w, k.slice(1).join('.'), v);
    const r = resolveKey(s1, key);
    if (r) {
      if (r.type === 'bool' && v !== 0 && v !== 1) throw new Error(`${key}: must be 0 or 1`);
      if (r.type === 'u8') {
        if (v < 0 || v > r.max) throw new Error(`${key}: must be 0..${r.max}`);
        p[r.at] = v; return null;
      }
      p.writeInt32LE(v, r.at); return null;
    }
    if (k[0] === 'item') {
      const id = k.slice(1).join('.');
      if (!/^[A-Z0-9_]+$/.test(id)) throw new Error(`invalid item id "${id}"`);
      // not present: append to the table it belongs to
      if (id.startsWith('NOTE_')) throw new Error(`notes are added with note.${id}=1`);
      const m = tableForNewId(w, id);
      if (!m) throw new Error(`don't know which inventory table "${id}" belongs to`);
      return appendEntry(p, ss, m, id, v);
    }
    throw new Error(`unknown or missing key ${key}`);
  }
  const commonPrefix = (a, b) => { let i = 0; while (i < a.length && a[i] === b[i]) i++; return i; };
  // Which TMap a new id goes into: accessories -> owned-accessories map (FUN_140d39570 #0);
  // ITEM_* -> the inventory table (FUN_140d5bd60) whose ids share the longest prefix.
  function tableForNewId(w, id) {
    if (id.startsWith('BATTLE_ACCESSARY_')) return w.f39570[0];
    if (!id.startsWith('ITEM_')) return null;
    let best = null, score = 0;
    for (const m of w.f5bd60) for (const x of m) { const s = commonPrefix(x.id, id); if (s > score) { score = s; best = m; } }
    return score >= 'ITEM_'.length + 3 ? best : null;
  }
  // name of the inventory group a new id would be added to (for UIs); null if unknown
  function groupForNewId(s1, id) {
    const w = s1.world, m = tableForNewId(w, id);
    if (!m) return null;
    if (m === w.f39570[0]) return 'accessories';
    return INVENTORY_TABLES[w.f5bd60.indexOf(m)];
  }

  // Apply a list of [key, value] edits to an opened save and return the new file bytes.
  // The result is re-opened and verified (SHA-1 + full parse + every edited value reads back).
  function buildEdited(save, edits) {
    const work = { buf: save.buf, p: Buffer.from(save.p), version: save.version, kind: save.kind };
    reparse(work);
    // edits that change the size (new items) return a new buffer; reparse so later offsets stay valid
    for (const [key, v] of edits) {
      const np = applyEdit(work.p, work.ss, work.s1, key, v);
      if (np) { work.p = np; reparse(work); }
    }
    const file = replaceBlob(save.buf, encode(work.p));
    const check = open(file);
    if (!check.ok) throw new Error('verification failed: SHA-1 mismatch in the produced file');
    for (const [key, v] of edits) {
      const got = readKey(check.p, check.s1, key);
      if (got !== v) throw new Error(`verification failed: ${key} reads back as ${got}, expected ${v}`);
    }
    return file;
  }

  return {
    sha1, tables, locate, replaceBlob, decode, encode, rdFString, sections, preview,
    UNIT_STAT, CONVICTION, INVENTORY_TABLES, NOTE_IDS, open, reparse, summarize, knownItemIds, groupForNewId, resolveKey, readKey, applyEdit, buildEdited,
  };
});

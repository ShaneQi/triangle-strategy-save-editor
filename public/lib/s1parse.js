// Parser for game-data section s1 (FUN_140d3c7e0), translated from the shipping exe's
// hand-written FArchive serializers. Every read records its absolute offset so values can be
// patched in place. Works in Node and in browsers (load bytes.js first; exports window.TSParse).
(function (root) {
'use strict';

class R {
  constructor(buf, off = 0, end = buf.length) { this.b = buf; this.o = off; this.end = end; this.trace = null; }
  need(n) { if (this.o + n > this.end) throw new Error(`read past end at 0x${this.o.toString(16)} (+${n})`); }
  i32() { this.need(4); const v = this.b.readInt32LE(this.o); this.o += 4; return v; }
  u32() { this.need(4); const v = this.b.readUInt32LE(this.o); this.o += 4; return v; }
  f32() { this.need(4); const v = this.b.readFloatLE(this.o); this.o += 4; return v; }
  u16() { this.need(2); const v = this.b.readUInt16LE(this.o); this.o += 2; return v; }
  u8() { this.need(1); return this.b[this.o++]; }
  u64() { this.need(8); const v = this.b.readBigUInt64LE(this.o); this.o += 8; return v; }
  bool() { const v = this.i32(); if (v !== 0 && v !== 1) throw new Error(`bad bool ${v} at 0x${(this.o - 4).toString(16)}`); return !!v; }
  // int32 stored, value is a byte (enum)
  e8() { return this.i32(); }
  str() {
    const at = this.o, n = this.i32();
    if (n === 0) return '';
    if (n > 0) { if (n > 0x10000) throw new Error(`bad FString len ${n} at 0x${at.toString(16)}`); this.need(n); const s = this.b.toString('latin1', this.o, this.o + n - 1); if (this.b[this.o + n - 1] !== 0) throw new Error(`FString not NUL-terminated at 0x${at.toString(16)}`); this.o += n; return s; }
    if (-n > 0x10000) throw new Error(`bad FString len ${n} at 0x${at.toString(16)}`);
    this.need(-2 * n); const s = this.b.toString('utf16le', this.o, this.o - 2 * n - 2); this.o += -2 * n; return s;
  }
  name() { return this.str(); }           // FName is serialized as FString by this archive
  bytes() { const n = this.i32(); if (n < 0 || n > 0x1000000) throw new Error(`bad byte-array len ${n} at 0x${(this.o - 4).toString(16)}`); this.need(n); const v = this.b.subarray(this.o, this.o + n); this.o += n; return v; }
  arr(fn) { const n = this.i32(); if (n < 0 || n > 200000) throw new Error(`bad count ${n} at 0x${(this.o - 4).toString(16)}`); const a = []; for (let i = 0; i < n; i++) a.push(fn(this, i)); return a; }
  map(fn) { const n = this.i32(); if (n < 0 || n > 200000) throw new Error(`bad count ${n} at 0x${(this.o - 4).toString(16)}`); const m = {}; for (let i = 0; i < n; i++) { const k = this.name(); m[k] = fn(this, k); } return m; }
  // record a patchable scalar: returns {v, at}
  at(fn) { const at = this.o; const v = fn.call(this); return { v, at }; }
  mark(label) { if (this.trace) this.trace(label, this.o); }
  rep(n, fn) { const a = []; for (let i = 0; i < n; i++) a.push(fn(this, i)); return a; }
}

// ---- FUN_140d3b260 children ------------------------------------------------------------------

// FUN_140d5e9a0: story chart  TMap<FName, {4 bool}>
const storyChart = r => r.map(r => r.rep(4, r => r.at(r.bool)));
// FUN_140d5e370: selections   TMap<FName, bool>
const selections = r => r.map(r => r.at(r.bool));
// FUN_140d60b80: 0x98-byte record
const rec98 = r => ({
  id: r.name(), kind: r.e8(), a: r.i32(), b: r.i32(), c: r.i32(), text: r.str(),
  names: r.rep(6, r => r.name()), flags: r.rep(4, r => r.bool()),
  triples: r.rep(4, r => [r.i32(), r.i32(), r.i32()]), d: r.i32(), e: r.e8(), f: r.e8(),
});
// FUN_140d60650: TMap<FName, TArray<u8>>
const nameBytesMap = r => r.map(r => r.bytes());
// FUN_140d5fd40
const fd40 = r => ({ blobs: nameBytesMap(r), groups: r.map(r => nameBytesMap(r)) });
// FUN_140d5f240
const f240 = r => ({
  names: r.rep(5, r => r.name()),
  records: r.arr(rec98),
  strings: r.arr(r => r.str()),
  b229: r.e8(), ints: r.rep(4, r => r.i32()),
  flagsA: r.rep(128, r => r.bool()), flagsB: r.rep(128, r => r.bool()),
  sub: fd40(r), b228: r.e8(),
});

// FUN_140d3bb00: 2 x int32[4], then sets
const f3bb00 = r => ({
  a: r.rep(4, r => r.at(r.i32)), b: r.rep(4, r => r.at(r.i32)),
  set24: r.arr(r => ({ id: r.name(), x: r.i32(), y: r.i32(), z: r.i32(), id2: r.name() })),
  setA: r.arr(r => ({ id: r.name(), v: r.at(r.u8) })),
  setB: r.arr(r => ({ id: r.name(), v: r.at(r.u8) })),
  setC: r.arr(r => ({ id: r.name(), v: r.at(r.u8) })),
});
// FUN_140d5bdc0
const f5bdc0 = r => { const on = r.bool(); return { on, list: on ? r.arr(r => [r.i32(), r.i32(), r.e8()]) : null }; };
// FUN_140d3c8f0  (polymorphic objects follow if `name` resolves to a data-table row; see notes)
const f3c8f0 = r => {
  const o = { a: r.i32(), ints: r.arr(r => r.i32()), b: r.i32(), name: r.name() };
  if (o.name && o.name !== 'None') throw new Error('FUN_140d3c8f0 with non-empty name: polymorphic payload not implemented');
  return o;
};
const f3c640 = r => [r.i32(), r.i32()];
const f5e2e0 = r => r.rep(8, r => r.bool());

// FUN_140d26550 -> FUN_140d26810: TSet<{FName, u8}>  (field pickups / one-shot map objects)
const f26550 = r => r.arr(r => ({ id: r.name(), v: r.u8() }));
// FUN_140d5c5a0: current location / scene state
const f5c5a0 = r => ({
  map: r.name(), ints: r.rep(4, r => r.i32()), v1: r.rep(3, r => r.f32()), v2: r.rep(3, r => r.f32()),
  b50: r.u8(), s1: r.str(), s2: r.str(), f78: r.bool(), n1: r.name(), n2: r.name(), i8c: r.i32(),
  f90: r.bool(), b91: r.u8(), i10: r.i32(),
});
// FUN_140d38d30: 0x60-byte record
const rec60 = r => ({
  id: r.name(), b8: r.u8(), f9: r.bool(), n0c: r.name(), b14: r.u8(), n18: r.name(), n20: r.name(),
  b28: r.u8(), n2c: r.name(), n34: r.name(), n3c: r.name(), i44: r.i32(), n48: r.name(), i50: r.i32(),
  f54: r.bool(), f55: r.bool(), n58: r.name(),
});
// FUN_140d5b7d0
const f5b7d0 = r => ({ b: r.u8(), i: r.i32() });
// FUN_140d3a4e0: TSet<{FName, bool}>
const nameBoolSet = r => r.arr(r => ({ id: r.name(), v: r.at(r.bool) }));

// TMap<FName, int32> (patchable)
// countAt / endAt (non-enumerable) let editors append entries, even to an empty map
const nameIntMap = r => {
  const countAt = r.o, m = r.arr(r => ({ id: r.name(), v: r.at(r.i32) }));
  Object.defineProperties(m, { countAt: { value: countAt }, endAt: { value: r.o } });
  return m;
};
// FUN_140d5d170: 2 maps, +2 more when save version > 0x38
const f5d170 = (r, ver) => { const o = [nameIntMap(r), nameIntMap(r)]; if (ver > 0x38) o.push(nameIntMap(r), nameIntMap(r)); return o; };
// FUN_140d5bd60: 5 x TMap<FName,int32>
const f5bd60 = r => r.rep(5, nameIntMap);
// FUN_140d39570: 2 x TMap<FName,int32>
const f39570 = r => r.rep(2, nameIntMap);
// FUN_140d39000: TMap<FName,{int32,bool}>
const f39000 = r => r.arr(r => ({ id: r.name(), v: r.at(r.i32), f: r.at(r.bool) }));
// FUN_140d5caf0
const f5caf0 = r => r.arr(r => ({ a: r.u8(), b: r.u8(), id: r.name(), c: r.at(r.i32), d: r.i32() }));
// FUN_140d3b880
const f3b880 = r => r.arr(r => ({ a: r.u8(), id: r.name() }));
// FUN_140c68e10
const fc68e10 = r => ({ set: r.arr(r => ({ a: r.u8(), v: r.at(r.i32) })), map: r.arr(r => ({ id: r.name(), b: r.rep(4, r => r.at(r.u8)) })) });
// map entries: per-unit character-story achievement tracker {u8 flag6, u8 flag7, u8 flag8, u8 slot}
// (FUN_140c562d0 sets flagN when that unit's world-map event of type N finishes; all three -> ACHIEVEMENT_(080+slot))
// N is EWorldIconType: 6 SUB_JO (recruitment story), 7 SUB_HA (story part 1), 8 SUB_KYU (story part 2)

// ---- units (FUN_140decb40) -------------------------------------------------------------------
// Polymorphic ability objects: {int32 flag, FName id, effect}; the effect layout depends on the
// ability's data-table type and is not tagged in the save. We read the header and treat the effect
// as raw bytes whose length is found by backtracking (the rest of the unit must parse).
class NeedGuess extends Error { }
let GUESS = null;   // { lens: [], i: 0 }
const POLY = (where) => r => {
  const at = r.o, flag = r.i32(), id = r.name();
  if (!GUESS) throw new Error(`polymorphic object (${where}) at 0x${at.toString(16)} outside a guessing context`);
  const k = GUESS.i++;
  if (k >= GUESS.lens.length) throw new NeedGuess();
  const len = GUESS.lens[k]; r.need(len);
  const raw = r.b.subarray(r.o, r.o + len); r.o += len;
  return { where, flag, id, effectRaw: raw };
};
function withGuesses(r, fn, maxLen = 256) {
  const lens = [];
  for (let iter = 0; iter < 20000; iter++) {
    const save = r.o; GUESS = { lens, i: 0 };
    try { const v = fn(r); GUESS = null; return v; }
    catch (e) {
      r.o = save;
      if (e instanceof NeedGuess) { lens.push(4); continue; }   // every effect starts with an int32 bool
      if (!lens.length) { GUESS = null; throw e; }
      while (lens.length && ++lens[lens.length - 1] > maxLen) lens.pop();
      if (!lens.length) { GUESS = null; throw e; }
    }
  }
  GUESS = null; throw new Error('guess limit');
}
// FUN_140df84e0: unit identity / placement
const unitBase = r => {
  const u = {
    master: r.name(), n68: r.name(), i18: r.i32(), i1c: r.i32(), b20: r.u8(), i50: r.i32(),
    b54: r.u8(), b5c: r.u8(), b5d: r.u8(), b5e: r.u8(), b5f: r.u8(), i58: r.i32(), f7c: r.bool(),
    n70: r.name(), b78: r.u8(), b79: r.u8(), hasActor: r.bool(),
    cells: r.arr(r => [r.i32(), r.i32(), r.i32()]), bytes: r.arr(r => r.u8()),
  };
  if (u.hasActor) { u.actorNames = r.arr(r => r.name()); u.actorOffset = [r.f32(), r.f32(), r.f32()]; }
  return u;
};
// FUN_140ded130
// The ability objects are polymorphic (vtable+8 serializers). Each starts with {int32, FName id}
// and is followed by type-specific data. The list is always followed by TArray<FName> of the same ids,
// so we locate that list and keep each object's raw bytes.
function polyListWithIdEcho(r) {
  const n = r.i32();
  if (n === 0) return { objs: [], names: r.arr(r => r.name()) };
  const start = r.o;
  const tryAt = p => {
    const q = new R(r.b, p, r.end);
    try { if (q.i32() !== n) return null; const names = q.rep(n, q => q.name()); return { names, end: q.o }; } catch { return null; }
  };
  const firstId = new R(r.b, start + 4, r.end).name();
  for (let p = start + 8; p < r.end - 4; p++) {
    if (r.b.readInt32LE(p) !== n) continue;
    const t = tryAt(p);
    if (!t || t.names[0] !== firstId) continue;
    // split raw object bytes by their ids, in order
    const objs = []; let cur = start;
    for (let i = 0; i < n; i++) {
      const id = t.names[i];
      const nextId = t.names[i + 1];
      let e = p;
      if (nextId !== undefined) {
        const pat = Buffer.alloc(4 + nextId.length + 1); pat.writeInt32LE(nextId.length + 1); pat.write(nextId, 4, 'latin1');
        const k = r.b.indexOf(pat, cur + 4 + 4 + id.length + 1);
        if (k < 0 || k > p) return badPoly(r, start);
        e = k - 4; // preceding int32
      }
      objs.push({ id, raw: r.b.subarray(cur, e) });
      cur = e;
    }
    r.o = t.end;
    return { objs, names: t.names };
  }
  return badPoly(r, start);
}
function badPoly(r, at) { throw new Error(`could not resync polymorphic list at 0x${at.toString(16)}`); }

const unitDed130 = r => {
  const o = { i4: r.i32(), id: r.name() };
  const pl = polyListWithIdEcho(r);
  o.objs = pl.objs; o.names = pl.names;
  o.has = r.i32();
  if (o.has) { o.n40 = r.name(); o.has58 = r.i32(); if (o.has58) o.obj58 = POLY('ded130.obj58')(r); }
  return o;
};
// FUN_140df76a0: unit parameters
const unitParams = r => {
  const p = { base: unitBase(r) };
  p.bc0 = r.u8(); p.bc1 = r.u8();
  p.stats = r.rep(16, r => r.at(r.i32));            // +0xc4 .. +0x100
  p.b104 = r.u8(); p.b124 = r.u8(); p.b125 = r.u8();
  p.n128 = r.name(); p.n130 = r.name(); p.i108 = r.i32();
  p.flags = r.rep(7, r => r.bool());
  p.i114 = r.i32(); p.i118 = r.i32(); p.n11c = r.name();
  p.ded130 = r.arr(unitDed130);
  p.b3b0 = r.u8(); p.n3b4 = r.name();
  p.stats2 = r.rep(8, r => r.at(r.i32));           // +0x3bc .. +0x3d8
  p.cb100 = r.arr(r => (r.i32() ? r.name() : null));
  p.cb3a0 = r.arr(r => ({ a: r.u8(), f: r.bool(), n1: r.name(), n2: r.name(), obj: POLY('cb3a0')(r) }));
  p.ca9f0 = r.arr(r => ({ id: r.name(), f: r.bool(), v: r.i32(), n: r.name() }));
  p.cacf0 = r.rep(12, r => r.i32());
  p.f3f8 = r.bool(); p.i3dc = r.i32(); p.i3e0 = r.i32(); p.i3e4 = r.i32();
  p.i138 = r.i32();
  return p;
};
// After list400 come two polymorphic lists (equipped/battle abilities; accessory slots) whose
// element layouts depend on data tables. We keep them raw and resync on the class list
// (TArray<{FName BATTLE_JOB_*, u8}>), which is followed by an 11-byte fixed tail.
function findJobList(r) {
  for (let p = r.o; p < r.end - 16; p++) {
    const c = r.b.readInt32LE(p);
    if (c < 1 || c > 16) continue;
    if (r.b.readInt32LE(p + 4) < 5 || r.b.readInt32LE(p + 4) > 64) continue;
    if (r.b.toString('latin1', p + 8, p + 19) !== 'BATTLE_JOB_') continue;
    const q = new R(r.b, p, r.end);
    try { const l = q.arr(q => ({ id: q.name(), b: q.u8() })); if (l.every(x => x.id.startsWith('BATTLE_JOB_'))) return { p, list: l, end: q.o }; } catch { }
  }
  throw new Error(`job list not found after 0x${r.o.toString(16)}`);
}
const unit = r => {
  const u = { p: unitParams(r) };
  u.list400 = r.arr(r => ({ a: r.u8(), v: r.i32(), f: r.bool(), id: r.name() }));
  const j = findJobList(r);
  u.rawAbilitiesAccessories = r.b.subarray(r.o, j.p);   // objs410 (count + objects) and opt420 (count + flagged objects)
  u.accessories = [...u.rawAbilitiesAccessories.toString('latin1').matchAll(/BATTLE_ABILITY_ACCESSARY_[A-Z0-9_]+/g)].map(m => m[0].replace('BATTLE_ABILITY_', ''));
  r.o = j.end;
  u.list430 = j.list;
  u.i440 = r.i32(); u.b445 = r.u8(); u.b446 = r.u8(); u.f444 = r.bool(); u.b447 = r.u8();
  return u;
};

function parseS1(buf, off, len, opts = {}) {
  const r = new R(buf, off, off + len);
  const out = { marks: [] };   // [label, plaintext offset] at the start of each parsed part
  r.trace = (label, o) => { out.marks.push([label, o]); if (opts.trace) opts.trace(label, o); };
  // FUN_140d5cea0
  out.head = { ver: r.i32(), b: r.u8(), playCs: r.at(r.u64) };
  r.mark('FUN_140d3b260');
  const w = out.world = {};
  r.mark('storyChart'); w.storyChart = storyChart(r);
  r.mark('selections'); w.selections = selections(r);
  r.mark('f240'); w.f240 = f240(r);
  r.mark('f3bb00'); w.f3bb00 = f3bb00(r);
  r.mark('f5bdc0'); w.f5bdc0 = f5bdc0(r);
  r.mark('f3c8f0'); w.f3c8f0 = f3c8f0(r);
  r.mark('f3c640'); w.f3c640 = f3c640(r);
  r.mark('f5e2e0'); w.f5e2e0 = f5e2e0(r);
  r.mark('pickups'); w.pickups = f26550(r);
  r.mark('location'); w.location = f5c5a0(r);
  r.mark('rec60'); w.rec60 = r.arr(rec60);
  r.mark('f5b7d0'); w.f5b7d0 = f5b7d0(r);
  r.mark('flags4dc'); w.flags4dc = r.rep(4, r => r.bool());
  r.mark('f3a4e0'); w.f3a4e0 = nameBoolSet(r);
  r.mark('f5df20'); w.f5df20 = nameIntMap(r);
  r.mark('f5d170'); w.f5d170 = f5d170(r, opts.version || 0x39);
  r.mark('f5bd60'); w.f5bd60 = f5bd60(r);
  r.mark('f39570'); w.f39570 = f39570(r);
  r.mark('f39000'); w.f39000 = f39000(r);
  r.mark('f5caf0'); w.f5caf0 = f5caf0(r);
  r.mark('f3b880'); w.f3b880 = f3b880(r);
  r.mark('fc68e10'); w.fc68e10 = fc68e10(r);
  r.mark('units'); w.units = [];
  { const n = r.i32(); for (let i = 0; i < n; i++) { r.mark('unit ' + i); w.units.push(withGuesses(r, unit)); } }
  r.mark('worldTail');
  // world object fields; money is world+0x20 (FUN_140d28da0 adds to it, clamped to world+0)
  w.tail = {
    str8: r.str(), money: r.at(r.i32), i24: r.at(r.i32), i30: r.at(r.i32), i28: r.at(r.i32),
    n18: r.name(), b34: r.u8(), i2c: r.at(r.i32), f35: r.bool(), f36: r.bool(), b37: r.u8(),
  };
  r.mark('stop');
  out.stoppedAt = r.o;
  // The rest of s1, in FUN_140d3c7e0's order: map/battle state (FUN_140d39a50), camera and player
  // (FUN_140d5c7e0), world-map state (FUN_140d5ce30), then the flag manager (FUN_140ef66e0).
  // Two objects in it are written only when they exist at save time, with no flag in the stream, so
  // each combination is tried and the one that ends exactly at the end of s1, through a valid flag
  // table, is kept. If none fits (e.g. a battle save with parts not implemented here), the flag
  // table is found by its shape instead and out.tail stays unset (out.tailError says why).
  const tailStart = r.o, sEnd = off + len;
  let lastErr = null;
  for (const [has4obj, has5] of [[true, true], [false, true], [true, false], [false, false]]) {
    const marks = [], q = new R(buf, tailStart, sEnd);
    q.trace = (label, o) => marks.push([label, o]);
    try {
      const tail = parseTail(q, { has4obj, has5 });
      q.mark('flags');
      const flags = readFlagTable(q);
      if (!flags) throw new Error(`no flag table at 0x${q.o.toString(16)}`);
      // after the flag table: FString (+0x7320), TArray<FString> (FUN_140ecf230), int32 (+0x7340),
      // TMap<FString, FString> (+0x7348)
      flags.after = { strings: q.arr(q => q.str()), i7340: q.i32(), map: q.arr(q => ({ k: q.str(), v: q.str() })) };
      if (q.o !== sEnd) throw new Error(`tail ends at 0x${q.o.toString(16)}, s1 ends at 0x${sEnd.toString(16)}`);
      q.mark('end');
      for (const [l, o] of marks) r.trace(l, o);   // keep only the successful attempt's marks
      out.tail = tail; out.flags = flags; out.parsedTo = q.o;
      return out;
    } catch (e) { lastErr = e; }
  }
  out.tailError = lastErr && lastErr.message;
  out.flags = findFlagTable(buf, tailStart, sEnd);
  return out;
}

// ---- rest of s1 ---------------------------------------------------------------------------------------
const NEED = what => r => { throw new Error(`${what} not implemented (at 0x${r.o.toString(16)})`); };
const nameList = r => r.arr(r => r.name());
const vec3 = r => r.rep(3, r => r.f32());
// FUN_140d46e20: quaternion, translation, scale
const xform = r => ({ q: r.rep(4, r => r.f32()), t: vec3(r), s: vec3(r) });
// FUN_140f94440: one map panel cell (the 9 bytes at +0x14..+0x1c are written widened to int32)
const panelCell = r => {
  const c = {
    b0: r.u8(), b1: r.u8(), h2: r.u16(), i4: r.i32(), b8: r.rep(4, r => r.u8()), name: r.name(),
    b14: r.rep(9, r => r.i32()), i24: r.i32(), i28: r.i32(), i2c: r.i32(), names30: nameList(r),
    b1d: r.rep(3, r => r.u8()), i20: r.i32(), namesE0: nameList(r),
  };
  c.map40 = r.arr(r => ({ k: r.i32(), v: NEED('FUN_140f94d30')(r) }));
  c.if0 = r.i32();
  return c;
};
// FUN_140fa0110: a panel grid (u8, three u16 sizes, cells)
const panelGrid = r => ({ b: r.u8(), w: r.u16(), h: r.u16(), d: r.u16(), cells: r.arr(panelCell) });
// FUN_140f941a0: the map's panel scene. Neither the panel count nor each panel's grid count is in the
// stream; they are taken as the first int and 1 (checked by the exact landing on the flag table).
const mapScene = r => {
  const s = { a: r.i32(), b: r.i32() };
  s.panels = r.rep(s.a, r => ({ h: r.u16(), grids: [panelGrid(r)], names: nameList(r) }));
  s.set = r.arr(r => ({ id: r.name(), v: r.i32() }));   // FUN_140f81b30
  s.flag = r.bool();
  return s;
};
// FUN_140debcf0 (unit parameters + a few fields) and FUN_140ded010 (unit record + 3 fields); untested,
// the sample has none. FUN_140debfa0 (battle actor with polymorphic lists) is not implemented.
const actorB = r => withGuesses(r, r => ({
  p: unitParams(r), i408: r.i32(), f40d: r.bool(), f40c: r.bool(), b40e: r.u8(), b40f: r.u8(), f411: r.bool(), i414: r.i32(), i418: r.i32(),
}));
const unitEx = r => withGuesses(r, r => ({ unit: unit(r), i448: r.i32(), i44c: r.i32(), f450: r.bool() }));
// FUN_140cbd1b0
const cbd1b0 = r => {
  const o = { f: r.bool(), i: r.rep(3, r => r.i32()), v: r.rep(3, r => r.i32()), b: r.u8(), i20: r.i32(), f24: r.bool() };
  o.names28 = nameList(r); o.names38 = nameList(r); o.ints48 = r.arr(r => r.i32()); o.names58 = nameList(r);
  return o;
};
// FUN_140d5b9e0
const objD5b9e0 = r => {
  const o = { b: r.u8(), map: nameIntMap(r), units: r.arr(unitEx), bytes: r.arr(r => r.u8()) };
  o.recs = r.arr(r => ({ f: r.bool(), n1: r.name(), n2: r.name(), n3: r.name(), i: r.i32(), f2: r.bool(), i2: r.i32(), b: r.u8() }));
  return o;
};
// FUN_140d3a770
const objD3a770 = r => ({
  a: r.arr(r => ({ i: r.i32(), j: r.i32(), b: r.u8(), n: r.name(), f: r.bool() })),
  b: r.arr(r => ({ n: r.name(), f: r.bool() })), c: nameList(r), d: nameList(r), e: nameList(r),
  f: r.arr(r => ({ n: r.name(), v: r.i32() })), g: r.bool(), h: r.i32(),
});
function parseTail(r, opts) {
  const t = {};
  // 3. FUN_140d39a50: map (FUN_140d5bf90), battle state
  r.mark('fn3');
  const m = t.map = { name: r.str(), hasScene: r.bool() };
  if (m.hasScene) m.scene = mapScene(r);
  m.actorsA = r.arr(r => ({ k: r.i32(), v: NEED('FUN_140debfa0')(r) }));
  m.actorsB = r.arr(r => ({ k: r.i32(), v: actorB(r) }));
  m.i200 = r.i32();
  t.cbacb0 = r.arr(r => ({ id: r.name(), v: cbd1b0(r) }));
  t.objs = r.arr(objD5b9e0);
  t.ints5 = r.rep(5, r => r.i32());
  t.has3a770 = r.bool();
  if (t.has3a770) t.d3a770 = objD3a770(r);
  t.d3ae50 = { set: r.arr(r => ({ n: r.name(), v: r.i32() })), list: r.arr(r => ({ a: r.u8(), b: r.u8(), n: r.name(), i: r.i32(), f: r.bool() })) };
  t.maps4 = r.rep(4, nameIntMap);
  t.if0 = r.i32(); t.ff4 = r.bool();
  t.d3c700 = { i: r.i32(), n: r.name() };
  t.i80 = r.i32(); t.i94 = r.i32(); t.i98 = r.i32(); t.f9c = r.rep(4, r => r.bool());
  t.ia0 = r.i32(); t.ia4 = r.i32(); t.ia8 = r.i32(); t.i10c = r.i32();
  t.d3cb50 = r.rep(4, r => r.i32());
  t.names118 = nameList(r);
  t.i58 = r.i32();
  // 4. FUN_140d5c7e0: camera (FUN_140d5cff0), player, a transform, then FUN_140f95270 if that object exists
  r.mark('fn4');
  const f4 = t.fn4 = { hasCam: r.bool() };
  if (f4.hasCam) f4.cam = r.rep(5, r => r.f32());
  f4.hasPlayer = r.bool();
  if (f4.hasPlayer) { f4.player = r.name(); f4.playerXform = xform(r); }
  f4.n164 = r.name(); f4.xformE0 = xform(r);
  if (opts.has4obj) f4.f95270 = r.arr(r => ({ a: r.i32(), b: r.i32(), c: r.i32(), f: r.bool() }));
  // 5. FUN_140d5ce30 -> FUN_14114f070: world-map state, if the world map exists
  r.mark('fn5');
  if (opts.has5) {
    const f5 = t.fn5 = { a: r.i32(), b: r.i32(), icons: nameList(r), v: vec3(r), b1fc: r.u8(), i200: r.i32(), n204: r.name(), b20c: r.u8() };
    f5.list = r.arr(r => ({ x: xform(r), b: r.u8(), ints: r.arr(r => r.i32()) }));
    f5.icons2 = nameList(r); f5.n180 = r.name(); f5.s188 = r.str(); f5.f20d = r.bool(); f5.f11d = r.bool();
  }
  // 6. FUN_140ef6310 begins with FUN_140ef6880: the reflected enum ELuaSysGlobal, written like the flag
  // table (count = entries - 1, indices 1 .. count-1), each {FString name, int32 isString, int32 or FString}
  r.mark('fn6');
  const n = r.i32(); t.sysGlobals = [];
  for (let i = 1; i < n; i++) {
    const name = r.str(), isStr = r.i32();
    t.sysGlobals.push({ name, v: isStr ? r.str() : r.i32() });
  }
  return t;
}

// The event flag table (FUN_140ef6310) walks the reflected enum ELuaFlag: int32 count (= enum entries
// - 1, i.e. without _MAX), then {FString name, bool as int32} for enum indices 1 .. count-1 (index 0 is
// skipped), so it holds count - 1 entries in enum declaration order. Next comes an FString (+0x7320).
function readFlagTable(q) {
  const countAt = q.o, n = q.i32();
  if (n < 200 || n > 100000) return null;
  const entries = [];
  for (let i = 1; i < n; i++) {
    const s = q.str(); if (!/^[A-Za-z0-9_]{2,80}$/.test(s)) return null;
    entries.push({ id: s, v: q.at(q.i32) });
  }
  const endAt = q.o;
  return { countAt, endAt, entries, nextStr: q.str() };
}
// fallback: find the flag table by its shape
function findFlagTable(b, from, end) {
  for (let p = from; p < end - 8; p++) {
    const n = b.readInt32LE(p);
    if (n < 200 || n > 100000) continue;
    const L = b.readInt32LE(p + 4); if (L < 3 || L > 81 || b[p + 8 + L - 1] !== 0) continue;
    try { const t = readFlagTable(new R(b, p, end)); if (t) return t; } catch { }
  }
  return null;
}

if (typeof module === 'object' && module.exports) module.exports = { R, parseS1 };
else root.TSParse = { R, parseS1 };
})(typeof globalThis !== 'undefined' ? globalThis : this);

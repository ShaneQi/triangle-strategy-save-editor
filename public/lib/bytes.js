// Minimal Node-Buffer subset for browsers (only what core.js / s1parse.js use).
// In Node the real Buffer is used and this file does nothing.
(function (g) {
  'use strict';
  if (typeof g.Buffer !== 'undefined') return;
  const te = new TextEncoder();
  class Buf extends Uint8Array {
    static from(x, off, len) {
      if (x instanceof ArrayBuffer) return new Buf(x, off || 0, len === undefined ? x.byteLength - (off || 0) : len);
      if (typeof x === 'string') return Buf.from(te.encode(x));
      const b = new Buf(x.length); b.set(x); return b;
    }
    static alloc(n) { return new Buf(n); }
    static isBuffer(x) { return x instanceof Buf; }
    static concat(list) {
      const out = new Buf(list.reduce((n, x) => n + x.length, 0)); let o = 0;
      for (const x of list) { out.set(x, o); o += x.length; }
      return out;
    }
    get dv() { return new DataView(this.buffer, this.byteOffset, this.byteLength); }
    readInt32LE(o) { return this.dv.getInt32(o, true); }
    readUInt32LE(o) { return this.dv.getUint32(o, true); }
    readUInt16LE(o) { return this.dv.getUint16(o, true); }
    readFloatLE(o) { return this.dv.getFloat32(o, true); }
    readBigUInt64LE(o) { return this.dv.getBigUint64(o, true); }
    writeInt32LE(v, o) { this.dv.setInt32(o, v, true); return o + 4; }
    writeUInt32LE(v, o) { this.dv.setUint32(o, v, true); return o + 4; }
    writeBigUInt64LE(v, o) { this.dv.setBigUint64(o, v, true); return o + 8; }
    equals(b) { if (b.length !== this.length) return false; for (let i = 0; i < b.length; i++) if (b[i] !== this[i]) return false; return true; }
    copy(t, ts = 0) { t.set(this, ts); return this.length; }
    write(s, o = 0) { for (let i = 0; i < s.length; i++) this[o + i] = s.charCodeAt(i) & 255; return s.length; }
    toString(enc = 'utf8', s = 0, e = this.length) {
      const v = this.subarray(s, e);
      if (enc === 'latin1') { let r = ''; for (let i = 0; i < v.length; i += 8192) r += String.fromCharCode.apply(null, v.subarray(i, i + 8192)); return r; }
      if (enc === 'utf16le') return new TextDecoder('utf-16le').decode(v);
      if (enc === 'hex') { let r = ''; for (const x of v) r += (x < 16 ? '0' : '') + x.toString(16); return r; }
      return new TextDecoder().decode(v);
    }
    _pat(p) { return typeof p === 'string' ? Uint8Array.from(p, c => c.charCodeAt(0) & 255) : p; }
    indexOf(p, from = 0) {
      if (typeof p === 'number') return super.indexOf(p, from);
      p = this._pat(p); const n = p.length, last = this.length - n, f = p[0];
      for (let i = Math.max(0, from); i <= last; i++) {
        if (this[i] !== f) continue;
        let k = 1; while (k < n && this[i + k] === p[k]) k++;
        if (k === n) return i;
      }
      return -1;
    }
    lastIndexOf(p, from = this.length) {
      if (typeof p === 'number') return super.lastIndexOf(p, from);
      p = this._pat(p); const n = p.length;
      for (let i = Math.min(from, this.length - n); i >= 0; i--) {
        let k = 0; while (k < n && this[i + k] === p[k]) k++;
        if (k === n) return i;
      }
      return -1;
    }
  }
  g.Buffer = Buf;
})(typeof globalThis !== 'undefined' ? globalThis : this);

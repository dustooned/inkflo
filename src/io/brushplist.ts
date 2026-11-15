// Adapted from the original 2Dope brush plist reader, src/io/brushimport.ts at 2c8ae1f.

/** A keyed-archive reference. */
export interface Uid {
  uid: number;
}

const isUid = (v: unknown): v is Uid => typeof v === 'object' && v !== null && 'uid' in v && Object.keys(v).length === 1;
/** XML archives write references as { CF$UID: n }. */
const asUid = (v: unknown): Uid | null => (isUid(v) ? v : typeof v === 'object' && v !== null && 'CF$UID' in v && Object.keys(v).length === 1 ? { uid: Number((v as Record<string, unknown>)['CF$UID']) } : null);

/** Parse a binary property list (bplist00). */
export function parseBplist(b: Uint8Array): unknown {
  if (b.length < 40 || String.fromCharCode(...b.subarray(0, 8)) !== 'bplist00') throw new Error('not a binary property list');
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const t = b.length - 32;
  const offSize = b[t + 6]!;
  const refSize = b[t + 7]!;
  const count = Number(v.getBigUint64(t + 8));
  const top = Number(v.getBigUint64(t + 16));
  const tableAt = Number(v.getBigUint64(t + 24));
  if (offSize < 1 || offSize > 8 || refSize < 1 || refSize > 8 || count > 100_000 ||
      tableAt < 8 || tableAt + count * offSize > t || top >= count) throw new Error('corrupt property list');
  const uint = (at: number, n: number) => {
    let x = 0;
    for (let i = 0; i < n; i++) x = x * 256 + b[at + i]!;
    return x;
  };
  const offsets = Array.from({ length: count }, (_, i) => uint(tableAt + i * offSize, offSize));
  const cache = new Map<number, unknown>();
  const read = (ref: number, depth: number): unknown => {
    if (depth > 64) throw new Error('property list nests too deeply');
    if (cache.has(ref)) return cache.get(ref);
    const at = offsets[ref];
    if (at === undefined || at < 8 || at >= tableAt) throw new Error('corrupt property list');
    const marker = b[at]!;
    const type = marker >> 4;
    const info = marker & 15;
    let p = at + 1;
    const need = (n: number) => {
      if (!Number.isSafeInteger(n) || n < 0 || p + n > tableAt) throw new Error('corrupt property list');
    };
    const length = () => {
      if (info !== 15) return info;
      need(1);
      const m = b[p]!;
      if (m >> 4 !== 1 || (m & 15) > 3) throw new Error('corrupt property list length');
      const n = 1 << (m & 15);
      need(1 + n);
      const len = uint(p + 1, n);
      p += 1 + n;
      return len;
    };
    let out: unknown;
    switch (type) {
      case 0x0:
        out = info === 8 ? false : info === 9 ? true : null;
        break;
      case 0x1: {
        const n = 1 << info;
        need(n);
        out = n === 8 ? Number(v.getBigInt64(p)) : uint(p, n);
        break;
      }
      case 0x2:
        need(info === 2 ? 4 : 8);
        out = info === 2 ? v.getFloat32(p) : v.getFloat64(p);
        break;
      case 0x3:
        need(8);
        out = v.getFloat64(p);
        break;
      case 0x4: {
        const n = length();
        need(n);
        out = b.slice(p, p + n);
        break;
      }
      case 0x5: {
        const n = length();
        need(n);
        out = new TextDecoder().decode(b.subarray(p, p + n));
        break;
      }
      case 0x6: {
        const n = length();
        need(n * 2);
        let s = '';
        for (let i = 0; i < n; i++) s += String.fromCharCode(v.getUint16(p + i * 2));
        out = s;
        break;
      }
      case 0x8:
        need(info + 1);
        out = { uid: uint(p, info + 1) };
        break;
      case 0xa: {
        const n = length();
        need(n * refSize);
        const arr: unknown[] = [];
        cache.set(ref, arr);
        for (let i = 0; i < n; i++) arr.push(read(uint(p + i * refSize, refSize), depth + 1));
        return arr;
      }
      case 0xd: {
        const n = length();
        need(n * refSize * 2);
        const obj: Record<string, unknown> = Object.create(null);
        cache.set(ref, obj);
        for (let i = 0; i < n; i++) {
          const k = read(uint(p + i * refSize, refSize), depth + 1);
          obj[String(k)] = read(uint(p + (n + i) * refSize, refSize), depth + 1);
        }
        return obj;
      }
      default:
        out = null;
    }
    cache.set(ref, out);
    return out;
  };
  return read(top, 0);
}

/** Parse an XML property list (the subset brush files use). */
export function parseXmlPlist(text: string): unknown {
  const tokens = text.replace(/<\?[^>]*\?>|<!DOCTYPE[^>]*>|<!--[\s\S]*?-->/g, '').match(/<[^>]+>|[^<]+/g) ?? [];
  let i = 0;
  const unescape = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
  const next = () => {
    while (i < tokens.length && !tokens[i]!.trim()) i++;
    return tokens[i++];
  };
  const text_ = (tag: string) => {
    let s = '';
    while (i < tokens.length && tokens[i] !== `</${tag}>`) s += tokens[i++];
    i++;
    return unescape(s.trim());
  };
  const value = (depth: number): unknown => {
    if (depth > 64) throw new Error('property list nests too deeply');
    const tag = next();
    if (!tag) throw new Error('property list ends early');
    if (tag === '<plist>' || tag.startsWith('<plist ')) return value(depth);
    if (tag === '<dict/>') return {};
    if (tag === '<array/>') return [];
    if (tag === '<true/>') return true;
    if (tag === '<false/>') return false;
    if (tag === '<string/>') return '';
    if (tag === '<dict>') {
      const obj: Record<string, unknown> = Object.create(null);
      for (;;) {
        const k = next();
        if (k === '</dict>') return obj;
        if (k !== '<key>') throw new Error('bad property list');
        const key = text_('key');
        obj[key] = value(depth + 1);
      }
    }
    if (tag === '<array>') {
      const arr: unknown[] = [];
      for (;;) {
        while (i < tokens.length && !tokens[i]!.trim()) i++;
        if (tokens[i] === '</array>') {
          i++;
          return arr;
        }
        arr.push(value(depth + 1));
      }
    }
    const m = /^<(string|integer|real|date|data)>$/.exec(tag);
    if (m) {
      const s = text_(m[1]!);
      if (m[1] === 'integer' || m[1] === 'real') return Number(s);
      return s;
    }
    throw new Error(`unexpected ${tag} in property list`);
  };
  return value(0);
}

export function parsePlist(b: Uint8Array): unknown {
  if (b.length >= 8 && String.fromCharCode(...b.subarray(0, 6)) === 'bplist') return parseBplist(b);
  return parseXmlPlist(new TextDecoder().decode(b));
}

/** The root object of an NSKeyedArchiver plist, its references resolved (a few levels deep). */
export function unarchive(plist: unknown): Record<string, unknown> | null {
  if (!plist || typeof plist !== 'object' || Array.isArray(plist) || plist instanceof Uint8Array) return null;
  const p = plist as { $objects?: unknown[]; $top?: Record<string, unknown> };
  if (!Array.isArray(p.$objects) || !p.$top) return plist as Record<string, unknown>;
  const objects = p.$objects;
  let budget = 50_000;
  // nested objects (response curves: { points: { NS.objects: ['{0, 0}', …] } }) resolve too, a few levels deep
  const resolve = (x: unknown, depth: number): unknown => {
    if (--budget < 0) throw new Error('brush settings are too complex');
    if (depth > 8) return null;
    const u = asUid(x);
    if (u) return resolve(objects[u.uid], depth + 1);
    if (x === '$null') return null;
    if (Array.isArray(x)) return x.map((v) => resolve(v, depth + 1));
    if (x && typeof x === 'object' && !(x instanceof Uint8Array)) {
      const o: Record<string, unknown> = Object.create(null);
      for (const [k, v] of Object.entries(x)) if (k !== '$class') o[k] = resolve(v, depth + 1);
      return o;
    }
    return x;
  };
  const rootRef = p.$top.root ?? Object.values(p.$top)[0];
  const root = resolve(rootRef, 0);
  if (!root || typeof root !== 'object' || Array.isArray(root)) return null;
  return root as Record<string, unknown>;
}

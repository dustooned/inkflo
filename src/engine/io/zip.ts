// Vendored from 2Dope src/io/zip.ts @ 707f793. Do not edit in place; see docs/2DOPE-REUSE-INVENTORY.md.
/**
 * Minimal ZIP support, no dependencies. Writes STORE entries (PNG is already compressed, and JSON
 * is small) with a fixed timestamp so the same project always produces the same bytes. Reads
 * STORE and DEFLATE entries (files saved by other zip tools still open) and is defensive: students
 * share these files, so names, sizes and checksums are all checked.
 */

export interface ZipFile {
  name: string;
  data: Uint8Array;
}

export class ZipError extends Error {}

const MAX_ENTRIES = 50_000;
const MAX_FILE_BYTES = 512 * 1024 * 1024;
const MAX_TOTAL_BYTES = 1024 * 1024 * 1024;

let crcTable: Uint32Array | null = null;

export function crc32(data: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = crcTable[(c ^ data[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const enc = new TextEncoder();
const dec = new TextDecoder('utf-8', { fatal: true });

/** A path that is safe to treat as relative to the archive root. */
export function safeName(name: string): boolean {
  if (!name || name.length > 255) return false;
  if (name.startsWith('/') || name.includes('\\') || /^[A-Za-z]:/.test(name) || name.includes('\0')) return false;
  return !name.split('/').some((part) => part === '..');
}

export function writeZip(files: ZipFile[]): Uint8Array {
  if (files.length > MAX_ENTRIES) throw new ZipError('too many files');
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const f of files) {
    if (!safeName(f.name)) throw new ZipError(`unsafe file name: ${f.name}`);
    const name = enc.encode(f.name);
    const crc = crc32(f.data);
    const local = new Uint8Array(30 + name.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, 0x0800, true); // UTF-8 names
    lv.setUint16(8, 0, true); // STORE
    lv.setUint16(10, 0, true); // time 00:00
    lv.setUint16(12, 0x21, true); // date 1980-01-01
    lv.setUint32(14, crc, true);
    lv.setUint32(18, f.data.length, true);
    lv.setUint32(22, f.data.length, true);
    lv.setUint16(26, name.length, true);
    lv.setUint16(28, 0, true);
    local.set(name, 30);

    const cd = new Uint8Array(46 + name.length);
    const cv = new DataView(cd.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x0800, true);
    cv.setUint16(10, 0, true);
    cv.setUint16(12, 0, true);
    cv.setUint16(14, 0x21, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, f.data.length, true);
    cv.setUint32(24, f.data.length, true);
    cv.setUint16(28, name.length, true);
    cv.setUint32(42, offset, true);
    cd.set(name, 46);

    chunks.push(local, f.data);
    central.push(cd);
    offset += local.length + f.data.length;
    if (offset > 0xfffffff0) throw new ZipError('archive too large (over 4 GB)');
  }
  const cdSize = central.reduce((n, c) => n + c.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, offset, true);
  const all = [...chunks, ...central, end];
  const out = new Uint8Array(all.reduce((n, c) => n + c.length, 0));
  let p = 0;
  for (const c of all) {
    out.set(c, p);
    p += c.length;
  }
  return out;
}

async function inflateRaw(data: Uint8Array, expected: number): Promise<Uint8Array> {
  const ds = new DecompressionStream('deflate-raw');
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(ds);
  const reader = stream.getReader();
  const parts: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > expected || total > MAX_FILE_BYTES) {
      await reader.cancel();
      throw new ZipError('entry is larger than its header says');
    }
    parts.push(value);
  }
  const out = new Uint8Array(total);
  let p = 0;
  for (const c of parts) {
    out.set(c, p);
    p += c.length;
  }
  return out;
}

/** Read every file in a ZIP. Throws ZipError for anything malformed, unsafe or corrupt. */
/**
 * Read a zip. `lenient` (brush files from other apps): an entry that cannot be read is skipped
 * instead of failing the whole archive.
 */
export async function readZip(buf: Uint8Array, opts: { lenient?: boolean } = {}): Promise<Map<string, Uint8Array>> {
  if (buf.length < 22) throw new ZipError('not a zip file');
  const v = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65535); i--) {
    if (v.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new ZipError('not a zip file (no end record)');
  const count = v.getUint16(eocd + 10, true);
  const cdOffset = v.getUint32(eocd + 16, true);
  if (count > MAX_ENTRIES) throw new ZipError('too many files');
  const out = new Map<string, Uint8Array>();
  let total = 0;
  let p = cdOffset;
  for (let n = 0; n < count; n++) {
    if (p + 46 > buf.length || v.getUint32(p, true) !== 0x02014b50) throw new ZipError('corrupt directory');
    const flags = v.getUint16(p + 8, true);
    const method = v.getUint16(p + 10, true);
    const crc = v.getUint32(p + 16, true);
    const csize = v.getUint32(p + 20, true);
    const usize = v.getUint32(p + 24, true);
    const nameLen = v.getUint16(p + 28, true);
    const extraLen = v.getUint16(p + 30, true);
    const commentLen = v.getUint16(p + 32, true);
    const local = v.getUint32(p + 42, true);
    if (p + 46 + nameLen > buf.length) throw new ZipError('corrupt directory');
    const at = p;
    p += 46 + nameLen + extraLen + commentLen;
    if (opts.lenient) {
      try {
        const one = await readEntry(buf, v, at, flags, method, crc, csize, usize, nameLen, local, out, total, lenientDec);
        if (one) { out.set(one.name, one.data); total += one.data.length; }
      } catch {
        // skipped: one unreadable entry does not spoil the rest
      }
      continue;
    }
    let name: string;
    try {
      name = dec.decode(buf.subarray(at + 46, at + 46 + nameLen));
    } catch {
      throw new ZipError('file name is not valid text');
    }
    if (name.endsWith('/')) continue; // directory entry
    if (!safeName(name)) throw new ZipError(`unsafe file name: ${name}`);
    if (out.has(name)) throw new ZipError(`duplicate file name: ${name}`);
    if (flags & 1) throw new ZipError('encrypted zip files are not supported');
    if (usize > MAX_FILE_BYTES) throw new ZipError(`${name} is too large`);
    total += usize;
    if (total > MAX_TOTAL_BYTES) throw new ZipError('archive is too large');
    if (local + 30 > buf.length || v.getUint32(local, true) !== 0x04034b50) throw new ZipError('corrupt entry');
    const start = local + 30 + v.getUint16(local + 26, true) + v.getUint16(local + 28, true);
    if (start + csize > buf.length) throw new ZipError('entry runs past the end of the file');
    const raw = buf.subarray(start, start + csize);
    let data: Uint8Array;
    if (method === 0) data = raw.slice();
    else if (method === 8) data = await inflateRaw(raw, usize);
    else throw new ZipError(`unsupported compression method ${method}`);
    if (data.length !== usize) throw new ZipError(`${name} has the wrong size`);
    if (crc32(data) !== crc) throw new ZipError(`${name} is corrupt (checksum mismatch)`);
    out.set(name, data);
  }
  return out;
}

const lenientDec = new TextDecoder('utf-8');

/** One entry of a lenient read (null for a directory); throws when it cannot be read. */
async function readEntry(buf: Uint8Array, v: DataView, at: number, flags: number, method: number, crc: number, csize: number, usize: number, nameLen: number, local: number, out: Map<string, Uint8Array>, total: number, decoder: TextDecoder): Promise<{ name: string; data: Uint8Array } | null> {
  const name = decoder.decode(buf.subarray(at + 46, at + 46 + nameLen));
  if (name.endsWith('/')) return null;
  if (!safeName(name) || out.has(name) || flags & 1) throw new ZipError('skipped');
  if (usize > MAX_FILE_BYTES || total + usize > MAX_TOTAL_BYTES) throw new ZipError('too large');
  if (local + 30 > buf.length || v.getUint32(local, true) !== 0x04034b50) throw new ZipError('corrupt entry');
  const start = local + 30 + v.getUint16(local + 26, true) + v.getUint16(local + 28, true);
  if (start + csize > buf.length) throw new ZipError('entry runs past the end of the file');
  const raw = buf.subarray(start, start + csize);
  let data: Uint8Array;
  if (method === 0) data = raw.slice();
  else if (method === 8) data = await inflateRaw(raw, usize);
  else throw new ZipError(`unsupported compression method ${method}`);
  // a wrong checksum is tolerated here: the picture or settings may still be good
  void crc;
  return { name, data };
}

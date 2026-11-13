import initSqlJs, { type Database } from 'sql.js';
import wasmUrl from 'sql.js/dist/sql-wasm-browser.wasm?url';

const HEADER = 'SQLite format 3\0';
const PNG = [137, 80, 78, 71, 13, 10, 26, 10];
type Row = Record<string, string | number | Uint8Array | null>;
const fields = ['BrushSize', 'BrushHardness', 'Opacity', 'BrushFlow', 'BrushInterval', 'BrushAutoIntervalType',
  'BrushThickness', 'BrushRotation', 'BrushUseRevision', 'BrushRevision', 'AntiAlias', 'BrushUsePatternImage', 'BrushRibbon',
  'BrushUseSpray', 'TextureImage'] as const;
export type SutField = typeof fields[number];

/** Clip Studio material blobs can contain previews followed by the embedded brush stamp. */
function embeddedStamp(data: Uint8Array): Uint8Array<ArrayBuffer> | undefined {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let stamp: Uint8Array<ArrayBuffer> | undefined;
  for (let start = data.indexOf(PNG[0]!); start >= 0 && start + 33 <= data.length; start = data.indexOf(PNG[0]!, start + 1)) {
    if (!PNG.every((byte, i) => data[start + i] === byte) || view.getUint32(start + 8) !== 13 || view.getUint32(start + 12) !== 0x49484452) continue;
    const w = view.getUint32(start + 16), h = view.getUint32(start + 20);
    if (!w || !h || w * h > 16_777_216) continue;
    for (let p = start + 8; p + 12 <= data.length;) {
      const length = view.getUint32(p), type = view.getUint32(p + 4);
      const end = p + 12 + length;
      if (end > data.length) break;
      if (type === 0x49454e44 && !length) {
        stamp = new Uint8Array(data.subarray(start, end));
        start = end - 1;
        break;
      }
      p = end;
    }
  }
  return stamp;
}

let sqlite: ReturnType<typeof initSqlJs> | undefined;

export async function readSut(bytes: Uint8Array): Promise<{ name: string; settings: Partial<Record<SutField, Row[string]>>; images: Uint8Array<ArrayBuffer>[]; limited: boolean }> {
  if (new TextDecoder().decode(bytes.subarray(0, HEADER.length)) !== HEADER) throw new Error('This is not a readable Clip Studio .sut brush file.');
  const { Database: SqlDatabase } = await (sqlite ??= initSqlJs({ locateFile: () => wasmUrl }).catch((error) => { sqlite = undefined; throw error; }));
  let db: Database | undefined;
  try {
    db = new SqlDatabase(bytes);
    db.run('PRAGMA query_only = ON; PRAGMA trusted_schema = OFF');
    const schema = db.exec("SELECT name FROM sqlite_schema WHERE type = 'table' AND sql LIKE 'CREATE TABLE%' AND name IN ('Node','Variant','MaterialFile')");
    const tables = new Set(schema[0]?.values.map(([name]) => name));
    if (!tables.has('Node') || !tables.has('Variant')) throw new Error('This file does not contain a Clip Studio brush preset.');
    const node = db.exec('SELECT NodeName, NodeVariantID FROM Node ORDER BY _PW_ID LIMIT 1')[0]?.values[0];
    if (!node) throw new Error('This file does not contain a Clip Studio brush preset.');
    const columns = new Set(db.exec('PRAGMA table_info(Variant)')[0]?.values.map((row) => row[1]));
    const available = fields.filter((field) => columns.has(field));
    if (!available.includes('BrushSize')) throw new Error('This Clip Studio sub tool has no brush settings.');
    const settings: Partial<Record<SutField, Row[string]>> = {};
    const selected = db.exec(`SELECT ${available.join(', ')} FROM Variant WHERE VariantID = ? LIMIT 1`, [node[1]!])[0]?.values[0];
    if (!selected) throw new Error('This Clip Studio sub tool has no active brush settings.');
    available.forEach((field, i) => { settings[field] = selected[i]!; });
    const images: Uint8Array<ArrayBuffer>[] = [];
    let limited = false;
    if (tables.has('MaterialFile') && settings.BrushUsePatternImage) {
      const materialColumns = new Set(db.exec('PRAGMA table_info(MaterialFile)')[0]?.values.map((row) => row[1]));
      const path = materialColumns.has('OriginalPath') ? 'OriginalPath' : "''";
      const records = db.prepare(`SELECT FileData, ${path} FROM MaterialFile WHERE length(FileData) <= 16777216 ORDER BY _PW_ID LIMIT 32`);
      try {
        while (records.step()) {
          if (images.length >= 16) { limited = true; break; }
          const [data, materialPath] = records.get();
          if (!(data instanceof Uint8Array) || (typeof materialPath === 'string' && materialPath && !materialPath.endsWith('.layer'))) continue;
          const image = embeddedStamp(data);
          if (image) images.push(image);
        }
      } finally { records.free(); }
    }
    if (settings.BrushUsePatternImage && !images.length) throw new Error('This Clip Studio brush references a tip that is not embedded. Import its PNG tip or the original ABR instead.');
    return { name: typeof node[0] === 'string' ? node[0] : '', settings, images, limited };
  } finally { db?.close(); }
}

/**
 * A small PDF writer for print exports: pages with embedded images (lossless, Flate-compressed
 * RGB, optionally with an alpha mask), lines, rectangles and Helvetica text, plus TrimBox and
 * BleedBox so print shops see the trim. Units are points (72 per inch); y goes up from the
 * bottom, as PDF does. Compression is passed in, so tests run in Node (zlib) and the app uses the
 * browser's CompressionStream.
 */

export type Deflate = (bytes: Uint8Array) => Promise<Uint8Array>;

export interface PdfImage {
  name: string;
  w: number;
  h: number;
}

interface PageRec {
  w: number;
  h: number;
  content: string;
  images: Set<string>;
  trim?: [number, number, number, number];
  bleed?: [number, number, number, number];
}

const enc = new TextEncoder();
const num = (v: number) => (Math.round(v * 1000) / 1000).toString();

/** Text for a PDF string literal (Latin-1 only; anything else becomes '?'). */
function pdfText(s: string): string {
  return s.replace(/[\\()]/g, (c) => `\\${c}`).replace(/[^\x20-\x7e]/g, (c) => (c === '—' || c === '–' ? '-' : c === '“' || c === '”' ? '"' : c === '’' ? "'" : c === '×' ? 'x' : c === '″' ? 'in' : '?'));
}

/** Drawing commands for one page. */
export class PdfPage {
  private ops: string[] = [];
  readonly images = new Set<string>();
  constructor(readonly w: number, readonly h: number) {}

  /** Draw an image into a box (x, y = bottom-left), optionally rotated 180° about the box centre. */
  image(img: PdfImage, x: number, y: number, w: number, h: number, rotate180 = false): this {
    this.images.add(img.name);
    if (rotate180) this.ops.push(`q -1 0 0 -1 ${num(x + w)} ${num(y + h)} cm ${num(w)} 0 0 ${num(h)} 0 0 cm /${img.name} Do Q`);
    else this.ops.push(`q ${num(w)} 0 0 ${num(h)} ${num(x)} ${num(y)} cm /${img.name} Do Q`);
    return this;
  }

  line(x0: number, y0: number, x1: number, y1: number, width = 0.25, gray = 0, dash?: number[]): this {
    this.ops.push(`q ${num(width)} w ${num(gray)} G ${dash ? `[${dash.map(num).join(' ')}] 0 d ` : ''}${num(x0)} ${num(y0)} m ${num(x1)} ${num(y1)} l S Q`);
    return this;
  }

  rect(x: number, y: number, w: number, h: number, fillGray: number): this {
    this.ops.push(`q ${num(fillGray)} g ${num(x)} ${num(y)} ${num(w)} ${num(h)} re f Q`);
    return this;
  }

  text(s: string, x: number, y: number, size = 10, bold = false): this {
    this.ops.push(`BT /${bold ? 'F2' : 'F1'} ${num(size)} Tf ${num(x)} ${num(y)} Td (${pdfText(s)}) Tj ET`);
    return this;
  }

  /** Crop marks at the corners of a trim box, kept `offset` outside it. */
  cropMarks(x: number, y: number, w: number, h: number, offset: number, len = 18): this {
    for (const [cx, cy] of [[x, y], [x + w, y], [x, y + h], [x + w, y + h]] as const) {
      const dx = cx === x ? -1 : 1;
      const dy = cy === y ? -1 : 1;
      this.line(cx + dx * offset, cy, cx + dx * (offset + len), cy, 0.25);
      this.line(cx, cy + dy * offset, cx, cy + dy * (offset + len), 0.25);
    }
    return this;
  }

  get content(): string {
    return this.ops.join('\n');
  }
}

export class PdfDoc {
  private imgs: { name: string; w: number; h: number; rgb: Uint8Array; alpha: Uint8Array | null }[] = [];
  private pages: PageRec[] = [];

  constructor(private readonly deflate: Deflate, readonly title = '') {}

  /**
   * Add an image from RGBA pixels (alpha kept as a soft mask only when not fully opaque). It is
   * compressed now, so a long book never holds its raw pages in memory.
   */
  async addImage(rgba: Uint8ClampedArray | Uint8Array, w: number, h: number): Promise<PdfImage> {
    const n = w * h;
    const rgb = new Uint8Array(n * 3);
    let alpha: Uint8Array | null = null;
    for (let i = 0; i < n; i++) {
      rgb[i * 3] = rgba[i * 4]!;
      rgb[i * 3 + 1] = rgba[i * 4 + 1]!;
      rgb[i * 3 + 2] = rgba[i * 4 + 2]!;
      const a = rgba[i * 4 + 3]!;
      if (a !== 255) {
        alpha ??= new Uint8Array(n).fill(255);
        alpha[i] = a;
      }
    }
    const name = `Im${this.imgs.length + 1}`;
    this.imgs.push({ name, w, h, rgb: await this.deflate(rgb), alpha: alpha ? await this.deflate(alpha) : null });
    return { name, w, h };
  }

  addPage(page: PdfPage, boxes: { trim?: [number, number, number, number]; bleed?: [number, number, number, number] } = {}): void {
    this.pages.push({ w: page.w, h: page.h, content: page.content, images: page.images, ...boxes });
  }

  get pageCount(): number {
    return this.pages.length;
  }

  async build(): Promise<Uint8Array> {
    const objs: Uint8Array[][] = []; // object number - 1 → parts
    const alloc = () => {
      objs.push([]);
      return objs.length;
    };
    const set = (id: number, ...parts: (string | Uint8Array)[]) => {
      objs[id - 1] = parts.map((p) => (typeof p === 'string' ? enc.encode(p) : p));
    };
    /** A Flate stream: `raw` bytes are compressed here, otherwise they already are. */
    const stream = async (id: number, dict: string, data: Uint8Array, raw = true) => {
      const body = raw ? await this.deflate(data) : data;
      set(id, `<< ${dict} /Filter /FlateDecode /Length ${body.length} >>\nstream\n`, body, '\nendstream');
    };

    const catalog = alloc();
    const pagesId = alloc();
    const f1 = alloc();
    const f2 = alloc();
    set(f1, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
    set(f2, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
    const imgIds = new Map<string, number>();
    for (const im of this.imgs) {
      const id = alloc();
      imgIds.set(im.name, id);
      let smask = '';
      if (im.alpha) {
        const sid = alloc();
        await stream(sid, `/Type /XObject /Subtype /Image /Width ${im.w} /Height ${im.h} /ColorSpace /DeviceGray /BitsPerComponent 8`, im.alpha, false);
        smask = ` /SMask ${sid} 0 R`;
      }
      await stream(id, `/Type /XObject /Subtype /Image /Width ${im.w} /Height ${im.h} /ColorSpace /DeviceRGB /BitsPerComponent 8${smask}`, im.rgb, false);
    }
    const pageIds: number[] = [];
    for (const p of this.pages) {
      const pid = alloc();
      const cid = alloc();
      pageIds.push(pid);
      await stream(cid, '', enc.encode(p.content));
      const xo = [...p.images].map((n) => `/${n} ${imgIds.get(n)} 0 R`).join(' ');
      const box = (k: string, b?: number[]) => (b ? ` /${k} [${b.map(num).join(' ')}]` : '');
      set(pid, `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${num(p.w)} ${num(p.h)}]${box('TrimBox', p.trim)}${box('BleedBox', p.bleed)} /Resources << /Font << /F1 ${f1} 0 R /F2 ${f2} 0 R >>${xo ? ` /XObject << ${xo} >>` : ''} >> /Contents ${cid} 0 R >>`);
    }
    set(pagesId, `<< /Type /Pages /Kids [${pageIds.map((i) => `${i} 0 R`).join(' ')}] /Count ${pageIds.length} >>`);
    set(catalog, `<< /Type /Catalog /Pages ${pagesId} 0 R >>`);
    const info = alloc();
    set(info, `<< /Title (${pdfText(this.title)}) /Producer (inkflo) >>`);

    // assemble with byte offsets
    const chunks: Uint8Array[] = [enc.encode('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n')];
    let offset = chunks[0]!.length;
    const offsets: number[] = [];
    objs.forEach((parts, i) => {
      offsets.push(offset);
      const head = enc.encode(`${i + 1} 0 obj\n`);
      const tail = enc.encode('\nendobj\n');
      chunks.push(head, ...parts, tail);
      offset += head.length + parts.reduce((a, p) => a + p.length, 0) + tail.length;
    });
    const xref = [`xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`, ...offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`)].join('');
    chunks.push(enc.encode(`${xref}trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R /Info ${info} 0 R >>\nstartxref\n${offset}\n%%EOF\n`));
    const total = chunks.reduce((a, c) => a + c.length, 0);
    const out = new Uint8Array(total);
    let at = 0;
    for (const c of chunks) {
      out.set(c, at);
      at += c.length;
    }
    return out;
  }
}

/** zlib deflate with the browser's CompressionStream ("deflate" = zlib, which FlateDecode reads). */
export const browserDeflate: Deflate = async (bytes) => {
  const cs = new CompressionStream('deflate');
  const out = new Response(new Blob([bytes as BlobPart]).stream().pipeThrough(cs));
  return new Uint8Array(await out.arrayBuffer());
};

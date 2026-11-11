import type { Clock } from '../io/autosave';
import type { PageArt, PlaneOps } from '../draw/residency';

/** A stand-in canvas: its "pixels" are a string, '' means blank. */
export interface FakeCanvas {
  width: number;
  height: number;
  px: string;
}

export const fake = (c: HTMLCanvasElement | null | undefined) => c as unknown as FakeCanvas;

export function fakeCanvas(w: number, h: number, px = ''): HTMLCanvasElement {
  return { width: w, height: h, px } as unknown as HTMLCanvasElement;
}

/** Canvas ops over fake canvases. `log` records encodes, so tests can see what was re-encoded. */
export function fakeOps(log: string[] = []): PlaneOps {
  const enc = new TextEncoder();
  const dec = new TextDecoder();
  return {
    isBlank: (c) => fake(c).px === '',
    encode: (c) => {
      const px = fake(c).px; // snapshot now, like toBlob
      return new Promise((resolve) =>
        setTimeout(() => {
          log.push(`encode ${px}`);
          resolve(enc.encode(px));
        }, 1),
      );
    },
    decodeInto: async (c, bytes) => {
      await new Promise((r) => setTimeout(r, 1));
      fake(c).px = dec.decode(bytes);
    },
    resize: (c, w, h) => {
      const f = fake(c);
      f.width = w;
      f.height = h;
      f.px = '';
    },
    newCanvas: (w, h) => fakeCanvas(w, h),
    thumb: (a: PageArt) => fakeCanvas(4, 6, `thumb:${fake(a.planes.ink ?? null)?.px ?? ''}`),
    defer: (fn) => setTimeout(fn, 0),
  };
}

/** A manual clock so debounce and timers are deterministic. */
export class FakeClock implements Clock {
  t = 1_000_000;
  private timers: { id: number; at: number; fn: () => void }[] = [];
  private next = 1;
  now() {
    return this.t;
  }
  setTimeout(fn: () => void, ms: number) {
    const id = this.next++;
    this.timers.push({ id, at: this.t + ms, fn });
    return id;
  }
  clearTimeout(id: unknown) {
    this.timers = this.timers.filter((x) => x.id !== id);
  }
  async advance(ms: number) {
    const end = this.t + ms;
    for (;;) {
      const due = this.timers.filter((x) => x.at <= end).sort((a, b) => a.at - b.at)[0];
      if (!due) break;
      this.timers = this.timers.filter((x) => x !== due);
      this.t = due.at;
      due.fn();
      await Promise.resolve();
    }
    this.t = end;
  }
}

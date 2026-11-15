import { RasterEngine } from '../engine/brush/raster';
import type { StrokeRecord } from '../engine/core/stroke';

/**
 * inkflo's raster engine: 2Dope's `RasterEngine`, unchanged (it is vendored; see
 * docs/2DOPE-REUSE-INVENTORY.md), plus one inkflo behaviour.
 *
 * **Live preview of pixel brushes.** For a brush with `antiAlias: false` the engine hardens the
 * stroke's edge by reading its pixels back from the GPU. Done on every preview frame that costs
 * a fixed ~30–45 ms stall on a full-size page. While the pen is down the preview shows the stroke
 * as painted (soft edge); the stroke is hardened once when it lands (`commit` is untouched), so
 * the pixels you keep are exactly the same.
 */
export class InkRasterEngine extends RasterEngine {
  override displaySource(): HTMLCanvasElement {
    // `record` is private in the vendored class; read it without changing that file
    const self = this as unknown as { record: StrokeRecord | null };
    const rec = self.record;
    if (!rec || rec.brush.antiAlias !== false) return super.displaySource();
    const brush = rec.brush;
    rec.brush = { ...brush, antiAlias: true };
    try {
      return super.displaySource();
    } finally {
      rec.brush = brush;
    }
  }
}

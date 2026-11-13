import type { PixelAdjustment } from '../doc/model';
import { applyBlur, applyHSB, isNoHSB } from '../engine/core/adjust';

export function adjustPixels(g: CanvasRenderingContext2D, source: ImageData, edit: PixelAdjustment, dpi: number): ImageData {
  const { width, height } = source;
  const result = g.createImageData(width, height);
  const radius = Math.round(edit.blur * dpi);
  if (radius) {
    if (isNoHSB(edit)) applyBlur(source.data, result.data, width, height, radius);
    else {
      const color = new Uint8ClampedArray(source.data.length);
      applyHSB(source.data, color, edit);
      applyBlur(color, result.data, width, height, radius);
    }
  } else applyHSB(source.data, result.data, edit);
  return result;
}

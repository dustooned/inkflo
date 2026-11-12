import type { PlacedImage, Pt } from '../doc/model';

export interface PlacementBox { x0: number; y0: number; x1: number; y1: number }

export function fitImage(image: PlacedImage, box: PlacementBox, cover = false): PlacedImage {
  const factor = (cover ? Math.max : Math.min)((box.x1 - box.x0) / image.pixelWidth, (box.y1 - box.y0) / image.pixelHeight);
  return {
    ...image,
    x: (box.x0 + box.x1) / 2, y: (box.y0 + box.y1) / 2,
    width: image.pixelWidth * factor, height: image.pixelHeight * factor,
    rotation: 0,
  };
}

export function imagePoint(image: PlacedImage, x: number, y: number): Pt {
  const angle = image.rotation * Math.PI / 180;
  return {
    x: image.x + x * Math.cos(angle) - y * Math.sin(angle),
    y: image.y + x * Math.sin(angle) + y * Math.cos(angle),
  };
}

export function hitsImage(image: PlacedImage, p: Pt): boolean {
  const angle = image.rotation * Math.PI / 180;
  const x = p.x - image.x;
  const y = p.y - image.y;
  return Math.abs(x * Math.cos(angle) + y * Math.sin(angle)) <= image.width / 2 &&
    Math.abs(-x * Math.sin(angle) + y * Math.cos(angle)) <= image.height / 2;
}

export function imageDpi(image: PlacedImage): number {
  return Math.round(Math.min(image.pixelWidth / image.width, image.pixelHeight / image.height));
}

// Vendored from 2Dope src/core/rng.ts @ 707f793. Do not edit in place; see docs/2DOPE-REUSE-INVENTORY.md.
/**
 * Deterministic randomness. Every jitter is a hash of (stroke seed, dab index, salt), so the same
 * stroke data always produces the same pixels: live, on undo/redo, on re-render and on export.
 */
export function hash01(seed: number, index: number, salt = 0): number {
  let h = (seed ^ Math.imul(index + 0x9e3779b9, 0x85ebca6b) ^ Math.imul(salt + 1, 0xc2b2ae35)) >>> 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d);
  h ^= h >>> 15;
  h = Math.imul(h, 0x846ca68b);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** A fresh 32-bit seed for a new stroke. */
export function newSeed(): number {
  return (Math.random() * 0xffffffff) >>> 0;
}

// Vendored from 2Dope src/io/hash.ts @ 707f793. Do not edit in place; see docs/2DOPE-REUSE-INVENTORY.md.
/**
 * Content hash for asset keys (two 53-bit cyrb53 hashes + length). Not cryptographic: it only
 * needs to make identical bytes share a key and different bytes (practically) never collide.
 * Pure JS so it works on plain-http LAN pages where crypto.subtle is unavailable.
 */
function cyrb53(data: Uint8Array, seed: number): number {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < data.length; i++) {
    const c = data[i]!;
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

export function hashBytes(data: Uint8Array): string {
  return `${cyrb53(data, 0).toString(36)}${cyrb53(data, 7).toString(36)}-${data.length.toString(36)}`;
}

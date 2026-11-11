// Vendored from 2Dope src/core/brushlib.test.ts @ 707f793. Do not edit in place; see docs/2DOPE-REUSE-INVENTORY.md.
import { describe, expect, it } from 'vitest';
import { PRESETS } from './brush';
import { categoryOf, isBuiltIn, readBrush, uniqueName } from './brushlib';

describe('brush library', () => {
  it('sorts every built-in brush into a category', () => {
    for (const p of PRESETS) expect(['sketch', 'ink', 'paint', 'vector']).toContain(categoryOf(p.name, []));
    expect(categoryOf('Ink', [])).toBe('ink');
    expect(categoryOf('My chalk', [{ ...PRESETS[0]!, name: 'My chalk' }])).toBe('mine');
    expect(isBuiltIn('Ink')).toBe(true);
    expect(isBuiltIn('My chalk')).toBe(false);
  });

  it('gives saved brushes names that are not taken', () => {
    expect(uniqueName('Ink copy', ['Ink'])).toBe('Ink copy');
    expect(uniqueName('Ink', ['Ink', 'Ink 2'])).toBe('Ink 3');
    expect(uniqueName('   ', [])).toBe('My brush');
  });

  it('reads saved brushes safely, filling anything missing', () => {
    expect(readBrush(null)).toBeNull();
    expect(readBrush({ size: 4 })).toBeNull();
    const b = readBrush({ name: 'Mine', size: 'big', hardness: 0.3 })!;
    expect(b.name).toBe('Mine');
    expect(b.size).toBe(PRESETS[0]!.size);
    expect(b.hardness).toBe(0.3);
    expect(typeof b.sizeDyn).toBe('object');
  });
});

describe('brush collections', () => {
  it('makes, fills, renames and removes collections; brushes go back to My brushes', async () => {
    const { addSet, allCategories, categoryOf: cat, forget, moveTo, readSets, removeSet, renamedIn, renameSet, NO_SETS } = await import('./brushlib');
    const mine = [{ ...PRESETS[0]!, name: 'Chalk' }, { ...PRESETS[0]!, name: 'Gouache' }];
    let s = addSet(NO_SETS, 'Backgrounds', 'set1');
    expect(allCategories(s).map((c) => c.id)).toEqual(['sketch', 'ink', 'paint', 'vector', 'mine', 'set1']);
    s = moveTo(s, ['Chalk', 'Gouache'], 'set1');
    expect(cat('Chalk', mine, s)).toBe('set1');
    s = moveTo(s, ['Gouache'], 'mine');
    expect(cat('Gouache', mine, s)).toBe('mine');
    s = renamedIn(s, 'Chalk', 'Soft chalk');
    expect(cat('Soft chalk', [{ ...PRESETS[0]!, name: 'Soft chalk' }], s)).toBe('set1');
    s = renameSet(s, 'set1', 'BG paint');
    expect(s.sets[0]!.name).toBe('BG paint');
    expect(readSets(JSON.parse(JSON.stringify(s)))).toEqual(s);
    s = removeSet(s, 'set1');
    expect(s.sets).toEqual([]);
    expect(s.where).toEqual({});
    expect(forget(moveTo(addSet(NO_SETS, 'x', 'a'), ['Q'], 'a'), 'Q').where).toEqual({});
    expect(readSets({ sets: [{ id: 'a', name: 'A' }], where: { Q: 'gone' } }).where).toEqual({});
    // a built-in brush always stays in its own category
    expect(cat('Ink', mine, moveTo(s, ['Ink'], 'set1'))).toBe('ink');
  });
});

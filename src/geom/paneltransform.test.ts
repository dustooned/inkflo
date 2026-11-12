import { describe, expect, it } from 'vitest';
import { newPage } from '../doc/model';
import { derivePanels, makeCut } from './carve';
import { movePanelCuts } from './paneltransform';

describe('panel movement', () => {
  it('keeps a panel-only cut attached when its shared gutter moves', () => {
    const page = newPage();
    const across = makeCut(page, [{ x: 0.5, y: 4 }, { x: 5.5, y: 4 }], 'across', true)!;
    page.cuts.push(across);
    const vertical = makeCut(page, [{ x: 3, y: 1 }, { x: 3, y: 3 }], 'panel', true)!;
    page.cuts.push(vertical);
    expect(derivePanels(page)).toHaveLength(3);
    for (const by of [-0.5, 0.5]) {
      const cuts = movePanelCuts(page, new Map([[across.id, { axis: 'y', by }]]));
      expect(cuts[1]!.extended!.at(-1)!.y).toBeCloseTo(4 + by);
      expect(derivePanels({ ...page, cuts })).toHaveLength(3);
    }
    expect(vertical.extended!.at(-1)!.y).toBeCloseTo(4);
  });
});

import { describe, expect, it } from 'vitest';
import { toIsoDate } from './dates.js';

describe('toIsoDate', () => {
  it('reads the ways a model writes a date', () => {
    for (const t of [
      '2026-11-20',
      '11/20/2026',
      'November 20, 2026',
      'Nov 20 2026',
      '20 November 2026',
      'nov. 20th, 2026',
      '2026-11-20 ',
    ])
      expect(toIsoDate(t), t).toBe('2026-11-20');
    expect(toIsoDate('12/2/2026')).toBe('2026-12-02');
  });

  it('rejects what is not a real date', () => {
    for (const t of ['', 'tomorrow', '2026-02-30', '13/01/2026', 'Smarch 3, 2026', '20261120'])
      expect(toIsoDate(t), t).toBeNull();
  });
});

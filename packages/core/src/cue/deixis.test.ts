import { describe, expect, it } from 'vitest';
import { mapDeixis, tokensOf } from './deixis.js';
import fixtures from './fixtures/cues.json';

interface Fixture {
  name: string;
  transcript: string;
  durationMs: number;
  anchors: Array<{ n: number; at: number }>;
  expect: Array<[string, number | null]>;
}

describe('mapping pointing words to anchors (recorded cues)', () => {
  for (const c of (fixtures as unknown as { cues: Fixture[] }).cues) {
    it(c.name, () => {
      const refs = mapDeixis(c.transcript, c.durationMs, c.anchors);
      expect(refs.map((r) => [r.word, r.anchor])).toEqual(c.expect);
    });
  }
});

describe('pointing words', () => {
  it('finds them with their positions', () => {
    expect(tokensOf('Put this there.')).toEqual([
      { word: 'this', index: 4, strong: true },
      { word: 'there', index: 9, strong: true },
    ]);
  });

  it('skips uses that do not point', () => {
    expect(tokensOf('I think that is there is no way this morning').map((t) => t.word)).toEqual([]);
  });
});

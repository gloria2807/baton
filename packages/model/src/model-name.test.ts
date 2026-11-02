import { describe, expect, it } from 'vitest';
import { MODEL } from './index.js';

// The hackathon serves Muse Spark Open under a dated name. Baseten's docs say
// meta-models/muse-spark-open; for the hackathon it must always be the -1026 build.
// Baton Live's proxy is checked against this same constant in its own tests.
describe('model name', () => {
  it('is the hackathon build of Muse Spark Open', () => {
    expect(MODEL).toBe('meta-models/muse-spark-open-1026');
  });
});

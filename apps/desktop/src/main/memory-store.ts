// Baton's memory on disk: a readable JSON file in the app's data folder (docs/FOCUS.md section 3).

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { MemoryBook, MemoryItem } from '@baton/core';
import { z } from 'zod';
import { dataDir } from './paths';

const file = () => join(dataDir(), 'memory.json');

export function loadMemory(): MemoryBook {
  let items: MemoryItem[] = [];
  try {
    if (existsSync(file())) items = z.array(MemoryItem).parse(JSON.parse(readFileSync(file(), 'utf8')));
  } catch {
    /* a damaged file starts empty rather than stopping Baton */
  }
  return new MemoryBook(items, (all) => writeFileSync(file(), JSON.stringify(all, null, 2)));
}

// The person's Baton settings, kept in the app's user data folder.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_TALK_KEY, isTalkKeyId, type TalkKeyId } from '@baton/core';
import { dataDir } from './paths';

export interface Settings {
  talkKey: TalkKeyId;
}

const file = () => join(dataDir(), 'settings.json');

export function loadSettings(): Settings {
  try {
    if (existsSync(file())) {
      const raw = JSON.parse(readFileSync(file(), 'utf8')) as Partial<Settings>;
      return { talkKey: isTalkKeyId(raw.talkKey) ? raw.talkKey : DEFAULT_TALK_KEY };
    }
  } catch {
    /* a corrupt file falls back to defaults */
  }
  return { talkKey: DEFAULT_TALK_KEY };
}

export function saveSettings(s: Settings) {
  writeFileSync(file(), JSON.stringify(s, null, 2));
}

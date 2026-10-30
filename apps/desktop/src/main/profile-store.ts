// The person's profile, kept in the app's user data folder. Only the person edits it (Podium
// settings); lanes read it through their goals and can never change it.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Profile } from '@baton/core';
import { dataDir } from './paths';

const file = () => join(dataDir(), 'profile.json');

export function loadProfile(): Profile {
  try {
    if (existsSync(file())) return Profile.parse(JSON.parse(readFileSync(file(), 'utf8')));
  } catch {
    /* a corrupt file falls back to an empty profile */
  }
  return Profile.parse({});
}

export function saveProfile(input: unknown): Profile {
  const p = Profile.parse(input);
  writeFileSync(file(), JSON.stringify(p, null, 2));
  return p;
}

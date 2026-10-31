// Site notes: Baton's memory of how particular sites work. Each lane is shown the notes for the
// site it is on. Lanes add a note when they find a reliable trick (note_site); the person reviews
// and removes notes in the Podium's settings. Kept on this computer, in the user data folder.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { dataDir } from './paths';

export interface SiteNote {
  id: number;
  site: string; // host, optionally with a path: "google.com/maps"
  note: string;
  source: 'baton' | 'lane' | 'person';
  added: string;
}

// Starting notes for the sites the demo uses. Lane tips sit beside them.
const DEFAULTS: Array<Pick<SiteNote, 'site' | 'note'>> = [
  {
    site: 'docs.google.com/spreadsheets',
    note: 'Google Sheets draws its cells on a canvas: use sheet_read and sheet_write, not clicks on cells.',
  },
  {
    site: 'docs.google.com/document',
    note: 'Google Docs draws its text on a canvas: use doc_read and doc_write. Insert tables from the Insert menu, then type with doc_write.',
  },
  {
    site: 'google.com/maps',
    note: 'Google Maps: open https://www.google.com/maps/dir/<from>/<to> for directions and https://www.google.com/maps/search/<what+where> to search; the travel times are in the page text.',
  },
  {
    site: 'calendar.google.com',
    note: 'Google Calendar: open https://calendar.google.com/calendar/r/eventedit?text=<title>&dates=<YYYYMMDD>/<YYYYMMDD>&details=<notes> to start an all-day event (the end date is the day after the last day), then press Save.',
  },
  {
    site: 'mail.google.com',
    note: 'Gmail: start a message at https://mail.google.com/mail/?view=cm&to=<address>&su=<subject>&body=<text>. Closing the compose window keeps it as a draft; only Send sends.',
  },
];

const file = () => join(dataDir(), 'site-notes.json');

export function listNotes(): SiteNote[] {
  if (existsSync(file())) {
    try {
      return JSON.parse(readFileSync(file(), 'utf8')) as SiteNote[];
    } catch {
      /* fall through to the defaults */
    }
  }
  const seeded = DEFAULTS.map((d, i) => ({
    id: i + 1,
    ...d,
    source: 'baton' as const,
    added: new Date().toISOString(),
  }));
  writeFileSync(file(), JSON.stringify(seeded, null, 2));
  return seeded;
}

export function addNote(site: string, note: string, source: SiteNote['source']): SiteNote | null {
  const notes = listNotes();
  const clean = note.replace(/\s+/g, ' ').trim().slice(0, 300);
  if (!site || clean.length < 5 || notes.some((n) => n.site === site && n.note.toLowerCase() === clean.toLowerCase()))
    return null;
  // A site keeps its ten most recent lane notes, so memory cannot grow without bound.
  const fromLanes = notes.filter((n) => n.site === site && n.source === 'lane');
  const keep = fromLanes.length >= 10 ? notes.filter((n) => n.id !== fromLanes[0]!.id) : notes;
  const added: SiteNote = {
    id: Math.max(0, ...notes.map((n) => n.id)) + 1,
    site,
    note: clean,
    source,
    added: new Date().toISOString(),
  };
  writeFileSync(file(), JSON.stringify([...keep, added], null, 2));
  return added;
}

export function removeNote(id: number): SiteNote[] {
  const notes = listNotes().filter((n) => n.id !== id);
  writeFileSync(file(), JSON.stringify(notes, null, 2));
  return notes;
}

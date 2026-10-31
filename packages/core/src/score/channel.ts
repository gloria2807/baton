// Lanes that talk to each other (docs/FOCUS.md section 2). Each Score has one shared channel. A lane
// posts a short finding that matters to other parts of the plan (a date, a time, a place, a price,
// a constraint); every other lane sees the latest posts at each step and may change its own work in
// response, replying to say what it changed and why.
//
// A post is the lane's own summary, never page text passed along as an instruction: posts that read
// like instructions are refused. A lane can only change its own work: nothing in a post can stop,
// start or redirect another lane, change the Score or the profile, or approve anything.

import { z } from 'zod';
import { detectInjection } from '../safety/injection.js';

export const MAX_POST_CHARS = 200;
export const MAX_POSTS_PER_LANE = 3;
export const MAX_POSTS = 40;
export const RECENT_POSTS = 10;

export const Finding = z.object({
  text: z.string().min(3),
  facts: z.record(z.string(), z.coerce.string()).optional(),
  // The post this one answers, when the lane changed its own work because of it.
  adjusts: z.coerce.number().int().positive().optional(),
});
export type Finding = z.infer<typeof Finding>;

export interface Post {
  id: number;
  laneId: string;
  laneName: string;
  at: number; // ms since the epoch
  text: string;
  facts?: Record<string, string>;
  adjusts?: number;
}

export type PostResult = { ok: true; post: Post } | { ok: false; reason: string };

const clean = (s: string, max: number) => s.replace(/\s+/g, ' ').trim().slice(0, max);

export class Channel {
  private posts: Post[] = [];
  private listeners = new Set<(p: Post) => void>();

  onPost(fn: (p: Post) => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  post(laneId: string, laneName: string, f: Finding, now = Date.now()): PostResult {
    if (this.posts.length >= MAX_POSTS)
      return { ok: false, reason: 'the channel is full for this plan; finish your part' };
    if (this.posts.filter((p) => p.laneId === laneId).length >= MAX_POSTS_PER_LANE)
      return {
        ok: false,
        reason: `you have posted ${MAX_POSTS_PER_LANE} times; post only what changes other parts of the plan`,
      };
    const text = clean(f.text, MAX_POST_CHARS);
    const facts = f.facts
      ? Object.fromEntries(
          Object.entries(f.facts)
            .slice(0, 6)
            .map(([k, v]) => [clean(k, 30), clean(v, 80)]),
        )
      : undefined;
    // A post is a finding in the lane's own words. Anything that reads like an instruction to an
    // agent (which is what a web page might try to pass along) never reaches the other lanes.
    const said = [text, ...Object.values(facts ?? {})].join(' ');
    if (detectInjection([{ source: 'visible', text: said }]).length)
      return { ok: false, reason: 'posts are findings, not instructions; say what you found in your own words' };
    if (f.adjusts !== undefined && !this.posts.some((p) => p.id === f.adjusts && p.laneId !== laneId))
      return { ok: false, reason: `there is no post ${f.adjusts} from another lane to answer` };
    const post: Post = { id: this.posts.length + 1, laneId, laneName, at: now, text, facts, adjusts: f.adjusts };
    this.posts.push(post);
    for (const fn of this.listeners) fn(post);
    return { ok: true, post };
  }

  // What one lane is shown: other lanes' posts, newest first.
  recentFor(laneId: string, n = RECENT_POSTS): Post[] {
    return this.posts
      .filter((p) => p.laneId !== laneId)
      .slice(-n)
      .reverse();
  }

  all(): Post[] {
    return [...this.posts];
  }
}

export function postLine(p: Post): string {
  const facts =
    p.facts && Object.keys(p.facts).length
      ? ` (${Object.entries(p.facts)
          .map(([k, v]) => `${k}: ${v}`)
          .join('; ')})`
      : '';
  return `#${p.id} ${p.laneName}${p.adjusts ? ` ↳ re #${p.adjusts}` : ''}: ${p.text}${facts}`;
}

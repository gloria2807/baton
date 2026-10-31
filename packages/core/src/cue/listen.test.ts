import { describe, expect, it } from 'vitest';
import { ListenReply, PlanStream } from './listen.js';

const answer = JSON.stringify({
  transcript: 'Get me there.',
  intent: 'travel to the event',
  move: {
    kind: 'score',
    title: 'Get to Atlas Summit',
    partCount: 3,
    parts: [
      {
        id: 'flights',
        name: 'Flights',
        goal: 'Find flights LOS to LIS on Dec 1, with "quotes" and {braces}.',
        startUrl: 'http://localhost:4402/',
        dependsOn: [],
        manualMinutes: 6,
      },
      {
        id: 'hotel',
        name: 'Hotel',
        goal: 'Find a hotel near Doca Hall.',
        startUrl: 'http://localhost:4402/hotels',
        dependsOn: [],
        manualMinutes: 8,
      },
      {
        id: 'reply',
        name: 'Reply',
        goal: 'Draft a reply.',
        startUrl: 'http://localhost:4400/',
        dependsOn: ['flights'],
        manualMinutes: 4,
      },
    ],
    final: 'Summarise.',
  },
});

describe('PlanStream', () => {
  it('reports the transcript, then each part as soon as its JSON closes, while the answer streams in', () => {
    const s = new PlanStream();
    const events: string[] = [];
    for (let n = 1; n <= answer.length; n += 7) {
      const r = s.feed(answer.slice(0, n));
      if (r.transcript !== undefined) events.push(`transcript@${n}`);
      for (const p of r.parts) events.push(`part ${p.id}@${n}`);
    }
    const r = s.feed(answer);
    for (const p of r.parts) events.push(`part ${p.id}@end`);
    expect(events.map((e) => e.split('@')[0])).toEqual(['transcript', 'part flights', 'part hotel', 'part reply']);
    // The first part arrives well before the whole answer.
    expect(Number(events[1]!.split('@')[1])).toBeLessThan(answer.length * 0.55);
    expect(s.kind).toBe('score');
    expect(s.partCount).toBe(3);
  });

  it('reports nothing for moves that are not a plan of parts', () => {
    const s = new PlanStream();
    const r = s.feed(
      JSON.stringify({ transcript: 'What is this?', intent: 'q', move: { kind: 'answer', speech: 'An invitation.' } }),
    );
    expect(r.transcript).toBe('What is this?');
    expect(r.parts).toEqual([]);
    expect(s.kind).toBe('answer');
  });

  it('ignores a part that does not validate', () => {
    const s = new PlanStream();
    const r = s.feed('{"transcript":"x","move":{"kind":"score","parts":[{"id":"Bad Id!","name":"x"}]');
    expect(r.parts).toEqual([]);
  });

  it('the finished answer validates as a reply with a move', () => {
    const v = ListenReply.parse(JSON.parse(answer));
    expect(v.move.kind).toBe('score');
  });
});

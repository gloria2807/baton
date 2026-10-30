import { describe, expect, it } from 'vitest';
import { Profile, goalWithProfile } from './profile.js';

describe('goalWithProfile', () => {
  it('adds the person’s details to a lane goal', () => {
    const p = Profile.parse({ name: 'Ama Owusu', workEmail: 'ama@harbourline.example', homeAirport: 'LOS' });
    const g = goalWithProfile('Book the hotel.', p);
    expect(g.startsWith('Book the hotel.')).toBe(true);
    expect(g).toContain('name Ama Owusu');
    expect(g).toContain('email ama@harbourline.example');
    expect(g).toContain('home airport LOS');
    expect(g).not.toContain('home city');
  });
  it('leaves the goal alone when the profile is empty', () => {
    expect(goalWithProfile('Find flights.', Profile.parse({}))).toBe('Find flights.');
  });
});

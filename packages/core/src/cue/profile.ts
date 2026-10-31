// The profile: facts the person chose to give Baton, stored locally and editable. Lanes read it
// through their goals; they can never change it.

import { z } from 'zod';

const field = z.string().max(200).default('');

export const Profile = z.object({
  name: field,
  homeCity: field,
  homeAirport: field,
  workEmail: field,
  preferredAirline: field,
  notes: z.string().max(1000).default(''),
});
export type Profile = z.infer<typeof Profile>;

export const PROFILE_LABELS: Record<keyof Profile, string> = {
  name: 'Name',
  homeCity: 'Home city',
  homeAirport: 'Home airport',
  workEmail: 'Work email',
  preferredAirline: 'Preferred airline',
  notes: 'Notes',
};

export function profileLines(p: Profile): string {
  const lines = (Object.keys(PROFILE_LABELS) as Array<keyof Profile>)
    .filter((k) => p[k].trim())
    .map((k) => `- ${PROFILE_LABELS[k]}: ${p[k].trim()}`);
  return lines.length ? lines.join('\n') : '(empty)';
}

// Every lane goal carries the person's own details, so a lane that meets a form asking for a name
// or email uses the profile instead of stopping to ask or, worse, making one up. The planner is
// asked to copy them into goals; this makes it certain.
export function goalWithProfile(goal: string, p: Profile): string {
  const facts = [
    p.name && `name ${p.name}`,
    p.workEmail && `email ${p.workEmail}`,
    p.homeCity && `home city ${p.homeCity}`,
    p.homeAirport && `home airport ${p.homeAirport}`,
  ]
    .filter(Boolean)
    .join(', ');
  return facts
    ? `${goal}

The person's own details, to use only where a form asks for them: ${facts}.`
    : goal;
}

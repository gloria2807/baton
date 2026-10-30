import { describe, expect, it } from 'vitest';
import fixtures from './fixtures/rehearsals.json';
import { RecordedStep, cleanRehearsal, describeStep, variableHints } from './rehearsal.js';
import { Routine, compileMessages, performGoal } from './routine.js';

interface Fixture {
  name: string;
  steps: unknown[];
  expectClean: number;
  expectVariables: string[];
}
const all = (fixtures as unknown as { rehearsals: Fixture[] }).rehearsals;
const steps = (f: Fixture) => f.steps.map((s) => RecordedStep.parse(s));

describe('cleaning recorded rehearsals', () => {
  for (const r of all) {
    it(r.name, () => {
      const clean = cleanRehearsal(steps(r));
      expect(clean).toHaveLength(r.expectClean);
      expect(variableHints(clean).map((h) => h.value)).toEqual(r.expectVariables);
    });
  }

  it('keeps the last value of a field and drops the click that focused it', () => {
    const clean = cleanRehearsal(steps(all[0]!));
    const vendor = clean.filter((s) => s.type === 'input' && s.field === 'Vendor');
    expect(vendor).toHaveLength(1);
    expect(vendor[0]).toMatchObject({ value: 'Bluefin Cleaning Services' });
    expect(clean.some((s) => s.type === 'click' && s.name === 'Vendor')).toBe(false);
  });

  it('never keeps a password, even if one slipped into the recording', () => {
    const clean = cleanRehearsal(steps(all[1]!));
    expect(JSON.stringify(clean)).not.toContain('should-never-appear');
    expect(describeStep(clean[2]!)).toBe('Filled Password (private, not recorded)');
  });

  it('marks where each variable came from', () => {
    const hints = variableHints(cleanRehearsal(steps(all[0]!)));
    expect(hints.find((h) => h.value === 'INV-2307')).toMatchObject({ source: 'copied', from: 'http://localhost:4400/m/inv-2' });
    expect(hints.find((h) => h.value === '527.40')).toMatchObject({ source: 'page' });
  });
});

describe('compiling and performing a routine', () => {
  const routine = Routine.parse({
    name: 'Enter an invoice email as a bill',
    summary: 'Read the invoice email, then create a bill in Ledgerly with its details.',
    itemKind: 'invoice email',
    itemSourceUrl: 'http://localhost:4400/',
    variables: [
      { name: 'vendor', description: 'the Vendor line of the email', example: 'Bluefin Cleaning Services' },
      { name: 'reference', description: 'the Invoice number line', example: 'INV-2307' },
    ],
    steps: [{ do: 'Open the invoice email' }, { do: 'In Ledgerly, click + New bill and fill Vendor {vendor} and Reference {reference}' }, { do: 'Click Save bill' }],
    doneCheck: 'a bill with reference {reference} is in the Ledgerly list',
  });

  it('prompts with the cleaned steps, the variable hints and the pages as untrusted data', () => {
    const clean = cleanRehearsal(steps(all[0]!));
    const m = compileMessages(clean, variableHints(clean));
    const user = m[1]!.content as string;
    expect(user).toContain('Typed “Bluefin Cleaning Services” into Vendor');
    expect(user).toContain('- Reference (invoice number): “INV-2307” (copied from http://localhost:4400/m/inv-2)');
    expect(user).toContain('<untrusted source="page http://localhost:4400/m/inv-2">');
  });

  it('rejects malformed routines', () => {
    expect(Routine.safeParse({ ...routine, variables: [{ name: 'Vendor Name', description: 'x', example: 'y' }] }).success).toBe(false);
    expect(Routine.safeParse({ ...routine, steps: [] }).success).toBe(false);
    expect(Routine.safeParse({ ...routine, itemSourceUrl: 'inbox' }).success).toBe(false);
  });

  it('gives each lane one item, the steps, the variables and the duplicate check', () => {
    const goal = performGoal(routine, { title: 'Invoice INV-2321 from Ironbark Logistics', url: 'http://localhost:4400/m/inv-6' });
    expect(goal).toContain('for one invoice email: “Invoice INV-2321 from Ironbark Logistics” at http://localhost:4400/m/inv-6');
    expect(goal).toContain('2. In Ledgerly, click + New bill and fill Vendor {vendor} and Reference {reference}');
    expect(goal).toContain('- {reference}: the Invoice number line (example from the rehearsal: “INV-2307”)');
    expect(goal).toContain('check whether it was already done (a bill with reference {reference} is in the Ledgerly list)');
  });
});

describe('rehearse and perform phrases', () => {
  it('are recognised without the model', async () => {
    const { routineCommand } = await import('../cue/interpret.js');
    for (const t of ['Watch me.', 'Okay, watch me', 'watch this', 'Learn from me']) expect(routineCommand(t), t).toBe('rehearse');
    for (const t of ['Now do the rest.', 'Do the rest', 'now do all the others', 'do them all']) expect(routineCommand(t), t).toBe('perform');
    for (const t of ["That's it.", 'Done', "I'm done", 'stop recording']) expect(routineCommand(t), t).toBe('finish');
    for (const t of ['What is this?', 'Get me there', 'the vendor goes here', 'this is done by Friday']) expect(routineCommand(t), t).toBeNull();
  });
});

describe('picking the items to perform', () => {
  it('maps numbers to real links, skips done ones and duplicates, ignores numbers out of range', async () => {
    const { pickedItems } = await import('./routine.js');
    const links = [
      { name: 'Mail', href: 'http://localhost:4400/' },
      { name: 'Invoice INV-2307 from Bluefin', href: 'http://localhost:4400/m/inv-2' },
      { name: 'Invoice INV-2321 from Ironbark', href: 'http://localhost:4400/m/inv-6' },
      { name: 'Invoice INV-2335 from Juniper', href: 'http://localhost:4400/m/inv-9' },
    ];
    expect(pickedItems({ numbers: [2, 3, 4, 3, 99] }, links, ['http://localhost:4400/m/inv-2'])).toEqual([
      { title: 'Invoice INV-2321 from Ironbark', url: 'http://localhost:4400/m/inv-6' },
      { title: 'Invoice INV-2335 from Juniper', url: 'http://localhost:4400/m/inv-9' },
    ]);
  });
});

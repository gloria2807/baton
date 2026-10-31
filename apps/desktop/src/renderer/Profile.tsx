// Profile settings: facts the person chooses to give Baton. Stored on this computer only.

import { useState } from 'react';

const FIELDS: Array<[string, string, string]> = [
  ['name', 'Name', 'Ama Owusu'],
  ['homeCity', 'Home city', 'Lagos'],
  ['homeAirport', 'Home airport', 'LOS'],
  ['workEmail', 'Work email', 'ama@harbourline.example'],
  ['preferredAirline', 'Preferred airline', ''],
  ['notes', 'Notes', 'Window seat; hotels within walking distance'],
];

export function ProfileForm({ initial }: { initial: Record<string, string> }) {
  const [p, setP] = useState<Record<string, string>>(initial);
  const [saved, setSaved] = useState(false);
  async function save() {
    setP((await window.baton.saveProfile(p)) as Record<string, string>);
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  }
  return (
    <div className="profile">
      <div className="label">Profile · kept on this computer, shared with lanes only as needed</div>
      <div className="grid">
        {FIELDS.map(([key, label, placeholder]) => (
          <label key={key}>
            <span>{label}</span>
            <input
              value={p[key] ?? ''}
              placeholder={placeholder}
              onChange={(e) => setP({ ...p, [key]: e.target.value })}
            />
          </label>
        ))}
      </div>
      <div className="row end">
        <button className="btn" onClick={() => void save()}>
          {saved ? 'Saved' : 'Save profile'}
        </button>
      </div>
    </div>
  );
}

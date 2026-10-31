// The hand pointer, drawn across the whole screen in a transparent, click-through window: a brass
// ring that tightens when the hand rests, a pulse on a pinch, and the calibration targets.

import './overlay.css';

const ring = document.getElementById('ring')!;
const target = document.getElementById('target')!;
const label = document.getElementById('label')!;

type Msg = {
  pointer?: { x: number; y: number } | null;
  pose?: string;
  pulse?: { x: number; y: number };
  target?: { x: number; y: number } | null;
  label?: string;
};

let last: { x: number; y: number; t: number } | null = null;

window.baton.onOverlay((raw) => {
  const m = raw as Msg;
  if (m.pointer !== undefined) {
    if (!m.pointer) ring.classList.add('hidden');
    else {
      ring.classList.remove('hidden');
      ring.style.transform = `translate(${m.pointer.x}px, ${m.pointer.y}px)`;
      // Resting: the ring tightens once the hand has been still for a moment.
      const now = performance.now();
      if (!last || Math.hypot(m.pointer.x - last.x, m.pointer.y - last.y) > 14) last = { ...m.pointer, t: now };
      ring.classList.toggle('rest', now - last.t > 300);
      ring.classList.toggle('pinch', m.pose === 'pinch');
    }
  }
  if (m.pulse) {
    const p = document.createElement('div');
    p.className = 'pulse';
    p.style.transform = `translate(${m.pulse.x}px, ${m.pulse.y}px)`;
    document.body.appendChild(p);
    setTimeout(() => p.remove(), 600);
  }
  if (m.target !== undefined) {
    target.classList.toggle('hidden', !m.target);
    if (m.target) target.style.transform = `translate(${m.target.x}px, ${m.target.y}px)`;
  }
  if (m.label !== undefined) {
    label.textContent = m.label;
    label.classList.toggle('hidden', !m.label);
  }
});

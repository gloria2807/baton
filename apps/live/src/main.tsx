import { createRoot } from 'react-dom/client';
import { Profile } from '@baton/core';
import { Governor, Model } from '@baton/model';
import profile from '../../../demo-sites/profile.json';
import { speak } from '../../desktop/src/renderer/speech';
import { App } from './App';
import { Conductor } from './conductor';
import { Talk } from './talk';
import './sites';
import '../../desktop/src/renderer/podium.css';
import './live.css';

function start() {
  const root = createRoot(document.getElementById('root')!);

  // No key here: calls go to this site's proxy, which adds it. The proxy enforces the budget; the
  // governor only keeps three calls in flight and backs off when the model service is busy.
  const governor = new Governor({
    maxConcurrent: 3,
    dailyBudgetUsd: Number.POSITIVE_INFINITY,
    load: () => null,
    save: () => undefined,
  });
  const model = new Model('proxy', governor, `${location.origin}/api`);
  const conductor = new Conductor(model, Profile.parse(profile), speak);
  const talk = new Talk(model, conductor);
  root.render(<App conductor={conductor} talk={talk} />);
}

start();

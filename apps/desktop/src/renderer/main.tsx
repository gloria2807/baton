import { createRoot } from 'react-dom/client';
import { Podium } from './Podium';
import { ScoreView } from './ScoreView';
import './podium.css';
import './scoreview.css';

// One renderer bundle, two windows: the Podium, and the Score view (opened with #score).
const isScore = location.hash.startsWith('#score');
if (isScore) document.documentElement.classList.add('score-window');
createRoot(document.getElementById('root')!).render(isScore ? <ScoreView /> : <Podium />);

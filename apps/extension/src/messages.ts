// Messages between the service worker and the content script inside a lane tab.

import type { Element } from '@baton/core/bridge';

export interface LaneInfo {
  laneId: string;
  color: string;
  title: string;
  thinking: string;
}

export type ToContent =
  | { kind: 'lane'; lane: LaneInfo | null }
  | { kind: 'collect'; showMarks: boolean }
  | { kind: 'hideMarks' }
  | { kind: 'target'; mark?: number; x?: number; y?: number; forTyping?: boolean }
  | { kind: 'moveCursor'; x: number; y: number }
  | { kind: 'clickPulse' }
  | { kind: 'setThinking'; text: string }
  | { kind: 'cursorVisible'; visible: boolean };

export type ToWorker = { kind: 'whoami' };

export interface CollectResult {
  url: string;
  title: string;
  viewport: { width: number; height: number };
  scroll: { x: number; y: number };
  dpr: number;
  elements: Element[];
  text: string;
}

export interface TargetResult {
  x: number;
  y: number;
  blocked?: string; // human message when the field must not be typed into
  name: string;
}

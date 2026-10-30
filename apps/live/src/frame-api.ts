// What a demo page's frame script offers the Live page, and what the Live page offers back.
// Both sides are same-origin, so these are direct calls, not messages.

import type { AnchorTarget, Element, Rect } from '@baton/core';

export interface LaneLook {
  url: string;
  title: string;
  viewport: { width: number; height: number };
  elements: Element[];
  text: string;
  hidden: Array<{ source: 'hidden' | 'comment' | 'attribute'; text: string }>;
}

export interface FrameApi {
  lane(info: { laneId: string; color: string; title: string; thinking: string } | null): void;
  thinking(text: string): void;
  collect(): LaneLook;
  click(mark: number): Promise<void>;
  type(mark: number, text: string, submit: boolean): Promise<void>;
  select(mark: number, option: string): Promise<string>;
  fillCells(mark: number, rows: string[][]): Promise<number>;
  scroll(by: { dy: number } | { mark: number }): Promise<number>;
  anchorAt(x: number, y: number): { target: AnchorTarget; rect: Rect } | null;
  pageAnchor(): { target: AnchorTarget; rect: Rect } | null;
}

export interface FrameHost {
  ready(name: string, win: Window): void;
  leaving(name: string): void;
  pointer(name: string, x: number, y: number): void;
  talkKey(edge: 'down' | 'up'): void;
}

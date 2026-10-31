// Runs in every page. Inside a lane tab it draws the lane frame, title and ghost cursor, numbers
// interactive elements for screenshots, and resolves marks to coordinates. Outside lanes it stays idle.
// The DOM work itself lives in page.ts; this file connects it to the extension's service worker.

import type { LaneInfo, ToContent } from './messages';
import {
  animateCursor,
  applyLane,
  chooseOption,
  clickPulse,
  collect,
  fillCells,
  hideMarks,
  onRecorded,
  scrollByDy,
  scrollToMark,
  setCursorVisible,
  setDate,
  setRecording,
  setThinking,
  target,
} from './page';
import { onCue, pinAtScreen } from './pointer';

chrome.runtime.onMessage.addListener((msg: ToContent, _sender, reply) => {
  (async () => {
    switch (msg.kind) {
      case 'lane':
        applyLane(msg.lane);
        return true;
      case 'collect':
        return collect(msg.showMarks);
      case 'hideMarks':
        hideMarks();
        return true;
      case 'target':
        return target(msg);
      case 'moveCursor':
        await animateCursor(msg.x, msg.y);
        return true;
      case 'clickPulse':
        clickPulse();
        return true;
      case 'setThinking':
        setThinking(msg.text);
        return true;
      case 'cursorVisible':
        setCursorVisible(msg.visible);
        return true;
      case 'select':
        return chooseOption(msg.mark, msg.option);
      case 'setDate':
        return setDate(msg.mark, msg.iso);
      case 'cue':
        onCue(msg);
        return true;
      case 'pinAt':
        return pinAtScreen(msg.cueId, msg.x, msg.y);
      case 'record':
        setRecording(msg.active);
        return true;
      case 'fillCells':
        return fillCells(msg.mark, msg.rows);
      case 'scrollBy':
        return scrollByDy(msg.dy);
      case 'scrollTo':
        return scrollToMark(msg.mark);
    }
  })().then(
    (data) => reply({ ok: true, data }),
    (e: Error) => reply({ ok: false, error: e.message }),
  );
  return true; // async reply
});

onRecorded((step) => {
  chrome.runtime.sendMessage({ kind: 'recorded', step }).catch(() => undefined);
});

// On every page load, ask whether this tab is a lane and draw its chrome if so.
chrome.runtime.sendMessage({ kind: 'whoami' }).then(
  (info: LaneInfo | null) => {
    applyLane(info);
    // A rehearsal may be under way: this page load is one of its steps.
    chrome.runtime.sendMessage({ kind: 'recording?' }).then(
      (on: boolean) => setRecording(!!on),
      () => undefined,
    );
  },
  () => undefined,
);

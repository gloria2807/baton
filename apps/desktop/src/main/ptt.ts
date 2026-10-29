// Global push-to-talk: sees key down and key up anywhere on the desktop. The talk key is
// configurable (Alt by default); TalkKeyGesture decides what counts as talking versus a shortcut.

import { EventEmitter } from 'node:events';
import { UiohookKey, uIOhook } from 'uiohook-napi';
import { TALK_KEYS, TalkKeyGesture, type TalkAction, type TalkKeyId } from '@baton/core';
import { log } from './log';

export type PttEvent = Exclude<TalkAction, { type: 'mask' }>;

export class PushToTalk extends EventEmitter<{ ptt: [PttEvent] }> {
  private gesture: TalkKeyGesture;
  private running = false;

  constructor(private key: TalkKeyId) {
    super();
    this.gesture = new TalkKeyGesture(key, (a) => this.act(a), UiohookKey.Ctrl);
  }

  get talkKey(): TalkKeyId {
    return this.key;
  }

  private act(a: TalkAction) {
    if (a.type === 'mask') {
      // Runs from the hold timer, not inside a hook callback, so injecting is safe here.
      try {
        uIOhook.keyTap(UiohookKey.Ctrl);
      } catch (e) {
        log(`push-to-talk: could not send the menu mask key: ${(e as Error).message}`);
      }
      return;
    }
    log(`push-to-talk ${a.type}${a.type === 'commit' ? ` after ${a.heldMs} ms` : a.type === 'cancel' ? ` (${a.reason})` : ''}`);
    this.emit('ptt', a);
  }

  start() {
    uIOhook.on('keydown', (e) => this.gesture.keydown(e.keycode));
    uIOhook.on('keyup', (e) => this.gesture.keyup(e.keycode));
    uIOhook.start();
    this.running = true;
    log(`push-to-talk listening (${TALK_KEYS[this.key].label})`);
  }

  setKey(key: TalkKeyId) {
    this.key = key;
    this.gesture.setKey(key);
    log(`push-to-talk key is now ${TALK_KEYS[key].label}`);
  }

  // Session locked, laptop suspended or app quitting: close any open microphone.
  release() {
    this.gesture.reset();
  }

  stop() {
    this.gesture.reset();
    if (this.running) uIOhook.stop();
    this.running = false;
  }
}

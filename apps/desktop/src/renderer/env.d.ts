import type { BatonApi } from '../preload/index';

export interface PodiumInit {
  extension: 'connected' | 'waiting';
  token: string;
  hasModel: boolean;
  talkKey: string;
  talkKeys: Array<{ id: string; label: string }>;
  profile: Record<string, string>;
}

declare global {
  interface Window {
    baton: Omit<BatonApi, 'init'> & { init(): Promise<PodiumInit> };
  }
}

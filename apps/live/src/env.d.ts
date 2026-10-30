/// <reference types="vite/client" />

// The desktop app's cards call window.baton; Baton Live provides the same three calls.
interface Window {
  baton: {
    answerCard(id: number, answer: unknown): unknown;
    stopAll(): unknown;
    openScore(runId?: string): unknown;
  };
}

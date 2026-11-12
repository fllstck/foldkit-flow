/**
 * Startup instrumentation (§4.5: "startup-to-first-paint and full mount time
 * reported separately so layout cost is not hidden inside drag numbers").
 *
 * Two page-level numbers, both on the browser's own clock (navigation start = 0):
 *
 * - `readyAt` — the first frame that paints the graph. Each library records it
 *   where it already announced readiness, so the three are comparable.
 * - `measuredAt` — every node measured, which only `@fllstck/foldkit-flow` can
 *   report: it owns its measurement contract, and the flag is what a consumer
 *   waits for before trusting hit-testing. React Flow's and Svelte Flow's
 *   internal measurement is not observable from outside, so they report
 *   `readyAt` alone rather than a guess at the same thing.
 */
type StartupState = {
  readyAt?: number;
  measuredAt?: number;
};

declare global {
  interface Window {
    __startup?: {
      readyAt?: number;
      measuredAt?: number;
    };
  }
}

const state: StartupState = {};

/** First call wins: a re-render is not a second startup. */
export const recordReady = (): void => {
  if (state.readyAt === undefined) state.readyAt = performance.now();
};

export const recordMeasured = (): void => {
  if (state.measuredAt === undefined) state.measuredAt = performance.now();
};

export const installStartup = (): void => {
  window.__startup = state;
};

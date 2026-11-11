import { Array as Arr } from "effect";

/**
 * Per-dispatch instrumentation for the Foldkit benchmark pages.
 *
 * The §4.5 report asks for three columns the frame recorder cannot answer on its
 * own: the cost of rebuilding the child fold per dispatch (§2.5.1), the culling
 * scan (§4.5), and the heap after create/delete churn (measured by the driver
 * through the CDP heap counters). These counters are what the recorder reads
 * back after a run.
 */
export type FlowStats = Readonly<{
  updateTotalMs: number;
  updateCount: number;
  cullScanMs: number;
  cullScanSamples: number;
}>;

declare global {
  interface Window {
    __flowStats?: {
      updateTotalMs: number;
      updateCount: number;
      cullScanMs: number;
      cullScanSamples: number;
    };
  }
}

const stats = {
  updateTotalMs: 0,
  updateCount: 0,
  cullScanMs: 0,
  cullScanSamples: 0,
};

export const recordUpdate = (durationMs: number): void => {
  stats.updateTotalMs += durationMs;
  stats.updateCount += 1;
};

/** Averages N repetitions of the scan so the number is a per-call cost rather
 *  than one noisy sample, and leaves the frame being recorded untouched. */
export const recordCullScan = (
  scan: () => void,
  repetitions: number = 50,
): void => {
  const start = performance.now();
  Arr.range(0, repetitions - 1).forEach(() => scan());
  const elapsed = performance.now() - start;
  stats.cullScanMs += elapsed / repetitions;
  stats.cullScanSamples += 1;
};

export const installStats = (): void => {
  window.__flowStats = stats;
};

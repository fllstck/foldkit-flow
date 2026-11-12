import { defineConfig } from "vitest/config";

/**
 * The example package had no tests until `docs/TEST-STRATEGY-REVIEW.md`: its
 * behaviour was only ever asserted through Playwright, four minutes at a time and
 * one page at a time. Routes, the registry and the connection policy are pure
 * (rung 1), and the harness is a Foldkit application that Story can drive without
 * a DOM (rung 2) — see `docs/TEST-STRATEGY.md`.
 */
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});

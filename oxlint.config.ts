import effect from "@enfect/oxlint";
import { defineConfig } from "oxlint";

/**
 * `@enfect/oxlint` recommended set, minus the rules that fight this repo's
 * constraints:
 *
 * - `no-barrel-imports` / `prefer-namespace-imports`: Foldkit's documented
 *   style is `import { Effect, Schema } from "effect"`; the barrel is the
 *   canonical import in the framework's own examples.
 * - `avoid-native-object-helpers`: the PaneHost registry and the per-render
 *   node lookup are deliberately mutable `Map`s for live-handle identity.
 * - `prefer-option-over-null`: DOM APIs return null, and the viewport throttle
 *   uses `undefined` as a zero-allocation pending sentinel.
 * - `casting-awareness`: the remaining casts are checked DOM boundaries; the
 *   `require-safety-comment-for-type-assertion` rule is kept, so each one has
 *   a `SAFETY:` justification.
 * - `no-unsupported-tailwind-spacing`: this repo has no Tailwind.
 */
export default defineConfig({
  extends: [effect.configs.recommended],
  ignorePatterns: [
    "**/dist/**",
    "**/node_modules/**",
    "**/test-results/**",
    "**/playwright-report/**",
    "**/*.d.ts",
    // The Effect plugin targets domain code. Browser harnesses are plain
    // Playwright drivers and fixtures, not Effect programs.
    "**/*.test.ts",
    "**/*.typecheck.ts",
    "**/tests/**",
  ],
  rules: {
    "effect/no-barrel-imports": "off",
    "effect/prefer-namespace-imports": "off",
    "effect/avoid-native-object-helpers": "off",
    "effect/prefer-option-over-null": "off",
    "effect/casting-awareness": "off",
    "effect/no-unsupported-tailwind-spacing": "off",
    // Native oxc rule, adopted from `dmmulroy/anti-slop`'s recommendation: it
    // rejects spreading an accumulator inside `reduce` (and the supported loop
    // shapes), which is the quadratic-copy class `@enfect/oxlint` does not cover.
    // Zero hits today; it guards the bounds/edges merge paths in `update.ts`.
    "oxc/no-accumulating-spread": "error",
  },
  overrides: [
    {
      // Application entrypoints own `Effect.run*`; that is the boundary.
      files: [
        "packages/example/src/entry.ts",
        "packages/example/src/entry.server.ts",
      ],
      rules: {
        "effect/effect-run-in-body": "off",
      },
    },
    {
      // Static fixtures are plain data construction, not domain logic.
      files: [
        "packages/benchmark/src/fixture.ts",
        "packages/example/src/main.ts",
      ],
      rules: {
        "effect/imperative-loops": "off",
      },
    },
  ],
});

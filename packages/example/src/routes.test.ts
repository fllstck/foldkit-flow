import { describe, expect, test } from "vitest";

import { exampleSlugs } from "./examples/registry";
import { prerenderPathsFor, routeFor } from "./routes";

/**
 * Rung 1 of `docs/TEST-STRATEGY.md`. Routing was asserted only from the outside,
 * one navigation at a time, in `tests/examples.spec.ts` — which could not cover the
 * fallbacks at all (an unknown slug, a trailing slash, the root) without a browser
 * page per case.
 */
describe("routeFor", () => {
  test("the index answers with and without a trailing slash", () => {
    expect(routeFor("/examples")).toEqual({ kind: "examples-index" });
    expect(routeFor("/examples/")).toEqual({ kind: "examples-index" });
  });

  test("an example page is named by its slug, with or without the slash", () => {
    expect(routeFor("/examples/minimal")).toEqual({
      kind: "examples-example",
      slug: "minimal",
    });
    expect(routeFor("/examples/minimal/")).toEqual({
      kind: "examples-example",
      slug: "minimal",
    });
  });

  test("an unknown slug is the index, not a 404 and not a broken page", () => {
    // A gallery page with no graph is a worse diagnostic than one with the wrong
    // graph, and a stale link should land somewhere a reader can use.
    expect(routeFor("/examples/nope")).toEqual({ kind: "examples-index" });
  });

  test("the pipeline and the playground are distinguished", () => {
    expect(routeFor("/example")).toEqual({ kind: "pipeline" });
    expect(routeFor("/example/")).toEqual({ kind: "pipeline" });
    expect(routeFor("/")).toEqual({ kind: "demo" });
    expect(routeFor("/anything-else")).toEqual({ kind: "demo" });
  });
});

describe("prerenderPathsFor", () => {
  test("a page per route, and the examples come from the registry", () => {
    const paths = prerenderPathsFor(exampleSlugs);

    expect(paths).toEqual([
      "/",
      "/example",
      "/examples",
      ...exampleSlugs.map((slug) => `/examples/${slug}`),
    ]);
    // Every example has a path, and every path has an example: the drift this
    // assertion exists to catch is a slug in one list and not the other.
    expect(paths.filter((path) => path.startsWith("/examples/"))).toHaveLength(
      exampleSlugs.length,
    );
  });

  test("no duplicates, so the build cannot render one page twice", () => {
    const paths = prerenderPathsFor(exampleSlugs);
    expect(new Set(paths).size).toBe(paths.length);
  });
});

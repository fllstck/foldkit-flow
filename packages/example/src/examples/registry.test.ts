import { describe, expect, test } from "vitest";

import {
  categories,
  exampleBySlug,
  exampleSlugs,
  examples,
  examplesByCategory,
} from "./registry";

/**
 * Rung 1. The browser proof walks whatever the index offers, so it proves "the
 * pages the index lists work" — this proves "the index is a faithful list", which
 * is the other half: a fixture with an empty description, a duplicate slug or a
 * category nobody grouped would look fine on screen.
 */
describe("the example registry", () => {
  test("every example has a unique slug, a title, a description and a category", () => {
    expect(exampleSlugs.length).toBe(examples.length);
    expect(new Set(exampleSlugs).size).toBe(exampleSlugs.length);

    examples.forEach(({ spec }) => {
      expect(spec.title.length, spec.name).toBeGreaterThan(2);
      // The index prints the description; a stub one is a page that explains
      // nothing (`docs/DOCS-PROPOSAL.md`: one sentence, like xyflow's).
      expect(spec.description.length, spec.name).toBeGreaterThan(30);
      expect(categories, spec.name).toContain(spec.category);
    });
  });

  test("every example carries the source the page shows beside it", () => {
    examples.forEach(({ spec, sources }) => {
      expect(sources.spec, spec.name).toContain(`name: "${spec.name}"`);
      expect(sources.spec.length, spec.name).toBeGreaterThan(200);
      // The shared wiring and the stylesheet are the same two files for every
      // page, so a page cannot show one example's graph with another's harness.
      expect(sources.harness.length, spec.name).toBeGreaterThan(1000);
      expect(sources.harness).toBe(examples[0]?.sources.harness);
      // A CSS `?raw` import comes back empty under vitest (Vite hands stylesheets
      // to its CSS pipeline), so its *length* is asserted where it is real — the
      // served page lists all three files in `tests/examples.spec.ts`. Here the
      // entry has to exist and be the same for every page.
      expect(typeof sources.css, spec.name).toBe("string");
      expect(sources.css).toBe(examples[0]?.sources.css);
    });
  });

  test("the categories group the whole set and lose nobody", () => {
    const grouped = categories.flatMap((category) =>
      examplesByCategory(category).map((entry) => entry.spec.name),
    );

    expect([...grouped].sort()).toEqual([...exampleSlugs].sort());
  });

  test("lookup by slug is total for known slugs and empty for unknown ones", () => {
    exampleSlugs.forEach((slug) => {
      expect(exampleBySlug(slug)?.spec.name).toBe(slug);
    });
    expect(exampleBySlug("not-an-example")).toBeUndefined();
  });
});

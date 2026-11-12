import { describe, expect, test } from "vitest";

import spec from "./connection-policy";

/**
 * Rung 1, and the reason this file exists: the policy is a pure function of
 * *(connection, current edges)*, but it was only ever exercised by dragging in a
 * browser — so the bug that made it answer about the *declared* edges survived
 * every test and a review (`docs/EXAMPLES-REVIEW.md`, then
 * `docs/TEST-STRATEGY-REVIEW.md` finding 3).
 *
 * The case that matters is the third one: accepting a connection changes what a
 * cycle is, so a policy with a stale edge list passes 1 and 2 and fails 3.
 */
const connection = (source: string, target: string) => ({
  source,
  target,
  sourceHandle: null,
  targetHandle: null,
});

const declared = spec.edges;

const isAllowed = (
  edges: ReadonlyArray<(typeof declared)[number]>,
  source: string,
  target: string,
): boolean =>
  spec.isValidConnection?.(connection(source, target), edges) === true;

describe("the connection policy", () => {
  test("rejects a connection that closes a cycle through a path", () => {
    // a → b → c already exists, so c → a closes a → b → c → a. No single edge runs
    // the other way, which is why a "reverse edge" check waves it through.
    expect(isAllowed(declared, "c", "a")).toBe(false);
    expect(isAllowed(declared, "d", "b")).toBe(false);
  });

  test("accepts a connection that closes nothing", () => {
    expect(isAllowed(declared, "c", "d")).toBe(true);
    expect(isAllowed(declared, "a", "d")).toBe(true);
  });

  test("rejects the cycle a previous connection created", () => {
    // The review's case: once c → d is in the graph, d → c closes a two-cycle. A
    // predicate closed over `declared` would still say yes.
    const afterConnect = [
      ...declared,
      { id: "e-c-d", source: "c", target: "d" },
    ];
    expect(isAllowed(afterConnect, "d", "c")).toBe(false);
    // Re-adding an edge that is already there is a *duplicate*, not a cycle, and
    // this page's rule is cycles only — the demo has the duplicate policy. Pinned
    // so the two rules do not get folded together by accident.
    expect(isAllowed(afterConnect, "c", "d")).toBe(true);
  });

  test("rejects a self-loop, which closes a cycle trivially", () => {
    expect(isAllowed(declared, "a", "a")).toBe(false);
    expect(isAllowed(declared, "b", "b")).toBe(false);
  });

  test("terminates on a graph that is already cyclic", () => {
    // Mid-edit data can be cyclic; the walk has to stop rather than recurse.
    const cyclic = [
      ...declared,
      { id: "e-c-a", source: "c", target: "a" },
      { id: "e-a-c", source: "a", target: "c" },
    ];
    expect(isAllowed(cyclic, "d", "a")).toBe(false);
    expect(isAllowed(cyclic, "b", "d")).toBe(true);
  });
});

import collapse from "./specs/collapse";
import connectionPolicy from "./specs/connection-policy";
import customNodes from "./specs/custom-nodes";
import edgeTypes from "./specs/edge-types";
import fitAndZoom from "./specs/fit-and-zoom";
import minimal from "./specs/minimal";
import resizing from "./specs/resizing";
import type { ExampleSpec } from "./spec";

import collapseSource from "./specs/collapse.ts?raw";
import connectionPolicySource from "./specs/connection-policy.ts?raw";
import customNodesSource from "./specs/custom-nodes.ts?raw";
import edgeTypesSource from "./specs/edge-types.ts?raw";
import fitAndZoomSource from "./specs/fit-and-zoom.ts?raw";
import minimalSource from "./specs/minimal.ts?raw";
import resizingSource from "./specs/resizing.ts?raw";
import harnessSource from "./harness.ts?raw";
import cssSource from "./examples.css?raw";
import type { ExampleSources } from "./harness";

/**
 * The example set (M5, slice 1 of `docs/DOCS-PROPOSAL.md`).
 *
 * One list, and the page, the index and the proof all read it: a page shows its
 * own file as source, so the file beside the demo is the file that produced it.
 * Adding an example is one module plus one line here.
 */
export type ExampleEntry = Readonly<{
  spec: ExampleSpec;
  sources: ExampleSources;
}>;

const sources = (spec: string): ExampleSources => ({
  spec,
  harness: harnessSource,
  css: cssSource,
});

const entries: ReadonlyArray<ExampleEntry> = [
  { spec: minimal, sources: sources(minimalSource) },
  { spec: customNodes, sources: sources(customNodesSource) },
  { spec: resizing, sources: sources(resizingSource) },
  { spec: edgeTypes, sources: sources(edgeTypesSource) },
  { spec: connectionPolicy, sources: sources(connectionPolicySource) },
  { spec: collapse, sources: sources(collapseSource) },
  { spec: fitAndZoom, sources: sources(fitAndZoomSource) },
];

export const examples: ReadonlyArray<ExampleEntry> = entries;

export const exampleSlugs: ReadonlyArray<string> = entries.map(
  (entry) => entry.spec.name,
);

export const exampleBySlug = (slug: string): ExampleEntry | undefined =>
  entries.find((entry) => entry.spec.name === slug);

/** Category order the index renders in, rather than the order examples happen to
 *  be declared in. */
export const categories = [
  "Basics",
  "Nodes",
  "Edges",
  "Interaction",
  "Sub-flows",
  "Viewport",
] as const;

export const examplesByCategory = (
  category: (typeof categories)[number],
): ReadonlyArray<ExampleEntry> =>
  entries.filter((entry) => entry.spec.category === category);

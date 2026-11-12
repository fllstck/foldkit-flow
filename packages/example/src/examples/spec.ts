import type { Connection, FlowNode } from "@fllstck/foldkit-flow";
import type { Html, HtmlBuilder } from "foldkit/html";

import type { ExampleMessage } from "./harness";

/**
 * The shape an example page is written in (M5, slice 1 of
 * `docs/DOCS-PROPOSAL.md`).
 *
 * An example is **data plus policy**, not a second copy of the wiring: the graph,
 * the renderer options, the connection policy and the wording of the panel are
 * declared here, and `harness.ts` supplies the Foldkit app around them. That is
 * what makes nine examples cost nine small files instead of nine applications —
 * and it is why the page can show each example's own source beside it: the file on
 * the right is the file that produced the graph on the left.
 */
export type ExampleStatus = "ready" | "running" | "failing";

/** What `renderNode` receives from the flow. */
export type NodeTools = import("@fllstck/foldkit-flow").NodeTools;

export type ExampleNodeData = Readonly<{
  title: string;
  subtitle: string;
  status: string;
}>;

export type ExampleNode = Readonly<{
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  title: string;
  subtitle?: string;
  status?: ExampleStatus;
  parentId?: string;
  hidden?: boolean;
}>;

export type ExampleEdgeKind = "Bezier" | "Straight" | "Step" | "SmoothStep";

export type ExampleEdge = Readonly<{
  id: string;
  source: string;
  target: string;
  kind?: ExampleEdgeKind;
  label?: string;
  markerEnd?: "Arrow" | "ArrowClosed";
}>;

/** What the flow reported, in the harness's own words before a spec rewrites them. */
export type FactSummary = Readonly<{
  kind:
    | "move"
    | "connect"
    | "reconnect"
    | "delete"
    | "resize"
    | "select"
    | "viewport";
  detail: string;
}>;

export type ExampleRenderer = Readonly<{
  resize?: boolean;
  reconnect?: boolean;
  snapGrid?: Readonly<{ x: number; y: number }>;
  background?: boolean;
  controls?: boolean;
  minimap?: boolean;
  cull?: boolean;
}>;

export type ExampleControls = Readonly<{
  fit?: boolean;
  /** Ids whose `hidden` flag the "collapse" button toggles. */
  collapseIds?: ReadonlyArray<string>;
}>;

export type ExampleSpec = Readonly<{
  name: string;
  category:
    "Basics" | "Nodes" | "Edges" | "Interaction" | "Sub-flows" | "Viewport";
  title: string;
  /** One sentence, like xyflow's example pages: what the example answers. */
  description: string;
  nodes: ReadonlyArray<ExampleNode>;
  edges: ReadonlyArray<ExampleEdge>;
  /** A fixed viewport, or `"fit"` — fitted once, from the pane's measurement. */
  viewport: Readonly<{ x: number; y: number; zoom: number }> | "fit";
  padding?: number;
  renderer?: ExampleRenderer;
  /**
   * The example's own connection policy, in its own file. It receives the
   * **current** parent graph, not the one the spec declared: an accepted
   * connection changes what a cycle is, and a predicate that closes over the
   * initial edge list goes stale the moment anything connects
   * (`docs/TEST-STRATEGY-REVIEW.md` finding 3).
   */
  isValidConnection?: (
    connection: Connection,
    edges: ReadonlyArray<ExampleEdge>,
  ) => boolean;
  /**
   * The example's own node markup. Omitted means the harness's card — a title, a
   * subtitle and a status dot — which is what most examples are about; supplying
   * one is the "custom nodes" example, and its source is then on the page.
   */
  renderNode?: (
    node: FlowNode<ExampleNodeData>,
    tools: NodeTools,
    h: HtmlBuilder<ExampleMessage>,
  ) => Html;
  controls?: ExampleControls;
  /** Reword the panel's line for this example, if the default reads badly. */
  describeFact?: (fact: FactSummary) => string;
}>;

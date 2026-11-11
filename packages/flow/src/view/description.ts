import { Array as Arr, Option } from "effect";
import type { Html, HtmlBuilder } from "foldkit/html";

import type { FlowEdge, FlowNode } from "../model.js";
import * as classes from "./classes.js";

/** How many nodes get their own sentence, and how many connections each one
 *  names. Bounded on purpose: the region is a description, not a serialization,
 *  and a screen reader reading 1k nodes is worse than reading a summary. */
export const descriptionLimits = {
  nodes: 50,
  connectionsPerNode: 6,
} as const;

export const descriptionId = (paneId: string): string =>
  `fflow-description-${paneId}`;

export type DescriptionInput<NodeData, EdgeData> = Readonly<{
  nodes: ReadonlyArray<FlowNode<NodeData>>;
  edges: ReadonlyArray<FlowEdge<EdgeData>>;
  /** The same hook the node wrappers use for their accessible name, so the
   *  description and the tab order agree about what a node is called. */
  accessibleName: (node: FlowNode<NodeData>) => string;
}>;

/** "a", "a and b", "a, b and c" — the reading a screen reader produces for a
 *  comma-separated list is a run-on, so the conjunction is spelled out. */
const list = (names: ReadonlyArray<string>): string =>
  Arr.match(names, {
    onEmpty: () => "",
    onNonEmpty: (values) => {
      const last = values[values.length - 1] ?? "";
      return Arr.match(values.slice(0, -1), {
        onEmpty: () => last,
        onNonEmpty: (init) => `${init.join(", ")} and ${last}`,
      });
    },
  });

const capped = (names: ReadonlyArray<string>): string => {
  const listed = names.slice(0, descriptionLimits.connectionsPerNode);
  const rest = names.length - listed.length;
  return rest > 0 ? `${listed.join(", ")} and ${rest} more` : list(listed);
};

const connectionsOf = (
  outgoing: ReadonlyArray<string>,
  incoming: ReadonlyArray<string>,
): string => {
  const parts = [
    Arr.isReadonlyArrayEmpty(outgoing) ? "" : `connects to ${capped(outgoing)}`,
    Arr.isReadonlyArrayEmpty(incoming)
      ? ""
      : `connected from ${capped(incoming)}`,
  ].filter((part) => part !== "");

  return Arr.isReadonlyArrayEmpty(parts) ? "no connections" : parts.join(", ");
};

/**
 * The description's text: a summary line, then one sentence per node naming the
 * nodes it connects to. Pure and testable without a DOM, which matters because
 * this is the only place the graph is described in words.
 */
export const describeGraph = <NodeData, EdgeData>(
  input: DescriptionInput<NodeData, EdgeData>,
): string => {
  const { nodes, edges, accessibleName } = input;
  if (Arr.isReadonlyArrayEmpty(nodes)) return "Flow graph: no nodes.";

  const nameOf = new Map(
    nodes.map((node) => [node.id, accessibleName(node)] as const),
  );
  const nameOfId = (id: string): string => nameOf.get(id) ?? id;

  const listed = nodes.slice(0, descriptionLimits.nodes);
  const sentences = listed.map((node, index) => {
    const outgoing = edges
      .filter((edge) => edge.source === node.id)
      .map((edge) => nameOfId(edge.target));
    const incoming = edges
      .filter((edge) => edge.target === node.id)
      .map((edge) => nameOfId(edge.source));

    const name = Option.getOrElse(
      Option.fromNullishOr(nameOf.get(node.id)),
      () => node.id,
    );
    return `Node ${index + 1} of ${nodes.length}: ${name}, ${connectionsOf(outgoing, incoming)}.`;
  });

  const omitted = nodes.length - listed.length;
  const more = omitted > 0 ? ` ${omitted} more nodes are not listed.` : "";

  return `Flow graph: ${nodes.length} nodes and ${edges.length} connections. ${sentences.join(" ")}${more}`;
};

const visuallyHidden = {
  position: "absolute",
  width: "1px",
  height: "1px",
  margin: "-1px",
  padding: "0",
  overflow: "hidden",
  clip: "rect(0 0 0 0)",
  clipPath: "inset(50%)",
  whiteSpace: "nowrap",
  border: "0",
} as const;

/**
 * The visually hidden description (§7 M3). It sits beside the viewport rather
 * than inside it, so the transform cannot move it.
 *
 * It is **not** a live region: it describes the whole graph, and a region that
 * announced itself on every selection or drag commit would be unusable. The
 * caller memoizes it on `nodes`/`edges`, so it is rebuilt when the graph changes
 * and not on the viewport frames in between.
 */
export const descriptionView = <NodeData, EdgeData>(
  paneId: string,
  input: DescriptionInput<NodeData, EdgeData>,
  h: HtmlBuilder<any>,
): Html =>
  h.div(
    [
      h.Id(descriptionId(paneId)),
      h.Class(classes.Description),
      h.DataAttribute("fflow-description", ""),
      h.Attribute("role", "region"),
      h.AriaLabel("Graph description"),
      h.Style(visuallyHidden),
    ],
    [describeGraph(input)],
  );

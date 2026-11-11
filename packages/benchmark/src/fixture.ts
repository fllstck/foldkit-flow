export type BenchNode = {
  id: string;
  position: { x: number; y: number };
  data: { label: string };
  /** M4: a child's position is relative to its parent (and the container pages
   *  use it for the parent's own box). */
  parentId?: string;
  hidden?: boolean;
  size?: { width: number; height: number };
  label?: string;
  markerEnd?: "Arrow" | "ArrowClosed";
  style?: {
    width: string;
    height: string;
    fontSize: string;
    display: string;
    alignItems: string;
    justifyContent: string;
  };
};

export type BenchEdge = {
  id: string;
  source: string;
  target: string;
  label?: string;
  markerEnd?: "Arrow" | "ArrowClosed";
};

/** Mutable arrays: the React and Svelte pages hand them straight to their
 *  libraries, which keep them as their own store. */
export type BenchGraph = Readonly<{
  nodes: Array<BenchNode>;
  edges: Array<BenchEdge>;
  nodeCount: number;
}>;

const makeGraph = (rows: number, columns: number): BenchGraph => {
  const graphNodes: Array<BenchNode> = [];
  const graphEdges: Array<BenchEdge> = [];

  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const index = row * columns + column;
      const id = `n${index}`;
      graphNodes.push({
        id,
        position: { x: column * 190, y: row * 90 },
        data: { label: `Node ${index}` },
        style: {
          width: "150px",
          height: "36px",
          fontSize: "11px",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        },
      });
      if (index > 0) {
        graphEdges.push({
          id: `e${index}`,
          source: `n${index - 1}`,
          target: id,
        });
      }
    }
  }

  return {
    nodes: graphNodes,
    edges: graphEdges,
    nodeCount: rows * columns,
  };
};

/** xyflow's own stress fixture: 25×25. */
export const stress = makeGraph(25, 25);
export const nodes = stress.nodes;
export const edges = stress.edges;
export const nodeCount = stress.nodeCount;

/** The culling fixture: twice as many nodes, viewed at 1:1 so most of them are
 *  outside the viewport and culling has something to do (§4.5). */
export const large = makeGraph(40, 25);

/**
 * The M4 sub-flow fixture (§7 M4): two containers with three children each and a
 * child-to-child edge. Small on purpose — the proofs read exact transforms and
 * path endpoints, and a 625-node graph would make every assertion a race with
 * culling.
 */
export const subFlow: BenchGraph = {
  nodes: [
    {
      id: "p1",
      position: { x: 100, y: 100 },
      data: { label: "Parent 1" },
      size: { width: 420, height: 300 },
    },
    {
      id: "c1",
      position: { x: 20, y: 60 },
      parentId: "p1",
      data: { label: "Child 1" },
      size: { width: 140, height: 50 },
    },
    {
      id: "c2",
      position: { x: 240, y: 60 },
      parentId: "p1",
      data: { label: "Child 2" },
      size: { width: 140, height: 50 },
    },
    {
      id: "c3",
      position: { x: 20, y: 190 },
      parentId: "p1",
      data: { label: "Child 3" },
      size: { width: 140, height: 50 },
    },
    {
      id: "p2",
      position: { x: 700, y: 100 },
      data: { label: "Parent 2" },
      size: { width: 420, height: 300 },
    },
    {
      id: "d1",
      position: { x: 20, y: 60 },
      parentId: "p2",
      data: { label: "Child 4" },
      size: { width: 140, height: 50 },
    },
    {
      id: "d2",
      position: { x: 240, y: 60 },
      parentId: "p2",
      data: { label: "Child 5" },
      size: { width: 140, height: 50 },
    },
    {
      id: "loose",
      position: { x: 100, y: 520 },
      data: { label: "Loose" },
      size: { width: 140, height: 50 },
    },
  ],
  edges: [
    {
      id: "e-child",
      source: "c2",
      target: "d1",
      label: "to 4",
      markerEnd: "ArrowClosed",
    },
    { id: "e-loose", source: "d2", target: "loose", markerEnd: "Arrow" },
  ],
  nodeCount: 8,
};

export const subFlowViewport = { x: 40, y: 40, zoom: 1 };

/**
 * The 10k fixture (§4.5, §7 M4): 100 containers holding 99 children each, all but
 * two containers collapsed with `hidden`, so the graph has 10,000 nodes and the
 * renderer draws a couple of hundred. This is the "escape hatch" the plan
 * describes — the number is recorded, never gated (PLAN §4.5: "no numeric
 * promise until measured").
 */
const makeNested = (
  containers: number,
  children: number,
  openContainers: number,
): BenchGraph => {
  const graphNodes: Array<BenchNode> = [];
  let count = 0;

  for (let index = 0; index < containers; index += 1) {
    const column = index % 10;
    const row = Math.floor(index / 10);
    const containerId = `box${index}`;
    graphNodes.push({
      id: containerId,
      position: { x: column * 700, y: row * 900 },
      data: { label: `Box ${index}` },
      size: { width: 660, height: 860 },
      hidden: index >= openContainers,
    });
    count += 1;

    for (let child = 0; child < children; child += 1) {
      const childColumn = child % 3;
      const childRow = Math.floor(child / 3);
      graphNodes.push({
        id: `${containerId}-c${child}`,
        position: { x: 30 + childColumn * 200, y: 40 + childRow * 24 },
        parentId: containerId,
        data: { label: `Node ${index}.${child}` },
        size: { width: 150, height: 20 },
      });
      count += 1;
    }
  }

  return { nodes: graphNodes, edges: [], nodeCount: count };
};

export const nested10k = makeNested(100, 99, 2);

export const nestedViewport = { x: 40, y: 40, zoom: 0.35 };

export const initialViewport = { x: 20, y: 30, zoom: 0.22 };

export const largeViewport = { x: 20, y: 30, zoom: 1 };

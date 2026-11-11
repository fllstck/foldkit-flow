export type BenchNode = {
  id: string;
  position: { x: number; y: number };
  data: { label: string };
  style: {
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

export const initialViewport = { x: 20, y: 30, zoom: 0.22 };

export const largeViewport = { x: 20, y: 30, zoom: 1 };

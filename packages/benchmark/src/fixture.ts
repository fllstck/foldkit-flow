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

const ROWS = 25;
const COLUMNS = 25;

export const nodeCount = ROWS * COLUMNS;

export const nodes: BenchNode[] = [];
export const edges: BenchEdge[] = [];

for (let row = 0; row < ROWS; row += 1) {
  for (let column = 0; column < COLUMNS; column += 1) {
    const index = row * COLUMNS + column;
    const id = `n${index}`;
    nodes.push({
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
      edges.push({ id: `e${index}`, source: `n${index - 1}`, target: id });
    }
  }
}

export const initialViewport = { x: 20, y: 30, zoom: 0.22 };

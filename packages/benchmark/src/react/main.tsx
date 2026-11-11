import { ReactFlow } from "@xyflow/react";
import { createRoot } from "react-dom/client";

import "@xyflow/react/dist/style.css";
import { edges, nodes } from "../fixture";

const root = document.getElementById("root");

if (root !== null) {
  createRoot(root).render(
    <ReactFlow
      nodes={nodes}
      edges={edges}
      fitView
      proOptions={{ hideAttribution: false }}
    />,
  );

  requestAnimationFrame(() => {
    root.dataset.benchReady = "true";
  });
}

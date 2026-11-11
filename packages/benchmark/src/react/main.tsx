import { ReactFlow } from "@xyflow/react";
import { createRoot } from "react-dom/client";

import "@xyflow/react/dist/style.css";
import { edges, nodes } from "../fixture";

const root = document.getElementById("root");

if (root !== null) {
  // `nodes`/`edges` are the fixture's own arrays; the flow is uncontrolled
  // because no `onNodesChange` is wired. React Flow's node drag does not engage
  // under this harness either way (see M1-FINDINGS §10), so the drag leg skips
  // this page explicitly instead of recording idle frames.
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

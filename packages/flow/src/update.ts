import { Option } from "effect";
import type { Update } from "foldkit";

import { Message } from "./message.js";
import type { Context, Model, NodeSize } from "./model.js";

type UpdateReturn = Update.Return<Model, Message>;

const setNodeSize = (sizes: ReadonlyArray<NodeSize>, next: NodeSize) => {
  const without = sizes.filter((size) => size.nodeId !== next.nodeId);
  return [...without, next];
};

export const update = (
  model: Model,
  message: Message,
  _context: Context,
): UpdateReturn =>
  Message.match<UpdateReturn>(message, {
    MountedPane: ({ paneId }) => ({
      model: { ...model, paneId: Option.some(paneId) },
    }),
    FailedMountPane: () => ({ model }),
    ResizedPane: ({ pane }) => ({ model: { ...model, pane } }),
    MeasuredNode: ({ nodeId, size }) => ({
      model: {
        ...model,
        nodeSizes: setNodeSize(model.nodeSizes, { nodeId, ...size }),
      },
    }),
    MovedViewport: ({ viewport }) => ({ model: { ...model, viewport } }),
    CompletedSyncViewport: ({ viewport }) => ({
      model: { ...model, viewport },
    }),
    FailedSyncViewport: () => ({ model }),
  });

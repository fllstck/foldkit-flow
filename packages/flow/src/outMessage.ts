import { Schema } from "effect";
import { defineMessageUnion } from "foldkit/message";

import { HandleRef, HandleType, Viewport } from "./model.js";

/** Facts the flow reports to its parent. The parent owns the graph, so it is the
 *  only layer that can apply them (§2.1, §3.2). */
export const OutMessage = defineMessageUnion({
  MovedNodes: {
    nodes: Schema.Array(
      Schema.Struct({
        nodeId: Schema.String,
        x: Schema.Number,
        y: Schema.Number,
      }),
    ),
  },
  SelectedElements: {
    nodeIds: Schema.Array(Schema.String),
    edgeIds: Schema.Array(Schema.String),
  },
  ConnectedHandles: {
    source: HandleRef,
    target: HandleRef,
  },
  // One end of an existing edge moved. `end` says which end, so the parent can
  // rewrite `source`/`sourceHandle` or `target`/`targetHandle` on the edge it
  // owns; nothing else about the edge changed.
  ReconnectedEdge: {
    edgeId: Schema.String,
    end: HandleType,
    handle: HandleRef,
  },
  DeletedElements: {
    nodeIds: Schema.Array(Schema.String),
    edgeIds: Schema.Array(Schema.String),
  },
  ChangedViewport: { viewport: Viewport },
});

export type OutMessage = typeof OutMessage.Type;

export type MovedNodes = ReturnType<typeof OutMessage.MovedNodes>;
export type SelectedElements = ReturnType<typeof OutMessage.SelectedElements>;
export type ConnectedHandles = ReturnType<typeof OutMessage.ConnectedHandles>;
export type ReconnectedEdge = ReturnType<typeof OutMessage.ReconnectedEdge>;
export type DeletedElements = ReturnType<typeof OutMessage.DeletedElements>;
export type ChangedViewport = ReturnType<typeof OutMessage.ChangedViewport>;

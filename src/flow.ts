// Shared React Flow type contract. Node, Edge, and Tree components all code against
// these types so they never need to import one another for typing.

import type { Edge as RFEdge, Node as RFNode } from "@xyflow/react"
import type { Node, NodeState } from "./nodes"

export type NodeData = {
    node: Node
    state: NodeState
    isRoot: boolean
    isSelected: boolean
}

export type NodeFlowNode = RFNode<NodeData, "node">

// A linked node points at another board (its action is "Go to Board"); clicking it opens the shared
// detail card. `name` is derived live from the target board's root node (board.linkedNodeName), so a
// rename of that board flows through here. `state` is the ordinary tri-state from its own subtree: a
// linked node never enters a `mastered` set (its completion is deferred to Phase 3), so it only ever
// reads locked or available here.
export type LinkedNodeData = {
    name: string
    state: NodeState
    isSelected: boolean
}

export type LinkedFlowNode = RFNode<LinkedNodeData, "linked">

// Every node React Flow holds is one of these.
export type FlowNode = NodeFlowNode | LinkedFlowNode

// Fixed card dimensions. The Node renders at these sizes; the Tree centers a node on
// its mockup (x, y) by offsetting the React Flow top-left position by half of these.
export const NODE_SIZE = {
    normal: { width: 180, height: 60 },
    root: { width: 240, height: 68 }
} as const

// `lit` when the child node below is complete -> the link glows upward.
export type EdgeData = {
    lit: boolean
}

export type NodeFlowEdge = RFEdge<EdgeData, "glow">

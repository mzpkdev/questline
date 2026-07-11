// Shared React Flow type contract. Node, Edge, and Tree components all code against
// these types so they never need to import one another for typing.

import type { Edge as RFEdge, Node as RFNode } from "@xyflow/react"
import type { Node, NodeState } from "./nodes"

export type NodeData = {
    milestone: Node
    state: NodeState
    isRoot: boolean
    isSelected: boolean
}

export type NodeFlowNode = RFNode<NodeData, "milestone">

// A linked node: the Root view's read-only mirror of another tab. It carries a label and whether the
// board it stands for is complete (its root node is done); clicking it opens the shared detail card.
export type LinkedNodeData = {
    name: string
    isSelected: boolean
    complete: boolean
}

export type LinkedFlowNode = RFNode<LinkedNodeData, "view">

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

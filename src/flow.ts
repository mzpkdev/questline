// Shared React Flow type contract. Node, Edge, and Tree components all code against
// these types so they never need to import one another for typing.

import type { Edge, Node } from "@xyflow/react"
import type { Milestone, MilestoneState } from "./milestones"

export type MilestoneNodeData = {
    milestone: Milestone
    state: MilestoneState
    isGoal: boolean
    isSelected: boolean
}

export type MilestoneFlowNode = Node<MilestoneNodeData, "milestone">

// A "view" node: the Root view's read-only mirror of another tab. It carries a label and whether the
// view it stands for is complete (its goal is done); clicking it opens the shared detail card.
export type ViewNodeData = {
    name: string
    isSelected: boolean
    complete: boolean
}

export type ViewFlowNode = Node<ViewNodeData, "view">

// Every node React Flow holds is one of these.
export type FlowNode = MilestoneFlowNode | ViewFlowNode

// Fixed card dimensions. The Node renders at these sizes; the Tree centers a node on
// its mockup (x, y) by offsetting the React Flow top-left position by half of these.
export const NODE_SIZE = {
    normal: { width: 180, height: 60 },
    goal: { width: 240, height: 68 }
} as const

// `lit` when the sub-milestone below is complete -> the link glows upward.
export type MilestoneEdgeData = {
    lit: boolean
}

export type MilestoneFlowEdge = Edge<MilestoneEdgeData, "glow">

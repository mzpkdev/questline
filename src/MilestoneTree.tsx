// The React Flow canvas for one tab's roadmap: it maps that project's milestones + edges into React
// Flow nodes and edges, wires click-to-select, and lets nodes be dragged. Scope is VISUAL +
// SELECTION + LAYOUT — appearance lives in MilestoneNode / MilestoneEdge / ViewNode, completion/edit
// logic lives in App. Selection is ours (onNodeClick -> onSelect); positions live in React Flow's own
// node state so drags stay smooth, and each drag's final spot is reported up via onMove so it survives
// a tab switch (the parent re-keys this component per tab, remounting it from the stored positions).
//
// `staticNodeIds` marks the Root view's per-view mirror nodes: they render as "view" chips (ViewNode),
// can't be dragged, and don't count toward any parent's completion, so an edge into one never locks
// its source. Clicking one selects it (revealing its popover); its popover's button calls `onView`.

import { Background, Controls, ReactFlow, type ReactFlowInstance, useNodesState } from "@xyflow/react"
import { useEffect, useMemo, useRef, useState } from "react"
import type { FlowNode, MilestoneFlowEdge, MilestoneFlowNode, ViewFlowNode } from "./flow"
import { NODE_SIZE } from "./flow"
import { stateOf } from "./graph"
import { MilestoneEdge } from "./MilestoneEdge"
import { MilestoneNode } from "./MilestoneNode"
import type { Milestone, MilestoneEdge as MilestoneEdgeTuple } from "./milestones"
import { SpawnReadyContext } from "./nodeMotion"
import { ViewNode } from "./ViewNode"

type MilestoneTreeProps = {
    selectedId: string | null
    onSelect: (id: string) => void
    // The completed set: drives each node's tri-state and lights the edge below a completed node.
    mastered: ReadonlySet<string>
    // The active project's milestone records keyed by id; each node card renders its live name here.
    milestones: Record<string, Milestone>
    // The active project's parent/child links.
    edges: MilestoneEdgeTuple[]
    // Report a node's new centre after a drag so the parent can persist it (milestones and mirrors).
    onMove: (id: string, x: number, y: number) => void
    // Mirror nodes: excluded from completion math and rendered as view chips (still draggable).
    staticNodeIds?: ReadonlySet<string>
    // Mirror nodes whose view is complete (its goal is done), rendered with the mastered look.
    completeNodeIds?: ReadonlySet<string>
    // A node to pan/zoom onto; bumping focusNonce (re)triggers centering (URL routing).
    focusId?: string
    focusNonce?: number
}

// Stable references so React Flow doesn't warn about a freshly-built nodeTypes/edgeTypes each render.
const nodeTypes = { milestone: MilestoneNode, view: ViewNode }
const edgeTypes = { glow: MilestoneEdge }

// Edges are controlled but never mutated in place, so React Flow only needs a stable no-op handler.
const noop = () => {}

// Whole-tree fit: pad the frame, and cap the zoom at 1x so a small tree (e.g. the Root hub or a
// fresh view) sits at natural size instead of blowing up to React Flow's default 2x maximum.
const FIT_VIEW_OPTIONS = { padding: 0.08, maxZoom: 1 }

// Hide the React Flow attribution watermark in the canvas corner.
const proOptions = { hideAttribution: true }

// Build a milestone card node. The stored (x, y) is the card centre; React Flow anchors at the
// top-left, so shift by half the card to land the centre back on (x, y).
function makeMilestoneNode(
    milestone: Milestone,
    selectedId: string | null,
    mastered: ReadonlySet<string>,
    structuralEdges: MilestoneEdgeTuple[]
): MilestoneFlowNode {
    const isGoal = milestone.tier === 0
    const size = isGoal ? NODE_SIZE.goal : NODE_SIZE.normal
    return {
        id: milestone.id,
        type: "milestone",
        position: { x: milestone.x - size.width / 2, y: milestone.y - size.height / 2 },
        data: {
            milestone,
            state: stateOf(milestone.id, mastered, structuralEdges),
            isGoal,
            isSelected: milestone.id === selectedId
        }
    }
}

// Build a view chip node (Root's mirror of another tab): a normal-sized, draggable node carrying a
// label and its view's completeness. Clicking it selects it; App opens the shared detail card.
function makeViewNode(milestone: Milestone, selectedId: string | null, complete: boolean): ViewFlowNode {
    return {
        id: milestone.id,
        type: "view",
        position: { x: milestone.x - NODE_SIZE.normal.width / 2, y: milestone.y - NODE_SIZE.normal.height / 2 },
        data: { name: milestone.name, isSelected: milestone.id === selectedId, complete }
    }
}

export function MilestoneTree(props: MilestoneTreeProps) {
    // Edges into a static (mirror) node don't gate completion, so drop them before deriving state.
    const structuralEdges = useMemo(
        () => (props.staticNodeIds ? props.edges.filter(([, child]) => !props.staticNodeIds?.has(child)) : props.edges),
        [props.edges, props.staticNodeIds]
    )

    const buildNodes = (): FlowNode[] =>
        Object.values(props.milestones).map((milestone) =>
            props.staticNodeIds?.has(milestone.id)
                ? makeViewNode(milestone, props.selectedId, props.completeNodeIds?.has(milestone.id) ?? false)
                : makeMilestoneNode(milestone, props.selectedId, props.mastered, structuralEdges)
        )

    // React Flow owns node positions so drags stay smooth. useNodesState gives us the applyNodeChanges
    // handler that writes drag/select changes back into that state.
    const [nodes, setNodes, onNodesChange] = useNodesState<FlowNode>(buildNodes())

    // Refit the viewport when nodes are added or removed (e.g. a promoted parent lands above the old
    // goal, off the current view) so the change is actually visible. Position-only drags don't refit.
    const flowRef = useRef<ReactFlowInstance<FlowNode, MilestoneFlowEdge> | null>(null)
    const nodeCount = Object.keys(props.milestones).length
    useEffect(() => {
        flowRef.current?.fitView(FIT_VIEW_OPTIONS)
    }, [nodeCount])

    // Center on a focused node once per focus nonce (URL routing or a just-created node). Waits for
    // the node to exist in React Flow's state (a freshly created one arrives a render later), then
    // pans on the next frame so it's measured first.
    const focusedNonceRef = useRef(-1)
    // biome-ignore lint/correctness/useExhaustiveDependencies: pan once per nonce, after its node mounts
    useEffect(() => {
        const nonce = props.focusNonce ?? -1
        const focusId = props.focusId
        if (nonce === focusedNonceRef.current) return
        if (!focusId || !nodes.some((node) => node.id === focusId)) return
        focusedNonceRef.current = nonce
        const raf = requestAnimationFrame(() =>
            flowRef.current?.fitView({ nodes: [{ id: focusId }], duration: 400, maxZoom: 1.2 })
        )
        return () => cancelAnimationFrame(raf)
    }, [props.focusNonce, nodes])

    // Reconcile the project into React Flow's node state whenever it changes. Milestone nodes keep
    // their React-Flow-owned position (so a re-select, unlock, or rename never snaps a dragged layout
    // back); view chips are derived and non-draggable, so they're rebuilt fresh; removed ones fall away.
    useEffect(() => {
        setNodes((prev) => {
            const byId = new Map(prev.map((node) => [node.id, node]))
            return Object.values(props.milestones).map((milestone): FlowNode => {
                if (props.staticNodeIds?.has(milestone.id)) {
                    return makeViewNode(milestone, props.selectedId, props.completeNodeIds?.has(milestone.id) ?? false)
                }
                const isGoal = milestone.tier === 0
                const isSelected = milestone.id === props.selectedId
                const state = stateOf(milestone.id, props.mastered, structuralEdges)
                const existing = byId.get(milestone.id)
                if (existing && existing.type === "milestone") {
                    return existing.data.isSelected === isSelected &&
                        existing.data.state === state &&
                        existing.data.milestone === milestone &&
                        existing.data.isGoal === isGoal
                        ? existing
                        : { ...existing, data: { ...existing.data, isSelected, state, milestone, isGoal } }
                }
                return makeMilestoneNode(milestone, props.selectedId, props.mastered, structuralEdges)
            })
        })
    }, [
        props.selectedId,
        props.mastered,
        props.milestones,
        structuralEdges,
        props.staticNodeIds,
        props.completeNodeIds,
        setNodes
    ])

    // Edges rebuild when the project's links or completed set change: a link lights once the node
    // below it is done. For a milestone that means it's mastered; for a view chip it means that view
    // is complete (its goal done), so mirror links light with the tree just like normal ones.
    const edges = useMemo<MilestoneFlowEdge[]>(
        () =>
            props.edges.map(
                ([parent, child]): MilestoneFlowEdge => ({
                    id: `${parent}-${child}`,
                    source: parent,
                    target: child,
                    type: "glow",
                    data: { lit: props.mastered.has(child) || (props.completeNodeIds?.has(child) ?? false) }
                })
            ),
        [props.edges, props.mastered, props.completeNodeIds]
    )

    // Newly added nodes spawn-in, but not the initial batch or a tab-switch remount: flip "ready" a
    // tick after mount so only nodes that appear afterwards animate. Resets per tab (this remounts).
    const [spawnReady, setSpawnReady] = useState(false)
    useEffect(() => setSpawnReady(true), [])

    return (
        <SpawnReadyContext.Provider value={spawnReady}>
            <div className="h-full w-full">
                <ReactFlow
                    nodes={nodes}
                    edges={edges}
                    nodeTypes={nodeTypes}
                    edgeTypes={edgeTypes}
                    onInit={(instance) => {
                        flowRef.current = instance
                    }}
                    onNodesChange={onNodesChange}
                    onEdgesChange={noop}
                    onNodeClick={(_, node) => props.onSelect(node.id)}
                    onNodeDragStop={(_, node) => {
                        // Convert React Flow's top-left back to the stored centre; view chips use normal size.
                        const size = node.type === "milestone" && node.data.isGoal ? NODE_SIZE.goal : NODE_SIZE.normal
                        props.onMove(node.id, node.position.x + size.width / 2, node.position.y + size.height / 2)
                    }}
                    nodesConnectable={false}
                    proOptions={proOptions}
                    fitView
                    fitViewOptions={FIT_VIEW_OPTIONS}
                >
                    <Background />
                    <Controls />
                </ReactFlow>
            </div>
        </SpawnReadyContext.Provider>
    )
}

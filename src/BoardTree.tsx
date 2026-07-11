// The React Flow canvas for one tab's roadmap: it maps that board's nodes + edges into React
// Flow nodes and edges, wires click-to-select, and lets nodes be dragged. Scope is VISUAL +
// SELECTION + LAYOUT — appearance lives in NodeCard / Edge / LinkedNode, completion/edit
// logic lives in App. Selection is ours (onNodeClick -> onSelect); positions live in React Flow's own
// node state so drags stay smooth, and each drag's final spot is reported up via onMove so it survives
// a tab switch (the parent re-keys this component per tab, remounting it from the stored positions).
//
// `staticNodeIds` marks the Root view's per-view mirror nodes: they render as linked-node chips
// (LinkedNode), can't be dragged, and don't count toward any parent's completion, so an edge into one
// never locks its source. Clicking one selects it (revealing its popover); its popover's button calls
// `onView`.

import { Background, Controls, ReactFlow, type ReactFlowInstance, useNodesState } from "@xyflow/react"
import { useEffect, useMemo, useRef, useState } from "react"
import { Edge } from "./Edge"
import type { FlowNode, LinkedFlowNode, NodeFlowEdge, NodeFlowNode } from "./flow"
import { NODE_SIZE } from "./flow"
import { stateOf } from "./graph"
import { NodeCard } from "./NodeCard"
import { LinkedNode } from "./LinkedNode"
// The tuple type `Edge` clashes with the `Edge` edge component above, so alias the tuple here.
import type { Edge as EdgeTuple, Node } from "./nodes"
import { SpawnReadyContext } from "./nodeMotion"

type BoardTreeProps = {
    selectedId: string | null
    onSelect: (id: string) => void
    // The completed set: drives each node's tri-state and lights the edge below a completed node.
    mastered: ReadonlySet<string>
    // The active board's node records keyed by id; each node card renders its live name here.
    milestones: Record<string, Node>
    // The active board's parent/child links.
    edges: EdgeTuple[]
    // Report a node's new centre after a drag so the parent can persist it (nodes and mirrors).
    onMove: (id: string, x: number, y: number) => void
    // Mirror nodes: excluded from completion math and rendered as linked-node chips (still draggable).
    staticNodeIds?: ReadonlySet<string>
    // Mirror nodes whose board is complete (its root node is done), rendered with the mastered look.
    completeNodeIds?: ReadonlySet<string>
    // A node to pan/zoom onto; bumping focusNonce (re)triggers centering (URL routing).
    focusId?: string
    focusNonce?: number
}

// Stable references so React Flow doesn't warn about a freshly-built nodeTypes/edgeTypes each render.
const nodeTypes = { milestone: NodeCard, view: LinkedNode }
const edgeTypes = { glow: Edge }

// Edges are controlled but never mutated in place, so React Flow only needs a stable no-op handler.
const noop = () => {}

// Whole-tree fit: pad the frame, and cap the zoom at 1x so a small tree (e.g. the Root hub or a
// fresh board) sits at natural size instead of blowing up to React Flow's default 2x maximum.
const FIT_VIEW_OPTIONS = { padding: 0.08, maxZoom: 1 }

// Hide the React Flow attribution watermark in the canvas corner.
const proOptions = { hideAttribution: true }

// Build a node card. The stored (x, y) is the card centre; React Flow anchors at the
// top-left, so shift by half the card to land the centre back on (x, y).
function makeNode(
    milestone: Node,
    selectedId: string | null,
    mastered: ReadonlySet<string>,
    structuralEdges: EdgeTuple[]
): NodeFlowNode {
    const isRoot = milestone.tier === 0
    const size = isRoot ? NODE_SIZE.root : NODE_SIZE.normal
    return {
        id: milestone.id,
        type: "milestone",
        position: { x: milestone.x - size.width / 2, y: milestone.y - size.height / 2 },
        data: {
            milestone,
            state: stateOf(milestone.id, mastered, structuralEdges),
            isRoot,
            isSelected: milestone.id === selectedId
        }
    }
}

// Build a linked-node chip (Root's mirror of another tab): a normal-sized, draggable node carrying a
// label and its board's completeness. Clicking it selects it; App opens the shared detail card.
function makeLinkedNode(milestone: Node, selectedId: string | null, complete: boolean): LinkedFlowNode {
    return {
        id: milestone.id,
        type: "view",
        position: { x: milestone.x - NODE_SIZE.normal.width / 2, y: milestone.y - NODE_SIZE.normal.height / 2 },
        data: { name: milestone.name, isSelected: milestone.id === selectedId, complete }
    }
}

export function BoardTree(props: BoardTreeProps) {
    // Edges into a static (mirror) node don't gate completion, so drop them before deriving state.
    const structuralEdges = useMemo(
        () => (props.staticNodeIds ? props.edges.filter(([, child]) => !props.staticNodeIds?.has(child)) : props.edges),
        [props.edges, props.staticNodeIds]
    )

    const buildNodes = (): FlowNode[] =>
        Object.values(props.milestones).map((milestone) =>
            props.staticNodeIds?.has(milestone.id)
                ? makeLinkedNode(milestone, props.selectedId, props.completeNodeIds?.has(milestone.id) ?? false)
                : makeNode(milestone, props.selectedId, props.mastered, structuralEdges)
        )

    // React Flow owns node positions so drags stay smooth. useNodesState gives us the applyNodeChanges
    // handler that writes drag/select changes back into that state.
    const [nodes, setNodes, onNodesChange] = useNodesState<FlowNode>(buildNodes())

    // Refit the viewport when nodes are added or removed (e.g. a promoted parent lands above the old
    // root, off the current view) so the change is actually visible. Position-only drags don't refit.
    const flowRef = useRef<ReactFlowInstance<FlowNode, NodeFlowEdge> | null>(null)
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

    // Reconcile the board into React Flow's node state whenever it changes. Node cards keep
    // their React-Flow-owned position (so a re-select, unlock, or rename never snaps a dragged layout
    // back); linked chips are derived and non-draggable, so they're rebuilt fresh; removed ones fall away.
    useEffect(() => {
        setNodes((prev) => {
            const byId = new Map(prev.map((node) => [node.id, node]))
            return Object.values(props.milestones).map((milestone): FlowNode => {
                if (props.staticNodeIds?.has(milestone.id)) {
                    return makeLinkedNode(milestone, props.selectedId, props.completeNodeIds?.has(milestone.id) ?? false)
                }
                const isRoot = milestone.tier === 0
                const isSelected = milestone.id === props.selectedId
                const state = stateOf(milestone.id, props.mastered, structuralEdges)
                const existing = byId.get(milestone.id)
                if (existing && existing.type === "milestone") {
                    // Keep the React-Flow-owned position while dragging; otherwise sync it to the stored
                    // (x, y). At rest, a drag has already been persisted so the two match (no snap), but a
                    // programmatic move (inserting a parent shifts the subtree down a tier) now lands.
                    const size = isRoot ? NODE_SIZE.root : NODE_SIZE.normal
                    const position = existing.dragging
                        ? existing.position
                        : { x: milestone.x - size.width / 2, y: milestone.y - size.height / 2 }
                    const posSame = position.x === existing.position.x && position.y === existing.position.y
                    const dataSame =
                        existing.data.isSelected === isSelected &&
                        existing.data.state === state &&
                        existing.data.milestone === milestone &&
                        existing.data.isRoot === isRoot
                    if (posSame && dataSame) return existing
                    return {
                        ...existing,
                        position,
                        data: dataSame ? existing.data : { ...existing.data, isSelected, state, milestone, isRoot }
                    }
                }
                return makeNode(milestone, props.selectedId, props.mastered, structuralEdges)
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

    // Edges rebuild when the board's links or completed set change: a link lights once the node
    // below it is done. For a node that means it's mastered; for a linked chip it means that board
    // is complete (its root node done), so mirror links light with the tree just like normal ones.
    const edges = useMemo<NodeFlowEdge[]>(
        () =>
            props.edges.map(
                ([parent, child]): NodeFlowEdge => ({
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
                        // Convert React Flow's top-left back to the stored centre; linked chips use normal size.
                        const size = node.type === "milestone" && node.data.isRoot ? NODE_SIZE.root : NODE_SIZE.normal
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

// The React Flow canvas for one tab's roadmap: it maps that board's nodes + edges into React
// Flow nodes and edges, wires click-to-select, and lets nodes be dragged. Scope is VISUAL +
// SELECTION + LAYOUT — appearance lives in NodeCard / Edge, completion/edit logic lives in App.
// Selection is ours (onNodeClick -> onSelect); positions live in React Flow's own node state so drags
// stay smooth, and each drag's final spot is reported up via onMove so it survives a tab switch (the
// parent re-keys this component per tab, remounting it from the stored positions).
//
// The `view` node type (LinkedNode) is registered but dormant: linked nodes arrive in Phase 2, when a
// draggable makeLinkedNode is reintroduced. Until then every node is a regular node card.

import { Background, Controls, ReactFlow, type ReactFlowInstance, useNodesState } from "@xyflow/react"
import { useEffect, useMemo, useRef, useState } from "react"
import { Edge } from "./Edge"
import type { FlowNode, NodeFlowEdge, NodeFlowNode } from "./flow"
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
    // The board's root node id: the one node drawn at root size (kind is positional, root = this id).
    rootId: string
    // The completed set: drives each node's tri-state and lights the edge below a completed node.
    mastered: ReadonlySet<string>
    // The active board's node records keyed by id; each node card renders its live name here.
    nodes: Record<string, Node>
    // The active board's parent/child links.
    edges: EdgeTuple[]
    // Report a node's new centre after a drag so the parent can persist it.
    onMove: (id: string, x: number, y: number) => void
    // A node to pan/zoom onto; bumping focusNonce (re)triggers centering (URL routing).
    focusId?: string
    focusNonce?: number
}

// Stable references so React Flow doesn't warn about a freshly-built nodeTypes/edgeTypes each render.
const nodeTypes = { milestone: NodeCard, view: LinkedNode }
const edgeTypes = { glow: Edge }

// Edges are controlled but never mutated in place, so React Flow only needs a stable no-op handler.
const noop = () => {}

// Whole-tree fit: pad the frame, and cap the zoom at 1x so a small tree (a fresh board) sits at
// natural size instead of blowing up to React Flow's default 2x maximum.
const FIT_VIEW_OPTIONS = { padding: 0.08, maxZoom: 1 }

// Hide the React Flow attribution watermark in the canvas corner.
const proOptions = { hideAttribution: true }

// Build a node card. The stored (x, y) is the card centre; React Flow anchors at the
// top-left, so shift by half the card to land the centre back on (x, y).
function makeNode(
    node: Node,
    rootId: string,
    selectedId: string | null,
    mastered: ReadonlySet<string>,
    edges: EdgeTuple[]
): NodeFlowNode {
    const isRoot = node.id === rootId
    const size = isRoot ? NODE_SIZE.root : NODE_SIZE.normal
    return {
        id: node.id,
        type: "milestone",
        position: { x: node.x - size.width / 2, y: node.y - size.height / 2 },
        data: {
            milestone: node,
            state: stateOf(node.id, mastered, edges),
            isRoot,
            isSelected: node.id === selectedId
        }
    }
}

export function BoardTree(props: BoardTreeProps) {
    const buildNodes = (): FlowNode[] =>
        Object.values(props.nodes).map((node) => makeNode(node, props.rootId, props.selectedId, props.mastered, props.edges))

    // React Flow owns node positions so drags stay smooth. useNodesState gives us the applyNodeChanges
    // handler that writes drag/select changes back into that state.
    const [nodes, setNodes, onNodesChange] = useNodesState<FlowNode>(buildNodes())

    // Refit the viewport when nodes are added or removed (e.g. a promoted parent lands above the old
    // root, off the current view) so the change is actually visible. Position-only drags don't refit.
    const flowRef = useRef<ReactFlowInstance<FlowNode, NodeFlowEdge> | null>(null)
    const nodeCount = Object.keys(props.nodes).length
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

    // Reconcile the board into React Flow's node state whenever it changes. Cards keep their
    // React-Flow-owned position (so a re-select, unlock, or rename never snaps a dragged layout back);
    // removed ones fall away. A programmatic move (inserting a parent shifts the subtree) still lands.
    useEffect(() => {
        setNodes((prev) => {
            const byId = new Map(prev.map((node) => [node.id, node]))
            return Object.values(props.nodes).map((node): FlowNode => {
                const isRoot = node.id === props.rootId
                const isSelected = node.id === props.selectedId
                const state = stateOf(node.id, props.mastered, props.edges)
                const existing = byId.get(node.id)
                if (existing && existing.type === "milestone") {
                    const size = isRoot ? NODE_SIZE.root : NODE_SIZE.normal
                    const position = existing.dragging
                        ? existing.position
                        : { x: node.x - size.width / 2, y: node.y - size.height / 2 }
                    const posSame = position.x === existing.position.x && position.y === existing.position.y
                    const dataSame =
                        existing.data.isSelected === isSelected &&
                        existing.data.state === state &&
                        existing.data.milestone === node &&
                        existing.data.isRoot === isRoot
                    if (posSame && dataSame) return existing
                    return {
                        ...existing,
                        position,
                        data: dataSame ? existing.data : { ...existing.data, isSelected, state, milestone: node, isRoot }
                    }
                }
                return makeNode(node, props.rootId, props.selectedId, props.mastered, props.edges)
            })
        })
    }, [props.selectedId, props.mastered, props.nodes, props.edges, props.rootId, setNodes])

    // Edges rebuild when the board's links or completed set change: a link lights once the node
    // below it is complete.
    const edges = useMemo<NodeFlowEdge[]>(
        () =>
            props.edges.map(
                ([parent, child]): NodeFlowEdge => ({
                    id: `${parent}-${child}`,
                    source: parent,
                    target: child,
                    type: "glow",
                    data: { lit: props.mastered.has(child) }
                })
            ),
        [props.edges, props.mastered]
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
                        // Convert React Flow's top-left back to the stored centre.
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

// The React Flow canvas for one tab's roadmap: it maps that board's nodes + edges into React
// Flow nodes and edges, wires click-to-select, and lets nodes be dragged. Scope is VISUAL +
// SELECTION + LAYOUT — appearance lives in NodeCard / LinkedNode / Edge, completion/edit logic lives in
// App. Selection is ours (onNodeClick -> onSelect); positions live in React Flow's own node state so
// drags stay smooth, and each drag's final spot is reported up via onMove so it survives a tab switch
// (the parent re-keys this component per tab, remounting it from the stored positions).
//
// A node's kind is positional: a linked node is any node carrying the `targetBoardId` key (rendered by
// LinkedNode, type "linked"); every other node is a regular / root card (NodeCard, type "node"). A
// linked node's label is derived live from its target board's root (linkedNodeName), which is why the
// whole boards map flows in as a prop.

import { Background, Controls, ReactFlow, type ReactFlowInstance, useNodesState } from "@xyflow/react"
import { useEffect, useMemo, useRef, useState } from "react"
import { type Boards, boardCompleter, linkedNodeName } from "./board"
import { Edge } from "./Edge"
import type { FlowNode, LinkedFlowNode, NodeFlowEdge, NodeFlowNode } from "./flow"
import { NODE_SIZE } from "./flow"
import { type BoardComplete, descendantsOf, isMastered, stateOf } from "./graph"
import { LinkedNode } from "./LinkedNode"
import { NodeCard } from "./NodeCard"
// The tuple type `Edge` clashes with the `Edge` edge component above, so alias the tuple here.
import { type Edge as EdgeTuple, isLinkedNode, type Node } from "./nodes"
import { prefersReducedMotion, SpawnReadyContext } from "./nodeMotion"
import { PRESS_MOVE_TOLERANCE } from "./TabBar"

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
    // Every board, so a linked node can derive its label from its target board's root node (live).
    boards: Boards
    // Report a node's new centre after a drag so the parent can persist it.
    onMove: (id: string, x: number, y: number) => void
    // A node to pan/zoom onto; bumping focusNonce (re)triggers centering (URL routing).
    focusId?: string
    focusNonce?: number
    // When set, the id of the node being re-hung (detach + click-to-attach, or Attach on a parked
    // orphan). While armed a node click attaches (onAttach) instead of selecting, and a loose "rubber
    // band" edge trails the pointer. Null when idle. The detach itself is a persisted board op (App
    // dispatched it before arming), so the board's edges already omit the branch's incoming edge and it
    // derives as "detached" by the normal state rule -- this prop only drives the armed affordances.
    reparenting?: string | null
    // Attach the reparenting node under the clicked target; App validates (same board, not the node or
    // a descendant) and commits the move via the pure reparent op.
    onAttach?: (targetId: string) => void
}

// Stable references so React Flow doesn't warn about a freshly-built nodeTypes/edgeTypes each render.
const nodeTypes = { node: NodeCard, linked: LinkedNode }
const edgeTypes = { glow: Edge }

// Edges are controlled but never mutated in place, so React Flow only needs a stable no-op handler.
const noop = () => {}

// Whole-tree fit: pad the frame, and cap the zoom at 1x so a small tree (a fresh board) sits at
// natural size instead of blowing up to React Flow's default 2x maximum.
const FIT_VIEW_OPTIONS = { padding: 0.08, maxZoom: 1 }

// Hide the React Flow attribution watermark in the canvas corner.
const proOptions = { hideAttribution: true }

type Size = { width: number; height: number }
type Point = { x: number; y: number }
// An on-screen box in container-relative coords: the detached node's box (for the band + armed ring +
// hint) and a hovered target's box (for the drop-target ring) are both measured as one of these.
type Rect = Point & Size

// The loose reparent band as a slack "noodle" (cubic bezier), like a UE5 / node-graph connection
// wire, rather than a taut straight line. Each end gets a horizontal tangent that eases the wire out
// flat and points it toward the target (length tracks the horizontal span, with a floor), and both
// control points are pulled DOWN by a gravity sag (SVG +y is down) that grows with the wire's length
// and caps out -- so the band hangs and droops like a loose cable and reshapes live as you drag,
// instead of holding one fixed arc.
function curvedBand(start: Point, end: Point): string {
    const dx = end.x - start.x
    const len = Math.hypot(dx, end.y - start.y)
    const tangent = Math.max(Math.abs(dx) * 0.5, 30) * (dx >= 0 ? 1 : -1)
    const sag = Math.min(len * 0.25, 80)
    const c1x = start.x + tangent
    const c1y = start.y + sag
    const c2x = end.x - tangent
    const c2y = end.y + sag
    return `M ${start.x},${start.y} C ${c1x},${c1y} ${c2x},${c2y} ${end.x},${end.y}`
}

// A board node's fixed draw size by kind/role: the root node card is the larger size; linked and
// regular non-root cards use the normal size. Single source of truth for the centre<->top-left math
// below, so every conversion agrees on how big the card it's shifting is.
function sizeOf(node: Node, rootId: string): Size {
    return isLinkedNode(node) ? NODE_SIZE.normal : node.id === rootId ? NODE_SIZE.root : NODE_SIZE.normal
}

// The stored (x, y) is a card's centre; React Flow anchors at the top-left, so shift by half the card
// to land the centre back on (x, y).
function toTopLeft(node: Node, size: Size): Point {
    return { x: node.x - size.width / 2, y: node.y - size.height / 2 }
}

// Inverse of toTopLeft: convert React Flow's top-left position back to the stored centre (reported up
// on drag-stop).
function toCenter(pos: Point, size: Size): Point {
    return { x: pos.x + size.width / 2, y: pos.y + size.height / 2 }
}

// Build a node card. The stored (x, y) is the card centre; React Flow anchors at the
// top-left, so shift by half the card to land the centre back on (x, y).
function makeNode(
    node: Node,
    rootId: string,
    selectedId: string | null,
    mastered: ReadonlySet<string>,
    edges: EdgeTuple[],
    nodes: Record<string, Node>,
    boardComplete: BoardComplete
): NodeFlowNode {
    const isRoot = node.id === rootId
    return {
        id: node.id,
        type: "node",
        position: toTopLeft(node, sizeOf(node, rootId)),
        data: {
            node,
            state: stateOf(node.id, mastered, edges, nodes, boardComplete, rootId),
            isRoot,
            isSelected: node.id === selectedId
        }
    }
}

// Build a linked node card: same centre-anchoring as a normal node (linked nodes draw at normal size),
// with its label derived live from the target board's root node.
function makeLinkedNode(
    node: Node,
    selectedId: string | null,
    mastered: ReadonlySet<string>,
    edges: EdgeTuple[],
    boards: Boards,
    nodes: Record<string, Node>,
    boardComplete: BoardComplete,
    rootId: string
): LinkedFlowNode {
    return {
        id: node.id,
        type: "linked",
        position: toTopLeft(node, NODE_SIZE.normal),
        data: {
            name: linkedNodeName(boards, node.targetBoardId),
            state: stateOf(node.id, mastered, edges, nodes, boardComplete, rootId),
            isSelected: node.id === selectedId
        }
    }
}

// One flow node for a board node, dispatched by kind (positional: targetBoardId present -> linked).
function buildFlowNode(
    node: Node,
    rootId: string,
    selectedId: string | null,
    mastered: ReadonlySet<string>,
    edges: EdgeTuple[],
    boards: Boards,
    nodes: Record<string, Node>,
    boardComplete: BoardComplete
): FlowNode {
    return isLinkedNode(node)
        ? makeLinkedNode(node, selectedId, mastered, edges, boards, nodes, boardComplete, rootId)
        : makeNode(node, rootId, selectedId, mastered, edges, nodes, boardComplete)
}

// One glow edge per link. It lights ("lit") when the child below is mastered, so the gold grows up the
// thread toward the parent it unlocks. A linked child counts as mastered when its target board is
// complete, so isMastered (not raw `mastered` membership) drives the light.
export function buildEdges(
    edges: EdgeTuple[],
    mastered: ReadonlySet<string>,
    nodes: Record<string, Node>,
    boardComplete: BoardComplete
): NodeFlowEdge[] {
    return edges.map(
        ([parent, child]): NodeFlowEdge => ({
            id: `${parent}-${child}`,
            source: parent,
            target: child,
            type: "glow",
            data: { lit: isMastered(child, mastered, nodes, boardComplete) }
        })
    )
}

// Whether a node is a valid reparent target while armed: a node in this board that is reachable from the
// root (so you can only re-home under the live tree, never under another parked branch), and is neither
// the detached node itself nor one of its descendants (re-hanging under its own subtree would cycle).
// Mirrors App.attachTo's guard, so the hover affordance lights exactly the nodes a tap would attach to:
// any node in this board that is neither the moving node nor one of its descendants (attaching under a
// descendant would cycle). A detached / parked target is allowed -- the moving node just joins that
// parked branch until the branch itself re-homes. Exported for a direct unit test (hover is awkward to
// drive in jsdom).
export function isReparentTarget(id: string, detachedId: string, edges: EdgeTuple[]): boolean {
    return id !== detachedId && !descendantsOf(detachedId, edges).includes(id)
}

export function BoardTree(props: BoardTreeProps) {
    // A completion resolver over every board, so a linked node's tri-state (and the top-down lock of its
    // subtree) derives from its target board. Recomputed only when the boards map changes.
    const isBoardComplete = useMemo(() => boardCompleter(props.boards), [props.boards])

    // The armed node id (detach + click-to-attach, or Attach on a parked orphan). Detach persists the
    // edge removal before arming, so the board's edges already omit the branch's incoming edge and it
    // derives "detached" straight from props.edges -- no view-only edge surgery here. Drives the band +
    // gates below; null when idle.
    const reparentingId = props.reparenting ?? null

    const buildNodes = (): FlowNode[] =>
        Object.values(props.nodes).map((node) =>
            buildFlowNode(
                node,
                props.rootId,
                props.selectedId,
                props.mastered,
                props.edges,
                props.boards,
                props.nodes,
                isBoardComplete
            )
        )

    // React Flow owns node positions so drags stay smooth. useNodesState gives us the applyNodeChanges
    // handler that writes drag/select changes back into that state.
    const [nodes, setNodes, onNodesChange] = useNodesState<FlowNode>(buildNodes())

    // Refit the viewport only when nodes were ADDED (e.g. add-parent lands a new root above the old one,
    // off the current view) so the addition is visible. A removal (delete) keeps the current viewport,
    // and position-only drags don't refit.
    const flowRef = useRef<ReactFlowInstance<FlowNode, NodeFlowEdge> | null>(null)
    const nodeCount = Object.keys(props.nodes).length
    const prevNodeCount = useRef(nodeCount)
    useEffect(() => {
        const grew = nodeCount > prevNodeCount.current
        prevNodeCount.current = nodeCount
        if (grew) flowRef.current?.fitView(FIT_VIEW_OPTIONS)
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
    // removed ones fall away; a node that changed kind (a rare edge case) rebuilds from scratch. A
    // programmatic move (inserting a parent shifts the subtree) still lands.
    useEffect(() => {
        setNodes((prev) => {
            const byId = new Map(prev.map((node) => [node.id, node]))
            return Object.values(props.nodes).map((node): FlowNode => {
                const isSelected = node.id === props.selectedId
                const state = stateOf(node.id, props.mastered, props.edges, props.nodes, isBoardComplete, props.rootId)
                const existing = byId.get(node.id)
                const size = sizeOf(node, props.rootId)

                if (isLinkedNode(node)) {
                    const name = linkedNodeName(props.boards, node.targetBoardId)
                    if (existing && existing.type === "linked") {
                        const position = existing.dragging ? existing.position : toTopLeft(node, size)
                        const posSame = position.x === existing.position.x && position.y === existing.position.y
                        const dataSame =
                            existing.data.isSelected === isSelected &&
                            existing.data.state === state &&
                            existing.data.name === name
                        if (posSame && dataSame) return existing
                        return { ...existing, position, data: dataSame ? existing.data : { name, state, isSelected } }
                    }
                    return makeLinkedNode(
                        node,
                        props.selectedId,
                        props.mastered,
                        props.edges,
                        props.boards,
                        props.nodes,
                        isBoardComplete,
                        props.rootId
                    )
                }

                const isRoot = node.id === props.rootId
                if (existing && existing.type === "node") {
                    const position = existing.dragging ? existing.position : toTopLeft(node, size)
                    const posSame = position.x === existing.position.x && position.y === existing.position.y
                    const dataSame =
                        existing.data.isSelected === isSelected &&
                        existing.data.state === state &&
                        existing.data.node === node &&
                        existing.data.isRoot === isRoot
                    if (posSame && dataSame) return existing
                    return {
                        ...existing,
                        position,
                        data: dataSame ? existing.data : { ...existing.data, isSelected, state, node, isRoot }
                    }
                }
                return makeNode(
                    node,
                    props.rootId,
                    props.selectedId,
                    props.mastered,
                    props.edges,
                    props.nodes,
                    isBoardComplete
                )
            })
        })
    }, [props.selectedId, props.mastered, props.nodes, props.edges, props.rootId, props.boards, isBoardComplete, setNodes])

    // Edges rebuild when the board's links, completed set, or any board's completion change: a link
    // lights once the node below it is mastered (a linked node counts as mastered when its target
    // board is complete, so its incoming edge lights too). See buildEdges.
    const edges = useMemo<NodeFlowEdge[]>(
        () => buildEdges(props.edges, props.mastered, props.nodes, isBoardComplete),
        [props.edges, props.mastered, props.nodes, isBoardComplete]
    )

    // Newly added nodes spawn-in, but not the initial batch or a tab-switch remount: flip "ready" a
    // tick after mount so only nodes that appear afterwards animate. Resets per tab (this remounts).
    const [spawnReady, setSpawnReady] = useState(false)
    useEffect(() => setSpawnReady(true), [])

    // Tap-vs-pan (touch): remember where each press lands so a tap can be told from a pan. While armed,
    // a "tap" (barely moved) on a node attaches, but a press that drifts past the shared press-move
    // tolerance is a pan to reach a target and must NOT misfire as an attach (onNodeClick, below).
    // Captured on the container so we see the press before React Flow's own pan handler; a mouse click
    // never drifts, so this leaves the mouse path untouched.
    const containerRef = useRef<HTMLDivElement>(null)
    const pressOrigin = useRef<Point | null>(null)

    // The loose "rubber band" + affordances drawn while a reparent is armed. `node` is the detached
    // node's on-screen box (container-relative), `pointer` the trailing cursor; the band runs from the
    // node's centre to the pointer, and the same box pins the armed ring + hint. Null when idle.
    const [armed, setArmed] = useState<{ node: Rect; pointer: Point } | null>(null)
    // The valid target under the mouse (its container-relative box), lit as a drop target. Set on
    // hover-enter of a valid node, cleared on leave; touch has no hover, so it stays null there.
    const [hoverRect, setHoverRect] = useState<Rect | null>(null)
    useEffect(() => {
        const container = containerRef.current
        if (!reparentingId || !container) {
            setArmed(null)
            setHoverRect(null)
            return
        }
        // Re-measure the detached node's box each move so panning / zooming keeps the band, ring, and
        // hint pinned; fall back to the canvas centre if it can't be found (it always should be on screen).
        const measure = (): Rect => {
            const box = container.getBoundingClientRect()
            const node = container.querySelector(`[data-id="${reparentingId}"]`)?.getBoundingClientRect()
            return node
                ? { x: node.left - box.left, y: node.top - box.top, width: node.width, height: node.height }
                : { x: box.width / 2, y: box.height / 2, width: 0, height: 0 }
        }
        // Seed as a zero-length band at the node's centre, so it's drawn the instant we arm -- before the
        // first pointer move.
        const node = measure()
        setArmed({ node, pointer: { x: node.x + node.width / 2, y: node.y + node.height / 2 } })
        const onMove = (event: PointerEvent) => {
            const box = container.getBoundingClientRect()
            setArmed({ node: measure(), pointer: { x: event.clientX - box.left, y: event.clientY - box.top } })
        }
        window.addEventListener("pointermove", onMove)
        return () => window.removeEventListener("pointermove", onMove)
    }, [reparentingId])

    // Reduced motion drops the band's marching dashes (a static line is fine), never the band itself.
    // Read via the shared prefersReducedMotion guard -- the same one the node motion uses.
    const reducedMotion = prefersReducedMotion()
    // The band's pinned end: the detached node's centre.
    const armedCenter = armed && { x: armed.node.x + armed.node.width / 2, y: armed.node.y + armed.node.height / 2 }

    return (
        <SpawnReadyContext.Provider value={spawnReady}>
            <div
                ref={containerRef}
                className="relative h-full w-full"
                // Seed the tap-vs-pan test (see pressOrigin): remember where each press lands. Capture
                // phase so we record it before React Flow's pane handler can consume the event.
                onPointerDownCapture={(event) => {
                    pressOrigin.current = { x: event.clientX, y: event.clientY }
                }}
            >
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
                    onNodeClick={(event, node) => {
                        if (!reparentingId) {
                            props.onSelect(node.id)
                            return
                        }
                        // A tap attaches; a press that drifted past the tolerance panned to reach the
                        // node, so swallow it (no attach). A mouse click never drifts, so it always
                        // attaches; a press with no recorded origin (a bare programmatic click) does too.
                        const origin = pressOrigin.current
                        const panned =
                            !!origin &&
                            (Math.abs(event.clientX - origin.x) > PRESS_MOVE_TOLERANCE ||
                                Math.abs(event.clientY - origin.y) > PRESS_MOVE_TOLERANCE)
                        if (!panned) props.onAttach?.(node.id)
                    }}
                    onNodeMouseEnter={(_, node) => {
                        // Light a valid target as the mouse enters it; invalid nodes (the detached node,
                        // its descendants) are skipped, so they stay dim. Touch fires no hover.
                        if (!reparentingId || !isReparentTarget(node.id, reparentingId, props.edges)) return
                        const container = containerRef.current
                        if (!container) return
                        const box = container.getBoundingClientRect()
                        const el = container.querySelector(`[data-id="${node.id}"]`)?.getBoundingClientRect()
                        if (el) setHoverRect({ x: el.left - box.left, y: el.top - box.top, width: el.width, height: el.height })
                    }}
                    onNodeMouseLeave={() => {
                        if (reparentingId) setHoverRect(null)
                    }}
                    onNodeDragStop={(_, node) => {
                        // Convert React Flow's top-left back to the stored centre. Only a root node card
                        // is the larger size; linked and regular non-root nodes use the normal size.
                        const size = node.type === "node" && node.data.isRoot ? NODE_SIZE.root : NODE_SIZE.normal
                        const center = toCenter(node.position, size)
                        props.onMove(node.id, center.x, center.y)
                    }}
                    // While armed, a press-drag pans (to reach a target) instead of dragging the inert
                    // detached node, so the tap-vs-pan gate on onNodeClick is all that decides an attach.
                    nodesDraggable={!reparentingId}
                    nodesConnectable={false}
                    proOptions={proOptions}
                    fitView
                    fitViewOptions={FIT_VIEW_OPTIONS}
                >
                    <Background />
                    <Controls />
                </ReactFlow>
                {/* The reparent affordances, drawn while armed. Two layers: the loose noodle sits BELOW
                    the nodes, the armed / drop-target rings and the hint ABOVE them. All pointer-events-none
                    so a click falls through to the node / pane beneath (that click attaches or cancels).
                    Dotted gold to read as a not-yet-committed link. */}
                {reparentingId && armed && armedCenter && (
                    <>
                        {/* The loose noodle, pinned to the detached node and trailing the pointer, drawn
                            UNDER the nodes: a negative z-index paints it over the parchment but beneath
                            every node card / edge, so it never covers a node. Its dashes march to read as
                            a live link -- dropped under reduced motion. */}
                        <svg
                            data-testid="reparent-band"
                            aria-hidden="true"
                            className="pointer-events-none absolute inset-0 h-full w-full overflow-visible"
                            style={{ zIndex: -1 }}
                        >
                            <path
                                d={curvedBand(armedCenter, armed.pointer)}
                                fill="none"
                                stroke="#e9b949"
                                strokeWidth={2.4}
                                strokeDasharray="2 9"
                                strokeLinecap="round"
                                className={reducedMotion ? undefined : "animate-[march_1.8s_linear_infinite]"}
                            />
                            <circle cx={armed.pointer.x} cy={armed.pointer.y} r={4} fill="#e9b949" />
                        </svg>
                        {/* The rings stay ABOVE the nodes (z-10): the armed highlight and the hover
                            drop-target ring frame their nodes, so they must not be hidden behind them. */}
                        <svg
                            aria-hidden="true"
                            className="pointer-events-none absolute inset-0 z-10 h-full w-full overflow-visible"
                        >
                            {/* Armed highlight: a gold ring on the detached node, so touch users (no
                                hover / cursor to follow) can see which node is lifted. */}
                            <rect
                                data-testid="reparent-armed"
                                x={armed.node.x - 5}
                                y={armed.node.y - 5}
                                width={armed.node.width + 10}
                                height={armed.node.height + 10}
                                rx={16}
                                fill="none"
                                stroke="#e9b949"
                                strokeWidth={3}
                                style={{ filter: "drop-shadow(0 0 6px rgba(233,185,73,0.7))" }}
                            />
                            {/* Hover affordance (mouse): a gold drop-target ring on the valid node under
                                the cursor. Invalid nodes never set hoverRect, so they stay dim. */}
                            {hoverRect && (
                                <rect
                                    data-testid="reparent-target"
                                    x={hoverRect.x - 4}
                                    y={hoverRect.y - 4}
                                    width={hoverRect.width + 8}
                                    height={hoverRect.height + 8}
                                    rx={16}
                                    fill="rgba(233,185,73,0.12)"
                                    stroke="#dab24c"
                                    strokeWidth={2.4}
                                />
                            )}
                        </svg>
                        {/* Touch has no hover to follow, so spell out the gesture under the lifted node.
                            pointer-events-none so it never swallows the tap that attaches. */}
                        <div
                            data-testid="reparent-hint"
                            aria-hidden="true"
                            className="pointer-events-none absolute z-10 -translate-x-1/2 whitespace-nowrap rounded-md bg-[#4a3410]/90 px-2.5 py-1 font-display text-[11.5px] font-semibold tracking-wide text-[#f6edd6]"
                            style={{ left: armedCenter.x, top: armed.node.y + armed.node.height + 8 }}
                        >
                            Tap a node to reattach
                        </div>
                    </>
                )}
            </div>
        </SpawnReadyContext.Provider>
    )
}

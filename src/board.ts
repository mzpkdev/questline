// A Board is one tab's roadmap: its own node records, edges, checklists, and completed set. All
// boards are equal -- there is no Root hub and no tree between boards. The tab's label is simply the
// root (tier-0) node's name, so renaming the tab and renaming the root node are the same edit seen
// from two places.
//
// This module owns the boards data: the wire type, the seed, and every pure `(board, ...) -> board`
// op App used to inline (todo edits, complete / uncomplete, editNode, moveNode, addChild, addParent
// via insertParent, deleteNode), plus the map-level addBoard / removeBoard. `boardsReducer` routes a
// single dispatch over `{ boards, order }` through those ops, keeping references stable on a no-op so
// autosave and the gold memo don't churn.

import { type BoardComplete, childrenOf, complete, descendantsOf, parentOf, reachableFromRoot, uncomplete } from "./graph"
import {
    DEFAULT_NODE_REWARD,
    DEFAULT_ROOT_REWARD,
    EDGES,
    type Edge,
    isLinkedNode,
    MASTERED,
    type Node,
    NODES,
    TODOS,
    type Todo
} from "./nodes"

// Vertical gap between tiers, and the horizontal fan for each extra sibling, when a node is
// auto-placed (a new child, or a subtree pushed down a tier). Matches the seed's layout.
const TIER_GAP = 160
const SIBLING_FAN = 70

export type Board = {
    id: string
    // The tier-0 root node; its name is the tab label. Node kind is positional: the root is the node
    // whose id equals this.
    rootId: string
    nodes: Record<string, Node>
    edges: Edge[]
    // Per-node checklists; root and linked nodes have none.
    todos: Record<string, Todo[]>
    // Ids of nodes the user ticked complete. Live as a Set (graph.ts relies on Set semantics); it
    // crosses the persist wire as an array and is rebuilt into a Set on load.
    mastered: ReadonlySet<string>
}

export type Boards = Record<string, Board>
export type BoardsState = { boards: Boards; order: string[] }

// Fields the detail card edits in place on a regular / root node.
type NodePatch = Partial<Pick<Node, "name" | "description" | "reward">>

// A regular node's pre-linked data, snapshotted by App (transient, never persisted) before a
// convert-to-linked, and handed back on convert-to-regular so the node refills with its old name /
// description / reward / checklist instead of the blank default. Same-session only.
export type NodeRestore = { name: string; description?: string; reward?: number; todos: Todo[] }

// The bundled sample roadmap. Everything is deep-copied so editing a board never mutates the module
// seeds. A fresh install seeds exactly this one board (no linked nodes).
export function seedBoard(): Board {
    return {
        id: "seed",
        rootId: "learn",
        nodes: Object.fromEntries(NODES.map((node) => [node.id, { ...node }])),
        edges: EDGES.map((edge) => [...edge] as Edge),
        todos: Object.fromEntries(Object.entries(TODOS).map(([id, list]) => [id, list.map((todo) => ({ ...todo }))])),
        mastered: new Set(MASTERED)
    }
}

// Default blurb on a fresh board's root node.
const NEW_ROOT_DESC = "The end goal for this quest. Add child nodes to break it down into steps."

// Placeholder name shown for a linked node that has not been pointed at a board yet (targetBoardId is
// null), and the fallback when its target board can no longer be found.
export const UNLINKED_LABEL = "Unlinked"

// The display name of a linked node: its target board's root (tier-0) node name, derived live so a
// rename of that board flows through to every linked node pointing at it. Unlinked (or a dangling
// target) falls back to the placeholder. A linked node's own stored `name` is never the display source.
export function linkedNodeName(boards: Boards, targetBoardId: string | null | undefined): string {
    if (!targetBoardId) return UNLINKED_LABEL
    const target = boards[targetBoardId]
    const root = target && target.nodes[target.rootId]
    return root?.name ?? UNLINKED_LABEL
}

// Whether a board is complete: it exists and its root (tier-0) node sits in its own `mastered` set.
// This is the boolean a linked node reads to derive its mastery from its target board (a linked node is
// mastered exactly when its target board is complete). Completion is read here, never cascaded across
// boards, so cyclic / mutual links are harmless.
export function boardComplete(boards: Boards, boardId: string): boolean {
    const board = boards[boardId]
    return board !== undefined && board.mastered.has(board.rootId)
}

// A BoardComplete resolver bound to a boards map, handed to graph.stateOf / graph.complete so a linked
// node resolves its mastery from its target board without graph.ts needing the map (keeping it pure).
export function boardCompleter(boards: Boards): BoardComplete {
    return (boardId) => boardComplete(boards, boardId)
}

// Whether board `from` can reach board `to` by following cross-board links (each linked node points at
// a target board -- one edge in the board-link graph). Breadth-first over boards with a visited guard,
// so an existing cycle can't loop forever.
function boardReaches(boards: Boards, from: string, to: string): boolean {
    const seen = new Set<string>([from])
    const queue: string[] = [from]
    while (queue.length > 0) {
        const board = boards[queue.shift() as string]
        if (!board) continue
        for (const node of Object.values(board.nodes)) {
            const target = node.targetBoardId
            if (target == null) continue
            if (target === to) return true
            if (!seen.has(target)) {
                seen.add(target)
                queue.push(target)
            }
        }
    }
    return false
}

// Whether pointing a linked node in `sourceBoardId` at `targetBoardId` would cycle the board-link graph
// -- a self-link, or a target that can already reach the source (closing a loop). A cyclic link leaves
// the boards on the loop uncompletable (each root's mastery waits on the link, which waits on the root),
// so setLinkedTarget refuses it and the target dropdown hides such boards. Keeps the graph a DAG.
export function linkWouldCycle(boards: Boards, sourceBoardId: string, targetBoardId: string): boolean {
    return targetBoardId === sourceBoardId || boardReaches(boards, targetBoardId, sourceBoardId)
}

// Gold this board has earned: the sum of each mastered node's own `reward` (including a mastered tier-0
// root). A mastered id with no surviving node record, or a reward-less linked node (a linked node never
// enters `mastered` anyway), contributes nothing. A PARKED (detached) branch pays no gold either: a
// mastered node counts only while it still has a path up to the root, so cutting a branch loose stops
// its payout, and re-attaching it restores it (detach keeps the mastered marks, never clearing them).
// Kept here so the no-double-count rule lives with the boards data; rewards.earnedGold folds this over
// every board.
export function boardGold(board: Board): number {
    let total = 0
    for (const id of board.mastered) {
        if (!reachableFromRoot(id, board.rootId, board.edges)) continue
        total += board.nodes[id]?.reward ?? 0
    }
    return total
}

// A blank roadmap: a single gold root node named after the tab, no children and nothing complete.
export function newBoard(id: string, rootId: string, name: string): Board {
    const root: Node = {
        id: rootId,
        name,
        x: 0,
        y: 0,
        tier: 0,
        description: NEW_ROOT_DESC,
        reward: DEFAULT_ROOT_REWARD
    }
    return { id, rootId, nodes: { [rootId]: root }, edges: [], todos: {}, mastered: new Set() }
}

// Remove a SINGLE node from a board: its record, its checklist, its completed mark, and every edge
// touching it (its incoming edge plus each edge down to a child). Descendants are NOT removed -- each
// child loses the edge up to this node, so its whole subtree becomes a parked orphan that derives
// "detached" (unreachable from the root), to be re-homed or deleted in turn. The root (tier-0) node is
// never removed this way -- deleting a whole board is a separate op (removeBoard) -- and an unknown id
// is a no-op, both returning the same reference so callers can skip a redundant update.
export function deleteNode(board: Board, id: string): Board {
    if (id === board.rootId || !board.nodes[id]) return board
    const nodes: Record<string, Node> = {}
    for (const [nid, node] of Object.entries(board.nodes)) {
        if (nid !== id) nodes[nid] = node
    }
    const todos: Record<string, Todo[]> = {}
    for (const [nid, list] of Object.entries(board.todos)) {
        if (nid !== id) todos[nid] = list
    }
    // Drop every edge touching the node: the one into it, and each one out to a child -- orphaning that
    // child (its subtree stays intact but disconnected, so it derives "detached").
    const edges = board.edges.filter(([parent, child]) => parent !== id && child !== id)
    const mastered = board.mastered.has(id) ? new Set([...board.mastered].filter((mid) => mid !== id)) : board.mastered
    return { ...board, nodes, edges, todos, mastered }
}

// Insert a fresh, blank parent above `targetId`, opened later in edit mode. Above the root (tier-0) the
// new node becomes the root and every node shifts down a tier (a new top). Above a regular node M it
// splices in between M and its current parent P, so `P -> M` becomes `P -> N -> M`, and M with its
// whole subtree drops a tier; P, now holding a fresh incomplete child, drops out of the completed set
// (mirroring adding a child node). An unknown id is a no-op (same reference).
export function insertParent(board: Board, targetId: string, newId: string): Board {
    const target = board.nodes[targetId]
    if (!target) return board

    if (targetId === board.rootId) {
        const nodes: Record<string, Node> = {}
        for (const [id, node] of Object.entries(board.nodes)) {
            nodes[id] = { ...node, tier: node.tier + 1 }
        }
        nodes[newId] = {
            id: newId,
            name: "New Node",
            x: target.x,
            y: target.y - TIER_GAP,
            tier: 0,
            description: "",
            reward: DEFAULT_ROOT_REWARD
        }
        const edges: Edge[] = [...board.edges, [newId, board.rootId]]
        return { ...board, nodes, edges, rootId: newId }
    }

    const subtree = new Set<string>([targetId, ...descendantsOf(targetId, board.edges)])
    const nodes: Record<string, Node> = {}
    for (const [id, node] of Object.entries(board.nodes)) {
        nodes[id] = subtree.has(id) ? { ...node, tier: node.tier + 1, y: node.y + TIER_GAP } : { ...node }
    }
    nodes[newId] = {
        id: newId,
        name: "New Node",
        x: target.x,
        y: target.y,
        tier: target.tier,
        description: "",
        reward: DEFAULT_NODE_REWARD
    }
    const oldParent = parentOf(targetId, board.edges)
    const edges: Edge[] = board.edges.map((edge) => (edge[1] === targetId ? [edge[0], newId] : edge))
    edges.push([newId, targetId])
    const mastered = oldParent ? uncomplete(oldParent, board.mastered, edges) : board.mastered
    return { ...board, nodes, edges, mastered }
}

// Add a sub-node under `parentId`: a new leaf, an edge parent -> child, placed a tier below and fanned
// past existing siblings. A fresh child is incomplete, so the parent (and any now-inconsistent
// ancestor) drops out of the completed set. An unknown parent is a no-op (same reference).
export function addChild(board: Board, parentId: string, childId: string): Board {
    const parent = board.nodes[parentId]
    if (!parent) return board
    const siblings = board.edges.filter((edge) => edge[0] === parentId).length
    const child: Node = {
        id: childId,
        name: "New Node",
        x: parent.x + siblings * SIBLING_FAN,
        y: parent.y + TIER_GAP,
        tier: parent.tier + 1,
        description: "",
        reward: DEFAULT_NODE_REWARD
    }
    const edges: Edge[] = [...board.edges, [parentId, childId]]
    return { ...board, nodes: { ...board.nodes, [childId]: child }, edges, mastered: uncomplete(parentId, board.mastered, edges) }
}

// Re-hang `nodeId` (carrying its whole subtree) under a new parent -- the pure op behind click-to-attach
// (and the Attach action that re-homes a parked orphan). The node's single incoming edge is rewired to
// `[newParentId, nodeId]`; a PARKED orphan (detached earlier, no incoming edge) instead simply gains
// that edge (nothing to rewire). Every other edge, including the moved subtree's own internal links, is
// left as-is. Each moved node keeps its `x/y` (a reparent never repositions a node) while its tier is
// recomputed down the branch to stay `parent tier + 1` (breadth-first from the moved node over the new
// edge set). The new parent gained a possibly-incomplete child, so it (and its now-inconsistent
// ancestors) drop out of the completed set, mirroring addChild / insertParent; the moved nodes keep
// their own mastered marks. Rejected as a no-op (same reference) when the move is degenerate or would
// cycle: an unknown node / parent, the root (no incoming edge and never re-homeable), re-hanging under
// the current parent, the node itself, or any of its own descendants.
export function reparent(board: Board, nodeId: string, newParentId: string): Board {
    const node = board.nodes[nodeId]
    const newParent = board.nodes[newParentId]
    if (!node || !newParent) return board
    const currentParent = parentOf(nodeId, board.edges)
    // The root is never re-homed; re-hanging under the current parent changes nothing; a node can
    // neither parent itself nor hang under its own subtree (either would cycle). A parentless orphan is
    // NOT rejected here -- it is exactly the parked branch this op re-attaches.
    if (nodeId === board.rootId || currentParent === newParentId || newParentId === nodeId) return board
    if (descendantsOf(nodeId, board.edges).includes(newParentId)) return board

    // Rewire the one incoming edge to the new parent; for a parked orphan (none to rewire) just add it.
    // The subtree's own edges ride along untouched either way.
    const edges: Edge[] =
        currentParent !== null
            ? board.edges.map((edge) => (edge[1] === nodeId ? [newParentId, nodeId] : edge))
            : [...board.edges, [newParentId, nodeId]]

    // Walk the moved branch breadth-first over the new edges, re-tiering each node to sit one below its
    // parent. Positions (x/y) are deliberately left untouched -- only the depth changes.
    const nodes: Record<string, Node> = { ...board.nodes }
    const queue: [id: string, tier: number][] = [[nodeId, newParent.tier + 1]]
    while (queue.length > 0) {
        const [id, tier] = queue.shift() as [string, number]
        const current = nodes[id]
        if (current && current.tier !== tier) nodes[id] = { ...current, tier }
        for (const child of childrenOf(id, edges)) queue.push([child, tier + 1])
    }

    // The new parent now holds a possibly-incomplete child, so un-master it up the chain (like addChild).
    return { ...board, nodes, edges, mastered: uncomplete(newParentId, board.mastered, edges) }
}

// Detach `nodeId` from its parent: drop its single incoming edge and touch nothing else. The node, its
// whole subtree, every position, tier, checklist, and mastered mark stay exactly as they were -- the
// branch is simply cut loose from the tree (with no path to the root it now derives as "detached", and
// so does everything beneath it). Unlike addChild / reparent this deliberately does NOT un-master
// anything: losing a child can never make a parent's "every child complete" rule fail, so no completion
// is invalidated (and boardGold, which skips unreachable nodes, stops paying the parked branch without
// clearing its marks -- re-attaching restores the payout). A no-op (same reference) for the root (tier-0,
// no parent), an already-parentless node, or an unknown id -- there is no incoming edge to remove.
// Re-home a parked branch later with `reparent`, which now accepts a parentless orphan.
export function detach(board: Board, nodeId: string): Board {
    if (nodeId === board.rootId || parentOf(nodeId, board.edges) === null) return board
    const edges = board.edges.filter((edge) => edge[1] !== nodeId)
    return { ...board, edges }
}

// Add an unlinked linked node under `parentId`: a real tree node placed like addChild (a tier below,
// fanned past siblings), but marked linked by carrying the `targetBoardId` key (null until a board is
// picked via setLinkedTarget). It has no checklist / reward / description; its display name is derived
// (linkedNodeName), so the stored `name` is left blank. A fresh child is incomplete, so the parent (and
// any now-inconsistent ancestor) drops out of the completed set. An unknown parent is a no-op.
export function addLinkedNode(board: Board, parentId: string, childId: string): Board {
    const parent = board.nodes[parentId]
    if (!parent) return board
    const siblings = board.edges.filter((edge) => edge[0] === parentId).length
    const child: Node = {
        id: childId,
        name: "",
        x: parent.x + siblings * SIBLING_FAN,
        y: parent.y + TIER_GAP,
        tier: parent.tier + 1,
        targetBoardId: null
    }
    const edges: Edge[] = [...board.edges, [parentId, childId]]
    return { ...board, nodes: { ...board.nodes, [childId]: child }, edges, mastered: uncomplete(parentId, board.mastered, edges) }
}

// Point a linked node at a board (or clear it back to unlinked with null). Only touches a node that is
// already linked (the `targetBoardId` key is present); a regular / root node, an unknown id, or an
// unchanged target is a no-op (same reference).
export function setLinkedTarget(board: Board, id: string, targetBoardId: string | null): Board {
    const current = board.nodes[id]
    if (!current || !("targetBoardId" in current) || current.targetBoardId === targetBoardId) return board
    return { ...board, nodes: { ...board.nodes, [id]: { ...current, targetBoardId } } }
}

// Convert a regular node in place into an (unlinked) linked node: it gains the targetBoardId key (null,
// awaiting a board pick via setLinkedTarget) and sheds what a linked node has no room for -- its stored
// name (a linked node's name derives from its target board), description, reward, and checklist. Its
// position, tier, and subtree (edges) stay untouched. It leaves the completed set and un-completes its
// ancestors (uncomplete), since a fresh unlinked linked node is not mastered (mirrors adding a child).
// The root node, an already-linked node, and an unknown id are no-ops (same reference); the destructive
// drop of checklist / reward is why the UI confirms first.
export function convertToLinkedNode(board: Board, id: string): Board {
    const current = board.nodes[id]
    if (!current || id === board.rootId || isLinkedNode(current)) return board
    const linked: Node = { id, name: "", x: current.x, y: current.y, tier: current.tier, targetBoardId: null }
    const todos = { ...board.todos }
    delete todos[id]
    return { ...board, nodes: { ...board.nodes, [id]: linked }, todos, mastered: uncomplete(id, board.mastered, board.edges) }
}

// Convert a linked node back into a regular node: drop the targetBoardId key (so it is no longer a
// linked node) and give it a regular-node shape. `restore` (a pre-linked snapshot App kept for this
// session) refills the old name / description / reward / checklist; without it the node gets the blank
// default (name "New Node", default reward, no checklist). Its position, tier, and subtree stay. It
// un-completes its ancestors (uncomplete), since a linked node may have been DERIVED-mastered from a
// complete target board while a restored / fresh regular node is not. A regular / unknown node is a
// no-op (same reference).
export function convertToRegularNode(board: Board, id: string, restore?: NodeRestore): Board {
    const current = board.nodes[id]
    if (!current || !isLinkedNode(current)) return board
    const regular: Node = {
        id: current.id,
        name: restore?.name || "New Node",
        x: current.x,
        y: current.y,
        tier: current.tier,
        reward: restore?.reward ?? DEFAULT_NODE_REWARD
    }
    if (restore?.description !== undefined) regular.description = restore.description
    const nodes = { ...board.nodes, [id]: regular }
    const todos = restore && restore.todos.length > 0 ? { ...board.todos, [id]: restore.todos.map((t) => ({ ...t })) } : board.todos
    return { ...board, nodes, todos, mastered: uncomplete(id, board.mastered, board.edges) }
}

// Edit a node's name / description / reward in place. Unknown id is a no-op (same reference).
export function editNode(board: Board, id: string, patch: NodePatch): Board {
    const current = board.nodes[id]
    if (!current) return board
    return { ...board, nodes: { ...board.nodes, [id]: { ...current, ...patch } } }
}

// Persist a node's dragged position (its centre). Unknown id or an unchanged position is a no-op.
export function moveNode(board: Board, id: string, x: number, y: number): Board {
    const current = board.nodes[id]
    if (!current || (current.x === x && current.y === y)) return board
    return { ...board, nodes: { ...board.nodes, [id]: { ...current, x, y } } }
}

// Mark `id` complete via the pure graph rule (unlocked AND every box ticked), returning the board
// unchanged when the move is disallowed or already done. `boardComplete` resolves any linked child's
// mastery from its target board so a parent gated only by a completed link can unlock; it is required
// (single-board callers with no cross-board links pass `() => false`) so a linked child is never
// silently treated as never-mastering. A linked node is guarded off inside graph.complete, so it can
// never be added to `mastered` here.
export function completeNode(board: Board, id: string, allTodosDone: boolean, boardComplete: BoardComplete): Board {
    const mastered = complete(id, board.mastered, allTodosDone, board.edges, board.nodes, boardComplete)
    return mastered === board.mastered ? board : { ...board, mastered }
}

// Mark `id` incomplete, cascading up (graph.uncomplete), unchanged when it was not complete.
export function uncompleteNode(board: Board, id: string): Board {
    const mastered = uncomplete(id, board.mastered, board.edges)
    return mastered === board.mastered ? board : { ...board, mastered }
}

// Append a fresh, empty checklist item to a node.
export function addTodo(board: Board, id: string): Board {
    return { ...board, todos: { ...board.todos, [id]: [...(board.todos[id] ?? []), { text: "", done: false }] } }
}

// Retext one checklist item. Unknown node is a no-op (same reference).
export function editTodo(board: Board, id: string, index: number, text: string): Board {
    const list = board.todos[id]
    if (!list) return board
    return { ...board, todos: { ...board.todos, [id]: list.map((todo, i) => (i === index ? { ...todo, text } : todo)) } }
}

// Tick / untick one checklist item. Unknown node is a no-op (same reference).
export function toggleTodo(board: Board, id: string, index: number): Board {
    const list = board.todos[id]
    if (!list) return board
    return {
        ...board,
        todos: { ...board.todos, [id]: list.map((todo, i) => (i === index ? { ...todo, done: !todo.done } : todo)) }
    }
}

// Drop one checklist item. Unknown node is a no-op (same reference).
export function deleteTodo(board: Board, id: string, index: number): Board {
    const list = board.todos[id]
    if (!list) return board
    return { ...board, todos: { ...board.todos, [id]: list.filter((_, i) => i !== index) } }
}

// Create a blank board (root node only) and append it to the order.
export function addBoard(state: BoardsState, boardId: string, rootId: string, name: string): BoardsState {
    return { boards: { ...state.boards, [boardId]: newBoard(boardId, rootId, name) }, order: [...state.order, boardId] }
}

// Revert every linked node on `board` whose target is `deletedBoardId` back to unlinked
// (targetBoardId: null); the linked nodes and their subtrees stay put. Returns the same reference when
// nothing pointed at that board, so removeBoard leaves untouched survivors untouched.
function unlinkTargets(board: Board, deletedBoardId: string): Board {
    let changed = false
    const nodes: Record<string, Node> = {}
    for (const [id, node] of Object.entries(board.nodes)) {
        if (node.targetBoardId === deletedBoardId) {
            nodes[id] = { ...node, targetBoardId: null }
            changed = true
        } else {
            nodes[id] = node
        }
    }
    return changed ? { ...board, nodes } : board
}

// Remove a board outright: no floor (the last board can go) and no reparenting (boards are flat). Every
// surviving board has its linked nodes pointing at the deleted board reverted to unlinked (the
// empty-dropdown state). An unknown id is a no-op (same reference).
export function removeBoard(state: BoardsState, boardId: string): BoardsState {
    if (!(boardId in state.boards)) return state
    const boards: Boards = {}
    for (const [id, board] of Object.entries(state.boards)) {
        if (id === boardId) continue
        boards[id] = unlinkTargets(board, boardId)
    }
    return { boards, order: state.order.filter((id) => id !== boardId) }
}

// Apply a single change to `{ boards, order }` through the pure ops above. Single-board actions keep
// the whole state reference stable on a no-op (updateBoard); map-level actions (add / remove / replace)
// build fresh state.
export type BoardsAction =
    | { type: "toggleTodo"; boardId: string; id: string; index: number }
    | { type: "editTodo"; boardId: string; id: string; index: number; text: string }
    | { type: "deleteTodo"; boardId: string; id: string; index: number }
    | { type: "addTodo"; boardId: string; id: string }
    | { type: "complete"; boardId: string; id: string; allTodosDone: boolean }
    | { type: "uncomplete"; boardId: string; id: string }
    | { type: "editNode"; boardId: string; id: string; patch: NodePatch }
    | { type: "moveNode"; boardId: string; id: string; x: number; y: number }
    | { type: "addChild"; boardId: string; parentId: string; childId: string }
    | { type: "addLinkedNode"; boardId: string; parentId: string; childId: string }
    | { type: "setLinkedTarget"; boardId: string; id: string; targetBoardId: string | null }
    | { type: "convertToLinked"; boardId: string; id: string }
    | { type: "convertToRegular"; boardId: string; id: string; restore?: NodeRestore }
    | { type: "addParent"; boardId: string; targetId: string; newId: string }
    | { type: "reparent"; boardId: string; nodeId: string; newParentId: string }
    | { type: "detach"; boardId: string; id: string }
    | { type: "deleteNode"; boardId: string; id: string }
    | { type: "renameBoard"; boardId: string; name: string }
    | { type: "addBoard"; boardId: string; rootId: string; name: string }
    | { type: "removeBoard"; boardId: string }
    | { type: "replace"; boards: Boards; order: string[] }

function updateBoard(state: BoardsState, boardId: string, fn: (board: Board) => Board): BoardsState {
    const board = state.boards[boardId]
    if (!board) return state
    const next = fn(board)
    return next === board ? state : { ...state, boards: { ...state.boards, [boardId]: next } }
}

export function boardsReducer(state: BoardsState, action: BoardsAction): BoardsState {
    switch (action.type) {
        case "toggleTodo":
            return updateBoard(state, action.boardId, (b) => toggleTodo(b, action.id, action.index))
        case "editTodo":
            return updateBoard(state, action.boardId, (b) => editTodo(b, action.id, action.index, action.text))
        case "deleteTodo":
            return updateBoard(state, action.boardId, (b) => deleteTodo(b, action.id, action.index))
        case "addTodo":
            return updateBoard(state, action.boardId, (b) => addTodo(b, action.id))
        case "complete":
            // Resolve linked children against the whole map (unaffected by this board's own change), so
            // a node gated only by a completed link unlocks and can be ticked complete.
            return updateBoard(state, action.boardId, (b) =>
                completeNode(b, action.id, action.allTodosDone, boardCompleter(state.boards))
            )
        case "uncomplete":
            return updateBoard(state, action.boardId, (b) => uncompleteNode(b, action.id))
        case "editNode":
            return updateBoard(state, action.boardId, (b) => editNode(b, action.id, action.patch))
        case "moveNode":
            return updateBoard(state, action.boardId, (b) => moveNode(b, action.id, action.x, action.y))
        case "addChild":
            return updateBoard(state, action.boardId, (b) => addChild(b, action.parentId, action.childId))
        case "addLinkedNode":
            return updateBoard(state, action.boardId, (b) => addLinkedNode(b, action.parentId, action.childId))
        case "setLinkedTarget":
            // Refuse a link that would cycle the board-link graph (uncompletable boards). Clearing (null) is fine.
            if (action.targetBoardId !== null && linkWouldCycle(state.boards, action.boardId, action.targetBoardId)) {
                return state
            }
            return updateBoard(state, action.boardId, (b) => setLinkedTarget(b, action.id, action.targetBoardId))
        case "convertToLinked":
            return updateBoard(state, action.boardId, (b) => convertToLinkedNode(b, action.id))
        case "convertToRegular":
            return updateBoard(state, action.boardId, (b) => convertToRegularNode(b, action.id, action.restore))
        case "addParent":
            return updateBoard(state, action.boardId, (b) => insertParent(b, action.targetId, action.newId))
        case "reparent":
            return updateBoard(state, action.boardId, (b) => reparent(b, action.nodeId, action.newParentId))
        case "detach":
            return updateBoard(state, action.boardId, (b) => detach(b, action.id))
        case "deleteNode":
            return updateBoard(state, action.boardId, (b) => deleteNode(b, action.id))
        case "renameBoard":
            return updateBoard(state, action.boardId, (b) => editNode(b, b.rootId, { name: action.name }))
        case "addBoard":
            return addBoard(state, action.boardId, action.rootId, action.name)
        case "removeBoard":
            return removeBoard(state, action.boardId)
        case "replace":
            return { boards: action.boards, order: action.order }
    }
}

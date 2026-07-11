// A Board is one tab's roadmap: its own node records, edges, checklists, and completed set.
// The tab's label is simply the root (tier-0) node's name, so renaming the tab and renaming the
// root node are the same edit seen from two places.

import { descendantsOf, parentOf, uncomplete } from "./graph"
import {
    DEFAULT_NODE_REWARD,
    DEFAULT_ROOT_REWARD,
    EDGES,
    type Edge,
    MASTERED,
    type Node,
    NODES,
    TODOS,
    type Todo
} from "./nodes"

// Vertical gap between tiers when a node is pushed down a tier (matches App's auto-placement).
const TIER_GAP = 160

export type Board = {
    id: string
    // The tier-0 root node; its name is the tab label.
    rootId: string
    // The view this one hangs under in the Root hub tree (another view's id, or ROOT_ID for a
    // top-level view). Root itself has none.
    parentId?: string
    milestones: Record<string, Node>
    edges: Edge[]
    todos: Record<string, Todo[]>
    mastered: ReadonlySet<string>
}

// The bundled sample roadmap, as the first tab (a top-level view under Root). Everything is
// deep-copied so editing a board never mutates the module seeds.
export function seedBoard(): Board {
    return {
        id: "seed",
        rootId: "learn",
        parentId: ROOT_ID,
        milestones: Object.fromEntries(NODES.map((node) => [node.id, { ...node }])),
        edges: EDGES.map((edge) => [...edge] as Edge),
        todos: Object.fromEntries(Object.entries(TODOS).map(([id, list]) => [id, list.map((todo) => ({ ...todo }))])),
        mastered: new Set(MASTERED)
    }
}

// Default blurb on a fresh board's root node (Root overrides its own below).
const NEW_ROOT_DESC = "The end goal for this view. Add sub-milestones to break it down into steps."

// A blank roadmap: a single gold root node named after the tab, no children and nothing complete.
// `parentId` places it in the Root hub tree.
export function newBoard(id: string, name: string, parentId?: string): Board {
    const rootId = `${id}-root`
    const root: Node = {
        id: rootId,
        name,
        tag: "Root",
        x: 0,
        y: 0,
        tier: 0,
        branch: "Root",
        description: NEW_ROOT_DESC,
        reward: DEFAULT_ROOT_REWARD
    }
    return { id, rootId, parentId, milestones: { [rootId]: root }, edges: [], todos: {}, mastered: new Set() }
}

// The persistent first tab: a single "Quest Board" node that can't be deleted. It's the top of the view
// tree (no parent), with a default blurb on its node.
export const ROOT_ID = "root"
const ROOT_DESC = "Home base for every roadmap. Each view you create branches off this node; open one to dive in."
export function rootProject(): Board {
    const board = newBoard(ROOT_ID, "Quest Board")
    const root = board.milestones[board.rootId]
    if (!root) return board
    return { ...board, milestones: { ...board.milestones, [board.rootId]: { ...root, description: ROOT_DESC } } }
}

// Remove a node and its whole subtree from a board: the node, every descendant, the edges
// touching any of them, their checklists, and any completed marks. The root (tier-0) node is never
// removed this way -- deleting a whole board is a separate op (removeBoard) -- and an unknown id is
// a no-op, both returning the same reference so callers can skip a redundant update.
export function deleteNode(board: Board, id: string): Board {
    if (id === board.rootId || !board.milestones[id]) return board
    const doomed = new Set<string>([id, ...descendantsOf(id, board.edges)])
    const milestones: Record<string, Node> = {}
    for (const [mid, node] of Object.entries(board.milestones)) {
        if (!doomed.has(mid)) milestones[mid] = node
    }
    const todos: Record<string, Todo[]> = {}
    for (const [mid, list] of Object.entries(board.todos)) {
        if (!doomed.has(mid)) todos[mid] = list
    }
    const edges = board.edges.filter(([parent, child]) => !doomed.has(parent) && !doomed.has(child))
    const mastered = new Set([...board.mastered].filter((mid) => !doomed.has(mid)))
    return { ...board, milestones, edges, todos, mastered }
}

// Insert a fresh, blank parent above `targetId`, opened later in edit mode. Above the root (tier-0) the
// new node becomes the root and every node shifts down a tier (a new top). Above a regular node M
// it splices in between M and its current parent P, so `P -> M` becomes `P -> N -> M`, and M with its
// whole subtree drops a tier; P, now holding a fresh incomplete child, drops out of the completed set
// (mirroring adding a child node). An unknown id is a no-op (same reference).
export function insertParent(board: Board, targetId: string, newId: string): Board {
    const target = board.milestones[targetId]
    if (!target) return board

    if (targetId === board.rootId) {
        const milestones: Record<string, Node> = {}
        for (const [id, node] of Object.entries(board.milestones)) {
            milestones[id] = { ...node, tier: node.tier + 1 }
        }
        milestones[newId] = {
            id: newId,
            name: "New Milestone",
            tag: "Root",
            x: target.x,
            y: target.y - TIER_GAP,
            tier: 0,
            branch: "Root",
            description: "",
            reward: DEFAULT_ROOT_REWARD
        }
        const edges: Edge[] = [...board.edges, [newId, board.rootId]]
        return { ...board, milestones, edges, rootId: newId }
    }

    const subtree = new Set<string>([targetId, ...descendantsOf(targetId, board.edges)])
    const milestones: Record<string, Node> = {}
    for (const [id, node] of Object.entries(board.milestones)) {
        milestones[id] = subtree.has(id) ? { ...node, tier: node.tier + 1, y: node.y + TIER_GAP } : { ...node }
    }
    milestones[newId] = {
        id: newId,
        name: "New Milestone",
        tag: target.tag,
        x: target.x,
        y: target.y,
        tier: target.tier,
        branch: target.branch,
        description: "",
        reward: DEFAULT_NODE_REWARD
    }
    const oldParent = parentOf(targetId, board.edges)
    const edges: Edge[] = board.edges.map((edge) => (edge[1] === targetId ? [edge[0], newId] : edge))
    edges.push([newId, targetId])
    const mastered = oldParent ? uncomplete(oldParent, board.mastered, edges) : board.mastered
    return { ...board, milestones, edges, mastered }
}

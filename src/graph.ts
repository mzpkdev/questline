// Pure derivations over the roadmap graph. The tri-state is not stored; it is
// computed from the `mastered` set and the parent/child structure, exactly as the
// mockup did. Kept free of React / React Flow so it can be unit-tested directly.

import { type Edge, isLinkedNode, type Node, type NodeState, NODES } from "./nodes"

export const STATE_LABEL: Record<NodeState, string> = {
    mastered: "Complete",
    available: "In Progress",
    locked: "Planned"
}

// Look up a node in the bundled seed graph (used by fixtures / tests).
export const byId = (id: string): Node | undefined => NODES.find((n) => n.id === id)

// child nodes drawn beneath `id`
export const childrenOf = (id: string, edges: Edge[]): string[] =>
    edges.filter((e) => e[0] === id).map((e) => e[1])

export const parentOf = (id: string, edges: Edge[]): string | null => {
    const edge = edges.find((e) => e[1] === id)
    return edge ? edge[0] : null
}

// Every node beneath `id` (its whole subtree), excluding `id` itself. Breadth-first over the edge
// list, with a visited guard so a malformed cycle can't loop forever.
export function descendantsOf(id: string, edges: Edge[]): string[] {
    const seen = new Set<string>([id])
    const out: string[] = []
    const queue: string[] = [id]
    while (queue.length > 0) {
        const cur = queue.shift() as string
        for (const child of childrenOf(cur, edges)) {
            if (seen.has(child)) continue
            seen.add(child)
            out.push(child)
            queue.push(child)
        }
    }
    return out
}

// Resolves whether a board (by id) is complete -- its root node mastered. Passed into stateOf /
// complete so a linked node derives its mastery from its target board, keeping graph.ts pure: the
// boards map lives in board.ts, which hands in a resolver bound to it (board.boardCompleter).
export type BoardComplete = (boardId: string) => boolean

// Whether a node counts as complete for unlock purposes. A linked node (the `targetBoardId` key is
// present) is mastered exactly when it points at a board that is complete -- it is NEVER a member of a
// `mastered` set, its mastery is always derived here. Every other node is mastered when it sits in the
// board's `mastered` set. With the default empty `nodes` map (a single-board / no-linked-node caller)
// this is just `mastered.has(id)`, so the classic behaviour is preserved byte-for-byte.
export function isMastered(
    id: string,
    mastered: ReadonlySet<string>,
    nodes: Record<string, Node> = {},
    boardComplete: BoardComplete = () => false
): boolean {
    const node = nodes[id]
    if (node && isLinkedNode(node)) return node.targetBoardId != null && boardComplete(node.targetBoardId)
    return mastered.has(id)
}

// Whether any ANCESTOR of `id` (walking parent edges toward the root) is a linked node that is not
// mastered. Such an ancestor gates its whole subtree top-down: an unlinked (or not-yet-complete) linked
// node keeps every descendant locked until it masters. A visited guard mirrors descendantsOf so a
// malformed cycle can't loop forever. With no linked nodes in `nodes` this is never true, so the
// classic bottom-up rule below is untouched.
function underUnmasteredLink(
    id: string,
    mastered: ReadonlySet<string>,
    edges: Edge[],
    nodes: Record<string, Node>,
    boardComplete: BoardComplete
): boolean {
    const seen = new Set<string>([id])
    let cursor = parentOf(id, edges)
    while (cursor !== null && !seen.has(cursor)) {
        seen.add(cursor)
        const node = nodes[cursor]
        if (node && isLinkedNode(node) && !isMastered(cursor, mastered, nodes, boardComplete)) return true
        cursor = parentOf(cursor, edges)
    }
    return false
}

// The node's tri-state. Additive over the classic bottom-up rule so a tree with no linked nodes is
// unchanged:
//   1. mastered (own membership, or a linked node whose target board is complete) -> "mastered";
//   2. TOP-DOWN GATE: sitting under an unmastered linked ancestor -> "locked" (its subtree waits on the
//      link mastering); this step never fires without linked nodes;
//   3. otherwise the classic BOTTOM-UP rule: a leaf is always actionable ("available"); a parent
//      unlocks ("available") only once every child is mastered, else "locked" -- with `isMastered` for
//      the child check so a linked child counts as done when its target board is complete.
// `nodes` + `boardComplete` default to a single-board no-op, so the legacy 3-arg call is identical.
export function stateOf(
    id: string,
    mastered: ReadonlySet<string>,
    edges: Edge[],
    nodes: Record<string, Node> = {},
    boardComplete: BoardComplete = () => false
): NodeState {
    if (isMastered(id, mastered, nodes, boardComplete)) return "mastered"
    if (underUnmasteredLink(id, mastered, edges, nodes, boardComplete)) return "locked"
    const children = childrenOf(id, edges)
    if (children.length === 0) return "available"
    return children.every((child) => isMastered(child, mastered, nodes, boardComplete)) ? "available" : "locked"
}

// Mark `id` complete. Allowed only when it is unlocked (available: a leaf, or every child already
// mastered) AND every checklist item is ticked — the two rules that gate progression. `allTodosDone`
// is passed in so this stays pure of the todo store. A linked node is refused outright (its mastery is
// derived, never stored). `nodes` + `boardComplete` resolve a linked child's mastery so a parent gated
// only by a completed link can unlock; both default to a single-board no-op. Returns the set unchanged
// when the move is disallowed or `id` is already complete, so callers can compare by reference.
export function complete(
    id: string,
    mastered: ReadonlySet<string>,
    allTodosDone: boolean,
    edges: Edge[],
    nodes: Record<string, Node> = {},
    boardComplete: BoardComplete = () => false
): ReadonlySet<string> {
    // A linked node's mastery is derived from its target board; it has no checklist and no Complete
    // action, and must never enter a `mastered` set (its mastery would then double-count / desync).
    const node = nodes[id]
    if (node && isLinkedNode(node)) return mastered
    if (mastered.has(id) || !allTodosDone || stateOf(id, mastered, edges, nodes, boardComplete) !== "available") {
        return mastered
    }
    const next = new Set(mastered)
    next.add(id)
    return next
}

// Mark `id` incomplete, cascading up: a completed parent requires every child complete, so removing
// one also un-completes the contiguous chain of ancestors above it. Returns the set unchanged when
// `id` was not complete.
export function uncomplete(
    id: string,
    mastered: ReadonlySet<string>,
    edges: Edge[]
): ReadonlySet<string> {
    if (!mastered.has(id)) return mastered
    const next = new Set(mastered)
    let cursor: string | null = id
    while (cursor !== null && next.has(cursor)) {
        next.delete(cursor)
        cursor = parentOf(cursor, edges)
    }
    return next
}

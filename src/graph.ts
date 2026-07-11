// Pure derivations over the roadmap graph. The tri-state is not stored; it is
// computed from the `mastered` set and the parent/child structure, exactly as the
// mockup did. Kept free of React / React Flow so it can be unit-tested directly.

import { type Edge, type Node, type NodeState, NODES } from "./nodes"

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

// A node is complete when in `mastered`; a leaf (no children) is always actionable;
// otherwise it unlocks only once every child beneath it is complete.
export function stateOf(id: string, mastered: ReadonlySet<string>, edges: Edge[]): NodeState {
    if (mastered.has(id)) return "mastered"
    const children = childrenOf(id, edges)
    if (children.length === 0) return "available"
    return children.every((child) => mastered.has(child)) ? "available" : "locked"
}

// Mark `id` complete. Allowed only when it is unlocked (available: a leaf, or every child already
// complete) AND every checklist item is ticked — the two rules that gate progression. `allTodosDone`
// is passed in so this stays pure of the todo store. Returns the set unchanged when the move is
// disallowed or `id` is already complete, so callers can compare by reference.
export function complete(
    id: string,
    mastered: ReadonlySet<string>,
    allTodosDone: boolean,
    edges: Edge[]
): ReadonlySet<string> {
    if (mastered.has(id) || !allTodosDone || stateOf(id, mastered, edges) !== "available") return mastered
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

// Pure derivations over the roadmap graph. The tri-state is not stored; it is
// computed from the `mastered` set and the parent/child structure, exactly as the
// mockup did. Kept free of React / React Flow so it can be unit-tested directly.

import { type Milestone, type MilestoneEdge, type MilestoneState, NODES } from "./milestones"

export const STATE_LABEL: Record<MilestoneState, string> = {
    mastered: "Complete",
    available: "In Progress",
    locked: "Planned"
}

// Look up a milestone in the bundled seed graph (used by fixtures / tests).
export const byId = (id: string): Milestone | undefined => NODES.find((n) => n.id === id)

// sub-milestones drawn beneath `id`
export const childrenOf = (id: string, edges: MilestoneEdge[]): string[] =>
    edges.filter((e) => e[0] === id).map((e) => e[1])

export const parentOf = (id: string, edges: MilestoneEdge[]): string | null => {
    const edge = edges.find((e) => e[1] === id)
    return edge ? edge[0] : null
}

// A node is complete when in `mastered`; a leaf (no children) is always actionable;
// otherwise it unlocks only once every child beneath it is complete.
export function stateOf(id: string, mastered: ReadonlySet<string>, edges: MilestoneEdge[]): MilestoneState {
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
    edges: MilestoneEdge[]
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
    edges: MilestoneEdge[]
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

import { childrenOf, complete, descendantsOf, isMastered, parentOf, STATE_LABEL, stateOf, uncomplete } from "./graph"
import { type Edge, EDGES, MASTERED, type Node } from "./nodes"

describe("childrenOf", () => {
    it("returns the sub-milestones drawn beneath a node", () => {
        expect(childrenOf("learn", EDGES)).toEqual(["plan-goal", "track-progress"])
    })

    it("returns an empty list for a leaf", () => {
        expect(childrenOf("break-steps", EDGES)).toEqual([])
    })
})

describe("parentOf", () => {
    it("returns the parent milestone", () => {
        expect(parentOf("plan-goal", EDGES)).toBe("learn")
    })

    it("returns null for the root node", () => {
        expect(parentOf("learn", EDGES)).toBeNull()
    })
})

describe("descendantsOf", () => {
    it("returns every node in the subtree, excluding the node itself", () => {
        // learn -> {plan-goal, track-progress} -> {break-steps, finish-milestone}, breadth-first.
        const kids = descendantsOf("learn", EDGES)
        expect(kids).toEqual(["plan-goal", "track-progress", "break-steps", "finish-milestone"])
        expect(kids).not.toContain("learn")
    })

    it("returns an empty list for a leaf", () => {
        expect(descendantsOf("break-steps", EDGES)).toEqual([])
    })
})

describe("stateOf", () => {
    it("marks a node in the mastered set as mastered", () => {
        expect(stateOf("break-steps", MASTERED, EDGES)).toBe("mastered")
    })

    it("treats an unfinished leaf as available", () => {
        expect(stateOf("finish-milestone", MASTERED, EDGES)).toBe("available")
    })

    context("when every child is mastered", () => {
        it("unlocks the parent as available", () => {
            // plan-goal's only child (break-steps) is complete in the seed set -> available.
            expect(stateOf("plan-goal", MASTERED, EDGES)).toBe("available")
        })
    })

    context("when a child is still incomplete", () => {
        it("keeps the parent locked", () => {
            // track-progress's child (finish-milestone) is unfinished, so it stays locked.
            expect(stateOf("track-progress", MASTERED, EDGES)).toBe("locked")
        })
    })

    it("derives from the passed set, not global state", () => {
        // learn is locked in the seed set, but unlocks once both its children are passed as complete.
        expect(stateOf("learn", new Set(["plan-goal", "track-progress"]), EDGES)).toBe("available")
    })
})

describe("complete", () => {
    it("adds an available leaf once every box is checked", () => {
        // finish-milestone is a leaf, absent from the seed set -> available.
        const next = complete("finish-milestone", MASTERED, true, EDGES)
        expect(next.has("finish-milestone")).toBe(true)
    })

    it("refuses when not every box is checked", () => {
        const next = complete("finish-milestone", MASTERED, false, EDGES)
        expect(next).toBe(MASTERED)
    })

    it("refuses a locked node whose children are unfinished", () => {
        // track-progress still has an incomplete child (finish-milestone), so it is locked.
        const next = complete("track-progress", MASTERED, true, EDGES)
        expect(next).toBe(MASTERED)
    })

    it("unlocks a parent, which can then be completed", () => {
        // plan-goal's only child (break-steps) is already complete -> available.
        const next = complete("plan-goal", MASTERED, true, EDGES)
        expect(next.has("plan-goal")).toBe(true)
    })

    it("returns the same set when the node is already complete", () => {
        expect(complete("break-steps", MASTERED, true, EDGES)).toBe(MASTERED)
    })
})

describe("uncomplete", () => {
    it("removes a completed node", () => {
        // break-steps' parent (plan-goal) is not complete, so the cascade stops at break-steps.
        const next = uncomplete("break-steps", MASTERED, EDGES)
        expect(next.has("break-steps")).toBe(false)
    })

    it("cascades up so no completed parent keeps an incomplete child", () => {
        // With learn + both its children complete, un-completing plan-goal must drop learn too
        // (it can't stay complete with an incomplete child), while sibling track-progress stays.
        const mastered = new Set(["learn", "plan-goal", "track-progress"])
        const next = uncomplete("plan-goal", mastered, EDGES)
        expect(next.has("plan-goal")).toBe(false)
        expect(next.has("learn")).toBe(false)
        expect(next.has("track-progress")).toBe(true)
    })

    it("returns the same set when the node was not complete", () => {
        expect(uncomplete("finish-milestone", MASTERED, EDGES)).toBe(MASTERED)
    })
})

describe("STATE_LABEL", () => {
    it("maps each state to its human label", () => {
        expect(STATE_LABEL).toEqual({ mastered: "Complete", available: "In Progress", locked: "Planned" })
    })
})

// --- Linked-node completion (Phase 3) ---------------------------------------------------------------
// Node kind is positional: a linked node carries the `targetBoardId` key; a regular node omits it. A
// linked node's mastery is DERIVED from a `boardComplete(targetBoardId)` resolver (never a mastered-set
// member), which is what unlocks its children and bubbles up to its parent.
const reg = (id: string): Node => ({ id, name: id, x: 0, y: 0, tier: 0 })
const linked = (id: string, targetBoardId: string | null): Node => ({ id, name: "", x: 0, y: 0, tier: 0, targetBoardId })
const nodeMap = (...ns: Node[]): Record<string, Node> => Object.fromEntries(ns.map((n) => [n.id, n]))
const NONE: ReadonlySet<string> = new Set()

describe("isMastered (boardComplete-driven)", () => {
    it("reads a regular node from the mastered set", () => {
        expect(isMastered("a", new Set(["a"]), nodeMap(reg("a")), () => false)).toBe(true)
        expect(isMastered("a", NONE, nodeMap(reg("a")), () => false)).toBe(false)
    })

    it("derives a linked node from its target board's completion, never from the mastered set", () => {
        const nodes = nodeMap(linked("L", "B"))
        expect(isMastered("L", NONE, nodes, (id) => id === "B")).toBe(true) // target board complete
        expect(isMastered("L", NONE, nodes, () => false)).toBe(false) // target board incomplete
        // Even if a linked id were (wrongly) present in the set, mastery is derived, not read from it.
        expect(isMastered("L", new Set(["L"]), nodes, () => false)).toBe(false)
    })

    it("never masters an unlinked linked node (targetBoardId null)", () => {
        expect(isMastered("L", NONE, nodeMap(linked("L", null)), () => true)).toBe(false)
    })
})

describe("stateOf with linked nodes", () => {
    // R (root) -> L (linked) -> C (regular leaf): C's state is gated top-down by L's derived mastery.
    const edges: Edge[] = [
        ["R", "L"],
        ["L", "C"]
    ]

    it("locks the whole subtree under an UNLINKED linked node, whatever the resolver says", () => {
        const nodes = nodeMap(reg("R"), linked("L", null), reg("C"))
        expect(stateOf("C", NONE, edges, nodes, () => true)).toBe("locked")
    })

    it("keeps the subtree locked while the linked node points at an INCOMPLETE board", () => {
        const nodes = nodeMap(reg("R"), linked("L", "B"), reg("C"))
        expect(stateOf("C", NONE, edges, nodes, () => false)).toBe("locked")
    })

    it("masters the linked node and unlocks its children once the target board completes", () => {
        const nodes = nodeMap(reg("R"), linked("L", "B"), reg("C"))
        const done = (id: string) => id === "B"
        expect(stateOf("L", NONE, edges, nodes, done)).toBe("mastered")
        expect(stateOf("C", NONE, edges, nodes, done)).toBe("available") // gate lifts; C is a leaf
    })

    it("bubbles the linked node's mastery UP to unlock its regular parent by the normal rule", () => {
        // P (regular) whose ONLY child is a linked node L -> B; P unlocks exactly when L masters.
        const pEdges: Edge[] = [["P", "L"]]
        const nodes = nodeMap(reg("P"), linked("L", "B"))
        expect(stateOf("P", NONE, pEdges, nodes, () => false)).toBe("locked") // B incomplete -> L unmastered
        expect(stateOf("P", NONE, pEdges, nodes, (id) => id === "B")).toBe("available") // B complete -> L mastered
    })
})

describe("complete with linked nodes", () => {
    it("never adds a linked node to the mastered set (no checklist, no action)", () => {
        const nodes = nodeMap(reg("R"), linked("L", "B"))
        const next = complete("L", NONE, true, [["R", "L"]], nodes, () => true)
        expect(next).toBe(NONE) // refused -> same reference
        expect(next.has("L")).toBe(false)
    })

    it("refuses a node still locked under an unmastered linked ancestor", () => {
        const edges: Edge[] = [
            ["R", "L"],
            ["L", "C"]
        ]
        const nodes = nodeMap(reg("R"), linked("L", "B"), reg("C"))
        expect(complete("C", NONE, true, edges, nodes, () => false)).toBe(NONE) // C locked (B incomplete)
    })

    it("completes a parent unlocked purely by its linked child's mastery", () => {
        const edges: Edge[] = [["P", "L"]]
        const nodes = nodeMap(reg("P"), linked("L", "B"))
        const next = complete("P", NONE, true, edges, nodes, (id) => id === "B")
        expect(next.has("P")).toBe(true)
    })
})

describe("uncomplete across a linked ancestor", () => {
    it("stops the up-cascade at a linked node (its mastery is independent of its children)", () => {
        // P (regular) -> L (linked) -> C (regular). P and C are complete; a linked node is never in the
        // set, so un-completing C breaks the chain at L and must NOT drop P.
        const edges: Edge[] = [
            ["P", "L"],
            ["L", "C"]
        ]
        const next = uncomplete("C", new Set(["P", "C"]), edges)
        expect(next.has("C")).toBe(false)
        expect(next.has("P")).toBe(true)
    })
})

describe("stateOf regression (no linked nodes behaves exactly as before)", () => {
    // With a nodes map of only regular nodes and ANY boardComplete resolver, the boards-aware stateOf
    // must equal the classic bottom-up rule byte-for-byte -- the top-down gate can never fire, and the
    // resolver is irrelevant. Guards the "additive" contract.
    const seedIds = ["learn", "plan-goal", "track-progress", "break-steps", "finish-milestone"]
    const regularNodes = nodeMap(...seedIds.map(reg))

    it("matches the classic 3-arg rule regardless of the resolver", () => {
        for (const id of seedIds) {
            const classic = stateOf(id, MASTERED, EDGES)
            expect(stateOf(id, MASTERED, EDGES, regularNodes, () => true)).toBe(classic)
            expect(stateOf(id, MASTERED, EDGES, regularNodes, () => false)).toBe(classic)
        }
    })
})

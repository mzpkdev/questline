import { childrenOf, complete, descendantsOf, parentOf, STATE_LABEL, stateOf, uncomplete } from "./graph"
import { EDGES, MASTERED } from "./milestones"

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

    it("returns null for the root goal", () => {
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

import type { Milestone, MilestoneEdge } from "./milestones"
import { deleteMilestone, insertParent, type Project, seedProject } from "./project"

// deleteMilestone works over the bundled seed roadmap:
//   learn (goal) -> {plan-goal, track-progress} -> {break-steps, finish-milestone}
// with break-steps pre-completed and every non-goal node carrying a checklist.
describe("deleteMilestone", () => {
    it("removes a leaf from every slice it touches", () => {
        // break-steps is a leaf: complete, with a checklist and an incoming edge from plan-goal.
        const next = deleteMilestone(seedProject(), "break-steps")
        expect(next.milestones["break-steps"]).toBeUndefined()
        expect(next.edges).not.toContainEqual(["plan-goal", "break-steps"])
        expect(next.todos["break-steps"]).toBeUndefined()
        expect(next.mastered.has("break-steps")).toBe(false)
    })

    it("cascades a subtree, leaving unrelated branches intact", () => {
        // track-progress carries a child (finish-milestone); both go, while plan-goal's branch stays.
        const next = deleteMilestone(seedProject(), "track-progress")
        expect(next.milestones["track-progress"]).toBeUndefined()
        expect(next.milestones["finish-milestone"]).toBeUndefined()
        expect(next.edges).not.toContainEqual(["learn", "track-progress"])
        expect(next.edges).not.toContainEqual(["track-progress", "finish-milestone"])
        expect(next.todos["finish-milestone"]).toBeUndefined()
        // The other branch (and the goal) is untouched.
        expect(next.milestones["plan-goal"]).toBeDefined()
        expect(next.milestones["break-steps"]).toBeDefined()
        expect(next.edges).toContainEqual(["plan-goal", "break-steps"])
    })

    it("is a no-op (same reference) for the goal id", () => {
        const project = seedProject()
        expect(deleteMilestone(project, project.goalId)).toBe(project)
    })

    it("is a no-op (same reference) for an unknown id", () => {
        const project = seedProject()
        expect(deleteMilestone(project, "does-not-exist")).toBe(project)
    })
})

// insertParent over the same seed tree (learn tier 0; plan-goal / track-progress tier 1; break-steps /
// finish-milestone tier 2, under plan-goal / track-progress respectively).
describe("insertParent", () => {
    it("splices a new node between a regular milestone and its parent", () => {
        const next = insertParent(seedProject(), "finish-milestone", "node-x")
        expect(next.edges).toContainEqual(["track-progress", "node-x"])
        expect(next.edges).toContainEqual(["node-x", "finish-milestone"])
        expect(next.edges).not.toContainEqual(["track-progress", "finish-milestone"])
        // The new node takes the target's old tier; the target drops one.
        expect(next.milestones["node-x"]?.tier).toBe(2)
        expect(next.milestones["finish-milestone"]?.tier).toBe(3)
        expect(next.goalId).toBe("learn") // the goal is unchanged
    })

    it("drops the whole subtree a tier when inserting above a branch node", () => {
        const next = insertParent(seedProject(), "track-progress", "node-x")
        expect(next.edges).toContainEqual(["learn", "node-x"])
        expect(next.edges).toContainEqual(["node-x", "track-progress"])
        expect(next.edges).not.toContainEqual(["learn", "track-progress"])
        expect(next.milestones["node-x"]?.tier).toBe(1)
        expect(next.milestones["track-progress"]?.tier).toBe(2)
        expect(next.milestones["finish-milestone"]?.tier).toBe(3) // subtree shifted too
    })

    it("promotes the new node to the goal when inserting above the goal", () => {
        const next = insertParent(seedProject(), "learn", "node-x")
        expect(next.goalId).toBe("node-x")
        expect(next.milestones["node-x"]?.tier).toBe(0)
        expect(next.milestones["node-x"]?.tag).toBe("Goal")
        expect(next.milestones["learn"]?.tier).toBe(1)
        expect(next.edges).toContainEqual(["node-x", "learn"])
    })

    it("drops the old parent (and its ancestors) from the completed set", () => {
        const m = (id: string, tier: number): Milestone => ({
            id,
            name: id,
            tag: "T",
            x: 0,
            y: tier * 160,
            tier,
            branch: "B",
            description: "",
            reward: 1
        })
        const edges: MilestoneEdge[] = [
            ["g", "a"],
            ["a", "b"]
        ]
        const project: Project = {
            id: "t",
            goalId: "g",
            milestones: { g: m("g", 0), a: m("a", 1), b: m("b", 2) },
            edges,
            todos: {},
            mastered: new Set(["g", "a", "b"])
        }
        const next = insertParent(project, "b", "node-n")
        expect(next.edges).toContainEqual(["a", "node-n"])
        expect(next.edges).toContainEqual(["node-n", "b"])
        expect(next.mastered.has("b")).toBe(true) // the target keeps its state
        expect(next.mastered.has("a")).toBe(false) // old parent now holds an incomplete child
        expect(next.mastered.has("g")).toBe(false) // ...and its ancestors drop too
    })

    it("is a no-op (same reference) for an unknown id", () => {
        const project = seedProject()
        expect(insertParent(project, "does-not-exist", "node-x")).toBe(project)
    })
})

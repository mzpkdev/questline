import { deleteMilestone, seedProject } from "./project"

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

import type { Edge, Node } from "./nodes"
import { type Board, deleteNode, insertParent, seedBoard } from "./board"

// deleteNode works over the bundled seed roadmap:
//   learn (root) -> {plan-goal, track-progress} -> {break-steps, finish-milestone}
// with break-steps pre-completed and every non-root node carrying a checklist.
describe("deleteNode", () => {
    it("removes a leaf from every slice it touches", () => {
        // break-steps is a leaf: complete, with a checklist and an incoming edge from plan-goal.
        const next = deleteNode(seedBoard(), "break-steps")
        expect(next.milestones["break-steps"]).toBeUndefined()
        expect(next.edges).not.toContainEqual(["plan-goal", "break-steps"])
        expect(next.todos["break-steps"]).toBeUndefined()
        expect(next.mastered.has("break-steps")).toBe(false)
    })

    it("cascades a subtree, leaving unrelated branches intact", () => {
        // track-progress carries a child (finish-milestone); both go, while plan-goal's branch stays.
        const next = deleteNode(seedBoard(), "track-progress")
        expect(next.milestones["track-progress"]).toBeUndefined()
        expect(next.milestones["finish-milestone"]).toBeUndefined()
        expect(next.edges).not.toContainEqual(["learn", "track-progress"])
        expect(next.edges).not.toContainEqual(["track-progress", "finish-milestone"])
        expect(next.todos["finish-milestone"]).toBeUndefined()
        // The other branch (and the root node) is untouched.
        expect(next.milestones["plan-goal"]).toBeDefined()
        expect(next.milestones["break-steps"]).toBeDefined()
        expect(next.edges).toContainEqual(["plan-goal", "break-steps"])
    })

    it("is a no-op (same reference) for the root node id", () => {
        const board = seedBoard()
        expect(deleteNode(board, board.rootId)).toBe(board)
    })

    it("is a no-op (same reference) for an unknown id", () => {
        const board = seedBoard()
        expect(deleteNode(board, "does-not-exist")).toBe(board)
    })
})

// insertParent over the same seed tree (learn tier 0; plan-goal / track-progress tier 1; break-steps /
// finish-milestone tier 2, under plan-goal / track-progress respectively).
describe("insertParent", () => {
    it("splices a new node between a regular node and its parent", () => {
        const next = insertParent(seedBoard(), "finish-milestone", "node-x")
        expect(next.edges).toContainEqual(["track-progress", "node-x"])
        expect(next.edges).toContainEqual(["node-x", "finish-milestone"])
        expect(next.edges).not.toContainEqual(["track-progress", "finish-milestone"])
        // The new node takes the target's old tier; the target drops one.
        expect(next.milestones["node-x"]?.tier).toBe(2)
        expect(next.milestones["finish-milestone"]?.tier).toBe(3)
        expect(next.rootId).toBe("learn") // the root node is unchanged
    })

    it("drops the whole subtree a tier when inserting above a branch node", () => {
        const next = insertParent(seedBoard(), "track-progress", "node-x")
        expect(next.edges).toContainEqual(["learn", "node-x"])
        expect(next.edges).toContainEqual(["node-x", "track-progress"])
        expect(next.edges).not.toContainEqual(["learn", "track-progress"])
        expect(next.milestones["node-x"]?.tier).toBe(1)
        expect(next.milestones["track-progress"]?.tier).toBe(2)
        expect(next.milestones["finish-milestone"]?.tier).toBe(3) // subtree shifted too
    })

    it("promotes the new node to the root when inserting above the root node", () => {
        const next = insertParent(seedBoard(), "learn", "node-x")
        expect(next.rootId).toBe("node-x")
        expect(next.milestones["node-x"]?.tier).toBe(0)
        expect(next.milestones["node-x"]?.tag).toBe("Root")
        expect(next.milestones["learn"]?.tier).toBe(1)
        expect(next.edges).toContainEqual(["node-x", "learn"])
    })

    it("drops the old parent (and its ancestors) from the completed set", () => {
        const m = (id: string, tier: number): Node => ({
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
        const edges: Edge[] = [
            ["g", "a"],
            ["a", "b"]
        ]
        const board: Board = {
            id: "t",
            rootId: "g",
            milestones: { g: m("g", 0), a: m("a", 1), b: m("b", 2) },
            edges,
            todos: {},
            mastered: new Set(["g", "a", "b"])
        }
        const next = insertParent(board, "b", "node-n")
        expect(next.edges).toContainEqual(["a", "node-n"])
        expect(next.edges).toContainEqual(["node-n", "b"])
        expect(next.mastered.has("b")).toBe(true) // the target keeps its state
        expect(next.mastered.has("a")).toBe(false) // old parent now holds an incomplete child
        expect(next.mastered.has("g")).toBe(false) // ...and its ancestors drop too
    })

    it("is a no-op (same reference) for an unknown id", () => {
        const board = seedBoard()
        expect(insertParent(board, "does-not-exist", "node-x")).toBe(board)
    })
})

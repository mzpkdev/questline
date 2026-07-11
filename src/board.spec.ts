import type { Edge, Node } from "./nodes"
import {
    addBoard,
    addChild,
    type Board,
    boardsReducer,
    type BoardsState,
    completeNode,
    deleteNode,
    editNode,
    insertParent,
    moveNode,
    newBoard,
    removeBoard,
    seedBoard,
    toggleTodo,
    uncompleteNode
} from "./board"

// A minimal node record for hand-built fixtures (kind is positional, so no tag/branch fields).
const node = (id: string, tier: number): Node => ({ id, name: id, x: 0, y: tier * 160, tier, description: "", reward: 1 })

// deleteNode works over the bundled seed roadmap:
//   learn (root) -> {plan-goal, track-progress} -> {break-steps, finish-milestone}
// with break-steps pre-completed and every non-root node carrying a checklist.
describe("deleteNode", () => {
    it("removes a leaf from every slice it touches", () => {
        // break-steps is a leaf: complete, with a checklist and an incoming edge from plan-goal.
        const next = deleteNode(seedBoard(), "break-steps")
        expect(next.nodes["break-steps"]).toBeUndefined()
        expect(next.edges).not.toContainEqual(["plan-goal", "break-steps"])
        expect(next.todos["break-steps"]).toBeUndefined()
        expect(next.mastered.has("break-steps")).toBe(false)
    })

    it("cascades a subtree, leaving unrelated branches intact", () => {
        // track-progress carries a child (finish-milestone); both go, while plan-goal's branch stays.
        const next = deleteNode(seedBoard(), "track-progress")
        expect(next.nodes["track-progress"]).toBeUndefined()
        expect(next.nodes["finish-milestone"]).toBeUndefined()
        expect(next.edges).not.toContainEqual(["learn", "track-progress"])
        expect(next.edges).not.toContainEqual(["track-progress", "finish-milestone"])
        expect(next.todos["finish-milestone"]).toBeUndefined()
        // The other branch (and the root node) is untouched.
        expect(next.nodes["plan-goal"]).toBeDefined()
        expect(next.nodes["break-steps"]).toBeDefined()
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
        expect(next.nodes["node-x"]?.tier).toBe(2)
        expect(next.nodes["finish-milestone"]?.tier).toBe(3)
        expect(next.rootId).toBe("learn") // the root node is unchanged
    })

    it("drops the whole subtree a tier when inserting above a branch node", () => {
        const next = insertParent(seedBoard(), "track-progress", "node-x")
        expect(next.edges).toContainEqual(["learn", "node-x"])
        expect(next.edges).toContainEqual(["node-x", "track-progress"])
        expect(next.edges).not.toContainEqual(["learn", "track-progress"])
        expect(next.nodes["node-x"]?.tier).toBe(1)
        expect(next.nodes["track-progress"]?.tier).toBe(2)
        expect(next.nodes["finish-milestone"]?.tier).toBe(3) // subtree shifted too
    })

    it("promotes the new node to the root when inserting above the root node", () => {
        const next = insertParent(seedBoard(), "learn", "node-x")
        expect(next.rootId).toBe("node-x")
        expect(next.nodes["node-x"]?.tier).toBe(0)
        expect(next.nodes["learn"]?.tier).toBe(1)
        expect(next.edges).toContainEqual(["node-x", "learn"])
    })

    it("drops the old parent (and its ancestors) from the completed set", () => {
        const edges: Edge[] = [
            ["g", "a"],
            ["a", "b"]
        ]
        const board: Board = {
            id: "t",
            rootId: "g",
            nodes: { g: node("g", 0), a: node("a", 1), b: node("b", 2) },
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

describe("addChild", () => {
    it("appends a leaf a tier below with an edge from the parent", () => {
        const next = addChild(seedBoard(), "finish-milestone", "node-c")
        expect(next.nodes["node-c"]?.tier).toBe(3)
        expect(next.edges).toContainEqual(["finish-milestone", "node-c"])
    })

    it("un-completes the parent (and ancestors) when the fresh child is incomplete", () => {
        // plan-goal is unlocked (its child break-steps is complete); mark it complete, then add a child.
        const board = completeNode(seedBoard(), "plan-goal", true)
        expect(board.mastered.has("plan-goal")).toBe(true)
        const next = addChild(board, "plan-goal", "node-c")
        expect(next.mastered.has("plan-goal")).toBe(false)
    })

    it("is a no-op (same reference) for an unknown parent", () => {
        const board = seedBoard()
        expect(addChild(board, "nope", "node-c")).toBe(board)
    })
})

describe("editNode / moveNode", () => {
    it("patches a node's name / description / reward", () => {
        const next = editNode(seedBoard(), "plan-goal", { name: "Renamed", reward: 9 })
        expect(next.nodes["plan-goal"]?.name).toBe("Renamed")
        expect(next.nodes["plan-goal"]?.reward).toBe(9)
    })

    it("moves a node to a new centre, and is a no-op at the same position", () => {
        const board = seedBoard()
        const moved = moveNode(board, "learn", 12, 34)
        expect(moved.nodes["learn"]?.x).toBe(12)
        expect(moved.nodes["learn"]?.y).toBe(34)
        expect(moveNode(moved, "learn", 12, 34)).toBe(moved) // unchanged position -> same reference
    })

    it("is a no-op (same reference) for an unknown id", () => {
        const board = seedBoard()
        expect(editNode(board, "nope", { name: "x" })).toBe(board)
        expect(moveNode(board, "nope", 1, 2)).toBe(board)
    })
})

describe("completeNode / uncompleteNode", () => {
    it("marks an unlocked node with all boxes ticked complete", () => {
        const next = completeNode(seedBoard(), "plan-goal", true)
        expect(next.mastered.has("plan-goal")).toBe(true)
    })

    it("refuses to complete while a box is unchecked (same reference)", () => {
        const board = seedBoard()
        expect(completeNode(board, "plan-goal", false)).toBe(board)
    })

    it("un-completes, cascading up so no completed parent keeps an incomplete child", () => {
        const board = completeNode(completeNode(seedBoard(), "plan-goal", true), "learn", false)
        // learn can't complete yet (track-progress incomplete), so just un-complete plan-goal.
        const next = uncompleteNode(board, "plan-goal")
        expect(next.mastered.has("plan-goal")).toBe(false)
    })
})

describe("todo ops", () => {
    it("ticks and unticks a checklist item", () => {
        const ticked = toggleTodo(seedBoard(), "finish-milestone", 0)
        expect(ticked.todos["finish-milestone"]?.[0]?.done).toBe(true)
        const back = toggleTodo(ticked, "finish-milestone", 0)
        expect(back.todos["finish-milestone"]?.[0]?.done).toBe(false)
    })

    it("is a no-op (same reference) toggling a node with no checklist", () => {
        const board = seedBoard()
        expect(toggleTodo(board, "learn", 0)).toBe(board)
    })
})

describe("addBoard", () => {
    it("adds a fresh root-only board and appends it to the order", () => {
        const state: BoardsState = { boards: { seed: seedBoard() }, order: ["seed"] }
        const next = addBoard(state, "board-1", "node-r", "New Quest")
        expect(next.order).toEqual(["seed", "board-1"])
        const board = next.boards["board-1"]
        expect(board?.rootId).toBe("node-r")
        expect(board?.nodes["node-r"]?.name).toBe("New Quest")
        expect(board?.edges).toEqual([])
        expect(newBoard("board-1", "node-r", "New Quest").nodes["node-r"]?.tier).toBe(0)
    })
})

describe("removeBoard", () => {
    it("drops a board from the map and the order, with no floor (the last board can go)", () => {
        const state: BoardsState = { boards: { seed: seedBoard() }, order: ["seed"] }
        const next = removeBoard(state, "seed")
        expect(next.boards).toEqual({})
        expect(next.order).toEqual([])
    })

    it("does not reparent or touch the surviving boards", () => {
        const a = newBoard("a", "a-root", "A")
        const b = newBoard("b", "b-root", "B")
        const state: BoardsState = { boards: { a, b }, order: ["a", "b"] }
        const next = removeBoard(state, "a")
        expect(next.order).toEqual(["b"])
        expect(next.boards.b).toBe(b) // surviving board kept as-is
        expect(next.boards.a).toBeUndefined()
    })

    it("is a no-op (same reference) for an unknown id", () => {
        const state: BoardsState = { boards: { seed: seedBoard() }, order: ["seed"] }
        expect(removeBoard(state, "nope")).toBe(state)
    })
})

describe("boardsReducer", () => {
    const state = (): BoardsState => ({ boards: { seed: seedBoard() }, order: ["seed"] })

    it("routes a single-board action through the matching op", () => {
        const next = boardsReducer(state(), { type: "editNode", boardId: "seed", id: "plan-goal", patch: { name: "X" } })
        expect(next.boards.seed?.nodes["plan-goal"]?.name).toBe("X")
    })

    it("keeps the whole state reference stable on a no-op single-board action", () => {
        const s = state()
        // Moving to the same position is a no-op inside moveNode, so the reducer returns state as-is.
        const seed = s.boards.seed
        const x = seed?.nodes["learn"]?.x ?? 0
        const y = seed?.nodes["learn"]?.y ?? 0
        expect(boardsReducer(s, { type: "moveNode", boardId: "seed", id: "learn", x, y })).toBe(s)
    })

    it("returns state unchanged for an action on an unknown board", () => {
        const s = state()
        expect(boardsReducer(s, { type: "deleteNode", boardId: "ghost", id: "x" })).toBe(s)
    })

    it("adds, renames, and removes boards through the map actions", () => {
        let s = boardsReducer(state(), { type: "addBoard", boardId: "board-1", rootId: "node-r", name: "New Quest" })
        expect(s.order).toEqual(["seed", "board-1"])

        s = boardsReducer(s, { type: "renameBoard", boardId: "board-1", name: "Launch" })
        expect(s.boards["board-1"]?.nodes["node-r"]?.name).toBe("Launch")

        s = boardsReducer(s, { type: "removeBoard", boardId: "seed" })
        expect(s.order).toEqual(["board-1"])
        expect(s.boards.seed).toBeUndefined()
    })

    it("replaces the whole state on a replace action", () => {
        const replacement = { boards: { only: newBoard("only", "only-root", "Only") }, order: ["only"] }
        const next = boardsReducer(state(), { type: "replace", ...replacement })
        expect(next.order).toEqual(["only"])
        expect(next.boards.only?.nodes["only-root"]?.name).toBe("Only")
    })
})

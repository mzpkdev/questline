import { type Edge, isLinkedNode, type Node } from "./nodes"
import {
    addBoard,
    addChild,
    addLinkedNode,
    type Board,
    boardComplete,
    boardCompleter,
    boardsReducer,
    type BoardsState,
    completeNode,
    deleteNode,
    editNode,
    insertParent,
    linkedNodeName,
    moveNode,
    newBoard,
    removeBoard,
    seedBoard,
    setLinkedTarget,
    toggleTodo,
    uncompleteNode,
    UNLINKED_LABEL
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

describe("addLinkedNode", () => {
    it("attaches an unlinked linked node child (targetBoardId null, no reward/checklist)", () => {
        const next = addLinkedNode(seedBoard(), "finish-milestone", "node-link")
        const link = next.nodes["node-link"]
        expect(link).toBeDefined()
        // Kind is positional: the targetBoardId key is present, and starts null (unlinked).
        expect(isLinkedNode(link as Node)).toBe(true)
        expect(link?.targetBoardId).toBeNull()
        // No reward / description of its own; positioned a tier below its parent, with the edge.
        expect(link?.reward).toBeUndefined()
        expect(link?.description).toBeUndefined()
        expect(link?.tier).toBe(3)
        expect(next.edges).toContainEqual(["finish-milestone", "node-link"])
    })

    it("un-completes the parent (and ancestors) when the fresh linked child is incomplete", () => {
        const board = completeNode(seedBoard(), "plan-goal", true)
        expect(board.mastered.has("plan-goal")).toBe(true)
        const next = addLinkedNode(board, "plan-goal", "node-link")
        expect(next.mastered.has("plan-goal")).toBe(false)
    })

    it("is a no-op (same reference) for an unknown parent", () => {
        const board = seedBoard()
        expect(addLinkedNode(board, "nope", "node-link")).toBe(board)
    })
})

describe("setLinkedTarget", () => {
    // A board holding one linked node (unlinked) under its root.
    const withLink = (): Board => addLinkedNode(newBoard("a", "a-root", "A"), "a-root", "link")

    it("points a linked node at a board, and clears it back to unlinked with null", () => {
        const linked = setLinkedTarget(withLink(), "link", "board-x")
        expect(linked.nodes.link?.targetBoardId).toBe("board-x")
        const cleared = setLinkedTarget(linked, "link", null)
        expect(cleared.nodes.link?.targetBoardId).toBeNull()
    })

    it("is a no-op (same reference) on a regular node (no targetBoardId key)", () => {
        const board = seedBoard()
        expect(setLinkedTarget(board, "plan-goal", "board-x")).toBe(board)
    })

    it("is a no-op (same reference) for an unknown id or an unchanged target", () => {
        const board = withLink()
        expect(setLinkedTarget(board, "nope", "board-x")).toBe(board)
        expect(setLinkedTarget(board, "link", null)).toBe(board) // already null
    })
})

describe("linkedNodeName", () => {
    it("derives the display name from the target board's root node, live", () => {
        const boards = { seed: seedBoard(), other: newBoard("other", "other-root", "Other Quest") }
        expect(linkedNodeName(boards, "other")).toBe("Other Quest")
        // Rename that board's root -> the derived name follows.
        const renamed = { ...boards, other: editNode(boards.other, "other-root", { name: "Renamed Quest" }) }
        expect(linkedNodeName(renamed, "other")).toBe("Renamed Quest")
    })

    it("falls back to the placeholder when unlinked or the target is gone", () => {
        const boards = { seed: seedBoard() }
        expect(linkedNodeName(boards, null)).toBe(UNLINKED_LABEL)
        expect(linkedNodeName(boards, "does-not-exist")).toBe(UNLINKED_LABEL)
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

describe("boardComplete / boardCompleter", () => {
    it("is true only when the board's root node is mastered", () => {
        const open = newBoard("b", "b-root", "B") // fresh: root not yet mastered
        expect(boardComplete({ b: open }, "b")).toBe(false)
        // A fresh board's root is a lone leaf, so completing it masters the board.
        const done = completeNode(open, "b-root", true)
        expect(boardComplete({ b: done }, "b")).toBe(true)
    })

    it("is false for an unknown board", () => {
        expect(boardComplete({}, "nope")).toBe(false)
    })

    it("boardCompleter binds a boards map into a reusable resolver", () => {
        const done = completeNode(newBoard("b", "b-root", "B"), "b-root", true)
        const resolve = boardCompleter({ b: done })
        expect(resolve("b")).toBe(true)
        expect(resolve("nope")).toBe(false)
    })
})

describe("completeNode / uncompleteNode across boards (linked children)", () => {
    // A board whose root's only child is a linked node pointing at "target": the root is gated by that
    // link, which masters exactly when boardComplete("target") is true.
    const withLinkedChild = (): Board => setLinkedTarget(addLinkedNode(newBoard("x", "x-root", "X"), "x-root", "x-link"), "x-link", "target")

    it("keeps the root locked while its linked child's target board is incomplete", () => {
        const b = withLinkedChild()
        expect(completeNode(b, "x-root", true, () => false)).toBe(b) // refused -> same reference
    })

    it("unlocks and completes the root once the linked child's target board is complete", () => {
        const b = withLinkedChild()
        const next = completeNode(b, "x-root", true, (id) => id === "target")
        expect(next.mastered.has("x-root")).toBe(true)
    })

    it("never masters a linked node itself (guarded in graph.complete)", () => {
        const b = withLinkedChild()
        expect(completeNode(b, "x-link", true, () => true)).toBe(b) // same reference
    })

    it("un-completing under a linked ancestor never drops an ancestor above the link", () => {
        // P (root) -> L (linked) -> C. Mark P and C complete by hand; a linked node is never in the set,
        // so the up-cascade from C breaks at L and P survives.
        let b = addChild(addLinkedNode(newBoard("x", "P", "P"), "P", "L"), "L", "C")
        b = setLinkedTarget(b, "L", "target")
        b = { ...b, mastered: new Set(["P", "C"]) }
        const next = uncompleteNode(b, "C")
        expect(next.mastered.has("C")).toBe(false)
        expect(next.mastered.has("P")).toBe(true)
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

    it("does not reparent or touch the surviving boards with no linked nodes", () => {
        const a = newBoard("a", "a-root", "A")
        const b = newBoard("b", "b-root", "B")
        const state: BoardsState = { boards: { a, b }, order: ["a", "b"] }
        const next = removeBoard(state, "a")
        expect(next.order).toEqual(["b"])
        expect(next.boards.b).toBe(b) // surviving board kept as-is (same reference)
        expect(next.boards.a).toBeUndefined()
    })

    it("unlinks every linked node pointing at the deleted board, across all survivors, keeping subtrees", () => {
        // Two survivors each carry a linked node aimed at the doomed board `t`; a child hangs under one
        // of those linked nodes to prove the subtree stays put.
        let a = addLinkedNode(newBoard("a", "a-root", "A"), "a-root", "a-link")
        a = setLinkedTarget(a, "a-link", "t")
        a = addChild(a, "a-link", "a-link-child")
        let b = addLinkedNode(newBoard("b", "b-root", "B"), "b-root", "b-link")
        b = setLinkedTarget(b, "b-link", "t")
        const t = newBoard("t", "t-root", "Target")
        const state: BoardsState = { boards: { a, b, t }, order: ["a", "b", "t"] }

        const next = removeBoard(state, "t")
        expect(next.boards.t).toBeUndefined()
        // Both linked nodes revert to unlinked (null), but stay in the tree with their subtrees intact.
        expect(next.boards.a?.nodes["a-link"]?.targetBoardId).toBeNull()
        expect(next.boards.a?.nodes["a-link-child"]).toBeDefined()
        expect(next.boards.a?.edges).toContainEqual(["a-link", "a-link-child"])
        expect(next.boards.b?.nodes["b-link"]?.targetBoardId).toBeNull()
    })

    it("leaves a survivor's reference stable when none of its linked nodes pointed at the deleted board", () => {
        let a = addLinkedNode(newBoard("a", "a-root", "A"), "a-root", "a-link")
        a = setLinkedTarget(a, "a-link", "other") // points elsewhere, not at the doomed board
        const b = newBoard("b", "b-root", "B")
        const state: BoardsState = { boards: { a, b }, order: ["a", "b"] }
        const next = removeBoard(state, "b")
        expect(next.boards.a).toBe(a) // untouched -> same reference
        expect(next.boards.a?.nodes["a-link"]?.targetBoardId).toBe("other")
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

    it("routes addLinkedNode then setLinkedTarget through their ops", () => {
        let s = boardsReducer(state(), { type: "addLinkedNode", boardId: "seed", parentId: "learn", childId: "link" })
        expect(isLinkedNode(s.boards.seed?.nodes.link as Node)).toBe(true)
        expect(s.boards.seed?.nodes.link?.targetBoardId).toBeNull()

        s = boardsReducer(s, { type: "setLinkedTarget", boardId: "seed", id: "link", targetBoardId: "board-x" })
        expect(s.boards.seed?.nodes.link?.targetBoardId).toBe("board-x")
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

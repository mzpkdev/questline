import { DEFAULT_NODE_REWARD, type Edge, isLinkedNode, type Node } from "./nodes"
import {
    addBoard,
    addChild,
    addLinkedNode,
    type Board,
    type Boards,
    convertToLinkedNode,
    convertToRegularNode,
    boardComplete,
    boardCompleter,
    boardGold,
    boardsReducer,
    type BoardsState,
    completeNode,
    deleteNode,
    detach,
    editNode,
    insertParent,
    linkedNodeName,
    linkWouldCycle,
    moveNode,
    newBoard,
    removeBoard,
    reparent,
    seedBoard,
    setLinkedTarget,
    toggleTodo,
    uncompleteNode,
    UNLINKED_LABEL
} from "./board"

// A minimal node record for hand-built fixtures (kind is positional, so no tag/branch fields).
const node = (id: string, tier: number): Node => ({ id, name: id, x: 0, y: tier * 160, tier, description: "", reward: 1 })

// deleteNode works over the bundled seed roadmap:
//   learn (root) -> {plan-goal, track-progress} -> {break-steps, finish-node}
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

    it("removes only the node, orphaning its child (not a cascade)", () => {
        // track-progress carries a child (finish-node). Only track-progress goes; finish-node survives
        // but loses its incoming edge, so its subtree becomes a parked orphan (derives "detached").
        const next = deleteNode(seedBoard(), "track-progress")
        expect(next.nodes["track-progress"]).toBeUndefined()
        expect(next.nodes["finish-node"]).toBeDefined() // the child is NOT deleted
        expect(next.todos["finish-node"]).toBeDefined() // its checklist survives too
        // Both edges touching track-progress are gone: the one into it and the one down to finish-node.
        expect(next.edges).not.toContainEqual(["learn", "track-progress"])
        expect(next.edges).not.toContainEqual(["track-progress", "finish-node"])
        // finish-node now has no parent -- an orphan.
        expect(next.edges.some(([, child]) => child === "finish-node")).toBe(false)
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
// finish-node tier 2, under plan-goal / track-progress respectively).
describe("insertParent", () => {
    it("splices a new node between a regular node and its parent", () => {
        const next = insertParent(seedBoard(), "finish-node", "node-x")
        expect(next.edges).toContainEqual(["track-progress", "node-x"])
        expect(next.edges).toContainEqual(["node-x", "finish-node"])
        expect(next.edges).not.toContainEqual(["track-progress", "finish-node"])
        // The new node takes the target's old tier; the target drops one.
        expect(next.nodes["node-x"]?.tier).toBe(2)
        expect(next.nodes["finish-node"]?.tier).toBe(3)
        expect(next.rootId).toBe("learn") // the root node is unchanged
    })

    it("drops the whole subtree a tier when inserting above a branch node", () => {
        const next = insertParent(seedBoard(), "track-progress", "node-x")
        expect(next.edges).toContainEqual(["learn", "node-x"])
        expect(next.edges).toContainEqual(["node-x", "track-progress"])
        expect(next.edges).not.toContainEqual(["learn", "track-progress"])
        expect(next.nodes["node-x"]?.tier).toBe(1)
        expect(next.nodes["track-progress"]?.tier).toBe(2)
        expect(next.nodes["finish-node"]?.tier).toBe(3) // subtree shifted too
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

    it("splices a regular node above a linked target, dropping its subtree a tier and keeping it linked", () => {
        // A linked node under finish-node (tier 2 -> the link lands at tier 3), pointed at another board
        // and carrying a child of its own, so the subtree shift is observable.
        const linked = setLinkedTarget(addLinkedNode(seedBoard(), "finish-node", "link-x"), "link-x", "other-board")
        const withChild = addChild(linked, "link-x", "link-child")
        expect(isLinkedNode(withChild.nodes["link-x"] as Node)).toBe(true)

        const next = insertParent(withChild, "link-x", "node-x")
        // A regular node is spliced between the linked node and its parent.
        expect(next.edges).toContainEqual(["finish-node", "node-x"])
        expect(next.edges).toContainEqual(["node-x", "link-x"])
        expect(next.edges).not.toContainEqual(["finish-node", "link-x"])
        expect(isLinkedNode(next.nodes["node-x"] as Node)).toBe(false) // the inserted node is a plain node

        // The linked node keeps its identity + target; it and its subtree each drop a tier.
        expect(isLinkedNode(next.nodes["link-x"] as Node)).toBe(true)
        expect(next.nodes["link-x"]?.targetBoardId).toBe("other-board")
        expect(next.nodes["node-x"]?.tier).toBe(3)
        expect(next.nodes["link-x"]?.tier).toBe(4)
        expect(next.nodes["link-child"]?.tier).toBe(5) // subtree shifted with it
        expect(next.edges).toContainEqual(["link-x", "link-child"])
    })

    it("is a no-op (same reference) for an unknown id", () => {
        const board = seedBoard()
        expect(insertParent(board, "does-not-exist", "node-x")).toBe(board)
    })
})

describe("addChild", () => {
    it("appends a leaf a tier below with an edge from the parent", () => {
        const next = addChild(seedBoard(), "finish-node", "node-c")
        expect(next.nodes["node-c"]?.tier).toBe(3)
        expect(next.edges).toContainEqual(["finish-node", "node-c"])
    })

    it("un-completes the parent (and ancestors) when the fresh child is incomplete", () => {
        // plan-goal is unlocked (its child break-steps is complete); mark it complete, then add a child.
        const board = completeNode(seedBoard(), "plan-goal", true, () => false)
        expect(board.mastered.has("plan-goal")).toBe(true)
        const next = addChild(board, "plan-goal", "node-c")
        expect(next.mastered.has("plan-goal")).toBe(false)
    })

    it("is a no-op (same reference) for an unknown parent", () => {
        const board = seedBoard()
        expect(addChild(board, "nope", "node-c")).toBe(board)
    })
})

// reparent over the same seed tree (learn tier 0; plan-goal / track-progress tier 1; break-steps under
// plan-goal and finish-node under track-progress, both tier 2; break-steps pre-mastered).
describe("reparent", () => {
    it("rejects the node itself, a descendant, the root, and unknown ids (no-op, same reference)", () => {
        const board = seedBoard()
        expect(reparent(board, "finish-node", "finish-node")).toBe(board) // can't parent to itself
        expect(reparent(board, "plan-goal", "break-steps")).toBe(board) // break-steps is under plan-goal
        expect(reparent(board, board.rootId, "plan-goal")).toBe(board) // the root has no parent to rewire
        expect(reparent(board, "nope", "learn")).toBe(board) // unknown node
        expect(reparent(board, "finish-node", "nope")).toBe(board) // unknown parent
    })

    it("is a no-op (same reference) when the node already hangs under that parent", () => {
        const board = seedBoard()
        expect(reparent(board, "finish-node", "track-progress")).toBe(board)
    })

    it("rewires only the node's incoming edge to [newParentId, nodeId]", () => {
        const next = reparent(seedBoard(), "finish-node", "plan-goal")
        expect(next.edges).toContainEqual(["plan-goal", "finish-node"])
        expect(next.edges).not.toContainEqual(["track-progress", "finish-node"])
        // Every other edge is left untouched.
        expect(next.edges).toContainEqual(["learn", "plan-goal"])
        expect(next.edges).toContainEqual(["learn", "track-progress"])
        expect(next.edges).toContainEqual(["plan-goal", "break-steps"])
    })

    it("recomputes the moved subtree's tiers while keeping every moved node's x/y", () => {
        const board = seedBoard()
        const tp = board.nodes["track-progress"] as Node
        const fn = board.nodes["finish-node"] as Node
        // track-progress (tier 1, carrying finish-node at tier 2) re-hung under break-steps (tier 2).
        const next = reparent(board, "track-progress", "break-steps")
        expect(next.edges).toContainEqual(["break-steps", "track-progress"])
        expect(next.edges).not.toContainEqual(["learn", "track-progress"])
        // Tiers cascade one below the new parent, down the whole moved branch...
        expect(next.nodes["track-progress"]?.tier).toBe(3)
        expect(next.nodes["finish-node"]?.tier).toBe(4)
        // ...while positions are never touched by a reparent.
        expect(next.nodes["track-progress"]?.x).toBe(tp.x)
        expect(next.nodes["track-progress"]?.y).toBe(tp.y)
        expect(next.nodes["finish-node"]?.x).toBe(fn.x)
        expect(next.nodes["finish-node"]?.y).toBe(fn.y)
    })

    it("un-masters the new parent up the chain, and the moved node keeps its own mastered mark", () => {
        // g (root) -> a -> b, plus a sibling leaf s under g. g, a, b and the moved node s are all marked
        // complete by hand; re-hang s under b.
        const edges: Edge[] = [
            ["g", "a"],
            ["a", "b"],
            ["g", "s"]
        ]
        const board: Board = {
            id: "t",
            rootId: "g",
            nodes: { g: node("g", 0), a: node("a", 1), b: node("b", 2), s: node("s", 1) },
            edges,
            todos: {},
            mastered: new Set(["g", "a", "b", "s"])
        }
        const next = reparent(board, "s", "b")
        expect(next.edges).toContainEqual(["b", "s"])
        expect(next.edges).not.toContainEqual(["g", "s"])
        // The new parent b and its now-inconsistent ancestors a, g drop out of the completed set...
        expect(next.mastered.has("b")).toBe(false)
        expect(next.mastered.has("a")).toBe(false)
        expect(next.mastered.has("g")).toBe(false)
        // ...but the moved node keeps its own mastered mark, and its tier lands one below b.
        expect(next.mastered.has("s")).toBe(true)
        expect(next.nodes["s"]?.tier).toBe(3)
    })

    it("attaches a parked orphan by ADDING its incoming edge (no prior edge to rewire)", () => {
        // Detach finish-node first: it becomes a parentless orphan (no incoming edge).
        const parked = detach(seedBoard(), "finish-node")
        expect(parked.edges.some((e) => e[1] === "finish-node")).toBe(false)

        // Re-home it under plan-goal: reparent adds [plan-goal, finish-node] and nothing else stray.
        const next = reparent(parked, "finish-node", "plan-goal")
        expect(next.edges).toContainEqual(["plan-goal", "finish-node"])
        expect(next.edges.filter((e) => e[1] === "finish-node")).toHaveLength(1)
        // Tier lands one below the new parent; x/y untouched.
        expect(next.nodes["finish-node"]?.tier).toBe((parked.nodes["plan-goal"]?.tier ?? 0) + 1)
        expect(next.nodes["finish-node"]?.x).toBe(parked.nodes["finish-node"]?.x)
        expect(next.nodes["finish-node"]?.y).toBe(parked.nodes["finish-node"]?.y)
    })
})

// detach over the same seed tree: it drops one incoming edge and nothing else, leaving a parked orphan.
describe("detach", () => {
    it("removes only the incoming edge, keeping the node, its subtree, x/y, tiers, and todos", () => {
        const board = seedBoard()
        const tp = board.nodes["track-progress"] as Node
        // track-progress carries finish-node beneath it.
        const next = detach(board, "track-progress")
        // The one incoming edge is gone...
        expect(next.edges).not.toContainEqual(["learn", "track-progress"])
        // ...but the node, its subtree, that subtree's own edge, positions, tier, and checklists all stay.
        expect(next.nodes["track-progress"]).toBeDefined()
        expect(next.nodes["finish-node"]).toBeDefined()
        expect(next.edges).toContainEqual(["track-progress", "finish-node"])
        expect(next.nodes["track-progress"]?.x).toBe(tp.x)
        expect(next.nodes["track-progress"]?.y).toBe(tp.y)
        expect(next.nodes["track-progress"]?.tier).toBe(tp.tier)
        expect(next.todos["finish-node"]).toBeDefined()
    })

    it("keeps every mastered mark (losing a child can't break a parent's completeness)", () => {
        // g (root) -> a, both mastered by hand; detach a. Neither mark is cleared.
        const edges: Edge[] = [["g", "a"]]
        const board: Board = {
            id: "t",
            rootId: "g",
            nodes: { g: node("g", 0), a: node("a", 1) },
            edges,
            todos: {},
            mastered: new Set(["g", "a"])
        }
        const next = detach(board, "a")
        expect(next.edges).not.toContainEqual(["g", "a"])
        expect(next.mastered.has("a")).toBe(true)
        expect(next.mastered.has("g")).toBe(true)
    })

    it("is a no-op (same reference) for the root, an already-parentless node, and an unknown id", () => {
        const board = seedBoard()
        expect(detach(board, board.rootId)).toBe(board) // the root has no incoming edge
        const parked = detach(board, "track-progress")
        expect(detach(parked, "track-progress")).toBe(parked) // already parentless
        expect(detach(board, "nope")).toBe(board) // unknown id
    })
})

describe("addLinkedNode", () => {
    it("attaches an unlinked linked node child (targetBoardId null, no reward/checklist)", () => {
        const next = addLinkedNode(seedBoard(), "finish-node", "node-link")
        const link = next.nodes["node-link"]
        expect(link).toBeDefined()
        // Kind is positional: the targetBoardId key is present, and starts null (unlinked).
        expect(isLinkedNode(link as Node)).toBe(true)
        expect(link?.targetBoardId).toBeNull()
        // No reward / description of its own; positioned a tier below its parent, with the edge.
        expect(link?.reward).toBeUndefined()
        expect(link?.description).toBeUndefined()
        expect(link?.tier).toBe(3)
        expect(next.edges).toContainEqual(["finish-node", "node-link"])
    })

    it("un-completes the parent (and ancestors) when the fresh linked child is incomplete", () => {
        const board = completeNode(seedBoard(), "plan-goal", true, () => false)
        expect(board.mastered.has("plan-goal")).toBe(true)
        const next = addLinkedNode(board, "plan-goal", "node-link")
        expect(next.mastered.has("plan-goal")).toBe(false)
    })

    it("is a no-op (same reference) for an unknown parent", () => {
        const board = seedBoard()
        expect(addLinkedNode(board, "nope", "node-link")).toBe(board)
    })
})

describe("convertToLinkedNode", () => {
    it("reshapes a regular node into an unlinked linked node, dropping checklist / reward / mastery", () => {
        // break-steps is a mastered leaf with a checklist, under plan-goal.
        const before = seedBoard()
        const next = convertToLinkedNode(before, "break-steps")
        const node = next.nodes["break-steps"] as Node
        expect(isLinkedNode(node)).toBe(true)
        expect(node.targetBoardId).toBeNull()
        expect(node.reward).toBeUndefined()
        expect(next.todos["break-steps"]).toBeUndefined()
        expect(next.mastered.has("break-steps")).toBe(false)
        // Position and the incoming edge stay: it's the same node, relinked in kind.
        expect(node.x).toBe(before.nodes["break-steps"]?.x)
        expect(next.edges).toContainEqual(["plan-goal", "break-steps"])
    })

    it("keeps the subtree, converting only the node's kind", () => {
        // track-progress carries a child (finish-node); converting keeps the child and its edge.
        const next = convertToLinkedNode(seedBoard(), "track-progress")
        expect(isLinkedNode(next.nodes["track-progress"] as Node)).toBe(true)
        expect(next.nodes["finish-node"]).toBeDefined()
        expect(next.edges).toContainEqual(["track-progress", "finish-node"])
    })

    it("is a no-op (same reference) for the root, a linked node, or an unknown id", () => {
        const board = seedBoard()
        expect(convertToLinkedNode(board, board.rootId)).toBe(board)
        expect(convertToLinkedNode(board, "does-not-exist")).toBe(board)
        const withLinked = addLinkedNode(newBoard("a", "a-root", "A"), "a-root", "lk")
        expect(convertToLinkedNode(withLinked, "lk")).toBe(withLinked)
    })
})

describe("convertToRegularNode", () => {
    // A board with one (unlinked) linked node under its root.
    const withLinked = (): Board => addLinkedNode(newBoard("a", "a-root", "A"), "a-root", "lk")

    it("drops the targetBoardId key and gives a regular-node shape, keeping position and edge", () => {
        const next = convertToRegularNode(withLinked(), "lk")
        const node = next.nodes["lk"] as Node
        expect(isLinkedNode(node)).toBe(false)
        expect("targetBoardId" in node).toBe(false)
        expect(node.reward).toBe(DEFAULT_NODE_REWARD)
        expect(node.name).toBe("New Node") // a linked node's stored name is blank; convert supplies a default
        expect(next.edges).toContainEqual(["a-root", "lk"])
    })

    it("is a no-op (same reference) for a regular node or an unknown id", () => {
        const board = seedBoard()
        expect(convertToRegularNode(board, "break-steps")).toBe(board) // already regular
        expect(convertToRegularNode(board, "does-not-exist")).toBe(board)
    })

    it("round-trips with convertToLinkedNode (regular -> linked -> regular)", () => {
        const linked = convertToLinkedNode(seedBoard(), "break-steps")
        expect(isLinkedNode(linked.nodes["break-steps"] as Node)).toBe(true)
        const back = convertToRegularNode(linked, "break-steps")
        expect(isLinkedNode(back.nodes["break-steps"] as Node)).toBe(false)
        expect(back.nodes["break-steps"]?.reward).toBe(DEFAULT_NODE_REWARD)
    })

    it("refills name / description / reward / checklist from a restore snapshot", () => {
        const linked = convertToLinkedNode(seedBoard(), "break-steps")
        const restore = {
            name: "Break it down",
            description: "the steps",
            reward: 9,
            todos: [{ text: "step one", done: true }]
        }
        const next = convertToRegularNode(linked, "break-steps", restore)
        const node = next.nodes["break-steps"] as Node
        expect(isLinkedNode(node)).toBe(false)
        expect(node.name).toBe("Break it down")
        expect(node.description).toBe("the steps")
        expect(node.reward).toBe(9)
        expect(next.todos["break-steps"]).toEqual([{ text: "step one", done: true }])
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

describe("linkWouldCycle", () => {
    // Board A links to B; B and C each carry one (still unlinked) linked node.
    const boardsWithLinks = (): Boards => ({
        a: setLinkedTarget(addLinkedNode(newBoard("a", "a-root", "A"), "a-root", "a-link"), "a-link", "b"),
        b: addLinkedNode(newBoard("b", "b-root", "B"), "b-root", "b-link"),
        c: newBoard("c", "c-root", "C")
    })

    it("flags a self-link and a back-link that closes a loop, but allows a fresh target", () => {
        const boards = boardsWithLinks()
        expect(linkWouldCycle(boards, "a", "a")).toBe(true) // self-link
        expect(linkWouldCycle(boards, "b", "a")).toBe(true) // A -> B already, so B -> A cycles
        expect(linkWouldCycle(boards, "b", "c")).toBe(false) // B -> C is safe
        expect(linkWouldCycle(boards, "a", "b")).toBe(false) // A -> B again is not a cycle
    })

    it("detects a longer chain (A -> B -> C, so C -> A or C -> B cycles)", () => {
        const boards = boardsWithLinks()
        boards.b = setLinkedTarget(boards.b as Board, "b-link", "c") // now A -> B -> C
        expect(linkWouldCycle(boards, "c", "a")).toBe(true)
        expect(linkWouldCycle(boards, "c", "b")).toBe(true)
        expect(linkWouldCycle(boards, "a", "c")).toBe(false) // A -> C shortcut is still acyclic
    })
})

describe("boardsReducer setLinkedTarget cycle guard", () => {
    const linkedState = (): BoardsState => ({
        boards: {
            a: setLinkedTarget(addLinkedNode(newBoard("a", "a-root", "A"), "a-root", "a-link"), "a-link", "b"),
            b: addLinkedNode(newBoard("b", "b-root", "B"), "b-root", "b-link"),
            c: newBoard("c", "c-root", "C")
        },
        order: ["a", "b", "c"]
    })

    it("refuses a back-link that would cycle (same reference) but applies a safe target", () => {
        const s = linkedState()
        // A -> B exists, so pointing B's link back at A cycles -> refused, state unchanged.
        expect(boardsReducer(s, { type: "setLinkedTarget", boardId: "b", id: "b-link", targetBoardId: "a" })).toBe(s)
        // B -> C is acyclic, so it applies.
        const safe = boardsReducer(s, { type: "setLinkedTarget", boardId: "b", id: "b-link", targetBoardId: "c" })
        expect(safe).not.toBe(s)
        expect(safe.boards.b?.nodes["b-link"]?.targetBoardId).toBe("c")
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
        const next = completeNode(seedBoard(), "plan-goal", true, () => false)
        expect(next.mastered.has("plan-goal")).toBe(true)
    })

    it("refuses to complete while a box is unchecked (same reference)", () => {
        const board = seedBoard()
        expect(completeNode(board, "plan-goal", false, () => false)).toBe(board)
    })

    it("un-completes, cascading up so no completed parent keeps an incomplete child", () => {
        const board = completeNode(completeNode(seedBoard(), "plan-goal", true, () => false), "learn", false, () => false)
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
        const done = completeNode(open, "b-root", true, () => false)
        expect(boardComplete({ b: done }, "b")).toBe(true)
    })

    it("is false for an unknown board", () => {
        expect(boardComplete({}, "nope")).toBe(false)
    })

    it("boardCompleter binds a boards map into a reusable resolver", () => {
        const done = completeNode(newBoard("b", "b-root", "B"), "b-root", true, () => false)
        const resolve = boardCompleter({ b: done })
        expect(resolve("b")).toBe(true)
        expect(resolve("nope")).toBe(false)
    })
})

describe("boardGold", () => {
    it("sums each mastered node's reward, counting linked / reward-less / missing ids as zero", () => {
        const board: Board = {
            id: "g",
            rootId: "r",
            nodes: {
                r: { id: "r", name: "R", x: 0, y: 0, tier: 0, description: "", reward: 5 },
                c: { id: "c", name: "C", x: 0, y: 160, tier: 1, description: "", reward: 3 }, // not mastered
                link: { id: "link", name: "", x: 0, y: 160, tier: 1, targetBoardId: null } // linked: no reward
            },
            edges: [],
            todos: {},
            // r pays its 5; the reward-less linked node and a mastered id with no node record add nothing,
            // and the unmastered child `c` is not counted at all.
            mastered: new Set(["r", "link", "ghost"])
        }
        expect(boardGold(board)).toBe(5)
    })

    it("is zero for a board with nothing mastered", () => {
        expect(boardGold(newBoard("b", "b-root", "B"))).toBe(0)
    })

    it("excludes a mastered node's reward once it is detached (unreachable), counting it again after re-attach", () => {
        // g (root, not mastered) -> a (mastered, reward 3), so the board pays a's 3.
        const mk = (id: string, tier: number, reward: number): Node => ({ id, name: id, x: 0, y: tier * 160, tier, description: "", reward })
        const board: Board = {
            id: "g2",
            rootId: "g",
            nodes: { g: mk("g", 0, 5), a: mk("a", 1, 3) },
            edges: [["g", "a"]],
            todos: {},
            mastered: new Set(["a"])
        }
        expect(boardGold(board)).toBe(3)
        // Detach a: it keeps its mastered mark but, now unreachable from the root, stops paying gold.
        const parked = detach(board, "a")
        expect(parked.mastered.has("a")).toBe(true)
        expect(boardGold(parked)).toBe(0)
        // Re-home a under the root again: reachable once more, so its 3 gold returns (marks never lost).
        const rehomed = reparent(parked, "a", "g")
        expect(rehomed.mastered.has("a")).toBe(true)
        expect(boardGold(rehomed)).toBe(3)
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
        const ticked = toggleTodo(seedBoard(), "finish-node", 0)
        expect(ticked.todos["finish-node"]?.[0]?.done).toBe(true)
        const back = toggleTodo(ticked, "finish-node", 0)
        expect(back.todos["finish-node"]?.[0]?.done).toBe(false)
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

    it("routes a detach action through the detach op (drops only the incoming edge)", () => {
        const next = boardsReducer(state(), { type: "detach", boardId: "seed", id: "track-progress" })
        expect(next.boards.seed?.edges).not.toContainEqual(["learn", "track-progress"])
        // The node and its subtree stay put; only the incoming edge is gone.
        expect(next.boards.seed?.nodes["track-progress"]).toBeDefined()
        expect(next.boards.seed?.nodes["finish-node"]).toBeDefined()
        expect(next.boards.seed?.edges).toContainEqual(["track-progress", "finish-node"])
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

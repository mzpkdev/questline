import { decompressFromUTF16 } from "lz-string"
import { deserialize, loadState, PERSIST_VERSION, STORAGE_KEY, saveState, serialize } from "./persist"
import { seedBoard } from "./board"

const slices = () => ({
    boards: { seed: seedBoard() },
    boardOrder: ["seed"],
    tasks: [
        { id: "task-1", text: "Scout the trail", done: false, reward: 1 },
        { id: "task-2", text: "Gather moonpetals", done: true, reward: 1 }
    ],
    rewards: [
        { id: "reward-1", name: "Fancy coffee", price: 3 },
        { id: "reward-2", name: "Weekend trip", price: 40 }
    ],
    banked: { earned: 0, spent: 0 },
    notes: []
})

describe("persist", () => {
    beforeEach(() => localStorage.clear())

    it("round-trips the seed state, rebuilding mastered as a Set", () => {
        const back = deserialize(serialize(slices()))
        expect(back).not.toBeNull()
        expect(back?.boardOrder).toEqual(["seed"])
        const mastered = back?.boards.seed?.mastered
        expect(mastered).toBeInstanceOf(Set)
        expect(mastered?.has("break-steps")).toBe(true)
        // The seed board stores its nodes under `nodes` (v4), keyed by id.
        expect(back?.boards.seed?.nodes.learn?.name).toBe("Learn Questline")
    })

    it("round-trips the tasks list, ids and all", () => {
        const back = deserialize(serialize(slices()))
        expect(back?.tasks).toEqual([
            { id: "task-1", text: "Scout the trail", done: false, reward: 1 },
            { id: "task-2", text: "Gather moonpetals", done: true, reward: 1 }
        ])
    })

    it("preserves a completed task's completedAt timestamp", () => {
        const withCompletedAt = {
            ...slices(),
            tasks: [{ id: "task-1", text: "done one", done: true, completedAt: 1_700_000_000_000, reward: 1 }]
        }
        expect(deserialize(serialize(withCompletedAt))?.tasks[0]?.completedAt).toBe(1_700_000_000_000)
    })

    it("round-trips Draw notes, scene and all", () => {
        const withNotes = {
            ...slices(),
            notes: [{ id: "note-1", title: "Sketch", scene: { elements: [{ id: "a" }], appState: {}, files: {} }, updatedAt: 42 }]
        }
        expect(deserialize(serialize(withNotes))?.notes).toEqual(withNotes.notes)
    })

    it("defaults a missing notes list to empty (a pre-notes save)", () => {
        const legacy = JSON.parse(serialize(slices()))
        delete legacy.notes
        expect(deserialize(JSON.stringify(legacy))?.notes).toEqual([])
    })

    it("rejects a malformed note", () => {
        const valid = JSON.parse(serialize(slices()))
        // A note missing its scene is malformed and rejects the whole file.
        expect(deserialize(JSON.stringify({ ...valid, notes: [{ id: "note-1", title: "x", updatedAt: 1 }] }))).toBeNull()
    })

    it("stamps the current version", () => {
        expect(JSON.parse(serialize(slices())).version).toBe(PERSIST_VERSION)
        expect(PERSIST_VERSION).toBe(4)
        expect(STORAGE_KEY).toBe("questline:v4")
    })

    it("round-trips banked totals and rejects a file missing them", () => {
        const withBanked = { ...slices(), banked: { earned: 12, spent: 5 } }
        expect(deserialize(serialize(withBanked))?.banked).toEqual({ earned: 12, spent: 5 })

        // v4 requires banked: a file without it is rejected wholesale, not defaulted.
        const missing = JSON.parse(serialize(slices()))
        delete missing.banked
        expect(deserialize(JSON.stringify(missing))).toBeNull()
    })

    it("rejects non-JSON, a prior version, and malformed shapes as null (no migration, no salvage)", () => {
        expect(deserialize("not json")).toBeNull()
        // A prior-version file (v3) is ignored wholesale, even when otherwise well-shaped.
        expect(
            deserialize(JSON.stringify({ version: 3, boards: {}, boardOrder: [], tasks: [], rewards: [], banked: { earned: 0, spent: 0 } }))
        ).toBeNull()
        // A malformed board rejects the whole file.
        expect(
            deserialize(
                JSON.stringify({
                    version: PERSIST_VERSION,
                    boards: { x: {} },
                    boardOrder: [],
                    tasks: [],
                    rewards: [],
                    banked: { earned: 0, spent: 0 }
                })
            )
        ).toBeNull()
        // A single malformed task or reward, or a missing tasks field, rejects it.
        const valid = JSON.parse(serialize(slices()))
        expect(deserialize(JSON.stringify({ ...valid, rewards: [{ name: "no id", price: 5 }] }))).toBeNull()
        expect(deserialize(JSON.stringify({ ...valid, tasks: [{ text: "no id", done: false }] }))).toBeNull()
        expect(deserialize(JSON.stringify({ ...valid, tasks: undefined }))).toBeNull()
    })

    it("rejects a board whose node is malformed (strict isNode)", () => {
        const valid = JSON.parse(serialize(slices()))
        // A node with a non-numeric x is malformed and rejects the whole file (no salvage).
        valid.boards.seed.nodes.learn.x = "nope"
        expect(deserialize(JSON.stringify(valid))).toBeNull()
    })

    it("accepts an optional targetBoardId on a node (the v4 linked-node shape)", () => {
        const valid = JSON.parse(serialize(slices()))
        // Present-but-null and a board id are both valid; a wrong type rejects.
        valid.boards.seed.nodes.learn.targetBoardId = null
        expect(deserialize(JSON.stringify(valid))).not.toBeNull()
        valid.boards.seed.nodes.learn.targetBoardId = "board-x"
        expect(deserialize(JSON.stringify(valid))).not.toBeNull()
        valid.boards.seed.nodes.learn.targetBoardId = 5
        expect(deserialize(JSON.stringify(valid))).toBeNull()
    })

    it("saves to and loads from localStorage", () => {
        expect(loadState()).toBeNull()
        saveState(slices())
        expect(localStorage.getItem(STORAGE_KEY)).not.toBeNull()
        expect(loadState()?.boards.seed?.mastered).toBeInstanceOf(Set)
    })

    it("compresses the localStorage save", () => {
        saveState(slices())
        const stored = localStorage.getItem(STORAGE_KEY) ?? ""
        // The stored form is lz-string-packed, not raw JSON, and unpacks back to it.
        expect(stored).not.toBe(serialize(slices()))
        expect(decompressFromUTF16(stored)).toBe(serialize(slices()))
    })
})

import { deserialize, loadState, maxCounter, PERSIST_VERSION, STORAGE_KEY, saveState, serialize } from "./persist"
import { ROOT_ID, rootProject, seedProject } from "./project"

const slices = () => ({
    projects: { [ROOT_ID]: rootProject(), seed: seedProject() },
    order: [ROOT_ID, "seed"],
    mirrorPos: { "view-mirror-seed": { x: 10, y: 20 } },
    tasks: [
        { id: "task-1", text: "Scout the trail", done: false, reward: 1 },
        { id: "task-2", text: "Gather moonpetals", done: true, reward: 1 }
    ],
    rewards: [
        { id: "reward-1", name: "Fancy coffee", price: 3 },
        { id: "reward-2", name: "Weekend trip", price: 40 }
    ]
})

describe("persist", () => {
    beforeEach(() => localStorage.clear())

    it("round-trips the seed state, rebuilding mastered as a Set", () => {
        const back = deserialize(serialize(slices()))
        expect(back).not.toBeNull()
        expect(back?.order).toEqual([ROOT_ID, "seed"])
        expect(back?.mirrorPos["view-mirror-seed"]).toEqual({ x: 10, y: 20 })
        const mastered = back?.projects.seed?.mastered
        expect(mastered).toBeInstanceOf(Set)
        expect(mastered?.has("break-steps")).toBe(true)
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

    it("stamps the current version", () => {
        expect(JSON.parse(serialize(slices())).version).toBe(PERSIST_VERSION)
    })

    it("rejects non-JSON, wrong version, and malformed shapes as null", () => {
        expect(deserialize("not json")).toBeNull()
        expect(
            deserialize(JSON.stringify({ version: 999, projects: {}, order: [], mirrorPos: {}, tasks: [], rewards: [] }))
        ).toBeNull()
        // A malformed project rejects the whole file.
        expect(
            deserialize(
                JSON.stringify({
                    version: PERSIST_VERSION,
                    projects: { x: {} },
                    order: [],
                    mirrorPos: {},
                    tasks: [],
                    rewards: []
                })
            )
        ).toBeNull()
        // v2 is strict: a single malformed task or reward, or a missing tasks/rewards field, rejects it.
        const valid = JSON.parse(serialize(slices()))
        expect(deserialize(JSON.stringify({ ...valid, rewards: [{ name: "no id", price: 5 }] }))).toBeNull()
        expect(deserialize(JSON.stringify({ ...valid, tasks: [{ text: "no id", done: false }] }))).toBeNull()
        expect(deserialize(JSON.stringify({ ...valid, tasks: undefined }))).toBeNull()
    })

    it("saves to and loads from localStorage", () => {
        expect(loadState()).toBeNull()
        saveState(slices())
        expect(localStorage.getItem(STORAGE_KEY)).not.toBeNull()
        expect(loadState()?.projects.seed?.mastered).toBeInstanceOf(Set)
    })

    it("finds the highest counter and ignores suffixed ids", () => {
        expect(maxCounter(["node-1", "node-7", "node-3", "other"], "node")).toBe(7)
        expect(maxCounter(["view-2", "view-2-goal"], "view")).toBe(2)
        expect(maxCounter([], "node")).toBe(0)
    })
})

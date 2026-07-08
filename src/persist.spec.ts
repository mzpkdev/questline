import { deserialize, loadState, maxCounter, PERSIST_VERSION, STORAGE_KEY, saveState, serialize } from "./persist"
import { ROOT_ID, rootProject, seedProject } from "./project"

const slices = () => ({
    projects: { [ROOT_ID]: rootProject(), seed: seedProject() },
    order: [ROOT_ID, "seed"],
    mirrorPos: { "view-mirror-seed": { x: 10, y: 20 } },
    bounties: [
        { id: "bounty-1", text: "Scout the trail", done: false },
        { id: "bounty-2", text: "Gather moonpetals", done: true }
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

    it("round-trips the bounties list, ids and all", () => {
        const back = deserialize(serialize(slices()))
        expect(back?.bounties).toEqual([
            { id: "bounty-1", text: "Scout the trail", done: false },
            { id: "bounty-2", text: "Gather moonpetals", done: true }
        ])
    })

    it("preserves a completed bounty's completedAt timestamp", () => {
        const withCompletedAt = {
            ...slices(),
            bounties: [{ id: "bounty-1", text: "done one", done: true, completedAt: 1_700_000_000_000 }]
        }
        expect(deserialize(serialize(withCompletedAt))?.bounties[0]?.completedAt).toBe(1_700_000_000_000)
    })

    it("loads a pre-Bounties file (no bounties field) as an empty list, not a rejection", () => {
        const legacy = JSON.stringify({
            version: PERSIST_VERSION,
            projects: { [ROOT_ID]: { ...rootProject(), mastered: [] } },
            order: [ROOT_ID],
            mirrorPos: {}
        })
        const back = deserialize(legacy)
        expect(back).not.toBeNull()
        expect(back?.bounties).toEqual([])
    })

    it("round-trips the merchant shelf", () => {
        const back = deserialize(serialize(slices()))
        expect(back?.rewards).toEqual([
            { id: "reward-1", name: "Fancy coffee", price: 3 },
            { id: "reward-2", name: "Weekend trip", price: 40 }
        ])
    })

    it("preserves a redeemed reward's redeemedAt timestamp", () => {
        const withRedeemed = {
            ...slices(),
            rewards: [{ id: "reward-1", name: "Fancy coffee", price: 3, redeemedAt: 1_700_000_000_000 }]
        }
        expect(deserialize(serialize(withRedeemed))?.rewards[0]?.redeemedAt).toBe(1_700_000_000_000)
    })

    it("loads a pre-Merchant file (no rewards) as an empty shelf", () => {
        const wire = JSON.parse(serialize(slices()))
        wire.rewards = undefined
        const back = deserialize(JSON.stringify(wire))
        expect(back?.rewards).toEqual([])
    })

    it("drops malformed rewards and clamps prices, backfilling missing ids", () => {
        const wire = JSON.parse(serialize(slices()))
        wire.rewards = [
            { name: "no id", price: 5 },
            { id: "reward-9", name: "cheap", price: 0 },
            { name: 5, price: 3 },
            null
        ]
        const back = deserialize(JSON.stringify(wire))
        expect(back?.rewards).toEqual([
            { id: "reward-10", name: "no id", price: 5 },
            { id: "reward-9", name: "cheap", price: 1 }
        ])
    })

    it("drops malformed bounty entries rather than rejecting the file", () => {
        const wire = JSON.parse(serialize(slices()))
        wire.bounties = [{ id: "bounty-1", text: "keep", done: false }, { text: 5, done: false }, "nope", null]
        const back = deserialize(JSON.stringify(wire))
        expect(back?.bounties).toEqual([{ id: "bounty-1", text: "keep", done: false }])
    })

    it("backfills ids for bounties saved before ids existed, resuming past any present", () => {
        const wire = JSON.parse(serialize(slices()))
        wire.bounties = [
            { text: "no id one", done: false },
            { id: "bounty-5", text: "has id", done: true },
            { text: "no id two", done: false }
        ]
        const ids = deserialize(JSON.stringify(wire))?.bounties.map((b) => b.id)
        expect(ids).toEqual(["bounty-6", "bounty-5", "bounty-7"])
    })

    it("stamps the current version", () => {
        expect(JSON.parse(serialize(slices())).version).toBe(PERSIST_VERSION)
    })

    it("rejects non-JSON, wrong version, and malformed shapes as null", () => {
        expect(deserialize("not json")).toBeNull()
        expect(deserialize(JSON.stringify({ version: 999, projects: {}, order: [], mirrorPos: {} }))).toBeNull()
        expect(
            deserialize(JSON.stringify({ version: PERSIST_VERSION, projects: { x: {} }, order: [], mirrorPos: {} }))
        ).toBeNull()
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

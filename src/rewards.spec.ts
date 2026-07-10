import { compact, REDEEMED_TTL_MS } from "./rewards"
import { DONE_TTL_MS } from "./tasks"

// A clock well past both 14-day windows, so ages are computed against a stable "now".
const now = 100 * 24 * 60 * 60 * 1000

describe("compact", () => {
    it("banks a task done past its window into earned and drops the record", () => {
        const tasks = [{ id: "t1", text: "old", done: true, completedAt: now - DONE_TTL_MS - 1, reward: 2 }]
        const out = compact(tasks, [], { earned: 0, spent: 0 }, now)
        expect(out.banked.earned).toBe(2)
        expect(out.tasks).toEqual([])
    })

    it("keeps a task exactly at the window edge, banks one just past it", () => {
        const tasks = [
            { id: "edge", text: "edge", done: true, completedAt: now - DONE_TTL_MS, reward: 5 }, // == TTL: kept
            { id: "past", text: "past", done: true, completedAt: now - DONE_TTL_MS - 1, reward: 7 } // > TTL: banked
        ]
        const out = compact(tasks, [], { earned: 0, spent: 0 }, now)
        expect(out.tasks.map((t) => t.id)).toEqual(["edge"])
        expect(out.banked.earned).toBe(7)
    })

    it("keeps open tasks and done tasks with no timestamp, untouched", () => {
        const tasks = [
            { id: "open", text: "open", done: false, reward: 3 },
            { id: "legacy", text: "legacy", done: true, reward: 4 } // done before completedAt was tracked
        ]
        const out = compact(tasks, [], { earned: 0, spent: 0 }, now)
        expect(out.tasks).toBe(tasks)
        expect(out.banked).toEqual({ earned: 0, spent: 0 })
    })

    it("banks a reward redeemed past its window into spent, keeps recent and unredeemed ones", () => {
        const rewards = [
            { id: "r1", name: "old buy", price: 8, redeemedAt: now - REDEEMED_TTL_MS - 1 }, // banked
            { id: "r2", name: "recent buy", price: 3, redeemedAt: now - REDEEMED_TTL_MS + 1 }, // kept
            { id: "r3", name: "unbought", price: 5 } // kept
        ]
        const out = compact([], rewards, { earned: 0, spent: 0 }, now)
        expect(out.rewards.map((r) => r.id)).toEqual(["r2", "r3"])
        expect(out.banked.spent).toBe(8)
    })

    it("adds onto the running banked totals rather than replacing them", () => {
        const tasks = [{ id: "t", text: "t", done: true, completedAt: 0, reward: 2 }]
        const rewards = [{ id: "r", name: "r", price: 9, redeemedAt: 0 }]
        const out = compact(tasks, rewards, { earned: 10, spent: 4 }, now)
        expect(out.banked).toEqual({ earned: 12, spent: 13 })
    })

    it("is a no-op, returning the same references, when nothing is past its window", () => {
        const tasks = [{ id: "t", text: "t", done: true, completedAt: now, reward: 1 }]
        const rewards = [{ id: "r", name: "r", price: 2, redeemedAt: now }]
        const banked = { earned: 3, spent: 3 }
        const out = compact(tasks, rewards, banked, now)
        expect(out.tasks).toBe(tasks)
        expect(out.rewards).toBe(rewards)
        expect(out.banked).toBe(banked)
    })
})

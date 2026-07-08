import { addBounty, type Bounty, DONE_TTL_MS, remove, reorder, SEED_BOUNTIES, toggle, visible } from "./bounties"

const NOW = 1_700_000_000_000

const list = (): Bounty[] => [
    { id: "b1", text: "one", done: false },
    { id: "b2", text: "two", done: true, completedAt: NOW }
]

const three = (): Bounty[] => [
    { id: "b1", text: "one", done: false },
    { id: "b2", text: "two", done: false },
    { id: "b3", text: "three", done: false }
]

describe("bounties", () => {
    context("addBounty", () => {
        it("appends a new, incomplete bounty with the given id", () => {
            expect(addBounty([{ id: "b1", text: "one", done: false }], "b2", "two")).toEqual([
                { id: "b1", text: "one", done: false },
                { id: "b2", text: "two", done: false }
            ])
        })

        it("trims surrounding whitespace", () => {
            expect(addBounty([], "b1", "  hunt the wyrm  ")).toEqual([{ id: "b1", text: "hunt the wyrm", done: false }])
        })

        it("ignores blank text, keeping the same reference", () => {
            const before = three()
            expect(addBounty(before, "b4", "   ")).toBe(before)
        })
    })

    context("toggle", () => {
        it("checks an open bounty and stamps completedAt with now", () => {
            expect(toggle(list(), "b1", NOW)).toEqual([
                { id: "b1", text: "one", done: true, completedAt: NOW },
                { id: "b2", text: "two", done: true, completedAt: NOW }
            ])
        })

        it("re-opens a done bounty and clears its completedAt", () => {
            expect(toggle(list(), "b2", NOW + 5)).toEqual([
                { id: "b1", text: "one", done: false },
                { id: "b2", text: "two", done: false }
            ])
        })

        it("is a no-op keeping the reference for an unknown id", () => {
            const before = list()
            expect(toggle(before, "nope", NOW)).toBe(before)
        })
    })

    context("remove", () => {
        it("drops the bounty with the id", () => {
            expect(remove(list(), "b1")).toEqual([{ id: "b2", text: "two", done: true, completedAt: NOW }])
        })

        it("is a no-op keeping the reference for an unknown id", () => {
            const before = list()
            expect(remove(before, "nope")).toBe(before)
        })
    })

    context("reorder", () => {
        it("moves an item down to a later position", () => {
            expect(reorder(three(), "b1", "b3").map((b) => b.id)).toEqual(["b2", "b3", "b1"])
        })

        it("moves an item up to an earlier position", () => {
            expect(reorder(three(), "b3", "b1").map((b) => b.id)).toEqual(["b3", "b1", "b2"])
        })

        it("is a no-op keeping the reference for equal or unknown ids", () => {
            const before = three()
            expect(reorder(before, "b2", "b2")).toBe(before)
            expect(reorder(before, "b1", "nope")).toBe(before)
        })

        it("does not mutate the input list", () => {
            const before = three()
            reorder(before, "b1", "b3")
            expect(before.map((b) => b.id)).toEqual(["b1", "b2", "b3"])
        })
    })

    context("visible", () => {
        it("keeps open and recently done bounties, hiding stale completions", () => {
            const l: Bounty[] = [
                { id: "open", text: "open", done: false },
                { id: "fresh", text: "fresh", done: true, completedAt: NOW - DONE_TTL_MS + 1000 },
                { id: "stale", text: "stale", done: true, completedAt: NOW - DONE_TTL_MS - 1000 }
            ]
            expect(visible(l, NOW).map((b) => b.id)).toEqual(["open", "fresh"])
        })

        it("shows a done bounty that has no timestamp", () => {
            expect(visible([{ id: "old", text: "old", done: true }], NOW).map((b) => b.id)).toEqual(["old"])
        })

        it("treats a completion exactly ttl old as still visible", () => {
            const edge: Bounty[] = [{ id: "edge", text: "edge", done: true, completedAt: NOW - DONE_TTL_MS }]
            expect(visible(edge, NOW)).toHaveLength(1)
        })
    })

    it("ships a non-empty seed with distinct ids", () => {
        expect(SEED_BOUNTIES.length).toBeGreaterThan(0)
        expect(new Set(SEED_BOUNTIES.map((b) => b.id)).size).toBe(SEED_BOUNTIES.length)
    })
})

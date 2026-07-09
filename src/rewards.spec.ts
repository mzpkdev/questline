import {
    addReward,
    TASK_GOLD,
    earnedGold,
    redeem,
    REDEEMED_TTL_MS,
    removeReward,
    type Reward,
    SEED_REWARDS,
    spentGold,
    visible
} from "./rewards"
import { DEFAULT_GOAL_REWARD, DEFAULT_NODE_REWARD, type Milestone, type Todo } from "./milestones"
import { newProject, type Project, ROOT_ID, rootProject } from "./project"

const list = (): Reward[] => [
    { id: "reward-1", name: "Coffee", price: 3 },
    { id: "reward-2", name: "Book", price: 8 }
]

// A non-root project whose goal + the given extra ids are all mastered, with optional checklists. Each
// extra id gets a real milestone record carrying the default node reward, so earnedGold reads it off
// the node (the goal already exists from newProject with the default goal reward).
const projectWith = (id: string, mastered: string[], todos: Record<string, Todo[]> = {}): Project => {
    const base = newProject(id, id, ROOT_ID)
    const milestones = { ...base.milestones }
    for (const mid of mastered) {
        if (!milestones[mid]) {
            milestones[mid] = {
                id: mid,
                name: mid,
                tag: "Step",
                x: 0,
                y: 0,
                tier: 1,
                branch: "b",
                description: "",
                reward: DEFAULT_NODE_REWARD
            }
        }
    }
    return { ...base, milestones, mastered: new Set(mastered), todos }
}

describe("rewards", () => {
    context("addReward", () => {
        it("appends a reward with the given id", () => {
            expect(addReward(list(), "reward-3", "Snack", 4)).toEqual([
                { id: "reward-1", name: "Coffee", price: 3 },
                { id: "reward-2", name: "Book", price: 8 },
                { id: "reward-3", name: "Snack", price: 4 }
            ])
        })

        it("trims the name and rounds the price to a whole number", () => {
            expect(addReward([], "reward-1", "  Movie night  ", 9.6)).toEqual([
                { id: "reward-1", name: "Movie night", price: 10 }
            ])
        })

        it("clamps a zero, negative, or non-numeric price up to 1", () => {
            expect(addReward([], "reward-1", "Free", 0)[0]?.price).toBe(1)
            expect(addReward([], "reward-1", "Owed", -5)[0]?.price).toBe(1)
            expect(addReward([], "reward-1", "Junk", Number.NaN)[0]?.price).toBe(1)
        })

        it("stores the auto-replenish flag when set", () => {
            expect(addReward([], "reward-1", "Coffee", 3, true)).toEqual([
                { id: "reward-1", name: "Coffee", price: 3, replenish: true }
            ])
        })

        it("ignores a blank name, keeping the same reference", () => {
            const before = list()
            expect(addReward(before, "reward-3", "   ", 5)).toBe(before)
        })

        it("does not mutate the input list", () => {
            const before = list()
            addReward(before, "reward-3", "Snack", 4)
            expect(before).toHaveLength(2)
        })
    })

    context("removeReward", () => {
        it("drops the reward with the id", () => {
            expect(removeReward(list(), "reward-1")).toEqual([{ id: "reward-2", name: "Book", price: 8 }])
        })

        it("is a no-op keeping the reference for an unknown id", () => {
            const before = list()
            expect(removeReward(before, "nope")).toBe(before)
        })
    })

    context("redeem", () => {
        it("stamps redeemedAt when the balance covers the price", () => {
            const out = redeem(list(), "reward-1", 10, 1_700_000_000_000, "reward-9")
            expect(out[0]).toEqual({ id: "reward-1", name: "Coffee", price: 3, redeemedAt: 1_700_000_000_000 })
            expect(out[1]).toEqual({ id: "reward-2", name: "Book", price: 8 }) // others untouched
        })

        it("buys at an exactly-sufficient balance", () => {
            expect(redeem(list(), "reward-2", 8, 5, "reward-9")[1]?.redeemedAt).toBe(5)
        })

        it("is a no-op keeping the reference when unaffordable, already redeemed, or unknown", () => {
            const before = list()
            expect(redeem(before, "reward-2", 5, 1, "reward-9")).toBe(before) // 5 < 8
            expect(redeem(before, "nope", 100, 1, "reward-9")).toBe(before) // unknown id
            const once = redeem(before, "reward-1", 10, 1, "reward-9")
            expect(redeem(once, "reward-1", 10, 2, "reward-8")).toBe(once) // already redeemed
        })

        it("does not spawn a copy for a non-replenishing reward", () => {
            expect(redeem(list(), "reward-1", 10, 1, "reward-9")).toHaveLength(2)
        })

        it("spawns a fresh unredeemed copy right after a replenishing reward", () => {
            const shelf: Reward[] = [{ id: "reward-1", name: "Coffee", price: 3, replenish: true }]
            expect(redeem(shelf, "reward-1", 10, 100, "reward-2")).toEqual([
                { id: "reward-1", name: "Coffee", price: 3, replenish: true, redeemedAt: 100 },
                { id: "reward-2", name: "Coffee", price: 3, replenish: true }
            ])
        })
    })

    context("spentGold", () => {
        it("sums the price of redeemed rewards only", () => {
            const shelf: Reward[] = [
                { id: "reward-1", name: "Coffee", price: 3, redeemedAt: 1 },
                { id: "reward-2", name: "Book", price: 8 },
                { id: "reward-3", name: "Trip", price: 40, redeemedAt: 2 }
            ]
            expect(spentGold(shelf)).toBe(43)
        })

        it("is zero with nothing redeemed", () => {
            expect(spentGold(list())).toBe(0)
        })
    })

    context("visible", () => {
        it("keeps unredeemed rewards and ones redeemed within the TTL, drops older redemptions", () => {
            const now = 1_000_000_000_000
            const shelf: Reward[] = [
                { id: "reward-1", name: "Open", price: 3 },
                { id: "reward-2", name: "Fresh", price: 8, redeemedAt: now - REDEEMED_TTL_MS + 1_000 },
                { id: "reward-3", name: "Stale", price: 5, redeemedAt: now - REDEEMED_TTL_MS - 1_000 }
            ]
            expect(visible(shelf, now).map((r) => r.id)).toEqual(["reward-1", "reward-2"])
        })

        it("keeps a redemption exactly at the TTL boundary", () => {
            const now = 1_000_000_000_000
            const shelf: Reward[] = [{ id: "reward-1", name: "Edge", price: 3, redeemedAt: now - REDEEMED_TTL_MS }]
            expect(visible(shelf, now)).toHaveLength(1)
        })
    })

    context("earnedGold", () => {
        it("pays the default node reward per completed step and goal reward per completed goal", () => {
            const projects = { a: projectWith("a", ["a-goal", "n1", "n2"]) }
            expect(earnedGold(projects, [])).toBe(DEFAULT_GOAL_REWARD + 2 * DEFAULT_NODE_REWARD)
        })

        it("pays a milestone's own reward when set, not the default", () => {
            const base = newProject("a", "a", ROOT_ID)
            const goal = base.milestones[base.goalId] as Milestone
            const step: Milestone = { id: "n1", name: "Step", tag: "Step", x: 0, y: 0, tier: 1, branch: "b", description: "", reward: 7 }
            const project: Project = {
                ...base,
                milestones: { ...base.milestones, [base.goalId]: { ...goal, reward: 10 }, n1: step },
                mastered: new Set([base.goalId, "n1"])
            }
            expect(earnedGold({ a: project }, [])).toBe(17)
        })

        it("pays nothing for ticked checklist boxes on a milestone", () => {
            const projects = {
                a: projectWith("a", [], {
                    n1: [
                        { text: "x", done: true },
                        { text: "y", done: false },
                        { text: "z", done: true }
                    ]
                })
            }
            expect(earnedGold(projects, [])).toBe(0)
        })

        it("pays TASK_GOLD per done task in the to-do list", () => {
            const tasks = [
                { id: "b1", text: "one", done: true },
                { id: "b2", text: "two", done: false },
                { id: "b3", text: "three", done: true }
            ]
            expect(earnedGold({}, tasks)).toBe(2 * TASK_GOLD)
        })

        it("skips the Root hub, so its node never mints gold", () => {
            const root = { ...rootProject(), mastered: new Set(["root-goal"]) }
            expect(earnedGold({ [ROOT_ID]: root }, [])).toBe(0)
        })

        it("sums tasks, milestones, and goals together", () => {
            const projects = {
                [ROOT_ID]: rootProject(),
                a: projectWith("a", ["n1"]),
                b: projectWith("b", ["b-goal"])
            }
            const tasks = [{ id: "b1", text: "one", done: true }]
            expect(earnedGold(projects, tasks)).toBe(DEFAULT_NODE_REWARD + DEFAULT_GOAL_REWARD + TASK_GOLD)
        })

        it("is zero with nothing completed", () => {
            expect(earnedGold({ a: projectWith("a", []) }, [])).toBe(0)
        })
    })

    it("ships a non-empty seed with distinct ids", () => {
        expect(SEED_REWARDS.length).toBeGreaterThan(0)
        expect(new Set(SEED_REWARDS.map((r) => r.id)).size).toBe(SEED_REWARDS.length)
    })
})

// The Rewards (shop): spend gold earned on the roadmap. Like tasks.ts, the pure model + list ops
// live here (framework-free, unit-tested) while App holds the state and persist.ts carries it across
// reloads. Gold itself is never stored -- it is *earned* from progress (earnedGold) minus what has
// been spent (spentGold), so doing the work fills the purse. Rewards are entered by hand (a name and a
// price) and bought once: redeeming stamps `redeemedAt`, which both spends the gold and starts a 14-day
// window after which the redeemed tile drops off the shelf (mirroring a completed task's auto-hide).

import type { Task } from "./tasks"
import { type Project, ROOT_ID } from "./project"

// A reward is a name and a price in gold. Ids are minted like node/view/task ids (`reward-N`) so a
// React key and a removal track the item, not its position.
export type Reward = {
    id: string
    name: string
    price: number
    // Epoch ms of the redemption. Set when bought (a one-off), so spent gold and the 14-day auto-hide
    // both key off it. Absent while unredeemed.
    redeemedAt?: number
    // When set, redeeming this reward drops a fresh unredeemed copy back on the shelf, so a treat you
    // want on tap restocks itself instead of being spent for good.
    replenish?: boolean
}

// How long a redeemed reward lingers on the shelf before it drops off: 14 days (mirrors tasks).
export const REDEEMED_TTL_MS = 14 * 24 * 60 * 60 * 1000

// First-run shop so the shelves aren't bare on a fresh install: three everyday treats a regular person
// might reward themselves with, cheap to dear. Shown only until the user edits their own list.
export const SEED_REWARDS: Reward[] = [
    { id: "reward-1", name: "Fancy coffee", price: 3 },
    { id: "reward-2", name: "Takeout dinner", price: 8 },
    { id: "reward-3", name: "Movie night", price: 12 }
]

// Total gold earned: across every roadmap, each completed milestone (and mastered tier-0 goal) pays
// its own `reward`, and each done task in the app-level to-do list pays its own `reward`. A mastered
// id with no surviving milestone record contributes nothing. The Root hub is skipped -- it's the home
// for views, not real work, so its lone node never mints gold.
export function earnedGold(projects: Record<string, Project>, tasks: Task[]): number {
    let total = 0
    for (const [id, project] of Object.entries(projects)) {
        if (id === ROOT_ID) continue
        for (const masteredId of project.mastered) {
            const milestone = project.milestones[masteredId]
            if (milestone) total += milestone.reward
        }
    }
    for (const task of tasks) if (task.done) total += task.reward
    return total
}

// Append a reward with the given id. Blank / whitespace-only names are ignored (same reference back),
// and the price is coerced to a whole number of at least 1, so the shelf never grows a nameless or
// free item. `replenish` marks it as a restocking reward (a fresh copy respawns on redemption).
export function addReward(list: Reward[], id: string, name: string, price: number, replenish = false): Reward[] {
    const trimmed = name.trim()
    if (!trimmed) return list
    const clamped = Math.max(1, Math.round(price) || 1)
    return [...list, { id, name: trimmed, price: clamped, ...(replenish ? { replenish: true } : {}) }]
}

// Drop the reward with this id; an unknown id is a no-op that keeps the reference.
export function removeReward(list: Reward[], id: string): Reward[] {
    const next = list.filter((reward) => reward.id !== id)
    return next.length === list.length ? list : next
}

// Redeem a reward by id: a one-off buy that stamps `redeemedAt` with `now`, but only when it is still
// unredeemed and the balance covers the price. An unaffordable, already-redeemed, or unknown id keeps
// the same reference. Gold isn't mutated here; the caller derives the balance from spentGold. A
// `replenish` reward also drops a fresh unredeemed copy (with `replenishId`) right after it, so it stays
// available while the spent one lingers out its 14-day window.
export function redeem(list: Reward[], id: string, gold: number, now: number, replenishId: string): Reward[] {
    const index = list.findIndex((r) => r.id === id)
    const reward = index === -1 ? undefined : list[index]
    if (!reward || reward.redeemedAt !== undefined || gold < reward.price) return list
    const next = list.map((r) => (r.id === id ? { ...r, redeemedAt: now } : r))
    if (reward.replenish) {
        next.splice(index + 1, 0, { id: replenishId, name: reward.name, price: reward.price, replenish: true })
    }
    return next
}

// Total gold spent: the price of every redeemed reward, counting ones that have aged off the shelf so a
// spend is never refunded when its tile disappears.
export function spentGold(list: Reward[]): number {
    let total = 0
    for (const reward of list) if (reward.redeemedAt !== undefined) total += reward.price
    return total
}

// The rewards to show: every unredeemed one, plus redeemed ones bought within the last `ttlMs`. Older
// redemptions drop off the shelf but stay in state (so their spent gold is kept).
export function visible(list: Reward[], now: number, ttlMs = REDEEMED_TTL_MS): Reward[] {
    return list.filter((reward) => reward.redeemedAt === undefined || now - reward.redeemedAt <= ttlMs)
}

// The Rewards (shop): spend gold earned on the roadmap. Like tasks.ts, the pure model + list ops
// live here (framework-free, unit-tested) while App holds the state and persist.ts carries it across
// reloads. Gold itself is never stored -- it is *earned* from progress (earnedGold) minus what has
// been spent (spentGold), so doing the work fills the purse. Rewards are entered by hand (a name and a
// price) and bought once: redeeming stamps `redeemedAt`, which both spends the gold and starts a 14-day
// window after which the redeemed tile drops off the shelf (mirroring a completed task's auto-hide).

import { DONE_TTL_MS, type Task } from "./tasks"
import type { Board } from "./board"

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

// Defaults for a reward created straight from the shelf's + tile (then edited in its card).
export const DEFAULT_REWARD_NAME = "New Reward"
export const DEFAULT_REWARD_PRICE = 5

// First-run shop so the shelves aren't bare on a fresh install: three everyday treats a regular person
// might reward themselves with, cheap to dear. Shown only until the user edits their own list.
export const SEED_REWARDS: Reward[] = [
    { id: "reward-1", name: "Fancy coffee", price: 3 },
    { id: "reward-2", name: "Takeout dinner", price: 8 },
    { id: "reward-3", name: "Movie night", price: 12 }
]

// Total gold earned: across every board, each mastered node (including a mastered tier-0 root node)
// pays its own `reward`, and each done task in the app-level to-do list pays its own `reward`. A
// mastered id with no surviving node record (or a reward-less linked node, from Phase 2) contributes
// nothing. Boards are equal now -- there is no Root hub to skip.
export function earnedGold(boards: Record<string, Board>, tasks: Task[]): number {
    let total = 0
    for (const board of Object.values(boards)) {
        for (const masteredId of board.mastered) {
            total += board.nodes[masteredId]?.reward ?? 0
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

// Edit a reward's name, price, and/or replenish flag by id. Name is taken as given (trimming is an
// add-time concern, matching tasks.edit), price is clamped to a whole number of at least 1 (as in
// addReward), and replenish toggles the flag (dropping it entirely when off). An unknown id keeps the
// same reference.
export function editReward(
    list: Reward[],
    id: string,
    patch: { name?: string; price?: number; replenish?: boolean }
): Reward[] {
    if (!list.some((reward) => reward.id === id)) return list
    return list.map((reward) => {
        if (reward.id !== id) return reward
        const next = { ...reward }
        if (patch.name !== undefined) next.name = patch.name
        if (patch.price !== undefined) next.price = Math.max(1, Math.round(patch.price) || 1)
        if (patch.replenish !== undefined) {
            if (patch.replenish) next.replenish = true
            else delete next.replenish
        }
        return next
    })
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

// Un-redeem a reward by id: clears its `redeemedAt` so it leaves spentGold and its gold returns to the
// purse, back to an ordinary unredeemed tile. A not-redeemed or unknown id keeps the same reference.
export function unredeem(list: Reward[], id: string): Reward[] {
    const reward = list.find((r) => r.id === id)
    if (!reward || reward.redeemedAt === undefined) return list
    return list.map((r) => {
        if (r.id !== id) return r
        const next = { ...r }
        delete next.redeemedAt
        return next
    })
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

// Running totals of gold earned / spent by records that have since been pruned. Kept so the balance
// survives compaction: gold = banked.earned + earnedGold(live tasks) - (banked.spent + spentGold(live)).
export type Banked = { earned: number; spent: number }

// Fold every task/reward already past its 14-day window into the banked totals, then drop those records.
// The visible ops (tasks.visible / visible above) already hide them, and earnedGold/spentGold sum only
// survivors, so the totals cover the rest and the balance is unchanged -- state just stops growing. Only
// prunes what is already invisible (strictly past its TTL), and returns the same references when there is
// nothing old enough to drop, so callers can skip a needless update.
export function compact(
    tasks: Task[],
    rewards: Reward[],
    banked: Banked,
    now: number,
    taskTtlMs = DONE_TTL_MS,
    rewardTtlMs = REDEEMED_TTL_MS
): { tasks: Task[]; rewards: Reward[]; banked: Banked } {
    let earned = banked.earned
    let spent = banked.spent
    const keptTasks = tasks.filter((task) => {
        if (task.done && task.completedAt !== undefined && now - task.completedAt > taskTtlMs) {
            earned += task.reward
            return false
        }
        return true
    })
    const keptRewards = rewards.filter((reward) => {
        if (reward.redeemedAt !== undefined && now - reward.redeemedAt > rewardTtlMs) {
            spent += reward.price
            return false
        }
        return true
    })
    if (keptTasks.length === tasks.length && keptRewards.length === rewards.length) {
        return { tasks, rewards, banked }
    }
    return { tasks: keptTasks, rewards: keptRewards, banked: { earned, spent } }
}

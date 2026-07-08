// The Bounties list: a flat, app-level checklist reached from the Bounties chip in the tab bar. It's
// the roadmap's sibling view (mockup: todo.html) -- unlike a milestone's per-node checklist, these
// bounties stand alone, not tied to any node, and there is one list for the whole app. The pure list
// ops live here (like graph.ts) so they unit-test without React; App holds the state and persist.ts
// carries it across reloads.

// Each bounty carries a stable id (`bounty-N`, minted like node/view ids) so drag-reordering and
// React keys track the item, not its position. `completedAt` records when it was checked off, which drives
// the 14-day auto-hide of completed bounties.
export type Bounty = {
    id: string
    text: string
    done: boolean
    // Epoch ms of the flip to done. Set when checked off, cleared when re-opened (so re-completing
    // restarts the window). Absent on bounties completed before this was tracked.
    completedAt?: number
}

// How long a completed bounty stays on the board before it drops off: 14 days.
export const DONE_TTL_MS = 14 * 24 * 60 * 60 * 1000

// A tiny first-run tutorial, like the sample roadmap's self-teaching nodes: three bounties whose text
// explains the view itself (checking one off, dragging to reorder, adding and removing). Shown only
// on a truly fresh start, and replaced the moment the user edits their own list.
export const SEED_BOUNTIES: Bounty[] = [
    { id: "bounty-1", text: "Tick a bounty to complete it and earn gold toward the Merchant.", done: false },
    { id: "bounty-2", text: "Grab the handle on the left to drag a bounty into any order.", done: false },
    { id: "bounty-3", text: "Add your own above, and hover a bounty to remove it.", done: false }
]

// Append a new bounty with the given id. Blank / whitespace-only text is ignored (returns the same
// list), so the board never grows an empty tile.
export function addBounty(list: Bounty[], id: string, text: string): Bounty[] {
    const trimmed = text.trim()
    return trimmed ? [...list, { id, text: trimmed, done: false }] : list
}

// Flip one bounty by id. Checking it off stamps `completedAt` with `now`; re-opening drops the stamp so a
// later re-completion restarts its 14-day window. An unknown id keeps the same reference.
export function toggle(list: Bounty[], id: string, now: number): Bounty[] {
    if (!list.some((bounty) => bounty.id === id)) return list
    return list.map((bounty) => {
        if (bounty.id !== id) return bounty
        return bounty.done ? { id: bounty.id, text: bounty.text, done: false } : { ...bounty, done: true, completedAt: now }
    })
}

// Drop one bounty by id; an unknown id keeps the reference.
export function remove(list: Bounty[], id: string): Bounty[] {
    const next = list.filter((bounty) => bounty.id !== id)
    return next.length === list.length ? list : next
}

// Move `activeId` to sit where `overId` is, sliding the rest along. A no-op (same reference) when the
// ids match or either is unknown. Works on the full list by id, so hidden (expired) bounties keep
// their place while visible ones shuffle around them.
export function reorder(list: Bounty[], activeId: string, overId: string): Bounty[] {
    if (activeId === overId) return list
    const from = list.findIndex((bounty) => bounty.id === activeId)
    const to = list.findIndex((bounty) => bounty.id === overId)
    if (from === -1 || to === -1) return list
    const next = list.slice()
    const [moved] = next.splice(from, 1)
    if (!moved) return list
    next.splice(to, 0, moved)
    return next
}

// The bounties to show: every open one, plus completed ones checked off within the last `ttlMs`.
// Older completions drop off the board but stay in state (so their earned gold is kept). A done
// bounty with no timestamp (completed before this was tracked) is always shown.
export function visible(list: Bounty[], now: number, ttlMs = DONE_TTL_MS): Bounty[] {
    return list.filter((bounty) => !bounty.done || bounty.completedAt === undefined || now - bounty.completedAt <= ttlMs)
}

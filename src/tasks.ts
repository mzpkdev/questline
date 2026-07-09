// The Tasks list: a flat, app-level checklist reached from the Tasks chip in the tab bar. It's
// the roadmap's sibling view (mockup: todo.html) -- unlike a milestone's per-node checklist, these
// tasks stand alone, not tied to any node, and there is one list for the whole app. The pure list
// ops live here (like graph.ts) so they unit-test without React; App holds the state and persist.ts
// carries it across reloads.

// Each task carries a stable id (`task-N`, minted like node/view ids) so drag-reordering and
// React keys track the item, not its position. `completedAt` records when it was checked off, which drives
// the 14-day auto-hide of completed tasks.
export type Task = {
    id: string
    text: string
    done: boolean
    // Epoch ms of the flip to done. Set when checked off, cleared when re-opened (so re-completing
    // restarts the window). Absent on tasks completed before this was tracked.
    completedAt?: number
}

// How long a completed task stays on the board before it drops off: 14 days.
export const DONE_TTL_MS = 14 * 24 * 60 * 60 * 1000

// A tiny first-run tutorial, like the sample roadmap's self-teaching nodes: three tasks whose text
// explains the view itself (checking one off, dragging to reorder, adding and removing). Shown only
// on a truly fresh start, and replaced the moment the user edits their own list.
export const SEED_TASKS: Task[] = [
    { id: "task-1", text: "Tick a task to complete it and earn gold to spend on rewards.", done: false },
    { id: "task-2", text: "Grab the handle on the left to drag a task into any order.", done: false },
    { id: "task-3", text: "Add your own above, and hover a task to remove it.", done: false }
]

// Append a new task with the given id. Blank / whitespace-only text is ignored (returns the same
// list), so the board never grows an empty tile.
export function addTask(list: Task[], id: string, text: string): Task[] {
    const trimmed = text.trim()
    return trimmed ? [...list, { id, text: trimmed, done: false }] : list
}

// Flip one task by id. Checking it off stamps `completedAt` with `now`; re-opening drops the stamp so a
// later re-completion restarts its 14-day window. An unknown id keeps the same reference.
export function toggle(list: Task[], id: string, now: number): Task[] {
    if (!list.some((task) => task.id === id)) return list
    return list.map((task) => {
        if (task.id !== id) return task
        return task.done ? { id: task.id, text: task.text, done: false } : { ...task, done: true, completedAt: now }
    })
}

// Drop one task by id; an unknown id keeps the reference.
export function remove(list: Task[], id: string): Task[] {
    const next = list.filter((task) => task.id !== id)
    return next.length === list.length ? list : next
}

// Move `activeId` to sit where `overId` is, sliding the rest along. A no-op (same reference) when the
// ids match or either is unknown. Works on the full list by id, so hidden (expired) tasks keep
// their place while visible ones shuffle around them.
export function reorder(list: Task[], activeId: string, overId: string): Task[] {
    if (activeId === overId) return list
    const from = list.findIndex((task) => task.id === activeId)
    const to = list.findIndex((task) => task.id === overId)
    if (from === -1 || to === -1) return list
    const next = list.slice()
    const [moved] = next.splice(from, 1)
    if (!moved) return list
    next.splice(to, 0, moved)
    return next
}

// The tasks to show: every open one, plus completed ones checked off within the last `ttlMs`.
// Older completions drop off the board but stay in state (so their earned gold is kept). A done
// task with no timestamp (completed before this was tracked) is always shown.
export function visible(list: Task[], now: number, ttlMs = DONE_TTL_MS): Task[] {
    return list.filter((task) => !task.done || task.completedAt === undefined || now - task.completedAt <= ttlMs)
}

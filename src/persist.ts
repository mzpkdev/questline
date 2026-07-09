// One wire format for the whole app's roadmap data, shared by export/import (IoButtons) and
// autosave (localStorage). Kept free of React so it unit-tests directly, like graph.ts.
//
// The only field that is not already JSON-safe is Project.mastered: it is a Set in the live app
// (graph.ts relies on Set semantics) but JSON has no Set, so it crosses the wire as string[] and
// is rebuilt into a Set on the way back in. Scope is data-only: the open tab/selection is not
// persisted, so a load opens the default tab.

import type { Task } from "./tasks"
import type { Reward } from "./rewards"
import type { Project } from "./project"

export const PERSIST_VERSION = 2
export const STORAGE_KEY = "questline:v2"

export type MirrorPos = Record<string, { x: number; y: number }>

// The live slices the app persists (data only — not activeId/selectedId).
export type PersistedSlices = {
    projects: Record<string, Project>
    order: string[]
    mirrorPos: MirrorPos
    // The app-level Tasks checklist (one flat list, not tied to any project).
    tasks: Task[]
    // The Rewards shelf. Gold isn't stored -- it's derived from roadmap completion (earnedGold) minus
    // the price of each redeemed reward, so a reward's `redeemedAt` carries the spend across a reload.
    rewards: Reward[]
}

// A Project with its Set flattened to an array, so it survives JSON.
type WireProject = Omit<Project, "mastered"> & { mastered: string[] }
type WireState = {
    version: number
    projects: Record<string, WireProject>
    order: string[]
    mirrorPos: MirrorPos
    // The app-level Tasks checklist and the Rewards shelf. Both required in the v2 wire format.
    tasks: Task[]
    rewards: Reward[]
}

// Live slices -> the JSON string written to a file or to localStorage.
export function serialize(slices: PersistedSlices): string {
    const projects: Record<string, WireProject> = {}
    for (const [id, project] of Object.entries(slices.projects)) {
        projects[id] = { ...project, mastered: [...project.mastered] }
    }
    const wire: WireState = {
        version: PERSIST_VERSION,
        projects,
        order: slices.order,
        mirrorPos: slices.mirrorPos,
        tasks: slices.tasks,
        rewards: slices.rewards
    }
    return JSON.stringify(wire)
}

// JSON string -> live slices, or null if the text is not a v2 roadmap file we fully understand (bad
// JSON, wrong version, or any missing/mistyped field). No salvage: a malformed file is rejected
// wholesale, so callers treat null as "reject, change nothing". Only Project.mastered is transformed
// (array back to a Set); every other field is trusted exactly as written.
export function deserialize(text: string): PersistedSlices | null {
    let raw: unknown
    try {
        raw = JSON.parse(text)
    } catch {
        return null
    }
    if (!isWireState(raw)) return null
    const projects: Record<string, Project> = {}
    for (const [id, project] of Object.entries(raw.projects)) {
        projects[id] = { ...project, mastered: new Set(project.mastered) }
    }
    return { projects, order: raw.order, mirrorPos: raw.mirrorPos, tasks: raw.tasks, rewards: raw.rewards }
}

// Best-effort read of the autosaved state, or null when absent/corrupt.
export function loadState(): PersistedSlices | null {
    try {
        const text = localStorage.getItem(STORAGE_KEY)
        return text ? deserialize(text) : null
    } catch {
        return null
    }
}

// Best-effort autosave. A full or unavailable store (private mode) is swallowed, never thrown.
export function saveState(slices: PersistedSlices): void {
    try {
        localStorage.setItem(STORAGE_KEY, serialize(slices))
    } catch {
        // ignore: autosave is best-effort
    }
}

// Highest N across all `${prefix}-N` ids, so freshly minted ids resume past loaded/imported data
// instead of colliding with it. Ids like `view-2-goal` do not match `view-<N>` and are skipped.
export function maxCounter(ids: Iterable<string>, prefix: string): number {
    const re = new RegExp(`^${prefix}-(\\d+)$`)
    let max = 0
    for (const id of ids) {
        const m = re.exec(id)
        if (m) max = Math.max(max, Number(m[1]))
    }
    return max
}

function isWireState(value: unknown): value is WireState {
    if (typeof value !== "object" || value === null) return false
    const v = value as Record<string, unknown>
    if (v.version !== PERSIST_VERSION) return false
    if (typeof v.projects !== "object" || v.projects === null) return false
    if (!Array.isArray(v.order) || !v.order.every((id) => typeof id === "string")) return false
    if (typeof v.mirrorPos !== "object" || v.mirrorPos === null) return false
    if (!Array.isArray(v.tasks) || !v.tasks.every(isTask)) return false
    if (!Array.isArray(v.rewards) || !v.rewards.every(isReward)) return false
    return Object.values(v.projects as Record<string, unknown>).every(isWireProject)
}

function isTask(value: unknown): value is Task {
    if (typeof value !== "object" || value === null) return false
    const b = value as Record<string, unknown>
    return (
        typeof b.id === "string" &&
        typeof b.text === "string" &&
        typeof b.done === "boolean" &&
        (b.completedAt === undefined || typeof b.completedAt === "number")
    )
}

function isReward(value: unknown): value is Reward {
    if (typeof value !== "object" || value === null) return false
    const r = value as Record<string, unknown>
    return (
        typeof r.id === "string" &&
        typeof r.name === "string" &&
        typeof r.price === "number" &&
        (r.redeemedAt === undefined || typeof r.redeemedAt === "number") &&
        (r.replenish === undefined || typeof r.replenish === "boolean")
    )
}

function isWireProject(value: unknown): value is WireProject {
    if (typeof value !== "object" || value === null) return false
    const p = value as Record<string, unknown>
    return (
        typeof p.id === "string" &&
        typeof p.goalId === "string" &&
        typeof p.milestones === "object" &&
        p.milestones !== null &&
        Array.isArray(p.edges) &&
        typeof p.todos === "object" &&
        p.todos !== null &&
        Array.isArray(p.mastered) &&
        p.mastered.every((id) => typeof id === "string")
    )
}

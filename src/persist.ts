// One wire format for the whole app's roadmap data, shared by export/import (IoButtons) and
// autosave (localStorage). Kept free of React so it unit-tests directly, like graph.ts.
//
// The only field that is not already JSON-safe is Project.mastered: it is a Set in the live app
// (graph.ts relies on Set semantics) but JSON has no Set, so it crosses the wire as string[] and
// is rebuilt into a Set on the way back in. Scope is data-only: the open tab/selection is not
// persisted, so a load opens the default tab.

import type { Bounty } from "./bounties"
import type { Reward } from "./merchant"
import type { Project } from "./project"

export const PERSIST_VERSION = 1
export const STORAGE_KEY = "questline:v1"

export type MirrorPos = Record<string, { x: number; y: number }>

// The live slices the app persists (data only — not activeId/selectedId).
export type PersistedSlices = {
    projects: Record<string, Project>
    order: string[]
    mirrorPos: MirrorPos
    // The app-level Bounties checklist (one flat list, not tied to any project).
    bounties: Bounty[]
    // The Merchant shelf. Gold isn't stored -- it's derived from roadmap completion (earnedGold) minus
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
    // Added after v1 shipped, so it's optional on the wire: an older file (or one from before the
    // Bounties view) simply has none, and loads with an empty list.
    bounties?: Bounty[]
    // Likewise optional: a file from before the Merchant view has none, loading an empty shelf.
    rewards?: Reward[]
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
        bounties: slices.bounties,
        rewards: slices.rewards
    }
    return JSON.stringify(wire)
}

// JSON string -> live slices, or null if the text is not a roadmap file we understand (bad JSON,
// wrong version, missing/mistyped fields). Callers treat null as "reject, change nothing".
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
    // Bounties are optional and lightly validated: any non-array or malformed entries fall back to an
    // empty list rather than rejecting the whole file. Entries from before ids existed (or any missing
    // one) are backfilled with a fresh `bounty-N`, resuming past whatever ids are already present.
    const rawBounties = Array.isArray(raw.bounties) ? raw.bounties.filter(isBounty) : []
    let nextId = maxCounter(
        rawBounties.map((b) => (typeof b.id === "string" ? b.id : "")),
        "bounty"
    )
    const bounties: Bounty[] = rawBounties.map((b) => ({
        id: typeof b.id === "string" && b.id ? b.id : `bounty-${++nextId}`,
        text: b.text,
        done: b.done,
        ...(typeof b.completedAt === "number" ? { completedAt: b.completedAt } : {})
    }))
    // Rewards get the same lenient treatment: malformed entries are dropped, missing ids are backfilled
    // (resuming past any present), and each price is clamped to a whole number of at least 1.
    const rawRewards = Array.isArray(raw.rewards) ? raw.rewards.filter(isReward) : []
    let nextRewardId = maxCounter(
        rawRewards.map((r) => (typeof r.id === "string" ? r.id : "")),
        "reward"
    )
    const rewards: Reward[] = rawRewards.map((r) => ({
        id: typeof r.id === "string" && r.id ? r.id : `reward-${++nextRewardId}`,
        name: r.name,
        price: Math.max(1, Math.round(r.price) || 1),
        ...(typeof r.redeemedAt === "number" ? { redeemedAt: r.redeemedAt } : {}),
        ...(r.replenish === true ? { replenish: true } : {})
    }))
    return { projects, order: raw.order, mirrorPos: raw.mirrorPos, bounties, rewards }
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
    return Object.values(v.projects as Record<string, unknown>).every(isWireProject)
}

function isBounty(value: unknown): value is { id?: unknown; text: string; done: boolean; completedAt?: unknown } {
    if (typeof value !== "object" || value === null) return false
    const b = value as Record<string, unknown>
    return typeof b.text === "string" && typeof b.done === "boolean"
}

function isReward(
    value: unknown
): value is { id?: unknown; name: string; price: number; redeemedAt?: unknown; replenish?: unknown } {
    if (typeof value !== "object" || value === null) return false
    const r = value as Record<string, unknown>
    return typeof r.name === "string" && typeof r.price === "number"
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

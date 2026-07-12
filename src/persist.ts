// One wire format for the whole app's roadmap data, shared by export/import (IoButtons) and
// autosave (localStorage). Kept free of React so it unit-tests directly, like graph.ts.
//
// The only field that is not already JSON-safe is Board.mastered: it is a Set in the live app
// (graph.ts relies on Set semantics) but JSON has no Set, so it crosses the wire as string[] and
// is rebuilt into a Set on the way back in. Scope is data-only: the open tab/selection is not
// persisted, so a load opens a default board.

import { compressToUTF16, decompressFromUTF16 } from "lz-string"
import type { Task } from "./tasks"
import type { Banked, Reward } from "./rewards"
import type { Scribble } from "./scribbles"
import type { Board } from "./board"
import type { Edge, Node, Todo } from "./nodes"

export const PERSIST_VERSION = 5
export const STORAGE_KEY = "questline:v5"

// The live slices the app persists (data only — not activeId/selectedId).
export type PersistedSlices = {
    boards: Record<string, Board>
    boardOrder: string[]
    // The app-level Tasks checklist (one flat list, not tied to any board).
    tasks: Task[]
    // The Rewards shelf. Gold isn't stored -- it's derived from roadmap completion (earnedGold) minus
    // the price of each redeemed reward, so a reward's `redeemedAt` carries the spend across a reload.
    rewards: Reward[]
    // Gold earned / spent by tasks and rewards that have been pruned (aged past their 14-day window and
    // dropped from the lists). Carried so the balance survives that compaction. See rewards.compact.
    banked: Banked
    // The Scribbles wall: standalone Excalidraw scribbles, one canvas each. See scribbles.ts.
    scribbles: Scribble[]
}

// A Board with its Set flattened to an array, so it survives JSON.
type WireBoard = Omit<Board, "mastered"> & { mastered: string[] }
type WireState = {
    version: number
    boards: Record<string, WireBoard>
    boardOrder: string[]
    // The app-level Tasks checklist and the Rewards shelf. Both required in the v5 wire format.
    tasks: Task[]
    rewards: Reward[]
    banked: Banked
    // The scribbles. Required, like every other slice: v5 is a single shape with no optional fields.
    scribbles: Scribble[]
}

// Live slices -> the JSON string written to a file or to localStorage.
export function serialize(slices: PersistedSlices): string {
    const boards: Record<string, WireBoard> = {}
    for (const [id, board] of Object.entries(slices.boards)) {
        boards[id] = { ...board, mastered: [...board.mastered] }
    }
    const wire: WireState = {
        version: PERSIST_VERSION,
        boards,
        boardOrder: slices.boardOrder,
        tasks: slices.tasks,
        rewards: slices.rewards,
        banked: slices.banked,
        scribbles: slices.scribbles
    }
    return JSON.stringify(wire)
}

// JSON string -> live slices, or null if the text is not a v5 roadmap file we fully understand (bad
// JSON, wrong version, or any missing/mistyped field). No migration: a prior-version or malformed file
// is rejected wholesale, so callers treat null as "reject, change nothing". Only Board.mastered is
// transformed (array back to a Set); every other field is trusted exactly as written.
export function deserialize(text: string): PersistedSlices | null {
    let raw: unknown
    try {
        raw = JSON.parse(text)
    } catch {
        return null
    }
    if (!isWireState(raw)) return null
    const boards: Record<string, Board> = {}
    for (const [id, board] of Object.entries(raw.boards)) {
        boards[id] = { ...board, mastered: new Set(board.mastered) }
    }
    return {
        boards,
        boardOrder: raw.boardOrder,
        tasks: raw.tasks,
        rewards: raw.rewards,
        banked: raw.banked,
        scribbles: raw.scribbles
    }
}

// Best-effort read of the autosaved state, or null when absent/corrupt. v5 saves are lz-string-packed
// into UTF-16 (localStorage stores strings, so this is its densest form). No migration: older data
// lived under a different key and is simply never read.
export function loadState(): PersistedSlices | null {
    try {
        const text = localStorage.getItem(STORAGE_KEY)
        if (!text) return null
        const unpacked = decompressFromUTF16(text)
        return unpacked ? deserialize(unpacked) : null
    } catch {
        return null
    }
}

// Best-effort autosave, lz-string-compressed. A full or unavailable store (private mode) is swallowed,
// never thrown. Export/import and sync keep the plain JSON of serialize(); only localStorage is packed.
export function saveState(slices: PersistedSlices): void {
    try {
        localStorage.setItem(STORAGE_KEY, compressToUTF16(serialize(slices)))
    } catch {
        // ignore: autosave is best-effort
    }
}

function isWireState(value: unknown): value is WireState {
    if (typeof value !== "object" || value === null) return false
    const v = value as Record<string, unknown>
    if (v.version !== PERSIST_VERSION) return false
    if (typeof v.boards !== "object" || v.boards === null) return false
    if (!Array.isArray(v.boardOrder) || !v.boardOrder.every((id) => typeof id === "string")) return false
    if (!Array.isArray(v.tasks) || !v.tasks.every(isTask)) return false
    if (!Array.isArray(v.rewards) || !v.rewards.every(isReward)) return false
    if (!isBanked(v.banked)) return false
    if (!Array.isArray(v.scribbles) || !v.scribbles.every(isScribble)) return false
    return Object.values(v.boards as Record<string, unknown>).every(isBoard)
}

function isBanked(value: unknown): value is Banked {
    if (typeof value !== "object" || value === null) return false
    const b = value as Record<string, unknown>
    return typeof b.earned === "number" && typeof b.spent === "number"
}

function isTask(value: unknown): value is Task {
    if (typeof value !== "object" || value === null) return false
    const b = value as Record<string, unknown>
    return (
        typeof b.id === "string" &&
        typeof b.text === "string" &&
        typeof b.done === "boolean" &&
        typeof b.reward === "number" &&
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

function isScribble(value: unknown): value is Scribble {
    if (typeof value !== "object" || value === null) return false
    const n = value as Record<string, unknown>
    if (typeof n.id !== "string" || typeof n.title !== "string" || typeof n.updatedAt !== "number") return false
    const scene = n.scene
    if (typeof scene !== "object" || scene === null) return false
    const s = scene as Record<string, unknown>
    return (
        Array.isArray(s.elements) &&
        typeof s.appState === "object" &&
        s.appState !== null &&
        typeof s.files === "object" &&
        s.files !== null
    )
}

// A single tree node. Kind is positional (root = id === board.rootId, linked = targetBoardId present),
// so nothing kind-specific is validated here: description / reward / targetBoardId are all optional,
// checked only for type when present. A malformed node rejects the whole file (no salvage).
function isNode(value: unknown): value is Node {
    if (typeof value !== "object" || value === null) return false
    const n = value as Record<string, unknown>
    return (
        typeof n.id === "string" &&
        typeof n.name === "string" &&
        typeof n.x === "number" &&
        typeof n.y === "number" &&
        typeof n.tier === "number" &&
        (n.description === undefined || typeof n.description === "string") &&
        (n.reward === undefined || typeof n.reward === "number") &&
        (n.targetBoardId === undefined || n.targetBoardId === null || typeof n.targetBoardId === "string") &&
        (n.scribbleIds === undefined || (Array.isArray(n.scribbleIds) && n.scribbleIds.every((v) => typeof v === "string")))
    )
}

function isEdge(value: unknown): value is Edge {
    return Array.isArray(value) && value.length === 2 && typeof value[0] === "string" && typeof value[1] === "string"
}

function isTodoList(value: unknown): value is Todo[] {
    return (
        Array.isArray(value) &&
        value.every((t) => typeof t === "object" && t !== null && typeof (t as Todo).text === "string" && typeof (t as Todo).done === "boolean")
    )
}

function isBoard(value: unknown): value is WireBoard {
    if (typeof value !== "object" || value === null) return false
    const b = value as Record<string, unknown>
    if (typeof b.id !== "string" || typeof b.rootId !== "string") return false
    if (typeof b.nodes !== "object" || b.nodes === null) return false
    if (!Object.values(b.nodes as Record<string, unknown>).every(isNode)) return false
    if (!Array.isArray(b.edges) || !b.edges.every(isEdge)) return false
    if (typeof b.todos !== "object" || b.todos === null) return false
    if (!Object.values(b.todos as Record<string, unknown>).every(isTodoList)) return false
    return Array.isArray(b.mastered) && b.mastered.every((id) => typeof id === "string")
}

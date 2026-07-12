// The Scribbles collection: a wall of standalone Excalidraw sketches reached from the Scribbles chip in
// the tab bar. Each scribble is its own canvas. Like tasks.ts / rewards.ts, the pure list ops live here
// (no React, no Excalidraw import) so they unit-test directly; App holds the state and persist.ts
// carries it across reloads and sync.

// A scribble's saved drawing: the cleaned Excalidraw scene (what serializeAsJSON emits, minus the wrapper
// keys). Kept structural — this module never inspects the contents — so it stays free of the heavy
// @excalidraw/excalidraw types. ScribbleEditor restores it into the editor and ScribblesBoard renders a
// thumbnail from it.
export type ScribbleScene = {
    elements: unknown[]
    appState: Record<string, unknown>
    files: Record<string, unknown>
}

// One drawing: a stable id (`scribble-N`, minted like task/reward ids), an editable title, its scene, and
// the epoch-ms of the last scene edit. `updatedAt` doubles as the thumbnail cache key (a fresh render
// only when the drawing actually changed) and the card's timestamp.
export type Scribble = {
    id: string
    title: string
    scene: ScribbleScene
    updatedAt: number
}

// Every scribble has a name; a blank rename falls back to this so a card is never left label-less.
export const DEFAULT_SCRIBBLE_TITLE = "Scribble"

// A fresh, empty scene for a new scribble.
export function emptyScene(): ScribbleScene {
    return { elements: [], appState: {}, files: {} }
}

// Add a blank scribble with the given id at the front of the wall (newest first), stamped `now`. App opens
// it in the editor straight away, so it starts untitled with an empty canvas.
export function addScribble(list: Scribble[], id: string, now: number): Scribble[] {
    return [{ id, title: DEFAULT_SCRIBBLE_TITLE, scene: emptyScene(), updatedAt: now }, ...list]
}

// Rename a scribble by id. The title is trimmed, and a blank falls back to "Untitled" so no card goes
// nameless. An unknown id keeps the same reference.
export function renameScribble(list: Scribble[], id: string, title: string): Scribble[] {
    if (!list.some((scribble) => scribble.id === id)) return list
    const next = title.trim() || DEFAULT_SCRIBBLE_TITLE
    return list.map((scribble) => (scribble.id === id ? { ...scribble, title: next } : scribble))
}

// Replace a scribble's scene and stamp `now`, but only when the drawing actually changed — an identical
// scene keeps the same reference (and the old `updatedAt`), so a no-op save doesn't churn the thumbnail
// cache or the autosave. An unknown id keeps the reference too.
export function updateScribbleScene(list: Scribble[], id: string, scene: ScribbleScene, now: number): Scribble[] {
    const current = list.find((scribble) => scribble.id === id)
    if (!current) return list
    if (JSON.stringify(current.scene) === JSON.stringify(scene)) return list
    return list.map((scribble) => (scribble.id === id ? { ...scribble, scene, updatedAt: now } : scribble))
}

// Drop a scribble by id; an unknown id keeps the reference.
export function removeScribble(list: Scribble[], id: string): Scribble[] {
    const next = list.filter((scribble) => scribble.id !== id)
    return next.length === list.length ? list : next
}

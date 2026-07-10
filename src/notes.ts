// The Draw notes collection: a wall of standalone Excalidraw sketches reached from the Draw chip in
// the tab bar. Each note is its own canvas. Like tasks.ts / rewards.ts, the pure list ops live here
// (no React, no Excalidraw import) so they unit-test directly; App holds the state and persist.ts
// carries it across reloads and sync.

// A note's saved drawing: the cleaned Excalidraw scene (what serializeAsJSON emits, minus the wrapper
// keys). Kept structural — this module never inspects the contents — so it stays free of the heavy
// @excalidraw/excalidraw types. ExcalidrawBoard restores it into the editor and DrawBoard renders a
// thumbnail from it.
export type NoteScene = {
    elements: unknown[]
    appState: Record<string, unknown>
    files: Record<string, unknown>
}

// One drawing: a stable id (`note-N`, minted like task/reward ids), an editable title, its scene, and
// the epoch-ms of the last scene edit. `updatedAt` doubles as the thumbnail cache key (a fresh render
// only when the drawing actually changed) and the card's timestamp.
export type Note = {
    id: string
    title: string
    scene: NoteScene
    updatedAt: number
}

// Every note has a name; a blank rename falls back to this so a card is never left label-less.
export const DEFAULT_NOTE_TITLE = "Scribble"

// A fresh, empty scene for a new note.
export function emptyScene(): NoteScene {
    return { elements: [], appState: {}, files: {} }
}

// Add a blank note with the given id at the front of the wall (newest first), stamped `now`. App opens
// it in the editor straight away, so it starts untitled with an empty canvas.
export function addNote(list: Note[], id: string, now: number): Note[] {
    return [{ id, title: DEFAULT_NOTE_TITLE, scene: emptyScene(), updatedAt: now }, ...list]
}

// Rename a note by id. The title is trimmed, and a blank falls back to "Untitled" so no card goes
// nameless. An unknown id keeps the same reference.
export function renameNote(list: Note[], id: string, title: string): Note[] {
    if (!list.some((note) => note.id === id)) return list
    const next = title.trim() || DEFAULT_NOTE_TITLE
    return list.map((note) => (note.id === id ? { ...note, title: next } : note))
}

// Replace a note's scene and stamp `now`, but only when the drawing actually changed — an identical
// scene keeps the same reference (and the old `updatedAt`), so a no-op save doesn't churn the thumbnail
// cache or the autosave. An unknown id keeps the reference too.
export function updateNoteScene(list: Note[], id: string, scene: NoteScene, now: number): Note[] {
    const current = list.find((note) => note.id === id)
    if (!current) return list
    if (JSON.stringify(current.scene) === JSON.stringify(scene)) return list
    return list.map((note) => (note.id === id ? { ...note, scene, updatedAt: now } : note))
}

// Drop a note by id; an unknown id keeps the reference.
export function removeNote(list: Note[], id: string): Note[] {
    const next = list.filter((note) => note.id !== id)
    return next.length === list.length ? list : next
}

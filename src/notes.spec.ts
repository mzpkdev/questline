import { addNote, DEFAULT_NOTE_TITLE, emptyScene, type Note, removeNote, renameNote, updateNoteScene } from "./notes"

const scene = (elements: unknown[] = []) => ({ elements, appState: {}, files: {} })
const note = (id: string, over: Partial<Note> = {}): Note => ({
    id,
    title: "A",
    scene: scene(),
    updatedAt: 0,
    ...over
})

describe("notes", () => {
    it("adds a blank untitled note at the front, stamped now", () => {
        const list = addNote([note("note-1")], "note-2", 123)
        expect(list.map((n) => n.id)).toEqual(["note-2", "note-1"])
        expect(list[0]).toEqual({ id: "note-2", title: DEFAULT_NOTE_TITLE, scene: emptyScene(), updatedAt: 123 })
    })

    it("renames a note, trimming and falling back to Untitled on blank", () => {
        const list = [note("note-1", { title: "Old" })]
        expect(renameNote(list, "note-1", "  New  ")[0]?.title).toBe("New")
        expect(renameNote(list, "note-1", "   ")[0]?.title).toBe(DEFAULT_NOTE_TITLE)
    })

    it("keeps the reference when renaming an unknown id", () => {
        const list = [note("note-1")]
        expect(renameNote(list, "note-x", "New")).toBe(list)
    })

    it("replaces the scene and bumps updatedAt on a real change", () => {
        const list = [note("note-1", { updatedAt: 1 })]
        const next = updateNoteScene(list, "note-1", scene([{ id: "el" }]), 999)
        expect(next[0]?.scene.elements).toEqual([{ id: "el" }])
        expect(next[0]?.updatedAt).toBe(999)
    })

    it("keeps the reference (and updatedAt) when the scene is unchanged", () => {
        const list = [note("note-1", { updatedAt: 1, scene: scene([{ id: "el" }]) })]
        expect(updateNoteScene(list, "note-1", scene([{ id: "el" }]), 999)).toBe(list)
    })

    it("removes a note by id and keeps the reference on an unknown id", () => {
        const list = [note("note-1"), note("note-2")]
        expect(removeNote(list, "note-1").map((n) => n.id)).toEqual(["note-2"])
        expect(removeNote(list, "note-x")).toBe(list)
    })
})

import { addScribble, DEFAULT_SCRIBBLE_TITLE, emptyScene, removeScribble, renameScribble, type Scribble, updateScribbleScene } from "./scribbles"

const scene = (elements: unknown[] = []) => ({ elements, appState: {}, files: {} })
const scribble = (id: string, over: Partial<Scribble> = {}): Scribble => ({
    id,
    title: "A",
    scene: scene(),
    updatedAt: 0,
    ...over
})

describe("scribbles", () => {
    it("adds a blank untitled scribble at the front, stamped now", () => {
        const list = addScribble([scribble("note-1")], "note-2", 123)
        expect(list.map((n) => n.id)).toEqual(["note-2", "note-1"])
        expect(list[0]).toEqual({ id: "note-2", title: DEFAULT_SCRIBBLE_TITLE, scene: emptyScene(), updatedAt: 123 })
    })

    it("renames a scribble, trimming and falling back to Untitled on blank", () => {
        const list = [scribble("note-1", { title: "Old" })]
        expect(renameScribble(list, "note-1", "  New  ")[0]?.title).toBe("New")
        expect(renameScribble(list, "note-1", "   ")[0]?.title).toBe(DEFAULT_SCRIBBLE_TITLE)
    })

    it("keeps the reference when renaming an unknown id", () => {
        const list = [scribble("note-1")]
        expect(renameScribble(list, "note-x", "New")).toBe(list)
    })

    it("replaces the scene and bumps updatedAt on a real change", () => {
        const list = [scribble("note-1", { updatedAt: 1 })]
        const next = updateScribbleScene(list, "note-1", scene([{ id: "el" }]), 999)
        expect(next[0]?.scene.elements).toEqual([{ id: "el" }])
        expect(next[0]?.updatedAt).toBe(999)
    })

    it("keeps the reference (and updatedAt) when the scene is unchanged", () => {
        const list = [scribble("note-1", { updatedAt: 1, scene: scene([{ id: "el" }]) })]
        expect(updateScribbleScene(list, "note-1", scene([{ id: "el" }]), 999)).toBe(list)
    })

    it("removes a scribble by id and keeps the reference on an unknown id", () => {
        const list = [scribble("note-1"), scribble("note-2")]
        expect(removeScribble(list, "note-1").map((n) => n.id)).toEqual(["note-2"])
        expect(removeScribble(list, "note-x")).toBe(list)
    })
})

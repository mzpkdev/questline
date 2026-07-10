import { addTask, DEFAULT_TASK_REWARD, DONE_TTL_MS, edit, remove, reorder, SEED_TASKS, type Task, toggle, visible } from "./tasks"

const NOW = 1_700_000_000_000

const list = (): Task[] => [
    { id: "b1", text: "one", done: false, reward: 1 },
    { id: "b2", text: "two", done: true, completedAt: NOW, reward: 1 }
]

const three = (): Task[] => [
    { id: "b1", text: "one", done: false, reward: 1 },
    { id: "b2", text: "two", done: false, reward: 1 },
    { id: "b3", text: "three", done: false, reward: 1 }
]

describe("tasks", () => {
    context("addTask", () => {
        it("prepends a new, incomplete task with the given id and the default reward", () => {
            expect(addTask([{ id: "b1", text: "one", done: false, reward: 1 }], "b2", "two")).toEqual([
                { id: "b2", text: "two", done: false, reward: DEFAULT_TASK_REWARD },
                { id: "b1", text: "one", done: false, reward: 1 }
            ])
        })

        it("trims surrounding whitespace", () => {
            expect(addTask([], "b1", "  hunt the wyrm  ")).toEqual([
                { id: "b1", text: "hunt the wyrm", done: false, reward: DEFAULT_TASK_REWARD }
            ])
        })

        it("ignores blank text, keeping the same reference", () => {
            const before = three()
            expect(addTask(before, "b4", "   ")).toBe(before)
        })
    })

    context("toggle", () => {
        it("checks an open task and stamps completedAt with now, keeping its reward", () => {
            expect(toggle(list(), "b1", NOW)).toEqual([
                { id: "b1", text: "one", done: true, completedAt: NOW, reward: 1 },
                { id: "b2", text: "two", done: true, completedAt: NOW, reward: 1 }
            ])
        })

        it("re-opens a done task, clearing completedAt but keeping its reward", () => {
            expect(toggle(list(), "b2", NOW + 5)).toEqual([
                { id: "b1", text: "one", done: false, reward: 1 },
                { id: "b2", text: "two", done: false, reward: 1 }
            ])
        })

        it("is a no-op keeping the reference for an unknown id", () => {
            const before = list()
            expect(toggle(before, "nope", NOW)).toBe(before)
        })
    })

    context("edit", () => {
        it("updates text and clamps reward to a whole number of at least 0", () => {
            expect(edit(list(), "b1", { text: "renamed", reward: 4.6 })).toEqual([
                { id: "b1", text: "renamed", done: false, reward: 5 },
                { id: "b2", text: "two", done: true, completedAt: NOW, reward: 1 }
            ])
        })

        it("clamps a negative reward to 0", () => {
            expect(edit(list(), "b1", { reward: -3 })[0]?.reward).toBe(0)
        })

        it("is a no-op keeping the reference for an unknown id", () => {
            const before = list()
            expect(edit(before, "nope", { reward: 9 })).toBe(before)
        })
    })

    context("remove", () => {
        it("drops the task with the id", () => {
            expect(remove(list(), "b1")).toEqual([{ id: "b2", text: "two", done: true, completedAt: NOW, reward: 1 }])
        })

        it("is a no-op keeping the reference for an unknown id", () => {
            const before = list()
            expect(remove(before, "nope")).toBe(before)
        })
    })

    context("reorder", () => {
        it("moves an item down to a later position", () => {
            expect(reorder(three(), "b1", "b3").map((b) => b.id)).toEqual(["b2", "b3", "b1"])
        })

        it("moves an item up to an earlier position", () => {
            expect(reorder(three(), "b3", "b1").map((b) => b.id)).toEqual(["b3", "b1", "b2"])
        })

        it("is a no-op keeping the reference for equal or unknown ids", () => {
            const before = three()
            expect(reorder(before, "b2", "b2")).toBe(before)
            expect(reorder(before, "b1", "nope")).toBe(before)
        })

        it("does not mutate the input list", () => {
            const before = three()
            reorder(before, "b1", "b3")
            expect(before.map((b) => b.id)).toEqual(["b1", "b2", "b3"])
        })
    })

    context("visible", () => {
        it("keeps open and recently done tasks, hiding stale completions", () => {
            const l: Task[] = [
                { id: "open", text: "open", done: false, reward: 1 },
                { id: "fresh", text: "fresh", done: true, completedAt: NOW - DONE_TTL_MS + 1000, reward: 1 },
                { id: "stale", text: "stale", done: true, completedAt: NOW - DONE_TTL_MS - 1000, reward: 1 }
            ]
            expect(visible(l, NOW).map((b) => b.id)).toEqual(["open", "fresh"])
        })

        it("shows a done task that has no timestamp", () => {
            expect(visible([{ id: "old", text: "old", done: true, reward: 1 }], NOW).map((b) => b.id)).toEqual(["old"])
        })

        it("treats a completion exactly ttl old as still visible", () => {
            const edge: Task[] = [{ id: "edge", text: "edge", done: true, completedAt: NOW - DONE_TTL_MS, reward: 1 }]
            expect(visible(edge, NOW)).toHaveLength(1)
        })
    })

    it("ships a non-empty seed with distinct ids", () => {
        expect(SEED_TASKS.length).toBeGreaterThan(0)
        expect(new Set(SEED_TASKS.map((b) => b.id)).size).toBe(SEED_TASKS.length)
    })
})

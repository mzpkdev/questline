import { fireEvent, render, screen } from "@testing-library/react"
import type { Task } from "./tasks"
import { TasksBoard } from "./TasksBoard"

const items: Task[] = [
    { id: "b1", text: "Scout the trail", done: false, reward: 1 },
    { id: "b2", text: "Gather moonpetals", done: true, reward: 1 }
]

const noop = () => {}

// Render with no-op handlers; each test overrides only the ones it asserts on.
function renderBoard(overrides: Partial<Parameters<typeof TasksBoard>[0]> = {}) {
    return render(
        <TasksBoard
            items={items}
            onAdd={noop}
            onToggle={noop}
            onReorder={noop}
            onSelect={noop}
            {...overrides}
        />
    )
}

describe("TasksBoard", () => {
    it("renders each task, with done ones checked", () => {
        renderBoard()
        expect(screen.getByText("Scout the trail")).toBeInTheDocument()
        expect(screen.getByRole("button", { name: "Check Scout the trail" })).toHaveAttribute("aria-pressed", "false")
        expect(screen.getByRole("button", { name: "Uncheck Gather moonpetals" })).toHaveAttribute(
            "aria-pressed",
            "true"
        )
    })

    it("toggles a task by id", () => {
        const onToggle = vi.fn()
        renderBoard({ onToggle })
        fireEvent.click(screen.getByRole("button", { name: "Check Scout the trail" }))
        expect(onToggle).toHaveBeenCalledWith("b1")
    })

    it("opens a task's detail by id when its name is clicked", () => {
        const onSelect = vi.fn()
        renderBoard({ onSelect })
        fireEvent.click(screen.getByRole("button", { name: "Open Scout the trail" }))
        expect(onSelect).toHaveBeenCalledWith("b1")
    })

    it("opens a task's detail when the tile body is clicked, but not when checking it", () => {
        const onSelect = vi.fn()
        const onToggle = vi.fn()
        renderBoard({ onSelect, onToggle })
        fireEvent.click(screen.getByRole("button", { name: "Check Scout the trail" }))
        expect(onSelect).not.toHaveBeenCalled()
        expect(onToggle).toHaveBeenCalledWith("b1")
    })

    it("adds a task from the form and clears the input", () => {
        const onAdd = vi.fn()
        renderBoard({ onAdd })
        const input = screen.getByRole("textbox", { name: "New task" })
        fireEvent.change(input, { target: { value: "Tame the griffon" } })
        fireEvent.click(screen.getByRole("button", { name: "Add task" }))
        expect(onAdd).toHaveBeenCalledWith("Tame the griffon")
        expect(input).toHaveValue("")
    })

    it("ignores a blank submission", () => {
        const onAdd = vi.fn()
        renderBoard({ onAdd })
        fireEvent.change(screen.getByRole("textbox", { name: "New task" }), { target: { value: "   " } })
        fireEvent.click(screen.getByRole("button", { name: "Add task" }))
        expect(onAdd).not.toHaveBeenCalled()
    })

    it("exposes a drag handle per task for reordering", () => {
        renderBoard()
        expect(screen.getByRole("button", { name: "Reorder Scout the trail" })).toBeInTheDocument()
        expect(screen.getByRole("button", { name: "Reorder Gather moonpetals" })).toBeInTheDocument()
    })

    it("shows an empty-state message with no tasks", () => {
        renderBoard({ items: [] })
        expect(screen.getByText(/no tasks posted/i)).toBeInTheDocument()
    })
})

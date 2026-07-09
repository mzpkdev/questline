import { fireEvent, render, screen } from "@testing-library/react"
import type { Task } from "./tasks"
import { TasksBoard } from "./TasksBoard"

const items: Task[] = [
    { id: "b1", text: "Scout the trail", done: false },
    { id: "b2", text: "Gather moonpetals", done: true }
]

const noop = () => {}

describe("TasksBoard", () => {
    it("renders each task, with done ones checked", () => {
        render(<TasksBoard items={items} onAdd={noop} onToggle={noop} onRemove={noop} onReorder={noop} />)
        expect(screen.getByText("Scout the trail")).toBeInTheDocument()
        expect(screen.getByRole("button", { name: "Check Scout the trail" })).toHaveAttribute("aria-pressed", "false")
        expect(screen.getByRole("button", { name: "Uncheck Gather moonpetals" })).toHaveAttribute(
            "aria-pressed",
            "true"
        )
    })

    it("toggles a task by id", () => {
        const onToggle = vi.fn()
        render(<TasksBoard items={items} onAdd={noop} onToggle={onToggle} onRemove={noop} onReorder={noop} />)
        fireEvent.click(screen.getByRole("button", { name: "Check Scout the trail" }))
        expect(onToggle).toHaveBeenCalledWith("b1")
    })

    it("removes a task by id", () => {
        const onRemove = vi.fn()
        render(<TasksBoard items={items} onAdd={noop} onToggle={noop} onRemove={onRemove} onReorder={noop} />)
        fireEvent.click(screen.getByRole("button", { name: "Remove Gather moonpetals" }))
        expect(onRemove).toHaveBeenCalledWith("b2")
    })

    it("adds a task from the form and clears the input", () => {
        const onAdd = vi.fn()
        render(<TasksBoard items={items} onAdd={onAdd} onToggle={noop} onRemove={noop} onReorder={noop} />)
        const input = screen.getByRole("textbox", { name: "New task" })
        fireEvent.change(input, { target: { value: "Tame the griffon" } })
        fireEvent.click(screen.getByRole("button", { name: "Add task" }))
        expect(onAdd).toHaveBeenCalledWith("Tame the griffon")
        expect(input).toHaveValue("")
    })

    it("ignores a blank submission", () => {
        const onAdd = vi.fn()
        render(<TasksBoard items={items} onAdd={onAdd} onToggle={noop} onRemove={noop} onReorder={noop} />)
        fireEvent.change(screen.getByRole("textbox", { name: "New task" }), { target: { value: "   " } })
        fireEvent.click(screen.getByRole("button", { name: "Add task" }))
        expect(onAdd).not.toHaveBeenCalled()
    })

    it("exposes a drag handle per task for reordering", () => {
        render(<TasksBoard items={items} onAdd={noop} onToggle={noop} onRemove={noop} onReorder={noop} />)
        expect(screen.getByRole("button", { name: "Reorder Scout the trail" })).toBeInTheDocument()
        expect(screen.getByRole("button", { name: "Reorder Gather moonpetals" })).toBeInTheDocument()
    })

    it("shows an empty-state message with no tasks", () => {
        render(<TasksBoard items={[]} onAdd={noop} onToggle={noop} onRemove={noop} onReorder={noop} />)
        expect(screen.getByText(/no tasks posted/i)).toBeInTheDocument()
    })
})

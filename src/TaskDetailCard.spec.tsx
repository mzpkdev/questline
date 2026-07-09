import { fireEvent, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { TaskDetailCard } from "./TaskDetailCard"
import type { Task } from "./tasks"

const task = (overrides: Partial<Task> = {}): Task => ({
    id: "task-1",
    text: "Guard the caravan",
    done: false,
    reward: 3,
    ...overrides
})

describe("TaskDetailCard", () => {
    it("shows the name and reward in read mode", () => {
        render(<TaskDetailCard task={task()} onEdit={vi.fn()} onDelete={vi.fn()} />)
        expect(screen.getByRole("heading", { name: "Guard the caravan" })).toBeInTheDocument()
        expect(screen.getByText("3")).toBeInTheDocument()
        // No inputs until the pencil is clicked.
        expect(screen.queryByRole("textbox")).not.toBeInTheDocument()
    })

    it("commits a name change in edit mode", async () => {
        const user = userEvent.setup()
        const onEdit = vi.fn()
        render(<TaskDetailCard task={task()} onEdit={onEdit} onDelete={vi.fn()} />)
        await user.click(screen.getByRole("button", { name: "Edit" }))

        fireEvent.change(screen.getByRole("textbox", { name: "Task name" }), { target: { value: "Guard the gate" } })
        expect(onEdit).toHaveBeenCalledWith({ text: "Guard the gate" })
    })

    it("commits a reward change, rounding to a whole number of at least 0", async () => {
        const user = userEvent.setup()
        const onEdit = vi.fn()
        render(<TaskDetailCard task={task({ reward: 3 })} onEdit={onEdit} onDelete={vi.fn()} />)
        await user.click(screen.getByRole("button", { name: "Edit" }))

        const field = screen.getByRole("spinbutton", { name: "Reward in gold" })
        expect(field).toHaveValue(3)
        fireEvent.change(field, { target: { value: "4.6" } })
        expect(onEdit).toHaveBeenCalledWith({ reward: 5 })
    })

    it("calls onExited once the closing animation ends", () => {
        const onExited = vi.fn()
        render(<TaskDetailCard task={task()} closing onEdit={vi.fn()} onDelete={vi.fn()} onExited={onExited} />)
        fireEvent.animationEnd(screen.getByTestId("task-detail-card"))
        expect(onExited).toHaveBeenCalledTimes(1)
    })

    it("opens a confirm and fires onDelete only once confirmed", async () => {
        const onDelete = vi.fn()
        render(<TaskDetailCard task={task()} onEdit={vi.fn()} onDelete={onDelete} />)
        fireEvent.click(screen.getByRole("button", { name: "Edit" }))

        fireEvent.click(screen.getByRole("button", { name: "Delete task" }))
        expect(await screen.findByRole("alertdialog")).toHaveTextContent("Delete this task?")
        expect(onDelete).not.toHaveBeenCalled()

        fireEvent.click(screen.getByRole("button", { name: "Delete" }))
        expect(onDelete).toHaveBeenCalledTimes(1)
    })
})

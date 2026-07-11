import { fireEvent, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { NodeDetailCard } from "./NodeDetailCard"
import { STATE_LABEL } from "./graph"
import { DEFAULT_NODE_REWARD, type Node, type Todo } from "./nodes"

// A full Node with sensible defaults; each test overrides only what it asserts on.
function milestone(overrides: Partial<Node> = {}): Node {
    return {
        id: "plan-goal",
        name: "Feature Complete",
        x: 0,
        y: 0,
        tier: 1,
        description: "Every core feature built, integrated, and ready for real users.",
        reward: DEFAULT_NODE_REWARD,
        ...overrides
    }
}

describe("NodeDetailCard", () => {
    context("the root node", () => {
        it("renders the name and state badge, no checklist, and the root node action label", () => {
            render(
                <NodeDetailCard milestone={milestone({ name: "Learn Questline" })} state="available" todos={[]} isRoot />
            )

            expect(screen.getByRole("heading", { name: "Learn Questline" })).toBeInTheDocument()
            expect(screen.getByText(STATE_LABEL.available)).toBeInTheDocument()
            expect(screen.queryByText("Checklist")).not.toBeInTheDocument()
            expect(screen.getByRole("button", { name: "Complete Quest" })).toBeInTheDocument()
        })
    })

    context("an in-progress milestone with unfinished items", () => {
        it("disables the action, shows the hint, and counts done items", () => {
            const todos: Todo[] = [
                { text: "Feature freeze declared", done: true },
                { text: "All specs QA-signed", done: false },
                { text: "Beta feedback triaged", done: false }
            ]

            render(<NodeDetailCard milestone={milestone()} state="available" todos={todos} isRoot={false} />)

            expect(screen.getByRole("button", { name: "Mark Complete" })).toBeDisabled()
            expect(screen.getByText("Check off every item to complete this milestone.")).toBeInTheDocument()
            expect(screen.getByText("1/3")).toBeInTheDocument()
        })
    })

    context("an in-progress milestone with every item done", () => {
        it("enables the Mark Complete action and drops the hint", () => {
            const todos: Todo[] = [
                { text: "First check complete", done: true },
                { text: "Second check complete", done: true }
            ]

            render(<NodeDetailCard milestone={milestone()} state="available" todos={todos} isRoot={false} />)

            expect(screen.getByRole("button", { name: "Mark Complete" })).toBeEnabled()
            expect(screen.queryByText(/Check off every item/)).not.toBeInTheDocument()
        })
    })

    context("a completed milestone", () => {
        it("offers Mark Incomplete and shows a ticked item as pressed", () => {
            const todos: Todo[] = [{ text: "Compute provisioned", done: true }]

            render(<NodeDetailCard milestone={milestone()} state="mastered" todos={todos} isRoot={false} />)

            expect(screen.getByText(STATE_LABEL.mastered)).toBeInTheDocument()
            expect(screen.getByRole("button", { name: "Mark Incomplete" })).toBeInTheDocument()
            expect(screen.getByRole("button", { pressed: true })).toHaveAttribute("aria-pressed", "true")
        })
    })

    context("completing and un-completing", () => {
        it("fires onComplete when the enabled Mark Complete is clicked", async () => {
            const user = userEvent.setup()
            const onComplete = vi.fn()
            const todos: Todo[] = [{ text: "Second check complete", done: true }]

            render(
                <NodeDetailCard
                    milestone={milestone()}
                    state="available"
                    todos={todos}
                    isRoot={false}
                    onComplete={onComplete}
                />
            )

            await user.click(screen.getByRole("button", { name: "Mark Complete" }))
            expect(onComplete).toHaveBeenCalledTimes(1)
        })

        it("fires onUncomplete when Mark Incomplete is clicked", async () => {
            const user = userEvent.setup()
            const onUncomplete = vi.fn()
            const todos: Todo[] = [{ text: "Compute provisioned", done: true }]

            render(
                <NodeDetailCard
                    milestone={milestone()}
                    state="mastered"
                    todos={todos}
                    isRoot={false}
                    onUncomplete={onUncomplete}
                />
            )

            await user.click(screen.getByRole("button", { name: "Mark Incomplete" }))
            expect(onUncomplete).toHaveBeenCalledTimes(1)
        })
    })

    context("a planned milestone", () => {
        it("renders a disabled Locked action", () => {
            const todos: Todo[] = [{ text: "Blocked step", done: false }]

            render(<NodeDetailCard milestone={milestone()} state="locked" todos={todos} isRoot={false} />)

            expect(screen.getByText(STATE_LABEL.locked)).toBeInTheDocument()
            expect(screen.getByRole("button", { name: "Locked" })).toBeDisabled()
        })
    })

    context("ticking a checklist item", () => {
        it("calls onToggle with the item index when actionable", async () => {
            const user = userEvent.setup()
            const onToggle = vi.fn()
            const todos: Todo[] = [
                { text: "Prod & staging accounts", done: true },
                { text: "VPC & networking mapped", done: false }
            ]

            render(
                <NodeDetailCard
                    milestone={milestone()}
                    state="available"
                    todos={todos}
                    isRoot={false}
                    onToggle={onToggle}
                />
            )

            await user.click(screen.getByRole("button", { name: "Check VPC & networking mapped" }))
            expect(onToggle).toHaveBeenCalledWith(1)
        })

        it("does not fire while the milestone is locked", async () => {
            const user = userEvent.setup()
            const onToggle = vi.fn()
            const todos: Todo[] = [{ text: "Blocked step", done: false }]

            render(
                <NodeDetailCard milestone={milestone()} state="locked" todos={todos} isRoot={false} onToggle={onToggle} />
            )

            await user.click(screen.getByRole("button", { name: "Check Blocked step" }))
            expect(onToggle).not.toHaveBeenCalled()
        })
    })

    context("editing fields in edit mode", () => {
        it("commits name and description changes", async () => {
            const user = userEvent.setup()
            const onEditMilestone = vi.fn()

            render(
                <NodeDetailCard
                    milestone={milestone()}
                    state="available"
                    todos={[]}
                    isRoot={false}
                    onEditMilestone={onEditMilestone}
                />
            )
            await user.click(screen.getByRole("button", { name: "Edit" }))

            fireEvent.change(screen.getByDisplayValue("Feature Complete"), { target: { value: "Renamed" } })
            expect(onEditMilestone).toHaveBeenCalledWith({ name: "Renamed" })

            fireEvent.change(screen.getByDisplayValue(/Every core feature/), { target: { value: "New description" } })
            expect(onEditMilestone).toHaveBeenCalledWith({ description: "New description" })
        })

        it("shows the reward and commits a change, rounding to a whole number of at least 0", async () => {
            const user = userEvent.setup()
            const onEditMilestone = vi.fn()

            render(
                <NodeDetailCard
                    milestone={milestone({ reward: 3 })}
                    state="available"
                    todos={[]}
                    isRoot={false}
                    onEditMilestone={onEditMilestone}
                />
            )
            await user.click(screen.getByRole("button", { name: "Edit" }))

            const field = screen.getByRole("spinbutton", { name: "Reward in gold" })
            expect(field).toHaveValue(3)
            fireEvent.change(field, { target: { value: "8" } })
            expect(onEditMilestone).toHaveBeenCalledWith({ reward: 8 })
        })

        it("shows the reward in read mode", () => {
            render(<NodeDetailCard milestone={milestone({ reward: 4 })} state="available" todos={[]} isRoot={false} />)
            expect(screen.getByText("gold on completion")).toBeInTheDocument()
            expect(screen.getByText("4")).toBeInTheDocument()
        })

        it("shows and edits the reward on the root node too (a completed board pays out)", async () => {
            const user = userEvent.setup()
            const onEditMilestone = vi.fn()
            render(
                <NodeDetailCard
                    milestone={milestone({ reward: 5 })}
                    state="available"
                    todos={[]}
                    isRoot
                    onEditMilestone={onEditMilestone}
                />
            )
            await user.click(screen.getByRole("button", { name: "Edit" }))
            const field = screen.getByRole("spinbutton", { name: "Reward in gold" })
            expect(field).toHaveValue(5)
            fireEvent.change(field, { target: { value: "12" } })
            expect(onEditMilestone).toHaveBeenCalledWith({ reward: 12 })
        })

        it("edits, removes, and adds checklist items", async () => {
            const user = userEvent.setup()
            const onEditTodo = vi.fn()
            const onDeleteTodo = vi.fn()
            const onAddTodo = vi.fn()
            const todos: Todo[] = [{ text: "Data model reviewed", done: true }]

            render(
                <NodeDetailCard
                    milestone={milestone()}
                    state="available"
                    todos={todos}
                    isRoot={false}
                    onEditTodo={onEditTodo}
                    onDeleteTodo={onDeleteTodo}
                    onAddTodo={onAddTodo}
                />
            )
            await user.click(screen.getByRole("button", { name: "Edit" }))

            fireEvent.change(screen.getByDisplayValue("Data model reviewed"), { target: { value: "Reviewed" } })
            expect(onEditTodo).toHaveBeenCalledWith(0, "Reviewed")

            await user.click(screen.getByRole("button", { name: "Remove item" }))
            expect(onDeleteTodo).toHaveBeenCalledWith(0)

            await user.click(screen.getByRole("button", { name: "+ Add item" }))
            expect(onAddTodo).toHaveBeenCalledTimes(1)
        })

        it("adds a sub-milestone", async () => {
            const user = userEvent.setup()
            const onAddChild = vi.fn()

            render(
                <NodeDetailCard
                    milestone={milestone()}
                    state="available"
                    todos={[]}
                    isRoot={false}
                    onAddChild={onAddChild}
                />
            )
            await user.click(screen.getByRole("button", { name: "Edit" }))
            await user.click(screen.getByRole("button", { name: "Add sub-milestone" }))

            expect(onAddChild).toHaveBeenCalledTimes(1)
        })

        it("adds a parent milestone from the root node's edit mode", async () => {
            const user = userEvent.setup()
            const onAddParent = vi.fn()

            render(
                <NodeDetailCard
                    milestone={milestone({ name: "Learn Questline" })}
                    state="available"
                    todos={[]}
                    isRoot
                    onAddParent={onAddParent}
                />
            )
            await user.click(screen.getByRole("button", { name: "Edit" }))
            await user.click(screen.getByRole("button", { name: "Add parent milestone" }))

            expect(onAddParent).toHaveBeenCalledTimes(1)
        })

        it("omits Add parent milestone when adding a parent isn't allowed", async () => {
            const user = userEvent.setup()

            render(<NodeDetailCard milestone={milestone()} state="available" todos={[]} isRoot />)
            await user.click(screen.getByRole("button", { name: "Edit" }))

            expect(screen.queryByRole("button", { name: "Add parent milestone" })).not.toBeInTheDocument()
        })
    })

    context("edit mode", () => {
        it("swaps to the editing layout when the pencil is clicked", async () => {
            const user = userEvent.setup()
            const todos: Todo[] = [{ text: "Data model reviewed", done: true }]

            render(<NodeDetailCard milestone={milestone()} state="available" todos={todos} isRoot={false} />)
            expect(screen.queryByRole("textbox")).not.toBeInTheDocument()

            await user.click(screen.getByRole("button", { name: "Edit" }))

            expect(screen.getByDisplayValue("Feature Complete")).toBeInTheDocument()
            expect(screen.getByDisplayValue("Data model reviewed")).toBeInTheDocument()
            expect(screen.getByRole("button", { name: "Add sub-milestone" })).toBeInTheDocument()
            // the view-mode action button is gone in edit mode
            expect(screen.queryByRole("button", { name: /mark complete/i })).not.toBeInTheDocument()
        })
    })

    context("deleting in edit mode", () => {
        it("opens a confirm and fires onDelete only once confirmed", async () => {
            const onDelete = vi.fn()

            render(
                <NodeDetailCard milestone={milestone()} state="available" todos={[]} isRoot={false} onDelete={onDelete} />
            )
            fireEvent.click(screen.getByRole("button", { name: "Edit" }))

            // The trigger opens the confirm without deleting yet.
            fireEvent.click(screen.getByRole("button", { name: "Delete milestone" }))
            expect(await screen.findByRole("alertdialog")).toHaveTextContent("Delete this milestone?")
            expect(onDelete).not.toHaveBeenCalled()

            // The single "Delete" button inside the dialog confirms.
            fireEvent.click(screen.getByRole("button", { name: "Delete" }))
            expect(onDelete).toHaveBeenCalledTimes(1)
        })

        it("labels the action and confirm for a board when deleteKind is board (the root node)", async () => {
            render(
                <NodeDetailCard
                    milestone={milestone({ name: "Launch Plan" })}
                    state="available"
                    todos={[]}
                    isRoot
                    onDelete={vi.fn()}
                    deleteKind="board"
                />
            )
            fireEvent.click(screen.getByRole("button", { name: "Edit" }))

            fireEvent.click(screen.getByRole("button", { name: "Delete board" }))
            expect(await screen.findByRole("alertdialog")).toHaveTextContent("Remove this board?")
        })

        it("warns about the cascade count in the milestone confirm", async () => {
            render(
                <NodeDetailCard
                    milestone={milestone()}
                    state="available"
                    todos={[]}
                    isRoot={false}
                    onDelete={vi.fn()}
                    descendantCount={2}
                />
            )
            fireEvent.click(screen.getByRole("button", { name: "Edit" }))
            fireEvent.click(screen.getByRole("button", { name: "Delete milestone" }))

            expect(await screen.findByRole("alertdialog")).toHaveTextContent("2 sub-milestones")
        })

        it("offers no delete in read mode or when onDelete is absent", () => {
            const { rerender } = render(
                <NodeDetailCard milestone={milestone()} state="available" todos={[]} isRoot={false} onDelete={vi.fn()} />
            )
            // Read mode: no delete affordance even though onDelete is set.
            expect(screen.queryByRole("button", { name: "Delete milestone" })).not.toBeInTheDocument()

            // Edit mode but without onDelete: still nothing to delete with.
            rerender(<NodeDetailCard milestone={milestone()} state="available" todos={[]} isRoot={false} />)
            fireEvent.click(screen.getByRole("button", { name: "Edit" }))
            expect(screen.queryByRole("button", { name: "Delete milestone" })).not.toBeInTheDocument()
        })
    })
})

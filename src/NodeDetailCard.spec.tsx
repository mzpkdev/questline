import { fireEvent, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { NodeDetailCard } from "./NodeDetailCard"
import { STATE_LABEL } from "./graph"
import { DEFAULT_NODE_REWARD, type Node, type Todo } from "./nodes"

// A full Node with sensible defaults; each test overrides only what it asserts on.
function nodeFixture(overrides: Partial<Node> = {}): Node {
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

// A linked node fixture: kind is positional, marked by the targetBoardId key.
function linkedFixture(targetBoardId: string | null = null): Node {
    return { id: "link-1", name: "", x: 0, y: 0, tier: 1, targetBoardId }
}

describe("NodeDetailCard", () => {
    context("the root node", () => {
        it("renders the name and state badge, no checklist, and the root node action label", () => {
            render(
                <NodeDetailCard node={nodeFixture({ name: "Learn Questline" })} state="available" todos={[]} isRoot />
            )

            expect(screen.getByRole("heading", { name: "Learn Questline" })).toBeInTheDocument()
            expect(screen.getByText(STATE_LABEL.available)).toBeInTheDocument()
            expect(screen.queryByText("Checklist")).not.toBeInTheDocument()
            expect(screen.getByRole("button", { name: "Complete Quest" })).toBeInTheDocument()
        })
    })

    context("an in-progress node with unfinished items", () => {
        it("disables the action, shows the hint, and counts done items", () => {
            const todos: Todo[] = [
                { text: "Feature freeze declared", done: true },
                { text: "All specs QA-signed", done: false },
                { text: "Beta feedback triaged", done: false }
            ]

            render(<NodeDetailCard node={nodeFixture()} state="available" todos={todos} isRoot={false} />)

            expect(screen.getByRole("button", { name: "Mark Complete" })).toBeDisabled()
            expect(screen.getByText("Check off every item to complete this node.")).toBeInTheDocument()
            expect(screen.getByText("1/3")).toBeInTheDocument()
        })
    })

    context("an in-progress node with every item done", () => {
        it("enables the Mark Complete action and drops the hint", () => {
            const todos: Todo[] = [
                { text: "First check complete", done: true },
                { text: "Second check complete", done: true }
            ]

            render(<NodeDetailCard node={nodeFixture()} state="available" todos={todos} isRoot={false} />)

            expect(screen.getByRole("button", { name: "Mark Complete" })).toBeEnabled()
            expect(screen.queryByText(/Check off every item/)).not.toBeInTheDocument()
        })
    })

    context("a completed node", () => {
        it("offers Mark Incomplete and shows a ticked item as pressed", () => {
            const todos: Todo[] = [{ text: "Compute provisioned", done: true }]

            render(<NodeDetailCard node={nodeFixture()} state="mastered" todos={todos} isRoot={false} />)

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
                    node={nodeFixture()}
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
                    node={nodeFixture()}
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

    context("a planned node", () => {
        it("renders a disabled Locked action", () => {
            const todos: Todo[] = [{ text: "Blocked step", done: false }]

            render(<NodeDetailCard node={nodeFixture()} state="locked" todos={todos} isRoot={false} />)

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
                    node={nodeFixture()}
                    state="available"
                    todos={todos}
                    isRoot={false}
                    onToggle={onToggle}
                />
            )

            await user.click(screen.getByRole("button", { name: "Check VPC & networking mapped" }))
            expect(onToggle).toHaveBeenCalledWith(1)
        })

        it("does not fire while the node is locked", async () => {
            const user = userEvent.setup()
            const onToggle = vi.fn()
            const todos: Todo[] = [{ text: "Blocked step", done: false }]

            render(
                <NodeDetailCard node={nodeFixture()} state="locked" todos={todos} isRoot={false} onToggle={onToggle} />
            )

            await user.click(screen.getByRole("button", { name: "Check Blocked step" }))
            expect(onToggle).not.toHaveBeenCalled()
        })
    })

    context("editing fields in edit mode", () => {
        it("commits name and description changes", async () => {
            const user = userEvent.setup()
            const onEditNode = vi.fn()

            render(
                <NodeDetailCard
                    node={nodeFixture()}
                    state="available"
                    todos={[]}
                    isRoot={false}
                    onEditNode={onEditNode}
                />
            )
            await user.click(screen.getByRole("button", { name: "Edit" }))

            fireEvent.change(screen.getByDisplayValue("Feature Complete"), { target: { value: "Renamed" } })
            expect(onEditNode).toHaveBeenCalledWith({ name: "Renamed" })

            fireEvent.change(screen.getByDisplayValue(/Every core feature/), { target: { value: "New description" } })
            expect(onEditNode).toHaveBeenCalledWith({ description: "New description" })
        })

        it("shows the reward and commits a change, rounding to a whole number of at least 0", async () => {
            const user = userEvent.setup()
            const onEditNode = vi.fn()

            render(
                <NodeDetailCard
                    node={nodeFixture({ reward: 3 })}
                    state="available"
                    todos={[]}
                    isRoot={false}
                    onEditNode={onEditNode}
                />
            )
            await user.click(screen.getByRole("button", { name: "Edit" }))

            const field = screen.getByRole("spinbutton", { name: "Reward in gold" })
            expect(field).toHaveValue(3)
            fireEvent.change(field, { target: { value: "8" } })
            expect(onEditNode).toHaveBeenCalledWith({ reward: 8 })
        })

        it("shows the reward in read mode", () => {
            render(<NodeDetailCard node={nodeFixture({ reward: 4 })} state="available" todos={[]} isRoot={false} />)
            expect(screen.getByText("gold on completion")).toBeInTheDocument()
            expect(screen.getByText("4")).toBeInTheDocument()
        })

        it("shows and edits the reward on the root node too (a completed board pays out)", async () => {
            const user = userEvent.setup()
            const onEditNode = vi.fn()
            render(
                <NodeDetailCard
                    node={nodeFixture({ reward: 5 })}
                    state="available"
                    todos={[]}
                    isRoot
                    onEditNode={onEditNode}
                />
            )
            await user.click(screen.getByRole("button", { name: "Edit" }))
            const field = screen.getByRole("spinbutton", { name: "Reward in gold" })
            expect(field).toHaveValue(5)
            fireEvent.change(field, { target: { value: "12" } })
            expect(onEditNode).toHaveBeenCalledWith({ reward: 12 })
        })

        it("edits, removes, and adds checklist items", async () => {
            const user = userEvent.setup()
            const onEditTodo = vi.fn()
            const onDeleteTodo = vi.fn()
            const onAddTodo = vi.fn()
            const todos: Todo[] = [{ text: "Data model reviewed", done: true }]

            render(
                <NodeDetailCard
                    node={nodeFixture()}
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

        it("adds a child node and a linked node", async () => {
            const user = userEvent.setup()
            const onAddChild = vi.fn()
            const onAddLinkedNode = vi.fn()

            render(
                <NodeDetailCard
                    node={nodeFixture()}
                    state="available"
                    todos={[]}
                    isRoot={false}
                    onAddChild={onAddChild}
                    onAddLinkedNode={onAddLinkedNode}
                />
            )
            await user.click(screen.getByRole("button", { name: "Edit" }))
            await user.click(screen.getByRole("button", { name: "Add child node" }))
            expect(onAddChild).toHaveBeenCalledTimes(1)

            await user.click(screen.getByRole("button", { name: "Add linked node" }))
            expect(onAddLinkedNode).toHaveBeenCalledTimes(1)
        })

        it("adds a parent node from the root node's edit mode", async () => {
            const user = userEvent.setup()
            const onAddParent = vi.fn()

            render(
                <NodeDetailCard
                    node={nodeFixture({ name: "Learn Questline" })}
                    state="available"
                    todos={[]}
                    isRoot
                    onAddParent={onAddParent}
                />
            )
            await user.click(screen.getByRole("button", { name: "Edit" }))
            await user.click(screen.getByRole("button", { name: "Add parent node" }))

            expect(onAddParent).toHaveBeenCalledTimes(1)
        })

        it("omits Add parent node when adding a parent isn't allowed", async () => {
            const user = userEvent.setup()

            render(<NodeDetailCard node={nodeFixture()} state="available" todos={[]} isRoot />)
            await user.click(screen.getByRole("button", { name: "Edit" }))

            expect(screen.queryByRole("button", { name: "Add parent node" })).not.toBeInTheDocument()
        })
    })

    context("edit mode", () => {
        it("swaps to the editing layout when the pencil is clicked", async () => {
            const user = userEvent.setup()
            const todos: Todo[] = [{ text: "Data model reviewed", done: true }]

            render(<NodeDetailCard node={nodeFixture()} state="available" todos={todos} isRoot={false} />)
            expect(screen.queryByRole("textbox")).not.toBeInTheDocument()

            await user.click(screen.getByRole("button", { name: "Edit" }))

            expect(screen.getByDisplayValue("Feature Complete")).toBeInTheDocument()
            expect(screen.getByDisplayValue("Data model reviewed")).toBeInTheDocument()
            expect(screen.getByRole("button", { name: "Add child node" })).toBeInTheDocument()
            // the view-mode action button is gone in edit mode
            expect(screen.queryByRole("button", { name: /mark complete/i })).not.toBeInTheDocument()
        })
    })

    context("deleting in edit mode", () => {
        it("opens a confirm and fires onDelete only once confirmed", async () => {
            const onDelete = vi.fn()

            render(
                <NodeDetailCard node={nodeFixture()} state="available" todos={[]} isRoot={false} onDelete={onDelete} />
            )
            fireEvent.click(screen.getByRole("button", { name: "Edit" }))

            // The trigger opens the confirm without deleting yet.
            fireEvent.click(screen.getByRole("button", { name: "Delete node" }))
            expect(await screen.findByRole("alertdialog")).toHaveTextContent("Delete this node?")
            expect(onDelete).not.toHaveBeenCalled()

            // The single "Delete" button inside the dialog confirms.
            fireEvent.click(screen.getByRole("button", { name: "Delete" }))
            expect(onDelete).toHaveBeenCalledTimes(1)
        })

        it("labels the action and confirm for a board when deleteKind is board (the root node)", async () => {
            render(
                <NodeDetailCard
                    node={nodeFixture({ name: "Launch Plan" })}
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

        it("warns about the cascade count in the node confirm", async () => {
            render(
                <NodeDetailCard
                    node={nodeFixture()}
                    state="available"
                    todos={[]}
                    isRoot={false}
                    onDelete={vi.fn()}
                    descendantCount={2}
                />
            )
            fireEvent.click(screen.getByRole("button", { name: "Edit" }))
            fireEvent.click(screen.getByRole("button", { name: "Delete node" }))

            expect(await screen.findByRole("alertdialog")).toHaveTextContent("2 sub-nodes")
        })

        it("offers no delete in read mode or when onDelete is absent", () => {
            const { rerender } = render(
                <NodeDetailCard node={nodeFixture()} state="available" todos={[]} isRoot={false} onDelete={vi.fn()} />
            )
            // Read mode: no delete affordance even though onDelete is set.
            expect(screen.queryByRole("button", { name: "Delete node" })).not.toBeInTheDocument()

            // Edit mode but without onDelete: still nothing to delete with.
            rerender(<NodeDetailCard node={nodeFixture()} state="available" todos={[]} isRoot={false} />)
            fireEvent.click(screen.getByRole("button", { name: "Edit" }))
            expect(screen.queryByRole("button", { name: "Delete node" })).not.toBeInTheDocument()
        })
    })

    context("a linked node (isLinked mode)", () => {
        it("shows the mirrored name and Go to Board, and no checklist / reward / description", () => {
            const todos: Todo[] = [{ text: "should not render", done: false }]
            render(
                <NodeDetailCard
                    node={linkedFixture("board-x")}
                    state="available"
                    todos={todos}
                    isRoot={false}
                    isLinked
                    linkedName="Target Quest"
                    targetBoardId="board-x"
                    onGoToBoard={vi.fn()}
                />
            )

            expect(screen.getByRole("heading", { name: "Target Quest" })).toBeInTheDocument()
            expect(screen.getByRole("button", { name: "Go to Board" })).toBeEnabled()
            // No node fields on a linked node.
            expect(screen.queryByText("gold on completion")).not.toBeInTheDocument()
            expect(screen.queryByText("Checklist")).not.toBeInTheDocument()
            expect(screen.queryByText("should not render")).not.toBeInTheDocument()
        })

        it("disables Go to Board while unlinked and shows the placeholder name", async () => {
            const user = userEvent.setup()
            const onGoToBoard = vi.fn()
            render(
                <NodeDetailCard
                    node={linkedFixture(null)}
                    state="available"
                    todos={[]}
                    isRoot={false}
                    isLinked
                    linkedName="Unlinked"
                    targetBoardId={null}
                    onGoToBoard={onGoToBoard}
                />
            )

            expect(screen.getByRole("heading", { name: "Unlinked" })).toBeInTheDocument()
            const go = screen.getByRole("button", { name: "Go to Board" })
            expect(go).toBeDisabled()
            await user.click(go)
            expect(onGoToBoard).not.toHaveBeenCalled()
        })

        it("fires onGoToBoard from the enabled action", async () => {
            const user = userEvent.setup()
            const onGoToBoard = vi.fn()
            render(
                <NodeDetailCard
                    node={linkedFixture("board-x")}
                    state="available"
                    todos={[]}
                    isRoot={false}
                    isLinked
                    linkedName="Target Quest"
                    targetBoardId="board-x"
                    onGoToBoard={onGoToBoard}
                />
            )
            await user.click(screen.getByRole("button", { name: "Go to Board" }))
            expect(onGoToBoard).toHaveBeenCalledTimes(1)
        })

        it("lists the given (self-excluded) boards in the dropdown and sets the target on pick", async () => {
            const user = userEvent.setup()
            const onSetLinkedTarget = vi.fn()
            render(
                <NodeDetailCard
                    node={linkedFixture(null)}
                    state="available"
                    todos={[]}
                    isRoot={false}
                    isLinked
                    linkedName="Unlinked"
                    targetBoardId={null}
                    boardOptions={[
                        { id: "b1", name: "Alpha" },
                        { id: "b2", name: "Beta" }
                    ]}
                    onSetLinkedTarget={onSetLinkedTarget}
                    initialEditing
                />
            )

            const dropdown = screen.getByRole("combobox", { name: "Link to board" })
            // Only the two provided boards are options (the current board was already excluded upstream).
            expect(screen.getByRole("option", { name: "Alpha" })).toBeInTheDocument()
            expect(screen.getByRole("option", { name: "Beta" })).toBeInTheDocument()

            await user.selectOptions(dropdown, "b2")
            expect(onSetLinkedTarget).toHaveBeenCalledWith("b2")
        })

        it("has an empty dropdown (placeholder only) when there are no other boards", () => {
            render(
                <NodeDetailCard
                    node={linkedFixture(null)}
                    state="available"
                    todos={[]}
                    isRoot={false}
                    isLinked
                    linkedName="Unlinked"
                    targetBoardId={null}
                    boardOptions={[]}
                    onSetLinkedTarget={vi.fn()}
                    initialEditing
                />
            )

            // The dropdown exists but offers only the placeholder; Go to Board is read-mode only, so
            // edit mode doesn't render it here.
            expect(screen.getByRole("combobox", { name: "Link to board" })).toBeInTheDocument()
            expect(screen.getAllByRole("option")).toHaveLength(1)
            expect(screen.queryByRole("button", { name: "Go to Board" })).not.toBeInTheDocument()
        })

        it("offers add parent / child / linked node and delete, but no Go to Board (edit mode)", async () => {
            const user = userEvent.setup()
            const onAddParent = vi.fn()
            const onAddChild = vi.fn()
            const onAddLinkedNode = vi.fn()
            render(
                <NodeDetailCard
                    node={linkedFixture("board-x")}
                    state="available"
                    todos={[]}
                    isRoot={false}
                    isLinked
                    linkedName="Target Quest"
                    targetBoardId="board-x"
                    onAddParent={onAddParent}
                    onAddChild={onAddChild}
                    onAddLinkedNode={onAddLinkedNode}
                    onGoToBoard={vi.fn()}
                    onDelete={vi.fn()}
                    initialEditing
                />
            )

            // insertParent is node-agnostic, so a linked node offers Add parent alongside the child adds.
            await user.click(screen.getByRole("button", { name: "Add parent node" }))
            expect(onAddParent).toHaveBeenCalledTimes(1)
            await user.click(screen.getByRole("button", { name: "Add child node" }))
            expect(onAddChild).toHaveBeenCalledTimes(1)
            await user.click(screen.getByRole("button", { name: "Add linked node" }))
            expect(onAddLinkedNode).toHaveBeenCalledTimes(1)
            expect(screen.getByRole("button", { name: "Delete node" })).toBeInTheDocument()
            // Go to Board is a read-mode navigation action: edit mode omits it even with onGoToBoard wired.
            expect(screen.queryByRole("button", { name: "Go to Board" })).not.toBeInTheDocument()
        })
    })
})

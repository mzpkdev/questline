import { act, fireEvent, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { TabBar } from "./TabBar"

const tabs = [
    { id: "seed", name: "Learn Questline" },
    { id: "board-1", name: "Marketing Q3" }
]

function renderBar(overrides: Partial<Parameters<typeof TabBar>[0]> = {}) {
    const props = {
        tabs,
        activeId: "seed",
        onSelect: vi.fn(),
        onRename: vi.fn(),
        ...overrides
    }
    return { props, ...render(<TabBar {...props} />) }
}

describe("TabBar", () => {
    it("renders a tab per board", () => {
        renderBar()

        expect(screen.getByRole("button", { name: "Learn Questline" })).toBeInTheDocument()
        expect(screen.getByRole("button", { name: "Marketing Q3" })).toBeInTheDocument()
    })

    it("selects a tab when its label is clicked", async () => {
        const { props } = renderBar()
        await userEvent.click(screen.getByRole("button", { name: "Marketing Q3" }))
        expect(props.onSelect).toHaveBeenCalledWith("board-1")
    })

    it("renders no per-tab remove affordance (boards are deleted from the root node's card)", () => {
        renderBar()
        expect(screen.queryByRole("button", { name: "Remove Learn Questline" })).not.toBeInTheDocument()
        expect(screen.queryByRole("button", { name: "Remove Marketing Q3" })).not.toBeInTheDocument()
    })

    context("the Add board button", () => {
        it("creates a board when clicked", async () => {
            const onAddBoard = vi.fn()
            renderBar({ onAddBoard })
            await userEvent.click(screen.getByRole("button", { name: "Add board" }))
            expect(onAddBoard).toHaveBeenCalledTimes(1)
        })

        it("is omitted when onAddBoard isn't provided", () => {
            renderBar()
            expect(screen.queryByRole("button", { name: "Add board" })).not.toBeInTheDocument()
        })
    })

    context("renaming a tab", () => {
        it("commits a double-click rename on Enter", async () => {
            const user = userEvent.setup()
            const { props } = renderBar()

            await user.dblClick(screen.getByRole("button", { name: "Learn Questline" }))
            const input = screen.getByRole("textbox", { name: "Rename board" })
            await user.clear(input)
            await user.type(input, "Launch Plan{Enter}")

            expect(props.onRename).toHaveBeenCalledWith("seed", "Launch Plan")
        })

        it("enters rename on a long press (touch)", () => {
            vi.useFakeTimers()
            try {
                renderBar()
                fireEvent.pointerDown(screen.getByRole("button", { name: "Learn Questline" }))
                act(() => vi.advanceTimersByTime(600))
                expect(screen.getByRole("textbox", { name: "Rename board" })).toBeInTheDocument()
            } finally {
                vi.useRealTimers()
            }
        })

        it("aborts the long press when the finger drifts (a scroll)", () => {
            vi.useFakeTimers()
            try {
                renderBar()
                const label = screen.getByRole("button", { name: "Learn Questline" })
                fireEvent.pointerDown(label, { clientX: 0, clientY: 0 })
                fireEvent.pointerMove(label, { clientX: 40, clientY: 0 })
                act(() => vi.advanceTimersByTime(600))
                expect(screen.queryByRole("textbox", { name: "Rename board" })).not.toBeInTheDocument()
            } finally {
                vi.useRealTimers()
            }
        })

        it("ignores a blank rename", async () => {
            const user = userEvent.setup()
            const { props } = renderBar()

            await user.dblClick(screen.getByRole("button", { name: "Learn Questline" }))
            const input = screen.getByRole("textbox", { name: "Rename board" })
            await user.clear(input)
            fireEvent.blur(input)

            expect(props.onRename).not.toHaveBeenCalled()
        })
    })
})

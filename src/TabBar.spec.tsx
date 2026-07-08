import { act, fireEvent, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { TabBar } from "./TabBar"

const tabs = [
    { id: "root", name: "Quest Board", pinned: true },
    { id: "seed", name: "Learn Questline" },
    { id: "view-1", name: "Marketing Q3" }
]

function renderBar(overrides: Partial<Parameters<typeof TabBar>[0]> = {}) {
    const props = {
        tabs,
        activeId: "seed",
        onSelect: vi.fn(),
        onRename: vi.fn(),
        onRemove: vi.fn(),
        ...overrides
    }
    return { props, ...render(<TabBar {...props} />) }
}

describe("TabBar", () => {
    it("renders a tab per project", () => {
        renderBar()

        expect(screen.getByRole("button", { name: "Quest Board" })).toBeInTheDocument()
        expect(screen.getByRole("button", { name: "Learn Questline" })).toBeInTheDocument()
        expect(screen.getByRole("button", { name: "Marketing Q3" })).toBeInTheDocument()
    })

    it("selects a tab when its label is clicked", async () => {
        const { props } = renderBar()
        await userEvent.click(screen.getByRole("button", { name: "Marketing Q3" }))
        expect(props.onSelect).toHaveBeenCalledWith("view-1")
    })

    it("confirms before removing a tab", async () => {
        const { props } = renderBar()
        await userEvent.click(screen.getByRole("button", { name: "Remove Marketing Q3" }))
        // The modal opens; nothing is removed until the user confirms.
        expect(props.onRemove).not.toHaveBeenCalled()
        await userEvent.click(await screen.findByRole("button", { name: "Remove" }))
        expect(props.onRemove).toHaveBeenCalledWith("view-1")
    })

    it("keeps the tab when the removal is dismissed", async () => {
        const { props } = renderBar()
        await userEvent.click(screen.getByRole("button", { name: "Remove Marketing Q3" }))
        await userEvent.click(await screen.findByRole("button", { name: "Close" }))
        expect(props.onRemove).not.toHaveBeenCalled()
    })

    it("gives the pinned Root tab no remove affordance", () => {
        renderBar()
        expect(screen.queryByRole("button", { name: "Remove Quest Board" })).not.toBeInTheDocument()
        expect(screen.getByRole("button", { name: "Remove Marketing Q3" })).toBeInTheDocument()
    })

    context("renaming a tab", () => {
        it("commits a double-click rename on Enter", async () => {
            const user = userEvent.setup()
            const { props } = renderBar()

            await user.dblClick(screen.getByRole("button", { name: "Learn Questline" }))
            const input = screen.getByRole("textbox", { name: "Rename view" })
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
                expect(screen.getByRole("textbox", { name: "Rename view" })).toBeInTheDocument()
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
                expect(screen.queryByRole("textbox", { name: "Rename view" })).not.toBeInTheDocument()
            } finally {
                vi.useRealTimers()
            }
        })

        it("ignores a blank rename", async () => {
            const user = userEvent.setup()
            const { props } = renderBar()

            await user.dblClick(screen.getByRole("button", { name: "Learn Questline" }))
            const input = screen.getByRole("textbox", { name: "Rename view" })
            await user.clear(input)
            fireEvent.blur(input)

            expect(props.onRename).not.toHaveBeenCalled()
        })
    })
})

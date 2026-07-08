import { fireEvent, render, screen } from "@testing-library/react"
import type { Bounty } from "./bounties"
import { BountiesBoard } from "./BountiesBoard"

const items: Bounty[] = [
    { id: "b1", text: "Scout the trail", done: false },
    { id: "b2", text: "Gather moonpetals", done: true }
]

const noop = () => {}

describe("BountiesBoard", () => {
    it("renders each bounty, with done ones checked", () => {
        render(<BountiesBoard items={items} onAdd={noop} onToggle={noop} onRemove={noop} onReorder={noop} />)
        expect(screen.getByText("Scout the trail")).toBeInTheDocument()
        expect(screen.getByRole("button", { name: "Check Scout the trail" })).toHaveAttribute("aria-pressed", "false")
        expect(screen.getByRole("button", { name: "Uncheck Gather moonpetals" })).toHaveAttribute(
            "aria-pressed",
            "true"
        )
    })

    it("toggles a bounty by id", () => {
        const onToggle = vi.fn()
        render(<BountiesBoard items={items} onAdd={noop} onToggle={onToggle} onRemove={noop} onReorder={noop} />)
        fireEvent.click(screen.getByRole("button", { name: "Check Scout the trail" }))
        expect(onToggle).toHaveBeenCalledWith("b1")
    })

    it("removes a bounty by id", () => {
        const onRemove = vi.fn()
        render(<BountiesBoard items={items} onAdd={noop} onToggle={noop} onRemove={onRemove} onReorder={noop} />)
        fireEvent.click(screen.getByRole("button", { name: "Remove Gather moonpetals" }))
        expect(onRemove).toHaveBeenCalledWith("b2")
    })

    it("adds a bounty from the form and clears the input", () => {
        const onAdd = vi.fn()
        render(<BountiesBoard items={items} onAdd={onAdd} onToggle={noop} onRemove={noop} onReorder={noop} />)
        const input = screen.getByRole("textbox", { name: "New bounty" })
        fireEvent.change(input, { target: { value: "Tame the griffon" } })
        fireEvent.click(screen.getByRole("button", { name: "Add bounty" }))
        expect(onAdd).toHaveBeenCalledWith("Tame the griffon")
        expect(input).toHaveValue("")
    })

    it("ignores a blank submission", () => {
        const onAdd = vi.fn()
        render(<BountiesBoard items={items} onAdd={onAdd} onToggle={noop} onRemove={noop} onReorder={noop} />)
        fireEvent.change(screen.getByRole("textbox", { name: "New bounty" }), { target: { value: "   " } })
        fireEvent.click(screen.getByRole("button", { name: "Add bounty" }))
        expect(onAdd).not.toHaveBeenCalled()
    })

    it("exposes a drag handle per bounty for reordering", () => {
        render(<BountiesBoard items={items} onAdd={noop} onToggle={noop} onRemove={noop} onReorder={noop} />)
        expect(screen.getByRole("button", { name: "Reorder Scout the trail" })).toBeInTheDocument()
        expect(screen.getByRole("button", { name: "Reorder Gather moonpetals" })).toBeInTheDocument()
    })

    it("shows an empty-state message with no bounties", () => {
        render(<BountiesBoard items={[]} onAdd={noop} onToggle={noop} onRemove={noop} onReorder={noop} />)
        expect(screen.getByText(/no bounties posted/i)).toBeInTheDocument()
    })
})

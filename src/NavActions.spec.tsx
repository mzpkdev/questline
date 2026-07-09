import { fireEvent, render, screen } from "@testing-library/react"
import { NavActions } from "./NavActions"

describe("NavActions", () => {
    it("renders the Tasks and Rewards nav chips", () => {
        render(<NavActions />)
        expect(screen.getByRole("button", { name: "Tasks" })).toBeInTheDocument()
        expect(screen.getByRole("button", { name: "Rewards" })).toBeInTheDocument()
    })

    it("opens Tasks when its chip is clicked", () => {
        const onOpenBounties = vi.fn()
        render(<NavActions onOpenBounties={onOpenBounties} />)
        fireEvent.click(screen.getByRole("button", { name: "Tasks" }))
        expect(onOpenBounties).toHaveBeenCalledTimes(1)
    })

    it("marks the Tasks chip pressed only when its view is active", () => {
        const { rerender } = render(<NavActions bountiesActive={false} />)
        expect(screen.getByRole("button", { name: "Tasks" })).toHaveAttribute("aria-pressed", "false")
        rerender(<NavActions bountiesActive={true} />)
        expect(screen.getByRole("button", { name: "Tasks" })).toHaveAttribute("aria-pressed", "true")
    })

    it("opens Rewards when its chip is clicked", () => {
        const onOpenMerchant = vi.fn()
        render(<NavActions onOpenMerchant={onOpenMerchant} />)
        fireEvent.click(screen.getByRole("button", { name: "Rewards" }))
        expect(onOpenMerchant).toHaveBeenCalledTimes(1)
    })

    it("marks the Rewards chip pressed only when its view is active", () => {
        const { rerender } = render(<NavActions merchantActive={false} />)
        expect(screen.getByRole("button", { name: "Rewards" })).toHaveAttribute("aria-pressed", "false")
        rerender(<NavActions merchantActive={true} />)
        expect(screen.getByRole("button", { name: "Rewards" })).toHaveAttribute("aria-pressed", "true")
    })
})

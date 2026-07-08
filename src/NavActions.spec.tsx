import { fireEvent, render, screen } from "@testing-library/react"
import { NavActions } from "./NavActions"

describe("NavActions", () => {
    it("renders the Bounties and Merchant nav chips", () => {
        render(<NavActions />)
        expect(screen.getByRole("button", { name: "Bounties" })).toBeInTheDocument()
        expect(screen.getByRole("button", { name: "Merchant" })).toBeInTheDocument()
    })

    it("opens Bounties when its chip is clicked", () => {
        const onOpenBounties = vi.fn()
        render(<NavActions onOpenBounties={onOpenBounties} />)
        fireEvent.click(screen.getByRole("button", { name: "Bounties" }))
        expect(onOpenBounties).toHaveBeenCalledTimes(1)
    })

    it("marks the Bounties chip pressed only when its view is active", () => {
        const { rerender } = render(<NavActions bountiesActive={false} />)
        expect(screen.getByRole("button", { name: "Bounties" })).toHaveAttribute("aria-pressed", "false")
        rerender(<NavActions bountiesActive={true} />)
        expect(screen.getByRole("button", { name: "Bounties" })).toHaveAttribute("aria-pressed", "true")
    })

    it("opens Merchant when its chip is clicked", () => {
        const onOpenMerchant = vi.fn()
        render(<NavActions onOpenMerchant={onOpenMerchant} />)
        fireEvent.click(screen.getByRole("button", { name: "Merchant" }))
        expect(onOpenMerchant).toHaveBeenCalledTimes(1)
    })

    it("marks the Merchant chip pressed only when its view is active", () => {
        const { rerender } = render(<NavActions merchantActive={false} />)
        expect(screen.getByRole("button", { name: "Merchant" })).toHaveAttribute("aria-pressed", "false")
        rerender(<NavActions merchantActive={true} />)
        expect(screen.getByRole("button", { name: "Merchant" })).toHaveAttribute("aria-pressed", "true")
    })
})

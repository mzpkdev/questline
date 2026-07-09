import { fireEvent, render, screen } from "@testing-library/react"
import type { Reward } from "./rewards"
import { RewardsBoard } from "./RewardsBoard"

const rewards: Reward[] = [
    { id: "reward-1", name: "Fancy coffee", price: 3 },
    { id: "reward-2", name: "Weekend trip", price: 40 }
]

const noop = () => {}

// gold=5 leaves the 3-gold reward affordable and the 40-gold one locked.
const renderBoard = (props: Partial<Parameters<typeof RewardsBoard>[0]> = {}) =>
    render(
        <RewardsBoard gold={5} rewards={rewards} onRedeem={noop} onOpenAdd={noop} onRemoveReward={noop} {...props} />
    )

describe("RewardsBoard", () => {
    it("renders each reward with its price and shows the purse balance", () => {
        renderBoard()
        expect(screen.getByText("Fancy coffee")).toBeInTheDocument()
        expect(screen.getByText("3")).toBeInTheDocument()
        expect(screen.getByText("Weekend trip")).toBeInTheDocument()
        expect(screen.getByLabelText("5 gold")).toBeInTheDocument()
    })

    it("redeems an affordable reward by id", () => {
        const onRedeem = vi.fn()
        renderBoard({ onRedeem })
        fireEvent.click(screen.getByRole("button", { name: "Redeem Fancy coffee" }))
        expect(onRedeem).toHaveBeenCalledWith("reward-1")
    })

    it("locks an unaffordable reward behind a disabled 'Need N more' button", () => {
        const onRedeem = vi.fn()
        renderBoard({ onRedeem })
        const button = screen.getByRole("button", { name: "Redeem Weekend trip" })
        expect(button).toBeDisabled()
        expect(button).toHaveTextContent("Need 35 more")
        fireEvent.click(button)
        expect(onRedeem).not.toHaveBeenCalled()
    })

    it("removes a reward only after confirming in the modal", async () => {
        const onRemoveReward = vi.fn()
        renderBoard({ onRemoveReward })
        // The × opens the confirm modal; nothing is removed yet.
        fireEvent.click(screen.getByRole("button", { name: "Remove Fancy coffee" }))
        expect(await screen.findByRole("alertdialog")).toHaveTextContent("Remove this reward?")
        expect(onRemoveReward).not.toHaveBeenCalled()
        // Confirming removes it.
        fireEvent.click(screen.getByRole("button", { name: "Remove" }))
        expect(onRemoveReward).toHaveBeenCalledWith("reward-1")
    })

    it("shows a redeemed reward as spent, with no redeem or remove action", () => {
        renderBoard({ rewards: [{ id: "reward-1", name: "Fancy coffee", price: 3, redeemedAt: 1_700_000_000_000 }] })
        expect(screen.getByText(/Redeemed/)).toBeInTheDocument()
        expect(screen.queryByRole("button", { name: "Redeem Fancy coffee" })).toBeNull()
        expect(screen.queryByRole("button", { name: "Remove Fancy coffee" })).toBeNull()
    })

    it("opens the add card from the + tile", () => {
        const onOpenAdd = vi.fn()
        renderBoard({ onOpenAdd })
        fireEvent.click(screen.getByRole("button", { name: "Add a reward" }))
        expect(onOpenAdd).toHaveBeenCalledTimes(1)
    })

    it("always offers the add tile, even with an empty shelf", () => {
        renderBoard({ rewards: [] })
        expect(screen.getByRole("button", { name: "Add a reward" })).toBeInTheDocument()
        expect(screen.queryByText("Fancy coffee")).not.toBeInTheDocument()
    })
})

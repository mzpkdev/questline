import { fireEvent, render, screen } from "@testing-library/react"
import { NavActions } from "./NavActions"

describe("NavActions", () => {
    it("renders the Tasks and Rewards nav chips", () => {
        render(<NavActions />)
        expect(screen.getByRole("button", { name: "Tasks" })).toBeInTheDocument()
        expect(screen.getByRole("button", { name: "Rewards" })).toBeInTheDocument()
    })

    it("opens Tasks when its chip is clicked", () => {
        const onOpenTasks = vi.fn()
        render(<NavActions onOpenTasks={onOpenTasks} />)
        fireEvent.click(screen.getByRole("button", { name: "Tasks" }))
        expect(onOpenTasks).toHaveBeenCalledTimes(1)
    })

    it("marks the Tasks chip pressed only when its view is active", () => {
        const { rerender } = render(<NavActions tasksActive={false} />)
        expect(screen.getByRole("button", { name: "Tasks" })).toHaveAttribute("aria-pressed", "false")
        rerender(<NavActions tasksActive={true} />)
        expect(screen.getByRole("button", { name: "Tasks" })).toHaveAttribute("aria-pressed", "true")
    })

    it("opens Rewards when its chip is clicked", () => {
        const onOpenRewards = vi.fn()
        render(<NavActions onOpenRewards={onOpenRewards} />)
        fireEvent.click(screen.getByRole("button", { name: "Rewards" }))
        expect(onOpenRewards).toHaveBeenCalledTimes(1)
    })

    it("marks the Rewards chip pressed only when its view is active", () => {
        const { rerender } = render(<NavActions rewardsActive={false} />)
        expect(screen.getByRole("button", { name: "Rewards" })).toHaveAttribute("aria-pressed", "false")
        rerender(<NavActions rewardsActive={true} />)
        expect(screen.getByRole("button", { name: "Rewards" })).toHaveAttribute("aria-pressed", "true")
    })
})

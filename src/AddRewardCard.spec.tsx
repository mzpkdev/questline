import { fireEvent, render, screen } from "@testing-library/react"
import { AddRewardCard } from "./MerchantBoard"

const noop = () => {}

describe("AddRewardCard", () => {
    it("renders the New reward form", () => {
        render(<AddRewardCard onAdd={noop} />)
        expect(screen.getByRole("heading", { name: "New reward" })).toBeInTheDocument()
        expect(screen.getByRole("textbox", { name: "Reward name" })).toBeInTheDocument()
        expect(screen.getByLabelText("Cost in gold")).toBeInTheDocument()
    })

    it("adds a reward on submit, not auto-replenishing by default", () => {
        const onAdd = vi.fn()
        render(<AddRewardCard onAdd={onAdd} />)
        fireEvent.change(screen.getByRole("textbox", { name: "Reward name" }), { target: { value: "Spa day" } })
        fireEvent.change(screen.getByLabelText("Cost in gold"), { target: { value: "12" } })
        fireEvent.click(screen.getByRole("button", { name: "Add reward" }))
        expect(onAdd).toHaveBeenCalledWith("Spa day", 12, false)
    })

    it("adds an auto-replenishing reward when the box is checked", () => {
        const onAdd = vi.fn()
        render(<AddRewardCard onAdd={onAdd} />)
        fireEvent.change(screen.getByRole("textbox", { name: "Reward name" }), { target: { value: "Espresso" } })
        fireEvent.change(screen.getByLabelText("Cost in gold"), { target: { value: "3" } })
        fireEvent.click(screen.getByRole("checkbox", { name: /auto-replenish/i }))
        fireEvent.click(screen.getByRole("button", { name: "Add reward" }))
        expect(onAdd).toHaveBeenCalledWith("Espresso", 3, true)
    })

    it("ignores a submission with a blank name", () => {
        const onAdd = vi.fn()
        render(<AddRewardCard onAdd={onAdd} />)
        fireEvent.click(screen.getByRole("button", { name: "Add reward" }))
        expect(onAdd).not.toHaveBeenCalled()
    })

    it("calls onExited once the closing animation ends", () => {
        const onExited = vi.fn()
        render(<AddRewardCard onAdd={noop} closing onExited={onExited} />)
        fireEvent.animationEnd(screen.getByTestId("add-reward-card"))
        expect(onExited).toHaveBeenCalledTimes(1)
    })
})

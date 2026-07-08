import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { ConfirmDialog } from "./ConfirmDialog"

describe("ConfirmDialog", () => {
    it("shows the title and message when open", () => {
        render(
            <ConfirmDialog open title="Remove this view?" message="Gone for good." onConfirm={vi.fn()} onOpenChange={vi.fn()} />
        )
        expect(screen.getByText("Remove this view?")).toBeInTheDocument()
        expect(screen.getByText("Gone for good.")).toBeInTheDocument()
    })

    it("renders nothing while closed", () => {
        render(<ConfirmDialog open={false} title="Remove this view?" onConfirm={vi.fn()} onOpenChange={vi.fn()} />)
        expect(screen.queryByText("Remove this view?")).not.toBeInTheDocument()
    })

    it("fires onConfirm when the confirm button is pressed", async () => {
        const onConfirm = vi.fn()
        render(<ConfirmDialog open title="Remove?" confirmLabel="Remove" onConfirm={onConfirm} onOpenChange={vi.fn()} />)
        await userEvent.click(screen.getByRole("button", { name: "Remove" }))
        expect(onConfirm).toHaveBeenCalledTimes(1)
    })
})

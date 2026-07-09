import { fireEvent, render, screen } from "@testing-library/react"
import { SfxProvider, useSfx, useSfxMute } from "./SfxProvider"
import { SoundToggle } from "./SoundToggle"

const withProvider = () =>
    render(
        <SfxProvider>
            <SoundToggle />
        </SfxProvider>
    )

describe("SfxProvider", () => {
    beforeEach(() => localStorage.clear())

    it("renders the mute toggle unmuted by default", () => {
        withProvider()
        expect(screen.getByRole("button", { name: "Mute sound effects" })).toHaveAttribute("aria-pressed", "false")
    })

    it("toggles the mute state and persists it across reloads", () => {
        withProvider()

        fireEvent.click(screen.getByRole("button", { name: "Mute sound effects" }))
        expect(screen.getByRole("button", { name: "Unmute sound effects" })).toHaveAttribute("aria-pressed", "true")
        expect(localStorage.getItem("questline:muted")).toBe("1")

        fireEvent.click(screen.getByRole("button", { name: "Unmute sound effects" }))
        expect(screen.getByRole("button", { name: "Mute sound effects" })).toBeInTheDocument()
        expect(localStorage.getItem("questline:muted")).toBe("0")
    })

    it("restores a persisted muted preference on mount", () => {
        localStorage.setItem("questline:muted", "1")
        withProvider()
        expect(screen.getByRole("button", { name: "Unmute sound effects" })).toHaveAttribute("aria-pressed", "true")
    })

    it("provides a usable kit and unmuted state without a provider, so isolated renders don't crash", () => {
        function Probe() {
            const sfx = useSfx()
            const { muted } = useSfxMute()
            return <span data-testid="probe">{`${typeof sfx.blip}:${muted}`}</span>
        }
        render(<Probe />)
        expect(screen.getByTestId("probe")).toHaveTextContent("function:false")
    })
})

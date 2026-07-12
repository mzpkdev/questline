// End-to-end wiring: renders the real <App/> inside <SfxProvider>, swaps in a fake AudioContext that
// records every oscillator it plays, and drives real interactions -- proving the chain
// (event handler -> useSfx -> kit -> WebAudio) fires the expected cue, not just that the kit works in
// isolation. jsdom has no WebAudio, so the fake is what makes the kit audible here.

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { App } from "./App"
import { SfxProvider } from "./SfxProvider"

type Voice = { type: OscillatorType; frequency: number }

// Filled by the fake context below; reset before each test.
let voices: Voice[] = []

// A structural stand-in for the slice of WebAudio the kit touches. Each oscillator records its final
// waveform + base frequency when started, so a test can assert which cue played.
class FakeAudioContext {
    currentTime = 0
    state: AudioContextState = "running"
    destination = {} as AudioDestinationNode

    resume() {
        return Promise.resolve()
    }

    createGain() {
        return {
            gain: {
                setValueAtTime() {},
                linearRampToValueAtTime() {},
                exponentialRampToValueAtTime() {}
            },
            connect: (node: unknown) => node
        }
    }

    createOscillator() {
        let frequency = 0
        const oscillator = {
            type: "sine" as OscillatorType,
            frequency: {
                setValueAtTime: (value: number) => {
                    frequency = value
                },
                exponentialRampToValueAtTime() {}
            },
            connect: (node: unknown) => node,
            start: () => voices.push({ type: oscillator.type, frequency }),
            stop() {}
        }
        return oscillator
    }
}

describe("sfx wiring", () => {
    beforeEach(() => {
        localStorage.clear()
        voices = []
        vi.stubGlobal("AudioContext", FakeAudioContext)
    })

    afterEach(() => vi.unstubAllGlobals())

    it("rings the coin cue when a task is crossed off, and stays silent on plain navigation", () => {
        render(
            <SfxProvider>
                <App />
            </SfxProvider>
        )

        // Navigation is not one of the kept cues, so it makes no sound.
        fireEvent.click(screen.getByRole("button", { name: "Tasks" }))
        expect(voices).toHaveLength(0)

        // Cross a seeded task off: toggleTask() on an open item -> coin (sine @ 1046.5).
        fireEvent.click(screen.getByRole("button", { name: /^Check Tick a task/ }))
        expect(voices.some((voice) => voice.type === "sine" && voice.frequency === 1046.5)).toBe(true)
    })

    it("ticks subtly when a node is selected on the canvas", async () => {
        render(
            <SfxProvider>
                <App />
            </SfxProvider>
        )

        // The app boots straight to the seed board; its root node card carries data-id + data-state.
        // Wait for React Flow to mount it, then click it -> selectFromCanvas() -> tick (sine @ 880).
        const node = await waitFor(() => {
            const el = document.querySelector('[data-id="learn"][data-state]')
            if (!el) throw new Error("root node not mounted")
            return el
        })
        fireEvent.click(node)
        expect(voices.some((voice) => voice.type === "sine" && voice.frequency === 880)).toBe(true)
    })

    it("stays silent while muted", () => {
        localStorage.setItem("questline:muted", "1")
        render(
            <SfxProvider>
                <App />
            </SfxProvider>
        )

        fireEvent.click(screen.getByRole("button", { name: "Tasks" }))
        fireEvent.click(screen.getByRole("button", { name: /^Check Tick a task/ }))
        expect(voices).toHaveLength(0)
    })

    it("fires the finale on a root completion but stays silent when a linked node masters from afar", async () => {
        // sfxWiring's beforeEach doesn't touch the hash; clear it so routing doesn't leak between tests.
        window.history.replaceState(null, "", window.location.pathname)
        render(
            <SfxProvider>
                <App />
            </SfxProvider>
        )
        const dataState = (id: string) => document.querySelector(`[data-id="${id}"][data-state]`)?.getAttribute("data-state")
        await waitFor(() => expect(document.querySelector('[data-id="learn"][data-state]')).not.toBeNull())

        // Add board B, then on the seed board convert finish-node into a linked node L aimed at B and hang a child C under it.
        fireEvent.click(screen.getByRole("button", { name: "Add board" }))
        await screen.findByDisplayValue("New Quest")
        fireEvent.click(screen.getByRole("button", { name: "Learn Questline" })) // back to A
        const leaf = await waitFor(() => {
            const el = document.querySelector('[data-id="finish-node"][data-state]')
            if (!el) throw new Error("finish-node not mounted")
            return el as HTMLElement
        })
        fireEvent.click(leaf)
        await screen.findByRole("heading", { name: /finish a node/i })
        fireEvent.click(screen.getByRole("button", { name: "Edit" }))
        fireEvent.click(screen.getByRole("button", { name: "Convert to linked node" }))
        fireEvent.click(await screen.findByRole("button", { name: "Convert" }))
        const dropdown = await screen.findByRole("combobox", { name: "Link to board" })
        const option = within(dropdown).getByRole("option", { name: "New Quest" }) as HTMLOptionElement
        fireEvent.change(dropdown, { target: { value: option.value } })
        fireEvent.click(screen.getByRole("button", { name: "Add child node" }))
        await waitFor(() => expect(window.location.hash).toMatch(/^#node-/))
        const childId = window.location.hash.slice(1)
        await waitFor(() => expect(dataState(childId)).toBe("locked")) // gated under the incomplete link

        // Completing board B's ROOT node fires the finale fanfare (a root completion is audible).
        fireEvent.click(screen.getByRole("button", { name: "New Quest" }))
        fireEvent.click(await screen.findByRole("button", { name: "Complete Quest" }))
        await waitFor(() => expect(voices.length).toBeGreaterThan(0))

        // Switch back to A: L masters because B finished elsewhere, so C unlocks -- but that derived flip
        // is SILENT (no fanfare, no success cue).
        voices = []
        fireEvent.click(screen.getByRole("button", { name: "Learn Questline" }))
        await waitFor(() => expect(dataState(childId)).toBe("available"))
        expect(voices).toHaveLength(0)
    })
})

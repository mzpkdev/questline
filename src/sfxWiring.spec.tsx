// End-to-end wiring: renders the real <App/> inside <SfxProvider>, swaps in a fake AudioContext that
// records every oscillator it plays, and drives real interactions -- proving the chain
// (event handler -> useSfx -> kit -> WebAudio) fires the expected cue, not just that the kit works in
// isolation. jsdom has no WebAudio, so the fake is what makes the kit audible here.

import { fireEvent, render, screen, waitFor } from "@testing-library/react"
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
})

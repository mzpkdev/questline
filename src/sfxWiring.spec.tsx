// End-to-end wiring: renders the real <App/> inside <SfxProvider>, swaps in a fake AudioContext that
// records every oscillator it plays, and drives real interactions -- proving the chain
// (event handler -> useSfx -> kit -> WebAudio) fires the expected cue, not just that the kit works in
// isolation. jsdom has no WebAudio, so the fake is what makes the kit audible here.

import { fireEvent, render, screen } from "@testing-library/react"
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

    it("pops when a to-do is crossed off, and stays silent on plain navigation", () => {
        render(
            <SfxProvider>
                <App />
            </SfxProvider>
        )

        // Navigation is not one of the kept cues, so it makes no sound.
        fireEvent.click(screen.getByRole("button", { name: "Bounties" }))
        expect(voices).toHaveLength(0)

        // Cross a seeded bounty off: toggleBounty() on an open item -> pop (triangle @ 520).
        fireEvent.click(screen.getByRole("button", { name: /^Check Tick a bounty/ }))
        expect(voices.some((voice) => voice.type === "triangle" && voice.frequency === 520)).toBe(true)
    })

    it("stays silent while muted", () => {
        localStorage.setItem("questline:muted", "1")
        render(
            <SfxProvider>
                <App />
            </SfxProvider>
        )

        fireEvent.click(screen.getByRole("button", { name: "Bounties" }))
        fireEvent.click(screen.getByRole("button", { name: /^Check Tick a bounty/ }))
        expect(voices).toHaveLength(0)
    })
})

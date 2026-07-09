// Zero-asset WebAudio SFX kit -- synthesized one-shot sound effects, no audio files to host or ship.
// Questline is a medieval quest board (parchment, gold, Cinzel type), so the cues are warm struck
// bells and a harp-like pluck rather than chiptune bleeps: a soft pluck when a to-do is ticked, rising
// hand-bells when a milestone lands, a bright coin clink at the rewards, and a regal bell fanfare when
// a whole quest is done. This is the audio counterpart to the app's visual juice (node seal, purse
// bump, goal-celebration burst).
//
// House style: a callable factory of free functions over closure-private state (no data class, no
// destroy() -- a single lazy AudioContext is the only resource and it is fine to share for the page's
// lifetime). Returns a frozen record of bound effect functions plus unlock / setMuted / isMuted.
//
// Audio is a SIDE EFFECT: fire these from event handlers or from an effect that observes a real state
// transition (see App). Never call them from a pure module (tasks.ts, rewards.ts, graph.ts) or
// from a component's render body.
//
// Synthesis model: every voice is an OscillatorNode -> GainNode -> destination chain with a short gain
// envelope (a fast linear attack and an exponential decay to near-silence). The exponential tail is
// what stops the audible "click" you get from cutting a tone off at non-zero amplitude. Timbre comes
// from `strike`, which layers a fundamental with quiet inharmonic overtones (the ratios a real bell or
// plucked string rings at), so a plain oscillator reads as a struck bell instead of a synth tone.
//
// Browser gesture policy: an AudioContext starts `suspended` until a user gesture resumes it, so the
// context is created and resumed lazily on the first effect (or unlock()) call. SfxProvider wires
// unlock() into the first pointerdown / keydown so the very first effect is audible.
//
// SSR / non-DOM safe: every entry point guards `typeof window` and the presence of an AudioContext
// constructor, so importing and calling this on the server (or in a jsdom test without WebAudio, as
// this repo's Vitest suite does) is a silent no-op rather than a throw.
//
// @example
//   import { createSfx } from "./sfx"
//   const sfx = createSfx()
//   window.addEventListener("pointerdown", () => sfx.unlock(), { once: true })
//   sfx.pop()      // a to-do ticked off
//   sfx.success()  // a milestone completed
//   sfx.fanfare()  // the whole quest done

/**
 * One-shot sound effect. Fire-and-forget: schedules an oscillator + envelope and returns immediately. A
 * no-op when muted, locked-out by the browser, or running without WebAudio (SSR / tests).
 */
export type SoundEffect = () => void

/**
 * The public surface returned by {@link createSfx}: the named one-shot effects plus the lifecycle
 * controls. Frozen so callers can destructure freely without risk of reassigning an effect.
 *
 * @property blip    - A soft single bell tap -- a light confirm (used for the unmute cue). ~160ms.
 * @property pop     - A warm harp-like pluck (fundamental + a quiet octave). A spare cue; the app
 *                     currently uses tick for crossing a to-do off. Triangle, ~200ms.
 * @property success - Two rising struck hand-bells with inharmonic overtones -- a milestone completed.
 *                     Sine, ~550ms.
 * @property error   - A soft low two-note fall -- a muted "denied", not a buzzer. Triangle, ~280ms.
 * @property tick    - A very short, very quiet click -- selecting a node or chip, and ticking a
 *                     milestone's checklist box. Sine, ~50ms.
 * @property coin    - A bright metallic clink -- gold into the purse when a reward is redeemed, or a
 *                     standalone task crossed off. Sine bells, higher/tighter than success. ~280ms.
 * @property fanfare - The finale: a regal rising bell arpeggio over a low root with a shimmer on top --
 *                     a whole quest's goal completed. The loudest/longest cue; pairs with the on-screen
 *                     goal celebration. ~950ms.
 * @property unlock  - Resume the (lazily created) AudioContext. Call from the first user gesture.
 *                     Idempotent and safe to call eagerly.
 * @property setMuted - Toggle the global mute flag. While muted every effect is a no-op; the context is
 *                      left intact so unmuting is instant.
 * @property isMuted  - Read the current mute flag.
 */
export interface Sfx {
    readonly blip: SoundEffect
    readonly pop: SoundEffect
    readonly success: SoundEffect
    readonly error: SoundEffect
    readonly tick: SoundEffect
    readonly coin: SoundEffect
    readonly fanfare: SoundEffect
    readonly unlock: () => void
    readonly setMuted: (muted: boolean) => void
    readonly isMuted: () => boolean
}

/**
 * Minimal cross-browser constructor lookup. Standards browsers expose `AudioContext`; older WebKit only
 * had `webkitAudioContext`. Returns `undefined` when neither exists (SSR, jsdom, ancient runtimes) so
 * callers can bail to a no-op.
 */
type AudioContextConstructor = new () => AudioContext

const resolveAudioContextConstructor = (): AudioContextConstructor | undefined => {
    if (typeof window === "undefined") return undefined
    const candidate =
        window.AudioContext ?? (window as { webkitAudioContext?: AudioContextConstructor }).webkitAudioContext
    return candidate
}

// Exponential ramps cannot target 0, so decay to this tiny floor instead.
const SILENCE = 0.0001

/**
 * One voice of the synth: a single oscillator routed through its own gain node, shaped by a fast attack
 * and an exponential decay back to (near) silence.
 *
 * The envelope is the whole game here. We:
 *   1. start gain at SILENCE at `startTime`,
 *   2. linear-ramp up to `peak` over `attack` seconds (the transient), then
 *   3. exponential-ramp down to SILENCE by `startTime + duration`.
 *
 * Stopping the oscillator a hair after the decay completes means amplitude is already ~0, so there is
 * no discontinuity and therefore no click.
 *
 * @param context   - The shared, already-resumed audio context.
 * @param type      - Oscillator waveform.
 * @param frequency - Base frequency in Hz at `startTime`.
 * @param startTime - `context.currentTime`-relative absolute start, in seconds.
 * @param duration  - Total voice length in seconds (attack + decay).
 * @param peak      - Peak gain after the attack ramp (0..1). Kept well under 1 so layered voices don't
 *                    clip the destination.
 * @param attack    - Attack time in seconds; defaults to a 3ms transient (a struck / plucked onset).
 */
const playVoice = (
    context: AudioContext,
    type: OscillatorType,
    frequency: number,
    startTime: number,
    duration: number,
    peak: number,
    attack: number = 0.003
): void => {
    const oscillator = context.createOscillator()
    const gain = context.createGain()

    oscillator.type = type
    oscillator.frequency.setValueAtTime(frequency, startTime)

    // Envelope: SILENCE -> peak (linear attack) -> SILENCE (exponential decay).
    gain.gain.setValueAtTime(SILENCE, startTime)
    gain.gain.linearRampToValueAtTime(peak, startTime + attack)
    gain.gain.exponentialRampToValueAtTime(SILENCE, startTime + duration)

    oscillator.connect(gain).connect(context.destination)
    oscillator.start(startTime)
    // Stop slightly past the decay so the tail fully rings out before teardown.
    oscillator.stop(startTime + duration + 0.02)
}

/**
 * One overtone above a struck fundamental: a frequency `ratio` times the fundamental, at `gain` times
 * its peak, ringing for `decay` times its duration. Real bells / plucked strings ring at *inharmonic*
 * ratios (not clean octaves), and it is those overtones -- brief and quiet -- that make a bare
 * oscillator read as struck metal or wood rather than a synth tone.
 */
type Partial = { ratio: number; gain: number; decay?: number }

/**
 * A struck / plucked tone: the `fundamental` plus its `partials`, all sharing one onset. Layer a few of
 * these (staggered in time) to build a bell peal or an arpeggio.
 */
const strike = (
    context: AudioContext,
    startTime: number,
    fundamental: number,
    duration: number,
    peak: number,
    partials: Partial[] = [],
    type: OscillatorType = "sine"
): void => {
    playVoice(context, type, fundamental, startTime, duration, peak)
    for (const partial of partials) {
        playVoice(context, type, fundamental * partial.ratio, startTime, duration * (partial.decay ?? 1), peak * partial.gain)
    }
}

// Bell overtones (inharmonic) for the mid-register hand-bells and the fanfare.
const BELL: Partial[] = [
    { ratio: 2.4, gain: 0.42, decay: 0.85 },
    { ratio: 3.9, gain: 0.18, decay: 0.6 }
]

/**
 * Builds an {@link Sfx} kit bound to a single lazily-created AudioContext.
 *
 * Nothing touches WebAudio until the first effect or {@link Sfx.unlock} call, so constructing the kit
 * is cheap and SSR-safe. The context is created once and reused for every effect for the lifetime of
 * the page; there is intentionally no `destroy()`. To silence the app, mute it.
 *
 * @returns A frozen kit of named one-shot effects plus `unlock` / `setMuted` / `isMuted`. Every effect
 *          is a no-op until unlocked, while muted, and whenever WebAudio is unavailable.
 */
export const createSfx = (): Sfx => {
    const AudioContextCtor = resolveAudioContextConstructor()
    let context: AudioContext | null = null
    let muted = false

    /**
     * Returns a usable, resumed context, creating it on first use. Returns `null` when WebAudio is
     * unavailable (SSR / tests) so every effect degrades to a no-op. `resume()` is best-effort -- it
     * rejects if called outside a user gesture, which we swallow; the next call after a real gesture
     * succeeds.
     */
    const ensureContext = (): AudioContext | null => {
        if (AudioContextCtor === undefined) return null
        if (context === null) context = new AudioContextCtor()
        if (context.state === "suspended") void context.resume()
        return context
    }

    /**
     * Schedules `play` against the live context starting a hair in the future, so the attack ramp's
     * first sample lands cleanly. Centralizes the mute / no-op guards so each effect body stays
     * declarative.
     */
    const schedule = (play: (context: AudioContext, startTime: number) => void): void => {
        if (muted) return
        const liveContext = ensureContext()
        if (liveContext === null) return
        play(liveContext, liveContext.currentTime + 0.001)
    }

    const blip: SoundEffect = () =>
        schedule((context, t) => {
            // A soft bell tap (fundamental + a quiet octave) -- the light confirm behind the unmute cue.
            strike(context, t, 587.33, 0.16, 0.14, [{ ratio: 2, gain: 0.3 }])
        })

    const pop: SoundEffect = () =>
        schedule((context, t) => {
            // A warm harp-like pluck: a triangle fundamental with a quiet octave, ringing out fast. It
            // fires on every box ticked, so it stays short and gentle.
            strike(context, t, 587.33, 0.2, 0.17, [{ ratio: 2, gain: 0.3 }], "triangle")
        })

    const success: SoundEffect = () =>
        schedule((context, t) => {
            // Two rising struck hand-bells (A4 -> E5) with inharmonic overtones -- a small, warm chime.
            strike(context, t, 440, 0.5, 0.16, BELL)
            strike(context, t + 0.13, 659.25, 0.55, 0.16, BELL)
        })

    const error: SoundEffect = () =>
        schedule((context, t) => {
            // A soft low two-note fall (A3 -> E3) -- a muted "denied", rounded rather than a buzzer.
            playVoice(context, "triangle", 220, t, 0.24, 0.16)
            playVoice(context, "triangle", 164.81, t + 0.12, 0.28, 0.16)
        })

    const tick: SoundEffect = () =>
        schedule((context, t) => {
            // A very short, very quiet click for incidental feedback.
            playVoice(context, "sine", 880, t, 0.05, 0.06)
        })

    const coin: SoundEffect = () =>
        schedule((context, t) => {
            // Two quick bright metallic clinks (C6 -> E6) with a single high overtone -- gold into the
            // purse. Higher and tighter than success so a purchase reads distinctly.
            strike(context, t, 1046.5, 0.24, 0.15, [{ ratio: 2.76, gain: 0.5, decay: 0.7 }])
            strike(context, t + 0.08, 1318.51, 0.28, 0.15, [{ ratio: 2.76, gain: 0.5, decay: 0.6 }])
        })

    const fanfare: SoundEffect = () =>
        schedule((context, t) => {
            // A regal rising bell arpeggio (G major: G4 B4 D5 G5) over a low G3 root, with a high D6
            // shimmer over the top -- the finale when a whole quest's goal is done. Peaks are kept low
            // because many voices overlap.
            playVoice(context, "triangle", 196, t, 0.9, 0.1)
            const notes = [392, 493.88, 587.33, 783.99]
            notes.forEach((frequency, i) => {
                const isLast = i === notes.length - 1
                strike(context, t + i * 0.1, frequency, isLast ? 0.85 : 0.5, 0.14, BELL)
            })
            playVoice(context, "sine", 1174.66, t + 0.34, 0.7, 0.06)
        })

    const unlock = (): void => {
        // Touching the context inside a user gesture resumes it for every later effect. Best-effort;
        // harmless to call repeatedly.
        ensureContext()
    }

    const setMuted = (next: boolean): void => {
        muted = next
    }

    const isMuted = (): boolean => muted

    return Object.freeze({ blip, pop, success, error, tick, coin, fanfare, unlock, setMuted, isMuted })
}

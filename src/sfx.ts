// Zero-asset WebAudio SFX kit -- synthesized one-shot sound effects, no audio files to host or ship.
// Questline mimics a mobile game's "juice", so each interaction gets a short, distinct cue: a soft pop
// when you tick a task off, a rising chime when a milestone lands, a coin ka-ching at the merchant, and
// a fanfare when a whole quest is done. This is the audio counterpart to the app's existing visual juice
// (node seal, purse bump, goal-celebration burst).
//
// House style: a callable factory of free functions over closure-private state (no data class, no
// destroy() -- a single lazy AudioContext is the only resource and it is fine to share for the page's
// lifetime). Returns a frozen record of bound effect functions plus unlock / setMuted / isMuted.
//
// Audio is a SIDE EFFECT: fire these from event handlers or from effects that observe a real state
// transition (see SfxProvider / App). Never call them from a pure module (bounties.ts, merchant.ts,
// graph.ts) or from a component's render body.
//
// Synthesis model: every voice is an OscillatorNode -> GainNode -> destination chain with a short gain
// envelope (a fast linear attack and an exponential decay to near-silence). The exponential tail is what
// stops the audible "click" you get from cutting a tone off at non-zero amplitude. A distinct waveform /
// frequency / duration per effect gives each its character; the richer cues (success, coin, fanfare)
// layer a few staggered voices into a short melody.
//
// Browser gesture policy: an AudioContext starts `suspended` until a user gesture resumes it, so the
// context is created and resumed lazily on the first effect (or unlock()) call. SfxProvider wires
// unlock() into the first pointerdown / keydown so the very first effect is audible.
//
// SSR / non-DOM safe: every entry point guards `typeof window` and the presence of an AudioContext
// constructor, so importing and calling this on the server (or in a jsdom test without WebAudio, as this
// repo's Vitest suite does) is a silent no-op rather than a throw.
//
// @example
//   import { createSfx } from "./sfx"
//   const sfx = createSfx()
//   window.addEventListener("pointerdown", () => sfx.unlock(), { once: true })
//   sfx.pop()      // a task ticked off
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
 * @property blip    - Short neutral UI tick -- a confirm / create (add a bounty, reward, milestone, or
 *                     view; open a section). Square wave, mid pitch, ~80ms.
 * @property pop     - Bright bubble "pop" -- a single thing crossed off (a bounty or a milestone
 *                     checklist box ticked). Triangle wave with a quick upward bend, ~120ms.
 * @property success - Rising two-note arpeggio -- a milestone completed. Sine, ~260ms.
 * @property error   - Low buzzy descending tone -- something rejected (an invalid import). Sawtooth,
 *                     low pitch, ~220ms.
 * @property tick    - Very short, very quiet high click -- lightweight feedback that fires often
 *                     (selecting a node, dropping a drag, un-checking, removing). Square wave, ~35ms.
 * @property coin    - Two-note metallic "ka-ching" -- a reward redeemed at the merchant (gold spent).
 *                     Triangle, ~230ms.
 * @property fanfare - The finale: a rising major arpeggio with a sparkle on top -- a whole quest's goal
 *                     completed. The loudest/longest cue; pairs with the on-screen goal celebration.
 *                     Sine + triangle, ~700ms.
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
 * Stopping the oscillator a hair after the decay completes means amplitude is already ~0, so there is no
 * discontinuity and therefore no click.
 *
 * @param context   - The shared, already-resumed audio context.
 * @param type      - Oscillator waveform.
 * @param frequency - Base frequency in Hz at `startTime`.
 * @param startTime - `context.currentTime`-relative absolute start, in seconds.
 * @param duration  - Total voice length in seconds (attack + decay).
 * @param peak      - Peak gain after the attack ramp (0..1). Kept well under 1 so layered voices don't
 *                    clip the destination.
 * @param attack    - Attack time in seconds; defaults to a 4ms transient.
 * @param bendTo    - Optional target frequency to glide to by the voice end (exponential pitch ramp) --
 *                    used for the "pop" and "error" bends.
 */
const playVoice = (
    context: AudioContext,
    type: OscillatorType,
    frequency: number,
    startTime: number,
    duration: number,
    peak: number,
    attack: number = 0.004,
    bendTo?: number
): void => {
    const oscillator = context.createOscillator()
    const gain = context.createGain()

    oscillator.type = type
    oscillator.frequency.setValueAtTime(frequency, startTime)
    if (bendTo !== undefined) {
        // Exponential glide reads as a "bend"; target must be > 0.
        oscillator.frequency.exponentialRampToValueAtTime(Math.max(bendTo, 1), startTime + duration)
    }

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
 * Builds an {@link Sfx} kit bound to a single lazily-created AudioContext.
 *
 * Nothing touches WebAudio until the first effect or {@link Sfx.unlock} call, so constructing the kit is
 * cheap and SSR-safe. The context is created once and reused for every effect for the lifetime of the
 * page; there is intentionally no `destroy()`. To silence the app, mute it.
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
            playVoice(context, "square", 440, t, 0.08, 0.18)
        })

    const pop: SoundEffect = () =>
        schedule((context, t) => {
            // Triangle body with a quick upward bend -> a bright, friendly "pop".
            playVoice(context, "triangle", 520, t, 0.12, 0.22, 0.004, 880)
        })

    const success: SoundEffect = () =>
        schedule((context, t) => {
            // Two-note rising arpeggio (E5 -> A5). The second note starts as the first is decaying, so
            // they overlap into a perceived "ta-da".
            playVoice(context, "sine", 659.25, t, 0.14, 0.2)
            playVoice(context, "sine", 880, t + 0.1, 0.18, 0.2)
        })

    const error: SoundEffect = () =>
        schedule((context, t) => {
            // Low sawtooth with a downward bend -> a buzzy "nope".
            playVoice(context, "sawtooth", 196, t, 0.22, 0.2, 0.004, 110)
        })

    const tick: SoundEffect = () =>
        schedule((context, t) => {
            // Very short, very quiet high click for lightweight per-action feedback.
            playVoice(context, "square", 1320, t, 0.035, 0.08)
        })

    const coin: SoundEffect = () =>
        schedule((context, t) => {
            // Two quick bright notes (B5 -> E6) -> a minted "ka-ching" for a reward bought with gold.
            playVoice(context, "triangle", 987.77, t, 0.09, 0.2)
            playVoice(context, "triangle", 1318.51, t + 0.07, 0.16, 0.22)
        })

    const fanfare: SoundEffect = () =>
        schedule((context, t) => {
            // A rising major arpeggio (C5 E5 G5 C6), each note ringing under the next, with a high G6
            // sparkle over the top -> the finale when a whole quest's goal is done. Peaks are kept low
            // because up to three voices overlap at once.
            const notes = [523.25, 659.25, 783.99, 1046.5]
            for (let i = 0; i < notes.length; i++) {
                const frequency = notes[i]
                if (frequency === undefined) continue
                const isLast = i === notes.length - 1
                playVoice(context, isLast ? "triangle" : "sine", frequency, t + i * 0.09, isLast ? 0.5 : 0.34, 0.16)
            }
            playVoice(context, "sine", 1567.98, t + 0.3, 0.5, 0.08)
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

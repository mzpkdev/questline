// Makes the one WebAudio SFX kit (src/sfx.ts) available to the whole tree, and owns the two bits of
// lifecycle a React app has to add around it: resuming the AudioContext on the first user gesture (the
// browser keeps it suspended until then), and a mute flag that persists across reloads. main.tsx wraps
// <App/> in this provider; components reach the kit with useSfx() and the mute toggle with useSfxMute().
//
// Firing rules live at the call sites, not here -- see App.tsx / DetailCard.tsx / IoButtons.tsx /
// SyncBoard.tsx, where effects fire from event handlers (or effects that observe a real state change),
// never from a pure module or a render body.

import { createContext, type ReactNode, useContext, useEffect, useMemo, useRef, useState } from "react"
import { createSfx, type Sfx } from "./sfx"

// localStorage key for the persisted mute preference, matching the app's other `questline:*` keys
// (sync uses the same namespace). "1" = muted, anything else = unmuted (the default).
const MUTED_KEY = "questline:muted"

type SfxContextValue = {
    // The one-shot effects + unlock. A stable reference for the app's lifetime, so handlers can depend
    // on it without churn.
    sfx: Sfx
    // Reactive mirror of the kit's mute flag, so the toggle button can render on/off and re-render when
    // it flips.
    muted: boolean
    setMuted: (muted: boolean) => void
}

// No provider in the tree (e.g. a component spec that renders in isolation): fall back to a real kit so
// callers never crash. It's a silent no-op under jsdom / SSR anyway, and harmless in the browser.
let fallback: Sfx | null = null
const fallbackKit = (): Sfx => (fallback ??= createSfx())

const SfxContext = createContext<SfxContextValue | null>(null)

const readMuted = (): boolean => {
    try {
        return localStorage.getItem(MUTED_KEY) === "1"
    } catch {
        return false
    }
}

const writeMuted = (muted: boolean): void => {
    try {
        localStorage.setItem(MUTED_KEY, muted ? "1" : "0")
    } catch {
        // Private mode / disabled storage: the in-memory flag still works for this session.
    }
}

export function SfxProvider({ children }: { children: ReactNode }) {
    // One kit for the whole app, created once. Lazy inside the ref so it isn't rebuilt on re-render.
    const sfxRef = useRef<Sfx | null>(null)
    if (sfxRef.current === null) sfxRef.current = createSfx()
    const sfx = sfxRef.current

    const [muted, setMutedState] = useState<boolean>(readMuted)

    // Keep the kit and storage in step with the React flag. Runs on mount too, so a persisted "muted"
    // is honoured before the first effect can fire.
    useEffect(() => {
        sfx.setMuted(muted)
        writeMuted(muted)
    }, [sfx, muted])

    // Resume the AudioContext on the first gesture, so the very first effect is audible rather than
    // swallowed by the browser's autoplay lock. Both listeners are one-shot and torn down on unmount.
    useEffect(() => {
        const onGesture = () => sfx.unlock()
        window.addEventListener("pointerdown", onGesture, { once: true })
        window.addEventListener("keydown", onGesture, { once: true })
        return () => {
            window.removeEventListener("pointerdown", onGesture)
            window.removeEventListener("keydown", onGesture)
        }
    }, [sfx])

    // `sfx` is ref-stable, so the value's identity changes only when `muted` flips (a rare user action).
    const value = useMemo<SfxContextValue>(() => ({ sfx, muted, setMuted: setMutedState }), [sfx, muted])

    return <SfxContext.Provider value={value}>{children}</SfxContext.Provider>
}

/**
 * The SFX kit for firing effects. Stable across renders. Safe to call without a provider (returns an
 * inert fallback kit), so components render fine in isolation / under test.
 */
export function useSfx(): Sfx {
    return useContext(SfxContext)?.sfx ?? fallbackKit()
}

/**
 * The reactive mute state + setter, for the speaker toggle. Without a provider it reports unmuted and
 * the setter is a no-op.
 */
export function useSfxMute(): { muted: boolean; setMuted: (muted: boolean) => void } {
    const context = useContext(SfxContext)
    if (!context) return { muted: false, setMuted: () => {} }
    return { muted: context.muted, setMuted: context.setMuted }
}

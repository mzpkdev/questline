// Node + edge motion helpers. One hook, `useNodeMotion`, drives every per-card animation off a single
// ref: the arrival pop (an edge reaches this node), the unlock ignite (locked -> available), the
// complete seal (this node just got mastered), and the spawn (added after the tree settled). Kept
// together so the reduced-motion guard and the WAAPI plumbing live in one place; the edge reuses
// `prefersReducedMotion` + the arrival dispatch.

import { createContext, useContext, useEffect, useLayoutEffect, useRef } from "react"
import type { NodeState } from "./nodes"

export const NODE_REACHED = "questline:node-reached"

export const prefersReducedMotion = () =>
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches

export function dispatchNodeReached(id: string) {
    if (typeof window === "undefined") return
    window.dispatchEvent(new CustomEvent(NODE_REACHED, { detail: { id } }))
}

// True once the tree has finished its first mount, so a node mounting *after* this is a genuine add
// (scale/fade in) rather than an initial-load or tab-switch remount (which should stay still). The
// tree flips it a tick after mounting; each node reads it at its own mount.
export const SpawnReadyContext = createContext(false)

// Arrival: the index.css `nodeFlash` look (a gold light bloom + brightness lift). Filter-only, so it
// never fights the card's hover scale transform.
const POP_KEYFRAMES: Keyframe[] = [
    { filter: "none", offset: 0 },
    { filter: "drop-shadow(0 0 16px rgba(245, 214, 110, 0.95)) brightness(1.14)", offset: 0.3 },
    { filter: "none", offset: 1 }
]
const POP_TIMING: KeyframeAnimationOptions = { duration: 520, easing: "ease-out" }

// Complete: a calm gold seal on the node you just mastered. Glow only, no scale -- a completed node
// recedes into its dimmed look, so an outward pop fought that "settling" feel.
const STAMP_KEYFRAMES: Keyframe[] = [
    { filter: "none", offset: 0 },
    { filter: "drop-shadow(0 0 18px rgba(245, 214, 110, 0.98)) brightness(1.16)", offset: 0.3 },
    { filter: "none", offset: 1 }
]
const STAMP_TIMING: KeyframeAnimationOptions = { duration: 560, easing: "ease-out" }

// Unlock: a node lighting up as it goes locked -> available. Glow only (it's brightening from its dim
// locked look), warmer + longer than the seal, then the available halo pulse takes over.
const UNLOCK_KEYFRAMES: Keyframe[] = [
    { filter: "none", offset: 0 },
    { filter: "drop-shadow(0 0 16px rgba(230, 196, 88, 0.95)) brightness(1.13)", offset: 0.4 },
    { filter: "none", offset: 1 }
]
const UNLOCK_TIMING: KeyframeAnimationOptions = { duration: 640, easing: "ease-out" }

// Overshoot easing gives the spawn pop its snap.
const BOUNCE = "cubic-bezier(.34,1.56,.64,1)"

// Spawn: a fresh node pops in from small + transparent.
const SPAWN_KEYFRAMES: Keyframe[] = [
    { transform: "scale(.72)", opacity: 0, offset: 0 },
    { transform: "scale(1)", opacity: 1, offset: 1 }
]
const SPAWN_TIMING: KeyframeAnimationOptions = { duration: 340, easing: BOUNCE }

// Check: a soft gold glow on the box when it's ticked. Glow only, no scale -- a bounce read as annoying.
const CHECK_KEYFRAMES: Keyframe[] = [
    { filter: "none", offset: 0 },
    { filter: "drop-shadow(0 0 6px rgba(233, 185, 73, 0.8))", offset: 0.4 },
    { filter: "none", offset: 1 }
]
const CHECK_TIMING: KeyframeAnimationOptions = { duration: 300, easing: "ease-out" }

const canAnimate = (el: HTMLElement | null): el is HTMLElement =>
    !!el && !prefersReducedMotion() && typeof el.animate === "function"

// Attach the returned ref to a node card's root element. `state` is the node's tri-state; a seal
// fires on the step into "mastered", an unlock ignite on "locked" -> "available".
export function useNodeMotion<T extends HTMLElement>(id: string, state: NodeState) {
    const ref = useRef<T>(null)
    const spawnReady = useContext(SpawnReadyContext)

    // Spawn on mount, but only for nodes added after the tree settled (spawnReady read at mount).
    // biome-ignore lint/correctness/useExhaustiveDependencies: fires once, on this node's own mount
    useEffect(() => {
        if (spawnReady && canAnimate(ref.current)) ref.current.animate(SPAWN_KEYFRAMES, SPAWN_TIMING)
    }, [])

    // Arrival: pop when an edge finishes growing into this id.
    useEffect(() => {
        const onReached = (event: Event) => {
            if ((event as CustomEvent<{ id: string }>).detail?.id !== id) return
            if (canAnimate(ref.current)) ref.current.animate(POP_KEYFRAMES, POP_TIMING)
        }
        window.addEventListener(NODE_REACHED, onReached)
        return () => window.removeEventListener(NODE_REACHED, onReached)
    }, [id])

    // Seal on entering "mastered", ignite on "locked" -> "available". Neither fires on mount (prev
    // seeds to the current state) or on un-complete ("mastered" -> "available").
    const prevState = useRef(state)
    useLayoutEffect(() => {
        const prev = prevState.current
        prevState.current = state
        const el = ref.current
        if (!canAnimate(el)) return
        if (state === "mastered" && prev !== "mastered") el.animate(STAMP_KEYFRAMES, STAMP_TIMING)
        else if (state === "available" && prev === "locked") el.animate(UNLOCK_KEYFRAMES, UNLOCK_TIMING)
    }, [state])

    return ref
}

// Attach the returned ref to a checklist box; it bounces when `done` turns true (a fresh tick), never
// on mount (so opening a card with already-ticked items stays still) or on un-tick.
export function useCheckPop<T extends HTMLElement>(done: boolean) {
    const ref = useRef<T>(null)
    const wasDone = useRef(done)
    useLayoutEffect(() => {
        const justChecked = done && !wasDone.current
        wasDone.current = done
        if (justChecked && canAnimate(ref.current)) ref.current.animate(CHECK_KEYFRAMES, CHECK_TIMING)
    }, [done])
    return ref
}

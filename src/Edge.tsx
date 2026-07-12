import { type EdgeProps, getBezierPath } from "@xyflow/react"
import { useLayoutEffect, useRef } from "react"
import type { NodeFlowEdge } from "./flow"
import { dispatchNodeReached, prefersReducedMotion } from "./nodeMotion"

// A downward link: the parent (source) sits above with its bottom handle, the child (target)
// below with its top handle. The link reads as a dotted "planned" thread until the child is
// complete, at which point it lights gold. This mirrors the mockup's renderLinks (two stacked
// paths, a soft "under" glow beneath a crisp "over" stroke) and its #link-lit gradient.
//
// Juice: when the child below completes, the link doesn't just pop gold -- it *grows* along the
// thread. Progress climbs leaves -> root, so the completion "charges" upward from the just-finished
// child toward the parent it unlocks. The bezier runs source(parent, top) -> target(child, bottom),
// so revealing from the target end (dashoffset from -length up to 0) draws the stroke upward. Flip
// GROW_TOWARD_PARENT to grow downward instead.
//
// The gold draws in *on top of the old line*: when lit, the dotted "planned" thread stays put as a
// static ghost beneath, and the gold sweeps up over it, so the link fills in rather than replacing.
const GROW_TOWARD_PARENT = true
const GROW_MS = 600
// Snappy start, soft settle -- the head shoots off the finished node and eases into the target.
const GROW_EASING = "cubic-bezier(.22,1,.36,1)"

// Draw a path in from one end using a dash the length of the path itself: park the gap over the
// whole stroke (offset = ±length, fully hidden), then slide it off to offset 0 (fully drawn). The
// sign of the start offset picks which end leads. Returns the running Animation, or null if the
// element can't be measured/animated (jsdom, or a not-yet-laid-out path).
function drawIn(el: SVGPathElement | null): Animation | null {
    if (!el || typeof el.animate !== "function" || typeof el.getTotalLength !== "function") return null
    const length = el.getTotalLength()
    if (!length) return null

    const from = GROW_TOWARD_PARENT ? -length : length
    // Hide synchronously (this runs in a layout effect, before paint) so the finished solid stroke
    // never flashes for a frame before the draw starts.
    el.style.strokeDasharray = `${length} ${length}`
    el.style.strokeDashoffset = String(from)

    const anim = el.animate([{ strokeDashoffset: from }, { strokeDashoffset: 0 }], {
        duration: GROW_MS,
        easing: GROW_EASING
    })
    // On finish (or cancel) drop the inline dash so the element falls back to its static lit look.
    const clear = () => {
        el.style.strokeDasharray = ""
        el.style.strokeDashoffset = ""
    }
    anim.addEventListener("finish", clear)
    anim.addEventListener("cancel", clear)
    return anim
}

export function Edge(props: EdgeProps<NodeFlowEdge>) {
    const { sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition, source, target, data } = props
    const [path] = getBezierPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition })
    const lit = data?.lit === true

    const underRef = useRef<SVGPathElement>(null)
    const overRef = useRef<SVGPathElement>(null)
    // Track the previous lit value so we only draw on the planned -> lit transition, never on mount
    // (an already-lit seed edge, or a tab switch that remounts the tree, shouldn't replay the grow).
    const wasLit = useRef(lit)

    useLayoutEffect(() => {
        const justLit = lit && !wasLit.current
        wasLit.current = lit
        if (!justLit || prefersReducedMotion()) return

        const underAnim = drawIn(underRef.current)
        const overAnim = drawIn(overRef.current)
        // When the gold finishes climbing the thread, pop the node it reached (the end it grows toward).
        const reached = GROW_TOWARD_PARENT ? source : target
        overAnim?.addEventListener("finish", () => dispatchNodeReached(reached))

        const anims = [underAnim, overAnim].filter((a): a is Animation => a !== null)
        return () => anims.forEach((a) => a.cancel())
    }, [lit, source, target])

    return (
        <>
            <path
                ref={underRef}
                d={path}
                fill="none"
                stroke="#7a5c1c"
                strokeLinecap="round"
                strokeOpacity={lit ? 0.32 : 0.15}
                strokeWidth={lit ? 7 : 5}
            />
            {/* The old planned thread, held in place beneath the gold so the grow draws over it (not
                over bare parchment). Only present when lit; the solid gold over-stroke covers it at rest. */}
            {lit && (
                <path
                    data-testid="edge-ghost"
                    d={path}
                    fill="none"
                    stroke="#c9ba95"
                    strokeLinecap="round"
                    strokeWidth={2.4}
                    strokeDasharray="2 9"
                />
            )}
            <path
                ref={overRef}
                data-testid="edge-over"
                d={path}
                fill="none"
                stroke={lit ? "#e9b949" : "#c9ba95"}
                strokeLinecap="round"
                strokeWidth={lit ? 3.4 : 2.4}
                strokeDasharray={lit ? undefined : "2 9"}
            />
        </>
    )
}

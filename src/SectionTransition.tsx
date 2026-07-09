// Whole-section (page) entrance. Wraps a top-level section -- the roadmap board, the Tasks list,
// the Rewards shop, or Sync -- and plays a single fade + rise as it enters. App keys this by section
// (and, within the roadmap, by the active tab), so it remounts and replays on a section change or a
// tab switch, but not on an in-board re-render or a selection change. Uses WAAPI + the shared
// reduced-motion guard, matching the
// per-node motion in nodeMotion.ts rather than a CSS class (a class would restart if a stray
// re-render toggled it mid-play). `animate` is captured once at mount so a later prop flip can't
// retrigger it; App passes false for the section shown on first load, matching the app's
// "no animation on initial mount" rule (cf. useNodeMotion / useCheckPop / DetailCard's cardSwap).

import { type ReactNode, useEffect, useRef } from "react"
import { prefersReducedMotion } from "./nodeMotion"

const SECTION_IN_KEYFRAMES: Keyframe[] = [
    { opacity: 0, transform: "translateY(6px)", offset: 0 },
    { opacity: 1, transform: "translateY(0)", offset: 1 }
]
const SECTION_IN_TIMING: KeyframeAnimationOptions = { duration: 160, easing: "ease-out" }

export function SectionTransition({ animate, children }: { animate: boolean; children: ReactNode }) {
    const ref = useRef<HTMLDivElement>(null)
    // Freeze the decision at mount: this instance either animates its entrance or it doesn't, whatever
    // the prop does on later re-renders of the same (keyed) instance.
    const shouldAnimate = useRef(animate)

    // biome-ignore lint/correctness/useExhaustiveDependencies: fires once, on this section's own mount
    useEffect(() => {
        const el = ref.current
        if (!shouldAnimate.current || !el || prefersReducedMotion() || typeof el.animate !== "function") return
        el.animate(SECTION_IN_KEYFRAMES, SECTION_IN_TIMING)
    }, [])

    return (
        <div ref={ref} className="absolute inset-0 z-10">
            {children}
        </div>
    )
}

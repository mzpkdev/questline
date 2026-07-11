// The finale: a one-shot fanfare when a tab's root node is completed (the whole quest done). It bursts
// from the root node itself: App measures that node's board-relative centre and hands it in as
// `burst` (a new object, with a bumped nonce, each time). A warm gold flash, an expanding ring, and
// a ring of gold motes fly out from that point. Decorative only (pointer-events-none, aria-hidden)
// and skipped under reduced motion.

import { type CSSProperties, useEffect, useState } from "react"
import { prefersReducedMotion } from "./nodeMotion"

const SPARKS = 16
const FANFARE_MS = 1300

export type Burst = { x: number; y: number; nonce: number }

// Evenly-spaced motes; distance varies per spark so the burst ring isn't a perfect circle.
const MOTES = Array.from({ length: SPARKS }, (_, i) => {
    const angle = (Math.PI * 2 * i) / SPARKS
    const distance = 190 + (i % 3) * 46
    return { key: i, tx: Math.round(Math.cos(angle) * distance), ty: Math.round(Math.sin(angle) * distance) }
})

export function BoardCelebration({ burst }: { burst: Burst | null }) {
    // The origin currently playing (null when idle); latched so it survives burst going back to null.
    const [origin, setOrigin] = useState<{ x: number; y: number } | null>(null)

    useEffect(() => {
        if (!burst || prefersReducedMotion()) return
        setOrigin({ x: burst.x, y: burst.y })
        const timer = setTimeout(() => setOrigin(null), FANFARE_MS)
        return () => clearTimeout(timer)
    }, [burst])

    if (!origin) return null
    const { x, y } = origin

    return (
        <div
            data-testid="board-celebration"
            aria-hidden="true"
            // z-0 sits below the canvas layer (z-10), so the gold radiates from behind the root node
            // rather than washing over it.
            className="pointer-events-none absolute inset-0 z-0 overflow-hidden"
        >
            <div
                className="absolute inset-0 animate-[goalFanfareFlash_1300ms_ease-out_forwards]"
                style={{ background: `radial-gradient(520px 420px at ${x}px ${y}px, rgba(245,214,110,0.5), transparent 70%)` }}
            />
            <div
                className="absolute h-40 w-40 animate-[goalFanfareRing_1200ms_cubic-bezier(.22,1,.36,1)_forwards]"
                style={{
                    left: x,
                    top: y,
                    marginLeft: -80,
                    marginTop: -80,
                    borderRadius: 9999,
                    border: "3px solid rgba(233,185,73,0.85)",
                    boxShadow: "0 0 26px rgba(245,214,110,0.7)"
                }}
            />
            {MOTES.map((mote) => (
                <span
                    key={mote.key}
                    className="absolute block h-2.5 w-2.5 animate-[goalFanfareSpark_1100ms_cubic-bezier(.22,1,.36,1)_forwards]"
                    style={
                        {
                            left: x,
                            top: y,
                            marginLeft: -5,
                            marginTop: -5,
                            borderRadius: 9999,
                            background: "radial-gradient(circle, #fdf1b6, #e9b949)",
                            boxShadow: "0 0 10px 2px rgba(245,214,110,0.85)",
                            "--tx": `${mote.tx}px`,
                            "--ty": `${mote.ty}px`
                        } as CSSProperties
                    }
                />
            ))}
        </div>
    )
}

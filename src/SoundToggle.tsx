// The mute toggle for the top bar, styled exactly like the import/export + sync icons (ioButtonClass:
// faint by default, brightening on hover). The icon swaps between a speaker and a muted speaker so the
// state reads at a glance; the choice persists across reloads (SfxProvider owns the flag). Unmuting
// plays a short blip so you hear that audio is back on.

import { ioButtonClass } from "./IoButtons"
import { useSfx, useSfxMute } from "./SfxProvider"

const iconProps = {
    width: 15,
    height: 15,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round",
    strokeLinejoin: "round",
    "aria-hidden": true
} as const

export function SoundToggle() {
    const sfx = useSfx()
    const { muted, setMuted } = useSfxMute()

    const toggle = () => {
        const next = !muted
        setMuted(next)
        if (!next) {
            // Unmuting: flip the kit's flag synchronously (the React state update lands a tick later) so
            // the confirmation cue isn't swallowed while the flag is still "muted".
            sfx.setMuted(false)
            sfx.blip()
        }
    }

    return (
        <button
            type="button"
            onClick={toggle}
            aria-label={muted ? "Unmute sound effects" : "Mute sound effects"}
            aria-pressed={muted}
            title={muted ? "Unmute sound effects" : "Mute sound effects"}
            className={ioButtonClass}
        >
            {muted ? (
                // Speaker with an X (lucide volume-x).
                <svg {...iconProps}>
                    <path d="M11 5 6 9H2v6h4l5 4z" />
                    <path d="m22 9-6 6" />
                    <path d="m16 9 6 6" />
                </svg>
            ) : (
                // Speaker with sound waves (lucide volume-2).
                <svg {...iconProps}>
                    <path d="M11 5 6 9H2v6h4l5 4z" />
                    <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
                    <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
                </svg>
            )}
        </button>
    )
}

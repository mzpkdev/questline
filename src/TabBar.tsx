// Tab chrome, ported from the mockup's `.tabbar` and made functional. Each tab is one board; its label
// is the root node's name, so renaming a tab renames the root node and vice versa. Double-click (or
// long-press on touch) a tab to rename it. A board is deleted from its root node's detail card, not
// here; new boards come from the "+ New Quest" button at the end of the row. Styling matches the
// mockup: solid colors via Tailwind, gold gradients / inset "ring" shadows via inline style.

import {
    type CSSProperties,
    type PointerEvent as ReactPointerEvent,
    type ReactNode,
    useEffect,
    useRef,
    useState
} from "react"
import { PlusIcon } from "./PlusIcon"

// How long a press must hold before it opens the inline rename (touch has no double-click).
const LONG_PRESS_MS = 500
// A press that drifts more than this (px) is a scroll/drag, not a hold, so it cancels the rename.
// Exported as the app's shared press-move tolerance: reparent's tap-vs-pan gate reuses it so a touch
// that pans to reach a target doesn't misfire as an attach (see BoardTree).
export const PRESS_MOVE_TOLERANCE = 10

export type TabDescriptor = { id: string; name: string }

type TabBarProps = {
    tabs: TabDescriptor[]
    activeId: string
    onSelect: (id: string) => void
    onRename: (id: string, name: string) => void
    // Create a fresh board (rendered as a "+ New Quest" chip at the end of the tab row). Omitted when
    // the bar is rendered in isolation.
    onAddBoard?: () => void
    // App-level chips rendered at the leading end of the bar, ahead of the tabs.
    leading?: ReactNode
    // App-level controls pinned to the trailing (right) end of the bar, after the tabs. Right-aligned
    // and wrapping with the tabs, so they never overlap a tab on narrow screens.
    trailing?: ReactNode
}

// Shared chip shape (`.tab` base: inline-flex chip, faint gold-shadow border). Exported so app-level
// chips (e.g. the Tasks button) can wear the exact same look as a roadmap tab.
export const chipBase =
    "inline-flex appearance-none items-center rounded-lg border border-[#8a641d]/30 px-3 py-1 font-display text-[11.5px] tracking-wide transition-[color,background-color,box-shadow] duration-150 ease-out"
// Exported alongside chipBase/inactiveChip so app-level chips (the Tasks button) can show the same
// active look as a selected roadmap tab.
export const activeChip = "bg-[#f4ead0] font-semibold text-[#4a3410]"
export const inactiveChip = "bg-[#e7dabb] text-[#8a6f38] hover:bg-[#efe3c4] hover:text-[#6f5316]"
export const activeShadow = { boxShadow: "inset 0 0 0 1px #e6c458, 0 1px 4px -1px rgba(120,80,20,0.3)" } as const

// Label look for touch: suppress the iOS press-and-hold callout and the double-tap zoom so a hold
// registers as a rename instead of a text selection.
const LABEL_STYLE: CSSProperties = { WebkitTouchCallout: "none", touchAction: "manipulation" }

export function TabBar(props: TabBarProps) {
    // Which tab is being renamed inline, and its working text.
    const [editingId, setEditingId] = useState<string | null>(null)
    const [draft, setDraft] = useState("")

    // Long-press bookkeeping: the pending timer and where the finger first landed.
    const pressTimer = useRef<number | null>(null)
    const pressOrigin = useRef<{ x: number; y: number } | null>(null)

    const startEdit = (tab: TabDescriptor) => {
        setEditingId(tab.id)
        setDraft(tab.name)
    }

    const cancelPress = () => {
        if (pressTimer.current !== null) {
            window.clearTimeout(pressTimer.current)
            pressTimer.current = null
        }
        pressOrigin.current = null
    }

    const startPress = (tab: TabDescriptor, event: ReactPointerEvent) => {
        pressOrigin.current = { x: event.clientX, y: event.clientY }
        pressTimer.current = window.setTimeout(() => {
            pressTimer.current = null
            startEdit(tab)
        }, LONG_PRESS_MS)
    }

    const trackPress = (event: ReactPointerEvent) => {
        const origin = pressOrigin.current
        if (!origin) return
        if (
            Math.abs(event.clientX - origin.x) > PRESS_MOVE_TOLERANCE ||
            Math.abs(event.clientY - origin.y) > PRESS_MOVE_TOLERANCE
        ) {
            cancelPress()
        }
    }

    // Drop a pending timer if the bar unmounts mid-press.
    useEffect(() => cancelPress, [])

    // Commit an empty-stripped rename, ignoring a blank so a tab is never left nameless.
    const commit = () => {
        if (editingId !== null) {
            const name = draft.trim()
            if (name) props.onRename(editingId, name)
        }
        setEditingId(null)
    }

    return (
        <div
            data-tabbar=""
            className="flex flex-wrap items-center gap-1.5 border-b border-[#8a641d]/30 px-4 py-1.5"
            style={{ backgroundImage: "linear-gradient(180deg,#f1e4c6,#ece0c4)" }}
        >
            {props.leading}
            {props.tabs.map((tab) => {
                const isActive = tab.id === props.activeId
                const chipClass = `${chipBase} ${isActive ? activeChip : inactiveChip}`
                const chipStyle = isActive ? activeShadow : undefined

                if (editingId === tab.id) {
                    return (
                        <span key={tab.id} className={chipClass} style={chipStyle}>
                            {/* biome-ignore lint/a11y/noAutofocus: inline rename should take focus immediately */}
                            <input
                                autoFocus
                                aria-label="Rename board"
                                className="w-28 bg-transparent outline-none"
                                value={draft}
                                maxLength={40}
                                onChange={(event) => setDraft(event.target.value)}
                                onBlur={commit}
                                onKeyDown={(event) => {
                                    if (event.key === "Enter") commit()
                                    else if (event.key === "Escape") setEditingId(null)
                                }}
                            />
                        </span>
                    )
                }

                return (
                    <span key={tab.id} className={chipClass} style={chipStyle}>
                        <button
                            type="button"
                            className="inline-flex select-none appearance-none items-center gap-1.5 bg-transparent"
                            style={LABEL_STYLE}
                            onClick={() => props.onSelect(tab.id)}
                            onDoubleClick={() => startEdit(tab)}
                            onPointerDown={(event) => startPress(tab, event)}
                            onPointerMove={trackPress}
                            onPointerUp={cancelPress}
                            onPointerLeave={cancelPress}
                            onPointerCancel={cancelPress}
                            onContextMenu={(event) => event.preventDefault()}
                        >
                            {tab.name}
                        </button>
                    </span>
                )
            })}
            {props.onAddBoard && (
                <button
                    type="button"
                    className={`${chipBase} ${inactiveChip} gap-1`}
                    aria-label="Add board"
                    title="New Quest"
                    onClick={props.onAddBoard}
                >
                    <PlusIcon size={13} />
                    New Quest
                </button>
            )}
            {props.trailing && <div className="ml-auto flex items-center gap-1">{props.trailing}</div>}
        </div>
    )
}

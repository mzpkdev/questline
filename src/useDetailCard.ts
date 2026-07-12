// The lifecycle shared by every detail card in the app (roadmap node, task, reward): `selectedId` is
// the intent (null once dismissed), `displayId` is what the card actually shows -- it trails
// `selectedId` on dismissal so the exit animation can play before the card unmounts -- and
// `editOnAddId` marks a just-added item so its card opens in edit mode once, consumed the instant that
// card mounts (re-selecting the same item later then opens the read view). Parametrized by the section
// the card lives in, so leaving that section closes the card outright (both ids, no trailing exit
// animation) instead of leaving a stale card mid-exit for the next visit.

import { useCallback, useEffect, useState } from "react"

export type DetailCardApi = {
    selectedId: string | null
    displayId: string | null
    editOnAddId: string | null
    // True from dismissal (selectedId -> null) until clearDisplay() reports the exit animation done.
    closing: boolean
    // Set the intent id directly: select(id) opens/swaps, select(null) dismisses (same as close()).
    select: (id: string | null) => void
    // Arm edit-on-add for an id without touching selection -- the roadmap node's add-handlers select
    // separately (via focusNode, which also pans the canvas), so the two can't be one call there.
    armEditOnAdd: (id: string) => void
    // The task/reward "create -> select -> arm edit-on-add" flow in one call.
    openForAdd: (id: string) => void
    // Dismiss: select(null).
    close: () => void
    // The onExited handler: drops the trailing display id once the exit animation ends.
    clearDisplay: () => void
}

export function useDetailCard<S>(section: S, currentSection: S, initialId: string | null = null): DetailCardApi {
    const [selectedId, setSelectedId] = useState<string | null>(initialId)
    const [displayId, setDisplayId] = useState<string | null>(initialId)
    const [editOnAddId, setEditOnAddId] = useState<string | null>(null)

    // Trail the intent into display so a dismissal leaves displayId in place long enough for the exit
    // animation to play; clearDisplay (onExited) drops it once that animation ends.
    useEffect(() => {
        if (selectedId !== null) setDisplayId(selectedId)
    }, [selectedId])

    // Consume edit-on-add once the target's card has mounted (display has latched onto it), so a later
    // re-select of the same item opens the read view instead.
    useEffect(() => {
        if (editOnAddId !== null && displayId === editOnAddId) setEditOnAddId(null)
    }, [editOnAddId, displayId])

    // Leaving the owning section closes the card outright (both the intent and the trailing display
    // id), so re-entering doesn't flash a stale card mid-exit.
    useEffect(() => {
        if (currentSection !== section) {
            setSelectedId(null)
            setDisplayId(null)
        }
    }, [currentSection, section])

    const select = useCallback((id: string | null) => setSelectedId(id), [])
    const armEditOnAdd = useCallback((id: string) => setEditOnAddId(id), [])
    const openForAdd = useCallback((id: string) => {
        setSelectedId(id)
        setEditOnAddId(id)
    }, [])
    const close = useCallback(() => setSelectedId(null), [])
    const clearDisplay = useCallback(() => setDisplayId(null), [])

    return {
        selectedId,
        displayId,
        editOnAddId,
        closing: selectedId === null && displayId !== null,
        select,
        armEditOnAdd,
        openForAdd,
        close,
        clearDisplay
    }
}

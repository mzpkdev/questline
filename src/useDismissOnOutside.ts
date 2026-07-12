// Dismiss-on-outside for a detail card: while `active`, a pointerdown landing outside every selector
// in the allowlist calls `onDismiss`, and so (when `escape` is set) does the Escape key. Shared by the
// roadmap node, task, and reward cards -- their allowlists differ, but the wiring is identical.

import { useEffect } from "react"

type UseDismissOnOutsideOptions = {
    // Whether the listener is armed at all (typically: the card's selectedId !== null).
    active: boolean
    // Allowlist of closest() selectors; a pointerdown inside any of them is left alone.
    selectors: readonly string[]
    // Also dismiss on Escape.
    escape?: boolean
    onDismiss: () => void
}

export function useDismissOnOutside({ active, selectors, escape = false, onDismiss }: UseDismissOnOutsideOptions): void {
    useEffect(() => {
        if (!active) return
        const onPointerDown = (event: PointerEvent) => {
            const target = event.target as Element | null
            if (selectors.some((selector) => target?.closest(selector))) return
            onDismiss()
        }
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Escape") onDismiss()
        }
        document.addEventListener("pointerdown", onPointerDown)
        if (escape) document.addEventListener("keydown", onKeyDown)
        return () => {
            document.removeEventListener("pointerdown", onPointerDown)
            if (escape) document.removeEventListener("keydown", onKeyDown)
        }
    }, [active, selectors, escape, onDismiss])
}

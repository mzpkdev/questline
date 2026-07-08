// A small themed confirmation modal on Ark UI's Dialog, so it gets a focus trap, escape-to-close,
// backdrop dismiss, and the right aria roles for free. Dismiss is the × in the corner; the single
// full-width button confirms (runs onConfirm; the caller closes by flipping `open`). Styled to match
// the parchment + gold detail card.

import { Dialog, Portal } from "@ark-ui/react"
import type { CSSProperties, ReactNode } from "react"

const PANEL_STYLE: CSSProperties = {
    border: "2px solid transparent",
    borderRadius: "16px",
    background:
        "linear-gradient(180deg,#faf2dc,#efe1bd) padding-box, linear-gradient(180deg,#fbeeb8,#b8892b) border-box",
    boxShadow: "0 24px 50px -20px rgba(60,40,10,0.6), inset 0 1px 0 rgba(255,255,255,0.6)"
}
const CONFIRM_SHADOW: CSSProperties = {
    boxShadow: "0 3px 9px -5px rgba(184,137,43,0.7), inset 0 1px 0 rgba(255,255,255,0.4)"
}

// Subtle corner dismiss, matching the import/export + checklist-delete buttons: dim, brightening to
// gold on hover, no movement.
const CLOSE_CLASS =
    "absolute right-3 top-3 grid size-7 place-items-center rounded-lg text-[#b3a074] opacity-60 transition-[opacity,color,background-color] duration-150 ease-out hover:bg-[#f4ead0]/70 hover:text-[#8a6b28] hover:opacity-100"
// Full-width confirm; colour-only hover (no translate).
const CONFIRM_CLASS =
    "mt-5 w-full rounded-[11px] bg-[#e6c458] py-3 font-display text-[14px] font-bold uppercase tracking-wide text-[#3a2a0c] transition-colors duration-150 ease-out hover:bg-[#eecb5c]"

type ConfirmDialogProps = {
    open: boolean
    title: string
    message?: ReactNode
    confirmLabel?: string
    onConfirm: () => void
    onOpenChange: (open: boolean) => void
}

export function ConfirmDialog(props: ConfirmDialogProps) {
    return (
        <Dialog.Root
            role="alertdialog"
            open={props.open}
            onOpenChange={(details) => props.onOpenChange(details.open)}
            lazyMount
            unmountOnExit
        >
            <Portal>
                <Dialog.Backdrop className="fixed inset-0 z-40 bg-[#3a2a0c]/40 data-[state=open]:animate-[fadeIn_0.15s_ease-out]" />
                <Dialog.Positioner className="fixed inset-0 z-50 grid place-items-center p-4">
                    <Dialog.Content
                        className="relative w-[340px] max-w-[90vw] p-6 font-serif data-[state=open]:animate-[cardSwap_0.2s_cubic-bezier(0.2,0.75,0.25,1)]"
                        style={PANEL_STYLE}
                    >
                        <Dialog.CloseTrigger aria-label="Close" className={CLOSE_CLASS}>
                            <svg
                                width={15}
                                height={15}
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth={2}
                                strokeLinecap="round"
                                aria-hidden="true"
                            >
                                <path d="M6 6l12 12M18 6L6 18" />
                            </svg>
                        </Dialog.CloseTrigger>
                        <Dialog.Title className="pr-8 font-display text-[18px] font-bold text-[#4a3410]">
                            {props.title}
                        </Dialog.Title>
                        {props.message && (
                            <Dialog.Description className="mt-2 text-[14.5px] leading-relaxed text-[#5a4a2c]">
                                {props.message}
                            </Dialog.Description>
                        )}
                        <button type="button" className={CONFIRM_CLASS} style={CONFIRM_SHADOW} onClick={props.onConfirm}>
                            {props.confirmLabel ?? "Confirm"}
                        </button>
                    </Dialog.Content>
                </Dialog.Positioner>
            </Portal>
        </Dialog.Root>
    )
}

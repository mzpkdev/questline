// The sync control in the top bar's trailing cluster, next to import/export. It wears the same faint
// icon-button look (ioButtonClass) and opens a small parchment popover: enable sync, copy the pairing
// link, or disconnect. Two modal moments ride along regardless of the popover: a confirm before this
// device adopts a code from a link (a bearer secret -- never silent), and a 3-way conflict prompt when
// both sides diverge. All the state/timing lives in useSync; this file is just chrome.

import { Dialog, Portal } from "@ark-ui/react"
import { type CSSProperties, useEffect, useRef, useState } from "react"
import { ConfirmDialog } from "../ConfirmDialog"
import { ioButtonClass } from "../IoButtons"
import type { SyncStatus, UseSyncResult } from "./useSync"

const PANEL_STYLE: CSSProperties = {
    border: "2px solid transparent",
    borderRadius: "14px",
    background:
        "linear-gradient(180deg,#faf2dc,#efe1bd) padding-box, linear-gradient(180deg,#fbeeb8,#b8892b) border-box",
    boxShadow: "0 20px 44px -20px rgba(60,40,10,0.55), inset 0 1px 0 rgba(255,255,255,0.6)"
}

// Label + accent colour per status, for the popover heading and the trigger tint.
const STATUS_META: Record<SyncStatus, { label: string; color: string }> = {
    off: { label: "Off", color: "#b3a074" },
    idle: { label: "Synced", color: "#4f7a3a" },
    syncing: { label: "Syncing…", color: "#8a6b28" },
    error: { label: "Sync error", color: "#a5482a" },
    conflict: { label: "Needs attention", color: "#b8892b" }
}

const primaryBtn =
    "rounded-[10px] bg-[#e6c458] px-3 py-2 font-display text-[12.5px] font-bold uppercase tracking-wide text-[#3a2a0c] transition-colors duration-150 ease-out hover:bg-[#eecb5c]"
const ghostBtn =
    "rounded-[10px] border border-[#8a641d]/30 bg-[#f4ead0]/60 px-3 py-2 font-display text-[12px] tracking-wide text-[#6f5316] transition-colors duration-150 ease-out hover:bg-[#efe3c4]"

export function SyncButton({ sync }: { sync: UseSyncResult }) {
    const [open, setOpen] = useState(false)
    const [copied, setCopied] = useState(false)
    const popRef = useRef<HTMLDivElement>(null)

    // Dismiss the popover on outside pointerdown (not the trigger) or Escape, mirroring the app's other
    // popovers. Kept inert while closed.
    useEffect(() => {
        if (!open) return
        const onPointerDown = (event: PointerEvent) => {
            const target = event.target as Element | null
            if (target?.closest("[data-sync-popover]") || target?.closest("[data-sync-trigger]")) return
            setOpen(false)
        }
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Escape") setOpen(false)
        }
        document.addEventListener("pointerdown", onPointerDown)
        document.addEventListener("keydown", onKeyDown)
        return () => {
            document.removeEventListener("pointerdown", onPointerDown)
            document.removeEventListener("keydown", onKeyDown)
        }
    }, [open])

    if (!sync.enabled) return null

    const meta = STATUS_META[sync.status]

    const copyLink = async () => {
        if (!sync.pairingLink) return
        try {
            await navigator.clipboard.writeText(sync.pairingLink)
            setCopied(true)
            setTimeout(() => setCopied(false), 1500)
        } catch {
            // clipboard may be blocked; the link is visible to copy manually
        }
    }

    return (
        <div className="relative flex items-center">
            <button
                type="button"
                data-sync-trigger=""
                onClick={() => setOpen((value) => !value)}
                aria-label="Cross-device sync"
                title="Cross-device sync"
                className={ioButtonClass}
                style={sync.active ? { color: meta.color, opacity: 1 } : undefined}
            >
                {/* lucide refresh-cw */}
                <svg
                    width={15}
                    height={15}
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={1.8}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                >
                    <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
                    <path d="M21 3v5h-5" />
                    <path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
                    <path d="M3 21v-5h5" />
                </svg>
            </button>

            {open && (
                <div
                    ref={popRef}
                    data-sync-popover=""
                    className="absolute right-0 top-[calc(100%+8px)] z-30 w-[290px] p-4 font-serif text-[#5a4a2c]"
                    style={PANEL_STYLE}
                >
                    <div className="flex items-center justify-between">
                        <span className="font-display text-[14px] font-bold text-[#4a3410]">Cross-device sync</span>
                        {sync.active && (
                            <span className="font-display text-[11px] font-semibold" style={{ color: meta.color }}>
                                {meta.label}
                            </span>
                        )}
                    </div>

                    {!sync.active ? (
                        <>
                            <p className="mt-2 text-[13px] leading-relaxed">
                                Sync this roadmap across your devices with no account. You'll get a private link to open
                                on another device.
                            </p>
                            <button type="button" className={`${primaryBtn} mt-3 w-full`} onClick={sync.enable}>
                                Enable sync
                            </button>
                        </>
                    ) : (
                        <>
                            <p className="mt-2 text-[12.5px] leading-relaxed">
                                Open this link on another device to sync it here:
                            </p>
                            <div className="mt-2 flex items-center gap-1.5">
                                <input
                                    readOnly
                                    value={sync.pairingLink ?? ""}
                                    aria-label="Pairing link"
                                    onFocus={(event) => event.currentTarget.select()}
                                    className="min-w-0 flex-1 rounded-[9px] border border-[#8a641d]/30 bg-[#fbf4df] px-2 py-1.5 text-[11px] text-[#6f5316] outline-none"
                                />
                                <button type="button" className={ghostBtn} onClick={copyLink}>
                                    {copied ? "Copied" : "Copy"}
                                </button>
                            </div>
                            <p className="mt-2 text-[11.5px] leading-relaxed text-[#8a6f38]">
                                Anyone with this link can read and edit your roadmap. Keep it private, and keep it safe:
                                lose it and there's no way to recover the data.
                            </p>
                            <div className="mt-3 flex gap-1.5">
                                <button type="button" className={`${ghostBtn} flex-1`} onClick={sync.regenerate}>
                                    New link
                                </button>
                                <button type="button" className={`${ghostBtn} flex-1`} onClick={sync.disable}>
                                    Disconnect
                                </button>
                            </div>
                        </>
                    )}
                </div>
            )}

            {/* Adopting a code from a link is never silent: it shares this device's data with whoever holds
                the code, and replaces what's here. */}
            <ConfirmDialog
                open={sync.pendingAdopt !== null}
                title="Link this device?"
                message={
                    <>
                        This link connects the device to a shared roadmap. Your data will sync with{" "}
                        <strong className="font-semibold text-[#4a3410]">anyone who holds this link</strong>, and this
                        device's current roadmap may be replaced. Continue?
                    </>
                }
                confirmLabel="Link device"
                onConfirm={sync.confirmAdopt}
                onOpenChange={(next) => {
                    if (!next) sync.cancelAdopt()
                }}
            />

            <ConflictDialog
                open={sync.conflict}
                onRemote={() => sync.resolveConflict("remote")}
                onLocal={() => sync.resolveConflict("local")}
            />
        </div>
    )
}

// The synced copy and this device's copy diverged, so the user keeps one. Deliberately required (no ×,
// backdrop, or Escape dismiss): dismissing would either leave sync stuck or silently push local over
// the remote, so the choice must be explicit.
function ConflictDialog({ open, onRemote, onLocal }: { open: boolean; onRemote: () => void; onLocal: () => void }) {
    return (
        <Dialog.Root role="alertdialog" open={open} onOpenChange={() => {}} lazyMount unmountOnExit>
            <Portal>
                <Dialog.Backdrop className="fixed inset-0 z-40 bg-[#3a2a0c]/40 data-[state=open]:animate-[fadeIn_0.15s_ease-out]" />
                <Dialog.Positioner className="fixed inset-0 z-50 grid place-items-center p-4">
                    <Dialog.Content
                        className="relative w-[360px] max-w-[90vw] p-6 font-serif data-[state=open]:animate-[cardSwap_0.2s_cubic-bezier(0.2,0.75,0.25,1)]"
                        style={PANEL_STYLE}
                    >
                        <Dialog.Title className="font-display text-[18px] font-bold text-[#4a3410]">
                            Two versions to reconcile
                        </Dialog.Title>
                        <Dialog.Description className="mt-2 text-[14px] leading-relaxed text-[#5a4a2c]">
                            The synced roadmap and this device's roadmap have both changed. Keep one; the other is
                            overwritten.
                        </Dialog.Description>
                        <div className="mt-5 flex flex-col gap-2">
                            <button type="button" className={primaryBtn} onClick={onRemote}>
                                Keep the synced roadmap
                            </button>
                            <button type="button" className={ghostBtn} onClick={onLocal}>
                                Keep this device's roadmap
                            </button>
                        </div>
                    </Dialog.Content>
                </Dialog.Positioner>
            </Portal>
        </Dialog.Root>
    )
}

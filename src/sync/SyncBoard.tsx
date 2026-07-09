// The Sync view: a full section (like Tasks / Rewards) rather than a popover, so pairing, status,
// and the two safety prompts (adopt-from-link, conflict) have room and never depend on a modal/portal
// that a strict browser might not render. App auto-switches here when a pairing link opens or a
// conflict fires; everything stateful lives in useSync, this is chrome over it.

import { type CSSProperties, useState } from "react"
import type { SyncStatus, UseSyncResult } from "./useSync"

const PANEL_STYLE: CSSProperties = {
    border: "2px solid transparent",
    borderRadius: "16px",
    background:
        "linear-gradient(180deg,#faf2dc,#efe1bd) padding-box, linear-gradient(180deg,#fbeeb8,#b8892b) border-box",
    boxShadow: "0 20px 44px -20px rgba(60,40,10,0.55), inset 0 1px 0 rgba(255,255,255,0.6)"
}

// Status label + accent colour, shared shape with the nav chip's dot.
const STATUS_META: Record<SyncStatus, { label: string; color: string }> = {
    off: { label: "Off", color: "#b3a074" },
    idle: { label: "Synced", color: "#4f7a3a" },
    syncing: { label: "Syncing...", color: "#8a6b28" },
    error: { label: "Sync error", color: "#a5482a" },
    conflict: { label: "Needs attention", color: "#b8892b" }
}

const primaryBtn =
    "rounded-[11px] bg-[#e6c458] px-4 py-3 font-display text-[13px] font-bold uppercase tracking-wide text-[#3a2a0c] transition-colors duration-150 ease-out hover:bg-[#eecb5c]"
const ghostBtn =
    "rounded-[11px] border border-[#8a641d]/30 bg-[#f4ead0]/60 px-4 py-3 font-display text-[12.5px] tracking-wide text-[#6f5316] transition-colors duration-150 ease-out hover:bg-[#efe3c4]"

export function SyncBoard({ sync }: { sync: UseSyncResult }) {
    const [copied, setCopied] = useState(false)

    const copy = async () => {
        if (!sync.pairingLink) return
        try {
            await navigator.clipboard.writeText(sync.pairingLink)
            setCopied(true)
            setTimeout(() => setCopied(false), 1500)
        } catch {
            // clipboard may be blocked; the link is visible to copy by hand
        }
    }

    const meta = STATUS_META[sync.status]

    return (
        <div className="mx-auto w-[95%] max-w-[560px] px-1 py-12 font-serif text-[#5a4a2c]">
            <h1 className="mb-1 font-display text-[22px] font-bold text-[#4a3410]">Sync across devices</h1>
            <p className="mb-6 text-[13.5px] text-[#8a6f38]">
                Account-free and end-to-end encrypted. A private link is the key.
            </p>

            {sync.pendingAdopt !== null ? (
                <section className="p-6" style={PANEL_STYLE}>
                    <h2 className="font-display text-[17px] font-bold text-[#4a3410]">Link this device?</h2>
                    <p className="mt-2 text-[14px] leading-relaxed">
                        This link connects the device to a shared roadmap. Your data will sync with{" "}
                        <strong className="font-semibold text-[#4a3410]">anyone who holds this link</strong>, and this
                        device's current roadmap may be replaced.
                    </p>
                    <div className="mt-5 flex gap-2">
                        <button type="button" className={`${primaryBtn} flex-1`} onClick={sync.confirmAdopt}>
                            Link device
                        </button>
                        <button type="button" className={`${ghostBtn} flex-1`} onClick={sync.cancelAdopt}>
                            Cancel
                        </button>
                    </div>
                </section>
            ) : sync.conflict ? (
                <section className="p-6" style={PANEL_STYLE}>
                    <h2 className="font-display text-[17px] font-bold text-[#4a3410]">Two versions to reconcile</h2>
                    <p className="mt-2 text-[14px] leading-relaxed">
                        The synced roadmap and this device's roadmap have both changed. Keep one; the other is
                        overwritten.
                    </p>
                    <div className="mt-5 flex flex-col gap-2">
                        <button type="button" className={primaryBtn} onClick={() => sync.resolveConflict("remote")}>
                            Keep the synced roadmap
                        </button>
                        <button type="button" className={ghostBtn} onClick={() => sync.resolveConflict("local")}>
                            Keep this device's roadmap
                        </button>
                    </div>
                </section>
            ) : sync.active ? (
                <section className="p-6" style={PANEL_STYLE}>
                    <div className="flex items-center justify-between">
                        <span className="font-display text-[13px] font-semibold text-[#6f5316]">Status</span>
                        <span className="font-display text-[13px] font-semibold" style={{ color: meta.color }}>
                            {meta.label}
                        </span>
                    </div>
                    <p className="mt-4 mb-2 font-display text-[12.5px] font-semibold uppercase tracking-wide text-[#8a6f38]">
                        Pairing link
                    </p>
                    <div className="flex items-center gap-1.5">
                        <input
                            readOnly
                            value={sync.pairingLink ?? ""}
                            aria-label="Pairing link"
                            onFocus={(event) => event.currentTarget.select()}
                            className="min-w-0 flex-1 rounded-[9px] border border-[#8a641d]/30 bg-[#fbf4df] px-2.5 py-2 text-[12px] text-[#6f5316] outline-none"
                        />
                        <button type="button" className={ghostBtn} onClick={copy}>
                            {copied ? "Copied" : "Copy"}
                        </button>
                    </div>
                    <p className="mt-3 text-[12.5px] leading-relaxed text-[#8a6f38]">
                        Open this link on another device to sync it here. Anyone with the link can read and edit your
                        roadmap, so keep it private, and keep it safe: lose it and the data can't be recovered.
                    </p>
                    <div className="mt-5 flex gap-2">
                        <button type="button" className={`${ghostBtn} flex-1`} onClick={sync.regenerate}>
                            New link
                        </button>
                        <button type="button" className={`${ghostBtn} flex-1`} onClick={sync.disable}>
                            Disconnect
                        </button>
                    </div>
                </section>
            ) : (
                <section className="p-6" style={PANEL_STYLE}>
                    <p className="text-[14px] leading-relaxed">
                        Sync this roadmap across your devices with no account. Enable it to get a private link you open
                        on another device to keep them in step.
                    </p>
                    <button type="button" className={`${primaryBtn} mt-5 w-full`} onClick={sync.enable}>
                        Enable sync
                    </button>
                </section>
            )}
        </div>
    )
}

// The Sync section switch, pinned to the far-right of the top bar (after import/export) rather than
// grouped with the left nav chips. Same chip shape as Bounties/Merchant, but its active state is the
// theme gold instead of the parchment fill, so an active sync reads at a glance. A small dot flags an
// error or a conflict even when another section is open.

import { activeShadow, chipBase, inactiveChip } from "../TabBar"

// Active fill: theme gold (the goal/reward accent) with dark text, not the parchment activeChip.
const GOLD_ACTIVE = "bg-[#e6c458] font-semibold text-[#3a2a0c]"

export function SyncNavButton({
    active,
    status,
    onOpen
}: {
    active: boolean
    status: string
    onOpen: () => void
}) {
    return (
        <button
            type="button"
            className={`${chipBase} ${active ? GOLD_ACTIVE : inactiveChip} gap-1.5`}
            style={active ? activeShadow : undefined}
            title="Sync"
            aria-pressed={active}
            onClick={onOpen}
        >
            {/* Circular arrows (lucide refresh-cw). */}
            <svg
                width={14}
                height={14}
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.8}
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
                className="flex-none"
            >
                <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
                <path d="M21 3v5h-5" />
                <path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
                <path d="M3 21v-5h5" />
            </svg>
            Sync
            {(status === "error" || status === "conflict") && (
                <span
                    aria-hidden="true"
                    className="ml-0.5 h-1.5 w-1.5 rounded-full"
                    style={{ background: status === "error" ? "#a5482a" : "#b8892b" }}
                />
            )}
        </button>
    )
}

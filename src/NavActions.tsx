// App-level nav items in the top bar, ahead of the roadmap tabs: Bounties (a to-do list) and
// Merchant (a shop). They wear the exact roadmap-tab chip look (via TabBar's shared classes) plus an
// icon, so they read as top-level sections. Each opens its view and highlights like an active tab
// while that view is showing.

import { activeChip, activeShadow, chipBase, inactiveChip } from "./TabBar"

const iconProps = {
    width: 14,
    height: 14,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round",
    strokeLinejoin: "round",
    "aria-hidden": true,
    className: "flex-none"
} as const

type NavActionsProps = {
    // Opens the app-level Bounties view. Omitted when the chip is rendered in isolation.
    onOpenBounties?: () => void
    // Highlights the Bounties chip (active-tab look) while its view is showing.
    bountiesActive?: boolean
    // Opens the app-level Merchant view. Omitted when the chip is rendered in isolation.
    onOpenMerchant?: () => void
    // Highlights the Merchant chip (active-tab look) while its view is showing.
    merchantActive?: boolean
    // Opens the Sync view. Omitted (chip hidden) when sync is disabled.
    onOpenSync?: () => void
    // Highlights the Sync chip while its view is showing.
    syncActive?: boolean
    // Small attention dot on the Sync chip for "error" / "conflict" status.
    syncStatus?: string
}

export function NavActions({
    onOpenBounties,
    bountiesActive = false,
    onOpenMerchant,
    merchantActive = false,
    onOpenSync,
    syncActive = false,
    syncStatus
}: NavActionsProps) {
    const bountiesClass = `${chipBase} ${bountiesActive ? activeChip : inactiveChip} gap-1.5`
    const merchantClass = `${chipBase} ${merchantActive ? activeChip : inactiveChip} gap-1.5`
    const syncClass = `${chipBase} ${syncActive ? activeChip : inactiveChip} gap-1.5`
    return (
        <>
            <button
                type="button"
                className={merchantClass}
                style={merchantActive ? activeShadow : undefined}
                title="Merchant"
                aria-pressed={merchantActive}
                onClick={onOpenMerchant}
            >
                {/* Gold coins (lucide coins). */}
                <svg {...iconProps}>
                    <circle cx="8" cy="8" r="6" />
                    <path d="M18.09 10.37A6 6 0 1 1 10.34 18" />
                    <path d="M7 6h1v4" />
                    <path d="m16.71 13.88.7.71-2.82 2.82" />
                </svg>
                Merchant
            </button>
            <button
                type="button"
                className={bountiesClass}
                style={bountiesActive ? activeShadow : undefined}
                title="Bounties"
                aria-pressed={bountiesActive}
                onClick={onOpenBounties}
            >
                {/* A quest scroll (lucide scroll-text). */}
                <svg {...iconProps}>
                    <path d="M15 12h-5" />
                    <path d="M15 8h-5" />
                    <path d="M19 17V5a2 2 0 0 0-2-2H4" />
                    <path d="M8 21h12a2 2 0 0 0 2-2v-1a1 1 0 0 0-1-1H11a1 1 0 0 0-1 1v1a2 2 0 1 1-4 0V5a2 2 0 1 0-4 0v2a1 1 0 0 0 1 1h3" />
                </svg>
                Bounties
            </button>
            {onOpenSync && (
                <button
                    type="button"
                    className={syncClass}
                    style={syncActive ? activeShadow : undefined}
                    title="Sync"
                    aria-pressed={syncActive}
                    onClick={onOpenSync}
                >
                    {/* Circular arrows (lucide refresh-cw). */}
                    <svg {...iconProps}>
                        <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
                        <path d="M21 3v5h-5" />
                        <path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
                        <path d="M3 21v-5h5" />
                    </svg>
                    Sync
                    {(syncStatus === "error" || syncStatus === "conflict") && (
                        <span
                            aria-hidden="true"
                            className="ml-0.5 h-1.5 w-1.5 rounded-full"
                            style={{ background: syncStatus === "error" ? "#a5482a" : "#b8892b" }}
                        />
                    )}
                </button>
            )}
        </>
    )
}

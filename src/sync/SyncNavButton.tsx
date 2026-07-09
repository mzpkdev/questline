// The Sync entry, styled exactly like the import/export icons (ioButtonClass: faint by default,
// brightening on hover). It opens the Sync section. When sync is on (a code is set), the icon is
// tinted theme gold at full opacity so a connected state reads at a glance.

import { ioButtonClass } from "../IoButtons"

// Theme gold (the goal / reward accent), shown when sync is on.
const GOLD = "#e6c458"

export function SyncNavButton({ on, onOpen }: { on: boolean; onOpen: () => void }) {
    return (
        <button
            type="button"
            onClick={onOpen}
            aria-label="Sync"
            title="Sync"
            className={ioButtonClass}
            style={on ? { color: GOLD, opacity: 1 } : undefined}
        >
            {/* Circular arrows (lucide refresh-cw). */}
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
    )
}

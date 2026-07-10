// App-level nav items in the top bar, ahead of the roadmap tabs: Tasks (a to-do list) and
// Rewards (a shop). They wear the exact roadmap-tab chip look (via TabBar's shared classes) plus an
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
    // Opens the app-level Tasks view. Omitted when the chip is rendered in isolation.
    onOpenTasks?: () => void
    // Highlights the Tasks chip (active-tab look) while its view is showing.
    tasksActive?: boolean
    // Opens the app-level Rewards view. Omitted when the chip is rendered in isolation.
    onOpenRewards?: () => void
    // Highlights the Rewards chip (active-tab look) while its view is showing.
    rewardsActive?: boolean
    // Opens the Excalidraw (Draw) canvas view.
    onOpenExcalidraw?: () => void
    // Highlights the Draw chip (active-tab look) while its view is showing.
    excalidrawActive?: boolean
}

export function NavActions({
    onOpenTasks,
    tasksActive = false,
    onOpenRewards,
    rewardsActive = false,
    onOpenExcalidraw,
    excalidrawActive = false
}: NavActionsProps) {
    const tasksClass = `${chipBase} ${tasksActive ? activeChip : inactiveChip} gap-1.5`
    const rewardsClass = `${chipBase} ${rewardsActive ? activeChip : inactiveChip} gap-1.5`
    const excalidrawClass = `${chipBase} ${excalidrawActive ? activeChip : inactiveChip} gap-1.5`
    return (
        <>
            <button
                type="button"
                className={rewardsClass}
                style={rewardsActive ? activeShadow : undefined}
                title="Rewards"
                aria-pressed={rewardsActive}
                onClick={onOpenRewards}
            >
                {/* Gold coins (lucide coins). */}
                <svg {...iconProps}>
                    <circle cx="8" cy="8" r="6" />
                    <path d="M18.09 10.37A6 6 0 1 1 10.34 18" />
                    <path d="M7 6h1v4" />
                    <path d="m16.71 13.88.7.71-2.82 2.82" />
                </svg>
                Rewards
            </button>
            <button
                type="button"
                className={tasksClass}
                style={tasksActive ? activeShadow : undefined}
                title="Tasks"
                aria-pressed={tasksActive}
                onClick={onOpenTasks}
            >
                {/* A quest scroll (lucide scroll-text). */}
                <svg {...iconProps}>
                    <path d="M15 12h-5" />
                    <path d="M15 8h-5" />
                    <path d="M19 17V5a2 2 0 0 0-2-2H4" />
                    <path d="M8 21h12a2 2 0 0 0 2-2v-1a1 1 0 0 0-1-1H11a1 1 0 0 0-1 1v1a2 2 0 1 1-4 0V5a2 2 0 1 0-4 0v2a1 1 0 0 0 1 1h3" />
                </svg>
                Tasks
            </button>
            <button
                type="button"
                className={excalidrawClass}
                style={excalidrawActive ? activeShadow : undefined}
                title="Draw"
                aria-pressed={excalidrawActive}
                onClick={onOpenExcalidraw}
            >
                {/* A pencil (lucide pencil). */}
                <svg {...iconProps}>
                    <path d="M12 20h9" />
                    <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
                </svg>
                Draw
            </button>
        </>
    )
}

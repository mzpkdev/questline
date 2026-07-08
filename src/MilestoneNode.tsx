// Gilded milestone card for React Flow, ported from the mockup's SVG nodes
// (experiments/skill-tree/index.html, renderNodes ~415-468). This is VISUAL +
// SELECTION only: appearance is driven entirely by `data` (state / isGoal /
// isSelected), which the Tree precomputes. Selection is handled by the Tree via
// React Flow's onNodeClick, so there is no click handler here.

import type { NodeProps } from "@xyflow/react"
import { Handle, Position } from "@xyflow/react"
import type { CSSProperties } from "react"
import type { MilestoneFlowNode } from "./flow"
import { NODE_SIZE } from "./flow"
import type { MilestoneState } from "./milestones"
import { useNodeMotion } from "./nodeMotion"

// Inner fill (padding-box) gradient per state. Goal always uses GOAL_INNER. Exported so the view
// chip can reuse the same gilded surface.
export const INNER_BY_STATE: Record<MilestoneState, string> = {
    mastered: "linear-gradient(180deg,#fdf4d2,#eeddab)",
    available: "linear-gradient(180deg,#fefaee,#f4e8c8)",
    locked: "linear-gradient(180deg,#efe9d8,#e0d6bd)"
}
const GOAL_INNER = "linear-gradient(180deg,#fcefb8,#f0d992)"

// Gilded frame (border-box) gradient. Locked non-goal cards use the dim ring.
export const RING_GOLD = "linear-gradient(180deg,#fdf1b6,#dab24c,#8a641d)"
const RING_DIM = "linear-gradient(180deg,#e0d3ad,#a99a72)"

// The marching-ants selection outline, a few pixels clear of the card on every side. Shared so the
// view chip highlights the same way when selected.
export function SelectionBox({ outset }: { outset: number }) {
    return (
        <svg
            aria-hidden="true"
            data-testid="node-selbox"
            style={{
                position: "absolute",
                top: -outset,
                left: -outset,
                width: `calc(100% + ${outset * 2}px)`,
                height: `calc(100% + ${outset * 2}px)`,
                overflow: "visible",
                pointerEvents: "none"
            }}
        >
            <rect
                className="animate-[march_7s_linear_infinite]"
                x="0"
                y="0"
                width="100%"
                height="100%"
                rx="15"
                fill="none"
                stroke="#dab24c"
                strokeWidth={2.4}
                strokeDasharray="12 8"
            />
        </svg>
    )
}

// Left accent bar colour per state.
const BAR_BY_STATE: Record<MilestoneState, string> = {
    mastered: "#c69a34",
    available: "#e6c458",
    locked: "#bcad86"
}

// Handles exist only to anchor edges; keep them invisible.
const HANDLE_STYLE: CSSProperties = { opacity: 0, width: 6, height: 6, border: "none" }

export function MilestoneNode({ data }: NodeProps<MilestoneFlowNode>) {
    const { milestone, state, isGoal, isSelected } = data
    // Drives this card's motion: spawn-in when added, ignite on unlock, seal when completed, pop when
    // an edge reaches it.
    const cardRef = useNodeMotion<HTMLDivElement>(milestone.id, state)

    const size = isGoal ? NODE_SIZE.goal : NODE_SIZE.normal
    const inset = isGoal ? 5 : 3.5
    const inner = isGoal ? GOAL_INNER : INNER_BY_STATE[state]
    const ring = state === "locked" && !isGoal ? RING_DIM : RING_GOLD
    const cardOpacity = state === "mastered" ? 0.55 : state === "locked" ? 0.92 : 1
    const titleColor = isGoal ? "#5a4012" : state === "locked" ? "#93815a" : "#6f5316"

    // Glow shows for available (pulsing) or goal (static faint, pulsing when the
    // goal is also available). The selection outset keeps the marching ants a few
    // pixels clear of the card on every side.
    const showGlow = state === "available" || isGoal
    const glowPulses = state === "available"
    const selOutset = inset + 3

    const titleClass = isGoal
        ? "flex-1 min-w-0 px-3 text-center font-display text-[20px] font-bold leading-tight tracking-[.2px]"
        : "flex-1 min-w-0 pl-5 pr-3 text-left font-display text-[16px] font-bold leading-tight tracking-[.2px]"

    return (
        <div
            ref={cardRef}
            className="relative flex items-center cursor-pointer select-none transition-transform hover:scale-[1.04]"
            data-id={milestone.id}
            data-state={state}
            style={{
                width: size.width,
                minHeight: size.height,
                border: `${inset}px solid transparent`,
                borderRadius: 13,
                background: `${inner} padding-box, ${ring} border-box`,
                boxShadow: "0 3px 6px -1px rgba(90,61,12,0.4)",
                opacity: cardOpacity
            }}
        >
            {showGlow ? (
                <div
                    data-testid="node-glow"
                    className={glowPulses ? "animate-[pulse2_2.6s_ease-in-out_infinite]" : undefined}
                    style={{
                        position: "absolute",
                        inset: -3,
                        borderRadius: 16,
                        boxShadow: "0 0 12px 2px rgba(230,196,88,0.9)",
                        pointerEvents: "none",
                        opacity: glowPulses ? undefined : 0.32
                    }}
                />
            ) : null}

            {isGoal ? null : (
                <div
                    data-testid="node-bar"
                    style={{
                        position: "absolute",
                        left: 8,
                        top: 11,
                        bottom: 11,
                        width: 5,
                        borderRadius: 2.5,
                        background: BAR_BY_STATE[state]
                    }}
                />
            )}

            <div className={titleClass} style={{ color: titleColor }}>
                {milestone.name}
            </div>

            {isSelected ? <SelectionBox outset={selOutset} /> : null}

            <Handle type="target" position={Position.Top} style={HANDLE_STYLE} />
            <Handle type="source" position={Position.Bottom} style={HANDLE_STYLE} />
        </div>
    )
}

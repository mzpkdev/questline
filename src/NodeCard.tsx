// Gilded node card for React Flow, ported from the mockup's SVG nodes
// (experiments/skill-tree/index.html, renderNodes ~415-468). This is VISUAL +
// SELECTION only: appearance is driven entirely by `data` (state / isRoot /
// isSelected), which the Tree precomputes. Selection is handled by the Tree via
// React Flow's onNodeClick, so there is no click handler here.

import type { NodeProps } from "@xyflow/react"
import { Handle, Position } from "@xyflow/react"
import type { CSSProperties } from "react"
import type { NodeFlowNode } from "./flow"
import { NODE_SIZE } from "./flow"
import type { NodeState } from "./nodes"
import { useNodeMotion } from "./nodeMotion"

// Inner fill (padding-box) gradient per state. The root node always uses ROOT_INNER. Exported so the
// linked node can reuse the same gilded surface.
export const INNER_BY_STATE: Record<NodeState, string> = {
    mastered: "linear-gradient(180deg,#fdf4d2,#eeddab)",
    available: "linear-gradient(180deg,#fefaee,#f4e8c8)",
    locked: "linear-gradient(180deg,#efe9d8,#e0d6bd)",
    // Detached (parked): a cooler, flatter, greyed parchment -- clearly deader than locked.
    detached: "linear-gradient(180deg,#e7e3d6,#d7d0bd)"
}
const ROOT_INNER = "linear-gradient(180deg,#fcefb8,#f0d992)"

// Gilded frame (border-box) gradient. Locked non-root cards use the dim ring.
export const RING_GOLD = "linear-gradient(180deg,#fdf1b6,#dab24c,#8a641d)"
const RING_DIM = "linear-gradient(180deg,#e0d3ad,#a99a72)"

// The marching-ants selection outline, a few pixels clear of the card on every side. Shared so the
// linked node highlights the same way when selected.
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
const BAR_BY_STATE: Record<NodeState, string> = {
    mastered: "#c69a34",
    available: "#e6c458",
    locked: "#bcad86",
    detached: "#b0a381"
}

// Handles exist only to anchor edges; keep them invisible.
const HANDLE_STYLE: CSSProperties = { opacity: 0, width: 6, height: 6, border: "none" }

export function NodeCard({ data }: NodeProps<NodeFlowNode>) {
    const { node, state, isRoot, isSelected } = data
    // Drives this card's motion: spawn-in when added, ignite on unlock, seal when completed, pop when
    // an edge reaches it.
    const cardRef = useNodeMotion<HTMLDivElement>(node.id, state)

    const size = isRoot ? NODE_SIZE.root : NODE_SIZE.normal
    const inset = isRoot ? 5 : 3.5
    const inner = isRoot ? ROOT_INNER : INNER_BY_STATE[state]
    // A detached (parked) node reads distinct from locked: a dashed grey frame in place of the gilded
    // ring, plus a heavier fade -- so a cut-loose branch looks inert, not merely not-yet-unlocked. The
    // root is always reachable from itself, so it never lands here.
    const detached = state === "detached"
    const ring = state === "locked" && !isRoot ? RING_DIM : RING_GOLD
    const cardOpacity = state === "mastered" ? 0.55 : detached ? 0.5 : state === "locked" ? 0.92 : 1
    const titleColor = isRoot ? "#5a4012" : detached ? "#9c8c68" : state === "locked" ? "#93815a" : "#6f5316"

    // Glow shows for available (pulsing) or root (static faint, pulsing when the
    // root is also available). The selection outset keeps the marching ants a few
    // pixels clear of the card on every side.
    const showGlow = state === "available" || isRoot
    const glowPulses = state === "available"
    const selOutset = inset + 3

    const titleClass = isRoot
        ? "flex-1 min-w-0 px-3 text-center font-display text-[20px] font-bold leading-tight tracking-[.2px]"
        : "flex-1 min-w-0 pl-5 pr-3 text-left font-display text-[16px] font-bold leading-tight tracking-[.2px]"

    return (
        <div
            ref={cardRef}
            className="relative flex items-center cursor-pointer select-none transition-transform hover:scale-[1.04]"
            data-id={node.id}
            data-state={state}
            style={{
                width: size.width,
                minHeight: size.height,
                border: detached ? `${inset}px dashed #b3a480` : `${inset}px solid transparent`,
                borderRadius: 13,
                background: detached ? `${inner} padding-box` : `${inner} padding-box, ${ring} border-box`,
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

            {isRoot ? null : (
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
                {node.name}
            </div>

            {isSelected ? <SelectionBox outset={selOutset} /> : null}

            <Handle type="target" position={Position.Top} style={HANDLE_STYLE} />
            <Handle type="source" position={Position.Bottom} style={HANDLE_STYLE} />
        </div>
    )
}

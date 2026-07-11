// A linked node points at another board (its action is "Go to Board"). It reuses the node card's
// gilded container and font so it reads as a node, with a stacked-cards shadow and a layers icon to
// mark it as a whole board rather than a single node. Clicking it selects it; App then opens the
// shared detail card. It's draggable like any node.
//
// Dormant scaffold for Phase 1: no linked nodes exist yet, so nothing builds one. BoardTree keeps the
// "view" node type registered so Phase 2 only has to reintroduce a draggable makeLinkedNode and the
// board-dropdown card mode; the completion/naming wiring lands then too.

import { Handle, type NodeProps, Position } from "@xyflow/react"
import type { CSSProperties } from "react"
import type { LinkedFlowNode } from "./flow"
import { NODE_SIZE } from "./flow"
import { INNER_BY_STATE, RING_GOLD, SelectionBox } from "./NodeCard"
import { useNodeMotion } from "./nodeMotion"

// Border width of the gilded frame (matches a non-root node card).
const INSET = 3.5

// Invisible handle so the link down from the Root node still has something to anchor to.
const HANDLE_STYLE: CSSProperties = { opacity: 0, width: 6, height: 6, border: "none" }

// The gilded card surface (same as a node) plus a stacked second card peeking behind. A complete
// board uses the mastered fill and fades, mirroring how a completed node card reads.
function chipStyle(complete: boolean): CSSProperties {
    return {
        width: NODE_SIZE.normal.width,
        minHeight: NODE_SIZE.normal.height,
        border: `${INSET}px solid transparent`,
        borderRadius: 13,
        background: `${complete ? INNER_BY_STATE.mastered : INNER_BY_STATE.available} padding-box, ${RING_GOLD} border-box`,
        boxShadow: "0 3px 6px -1px rgba(90,61,12,0.4), 5px 5px 0 0 #f4e8c8, 5px 5px 0 1.5px #cba94f",
        opacity: complete ? 0.6 : 1
    }
}

export function LinkedNode({ id, data }: NodeProps<LinkedFlowNode>) {
    const { name, isSelected, complete } = data
    // Linked nodes are never locked; they seal when their board's root node is complete.
    const cardRef = useNodeMotion<HTMLDivElement>(id, complete ? "mastered" : "available")

    return (
        <div
            ref={cardRef}
            data-id={id}
            data-linked-node=""
            data-complete={complete ? "" : undefined}
            className="relative flex cursor-pointer select-none items-center gap-2 px-4 transition-transform hover:scale-[1.04]"
            style={chipStyle(complete)}
        >
            <svg
                width={16}
                height={16}
                viewBox="0 0 24 24"
                fill="none"
                stroke="#8a6b28"
                strokeWidth={1.8}
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
                className="flex-none"
            >
                <path d="M3 7l9-4 9 4-9 4-9-4Z" />
                <path d="M3 12l9 4 9-4" />
                <path d="M3 17l9 4 9-4" />
            </svg>
            <span className="min-w-0 flex-1 truncate font-display text-[16px] font-bold leading-tight tracking-[.2px] text-[#6f5316]">
                {name}
            </span>
            {complete && (
                <svg
                    width={16}
                    height={16}
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="#7a5c1c"
                    strokeWidth={3}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                    className="flex-none"
                >
                    <path d="M5 12l5 5L20 6" />
                </svg>
            )}

            <Handle type="target" position={Position.Top} style={HANDLE_STYLE} />
            <Handle type="source" position={Position.Bottom} style={HANDLE_STYLE} />
            {isSelected ? <SelectionBox outset={INSET + 3} /> : null}
        </div>
    )
}

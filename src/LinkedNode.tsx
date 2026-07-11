// A linked node points at another board (its action is "Go to Board"). It reuses the node card's
// gilded container and font so it reads as a node, with a stacked-cards shadow and a layers icon to
// mark it as a whole board rather than a single node. Clicking it selects it; App then opens the
// shared detail card. It's a real, draggable tree node: it has x/y, can parent other nodes, and is
// reconciled through BoardTree like any node.
//
// Its `name` is derived live from the target board's root node (board.linkedNodeName), so a rename of
// that board flows through; an unlinked node shows the placeholder. Its `state` is derived: a linked
// node reads "mastered" exactly when its target board is complete (it never enters a `mastered` set),
// and otherwise locked / available from its own subtree.

import { Handle, type NodeProps, Position } from "@xyflow/react"
import type { CSSProperties } from "react"
import type { LinkedFlowNode } from "./flow"
import { NODE_SIZE } from "./flow"
import { INNER_BY_STATE, RING_GOLD, SelectionBox } from "./NodeCard"
import { useNodeMotion } from "./nodeMotion"
import type { NodeState } from "./nodes"

// Border width of the gilded frame (matches a non-root node card).
const INSET = 3.5

// Invisible handle so an edge into / out of a linked node still has something to anchor to.
const HANDLE_STYLE: CSSProperties = { opacity: 0, width: 6, height: 6, border: "none" }

// The gilded card surface (same as a node) plus a stacked second card peeking behind, marking it as a
// whole board. A locked linked node (children still incomplete) dims a touch, mirroring a node card.
function chipStyle(state: NodeState): CSSProperties {
    return {
        width: NODE_SIZE.normal.width,
        minHeight: NODE_SIZE.normal.height,
        border: `${INSET}px solid transparent`,
        borderRadius: 13,
        background: `${INNER_BY_STATE[state]} padding-box, ${RING_GOLD} border-box`,
        boxShadow: "0 3px 6px -1px rgba(90,61,12,0.4), 5px 5px 0 0 #f4e8c8, 5px 5px 0 1.5px #cba94f",
        opacity: state === "locked" ? 0.92 : 1
    }
}

export function LinkedNode({ id, data }: NodeProps<LinkedFlowNode>) {
    const { name, state, isSelected } = data
    const cardRef = useNodeMotion<HTMLDivElement>(id, state)

    return (
        <div
            ref={cardRef}
            data-id={id}
            data-linked-node=""
            className="relative flex cursor-pointer select-none items-center gap-2 px-4 transition-transform hover:scale-[1.04]"
            style={chipStyle(state)}
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

            <Handle type="target" position={Position.Top} style={HANDLE_STYLE} />
            <Handle type="source" position={Position.Bottom} style={HANDLE_STYLE} />
            {isSelected ? <SelectionBox outset={INSET + 3} /> : null}
        </div>
    )
}

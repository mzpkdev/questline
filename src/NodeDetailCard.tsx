import { Check, Link2, Pencil, Plus, SquareArrowDown, SquareArrowUp, Trash2, Unlink, X } from "lucide-react"
import { type CSSProperties, type ReactElement, type ReactNode, useEffect, useRef, useState } from "react"
import { Coin } from "./Coin"
import { ConfirmDialog } from "./ConfirmDialog"
import { STATE_LABEL } from "./graph"
import type { Node, NodeState, Todo } from "./nodes"
import { useCheckPop } from "./nodeMotion"

// A visual re-port of the mockup's detail sidebar (renderCard). Checklist ticks call `onToggle`
// (only when the node is actionable); the pencil flips to the mockup's edit layout, whose fields
// (name, description, checklist item text / delete / add) commit live through the on* edit callbacks,
// as do the add child / parent / linked-node buttons. A linked node (isLinked) gets a distinct mode:
// no checklist / reward / description, a board dropdown to pick its target, and a Go to Board action.
// The App remounts this card via a React key on selection change, so both the cardSwap animation and
// the edit toggle reset per node.
export type NodeDetailCardProps = {
    node: Node
    state: NodeState
    todos: Todo[]
    isRoot: boolean
    // A linked node: renders the linked mode (board dropdown + Go to Board), no checklist/reward/desc.
    isLinked?: boolean
    // A linked node's live-derived display name (its target board's root node name, or a placeholder
    // while unlinked). Ignored unless isLinked.
    linkedName?: string
    // Every OTHER board this linked node may point at (self already excluded), for the dropdown.
    boardOptions?: { id: string; name: string }[]
    // The linked node's current target (null while unlinked). Drives the dropdown value and whether Go
    // to Board is enabled.
    targetBoardId?: string | null
    // Pick (or clear, with null) the linked node's target board.
    onSetLinkedTarget?: (boardId: string | null) => void
    // Navigate to the linked node's target board. Rendered disabled while the node is unlinked.
    onGoToBoard?: () => void
    closing?: boolean
    onToggle?: (index: number) => void
    onComplete?: () => void
    onUncomplete?: () => void
    onEditNode?: (patch: { name?: string; description?: string; reward?: number }) => void
    onEditTodo?: (index: number, text: string) => void
    onDeleteTodo?: (index: number) => void
    onAddTodo?: () => void
    onAddChild?: () => void
    onAddParent?: () => void
    // Attach an (unlinked) linked node as a child. Offered on every node kind.
    onAddLinkedNode?: () => void
    // Detach this node (with its whole subtree) from its parent and arm reparent mode ("Detach").
    // Offered on every node EXCEPT the root -- App passes it only for a non-root selection. Edit mode only.
    onDetach?: () => void
    // When set, edit mode offers a destructive delete (confirmed first). Omit it and no delete shows.
    onDelete?: () => void
    // What the delete removes: a node + its subtree, or the whole board (deleting a board's root node).
    // Drives the button label + confirm copy.
    deleteKind?: "node" | "board"
    // Sub-node count under this node, so the delete confirm can warn about the cascade.
    descendantCount?: number
    // Open the card straight in edit mode (used for a just-added node, so its name / target is editable
    // at once). Read on mount only; the card is remounted per node via a key, so it seeds each fresh node.
    initialEditing?: boolean
    onExited?: () => void
}

// Gold-framed panel: the double-gradient border trick (padding-box fill under a border-box frame).
const CARD_STYLE: CSSProperties = {
    border: "2px solid transparent",
    borderRadius: "16px",
    background:
        "linear-gradient(180deg,#faf2dc,#efe1bd) padding-box, linear-gradient(180deg,#fbeeb8,#b8892b) border-box",
    boxShadow: "0 24px 50px -20px rgba(60,40,10,0.6), inset 0 1px 0 rgba(255,255,255,0.6)",
    padding: "18px 20px 20px"
}

const PENCIL_STYLE: CSSProperties = {
    background: "rgba(255,255,255,0.45)",
    color: "#9a7a34",
    border: "1px solid rgba(138,100,29,0.3)"
}

// State badge palette, mirroring the mockup's .sb-* rules.
const BADGE_STYLE: Record<NodeState, CSSProperties> = {
    mastered: { background: "#d9be74", color: "#4a3410", border: "1px solid #b8892b" },
    available: { background: "#f3e6bf", color: "#8a6b28", border: "1px solid #cdb373" },
    locked: { background: "#e4dcc4", color: "#8a7c5a", border: "1px solid #b9a986" }
}

// Checklist tick: parchment when open, gold-tan fill once checked (mockup .todo-check[aria-pressed="true"]).
const CHECK_STYLE: CSSProperties = {
    border: "1.5px solid #b8892b",
    background: "#fffdf5",
    color: "#8a641d"
}

const CHECK_STYLE_DONE: CSSProperties = {
    border: "1.5px solid #cdb373",
    background: "#ecdcae",
    color: "#8a641d"
}

// Action button looks, keyed to the mockup's .act-undo / .act-unlock / muted (.act-off, disabled) rules.
const UNDO_STYLE: CSSProperties = {
    background: "#e7ddc4",
    color: "#7a6a45",
    boxShadow: "inset 0 0 0 1px rgba(138,100,29,0.3)"
}

const UNLOCK_STYLE: CSSProperties = {
    background: "#e6c458",
    color: "#3a2a0c",
    boxShadow: "0 3px 9px -5px rgba(184,137,43,0.7), inset 0 1px 0 rgba(255,255,255,0.4)"
}

const MUTED_STYLE: CSSProperties = {
    background: "#e0d5b6",
    color: "#8a7c5a",
    boxShadow: "inset 0 1px 3px rgba(90,60,10,0.2)"
}

const ACTION_CLASS = "w-full rounded-[11px] py-3 font-display text-[14px] font-bold uppercase tracking-wide"
// The action button (Complete / Reset / Locked / Go to Board): lifts on hover, presses on click, and
// eases its colours when the state flips in place (e.g. available -> mastered morphs gold to muted). The
// global reduced-motion rule zeroes these transitions.
const ACTION_BTN_CLASS = `${ACTION_CLASS} transition-[background-color,color,box-shadow,transform] duration-200 ease-out enabled:hover:-translate-y-0.5 enabled:hover:scale-[1.02] enabled:active:translate-y-0 enabled:active:scale-100`

// Edit-mode field / button looks (mockup .edit-title, .edit-desc, .todo-edit, .todo-del, .todo-add, .add-*).
const FIELD_FOCUS = "focus:border-[#b8892b] focus:outline-none focus:ring-2 focus:ring-[#e6c458]/40"
const EDIT_TITLE_CLASS = `w-full rounded-lg border border-[#d8c48f] bg-[#fffdf5] px-2.5 py-1.5 pr-10 font-display text-[20px] font-bold text-[#4a3410] ${FIELD_FOCUS}`
const EDIT_DESC_CLASS = `my-[14px] min-h-24 w-full resize-y rounded-lg border border-[#d8c48f] bg-[#fffdf5] px-2.5 py-2 text-[15.5px] leading-relaxed text-[#5a4a2c] ${FIELD_FOCUS}`
const TODO_EDIT_CLASS = `min-w-0 flex-1 rounded-[7px] border border-[#d8c48f] bg-[#fffdf5] px-2 py-1.5 text-[14.5px] text-[#5a4a2c] ${FIELD_FOCUS}`
const SELECT_CLASS = `w-full rounded-lg border border-[#d8c48f] bg-[#fffdf5] px-2.5 py-2 font-display text-[15px] text-[#4a3410] ${FIELD_FOCUS}`
const EDIT_BTN_TRANSITION = "transition-colors duration-150 ease-out"
const TODO_DEL_CLASS = `grid h-6 w-6 flex-none appearance-none place-items-center rounded-[7px] border border-transparent bg-transparent text-[17px] leading-none text-[#b3a074] opacity-[.42] transition-[opacity,color,background-color,transform] duration-150 ease-out hover:opacity-100 hover:bg-[#f4ead0]/70 hover:text-[#8a6b28] active:scale-95`
const TODO_ADD_CLASS = `mt-2.5 grid h-8 w-8 place-items-center self-start rounded-lg border-[1.5px] border-dashed border-[#cdb373] text-[#8a6b28] ${EDIT_BTN_TRANSITION} hover:bg-[#f6eccf]`
// Edit-mode action buttons are icon-only squares laid out in a grid: a dashed gold secondary look for
// the structural adds / unconnect, and a danger-red variant for delete (matching the tab-remove
// affordance #a5482a). Icon-only, so each carries an aria-label + title tooltip for its action. Lives
// in edit mode only, so read mode can't fat-finger a delete.
const ICON_BTN_BASE =
    "grid aspect-square w-full place-items-center rounded-[11px] border-[1.5px] transition-colors duration-150 ease-out"
const ICON_BTN_ADD = `${ICON_BTN_BASE} border-dashed border-[#cdb373] bg-transparent text-[#8a6b28] hover:bg-[#f6eccf]`
const ICON_BTN_DANGER = `${ICON_BTN_BASE} border-solid border-[#a5482a]/40 bg-transparent text-[#a5482a] hover:bg-[#a5482a]/10`
const CHECKLIST_HEAD_CLASS = "font-display text-[11px] uppercase tracking-widest text-[#8a6b28]"

// A single read-mode checklist row. Its box bounces the moment it's ticked (useCheckPop), so checking
// an item off feels like a stamp; disabled (non-actionable) rows still render but don't toggle.
function ChecklistItem({
    todo,
    index,
    disabled,
    onToggle
}: {
    todo: Todo
    index: number
    disabled: boolean
    onToggle?: (index: number) => void
}) {
    const boxRef = useCheckPop<HTMLButtonElement>(todo.done)
    return (
        <li className="flex items-center gap-[9px]">
            <button
                ref={boxRef}
                type="button"
                aria-pressed={todo.done}
                aria-label={todo.done ? `Uncheck ${todo.text}` : `Check ${todo.text}`}
                disabled={disabled}
                onClick={() => onToggle?.(index)}
                className="grid h-5 w-5 flex-none place-items-center rounded-md"
                style={todo.done ? CHECK_STYLE_DONE : CHECK_STYLE}
            >
                {todo.done && (
                    <svg
                        aria-hidden="true"
                        viewBox="0 0 24 24"
                        width={13}
                        height={13}
                        fill="none"
                        stroke="currentColor"
                        strokeWidth={3}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                    >
                        <path d="M5 12l5 5L20 6" />
                    </svg>
                )}
            </button>
            <span className={todo.done ? "text-[14.5px] text-[#a2916c] line-through" : "text-[14.5px] text-[#5a4a2c]"}>
                {todo.text}
            </span>
        </li>
    )
}

// One icon-only edit-mode action button. Icon-only, so `label` is both the accessible name (aria-label)
// and the hover tooltip (title); `danger` swaps the dashed gold look for the destructive red variant.
function ActionIcon({
    label,
    onClick,
    danger = false,
    children
}: {
    label: string
    onClick?: () => void
    danger?: boolean
    children: ReactNode
}) {
    return (
        <button
            type="button"
            aria-label={label}
            title={label}
            onClick={onClick}
            className={danger ? ICON_BTN_DANGER : ICON_BTN_ADD}
        >
            {children}
        </button>
    )
}

export function NodeDetailCard(props: NodeDetailCardProps) {
    const {
        node,
        state,
        todos,
        isRoot,
        isLinked = false,
        linkedName = "",
        boardOptions = [],
        targetBoardId = null,
        onSetLinkedTarget,
        onGoToBoard,
        closing,
        onToggle,
        onComplete,
        onUncomplete,
        onEditNode,
        onEditTodo,
        onDeleteTodo,
        onAddTodo,
        onAddChild,
        onAddParent,
        onAddLinkedNode,
        onDetach,
        onDelete,
        deleteKind = "node",
        descendantCount = 0,
        initialEditing = false,
        onExited
    } = props
    const [editing, setEditing] = useState(initialEditing)
    const [confirmOpen, setConfirmOpen] = useState(false)
    const rootRef = useRef<HTMLDivElement>(null)
    const titleRef = useRef<HTMLInputElement>(null)
    const selectRef = useRef<HTMLSelectElement>(null)

    // A just-added node opens in edit mode: focus its first field so the primary edit is one keystroke
    // away -- the name for a regular node, the board dropdown for a linked one. Mount-only (the card
    // remounts per node), so it never steals focus on a later edit toggle.
    useEffect(() => {
        if (!initialEditing) return
        if (isLinked) {
            selectRef.current?.focus()
        } else {
            titleRef.current?.focus()
            titleRef.current?.select()
        }
    }, [initialEditing, isLinked])

    // Fire onExited once the dismissal animation ends. A native listener (attached only while closing)
    // sidesteps React's delegated onAnimationEnd, which needs the event to bubble to the root.
    useEffect(() => {
        if (!closing || !onExited) return
        const el = rootRef.current
        if (!el) return
        const handleEnd = () => onExited()
        el.addEventListener("animationend", handleEnd)
        return () => el.removeEventListener("animationend", handleEnd)
    }, [closing, onExited])

    const badge = (
        <span
            className="inline-block rounded-full px-2.5 py-0.5 font-display text-[10.5px] uppercase tracking-wide transition-[background-color,color,border-color] duration-300 ease-out"
            style={BADGE_STYLE[state]}
        >
            {STATE_LABEL[state]}
        </span>
    )

    const animation = closing
        ? "animate-[cardSwapOut_0.2s_ease-in_forwards]"
        : "animate-[cardSwap_0.26s_cubic-bezier(0.2,0.75,0.25,1)]"

    // The name shown at the top + in the delete confirm: a linked node mirrors its target board (a
    // placeholder while unlinked); every other node uses its own stored name.
    const displayName = isLinked ? linkedName : node.name

    const pencil = (
        <button
            type="button"
            aria-label={editing ? "Finish editing" : "Edit"}
            onClick={() => setEditing((prev) => !prev)}
            className="absolute right-3 top-3 grid h-[30px] w-[30px] place-items-center rounded-[9px] transition-transform duration-150 ease-out hover:scale-110 active:scale-95"
            style={PENCIL_STYLE}
        >
            {editing ? <Check size={16} strokeWidth={2.5} /> : <Pencil size={15} strokeWidth={2} />}
        </button>
    )

    // Structural actions (edit mode): an icon-only grid, one square per action. Add child is always
    // offered; Add parent and Add linked node each render only when their handler is wired (App wires
    // Add parent for regular AND linked nodes, since insertParent splices a node above either). Detach
    // renders only when onDetach is wired -- App passes it for every non-root node, so the root never
    // offers it. Delete (danger red) opens a confirm first. The parent-up / child-down arrows read as
    // the top-down tree's above / below.
    const actionGrid = (
        <div className="grid grid-cols-4 gap-2">
            {onAddParent && (
                <ActionIcon label="Add parent node" onClick={onAddParent}>
                    <SquareArrowUp size={18} />
                </ActionIcon>
            )}
            <ActionIcon label="Add child node" onClick={onAddChild}>
                <SquareArrowDown size={18} />
            </ActionIcon>
            {onAddLinkedNode && (
                <ActionIcon label="Add linked node" onClick={onAddLinkedNode}>
                    <Link2 size={18} />
                </ActionIcon>
            )}
            {onDetach && (
                <ActionIcon label="Detach node" onClick={onDetach}>
                    <Unlink size={18} />
                </ActionIcon>
            )}
            {onDelete && (
                <ActionIcon
                    label={deleteKind === "board" ? "Delete board" : "Delete node"}
                    danger
                    onClick={() => setConfirmOpen(true)}
                >
                    <Trash2 size={18} />
                </ActionIcon>
            )}
        </div>
    )

    // The delete confirm dialog (edit mode); its trigger is the danger cell in actionGrid above. Copy
    // follows deleteKind. Rendered only when a delete handler is wired.
    const confirmDialog = onDelete ? (
        <ConfirmDialog
            open={confirmOpen}
            title={deleteKind === "board" ? "Remove this board?" : "Delete this node?"}
            message={
                deleteKind === "board" ? (
                    <>
                        Delete <strong className="font-semibold text-[#4a3410]">{displayName}</strong>? This removes the
                        whole board and can't be undone.
                    </>
                ) : descendantCount > 0 ? (
                    <>
                        Delete <strong className="font-semibold text-[#4a3410]">{displayName}</strong> and its{" "}
                        {descendantCount} sub-node{descendantCount === 1 ? "" : "s"}? This can't be undone.
                    </>
                ) : (
                    <>
                        Delete <strong className="font-semibold text-[#4a3410]">{displayName}</strong>? This can't be
                        undone.
                    </>
                )
            }
            confirmLabel="Delete"
            onConfirm={() => {
                // Close first, THEN delete: onDelete may unmount this card, so touching confirmOpen
                // afterward would be a set-state-on-unmounted warning.
                setConfirmOpen(false)
                onDelete()
            }}
            onOpenChange={(open) => {
                if (!open) setConfirmOpen(false)
            }}
        />
    ) : null

    // A linked node: no checklist / reward / description. Read mode's action is Go to Board (disabled
    // while unlinked); edit mode swaps that for the board dropdown plus the add / delete affordances.
    if (isLinked) {
        const goToBoard = (
            <button
                type="button"
                onClick={onGoToBoard}
                disabled={!targetBoardId}
                className={ACTION_BTN_CLASS}
                style={targetBoardId ? UNLOCK_STYLE : MUTED_STYLE}
            >
                Go to Board
            </button>
        )
        return (
            <div ref={rootRef} data-testid="detail-card" className={`relative font-serif ${animation}`} style={CARD_STYLE}>
                {pencil}
                {editing ? (
                    <>
                        <h3 className="mt-0.5 pr-10 font-display text-[20px] font-bold text-[#4a3410]">{displayName}</h3>
                        <div className="mt-[7px]">{badge}</div>
                        <div className="mb-[15px] mt-[14px]">
                            <span className={`${CHECKLIST_HEAD_CLASS} mb-[9px] block`}>Linked board</span>
                            <select
                                ref={selectRef}
                                aria-label="Link to board"
                                className={SELECT_CLASS}
                                value={targetBoardId ?? ""}
                                onChange={(event) => onSetLinkedTarget?.(event.target.value || null)}
                            >
                                <option value="">Choose a board…</option>
                                {boardOptions.map((board) => (
                                    <option key={board.id} value={board.id}>
                                        {board.name}
                                    </option>
                                ))}
                            </select>
                        </div>
                        {actionGrid}
                        {confirmDialog}
                    </>
                ) : (
                    <>
                        <div className="mb-[14px] flex items-center gap-[14px]">
                            <div>
                                <h3 className="mt-0.5 font-display text-[20px] font-bold text-[#4a3410]">
                                    {displayName}
                                </h3>
                                <span className="mt-[7px] inline-block">{badge}</span>
                            </div>
                        </div>
                        <div className="mt-[14px]">{goToBoard}</div>
                    </>
                )}
            </div>
        )
    }

    const showChecklist = !isRoot && todos.length > 0
    const doneCount = todos.filter((todo) => todo.done).length
    const allDone = todos.every((todo) => todo.done) // vacuously true for the root node's empty list

    let action: ReactElement
    let hint: ReactElement | null = null
    if (state === "mastered") {
        action = (
            <button type="button" onClick={onUncomplete} className={ACTION_BTN_CLASS} style={UNDO_STYLE}>
                {isRoot ? "Reset Quest" : "Mark Incomplete"}
            </button>
        )
    } else if (state === "available" && allDone) {
        action = (
            <button type="button" onClick={onComplete} className={ACTION_BTN_CLASS} style={UNLOCK_STYLE}>
                {isRoot ? "Complete Quest" : "Mark Complete"}
            </button>
        )
    } else if (state === "available") {
        action = (
            <button type="button" disabled className={ACTION_BTN_CLASS} style={MUTED_STYLE}>
                Mark Complete
            </button>
        )
        hint = (
            <p className="mt-[9px] text-center text-[12.5px] italic text-[#a2916c]">
                Check off every item to complete this node.
            </p>
        )
    } else {
        action = (
            <button type="button" disabled className={ACTION_BTN_CLASS} style={MUTED_STYLE}>
                Locked
            </button>
        )
    }

    return (
        <div ref={rootRef} data-testid="detail-card" className={`relative font-serif ${animation}`} style={CARD_STYLE}>
            {pencil}

            {editing ? (
                <>
                    <input
                        ref={titleRef}
                        className={EDIT_TITLE_CLASS}
                        value={node.name}
                        maxLength={60}
                        onChange={(event) => onEditNode?.({ name: event.target.value })}
                    />
                    <div className="mt-[7px]">{badge}</div>
                    <textarea
                        className={EDIT_DESC_CLASS}
                        value={node.description ?? ""}
                        onChange={(event) => onEditNode?.({ description: event.target.value })}
                    />

                    <div className="mb-[15px]">
                        <span className={`${CHECKLIST_HEAD_CLASS} mb-[9px] block`}>Reward</span>
                        <div className="flex items-center gap-2">
                            <Coin size={20} className="flex-none" />
                            <input
                                aria-label="Reward in gold"
                                type="number"
                                min={0}
                                step={1}
                                value={node.reward ?? 0}
                                onChange={(event) => {
                                    const n = event.target.valueAsNumber
                                    onEditNode?.({ reward: Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0 })
                                }}
                                className={`${TODO_EDIT_CLASS} max-w-[92px] flex-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none`}
                            />
                            <span className="font-display text-[11px] uppercase tracking-wide text-[#b09a63]">
                                gold on completion
                            </span>
                        </div>
                    </div>

                    {!isRoot && (
                        <div className="mb-[15px]">
                            <div className="mb-[9px] flex items-baseline justify-between">
                                <span className={CHECKLIST_HEAD_CLASS}>Checklist</span>
                                {todos.length > 0 && (
                                    <span className="font-display text-[11px] text-[#b09a63]">
                                        {doneCount}/{todos.length}
                                    </span>
                                )}
                            </div>
                            <ul className="m-0 flex list-none flex-col gap-[7px] p-0">
                                {todos.map((todo, index) => (
                                    <li key={index} className="flex items-center gap-[9px]">
                                        <input
                                            className={TODO_EDIT_CLASS}
                                            value={todo.text}
                                            maxLength={80}
                                            placeholder="Describe a step..."
                                            onChange={(event) => onEditTodo?.(index, event.target.value)}
                                        />
                                        <button
                                            type="button"
                                            aria-label="Remove item"
                                            title="Remove item"
                                            className={TODO_DEL_CLASS}
                                            onClick={() => onDeleteTodo?.(index)}
                                        >
                                            <X size={16} />
                                        </button>
                                    </li>
                                ))}
                            </ul>
                            <button
                                type="button"
                                aria-label="Add item"
                                title="Add item"
                                className={TODO_ADD_CLASS}
                                onClick={onAddTodo}
                            >
                                <Plus size={16} />
                            </button>
                        </div>
                    )}

                    {actionGrid}

                    {confirmDialog}
                </>
            ) : (
                <>
                    <div className="mb-[14px] flex items-center gap-[14px]">
                        <div>
                            <h3 className="mt-0.5 font-display text-[20px] font-bold text-[#4a3410]">{node.name}</h3>
                            <span className="mt-[7px] inline-block">{badge}</span>
                        </div>
                    </div>

                    {node.description && (
                        <p className="mb-[14px] text-[15.5px] leading-relaxed text-[#5a4a2c]">{node.description}</p>
                    )}

                    <div className="mb-[15px]">
                        <span className={`${CHECKLIST_HEAD_CLASS} mb-[9px] block`}>Reward</span>
                        <div className="flex items-center gap-2">
                            <Coin size={20} className="flex-none" />
                            <span className="font-display text-[15px] font-bold text-[#6f5316]">{node.reward ?? 0}</span>
                            <span className="font-display text-[11px] uppercase tracking-wide text-[#b09a63]">
                                gold on completion
                            </span>
                        </div>
                    </div>

                    {showChecklist && (
                        <div className="mb-[15px] mt-0.5">
                            <div className="mb-[9px] flex items-baseline justify-between">
                                <span className={CHECKLIST_HEAD_CLASS}>Checklist</span>
                                <span className="font-display text-[11px] text-[#b09a63]">
                                    {doneCount}/{todos.length}
                                </span>
                            </div>
                            <ul className="m-0 flex list-none flex-col gap-[7px] p-0">
                                {todos.map((todo, index) => (
                                    <ChecklistItem
                                        key={index}
                                        todo={todo}
                                        index={index}
                                        disabled={state !== "available"}
                                        onToggle={onToggle}
                                    />
                                ))}
                            </ul>
                        </div>
                    )}

                    <div className="mt-[14px]">
                        {action}
                        {hint}
                    </div>
                </>
            )}
        </div>
    )
}

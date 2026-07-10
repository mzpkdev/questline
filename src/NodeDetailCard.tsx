import { type CSSProperties, type ReactElement, useEffect, useRef, useState } from "react"
import { Coin } from "./Coin"
import { ConfirmDialog } from "./ConfirmDialog"
import { STATE_LABEL } from "./graph"
import type { Milestone, MilestoneState, Todo } from "./milestones"
import { useCheckPop } from "./nodeMotion"

// A visual re-port of the mockup's detail sidebar (renderCard). Checklist ticks call `onToggle`
// (only when the milestone is actionable); the pencil flips to the mockup's edit layout, whose
// fields (name, description, checklist item text / delete / add) commit live through the on* edit
// callbacks. Adding sub-/parent milestones is still visual-only. The App remounts this card via a
// React key on selection change, so both the cardSwap animation and the edit toggle reset per node.
export type NodeDetailCardProps = {
    milestone: Milestone
    state: MilestoneState
    todos: Todo[]
    isGoal: boolean
    closing?: boolean
    onToggle?: (index: number) => void
    onComplete?: () => void
    onUncomplete?: () => void
    onEditMilestone?: (patch: { name?: string; description?: string; reward?: number }) => void
    onEditTodo?: (index: number, text: string) => void
    onDeleteTodo?: (index: number) => void
    onAddTodo?: () => void
    onAddChild?: () => void
    onAddParent?: () => void
    // When set, edit mode offers "+ Add sub-view" (a child view in the Root hub). Shown for view
    // chips and the Root node.
    onAddSubView?: () => void
    // View-node mode: the action is a single "View" button, and edit mode is limited to name,
    // description, and reward (plus + Add sub-view); no badge, checklist, sub-milestone, or parent
    // buttons. A view chip's reward is its underlying goal's, editable here via onEditMilestone.
    isView?: boolean
    // Whether completing this node mints gold. True for every real milestone/goal and view chip; false
    // only for the Root hub goal (which never pays out), which hides the reward editor.
    earnsGold?: boolean
    onView?: () => void
    // When set, edit mode offers a destructive delete (confirmed first). Omit it and no delete shows.
    onDelete?: () => void
    // What the delete removes: a milestone + its subtree, or the whole view. Drives the button + copy.
    deleteKind?: "milestone" | "view"
    // Sub-milestone count under this node, so the milestone confirm can warn about the cascade.
    descendantCount?: number
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
const BADGE_STYLE: Record<MilestoneState, CSSProperties> = {
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
// The action button (Complete / Reset / Locked / View): lifts on hover, presses on click, and eases
// its colours when the state flips in place (e.g. available -> mastered morphs gold to muted). The
// global reduced-motion rule zeroes these transitions.
const ACTION_BTN_CLASS = `${ACTION_CLASS} transition-[background-color,color,box-shadow,transform] duration-200 ease-out enabled:hover:-translate-y-0.5 enabled:hover:scale-[1.02] enabled:active:translate-y-0 enabled:active:scale-100`

// Edit-mode field / button looks (mockup .edit-title, .edit-desc, .todo-edit, .todo-del, .todo-add, .add-*).
const FIELD_FOCUS = "focus:border-[#b8892b] focus:outline-none focus:ring-2 focus:ring-[#e6c458]/40"
const EDIT_TITLE_CLASS = `w-full rounded-lg border border-[#d8c48f] bg-[#fffdf5] px-2.5 py-1.5 pr-10 font-display text-[20px] font-bold text-[#4a3410] ${FIELD_FOCUS}`
const EDIT_DESC_CLASS = `my-[14px] min-h-24 w-full resize-y rounded-lg border border-[#d8c48f] bg-[#fffdf5] px-2.5 py-2 text-[15.5px] leading-relaxed text-[#5a4a2c] ${FIELD_FOCUS}`
const TODO_EDIT_CLASS = `min-w-0 flex-1 rounded-[7px] border border-[#d8c48f] bg-[#fffdf5] px-2 py-1.5 text-[14.5px] text-[#5a4a2c] ${FIELD_FOCUS}`
const EDIT_BTN_TRANSITION = "transition-colors duration-150 ease-out"
const TODO_DEL_CLASS = `grid h-6 w-6 flex-none appearance-none place-items-center rounded-[7px] border border-transparent bg-transparent text-[17px] leading-none text-[#b3a074] opacity-[.42] transition-[opacity,color,background-color,transform] duration-150 ease-out hover:opacity-100 hover:bg-[#f4ead0]/70 hover:text-[#8a6b28] active:scale-95`
const TODO_ADD_CLASS = `mt-2.5 self-start rounded-lg border-[1.5px] border-dashed border-[#cdb373] px-3 py-1.5 font-display text-[11px] uppercase tracking-wide text-[#8a6b28] ${EDIT_BTN_TRANSITION} hover:bg-[#f6eccf]`
const ADD_DESC_CLASS = `${ACTION_CLASS} border-[1.5px] border-dashed border-[#cdb373] bg-transparent text-[#8a6b28] ${EDIT_BTN_TRANSITION} hover:bg-[#f6eccf]`
const ADD_PARENT_CLASS = `${ACTION_CLASS} border-[1.5px] border-solid border-[#b8892b] bg-transparent text-[#7a5c1c] ${EDIT_BTN_TRANSITION} hover:bg-[#f6eccf]`
// Destructive action (delete node / view): danger-red outline on parchment, colour-only hover, matching
// the tab-remove affordance (#a5482a). Lives in edit mode only, so read mode can't fat-finger a delete.
const DELETE_BTN_CLASS = `${ACTION_CLASS} mt-2.5 border-[1.5px] border-solid border-[#a5482a]/40 bg-transparent text-[#a5482a] ${EDIT_BTN_TRANSITION} hover:bg-[#a5482a]/10`
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

export function NodeDetailCard(props: NodeDetailCardProps) {
    const {
        milestone,
        state,
        todos,
        isGoal,
        closing,
        onToggle,
        onComplete,
        onUncomplete,
        onEditMilestone,
        onEditTodo,
        onDeleteTodo,
        onAddTodo,
        onAddChild,
        onAddParent,
        onAddSubView,
        isView,
        earnsGold = true,
        onView,
        onDelete,
        deleteKind = "milestone",
        descendantCount = 0,
        onExited
    } = props
    const [editing, setEditing] = useState(false)
    const [confirmOpen, setConfirmOpen] = useState(false)
    const rootRef = useRef<HTMLDivElement>(null)

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

    const showChecklist = !isGoal && todos.length > 0
    const doneCount = todos.filter((todo) => todo.done).length
    const allDone = todos.every((todo) => todo.done) // vacuously true for the goal's empty list

    const badge = (
        <span
            className="inline-block rounded-full px-2.5 py-0.5 font-display text-[10.5px] uppercase tracking-wide transition-[background-color,color,border-color] duration-300 ease-out"
            style={BADGE_STYLE[state]}
        >
            {STATE_LABEL[state]}
        </span>
    )

    let action: ReactElement
    let hint: ReactElement | null = null
    if (onView) {
        action = (
            <button type="button" onClick={onView} className={ACTION_BTN_CLASS} style={UNLOCK_STYLE}>
                View
            </button>
        )
    } else if (state === "mastered") {
        action = (
            <button type="button" onClick={onUncomplete} className={ACTION_BTN_CLASS} style={UNDO_STYLE}>
                {isGoal ? "Reset Quest" : "Mark Incomplete"}
            </button>
        )
    } else if (state === "available" && allDone) {
        action = (
            <button type="button" onClick={onComplete} className={ACTION_BTN_CLASS} style={UNLOCK_STYLE}>
                {isGoal ? "Complete Quest" : "Mark Complete"}
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
                Check off every item to complete this milestone.
            </p>
        )
    } else {
        action = (
            <button type="button" disabled className={ACTION_BTN_CLASS} style={MUTED_STYLE}>
                Locked
            </button>
        )
    }

    const animation = closing
        ? "animate-[cardSwapOut_0.2s_ease-in_forwards]"
        : "animate-[cardSwap_0.26s_cubic-bezier(0.2,0.75,0.25,1)]"

    return (
        <div ref={rootRef} data-testid="detail-card" className={`relative font-serif ${animation}`} style={CARD_STYLE}>
            <button
                type="button"
                aria-label={editing ? "Finish editing" : "Edit"}
                onClick={() => setEditing((prev) => !prev)}
                className="absolute right-3 top-3 grid h-[30px] w-[30px] place-items-center rounded-[9px] transition-transform duration-150 ease-out hover:scale-110 active:scale-95"
                style={PENCIL_STYLE}
            >
                <svg
                    aria-hidden="true"
                    viewBox="0 0 24 24"
                    width={15}
                    height={15}
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                >
                    {editing ? (
                        <path d="M5 12l5 5L20 6" />
                    ) : (
                        <>
                            <path d="M12 20h9" />
                            <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
                        </>
                    )}
                </svg>
            </button>

            {editing ? (
                <>
                    <input
                        className={EDIT_TITLE_CLASS}
                        value={milestone.name}
                        maxLength={60}
                        onChange={(event) => onEditMilestone?.({ name: event.target.value })}
                    />
                    {!isView && <div className="mt-[7px]">{badge}</div>}
                    <textarea
                        className={EDIT_DESC_CLASS}
                        value={milestone.description}
                        onChange={(event) => onEditMilestone?.({ description: event.target.value })}
                    />

                    {earnsGold && (
                        <div className="mb-[15px]">
                            <span className={`${CHECKLIST_HEAD_CLASS} mb-[9px] block`}>Reward</span>
                            <div className="flex items-center gap-2">
                                <Coin size={20} className="flex-none" />
                                <input
                                    aria-label="Reward in gold"
                                    type="number"
                                    min={0}
                                    step={1}
                                    value={milestone.reward}
                                    onChange={(event) => {
                                        const n = event.target.valueAsNumber
                                        onEditMilestone?.({ reward: Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0 })
                                    }}
                                    className={`${TODO_EDIT_CLASS} max-w-[92px] flex-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none`}
                                />
                                <span className="font-display text-[11px] uppercase tracking-wide text-[#b09a63]">
                                    gold on completion
                                </span>
                            </div>
                        </div>
                    )}

                    {!isView && !isGoal && (
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
                                            className={TODO_DEL_CLASS}
                                            onClick={() => onDeleteTodo?.(index)}
                                        >
                                            ×
                                        </button>
                                    </li>
                                ))}
                            </ul>
                            <button type="button" className={TODO_ADD_CLASS} onClick={onAddTodo}>
                                + Add item
                            </button>
                        </div>
                    )}

                    {(!isView || onAddSubView) && (
                        <div className="flex flex-col gap-2.5">
                            {!isView && isGoal && onAddParent && (
                                <button type="button" className={ADD_DESC_CLASS} onClick={onAddParent}>
                                    + Add parent milestone
                                </button>
                            )}
                            {!isView && (
                                <button type="button" className={ADD_DESC_CLASS} onClick={onAddChild}>
                                    + Add sub-milestone
                                </button>
                            )}
                            {onAddSubView && (
                                <button type="button" className={ADD_PARENT_CLASS} onClick={onAddSubView}>
                                    + Add sub-view
                                </button>
                            )}
                        </div>
                    )}

                    {onDelete && (
                        <>
                            <button
                                type="button"
                                className={DELETE_BTN_CLASS}
                                onClick={() => setConfirmOpen(true)}
                            >
                                {deleteKind === "view" ? "Delete view" : "Delete milestone"}
                            </button>
                            <ConfirmDialog
                                open={confirmOpen}
                                title={deleteKind === "view" ? "Remove this view?" : "Delete this milestone?"}
                                message={
                                    deleteKind === "view" ? (
                                        <>
                                            Delete{" "}
                                            <strong className="font-semibold text-[#4a3410]">{milestone.name}</strong>?
                                            This removes the whole view and can't be undone.
                                        </>
                                    ) : descendantCount > 0 ? (
                                        <>
                                            Delete{" "}
                                            <strong className="font-semibold text-[#4a3410]">{milestone.name}</strong>{" "}
                                            and its {descendantCount} sub-milestone
                                            {descendantCount === 1 ? "" : "s"}? This can't be undone.
                                        </>
                                    ) : (
                                        <>
                                            Delete{" "}
                                            <strong className="font-semibold text-[#4a3410]">{milestone.name}</strong>?
                                            This can't be undone.
                                        </>
                                    )
                                }
                                confirmLabel="Delete"
                                onConfirm={() => {
                                    // Close first, THEN delete: onDelete may unmount this card (view removal), so
                                    // touching confirmOpen afterward would be a set-state-on-unmounted warning.
                                    setConfirmOpen(false)
                                    onDelete()
                                }}
                                onOpenChange={(open) => {
                                    if (!open) setConfirmOpen(false)
                                }}
                            />
                        </>
                    )}
                </>
            ) : (
                <>
                    <div className="mb-[14px] flex items-center gap-[14px]">
                        <div>
                            <h3 className="mt-0.5 font-display text-[20px] font-bold text-[#4a3410]">
                                {milestone.name}
                            </h3>
                            {!onView && <span className="mt-[7px] inline-block">{badge}</span>}
                        </div>
                    </div>

                    {milestone.description && (
                        <p className="mb-[14px] text-[15.5px] leading-relaxed text-[#5a4a2c]">{milestone.description}</p>
                    )}

                    {earnsGold && (
                        <div className="mb-[15px]">
                            <span className={`${CHECKLIST_HEAD_CLASS} mb-[9px] block`}>Reward</span>
                            <div className="flex items-center gap-2">
                                <Coin size={20} className="flex-none" />
                                <span className="font-display text-[15px] font-bold text-[#6f5316]">
                                    {milestone.reward}
                                </span>
                                <span className="font-display text-[11px] uppercase tracking-wide text-[#b09a63]">
                                    gold on completion
                                </span>
                            </div>
                        </div>
                    )}

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

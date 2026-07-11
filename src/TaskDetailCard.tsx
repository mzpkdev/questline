import { type CSSProperties, useEffect, useRef, useState } from "react"
import { Coin } from "./Coin"
import { ConfirmDialog } from "./ConfirmDialog"
import type { Task } from "./tasks"

// The Tasks detail card: the node detail card's gold-framed shell, trimmed to a task's three
// affordances -- edit the name, set the reward, delete. Like the node card, the pencil flips
// between a read view (name + reward) and an edit view (inputs + delete); App shows it in the same
// top-right aside and remounts it per selected task (a React key on the task id), so the entrance
// animation replays on each open.
export type TaskDetailCardProps = {
    task: Task
    // Mirrors NodeDetailCard: `closing` swaps the entrance animation for the exit one, and `onExited`
    // fires when that exit animation ends, so App can trail the unmount behind the dismissal.
    closing?: boolean
    onEdit: (patch: { text?: string; reward?: number }) => void
    onDelete: () => void
    // Open the card straight in edit mode (used for a just-added task, so its name is editable at once).
    // Read on mount only; App remounts the card per task via a key, so it seeds each fresh task.
    initialEditing?: boolean
    onExited?: () => void
}

// Gold-framed panel, mirroring DetailCard's CARD_STYLE (the double-gradient border trick).
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

// Edit-field looks, mirroring DetailCard's edit-title / todo-edit fields.
const FIELD_FOCUS = "focus:border-[#b8892b] focus:outline-none focus:ring-2 focus:ring-[#e6c458]/40"
const NAME_INPUT_CLASS = `w-full rounded-lg border border-[#d8c48f] bg-[#fffdf5] px-2.5 py-1.5 pr-10 font-display text-[20px] font-bold text-[#4a3410] ${FIELD_FOCUS}`
const REWARD_INPUT_CLASS = `max-w-[92px] flex-none rounded-[7px] border border-[#d8c48f] bg-[#fffdf5] px-2 py-1.5 text-[14.5px] text-[#5a4a2c] ${FIELD_FOCUS} [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none`
const LABEL_CLASS = "mb-[9px] block font-display text-[11px] uppercase tracking-widest text-[#8a6b28]"
const UNIT_CLASS = "font-display text-[11px] uppercase tracking-wide text-[#b09a63]"
const DELETE_BTN_CLASS =
    "mt-4 w-full rounded-[11px] border-[1.5px] border-solid border-[#a5482a]/40 bg-transparent py-3 font-display text-[14px] font-bold uppercase tracking-wide text-[#a5482a] transition-colors duration-150 ease-out hover:bg-[#a5482a]/10"

// The Coin + number + unit row, shared by the read and edit views (the middle slot differs).
function RewardRow({ children }: { children: React.ReactNode }) {
    return (
        <div>
            <span className={LABEL_CLASS}>Reward</span>
            <div className="flex items-center gap-2">
                <Coin size={20} className="flex-none" />
                {children}
                <span className={UNIT_CLASS}>gold on completion</span>
            </div>
        </div>
    )
}

export function TaskDetailCard({ task, closing, onEdit, onDelete, initialEditing = false, onExited }: TaskDetailCardProps) {
    const [editing, setEditing] = useState(initialEditing)
    const [confirmOpen, setConfirmOpen] = useState(false)
    const rootRef = useRef<HTMLDivElement>(null)
    const nameRef = useRef<HTMLInputElement>(null)

    // A just-added task opens in edit mode: focus and select its name so a rename is one keystroke away.
    // Mount-only (the card remounts per task), so it never steals focus on a later edit toggle.
    useEffect(() => {
        if (initialEditing) {
            nameRef.current?.focus()
            nameRef.current?.select()
        }
    }, [initialEditing])

    // Fire onExited once the dismissal animation ends. A native listener (attached only while closing)
    // sidesteps React's delegated onAnimationEnd, matching NodeDetailCard.
    useEffect(() => {
        if (!closing || !onExited) return
        const el = rootRef.current
        if (!el) return
        const handleEnd = () => onExited()
        el.addEventListener("animationend", handleEnd)
        return () => el.removeEventListener("animationend", handleEnd)
    }, [closing, onExited])

    const animation = closing
        ? "animate-[cardSwapOut_0.2s_ease-in_forwards]"
        : "animate-[cardSwap_0.26s_cubic-bezier(0.2,0.75,0.25,1)]"

    return (
        <div
            ref={rootRef}
            data-testid="task-detail-card"
            className={`relative font-serif ${animation}`}
            style={CARD_STYLE}
        >
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
                        ref={nameRef}
                        aria-label="Task name"
                        className={NAME_INPUT_CLASS}
                        value={task.text}
                        maxLength={120}
                        onChange={(event) => onEdit({ text: event.target.value })}
                    />
                    <div className="mt-[15px]">
                        <RewardRow>
                            <input
                                aria-label="Reward in gold"
                                type="number"
                                min={0}
                                step={1}
                                value={task.reward}
                                onChange={(event) => {
                                    const n = event.target.valueAsNumber
                                    onEdit({ reward: Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0 })
                                }}
                                className={REWARD_INPUT_CLASS}
                            />
                        </RewardRow>
                    </div>
                    <button type="button" className={DELETE_BTN_CLASS} onClick={() => setConfirmOpen(true)}>
                        Delete task
                    </button>
                    <ConfirmDialog
                        open={confirmOpen}
                        title="Delete this task?"
                        message={
                            <>
                                Delete <strong className="font-semibold text-[#4a3410]">{task.text}</strong>? This can't
                                be undone.
                            </>
                        }
                        confirmLabel="Delete"
                        onConfirm={() => {
                            // Close first, then delete: onDelete unmounts this card, so touching confirmOpen
                            // afterward would set state on an unmounted component.
                            setConfirmOpen(false)
                            onDelete()
                        }}
                        onOpenChange={(open) => {
                            if (!open) setConfirmOpen(false)
                        }}
                    />
                </>
            ) : (
                <>
                    <h3 className="mt-0.5 break-words font-display text-[20px] font-bold text-[#4a3410]">
                        {task.text}
                    </h3>
                    <div className="mt-[14px]">
                        <RewardRow>
                            <span className="font-display text-[15px] font-bold text-[#6f5316]">{task.reward}</span>
                        </RewardRow>
                    </div>
                </>
            )}
        </div>
    )
}

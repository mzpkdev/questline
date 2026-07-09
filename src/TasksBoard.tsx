// The Tasks view: a flat checklist rendered on the same parchment board as the roadmap, a visual
// re-port of the mockup's todo.html. Each task is a gold-framed, cream-faced tile with an accent
// spine, echoing the milestone nodes. Ticking a box (useCheckPop) gives it the same soft gold pop the
// roadmap's checklist boxes have; clicking the tile opens its detail card (name / reward / delete); the
// add row appends one; and the grip handle drag-reorders the list (dnd-kit, with pointer + keyboard support).

import {
    closestCenter,
    DndContext,
    type DragEndEvent,
    KeyboardSensor,
    PointerSensor,
    useSensor,
    useSensors
} from "@dnd-kit/core"
import { restrictToParentElement, restrictToVerticalAxis } from "@dnd-kit/modifiers"
import {
    SortableContext,
    sortableKeyboardCoordinates,
    useSortable,
    verticalListSortingStrategy
} from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import { type CSSProperties, type FormEvent, useState } from "react"
import type { Task } from "./tasks"
import { ioButtonClass } from "./IoButtons"
import { useCheckPop } from "./nodeMotion"

// Node-style tile face: the double-gradient border trick (padding-box cream fill under a border-box
// gold frame), mirroring the mockup's `.item`. Shadows live in classes (below) so hover/drag can lift
// them; only the gradient fill + transparent border need to be inline.
const TILE_STYLE: CSSProperties = {
    border: "2px solid transparent",
    background:
        "linear-gradient(180deg,#fefaee,#f4e8c8) padding-box, linear-gradient(180deg,#fdf1b6,#dab24c 55%,#8a641d) border-box"
}
const TILE_DONE_STYLE: CSSProperties = {
    ...TILE_STYLE,
    background:
        "linear-gradient(180deg,#fdf4d2,#eeddab) padding-box, linear-gradient(180deg,#fdf1b6,#dab24c 55%,#8a641d) border-box"
}

const TILE_SHADOW =
    "shadow-[0_3px_6px_-2px_rgba(90,61,12,0.34),inset_0_1px_0_rgba(255,255,255,0.55)] hover:shadow-[0_7px_15px_-5px_rgba(90,61,12,0.44),inset_0_1px_0_rgba(255,255,255,0.6)]"
const TILE_SHADOW_DRAGGING = "shadow-[0_14px_28px_-10px_rgba(90,61,12,0.55)]"

// Checkbox faces, matching the roadmap checklist (mockup `.check`): parchment when open, gold-tan
// once ticked.
const CHECK_STYLE: CSSProperties = { border: "1.5px solid #b8892b", background: "#fffdf7", color: "#3a2a0c" }
const CHECK_DONE_STYLE: CSSProperties = { border: "1.5px solid #cdb373", background: "#ecdcae", color: "#8a641d" }

type TasksBoardProps = {
    items: Task[]
    onAdd: (text: string) => void
    onToggle: (id: string) => void
    onReorder: (activeId: string, overId: string) => void
    // Open a task's detail card (name / reward / delete). Clicking anywhere on the tile fires this.
    onSelect: (id: string) => void
    // The task whose detail card is open, ringed to show it's selected.
    selectedId?: string | null
}

// One sortable task tile. Clicking the tile opens its detail card (delete lives there now); the check
// and grip stop propagation so ticking or dragging never opens the card. The box bounces the moment
// it's ticked (useCheckPop), so checking a task off feels like a stamp, as on a milestone card.
function SortableTaskTile({
    task,
    selected,
    onToggle,
    onSelect
}: {
    task: Task
    selected: boolean
    onToggle: (id: string) => void
    onSelect: (id: string) => void
}) {
    const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
        id: task.id
    })
    const boxRef = useCheckPop<HTMLButtonElement>(task.done)
    return (
        <li
            ref={setNodeRef}
            data-task-tile=""
            onClick={() => onSelect(task.id)}
            className={`group relative flex cursor-pointer items-center gap-[11px] rounded-[13px] py-3 pl-[19px] pr-[15px] transition-[box-shadow] duration-200 ease-out animate-[itemIn_0.25s_ease] hover:scale-[1.015] ${TILE_SHADOW} ${
                isDragging ? `${TILE_SHADOW_DRAGGING} opacity-95` : ""
            } ${task.done ? "opacity-[0.78]" : ""} ${
                selected ? "ring-2 ring-[#e6c458] ring-offset-1 ring-offset-[#f6edd6]" : ""
            }`}
            style={{
                ...(task.done ? TILE_DONE_STYLE : TILE_STYLE),
                transform: CSS.Transform.toString(transform),
                transition,
                zIndex: isDragging ? 20 : undefined
            }}
        >
            {/* Accent spine (mockup `.item::before`); gold, dimming when the task is done. */}
            <span
                aria-hidden="true"
                className="absolute left-[8px] top-1/2 h-[calc(100%-22px)] w-[5px] -translate-y-1/2 rounded-[2.5px]"
                style={{ background: task.done ? "#c69a34" : "#e6c458" }}
            />
            <button
                ref={setActivatorNodeRef}
                type="button"
                aria-label={`Reorder ${task.text}`}
                onClick={(event) => event.stopPropagation()}
                className="grid h-6 w-4 flex-none touch-none cursor-grab place-items-center bg-transparent text-[#c3b183] opacity-60 transition-[color,opacity] duration-150 ease-out hover:text-[#8a6b28] group-hover:opacity-100 active:cursor-grabbing"
                {...attributes}
                {...listeners}
            >
                <svg viewBox="0 0 24 24" width={16} height={16} fill="currentColor" aria-hidden="true">
                    <circle cx="9" cy="6" r="1.4" />
                    <circle cx="9" cy="12" r="1.4" />
                    <circle cx="9" cy="18" r="1.4" />
                    <circle cx="15" cy="6" r="1.4" />
                    <circle cx="15" cy="12" r="1.4" />
                    <circle cx="15" cy="18" r="1.4" />
                </svg>
            </button>
            <button
                ref={boxRef}
                type="button"
                aria-pressed={task.done}
                aria-label={`${task.done ? "Uncheck" : "Check"} ${task.text}`}
                onClick={(event) => {
                    event.stopPropagation()
                    onToggle(task.id)
                }}
                className="grid h-[22px] w-[22px] flex-none place-items-center rounded-md"
                style={task.done ? CHECK_DONE_STYLE : CHECK_STYLE}
            >
                {task.done && (
                    <svg
                        aria-hidden="true"
                        viewBox="0 0 24 24"
                        width={14}
                        height={14}
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
            <button
                type="button"
                aria-label={`Open ${task.text}`}
                onClick={() => onSelect(task.id)}
                className={`min-w-0 flex-1 break-words bg-transparent text-left font-display text-[14.5px] tracking-[0.2px] transition-colors duration-150 ease-out hover:text-[#8a641d] ${
                    task.done ? "font-medium text-[#9c895f] line-through" : "font-semibold text-[#6f5316]"
                }`}
            >
                {task.text}
            </button>
        </li>
    )
}

export function TasksBoard({ items, onAdd, onToggle, onReorder, onSelect, selectedId }: TasksBoardProps) {
    const [draft, setDraft] = useState("")
    const sensors = useSensors(
        // A 5px threshold lets a plain click on the grip pass through without starting a drag.
        useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
        useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
    )

    const submit = (event: FormEvent) => {
        event.preventDefault()
        const text = draft.trim()
        if (!text) return
        onAdd(text)
        setDraft("")
    }

    const handleDragEnd = (event: DragEndEvent) => {
        const { active, over } = event
        if (!over || active.id === over.id) return
        onReorder(String(active.id), String(over.id))
    }

    return (
        <div className="mx-auto w-[95%] max-w-[820px] px-1 py-12">
            <form onSubmit={submit} className="mb-4 flex items-center gap-1.5">
                <input
                    aria-label="New task"
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                    placeholder="Post a task..."
                    maxLength={120}
                    className="min-w-0 flex-1 rounded-none border-0 border-b-2 border-[#d8c48f] bg-transparent px-1 py-2 font-serif text-[14.5px] text-[#5a4a2c] placeholder:text-[#b7a577] transition-colors duration-150 ease-out focus:border-[#b8892b] focus:outline-none"
                />
                <button type="submit" aria-label="Add task" title="Add task" className={ioButtonClass}>
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
                        <path d="M12 5v14" />
                        <path d="M5 12h14" />
                    </svg>
                </button>
            </form>

            {items.length > 0 ? (
                <DndContext
                    sensors={sensors}
                    collisionDetection={closestCenter}
                    modifiers={[restrictToVerticalAxis, restrictToParentElement]}
                    onDragEnd={handleDragEnd}
                >
                    <SortableContext items={items.map((b) => b.id)} strategy={verticalListSortingStrategy}>
                        <ul className="m-0 flex list-none flex-col gap-[11px] p-0">
                            {items.map((task) => (
                                <SortableTaskTile
                                    key={task.id}
                                    task={task}
                                    selected={selectedId === task.id}
                                    onToggle={onToggle}
                                    onSelect={onSelect}
                                />
                            ))}
                        </ul>
                    </SortableContext>
                </DndContext>
            ) : (
                <p className="mt-6 text-center text-[15px] italic text-[#a2916c]">
                    No tasks posted. Add one above to begin.
                </p>
            )}
        </div>
    )
}

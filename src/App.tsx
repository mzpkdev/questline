import { lazy, Suspense, useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react"
import { addTask, DEFAULT_TASK_NAME, edit, type Task, remove, reorder, SEED_TASKS, toggle, visible } from "./tasks"
import { TasksBoard } from "./TasksBoard"
import { TaskDetailCard } from "./TaskDetailCard"
import { Corners } from "./Corners"
import { NodeDetailCard } from "./NodeDetailCard"
import { ConfirmDialog } from "./ConfirmDialog"
import { BoardCelebration } from "./BoardCelebration"
import { complete, descendantsOf, parentOf, stateOf } from "./graph"
import { IoButtons } from "./IoButtons"
import {
    addReward,
    type Banked,
    compact,
    DEFAULT_REWARD_NAME,
    DEFAULT_REWARD_PRICE,
    earnedGold,
    editReward,
    redeem,
    removeReward,
    type Reward,
    SEED_REWARDS,
    spentGold,
    unredeem,
    visible as visibleRewards
} from "./rewards"
import { RewardDetailCard, RewardsBoard } from "./RewardsBoard"
import { BoardTree } from "./BoardTree"
import { isLinkedNode, type Node } from "./nodes"
import { NavActions } from "./NavActions"
import { addNote, type Note, removeNote, renameNote, updateNoteScene } from "./notes"
import { deserialize, loadState, type PersistedSlices, saveState, serialize } from "./persist"
import { type Board, boardCompleter, boardsReducer, linkedNodeName, seedBoard } from "./board"
import { SectionTransition } from "./SectionTransition"
import { useSfx } from "./SfxProvider"
import { SoundToggle } from "./SoundToggle"
import { TabBar } from "./TabBar"
import { SyncBoard } from "./sync/SyncBoard"
import { SyncNavButton } from "./sync/SyncNavButton"
import { useSync } from "./sync/useSync"

// Lazy so Excalidraw's bundle + CSS only load when the Draw tab is opened, not on first paint. Both
// the notes wall (DrawBoard renders thumbnails via Excalidraw's exporter) and the editor share that chunk.
const DrawBoard = lazy(() => import("./DrawBoard").then((m) => ({ default: m.DrawBoard })))
const ExcalidrawBoard = lazy(() => import("./ExcalidrawBoard").then((m) => ({ default: m.ExcalidrawBoard })))

// Node, board, task, reward, and note ids are globally unique, minted as `${prefix}-${uuid}`. No
// counters: nothing needs to resume past loaded data, so a random id can never collide.
const mintId = (prefix: string) => `${prefix}-${crypto.randomUUID()}`

// Resolve a URL hash to the board to open and the node to select. The hash is a node or board id: a
// minted id carries its own `board-` / `node-` prefix, a hand-authored seed id (e.g. `learn`) carries
// none, so the id is placed by scanning both namespaces (trivial N) rather than by parsing a prefix. A
// board id opens that board at its root node; otherwise the board owning a node with that id opens and
// selects it.
function resolveHash(hash: string, boards: Record<string, Board>): { boardId: string; nodeId: string } | null {
    if (!hash) return null
    const board = boards[hash]
    if (board) return { boardId: hash, nodeId: board.rootId }
    const boardId = Object.keys(boards).find((id) => boards[id]?.nodes[hash])
    return boardId ? { boardId, nodeId: hash } : null
}

// The tab + node to open on first render, seeded from the URL hash if it points at a known board/node,
// else the first board with nothing selected (the canvas fits the whole tree).
type Boot = {
    boards: Record<string, Board>
    order: string[]
    tasks: Task[]
    rewards: Reward[]
    banked: Banked
    notes: Note[]
    activeId: string
    selectedId: string | null
    hadHash: boolean
}
function computeBoot(): Boot {
    // Restore the autosaved data if present; otherwise start from a single fresh sample board.
    const loaded = loadState()
    const boards = loaded?.boards ?? { seed: seedBoard() }
    const order = loaded?.boardOrder ?? ["seed"]
    // Tasks and rewards seed only on a truly fresh start (no saved state at all); an existing save from
    // before these views simply had none, and loads empty rather than re-seeding.
    const rawTasks = loaded?.tasks ?? SEED_TASKS
    const rawRewards = loaded?.rewards ?? SEED_REWARDS
    // Draw notes start empty (no tutorial seed); an existing save loads whatever it had.
    const notes = loaded?.notes ?? []
    // Fold any task/reward already past its 14-day window into the banked totals and drop it, so storage
    // stays small across reloads while the balance (banked + live) is unchanged.
    const { tasks, rewards, banked } = compact(
        rawTasks,
        rawRewards,
        loaded?.banked ?? { earned: 0, spent: 0 },
        Date.now()
    )
    const base = { boards, order, tasks, rewards, banked, notes }

    const resolved = resolveHash(window.location.hash.slice(1), boards)
    if (resolved) return { ...base, activeId: resolved.boardId, selectedId: resolved.nodeId, hadHash: true }
    // No hash: open the first board with nothing selected (the canvas fits the whole tree by default).
    return { ...base, activeId: order[0] ?? "", selectedId: null, hadHash: false }
}

export function App() {
    // Each tab is a Board (its own roadmap). All boards are equal; `order` fixes tab order, `activeId`
    // picks the visible one. Board data lives behind a single reducer (board.ts); the pure ops it routes
    // through keep references stable on a no-op, so autosave and the gold memo don't churn.
    const bootRef = useRef<Boot | null>(null)
    const boot = (bootRef.current ??= computeBoot())
    // The synthesized SFX kit, stable for the app's lifetime. Effects fire from the handlers below and
    // from the board-celebration effect -- never from render or from inside a state updater.
    const sfx = useSfx()
    const [{ boards, order }, dispatch] = useReducer(boardsReducer, { boards: boot.boards, order: boot.order })
    const [activeId, setActiveId] = useState(boot.activeId)
    // `selectedId` is the intent (null once dismissed); `displayId` is what the card shows and trails
    // `selectedId` on dismissal so the exit animation can play before the card unmounts.
    const [selectedId, setSelectedId] = useState<string | null>(boot.selectedId)
    const [displayId, setDisplayId] = useState<string | null>(boot.selectedId)
    // A node just added via the detail card: its card opens in edit mode so the name is editable at
    // once. Cleared the moment that card mounts, so re-selecting the node later opens the read view.
    const [editOnAddId, setEditOnAddId] = useState<string | null>(null)
    // A reparent in flight (the "Unconnect" gesture): the node being re-hung -- with its whole subtree
    // -- plus the parent to fall back to on cancel. Purely transient UI: it is NEVER dispatched into the
    // boards reducer and never persisted, so the detach leaves no orphan and a reload mid-reparent
    // reverts to the original parent. Only a completed attach dispatches the pure `reparent` op. One at
    // a time -- arming dismisses the card, and while armed a node click attaches instead of selecting,
    // so no second node's card (or its Unconnect) is reachable.
    const [reparenting, setReparenting] = useState<{ nodeId: string; originalParentId: string } | null>(null)
    // The app-level Tasks checklist (one flat list shared across every tab) and which top-level
    // section is on screen: the roadmap board, the Tasks list, or the Rewards shop.
    const [tasks, setTasks] = useState<Task[]>(boot.tasks)
    // The Rewards shelf. Gold isn't stored: it's earned from roadmap completion minus the price of
    // each redeemed reward (computed below).
    const [rewards, setRewards] = useState<Reward[]>(boot.rewards)
    // Gold earned/spent by tasks and rewards pruned past their 14-day window (folded in at load by
    // compact()). Added to the live sums so the balance is unchanged by that compaction.
    const [banked, setBanked] = useState<Banked>(boot.banked)
    // The Draw wall: standalone Excalidraw notes. `editingNoteId` picks the note open in the full editor;
    // null shows the masonry grid of all notes.
    const [notes, setNotes] = useState<Note[]>(boot.notes)
    const [editingNoteId, setEditingNoteId] = useState<string | null>(null)
    // The just-added scribble, ringed briefly on the wall so a new card is easy to spot.
    const [highlightNoteId, setHighlightNoteId] = useState<string | null>(null)
    const [section, setSection] = useState<"roadmap" | "tasks" | "rewards" | "sync" | "excalidraw">("roadmap")
    // The task whose detail card is open in the Tasks view (the intent, null once dismissed), and the
    // id the card actually shows -- `displayTaskId` trails `selectedTaskId` on dismissal so the exit
    // animation can play before the card unmounts (mirrors selectedId / displayId for nodes).
    const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null)
    const [displayTaskId, setDisplayTaskId] = useState<string | null>(null)
    // A task just added: its detail card opens in edit mode so the name is editable at once. Cleared the
    // moment that card mounts, so re-selecting the task later opens the read view.
    const [editOnAddTaskId, setEditOnAddTaskId] = useState<string | null>(null)
    // The section on screen at first load appears instantly; every section entered afterward plays the
    // SectionTransition fade + rise. Flipped off just after the initial mount (below).
    const firstSectionRef = useRef(true)
    // The reward whose detail card is open (the intent, null once dismissed), and the id the card
    // actually shows -- `displayRewardId` trails `selectedRewardId` on dismissal so the exit animation
    // plays before the card unmounts (mirrors selectedTaskId / displayTaskId).
    const [selectedRewardId, setSelectedRewardId] = useState<string | null>(null)
    const [displayRewardId, setDisplayRewardId] = useState<string | null>(null)
    // A reward just created from the shelf's + tile: its card opens in edit mode. Cleared once that card
    // mounts, so re-selecting the reward later opens the read view.
    const [editOnAddRewardId, setEditOnAddRewardId] = useState<string | null>(null)
    // A node to pan the canvas onto; the nonce (re)triggers centering on URL navigation.
    const [focusId, setFocusId] = useState(boot.hadHash ? (boot.selectedId ?? "") : "")
    const [focusNonce, setFocusNonce] = useState(boot.hadHash ? 1 : 0)
    // Fires the finale fanfare when the active tab's root node crosses into complete, anchored on that
    // root node. Tracked per tab (seeded on first sight) so switching onto an already-done root node
    // doesn't fire; the burst carries the root node's board-relative centre + a nonce to (re)play.
    const boardRef = useRef<HTMLDivElement>(null)
    const boardDoneRef = useRef<Record<string, boolean>>({})
    const [burst, setBurst] = useState<{ x: number; y: number; nonce: number } | null>(null)

    const active = boards[activeId]

    // A boards-aware completion resolver: tells whether any board is complete (its root mastered), so a
    // linked node derives its mastery from its target board. Threaded into every stateOf / complete call
    // (the tri-state and the Complete gate) so an unlocked-by-link subtree computes correctly.
    const isBoardComplete = useMemo(() => boardCompleter(boards), [boards])

    // Gold in the purse: earned from progress (checklist boxes, tasks, nodes, root nodes) minus what's
    // been spent. A redemption is a permanent spend, so un-completing work you'd already spent against
    // can push the balance negative -- a debt the purse shows honestly until fresh work out-earns it.
    const gold = useMemo(
        () => banked.earned + earnedGold(boards, tasks) - (banked.spent + spentGold(rewards)),
        [boards, tasks, rewards, banked]
    )

    useEffect(() => {
        if (!active) return
        const done = active.mastered.has(active.rootId)
        const seen = boardDoneRef.current[activeId]
        boardDoneRef.current[activeId] = done
        if (seen !== false || !done) return
        // Anchor on the root node's on-screen centre (its card carries data-id + data-state), falling
        // back to the upper-centre of the board if it can't be found.
        const board = boardRef.current
        const rect = board?.getBoundingClientRect()
        const node = board?.querySelector(`[data-id="${active.rootId}"][data-state]`)?.getBoundingClientRect()
        const x = rect && node ? node.left + node.width / 2 - rect.left : (rect?.width ?? 0) / 2
        const y = rect && node ? node.top + node.height / 2 - rect.top : (rect?.height ?? 0) * 0.42
        setBurst((prev) => ({ x, y, nonce: (prev?.nonce ?? 0) + 1 }))
        // The whole quest just crossed into done: the biggest accomplishment moment gets the finale
        // fanfare, in step with the on-screen burst above.
        sfx.fanfare()
    }, [active, activeId, sfx])

    useEffect(() => {
        if (selectedId !== null) setDisplayId(selectedId)
    }, [selectedId])

    // Consume the edit-on-add flag once the target node's card has mounted (edit state has latched), so a
    // later re-select of that same node opens the read view instead.
    useEffect(() => {
        if (editOnAddId !== null && displayId === editOnAddId) setEditOnAddId(null)
    }, [editOnAddId, displayId])

    useEffect(() => {
        if (selectedTaskId !== null) setDisplayTaskId(selectedTaskId)
    }, [selectedTaskId])

    // Consume the edit-on-add flag once the added task's card has mounted (edit state has latched), so a
    // later re-select of that task opens the read view instead.
    useEffect(() => {
        if (editOnAddTaskId !== null && displayTaskId === editOnAddTaskId) setEditOnAddTaskId(null)
    }, [editOnAddTaskId, displayTaskId])

    useEffect(() => {
        if (selectedRewardId !== null) setDisplayRewardId(selectedRewardId)
    }, [selectedRewardId])

    // Consume the edit-on-add flag once the new reward's card has mounted (edit state has latched), so a
    // later re-select of that reward opens the read view instead.
    useEffect(() => {
        if (editOnAddRewardId !== null && displayRewardId === editOnAddRewardId) setEditOnAddRewardId(null)
    }, [editOnAddRewardId, displayRewardId])

    // Initial mount is done: from here on, a section change remounts SectionTransition (keyed by
    // section) and plays its entrance.
    useEffect(() => {
        firstSectionRef.current = false
    }, [])

    // Leaving the Rewards view closes any open reward detail card outright.
    useEffect(() => {
        if (section !== "rewards") {
            setSelectedRewardId(null)
            setDisplayRewardId(null)
        }
    }, [section])

    // Leaving the Tasks view closes any open task detail card outright (both the intent and the
    // trailing display id), so re-entering doesn't flash a stale card mid-exit.
    useEffect(() => {
        if (section !== "tasks") {
            setSelectedTaskId(null)
            setDisplayTaskId(null)
        }
    }, [section])

    // Leaving the Draw view drops back to the wall, so re-entering never reopens a stale editor.
    useEffect(() => {
        if (section !== "excalidraw") setEditingNoteId(null)
    }, [section])

    // Fade the new-scribble highlight ring shortly after it's added.
    useEffect(() => {
        if (highlightNoteId === null) return
        const timer = setTimeout(() => setHighlightNoteId(null), 1600)
        return () => clearTimeout(timer)
    }, [highlightNoteId])

    // Dismiss the task detail card on Escape or a click outside it, but not on a task tile (which
    // selects) or the tab bar. Mirrors the node card / add-reward dismissal.
    useEffect(() => {
        if (selectedTaskId === null) return
        const onPointerDown = (event: PointerEvent) => {
            const target = event.target as Element | null
            if (
                target?.closest("[data-task-detail-card]") ||
                target?.closest("[data-task-tile]") ||
                target?.closest("[data-add-task-trigger]") ||
                target?.closest("[data-tabbar]") ||
                target?.closest('[role="alertdialog"]')
            ) {
                return
            }
            setSelectedTaskId(null)
        }
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Escape") setSelectedTaskId(null)
        }
        document.addEventListener("pointerdown", onPointerDown)
        document.addEventListener("keydown", onKeyDown)
        return () => {
            document.removeEventListener("pointerdown", onPointerDown)
            document.removeEventListener("keydown", onKeyDown)
        }
    }, [selectedTaskId])

    // Dismiss the reward detail card on Escape or a click outside it, but not on a reward tile (which
    // selects), the + trigger (which opens the add card), or the tab bar. Mirrors the task card.
    useEffect(() => {
        if (selectedRewardId === null) return
        const onPointerDown = (event: PointerEvent) => {
            const target = event.target as Element | null
            if (
                target?.closest("[data-reward-detail-card]") ||
                target?.closest("[data-reward-id]") ||
                target?.closest("[data-add-reward-trigger]") ||
                target?.closest("[data-tabbar]") ||
                target?.closest('[role="alertdialog"]')
            ) {
                return
            }
            setSelectedRewardId(null)
        }
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Escape") setSelectedRewardId(null)
        }
        document.addEventListener("pointerdown", onPointerDown)
        document.addEventListener("keydown", onKeyDown)
        return () => {
            document.removeEventListener("pointerdown", onPointerDown)
            document.removeEventListener("keydown", onKeyDown)
        }
    }, [selectedRewardId])

    // Clicking the empty board (not the card, a node, the canvas controls, or the tab bar) dismisses.
    useEffect(() => {
        if (selectedId === null) return
        const onPointerDown = (event: PointerEvent) => {
            const target = event.target as Element | null
            if (
                target?.closest("[data-detail-card]") ||
                target?.closest(".react-flow__node") ||
                target?.closest(".react-flow__controls") ||
                target?.closest("[data-tabbar]") ||
                target?.closest('[role="alertdialog"]')
            ) {
                return
            }
            setSelectedId(null)
        }
        document.addEventListener("pointerdown", onPointerDown)
        return () => document.removeEventListener("pointerdown", onPointerDown)
    }, [selectedId])

    // Mirror the selected node into the URL hash (shareable), keyed by the node's own id: a minted id is
    // already `node-<uuid>`, so the hash is `#node-<uuid>` (no doubled prefix). Replaces, never pushes.
    useEffect(() => {
        const current = window.location.hash.slice(1)
        const next = selectedId ?? ""
        if (current === next) return
        const url = next ? `#${next}` : `${window.location.pathname}${window.location.search}`
        window.history.replaceState(null, "", url)
    }, [selectedId])

    // Open the board/node named in the URL hash: switch to its board, select it, and pan onto it.
    const applyHash = useCallback(() => {
        const resolved = resolveHash(window.location.hash.slice(1), boards)
        if (!resolved) return
        setSection("roadmap")
        setActiveId(resolved.boardId)
        setSelectedId(resolved.nodeId)
        setFocusId(resolved.nodeId)
        setFocusNonce((n) => n + 1)
    }, [boards])

    useEffect(() => {
        window.addEventListener("hashchange", applyHash)
        return () => window.removeEventListener("hashchange", applyHash)
    }, [applyHash])

    // Autosave the app's data (not the open tab) 400ms after the last change, so a drag — which fires
    // moveNode rapidly — coalesces into a single write.
    useEffect(() => {
        const timer = setTimeout(() => saveState({ boards, boardOrder: order, tasks, rewards, banked, notes }), 400)
        return () => clearTimeout(timer)
    }, [boards, order, tasks, rewards, banked, notes])

    // Select a node and pan the canvas onto it; the URL hash follows the selection.
    const focusNode = useCallback((id: string) => {
        setSelectedId(id)
        setFocusId(id)
        setFocusNonce((n) => n + 1)
    }, [])

    // A click on any canvas node: a subtle selection tick, then select it.
    const selectFromCanvas = useCallback(
        (id: string) => {
            sfx.tick()
            setSelectedId(id)
        },
        [sfx]
    )

    // Tasks: open the app-level list, and add / toggle / remove its items. One global list, so
    // these never touch the active board.
    const openTasks = useCallback(() => setSection("tasks"), [])
    // The list's + tile adds a default task, then selects it and opens its card in edit mode so its
    // name/reward are editable straight away (mirrors adding a reward or a node).
    const addTaskItem = useCallback(() => {
        const id = mintId("task")
        setTasks((prev) => addTask(prev, id, DEFAULT_TASK_NAME))
        setSelectedTaskId(id)
        setEditOnAddTaskId(id)
    }, [])
    const toggleTask = useCallback(
        (id: string) => {
            // Crossing a task off (the standalone to-do list) rings the coin cue; re-opening it is
            // silent. Decided from current state, not inside the updater (StrictMode double-invokes it).
            const task = tasks.find((item) => item.id === id)
            if (task && !task.done) sfx.coin()
            setTasks((prev) => toggle(prev, id, Date.now()))
        },
        [tasks, sfx]
    )
    const reorderTask = useCallback(
        (activeTaskId: string, overId: string) => setTasks((prev) => reorder(prev, activeTaskId, overId)),
        []
    )
    // Open a task's detail card, and edit its name / reward in place. Deleting from the card removes the
    // task and closes the card.
    const selectTask = useCallback((id: string) => setSelectedTaskId(id), [])
    const editTaskItem = useCallback(
        (id: string, patch: { text?: string; reward?: number }) => setTasks((prev) => edit(prev, id, patch)),
        []
    )
    const deleteTaskItem = useCallback(
        (id: string) => {
            // Deleting is gold-neutral: a done task's reward is already in the balance, so bank it before
            // dropping the record (an open task contributed nothing).
            const task = tasks.find((t) => t.id === id)
            if (task && task.done) setBanked((b) => ({ ...b, earned: b.earned + task.reward }))
            setTasks((prev) => remove(prev, id))
            setSelectedTaskId(null)
        },
        [tasks]
    )

    // Rewards: open the shop, and add / redeem / remove its rewards. One global shelf, so these never
    // touch the active board. Redeeming is a one-off buy: it stamps the reward's `redeemedAt` (when the
    // balance covers the price), which spends the gold and starts the 14-day shelf window.
    const openRewards = useCallback(() => setSection("rewards"), [])
    // The Draw wall. Opening it always lands on the grid (never straight into a note); a new note opens
    // its blank canvas at once. Renames and scene edits patch the one flat notes list (never a board).
    const openExcalidraw = useCallback(() => {
        setEditingNoteId(null)
        setSection("excalidraw")
    }, [])
    const openNote = useCallback((id: string) => setEditingNoteId(id), [])
    const backToNotes = useCallback(() => setEditingNoteId(null), [])
    // Add an empty scribble to the wall (newest first); it stays on the grid, opened only on click, and
    // is ringed briefly so it's easy to spot.
    const addNoteItem = useCallback(() => {
        const id = mintId("note")
        setNotes((prev) => addNote(prev, id, Date.now()))
        setHighlightNoteId(id)
    }, [])
    const renameNoteItem = useCallback((id: string, title: string) => setNotes((prev) => renameNote(prev, id, title)), [])
    const updateNoteSceneItem = useCallback(
        (id: string, scene: Note["scene"]) => setNotes((prev) => updateNoteScene(prev, id, scene, Date.now())),
        []
    )
    const deleteNoteItem = useCallback((id: string) => {
        setNotes((prev) => removeNote(prev, id))
        setEditingNoteId((current) => (current === id ? null : current))
    }, [])
    // The shelf's + tile creates a default reward on the spot, selects it, and opens its card in edit
    // mode so the name/price are editable at once (mirrors adding a task or a node).
    const addRewardDefault = useCallback(() => {
        const id = mintId("reward")
        setRewards((prev) => addReward(prev, id, DEFAULT_REWARD_NAME, DEFAULT_REWARD_PRICE))
        setSelectedRewardId(id)
        setEditOnAddRewardId(id)
    }, [])
    // Open a reward's detail card, and edit its name / price / replenish in place. Deleting from the card
    // removes the reward and closes the card.
    const selectReward = useCallback((id: string) => setSelectedRewardId(id), [])
    const editRewardItem = useCallback(
        (id: string, patch: { name?: string; price?: number; replenish?: boolean }) =>
            setRewards((prev) => editReward(prev, id, patch)),
        []
    )
    const deleteRewardItem = useCallback(
        (id: string) => {
            // Gold-neutral: a redeemed reward's price is already spent, so bank it before dropping the
            // record (an unredeemed one contributed nothing, so no bank).
            const reward = rewards.find((r) => r.id === id)
            if (reward && reward.redeemedAt !== undefined) setBanked((b) => ({ ...b, spent: b.spent + reward.price }))
            setRewards((prev) => removeReward(prev, id))
            setSelectedRewardId(null)
        },
        [rewards]
    )
    // Un-redeem a reward: clears its redeemedAt, so the spend drops out and the gold returns.
    const unredeemRewardItem = useCallback((id: string) => setRewards((prev) => unredeem(prev, id)), [])
    // Mint an id up front for a possible replenished copy; redeem uses it only when the reward restocks
    // (an unused id just leaves a harmless gap in the sequence).
    const redeemReward = useCallback(
        (id: string) => {
            // A coin ka-ching, but only when the buy will actually go through (mirrors redeem()'s guard).
            const reward = rewards.find((item) => item.id === id)
            if (reward && reward.redeemedAt === undefined && gold >= reward.price) sfx.coin()
            const replenishId = mintId("reward")
            setRewards((prev) => redeem(prev, id, gold, Date.now(), replenishId))
        },
        [gold, rewards, sfx]
    )

    const toggleTodo = useCallback(
        (index: number) => {
            if (selectedId === null) return
            // Crossing a checklist item off (a to-do completed) ticks; un-ticking is silent. Decided from
            // current state, not inside the reducer (which StrictMode double-invokes in dev).
            const current = active?.todos[selectedId]?.[index]
            if (current && !current.done) sfx.tick()
            dispatch({ type: "toggleTodo", boardId: activeId, id: selectedId, index })
        },
        [selectedId, active, activeId, sfx]
    )

    // Mark the selected node complete — the pure rule guards that it is unlocked and every box is
    // ticked, so a no-op leaves the set (and reference) untouched.
    const completeSelected = useCallback(() => {
        if (selectedId === null || !active) return
        // Decide the cue from current state (outside the reducer): a non-root node chimes here, while
        // completing the root node fires the finale fanfare from the board-celebration effect, so it
        // isn't doubled.
        const allDone = (active.todos[selectedId] ?? []).every((todo) => todo.done)
        const next = complete(selectedId, active.mastered, allDone, active.edges, active.nodes, isBoardComplete)
        if (next !== active.mastered && selectedId !== active.rootId) sfx.success()
        dispatch({ type: "complete", boardId: activeId, id: selectedId, allTodosDone: allDone })
    }, [selectedId, active, activeId, sfx, isBoardComplete])

    // Mark it incomplete, cascading up so no completed parent is left with an incomplete child.
    const uncompleteSelected = useCallback(() => {
        if (selectedId === null) return
        dispatch({ type: "uncomplete", boardId: activeId, id: selectedId })
    }, [selectedId, activeId])

    // Delete the selected node and its subtree (cascade), then move selection to its parent so the
    // card shows something valid (every non-root node has a parent; fall back to clearing). The root
    // node is never deleted here -- that path removes the whole board via removeBoard.
    const deleteSelected = useCallback(() => {
        if (selectedId === null || !active) return
        const parent = parentOf(selectedId, active.edges)
        dispatch({ type: "deleteNode", boardId: activeId, id: selectedId })
        if (parent) focusNode(parent)
        else setSelectedId(null)
    }, [selectedId, active, activeId, focusNode])

    // Edit the selected node's name/description/reward in place.
    const editNode = useCallback(
        (patch: Partial<Pick<Node, "name" | "description" | "reward">>) => {
            if (selectedId === null) return
            dispatch({ type: "editNode", boardId: activeId, id: selectedId, patch })
        },
        [selectedId, activeId]
    )

    // Persist a node's dragged position (its centre).
    const moveNode = useCallback(
        (id: string, x: number, y: number) => {
            dispatch({ type: "moveNode", boardId: activeId, id, x, y })
        },
        [activeId]
    )

    // Retext one checklist item on the selected node.
    const editTodo = useCallback(
        (index: number, text: string) => {
            if (selectedId === null) return
            dispatch({ type: "editTodo", boardId: activeId, id: selectedId, index, text })
        },
        [selectedId, activeId]
    )

    // Drop a checklist item.
    const deleteTodo = useCallback(
        (index: number) => {
            if (selectedId === null) return
            dispatch({ type: "deleteTodo", boardId: activeId, id: selectedId, index })
        },
        [selectedId, activeId]
    )

    // Append a fresh, empty checklist item.
    const addTodo = useCallback(() => {
        if (selectedId === null) return
        dispatch({ type: "addTodo", boardId: activeId, id: selectedId })
    }, [selectedId, activeId])

    // Add a sub-node under the selected node: a new leaf a tier below, fanned past existing siblings.
    // A fresh child is incomplete, so the parent (and any now-inconsistent ancestor) drops out of the
    // completed set.
    const addChild = useCallback(() => {
        if (selectedId === null) return
        const childId = mintId("node")
        dispatch({ type: "addChild", boardId: activeId, parentId: selectedId, childId })
        setEditOnAddId(childId)
        focusNode(childId)
    }, [selectedId, activeId, focusNode])

    // Add a parent above the selected node. Above the root node the new node becomes the tier-0 gold
    // root, the old root drops to a normal node beneath it, and every existing node shifts down a tier;
    // the tab label follows the root name, so it flips to the new node instantly.
    const addParent = useCallback(() => {
        if (selectedId === null) return
        const newId = mintId("node")
        dispatch({ type: "addParent", boardId: activeId, targetId: selectedId, newId })
        setEditOnAddId(newId)
        focusNode(newId)
    }, [selectedId, activeId, focusNode])

    // Cancel an in-flight reparent: re-hang the node under its ORIGINAL parent. The detach was
    // view-only (the board's edges were never touched), so reparent-to-original is a no-op (same
    // reference); dispatching it anyway keeps cancel honest and self-describing.
    const cancelReparent = useCallback(() => {
        if (reparenting === null) return
        dispatch({ type: "reparent", boardId: activeId, nodeId: reparenting.nodeId, newParentId: reparenting.originalParentId })
        setReparenting(null)
    }, [reparenting, activeId])

    // Unconnect the selected node: detach it (with its whole subtree) from its parent and arm reparent
    // mode. Dismisses the card while the loose edge trails the pointer. The detach is view-only (see
    // `reparenting`), so nothing is dispatched -- the board keeps its edges until a target is clicked
    // (attach) or the move is cancelled.
    const unconnectSelected = useCallback(() => {
        if (selectedId === null || !active) return
        const originalParentId = parentOf(selectedId, active.edges)
        if (originalParentId === null) return // the root has no parent to detach from (App gates this off anyway)
        setReparenting({ nodeId: selectedId, originalParentId })
        setSelectedId(null)
    }, [selectedId, active])

    // Attach the reparenting node under a clicked target. Valid = a node in this board that is neither
    // the node itself nor one of its descendants (attaching under its own subtree would cycle -- the
    // pure `reparent` op rejects that too). Clicking the node itself cancels; a descendant is ignored
    // (stays armed); a valid target commits the move and re-selects the moved node.
    const attachTo = useCallback(
        (targetId: string) => {
            if (reparenting === null || !active) return
            const { nodeId } = reparenting
            if (targetId === nodeId) {
                cancelReparent()
                return
            }
            if (descendantsOf(nodeId, active.edges).includes(targetId)) return
            dispatch({ type: "reparent", boardId: activeId, nodeId, newParentId: targetId })
            setReparenting(null)
            focusNode(nodeId)
        },
        [reparenting, active, activeId, focusNode, cancelReparent]
    )

    // While a reparent is armed, Escape or a click on empty canvas cancels it back to the original
    // parent. A click on a NODE attaches instead (BoardTree's onNodeClick -> attachTo), so node /
    // control / tab / card / dialog targets are left alone here. This listens on `click`, not
    // `pointerdown`: a drag to pan the canvas emits no click, so pan / zoom stay live while armed.
    useEffect(() => {
        if (reparenting === null) return
        const onClick = (event: MouseEvent) => {
            const target = event.target as Element | null
            if (
                target?.closest(".react-flow__node") ||
                target?.closest(".react-flow__controls") ||
                target?.closest("[data-tabbar]") ||
                target?.closest("[data-detail-card]") ||
                target?.closest('[role="alertdialog"]')
            ) {
                return
            }
            cancelReparent()
        }
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Escape") cancelReparent()
        }
        document.addEventListener("click", onClick)
        document.addEventListener("keydown", onKeyDown)
        return () => {
            document.removeEventListener("click", onClick)
            document.removeEventListener("keydown", onKeyDown)
        }
    }, [reparenting, cancelReparent])

    // Switching boards or leaving the roadmap disarms any in-flight reparent: its node lives on the
    // board (and section) we're leaving, so the loose edge shouldn't follow us. The detach was never
    // committed, so this just drops the transient arm.
    useEffect(() => {
        setReparenting(null)
    }, [activeId, section])

    // Add an (unlinked) linked node under the selected node, then select it and open its card in edit
    // mode with the board dropdown -- the same open-in-edit-on-create flow as adding a child node.
    const addLinkedNode = useCallback(() => {
        if (selectedId === null) return
        const childId = mintId("node")
        dispatch({ type: "addLinkedNode", boardId: activeId, parentId: selectedId, childId })
        setEditOnAddId(childId)
        focusNode(childId)
    }, [selectedId, activeId, focusNode])

    // Point the selected linked node at a board (or clear it back to unlinked with null).
    const setLinkedTarget = useCallback(
        (boardId: string | null) => {
            if (selectedId === null) return
            dispatch({ type: "setLinkedTarget", boardId: activeId, id: selectedId, targetBoardId: boardId })
        },
        [selectedId, activeId]
    )

    // Switch to another tab, selecting its root node so the card shows something valid immediately.
    const switchBoard = useCallback(
        (id: string) => {
            setSection("roadmap")
            setActiveId(id)
            setSelectedId(boards[id]?.rootId ?? null)
        },
        [boards]
    )

    // Go to Board: the selected linked node's action. Route to (activate) its target board; a no-op
    // while the node is unlinked (the card renders the button disabled in that case anyway).
    const goToBoard = useCallback(() => {
        if (selectedId === null || !active) return
        const target = active.nodes[selectedId]?.targetBoardId
        if (target && boards[target]) switchBoard(target)
    }, [selectedId, active, boards, switchBoard])

    // Create a blank board (root node only, named "New Quest") and open it, its root node's card in edit
    // mode so the name is editable at once.
    const addBoard = useCallback(() => {
        const boardId = mintId("board")
        const rootId = mintId("node")
        dispatch({ type: "addBoard", boardId, rootId, name: "New Quest" })
        setSection("roadmap")
        setActiveId(boardId)
        setEditOnAddId(rootId)
        focusNode(rootId)
    }, [focusNode])

    // Rename a tab == rename its root node (both read the same name).
    const renameBoard = useCallback((id: string, name: string) => {
        dispatch({ type: "renameBoard", boardId: id, name })
    }, [])

    // Remove a board (by deleting its root node), activating a neighbour if the active one went away.
    // No floor: removing the last board drops to the zero-board Add Board prompt.
    const removeBoard = useCallback(
        (id: string) => {
            const index = order.indexOf(id)
            const nextOrder = order.filter((tabId) => tabId !== id)
            dispatch({ type: "removeBoard", boardId: id })
            if (activeId === id) {
                const neighbour = nextOrder[Math.min(index, nextOrder.length - 1)]
                if (neighbour) {
                    setActiveId(neighbour)
                    setSelectedId(boards[neighbour]?.rootId ?? null)
                } else {
                    setActiveId("")
                    setSelectedId(null)
                }
            }
        },
        [order, activeId, boards]
    )

    // Serialize the app's data (not the open tab) for the Export button to download.
    const handleExport = useCallback(
        () => serialize({ boards, boardOrder: order, tasks, rewards, banked, notes }),
        [boards, order, tasks, rewards, banked, notes]
    )

    // Replace the whole app from a loaded state -- an imported file or a roadmap synced down from another
    // device. Swaps every slice and opens the first board selected on its root node.
    const applyLoaded = useCallback((loaded: PersistedSlices) => {
        dispatch({ type: "replace", boards: loaded.boards, order: loaded.boardOrder })
        setTasks(loaded.tasks)
        setRewards(loaded.rewards)
        setBanked(loaded.banked)
        setNotes(loaded.notes)
        setEditingNoteId(null)
        setSection("roadmap")
        const nextActive = loaded.boardOrder[0] ?? ""
        setActiveId(nextActive)
        setSelectedId(loaded.boards[nextActive]?.rootId ?? null)
    }, [])

    // Replace the whole app from an imported file. Invalid input is rejected with an alert and changes
    // nothing; a valid file is applied like any loaded state.
    const handleImport = useCallback(
        (json: string) => {
            const loaded = deserialize(json)
            if (!loaded) {
                alert("Could not import: the file is not a valid questline export.")
                return
            }
            applyLoaded(loaded)
        },
        [applyLoaded]
    )

    // Cross-device sync: opt-in, end-to-end encrypted, and inert unless VITE_SYNC_URL is set at build.
    // It reads the same slices the autosave persists and applies an incoming roadmap through applyLoaded.
    const syncSlices = useMemo<PersistedSlices>(
        () => ({ boards, boardOrder: order, tasks, rewards, banked, notes }),
        [boards, order, tasks, rewards, banked, notes]
    )
    const sync = useSync(syncSlices, applyLoaded)

    // A pairing link or a detected conflict needs attention now: jump to the Sync screen so the inline
    // confirm / choice is visible without the user hunting for it.
    useEffect(() => {
        if (sync.pendingAdopt !== null || sync.conflict) setSection("sync")
    }, [sync.pendingAdopt, sync.conflict])

    // Warn once when sync is stalled by an over-limit push; reset so a later oversize warns again.
    const [oversizedDismissed, setOversizedDismissed] = useState(false)
    useEffect(() => {
        if (!sync.oversized) setOversizedDismissed(false)
    }, [sync.oversized])

    const tabs = order.flatMap((id) => {
        const board = boards[id]
        const root = board?.nodes[board.rootId]
        return root ? [{ id, name: root.name }] : []
    })

    // The task backing the open task detail card, keyed off the trailing displayTaskId so the card
    // survives dismissal long enough to animate out (looked up in the full list, so a done task within
    // its TTL still resolves). Absent once its task is deleted, which unmounts the card immediately.
    const displayedTask = displayTaskId !== null ? tasks.find((task) => task.id === displayTaskId) : undefined
    const taskClosing = selectedTaskId === null && displayTaskId !== null

    // The reward backing the open reward detail card, keyed off the trailing displayRewardId (looked up
    // in the full list so a redeemed one within its TTL still resolves). Absent once deleted, unmounting
    // the card immediately.
    const displayedReward =
        displayRewardId !== null ? rewards.find((reward) => reward.id === displayRewardId) : undefined
    const rewardClosing = selectedRewardId === null && displayRewardId !== null

    const closing = selectedId === null && displayId !== null
    // The node backing the open detail card. Kind is positional: the root node is the one whose id is
    // the board's rootId; a linked node carries the targetBoardId key; otherwise it's a regular node.
    // Deleting the root removes the whole board; any other node removes its own subtree.
    const shown: Node | undefined = displayId !== null ? active?.nodes[displayId] : undefined
    const isRoot = !!shown && !!active && shown.id === active.rootId
    const isLinked = !!shown && isLinkedNode(shown)
    const deleteKind: "node" | "board" = isRoot ? "board" : "node"
    const onDeleteShown = !shown ? undefined : isRoot ? () => removeBoard(activeId) : deleteSelected
    const deleteDescendantCount = shown && !isRoot && active ? descendantsOf(shown.id, active.edges).length : 0
    // Linked-node card inputs (meaningful only when isLinked): the live-mirrored display name, and the
    // dropdown of every OTHER board (self -- the active board -- excluded).
    const linkedName = shown && isLinked ? linkedNodeName(boards, shown.targetBoardId) : ""
    const linkedBoardOptions = isLinked ? tabs.filter((tab) => tab.id !== activeId) : []

    // The Draw note open in the editor (null → show the wall). A deleted id resolves to undefined, which
    // falls back to the wall.
    const editingNote = editingNoteId !== null ? notes.find((note) => note.id === editingNoteId) : undefined

    return (
        <div className="relative flex min-h-screen flex-col overflow-hidden bg-[#f6edd6]">
            <TabBar
                tabs={tabs}
                activeId={section === "roadmap" ? activeId : ""}
                onSelect={switchBoard}
                onRename={renameBoard}
                onAddBoard={addBoard}
                leading={
                    <NavActions
                        onOpenTasks={openTasks}
                        tasksActive={section === "tasks"}
                        onOpenRewards={openRewards}
                        rewardsActive={section === "rewards"}
                        onOpenExcalidraw={openExcalidraw}
                        excalidrawActive={section === "excalidraw"}
                    />
                }
                trailing={
                    <>
                        <SoundToggle />
                        <IoButtons onExport={handleExport} onImport={handleImport} />
                        {sync.enabled && (
                            <SyncNavButton on={sync.active} onOpen={() => setSection("sync")} />
                        )}
                    </>
                }
            />
            <div ref={boardRef} className="board-surface relative isolate flex-1 overflow-hidden">
                <Corners />
                {/* Keyed so a section change animates; within the roadmap, a tab switch (activeId) does too. */}
                <SectionTransition
                    key={section === "roadmap" ? `roadmap:${activeId}` : section}
                    animate={!firstSectionRef.current}
                >
                {section === "tasks" ? (
                    <>
                        <div className="themed-scroll absolute inset-0 z-10 overflow-auto">
                            <TasksBoard
                                items={visible(tasks, Date.now())}
                                onAdd={addTaskItem}
                                onToggle={toggleTask}
                                onReorder={reorderTask}
                                onSelect={selectTask}
                                selectedId={selectedTaskId}
                            />
                        </div>
                        {displayedTask && (
                            <aside
                                data-task-detail-card=""
                                className="absolute right-4 top-4 z-20 w-[320px] max-w-[calc(100%-2rem)]"
                            >
                                <TaskDetailCard
                                    key={displayedTask.id}
                                    task={displayedTask}
                                    closing={taskClosing}
                                    onEdit={(patch) => editTaskItem(displayedTask.id, patch)}
                                    onDelete={() => deleteTaskItem(displayedTask.id)}
                                    initialEditing={displayedTask.id === editOnAddTaskId}
                                    onExited={() => setDisplayTaskId(null)}
                                />
                            </aside>
                        )}
                    </>
                ) : section === "rewards" ? (
                    <>
                        <div className="themed-scroll absolute inset-0 z-10 overflow-auto">
                            <RewardsBoard
                                gold={gold}
                                rewards={visibleRewards(rewards, Date.now())}
                                selectedId={selectedRewardId}
                                onRedeem={redeemReward}
                                onSelectReward={selectReward}
                                onAddReward={addRewardDefault}
                            />
                        </div>
                        {displayedReward ? (
                            <aside
                                data-reward-detail-card=""
                                className="absolute right-4 top-4 z-20 w-[320px] max-w-[calc(100%-2rem)]"
                            >
                                <RewardDetailCard
                                    key={displayedReward.id}
                                    reward={displayedReward}
                                    closing={rewardClosing}
                                    onEdit={(patch) => editRewardItem(displayedReward.id, patch)}
                                    onDelete={() => deleteRewardItem(displayedReward.id)}
                                    onUnredeem={() => unredeemRewardItem(displayedReward.id)}
                                    initialEditing={displayedReward.id === editOnAddRewardId}
                                    onExited={() => setDisplayRewardId(null)}
                                />
                            </aside>
                        ) : null}
                    </>
                ) : section === "sync" ? (
                    <div className="themed-scroll absolute inset-0 z-10 overflow-auto">
                        <SyncBoard sync={sync} />
                    </div>
                ) : section === "excalidraw" ? (
                    <Suspense
                        fallback={
                            <div className="absolute inset-0 z-10 grid place-items-center text-[15px] italic text-[#a2916c]">
                                Loading canvas...
                            </div>
                        }
                    >
                        {editingNote ? (
                            <ExcalidrawBoard
                                key={editingNote.id}
                                note={editingNote}
                                onChange={(scene) => updateNoteSceneItem(editingNote.id, scene)}
                                onBack={backToNotes}
                                onDelete={() => deleteNoteItem(editingNote.id)}
                            />
                        ) : (
                            <div className="themed-scroll absolute inset-0 z-10 overflow-auto">
                                <DrawBoard
                                    notes={notes}
                                    onOpen={openNote}
                                    onAdd={addNoteItem}
                                    onRename={renameNoteItem}
                                    highlightId={highlightNoteId}
                                />
                            </div>
                        )}
                    </Suspense>
                ) : (
                    <>
                        <div className="absolute inset-0 z-10">
                            {active ? (
                                <BoardTree
                                    key={activeId}
                                    selectedId={selectedId}
                                    onSelect={selectFromCanvas}
                                    rootId={active.rootId}
                                    mastered={active.mastered}
                                    nodes={active.nodes}
                                    edges={active.edges}
                                    boards={boards}
                                    onMove={moveNode}
                                    focusId={focusId}
                                    focusNonce={focusNonce}
                                    reparenting={reparenting?.nodeId ?? null}
                                    onAttach={attachTo}
                                />
                            ) : (
                                <div className="absolute inset-0 grid place-items-center">
                                    <div className="text-center">
                                        <p className="mb-4 font-display text-[16px] italic text-[#a2916c]">
                                            No quests yet.
                                        </p>
                                        <button
                                            type="button"
                                            onClick={addBoard}
                                            className="rounded-lg border border-[#8a641d]/40 bg-[#f4ead0] px-4 py-2 font-display text-[13px] font-bold uppercase tracking-wide text-[#4a3410] transition-colors hover:bg-[#efe3c4]"
                                        >
                                            Add a board
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>
                        {active && shown && (
                            <aside
                                data-detail-card=""
                                className="absolute right-4 top-4 z-20 w-[320px] max-w-[calc(100%-2rem)]"
                            >
                                <NodeDetailCard
                                    key={shown.id}
                                    node={shown}
                                    state={stateOf(shown.id, active.mastered, active.edges, active.nodes, isBoardComplete)}
                                    todos={isRoot || isLinked ? [] : (active.todos[shown.id] ?? [])}
                                    isRoot={isRoot}
                                    isLinked={isLinked}
                                    linkedName={linkedName}
                                    boardOptions={linkedBoardOptions}
                                    targetBoardId={shown.targetBoardId ?? null}
                                    onSetLinkedTarget={setLinkedTarget}
                                    onGoToBoard={goToBoard}
                                    closing={closing}
                                    onToggle={toggleTodo}
                                    onComplete={completeSelected}
                                    onUncomplete={uncompleteSelected}
                                    onEditNode={editNode}
                                    onEditTodo={editTodo}
                                    onDeleteTodo={deleteTodo}
                                    onAddTodo={addTodo}
                                    onAddChild={addChild}
                                    onAddParent={addParent}
                                    onAddLinkedNode={addLinkedNode}
                                    onUnconnect={isRoot ? undefined : unconnectSelected}
                                    onDelete={onDeleteShown}
                                    deleteKind={deleteKind}
                                    descendantCount={deleteDescendantCount}
                                    initialEditing={shown.id === editOnAddId}
                                    onExited={() => setDisplayId(null)}
                                />
                            </aside>
                        )}
                        <BoardCelebration burst={burst} />
                    </>
                )}
                </SectionTransition>
            </div>
            <ConfirmDialog
                open={sync.oversized && !oversizedDismissed}
                title="Data too large to sync"
                message={
                    <>
                        Your data has grown past the sync size limit, so changes have stopped syncing to your other
                        devices. Everything is still saved on this device; remove some content to resume syncing.
                    </>
                }
                confirmLabel="Got it"
                onConfirm={() => setOversizedDismissed(true)}
                onOpenChange={(open) => {
                    if (!open) setOversizedDismissed(true)
                }}
            />
        </div>
    )
}

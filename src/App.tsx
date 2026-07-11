import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { addTask, DEFAULT_TASK_NAME, edit, type Task, remove, reorder, SEED_TASKS, toggle, visible } from "./tasks"
import { TasksBoard } from "./TasksBoard"
import { TaskDetailCard } from "./TaskDetailCard"
import { Corners } from "./Corners"
import { NodeDetailCard } from "./NodeDetailCard"
import { ConfirmDialog } from "./ConfirmDialog"
import { BoardCelebration } from "./BoardCelebration"
import { complete, descendantsOf, parentOf, stateOf, uncomplete } from "./graph"
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
import { DEFAULT_NODE_REWARD, type Edge, type Node } from "./nodes"
import { NavActions } from "./NavActions"
import { addNote, type Note, removeNote, renameNote, updateNoteScene } from "./notes"
import { deserialize, loadState, maxCounter, type PersistedSlices, saveState, serialize } from "./persist"
import { type Board, deleteNode, insertParent, newBoard, ROOT_ID, rootProject, seedBoard } from "./board"
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

// Auto-placement for a new sub-milestone: drop it a tier below the parent (matches the seed's ~160px
// tier gap) and fan each extra sibling to the right so repeated adds don't stack exactly.
const TIER_GAP = 160
const SIBLING_FAN = 70

// In the Root view, every other view is mirrored as a read-only node under the Root node. The mirror
// id encodes its source project so a click can open that view; horizontal spacing lays them in a row.
const VIEW_MIRROR_PREFIX = "view-mirror-"
const MIRROR_SPACING = 210

// Stable empty set for views that contribute no static (mirror) nodes.
const EMPTY_IDS: ReadonlySet<string> = new Set()

// The tab + node to open on first render, seeded from the URL hash (#<nodeId>) if it points at a
// known node, else the Root hub with nothing selected (the canvas fits the whole tree).
type Boot = {
    projects: Record<string, Board>
    order: string[]
    mirrorPos: Record<string, { x: number; y: number }>
    tasks: Task[]
    rewards: Reward[]
    banked: Banked
    notes: Note[]
    activeId: string
    selectedId: string | null
    nextNodeId: number
    nextViewId: number
    nextTaskId: number
    nextRewardId: number
    nextNoteId: number
    hadHash: boolean
}
function computeBoot(): Boot {
    // Restore the autosaved data if present; otherwise start from Root + the bundled sample.
    const loaded = loadState()
    const projects = loaded?.projects ?? { [ROOT_ID]: rootProject(), seed: seedBoard() }
    const order = loaded?.order ?? [ROOT_ID, "seed"]
    const mirrorPos = loaded?.mirrorPos ?? {}
    // Tasks and rewards seed only on a truly fresh start (no saved state at all); an existing save
    // from before these views simply had none, and loads empty rather than re-seeding.
    const rawTasks = loaded?.tasks ?? SEED_TASKS
    const rawRewards = loaded?.rewards ?? SEED_REWARDS
    // Draw notes start empty (no tutorial seed); an existing save loads whatever it had.
    const notes = loaded?.notes ?? []
    // Counters resume past whatever ids the loaded/seed data already uses. Computed before pruning so a
    // banked-away id is never reissued.
    const nextNodeId = maxCounter(
        Object.values(projects).flatMap((project) => Object.keys(project.milestones)),
        "node"
    )
    const nextViewId = maxCounter(Object.keys(projects), "board")
    const nextTaskId = maxCounter(
        rawTasks.map((task) => task.id),
        "task"
    )
    const nextRewardId = maxCounter(
        rawRewards.map((reward) => reward.id),
        "reward"
    )
    const nextNoteId = maxCounter(
        notes.map((note) => note.id),
        "note"
    )
    // Fold any task/reward already past its 14-day window into the banked totals and drop it, so storage
    // stays small across reloads while the balance (banked + live) is unchanged.
    const { tasks, rewards, banked } = compact(
        rawTasks,
        rawRewards,
        loaded?.banked ?? { earned: 0, spent: 0 },
        Date.now()
    )
    const base = {
        projects,
        order,
        mirrorPos,
        tasks,
        rewards,
        banked,
        notes,
        nextNodeId,
        nextViewId,
        nextTaskId,
        nextRewardId,
        nextNoteId
    }

    const hashId = window.location.hash.slice(1)
    if (hashId.startsWith(VIEW_MIRROR_PREFIX)) {
        if (projects[hashId.slice(VIEW_MIRROR_PREFIX.length)]) {
            return { ...base, activeId: ROOT_ID, selectedId: hashId, hadHash: true }
        }
    } else if (hashId) {
        const pid = Object.keys(projects).find((p) => projects[p]?.milestones[hashId])
        if (pid) return { ...base, activeId: pid, selectedId: hashId, hadHash: true }
    }
    // No hash: open the Root hub with nothing selected; the canvas fits the whole tree by default.
    return { ...base, activeId: ROOT_ID, selectedId: null, hadHash: false }
}

export function App() {
    // Each tab is a Board (its own roadmap). `order` fixes tab order; `activeId` picks the visible
    // one. Root is the pinned first tab; the sample roadmap follows. Initial tab/selection come from
    // the URL hash when it names a known node.
    const bootRef = useRef<Boot | null>(null)
    const boot = (bootRef.current ??= computeBoot())
    // The synthesized SFX kit, stable for the app's lifetime. Effects fire from the handlers below and
    // from the board-celebration effect -- never from render or from inside a state updater.
    const sfx = useSfx()
    const [projects, setProjects] = useState<Record<string, Board>>(boot.projects)
    const [order, setOrder] = useState<string[]>(boot.order)
    const [activeId, setActiveId] = useState(boot.activeId)
    // `selectedId` is the intent (null once dismissed); `displayId` is what the card shows and trails
    // `selectedId` on dismissal so the exit animation can play before the card unmounts.
    const [selectedId, setSelectedId] = useState<string | null>(boot.selectedId)
    const [displayId, setDisplayId] = useState<string | null>(boot.selectedId)
    // A milestone just added via the detail card: its card opens in edit mode so the name is editable at
    // once. Cleared the moment that card mounts, so re-selecting the node later opens the read view.
    const [editOnAddId, setEditOnAddId] = useState<string | null>(null)
    // Dragged positions of Root's mirror nodes, keyed by mirror id. Mirrors are otherwise derived, so
    // their layout lives here rather than in any project.
    const [mirrorPos, setMirrorPos] = useState<Record<string, { x: number; y: number }>>(boot.mirrorPos)
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
    // animation can play before the card unmounts (mirrors selectedId / displayId for milestones).
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
    // Monotonic sources of unique ids for new tabs and new nodes.
    const nextViewId = useRef(boot.nextViewId)
    const nextNodeId = useRef(boot.nextNodeId)
    const nextTaskId = useRef(boot.nextTaskId)
    const nextRewardId = useRef(boot.nextRewardId)
    const nextNoteId = useRef(boot.nextNoteId)
    // Fires the finale fanfare when the active tab's root node crosses into complete, anchored on that
    // root node. Tracked per tab (seeded on first sight) so switching onto an already-done root node
    // doesn't fire; the burst carries the root node's board-relative centre + a nonce to (re)play.
    const boardRef = useRef<HTMLDivElement>(null)
    const boardDoneRef = useRef<Record<string, boolean>>({})
    const [burst, setBurst] = useState<{ x: number; y: number; nonce: number } | null>(null)

    const active = projects[activeId]

    // Gold in the purse: earned from progress (checklist boxes, tasks, nodes, root nodes) minus what's
    // been spent. A redemption is a permanent spend, so un-completing work you'd already spent against
    // can push the balance negative -- a debt the purse shows honestly until fresh work out-earns it.
    const gold = useMemo(
        () => banked.earned + earnedGold(projects, tasks) - (banked.spent + spentGold(rewards)),
        [projects, tasks, rewards, banked]
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
    // selects) or the tab bar. Mirrors the milestone card / add-reward dismissal.
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

    // Mirror the selected node into the URL hash (shareable), without adding history entries.
    useEffect(() => {
        const current = window.location.hash.slice(1)
        const next = selectedId ?? ""
        if (current === next) return
        const url = next ? `#${next}` : `${window.location.pathname}${window.location.search}`
        window.history.replaceState(null, "", url)
    }, [selectedId])

    // Open the node named in the URL hash: switch to its view, select it, and pan onto it.
    const applyHash = useCallback(() => {
        const id = window.location.hash.slice(1)
        if (!id) return
        let target: string | null = null
        if (id.startsWith(VIEW_MIRROR_PREFIX)) {
            if (projects[id.slice(VIEW_MIRROR_PREFIX.length)]) target = ROOT_ID
        } else {
            target = Object.keys(projects).find((p) => projects[p]?.milestones[id]) ?? null
        }
        if (!target) return
        setSection("roadmap")
        setActiveId(target)
        setSelectedId(id)
        setFocusId(id)
        setFocusNonce((n) => n + 1)
    }, [projects])

    useEffect(() => {
        window.addEventListener("hashchange", applyHash)
        return () => window.removeEventListener("hashchange", applyHash)
    }, [applyHash])

    // Apply a change to the active board only, keeping the reference stable on a no-op edit.
    const updateActive = useCallback(
        (fn: (board: Board) => Board) => {
            setProjects((prev) => {
                const board = prev[activeId]
                if (!board) return prev
                const next = fn(board)
                return next === board ? prev : { ...prev, [activeId]: next }
            })
        },
        [activeId]
    )

    // Autosave the app's data (not the open tab) 400ms after the last change, so a drag — which
    // fires moveMilestone rapidly — coalesces into a single write.
    useEffect(() => {
        const timer = setTimeout(() => saveState({ projects, order, mirrorPos, tasks, rewards, banked, notes }), 400)
        return () => clearTimeout(timer)
    }, [projects, order, mirrorPos, tasks, rewards, banked, notes])

    // Select a node and pan the canvas onto it; the URL hash follows the selection.
    const focusNode = useCallback((id: string) => {
        setSelectedId(id)
        setFocusId(id)
        setFocusNonce((n) => n + 1)
    }, [])

    // A click on any canvas node (a milestone or a Root-hub view chip): a subtle selection tick, then
    // select it.
    const selectFromCanvas = useCallback(
        (id: string) => {
            sfx.tick()
            setSelectedId(id)
        },
        [sfx]
    )

    // Tasks: open the app-level list, and add / toggle / remove its items. One global list, so
    // these never touch the active project.
    const openTasks = useCallback(() => setSection("tasks"), [])
    // The list's + tile adds a default task, then selects it and opens its card in edit mode so its
    // name/reward are editable straight away (mirrors adding a reward or a milestone).
    const addTaskItem = useCallback(() => {
        nextTaskId.current += 1
        const id = `task-${nextTaskId.current}`
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
        (activeId: string, overId: string) => setTasks((prev) => reorder(prev, activeId, overId)),
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
    // touch the active project. Redeeming is a one-off buy: it stamps the reward's `redeemedAt` (when the
    // balance covers the price), which spends the gold and starts the 14-day shelf window.
    const openRewards = useCallback(() => setSection("rewards"), [])
    // The Draw wall. Opening it always lands on the grid (never straight into a note); a new note opens
    // its blank canvas at once. Renames and scene edits patch the one flat notes list (never a project).
    const openExcalidraw = useCallback(() => {
        setEditingNoteId(null)
        setSection("excalidraw")
    }, [])
    const openNote = useCallback((id: string) => setEditingNoteId(id), [])
    const backToNotes = useCallback(() => setEditingNoteId(null), [])
    // Add an empty scribble to the wall (newest first); it stays on the grid, opened only on click, and
    // is ringed briefly so it's easy to spot.
    const addNoteItem = useCallback(() => {
        nextNoteId.current += 1
        const id = `note-${nextNoteId.current}`
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
    // mode so the name/price are editable at once (mirrors adding a task or a milestone).
    const addRewardDefault = useCallback(() => {
        nextRewardId.current += 1
        const id = `reward-${nextRewardId.current}`
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
            nextRewardId.current += 1
            const replenishId = `reward-${nextRewardId.current}`
            setRewards((prev) => redeem(prev, id, gold, Date.now(), replenishId))
        },
        [gold, rewards, sfx]
    )

    const toggleTodo = useCallback(
        (index: number) => {
            if (selectedId === null) return
            // Crossing a checklist item off (a to-do completed) ticks; un-ticking is silent. Decided from
            // current state, not inside the updater (which StrictMode double-invokes in dev).
            const current = active?.todos[selectedId]?.[index]
            if (current && !current.done) sfx.tick()
            updateActive((project) => {
                const list = project.todos[selectedId]
                if (!list) return project
                return {
                    ...project,
                    todos: {
                        ...project.todos,
                        [selectedId]: list.map((todo, i) => (i === index ? { ...todo, done: !todo.done } : todo))
                    }
                }
            })
        },
        [selectedId, active, updateActive, sfx]
    )

    // Mark the selected node complete — the pure rule guards that it is unlocked and every box
    // is ticked, so a no-op leaves the set (and reference) untouched.
    const completeSelected = useCallback(() => {
        if (selectedId === null) return
        // Decide the cue from current state (outside the StrictMode-double-invoked updater): a non-root
        // node chimes here, while completing the root node fires the finale fanfare from the
        // board-celebration effect, so it isn't doubled.
        if (active) {
            const allDone = (active.todos[selectedId] ?? []).every((todo) => todo.done)
            const next = complete(selectedId, active.mastered, allDone, active.edges)
            if (next !== active.mastered && active.milestones[selectedId]?.tier !== 0) sfx.success()
        }
        updateActive((project) => {
            const allDone = (project.todos[selectedId] ?? []).every((todo) => todo.done)
            const mastered = complete(selectedId, project.mastered, allDone, project.edges)
            return mastered === project.mastered ? project : { ...project, mastered }
        })
    }, [selectedId, active, updateActive, sfx])

    // Mark it incomplete, cascading up so no completed parent is left with an incomplete child.
    const uncompleteSelected = useCallback(() => {
        if (selectedId === null) return
        updateActive((project) => {
            const mastered = uncomplete(selectedId, project.mastered, project.edges)
            return mastered === project.mastered ? project : { ...project, mastered }
        })
    }, [selectedId, updateActive])

    // Delete the selected node and its subtree (cascade), then move selection to its parent so the
    // card shows something valid (every non-root node has a parent; fall back to clearing). The root
    // node is never deleted here -- that path removes the whole view via removeBoard.
    const deleteSelected = useCallback(() => {
        if (selectedId === null || !active) return
        const parent = parentOf(selectedId, active.edges)
        updateActive((board) => deleteNode(board, selectedId))
        if (parent) focusNode(parent)
        else setSelectedId(null)
    }, [selectedId, active, updateActive, focusNode])

    // Edit the selected node's name/description/reward in place.
    const editMilestone = useCallback(
        (patch: Partial<Pick<Node, "name" | "description" | "reward">>) => {
            if (selectedId === null) return
            updateActive((board) => {
                const current = board.milestones[selectedId]
                if (!current) return board
                return { ...board, milestones: { ...board.milestones, [selectedId]: { ...current, ...patch } } }
            })
        },
        [selectedId, updateActive]
    )

    // Persist a node's dragged position (its centre). Mirror nodes are derived, so their positions
    // live in mirrorPos; every other node's lives on its milestone record.
    const moveMilestone = useCallback(
        (id: string, x: number, y: number) => {
            if (id.startsWith(VIEW_MIRROR_PREFIX)) {
                setMirrorPos((prev) => (prev[id]?.x === x && prev[id]?.y === y ? prev : { ...prev, [id]: { x, y } }))
                return
            }
            updateActive((project) => {
                const current = project.milestones[id]
                if (!current || (current.x === x && current.y === y)) return project
                return { ...project, milestones: { ...project.milestones, [id]: { ...current, x, y } } }
            })
        },
        [updateActive]
    )

    // Retext one checklist item on the selected milestone.
    const editTodo = useCallback(
        (index: number, text: string) => {
            if (selectedId === null) return
            updateActive((project) => {
                const list = project.todos[selectedId]
                if (!list) return project
                return {
                    ...project,
                    todos: {
                        ...project.todos,
                        [selectedId]: list.map((todo, i) => (i === index ? { ...todo, text } : todo))
                    }
                }
            })
        },
        [selectedId, updateActive]
    )

    // Drop a checklist item.
    const deleteTodo = useCallback(
        (index: number) => {
            if (selectedId === null) return
            updateActive((project) => {
                const list = project.todos[selectedId]
                if (!list) return project
                return {
                    ...project,
                    todos: { ...project.todos, [selectedId]: list.filter((_, i) => i !== index) }
                }
            })
        },
        [selectedId, updateActive]
    )

    // Append a fresh, empty checklist item.
    const addTodo = useCallback(() => {
        if (selectedId === null) return
        updateActive((project) => ({
            ...project,
            todos: { ...project.todos, [selectedId]: [...(project.todos[selectedId] ?? []), { text: "", done: false }] }
        }))
    }, [selectedId, updateActive])

    // Add a sub-node under the selected node: a new leaf, an edge from parent to it, placed a
    // tier below and fanned past existing siblings. A fresh child is incomplete, so the parent (and
    // any now-inconsistent ancestor) drops out of the completed set.
    const addChild = useCallback(() => {
        if (selectedId === null) return
        const parentId = selectedId
        nextNodeId.current += 1
        const childId = `node-${nextNodeId.current}`
        updateActive((project) => {
            const parent = project.milestones[parentId]
            if (!parent) return project
            const siblings = project.edges.filter((edge) => edge[0] === parentId).length
            const child: Node = {
                id: childId,
                name: "New Milestone",
                tag: parent.tag,
                x: parent.x + siblings * SIBLING_FAN,
                y: parent.y + TIER_GAP,
                tier: parent.tier + 1,
                branch: parent.branch,
                description: "",
                reward: DEFAULT_NODE_REWARD
            }
            const edges: Edge[] = [...project.edges, [parentId, childId]]
            return {
                ...project,
                milestones: { ...project.milestones, [childId]: child },
                edges,
                mastered: uncomplete(parentId, project.mastered, edges)
            }
        })
        setEditOnAddId(childId)
        focusNode(childId)
    }, [selectedId, updateActive, focusNode])

    // Add a parent above the root node: the new node becomes the tier-0 gold root, the old root drops
    // to a normal node beneath it, and every existing node shifts down a tier. The tab label follows the
    // root name, so it flips to the new node instantly. Disabled on Root (nothing sits above Root).
    const addParent = useCallback(() => {
        if (selectedId === null) return
        // The Root hub's own root node is pinned (nothing sits above it); every other node, including a
        // regular node on the Root tab, can take a new parent.
        if (activeId === ROOT_ID && selectedId === active?.rootId) return
        nextNodeId.current += 1
        const newId = `node-${nextNodeId.current}`
        updateActive((project) => insertParent(project, selectedId, newId))
        setEditOnAddId(newId)
        focusNode(newId)
    }, [activeId, active, selectedId, updateActive, focusNode])

    // Switch to another tab, selecting its root node so the card shows something valid immediately.
    const switchBoard = useCallback(
        (id: string) => {
            setSection("roadmap")
            setActiveId(id)
            setSelectedId(projects[id]?.rootId ?? null)
        },
        [projects]
    )

    // A mirror node's popover "View" button opens the view it stands for.
    const openView = useCallback(
        (mirrorId: string) => {
            if (mirrorId.startsWith(VIEW_MIRROR_PREFIX)) switchBoard(mirrorId.slice(VIEW_MIRROR_PREFIX.length))
        },
        [switchBoard]
    )

    // Editing a mirror edits the view it stands for: patch that view's root node name/description/reward.
    // A name change flows back to the tab and the chip (both read the root node name); a reward change
    // sets what completing that view's root node pays out.
    const editMirror = useCallback((mirrorId: string, patch: Partial<Pick<Node, "name" | "description" | "reward">>) => {
        const pid = mirrorId.slice(VIEW_MIRROR_PREFIX.length)
        setProjects((prev) => {
            const project = prev[pid]
            if (!project) return prev
            const root = project.milestones[project.rootId]
            if (!root) return prev
            return {
                ...prev,
                [pid]: { ...project, milestones: { ...project.milestones, [project.rootId]: { ...root, ...patch } } }
            }
        })
    }, [])

    // Create a blank view under `parentId` (ROOT_ID for a top-level view, else a sub-view). `activate`
    // opens it; leaving it false keeps you on the current tab so a new chip just appears in the hub.
    const addView = useCallback(
        (parentId: string, activate: boolean) => {
            setSection("roadmap")
            nextViewId.current += 1
            const id = `board-${nextViewId.current}`
            const project = newBoard(id, "New Quest", parentId)
            setProjects((prev) => ({ ...prev, [id]: project }))
            setOrder((prev) => [...prev, id])
            if (activate) {
                // Open the new view and focus its root node, card in edit mode so its name is editable at once.
                setActiveId(id)
                setEditOnAddId(project.rootId)
                focusNode(project.rootId)
            } else {
                // Stay in the Root hub and focus the new view's chip, its card open in edit mode.
                const mirrorId = `${VIEW_MIRROR_PREFIX}${id}`
                setEditOnAddId(mirrorId)
                focusNode(mirrorId)
            }
        },
        [focusNode]
    )

    // Rename a tab == rename its root node (both read the same name).
    const renameBoard = useCallback((id: string, name: string) => {
        setProjects((prev) => {
            const project = prev[id]
            if (!project) return prev
            const root = project.milestones[project.rootId]
            if (!root) return prev
            return {
                ...prev,
                [id]: { ...project, milestones: { ...project.milestones, [project.rootId]: { ...root, name } } }
            }
        })
    }, [])

    // Remove a tab, activating a neighbour if the active one went away. Root is pinned, and the last
    // tab can't be removed.
    const removeBoard = useCallback(
        (id: string) => {
            if (id === ROOT_ID || order.length <= 1) return
            const index = order.indexOf(id)
            const nextOrder = order.filter((tabId) => tabId !== id)
            setOrder(nextOrder)
            setProjects((prev) => {
                // Reparent the removed view's children to its parent (or Root) so the hub tree stays whole.
                const newParent = prev[id]?.parentId ?? ROOT_ID
                const rest: Record<string, Board> = {}
                for (const [pid, project] of Object.entries(prev)) {
                    if (pid === id) continue
                    rest[pid] = project.parentId === id ? { ...project, parentId: newParent } : project
                }
                return rest
            })
            if (activeId === id) {
                const neighbour = nextOrder[Math.min(index, nextOrder.length - 1)]
                if (neighbour) {
                    setActiveId(neighbour)
                    setSelectedId(projects[neighbour]?.rootId ?? null)
                }
            }
        },
        [order, activeId, projects]
    )

    // Serialize the app's data (not the open tab) for the Export button to download.
    const handleExport = useCallback(
        () => serialize({ projects, order, mirrorPos, tasks, rewards, banked, notes }),
        [projects, order, mirrorPos, tasks, rewards, banked, notes]
    )

    // Replace the whole app from a loaded state -- an imported file or a roadmap synced down from another
    // device. Swaps every slice, resumes the id counters past it, and opens the default tab (first
    // non-Root view, else Root) selected on its root node.
    const applyLoaded = useCallback((loaded: PersistedSlices) => {
        setProjects(loaded.projects)
        setOrder(loaded.order)
        setMirrorPos(loaded.mirrorPos)
        setTasks(loaded.tasks)
        setRewards(loaded.rewards)
        setBanked(loaded.banked)
        setNotes(loaded.notes)
        setEditingNoteId(null)
        setSection("roadmap")
        nextNodeId.current = maxCounter(
            Object.values(loaded.projects).flatMap((project) => Object.keys(project.milestones)),
            "node"
        )
        nextViewId.current = maxCounter(Object.keys(loaded.projects), "board")
        nextTaskId.current = maxCounter(
            loaded.tasks.map((task) => task.id),
            "task"
        )
        nextRewardId.current = maxCounter(
            loaded.rewards.map((reward) => reward.id),
            "reward"
        )
        nextNoteId.current = maxCounter(
            loaded.notes.map((note) => note.id),
            "note"
        )
        const nextActive = loaded.order.find((id) => id !== ROOT_ID && loaded.projects[id]) ?? ROOT_ID
        setActiveId(nextActive)
        setSelectedId(loaded.projects[nextActive]?.rootId ?? null)
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
        () => ({ projects, order, mirrorPos, tasks, rewards, banked, notes }),
        [projects, order, mirrorPos, tasks, rewards, banked, notes]
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
        const project = projects[id]
        const root = project?.milestones[project.rootId]
        return root ? [{ id, name: root.name, pinned: id === ROOT_ID }] : []
    })

    // What the canvas renders for the active tab. On Root, mirror every other view as a read-only
    // node beneath the Root node (a hub); elsewhere it's just the board's own graph.
    const view = useMemo<{
        milestones: Record<string, Node>
        edges: Edge[]
        staticIds: ReadonlySet<string>
        completeIds: ReadonlySet<string>
    }>(() => {
        const rootNode = active?.milestones[active.rootId]
        const others = order.filter((id) => id !== ROOT_ID)
        if (!active || activeId !== ROOT_ID || !rootNode || others.length === 0) {
            return {
                milestones: active?.milestones ?? {},
                edges: active?.edges ?? [],
                staticIds: EMPTY_IDS,
                completeIds: EMPTY_IDS
            }
        }
        const milestones: Record<string, Node> = { ...active.milestones }
        const edges: Edge[] = [...active.edges]
        const staticIds = new Set<string>()
        const completeIds = new Set<string>()

        // Depth in the hub tree (top-level view = 1); the Root's own root node sits at depth 0.
        const depthOf = (pid: string) => {
            let depth = 1
            let cursor = projects[pid]?.parentId
            let guard = 0
            while (cursor && cursor !== ROOT_ID && guard++ < 64) {
                depth++
                cursor = projects[cursor]?.parentId
            }
            return depth
        }

        // Count views per depth so each layer can be centred; a running slot gives each its x.
        const perDepth: Record<number, number> = {}
        const depthByPid: Record<string, number> = {}
        for (const pid of others) {
            const d = depthOf(pid)
            depthByPid[pid] = d
            perDepth[d] = (perDepth[d] ?? 0) + 1
        }
        const usedPerDepth: Record<number, number> = {}
        for (const pid of others) {
            const project = projects[pid]
            const root = project?.milestones[project.rootId]
            if (!root) continue
            const d = depthByPid[pid] ?? 1
            const slot = usedPerDepth[d] ?? 0
            usedPerDepth[d] = slot + 1
            const count = perDepth[d] ?? 1
            const id = `${VIEW_MIRROR_PREFIX}${pid}`
            const dragged = mirrorPos[id]
            milestones[id] = {
                id,
                name: root.name,
                tag: "Linked",
                x: dragged ? dragged.x : rootNode.x + (slot - (count - 1) / 2) * MIRROR_SPACING,
                y: dragged ? dragged.y : rootNode.y + d * TIER_GAP,
                tier: 1,
                branch: "Linked",
                description: root.description,
                reward: root.reward
            }
            // Hang under the parent view's chip, or under the Root node for a top-level view.
            const parentId = project?.parentId
            const source =
                parentId && parentId !== ROOT_ID && projects[parentId]
                    ? `${VIEW_MIRROR_PREFIX}${parentId}`
                    : active.rootId
            edges.push([source, id])
            staticIds.add(id)
            // The view is complete when its own root node is in its completed set.
            if (project?.mastered.has(project.rootId)) completeIds.add(id)
        }
        return { milestones, edges, staticIds, completeIds }
    }, [active, activeId, order, projects, mirrorPos])

    // Freeze each mirror's auto-position the first time it appears. Otherwise its default is computed
    // from the live Root node, so dragging Root would drag every un-moved chip along with it.
    useEffect(() => {
        const unpinned = [...view.staticIds].filter((id) => !mirrorPos[id])
        if (unpinned.length === 0) return
        setMirrorPos((prev) => {
            const next = { ...prev }
            for (const id of unpinned) {
                const milestone = view.milestones[id]
                if (milestone) next[id] = { x: milestone.x, y: milestone.y }
            }
            return next
        })
    }, [view, mirrorPos])

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
    // A selected mirror shows the shared card in view mode; synthesize a node for its name.
    const shownIsView = displayId !== null && displayId.startsWith(VIEW_MIRROR_PREFIX)
    const shown: Node | undefined = (() => {
        if (displayId === null) return undefined
        if (!shownIsView) return active?.milestones[displayId]
        const project = projects[displayId.slice(VIEW_MIRROR_PREFIX.length)]
        const root = project?.milestones[project.rootId]
        return root
            ? {
                  id: displayId,
                  name: root.name,
                  tag: "Linked",
                  x: 0,
                  y: 0,
                  tier: 1,
                  branch: "Linked",
                  description: root.description,
                  reward: root.reward
              }
            : undefined
    })()
    const isRoot = shown ? shown.tier === 0 : false
    // The Root node itself (not a mirror), which also offers "+ Add sub-view".
    const shownIsRootNode = activeId === ROOT_ID && !shownIsView && !!shown && shown.id === active?.rootId
    // Delete wiring for the shown card. The Root's root node: never. View chip or a tab's root node:
    // removes the whole view (removeBoard). A normal node: deletes its own subtree.
    const deleteKind: "milestone" | "view" = shownIsView || (isRoot && !shownIsRootNode) ? "view" : "milestone"
    const canDelete = !!shown && !shownIsRootNode
    const onDeleteShown = !canDelete
        ? undefined
        : deleteKind === "view"
          ? () => removeBoard(shownIsView && displayId ? displayId.slice(VIEW_MIRROR_PREFIX.length) : activeId)
          : deleteSelected
    const deleteDescendantCount =
        canDelete && deleteKind === "milestone" && active && shown ? descendantsOf(shown.id, active.edges).length : 0

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
                            {active && (
                                <BoardTree
                                    key={activeId}
                                    selectedId={selectedId}
                                    onSelect={selectFromCanvas}
                                    mastered={active.mastered}
                                    milestones={view.milestones}
                                    edges={view.edges}
                                    onMove={moveMilestone}
                                    staticNodeIds={view.staticIds}
                                    completeNodeIds={view.completeIds}
                                    focusId={focusId}
                                    focusNonce={focusNonce}
                                />
                            )}
                        </div>
                        {active && shown && (
                            <aside
                                data-detail-card=""
                                className="absolute right-4 top-4 z-20 w-[320px] max-w-[calc(100%-2rem)]"
                            >
                                <NodeDetailCard
                                    key={shown.id}
                                    milestone={shown}
                                    state={stateOf(shown.id, active.mastered, active.edges)}
                                    todos={isRoot ? [] : (active.todos[shown.id] ?? [])}
                                    isRoot={isRoot}
                                    closing={closing}
                                    onToggle={toggleTodo}
                                    onComplete={completeSelected}
                                    onUncomplete={uncompleteSelected}
                                    onEditMilestone={
                                        shownIsView && displayId
                                            ? (patch) => editMirror(displayId, patch)
                                            : editMilestone
                                    }
                                    onEditTodo={editTodo}
                                    onDeleteTodo={deleteTodo}
                                    onAddTodo={addTodo}
                                    onAddChild={addChild}
                                    onAddParent={shownIsRootNode ? undefined : addParent}
                                    onAddSubView={
                                        shownIsView && displayId
                                            ? () => addView(displayId.slice(VIEW_MIRROR_PREFIX.length), false)
                                            : shownIsRootNode
                                              ? () => addView(ROOT_ID, false)
                                              : undefined
                                    }
                                    isView={shownIsView}
                                    earnsGold={!shownIsRootNode}
                                    onView={shownIsView && displayId ? () => openView(displayId) : undefined}
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

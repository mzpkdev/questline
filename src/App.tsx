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
import {
    addScribble as addScribbleToList,
    removeScribble,
    renameScribble as renameScribbleInList,
    type Scribble,
    updateScribbleScene as updateScribbleSceneInList
} from "./scribbles"
import { deserialize, loadState, type PersistedSlices, saveState, serialize } from "./persist"
import { type Board, boardCompleter, boardsReducer, linkedNodeName, linkWouldCycle, type NodeRestore, seedBoard } from "./board"
import { SectionTransition } from "./SectionTransition"
import { useSfx } from "./SfxProvider"
import { SoundToggle } from "./SoundToggle"
import { TabBar } from "./TabBar"
import { SyncBoard } from "./sync/SyncBoard"
import { SyncNavButton } from "./sync/SyncNavButton"
import { useSync } from "./sync/useSync"
import { useDetailCard } from "./useDetailCard"
import { useDismissOnOutside } from "./useDismissOnOutside"

// Lazy so Excalidraw's bundle + CSS only load when the Scribbles tab is opened, not on first paint. Both
// the scribbles wall (ScribblesBoard renders thumbnails via Excalidraw's exporter) and the editor share
// that chunk.
const ScribblesBoard = lazy(() => import("./ScribblesBoard").then((m) => ({ default: m.ScribblesBoard })))
const ScribbleEditor = lazy(() => import("./ScribbleEditor").then((m) => ({ default: m.ScribbleEditor })))

// Node, board, task, reward, and scribble ids are globally unique, minted as `${prefix}-${uuid}`. No
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

// The top-level view: the roadmap board, the Tasks list, the Rewards shop, the Sync screen, or the
// Scribbles wall/editor.
type Section = "roadmap" | "tasks" | "rewards" | "sync" | "scribbles"

// The tab + node to open on first render, seeded from the URL hash if it points at a known board/node,
// else the first board with nothing selected (the canvas fits the whole tree).
type Boot = {
    boards: Record<string, Board>
    order: string[]
    tasks: Task[]
    rewards: Reward[]
    banked: Banked
    scribbles: Scribble[]
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
    // Scribbles start empty (no tutorial seed); an existing save loads whatever it had.
    const scribbles = loaded?.scribbles ?? []
    // Fold any task/reward already past its 14-day window into the banked totals and drop it, so storage
    // stays small across reloads while the balance (banked + live) is unchanged.
    const { tasks, rewards, banked } = compact(
        rawTasks,
        rawRewards,
        loaded?.banked ?? { earned: 0, spent: 0 },
        Date.now()
    )
    const base = { boards, order, tasks, rewards, banked, scribbles }

    const resolved = resolveHash(window.location.hash.slice(1), boards)
    if (resolved) return { ...base, activeId: resolved.boardId, selectedId: resolved.nodeId, hadHash: true }
    // No hash: open the first board with nothing selected (the canvas fits the whole tree by default).
    return { ...base, activeId: order[0] ?? "", selectedId: null, hadHash: false }
}

// Dismiss-on-outside allowlists for the three detail cards, module-level so each array keeps one stable
// reference across renders (useDismissOnOutside takes it as an effect dependency).
const NODE_DISMISS_SELECTORS = [
    "[data-detail-card]",
    ".react-flow__node",
    ".react-flow__controls",
    "[data-tabbar]",
    '[role="alertdialog"]'
]
const TASK_DISMISS_SELECTORS = [
    "[data-task-detail-card]",
    "[data-task-tile]",
    "[data-add-task-trigger]",
    "[data-tabbar]",
    '[role="alertdialog"]'
]
const REWARD_DISMISS_SELECTORS = [
    "[data-reward-detail-card]",
    "[data-reward-id]",
    "[data-add-reward-trigger]",
    "[data-tabbar]",
    '[role="alertdialog"]'
]

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
    // An attach in flight: the id of the node being re-hung (it carries its whole subtree). Reached two
    // ways -- the "Detach" gesture (which PERSISTS the edge removal first, so the branch is already a
    // parked orphan while armed) and the "Attach" gesture on an already-parked orphan. Purely transient
    // UI: arming/cancelling is never persisted; only a completed attach dispatches the pure `reparent`
    // op. Cancelling does NOT revert -- the (already-persisted) detach stands, leaving the branch parked
    // and disabled ("detached") until re-attached. One at a time -- arming dismisses the card, and while
    // armed a node click attaches instead of selecting, so no second node's card is reachable.
    const [reparenting, setReparenting] = useState<{ nodeId: string } | null>(null)
    // A node's pre-linked data, kept per node id so converting it back from linked this session refills
    // its old name / description / reward / checklist. A ref (no re-render), transient, never persisted:
    // a reload starts fresh, and convert-back then falls to the blank default.
    const prevNodeData = useRef(new Map<string, NodeRestore>())
    // The app-level Tasks checklist (one flat list shared across every tab) and which top-level
    // section is on screen: the roadmap board, the Tasks list, or the Rewards shop.
    const [tasks, setTasks] = useState<Task[]>(boot.tasks)
    // The Rewards shelf. Gold isn't stored: it's earned from roadmap completion minus the price of
    // each redeemed reward (computed below).
    const [rewards, setRewards] = useState<Reward[]>(boot.rewards)
    // Gold earned/spent by tasks and rewards pruned past their 14-day window (folded in at load by
    // compact()). Added to the live sums so the balance is unchanged by that compaction.
    const [banked, setBanked] = useState<Banked>(boot.banked)
    // The Scribbles wall: standalone Excalidraw scribbles. `editingScribbleId` picks the scribble open in
    // the full editor; null shows the masonry grid of all scribbles.
    const [scribbles, setScribbles] = useState<Scribble[]>(boot.scribbles)
    const [editingScribbleId, setEditingScribbleId] = useState<string | null>(null)
    // The just-added scribble, ringed briefly on the wall so a new card is easy to spot.
    const [highlightScribbleId, setHighlightScribbleId] = useState<string | null>(null)
    const [section, setSection] = useState<Section>("roadmap")
    // The roadmap node's detail card -- selection / display / edit-on-add lifecycle, closing outright
    // when the roadmap section isn't on screen (see useDetailCard; the task and reward cards below share
    // the exact same shape). Only this card boots pre-selected, from a URL hash.
    const nodeCard = useDetailCard("roadmap", section, boot.selectedId)
    const { selectedId, displayId, editOnAddId, closing } = nodeCard
    // The Tasks list's detail card -- same lifecycle as the node card above, scoped to the Tasks view.
    const taskCard = useDetailCard("tasks", section)
    const { selectedId: selectedTaskId, displayId: displayTaskId, editOnAddId: editOnAddTaskId, closing: taskClosing } = taskCard
    // The Rewards shelf's detail card -- same lifecycle again, scoped to the Rewards view.
    const rewardCard = useDetailCard("rewards", section)
    const { selectedId: selectedRewardId, displayId: displayRewardId, editOnAddId: editOnAddRewardId, closing: rewardClosing } = rewardCard
    // Link mode: set while the Scribbles wall is being used to attach a scribble back to a node. Holds
    // the target (board + node) the picked or freshly-drawn scribble links to. Entered from a node card's
    // "Add scribble"; cleared on leaving the Scribbles view. null outside link mode = the wall behaves
    // normally.
    const [linkTarget, setLinkTarget] = useState<{ boardId: string; nodeId: string } | null>(null)
    // The section on screen at first load appears instantly; every section entered afterward plays the
    // SectionTransition fade + rise. Flipped off just after the initial mount (below).
    const firstSectionRef = useRef(true)
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

    // Initial mount is done: from here on, a section change remounts SectionTransition (keyed by
    // section) and plays its entrance.
    useEffect(() => {
        firstSectionRef.current = false
    }, [])

    // Leaving the Scribbles view drops back to the wall and ends any link-mode session, so re-entering
    // never reopens a stale editor or resumes a stale link.
    useEffect(() => {
        if (section !== "scribbles") {
            setEditingScribbleId(null)
            setLinkTarget(null)
        }
    }, [section])

    // Fade the new-scribble highlight ring shortly after it's added.
    useEffect(() => {
        if (highlightScribbleId === null) return
        const timer = setTimeout(() => setHighlightScribbleId(null), 1600)
        return () => clearTimeout(timer)
    }, [highlightScribbleId])

    // Dismiss a detail card on Escape or a click outside it (but not on its own tile / add-trigger, the
    // tab bar, or a confirm dialog). The roadmap node, the Tasks card, and the Rewards card all share the
    // same wiring here -- just a different allowlist per card (see useDismissOnOutside).
    useDismissOnOutside({
        active: selectedId !== null,
        selectors: NODE_DISMISS_SELECTORS,
        escape: true,
        onDismiss: nodeCard.close
    })
    useDismissOnOutside({
        active: selectedTaskId !== null,
        selectors: TASK_DISMISS_SELECTORS,
        escape: true,
        onDismiss: taskCard.close
    })
    useDismissOnOutside({
        active: selectedRewardId !== null,
        selectors: REWARD_DISMISS_SELECTORS,
        escape: true,
        onDismiss: rewardCard.close
    })

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
        nodeCard.select(resolved.nodeId)
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
        const timer = setTimeout(() => saveState({ boards, boardOrder: order, tasks, rewards, banked, scribbles }), 400)
        return () => clearTimeout(timer)
    }, [boards, order, tasks, rewards, banked, scribbles])

    // Select a node and pan the canvas onto it; the URL hash follows the selection.
    const focusNode = useCallback((id: string) => {
        nodeCard.select(id)
        setFocusId(id)
        setFocusNonce((n) => n + 1)
    }, [])

    // A click on any canvas node: a subtle selection tick, then select it.
    const selectFromCanvas = useCallback(
        (id: string) => {
            sfx.tick()
            nodeCard.select(id)
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
        taskCard.openForAdd(id)
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
    const selectTask = useCallback((id: string) => taskCard.select(id), [])
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
            taskCard.close()
        },
        [tasks]
    )

    // Rewards: open the shop, and add / redeem / remove its rewards. One global shelf, so these never
    // touch the active board. Redeeming is a one-off buy: it stamps the reward's `redeemedAt` (when the
    // balance covers the price), which spends the gold and starts the 14-day shelf window.
    const openRewards = useCallback(() => setSection("rewards"), [])
    // The Scribbles wall. Opening it always lands on the grid (never straight into a scribble); a new
    // scribble opens its blank canvas at once. Renames and scene edits patch the one flat scribbles list
    // (never a board).
    const openScribbles = useCallback(() => {
        setEditingScribbleId(null)
        setSection("scribbles")
    }, [])
    // End a link-mode session (see startLinkScribble) and return to the node it began from -- its
    // board active, that node selected -- whether the scribble was picked, freshly drawn, or cancelled.
    const returnToLinkTarget = useCallback(() => {
        if (!linkTarget) return
        setActiveId(linkTarget.boardId)
        nodeCard.select(linkTarget.nodeId)
        setLinkTarget(null)
        setSection("roadmap")
    }, [linkTarget])
    // Click a wall card: normally opens it in the editor. In link mode it instead attaches that existing
    // scribble to the target node and returns there (no editor) -- the "pick existing" half of the flow.
    const openScribble = useCallback(
        (id: string) => {
            if (linkTarget) {
                dispatch({ type: "linkScribble", boardId: linkTarget.boardId, id: linkTarget.nodeId, scribbleId: id })
                returnToLinkTarget()
                return
            }
            setEditingScribbleId(id)
        },
        [linkTarget, returnToLinkTarget]
    )
    // The editor's Back: normally returns to the wall. In link mode (a just-drawn new scribble) it returns
    // to the node the scribble was attached to instead.
    const backToScribbles = useCallback(() => {
        if (linkTarget) {
            returnToLinkTarget()
            return
        }
        setEditingScribbleId(null)
    }, [linkTarget, returnToLinkTarget])
    // The wall's + : mint an empty scribble (newest first) and drop straight into its blank canvas, so a
    // new scribble is one click from the editor. In link mode it also attaches the fresh scribble to the
    // target node before opening, so the editor's Back returns there. Still ringed on the wall for a
    // quick back-out. The section is already the Scribbles view (the + only renders there).
    const addScribble = useCallback(() => {
        const id = mintId("scribble")
        setScribbles((prev) => addScribbleToList(prev, id, Date.now()))
        if (linkTarget) dispatch({ type: "linkScribble", boardId: linkTarget.boardId, id: linkTarget.nodeId, scribbleId: id })
        setEditingScribbleId(id)
        setHighlightScribbleId(id)
    }, [linkTarget])
    const renameScribble = useCallback(
        (id: string, title: string) => setScribbles((prev) => renameScribbleInList(prev, id, title)),
        []
    )
    const updateScribbleScene = useCallback(
        (id: string, scene: Scribble["scene"]) => setScribbles((prev) => updateScribbleSceneInList(prev, id, scene, Date.now())),
        []
    )
    const deleteScribble = useCallback((id: string) => {
        setScribbles((prev) => removeScribble(prev, id))
        // Sweep the deleted scribble off every node that linked it, so no node keeps a dangling
        // reference (the render-time filter in `linkedScribbles` guards imported / synced data too).
        dispatch({ type: "pruneScribble", scribbleId: id })
        setEditingScribbleId((current) => (current === id ? null : current))
    }, [])
    // Open a scribble linked to a node: jump to the Scribbles view AND straight into that scribble's
    // canvas. A node-card chip (and a just-minted scribble) both route here; `openScribble` alone can't,
    // since it doesn't switch section, so this pairs the section switch with the open.
    const openScribbleFromNode = useCallback((scribbleId: string) => {
        setSection("scribbles")
        setEditingScribbleId(scribbleId)
    }, [])
    // The shelf's + tile creates a default reward on the spot, selects it, and opens its card in edit
    // mode so the name/price are editable at once (mirrors adding a task or a node).
    const addRewardDefault = useCallback(() => {
        const id = mintId("reward")
        setRewards((prev) => addReward(prev, id, DEFAULT_REWARD_NAME, DEFAULT_REWARD_PRICE))
        rewardCard.openForAdd(id)
    }, [])
    // Open a reward's detail card, and edit its name / price / replenish in place. Deleting from the card
    // removes the reward and closes the card.
    const selectReward = useCallback((id: string) => rewardCard.select(id), [])
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
            rewardCard.close()
        },
        [rewards]
    )
    // Un-redeem a reward: clears its redeemedAt, so the spend drops out and the gold returns.
    const unredeemRewardItem = useCallback((id: string) => setRewards((prev) => unredeem(prev, id)), [])
    // Mint an id up front for a possible replenished copy; redeem uses it only when the reward restocks.
    // Ids are random UUIDs (no counters), so a minted-but-unused id is simply discarded, not a gap left
    // in some sequence.
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

    // Delete just the selected node (its children are orphaned into "detached", not removed), then move
    // selection to its parent so the card shows something valid (every non-root node has a parent; fall
    // back to clearing). The root node is never deleted here -- that path removes the whole board via
    // removeBoard.
    const deleteSelected = useCallback(() => {
        if (selectedId === null || !active) return
        const parent = parentOf(selectedId, active.edges)
        dispatch({ type: "deleteNode", boardId: activeId, id: selectedId })
        // Move selection to the parent so the card stays valid, but DON'T focusNode it -- centering would
        // jump the viewport. Deleting keeps the current pan / zoom.
        nodeCard.select(parent)
    }, [selectedId, active, activeId])

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
        nodeCard.armEditOnAdd(childId)
        focusNode(childId)
    }, [selectedId, activeId, focusNode])

    // Add a parent above the selected node. Above the root node the new node becomes the tier-0 gold
    // root, the old root drops to a normal node beneath it, and every existing node shifts down a tier;
    // the tab label follows the root name, so it flips to the new node instantly.
    const addParent = useCallback(() => {
        if (selectedId === null) return
        const newId = mintId("node")
        dispatch({ type: "addParent", boardId: activeId, targetId: selectedId, newId })
        nodeCard.armEditOnAdd(newId)
        focusNode(newId)
    }, [selectedId, activeId, focusNode])

    // Cancel an in-flight attach (Escape / empty canvas / clicking the lifted node): just disarm. The
    // detach was already persisted, so this does NOT revert -- the branch stays parked (a disabled
    // "detached" orphan) until the user re-attaches it. Stable no-op when nothing is armed.
    const cancelReparent = useCallback(() => {
        setReparenting(null)
    }, [])

    // Detach the selected node: cut it (with its whole subtree) off its parent for real, then arm
    // attach-mode so it can be re-hung right away. The edge removal is dispatched NOW (persisted), so the
    // branch immediately reads "detached"; dismissing the card leaves the loose edge trailing the
    // pointer. If the user cancels without attaching, the branch simply stays parked.
    const detachSelected = useCallback(() => {
        if (selectedId === null || !active) return
        if (parentOf(selectedId, active.edges) === null) return // root / already-parentless: nothing to detach
        dispatch({ type: "detach", boardId: activeId, id: selectedId })
        setReparenting({ nodeId: selectedId })
        nodeCard.close()
    }, [selectedId, active, activeId])

    // Attach (re-home) the selected node: it's already a parked orphan (detached earlier), so this just
    // arms attach-mode -- no detach to dispatch -- and dismisses the card. Clicking a valid target then
    // re-hangs it through the same attachTo path as a fresh detach.
    const attachSelected = useCallback(() => {
        if (selectedId === null) return
        setReparenting({ nodeId: selectedId })
        nodeCard.close()
    }, [selectedId])

    // Attach the reparenting node under a clicked target. Valid = a node in this board that is reachable
    // from the root (so you can only re-home under the live tree, never under another parked branch) and
    // is neither the node itself nor one of its descendants (attaching under its own subtree would cycle
    // -- the pure `reparent` op rejects that too). Clicking the node itself cancels; a descendant or an
    // unreachable node is ignored (stays armed); a valid target commits the move and re-selects it.
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

    // While an attach is armed, Escape or a click on empty canvas cancels the arm (the branch stays
    // parked -- no revert). A click on a NODE attaches instead (BoardTree's onNodeClick -> attachTo), so
    // node / control / tab / card / dialog targets are left alone here. This listens on `click`, not
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
        // Defer the click listener by one task: the very click that armed this mode (the Detach / Attach
        // button, bubbling to document) would otherwise land on a listener attached mid-dispatch and
        // cancel the mode it just armed. Escape can bind synchronously.
        const armTimer = setTimeout(() => document.addEventListener("click", onClick), 0)
        document.addEventListener("keydown", onKeyDown)
        return () => {
            clearTimeout(armTimer)
            document.removeEventListener("click", onClick)
            document.removeEventListener("keydown", onKeyDown)
        }
    }, [reparenting, cancelReparent])

    // Switching boards or leaving the roadmap disarms any in-flight attach: its node lives on the board
    // (and section) we're leaving, so the loose edge shouldn't follow us. Disarming is not a revert --
    // an already-detached branch just stays parked on its board until the user returns to re-attach it.
    useEffect(() => {
        setReparenting(null)
    }, [activeId, section])

    // Convert the selected node in place into an (unlinked) linked node (its checklist / reward are
    // dropped -- the card confirms first). Selection stays on the node, whose card flips to the linked
    // layout so its target board can be picked from the dropdown.
    const convertToLinked = useCallback(() => {
        if (selectedId === null || !active) return
        // Snapshot the node's pre-linked data (name / description / reward / checklist) so a convert-back
        // this session refills it instead of the blank default. Transient (a ref), never persisted.
        const node = active.nodes[selectedId]
        if (node) {
            prevNodeData.current.set(selectedId, {
                name: node.name,
                description: node.description,
                reward: node.reward,
                todos: active.todos[selectedId] ?? []
            })
        }
        dispatch({ type: "convertToLinked", boardId: activeId, id: selectedId })
    }, [selectedId, active, activeId])

    // Convert the selected linked node back into a regular node. If it was turned linked this session,
    // the stashed snapshot refills its old data; otherwise it gets the blank default. Selection stays;
    // its card flips back to the regular layout. Not destructive, so no confirm.
    const convertToRegular = useCallback(() => {
        if (selectedId === null) return
        dispatch({
            type: "convertToRegular",
            boardId: activeId,
            id: selectedId,
            restore: prevNodeData.current.get(selectedId)
        })
    }, [selectedId, activeId])

    // Point the selected linked node at a board (or clear it back to unlinked with null).
    const setLinkedTarget = useCallback(
        (boardId: string | null) => {
            if (selectedId === null) return
            dispatch({ type: "setLinkedTarget", boardId: activeId, id: selectedId, targetBoardId: boardId })
        },
        [selectedId, activeId]
    )

    // Scribbles on the selected node. Unlink drops one from the node (the chip's × in edit mode).
    // Add scribble opens the Scribbles wall in "link mode" bound to this node: picking an existing scribble
    // links it (openScribble), a new one links + opens the editor (addScribble), and either way the wall
    // returns here (returnToLinkTarget). Both key on the selected node (a no-op while nothing's selected);
    // the card offers them only on a regular / root node.
    const unlinkScribble = useCallback(
        (scribbleId: string) => {
            if (selectedId === null) return
            dispatch({ type: "unlinkScribble", boardId: activeId, id: selectedId, scribbleId })
        },
        [selectedId, activeId]
    )
    const startLinkScribble = useCallback(() => {
        if (selectedId === null) return
        setLinkTarget({ boardId: activeId, nodeId: selectedId })
        setEditingScribbleId(null)
        setSection("scribbles")
    }, [selectedId, activeId])

    // Switch to another tab, selecting its root node so the card shows something valid immediately.
    const switchBoard = useCallback(
        (id: string) => {
            setSection("roadmap")
            setActiveId(id)
            nodeCard.select(boards[id]?.rootId ?? null)
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
        nodeCard.armEditOnAdd(rootId)
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
                    nodeCard.select(boards[neighbour]?.rootId ?? null)
                } else {
                    setActiveId("")
                    nodeCard.select(null)
                }
            }
        },
        [order, activeId, boards]
    )

    // Serialize the app's data (not the open tab) for the Export button to download.
    const handleExport = useCallback(
        () => serialize({ boards, boardOrder: order, tasks, rewards, banked, scribbles }),
        [boards, order, tasks, rewards, banked, scribbles]
    )

    // Replace the whole app from a loaded state -- an imported file or a roadmap synced down from another
    // device. Swaps every slice and opens the first board selected on its root node.
    const applyLoaded = useCallback((loaded: PersistedSlices) => {
        dispatch({ type: "replace", boards: loaded.boards, order: loaded.boardOrder })
        setTasks(loaded.tasks)
        setRewards(loaded.rewards)
        setBanked(loaded.banked)
        setScribbles(loaded.scribbles)
        setEditingScribbleId(null)
        setSection("roadmap")
        const nextActive = loaded.boardOrder[0] ?? ""
        setActiveId(nextActive)
        nodeCard.select(loaded.boards[nextActive]?.rootId ?? null)
    }, [])

    // Replace the whole app from an imported file. Invalid input is rejected with a themed confirm dialog
    // (below, near the render's other one-off dialogs) and changes nothing; a valid file is applied like
    // any loaded state.
    const [importError, setImportError] = useState(false)
    const handleImport = useCallback(
        (json: string) => {
            const loaded = deserialize(json)
            if (!loaded) {
                setImportError(true)
                return
            }
            applyLoaded(loaded)
        },
        [applyLoaded]
    )

    // Cross-device sync: opt-in, end-to-end encrypted, and inert unless VITE_SYNC_URL is set at build.
    // It reads the same slices the autosave persists and applies an incoming roadmap through applyLoaded.
    const syncSlices = useMemo<PersistedSlices>(
        () => ({ boards, boardOrder: order, tasks, rewards, banked, scribbles }),
        [boards, order, tasks, rewards, banked, scribbles]
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

    // The reward backing the open reward detail card, keyed off the trailing displayRewardId (looked up
    // in the full list so a redeemed one within its TTL still resolves). Absent once deleted, unmounting
    // the card immediately.
    const displayedReward =
        displayRewardId !== null ? rewards.find((reward) => reward.id === displayRewardId) : undefined

    // The node backing the open detail card. Kind is positional: the root node is the one whose id is
    // the board's rootId; a linked node carries the targetBoardId key; otherwise it's a regular node.
    // Deleting the root removes the whole board; any other node removes its own subtree.
    const shown: Node | undefined = displayId !== null ? active?.nodes[displayId] : undefined
    const isRoot = !!shown && !!active && shown.id === active.rootId
    const isLinked = !!shown && isLinkedNode(shown)
    // Whether the shown node still hangs on the tree. A non-root node with a parent offers Detach; a
    // parked orphan (no parent) offers Attach instead; the root offers neither (it has no parent).
    const shownHasParent = !!shown && !!active && parentOf(shown.id, active.edges) !== null
    const deleteKind: "node" | "board" = isRoot ? "board" : "node"
    const onDeleteShown = !shown ? undefined : isRoot ? () => removeBoard(activeId) : deleteSelected
    const deleteDescendantCount = shown && !isRoot && active ? descendantsOf(shown.id, active.edges).length : 0
    // Linked-node card inputs (meaningful only when isLinked): the live-mirrored display name, and the
    // dropdown of every OTHER board (self -- the active board -- excluded).
    const linkedName = shown && isLinked ? linkedNodeName(boards, shown.targetBoardId) : ""
    // Offer every other board as a link target EXCEPT ones that would cycle the board-link graph (self,
    // or a board that already links back to this one) -- a cyclic link leaves both boards uncompletable.
    const linkedBoardOptions = isLinked ? tabs.filter((tab) => !linkWouldCycle(boards, activeId, tab.id)) : []

    // Scribbles linked to the shown node, resolved to live scribbles -- dangling ids (a scribble deleted
    // from the wall) drop out here, the render-time half of the guard pruneScribble handles on delete.
    // Only a regular / root node carries scribbles; a linked node never does.
    const shownScribbleIds = shown && !isLinked ? (shown.scribbleIds ?? []) : []
    const linkedScribbles = shownScribbleIds
        .map((id) => scribbles.find((scribble) => scribble.id === id))
        .filter((scribble): scribble is Scribble => scribble !== undefined)
        .map((scribble) => ({ id: scribble.id, title: scribble.title }))
    // In link mode, the wall's banner names the node the picked / new scribble will attach to.
    const linkTargetName = linkTarget ? (boards[linkTarget.boardId]?.nodes[linkTarget.nodeId]?.name ?? "") : ""

    // The scribble open in the editor (null → show the wall). A deleted id resolves to undefined, which
    // falls back to the wall.
    const editingScribble = editingScribbleId !== null ? scribbles.find((scribble) => scribble.id === editingScribbleId) : undefined

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
                        onOpenScribbles={openScribbles}
                        scribblesActive={section === "scribbles"}
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
                                    onExited={taskCard.clearDisplay}
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
                                    onExited={rewardCard.clearDisplay}
                                />
                            </aside>
                        ) : null}
                    </>
                ) : section === "sync" ? (
                    <div className="themed-scroll absolute inset-0 z-10 overflow-auto">
                        <SyncBoard sync={sync} />
                    </div>
                ) : section === "scribbles" ? (
                    <Suspense
                        fallback={
                            <div className="absolute inset-0 z-10 grid place-items-center text-[15px] italic text-[#a2916c]">
                                Loading canvas...
                            </div>
                        }
                    >
                        {editingScribble ? (
                            <ScribbleEditor
                                key={editingScribble.id}
                                scribble={editingScribble}
                                onChange={(scene) => updateScribbleScene(editingScribble.id, scene)}
                                onRename={(title) => renameScribble(editingScribble.id, title)}
                                onBack={backToScribbles}
                                onDelete={() => deleteScribble(editingScribble.id)}
                            />
                        ) : (
                            <div className="themed-scroll absolute inset-0 z-10 overflow-auto">
                                <ScribblesBoard
                                    scribbles={scribbles}
                                    onOpen={openScribble}
                                    onAdd={addScribble}
                                    onRename={renameScribble}
                                    highlightId={highlightScribbleId}
                                    linkMode={linkTarget !== null}
                                    linkTargetName={linkTargetName}
                                    onCancelLink={returnToLinkTarget}
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
                                    state={stateOf(shown.id, active.mastered, active.edges, active.nodes, isBoardComplete, active.rootId)}
                                    todos={isRoot || isLinked ? [] : (active.todos[shown.id] ?? [])}
                                    isRoot={isRoot}
                                    isLinked={isLinked}
                                    linkedName={linkedName}
                                    boardOptions={linkedBoardOptions}
                                    targetBoardId={shown.targetBoardId ?? null}
                                    onSetLinkedTarget={setLinkedTarget}
                                    onGoToBoard={goToBoard}
                                    linkedScribbles={linkedScribbles}
                                    onOpenScribble={openScribbleFromNode}
                                    onUnlinkScribble={isLinked ? undefined : unlinkScribble}
                                    onAddScribble={isLinked ? undefined : startLinkScribble}
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
                                    onConvertToLinked={isRoot || isLinked ? undefined : convertToLinked}
                                    onConvertToRegular={isLinked ? convertToRegular : undefined}
                                    onDetach={isRoot || !shownHasParent ? undefined : detachSelected}
                                    onAttach={isRoot || shownHasParent ? undefined : attachSelected}
                                    onDelete={onDeleteShown}
                                    deleteKind={deleteKind}
                                    descendantCount={deleteDescendantCount}
                                    initialEditing={shown.id === editOnAddId}
                                    onExited={nodeCard.clearDisplay}
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
            <ConfirmDialog
                open={importError}
                title="Could not import"
                message={<>That file isn't a valid Questline export, so nothing was changed.</>}
                confirmLabel="Got it"
                onConfirm={() => setImportError(false)}
                onOpenChange={(open) => {
                    if (!open) setImportError(false)
                }}
            />
        </div>
    )
}

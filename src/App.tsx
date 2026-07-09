import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { addTask, type Task, remove, reorder, SEED_TASKS, toggle, visible } from "./tasks"
import { TasksBoard } from "./TasksBoard"
import { Corners } from "./Corners"
import { DetailCard } from "./DetailCard"
import { GoalCelebration } from "./GoalCelebration"
import { complete, descendantsOf, parentOf, stateOf, uncomplete } from "./graph"
import { IoButtons } from "./IoButtons"
import {
    addReward,
    earnedGold,
    redeem,
    removeReward,
    type Reward,
    SEED_REWARDS,
    spentGold,
    visible as visibleRewards
} from "./rewards"
import { AddRewardCard, RewardsBoard } from "./RewardsBoard"
import { MilestoneTree } from "./MilestoneTree"
import type { Milestone, MilestoneEdge } from "./milestones"
import { NavActions } from "./NavActions"
import { deserialize, loadState, maxCounter, type PersistedSlices, saveState, serialize } from "./persist"
import { deleteMilestone, newProject, type Project, ROOT_ID, rootProject, seedProject } from "./project"
import { SectionTransition } from "./SectionTransition"
import { useSfx } from "./SfxProvider"
import { SoundToggle } from "./SoundToggle"
import { TabBar } from "./TabBar"
import { SyncBoard } from "./sync/SyncBoard"
import { SyncNavButton } from "./sync/SyncNavButton"
import { useSync } from "./sync/useSync"

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
    projects: Record<string, Project>
    order: string[]
    mirrorPos: Record<string, { x: number; y: number }>
    tasks: Task[]
    rewards: Reward[]
    activeId: string
    selectedId: string | null
    nextNodeId: number
    nextViewId: number
    nextTaskId: number
    nextRewardId: number
    hadHash: boolean
}
function computeBoot(): Boot {
    // Restore the autosaved data if present; otherwise start from Root + the bundled sample.
    const loaded = loadState()
    const projects = loaded?.projects ?? { [ROOT_ID]: rootProject(), seed: seedProject() }
    const order = loaded?.order ?? [ROOT_ID, "seed"]
    const mirrorPos = loaded?.mirrorPos ?? {}
    // Tasks and rewards seed only on a truly fresh start (no saved state at all); an existing save
    // from before these views simply had none, and loads empty rather than re-seeding.
    const tasks = loaded?.tasks ?? SEED_TASKS
    const rewards = loaded?.rewards ?? SEED_REWARDS
    // Counters resume past whatever ids the loaded/seed data already uses.
    const nextNodeId = maxCounter(
        Object.values(projects).flatMap((project) => Object.keys(project.milestones)),
        "node"
    )
    const nextViewId = maxCounter(Object.keys(projects), "view")
    const nextTaskId = maxCounter(
        tasks.map((task) => task.id),
        "task"
    )
    const nextRewardId = maxCounter(
        rewards.map((reward) => reward.id),
        "reward"
    )
    const base = {
        projects,
        order,
        mirrorPos,
        tasks,
        rewards,
        nextNodeId,
        nextViewId,
        nextTaskId,
        nextRewardId
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
    // Each tab is a Project (its own roadmap). `order` fixes tab order; `activeId` picks the visible
    // one. Root is the pinned first tab; the sample roadmap follows. Initial tab/selection come from
    // the URL hash when it names a known node.
    const bootRef = useRef<Boot | null>(null)
    const boot = (bootRef.current ??= computeBoot())
    // The synthesized SFX kit, stable for the app's lifetime. Effects fire from the handlers below and
    // from the goal-celebration effect -- never from render or from inside a state updater.
    const sfx = useSfx()
    const [projects, setProjects] = useState<Record<string, Project>>(boot.projects)
    const [order, setOrder] = useState<string[]>(boot.order)
    const [activeId, setActiveId] = useState(boot.activeId)
    // `selectedId` is the intent (null once dismissed); `displayId` is what the card shows and trails
    // `selectedId` on dismissal so the exit animation can play before the card unmounts.
    const [selectedId, setSelectedId] = useState<string | null>(boot.selectedId)
    const [displayId, setDisplayId] = useState<string | null>(boot.selectedId)
    // Dragged positions of Root's mirror nodes, keyed by mirror id. Mirrors are otherwise derived, so
    // their layout lives here rather than in any project.
    const [mirrorPos, setMirrorPos] = useState<Record<string, { x: number; y: number }>>(boot.mirrorPos)
    // The app-level Tasks checklist (one flat list shared across every tab) and which top-level
    // section is on screen: the roadmap board, the Tasks list, or the Rewards shop.
    const [tasks, setTasks] = useState<Task[]>(boot.tasks)
    // The Rewards shelf. Gold isn't stored: it's earned from roadmap completion minus the price of
    // each redeemed reward (computed below), clamped at zero.
    const [rewards, setRewards] = useState<Reward[]>(boot.rewards)
    const [section, setSection] = useState<"roadmap" | "tasks" | "rewards" | "sync">("roadmap")
    // The section on screen at first load appears instantly; every section entered afterward plays the
    // SectionTransition fade + rise. Flipped off just after the initial mount (below).
    const firstSectionRef = useRef(true)
    // The "New reward" card, shown in the same top-right aside as the milestone detail card. `open` is
    // the intent; `shown` trails it so the exit animation can play before the card unmounts (mirrors
    // selectedId / displayId).
    const [addRewardOpen, setAddRewardOpen] = useState(false)
    const [addRewardShown, setAddRewardShown] = useState(false)
    // A node to pan the canvas onto; the nonce (re)triggers centering on URL navigation.
    const [focusId, setFocusId] = useState(boot.hadHash ? (boot.selectedId ?? "") : "")
    const [focusNonce, setFocusNonce] = useState(boot.hadHash ? 1 : 0)
    // Monotonic sources of unique ids for new tabs and new nodes.
    const nextViewId = useRef(boot.nextViewId)
    const nextNodeId = useRef(boot.nextNodeId)
    const nextTaskId = useRef(boot.nextTaskId)
    const nextRewardId = useRef(boot.nextRewardId)
    // Fires the finale fanfare when the active tab's goal crosses into complete, anchored on that
    // goal node. Tracked per tab (seeded on first sight) so switching onto an already-done goal
    // doesn't fire; the burst carries the goal's board-relative centre + a nonce to (re)play.
    const boardRef = useRef<HTMLDivElement>(null)
    const goalDoneRef = useRef<Record<string, boolean>>({})
    const [burst, setBurst] = useState<{ x: number; y: number; nonce: number } | null>(null)

    const active = projects[activeId]

    // Gold in the purse: earned from progress (checklist boxes, tasks, milestones, goals) minus
    // what's been spent, floored at zero so un-completing work after a spend just empties the purse
    // rather than going negative.
    const gold = useMemo(
        () => Math.max(0, earnedGold(projects, tasks) - spentGold(rewards)),
        [projects, tasks, rewards]
    )

    useEffect(() => {
        if (!active) return
        const done = active.mastered.has(active.goalId)
        const seen = goalDoneRef.current[activeId]
        goalDoneRef.current[activeId] = done
        if (seen !== false || !done) return
        // Anchor on the goal node's on-screen centre (its card carries data-id + data-state), falling
        // back to the upper-centre of the board if it can't be found.
        const board = boardRef.current
        const rect = board?.getBoundingClientRect()
        const node = board?.querySelector(`[data-id="${active.goalId}"][data-state]`)?.getBoundingClientRect()
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

    // Initial mount is done: from here on, a section change remounts SectionTransition (keyed by
    // section) and plays its entrance.
    useEffect(() => {
        firstSectionRef.current = false
    }, [])

    // Reveal the add-reward card on open; leaving the Rewards view discards it outright.
    useEffect(() => {
        if (addRewardOpen) setAddRewardShown(true)
    }, [addRewardOpen])
    useEffect(() => {
        if (section !== "rewards") {
            setAddRewardOpen(false)
            setAddRewardShown(false)
        }
    }, [section])

    // Dismiss the add-reward card on Escape or a click outside it (but not on the + trigger, which
    // toggles it), mirroring how the milestone detail card is dismissed.
    useEffect(() => {
        if (!addRewardShown) return
        const onPointerDown = (event: PointerEvent) => {
            const target = event.target as Element | null
            if (target?.closest("[data-add-reward-card]") || target?.closest("[data-add-reward-trigger]")) return
            setAddRewardOpen(false)
        }
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Escape") setAddRewardOpen(false)
        }
        document.addEventListener("pointerdown", onPointerDown)
        document.addEventListener("keydown", onKeyDown)
        return () => {
            document.removeEventListener("pointerdown", onPointerDown)
            document.removeEventListener("keydown", onKeyDown)
        }
    }, [addRewardShown])

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
                target?.closest("[data-view-popover]") ||
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

    // Apply a change to the active project only, keeping the reference stable on a no-op edit.
    const updateActive = useCallback(
        (fn: (project: Project) => Project) => {
            setProjects((prev) => {
                const project = prev[activeId]
                if (!project) return prev
                const next = fn(project)
                return next === project ? prev : { ...prev, [activeId]: next }
            })
        },
        [activeId]
    )

    // Autosave the app's data (not the open tab) 400ms after the last change, so a drag — which
    // fires moveMilestone rapidly — coalesces into a single write.
    useEffect(() => {
        const timer = setTimeout(() => saveState({ projects, order, mirrorPos, tasks, rewards }), 400)
        return () => clearTimeout(timer)
    }, [projects, order, mirrorPos, tasks, rewards])

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
    const addTaskItem = useCallback((text: string) => {
        nextTaskId.current += 1
        setTasks((prev) => addTask(prev, `task-${nextTaskId.current}`, text))
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
    const removeTask = useCallback((id: string) => setTasks((prev) => remove(prev, id)), [])
    const reorderTask = useCallback(
        (activeId: string, overId: string) => setTasks((prev) => reorder(prev, activeId, overId)),
        []
    )

    // Rewards: open the shop, and add / redeem / remove its rewards. One global shelf, so these never
    // touch the active project. Redeeming is a one-off buy: it stamps the reward's `redeemedAt` (when the
    // balance covers the price), which spends the gold and starts the 14-day shelf window.
    const openRewards = useCallback(() => setSection("rewards"), [])
    const toggleAddReward = useCallback(() => setAddRewardOpen((open) => !open), [])
    const addRewardItem = useCallback((name: string, price: number, replenish: boolean) => {
        nextRewardId.current += 1
        setRewards((prev) => addReward(prev, `reward-${nextRewardId.current}`, name, price, replenish))
        setAddRewardOpen(false)
    }, [])
    const removeRewardItem = useCallback((id: string) => setRewards((prev) => removeReward(prev, id)), [])
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

    // Mark the selected milestone complete — the pure rule guards that it is unlocked and every box
    // is ticked, so a no-op leaves the set (and reference) untouched.
    const completeSelected = useCallback(() => {
        if (selectedId === null) return
        // Decide the cue from current state (outside the StrictMode-double-invoked updater): a non-goal
        // milestone chimes here, while completing the goal fires the finale fanfare from the
        // goal-celebration effect, so it isn't doubled.
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

    // Delete the selected milestone and its subtree (cascade), then move selection to its parent so the
    // card shows something valid (every non-goal node has a parent; fall back to clearing). The goal is
    // never deleted here -- that path removes the whole view via removeProject.
    const deleteSelected = useCallback(() => {
        if (selectedId === null || !active) return
        const parent = parentOf(selectedId, active.edges)
        updateActive((project) => deleteMilestone(project, selectedId))
        if (parent) focusNode(parent)
        else setSelectedId(null)
    }, [selectedId, active, updateActive, focusNode])

    // Edit the selected milestone's name/description in place.
    const editMilestone = useCallback(
        (patch: Partial<Pick<Milestone, "name" | "desc">>) => {
            if (selectedId === null) return
            updateActive((project) => {
                const current = project.milestones[selectedId]
                if (!current) return project
                return { ...project, milestones: { ...project.milestones, [selectedId]: { ...current, ...patch } } }
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

    // Add a sub-milestone under the selected node: a new leaf, an edge from parent to it, placed a
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
            const child: Milestone = {
                id: childId,
                name: "New Milestone",
                tag: parent.tag,
                x: parent.x + siblings * SIBLING_FAN,
                y: parent.y + TIER_GAP,
                tier: parent.tier + 1,
                branch: parent.branch,
                desc: ""
            }
            const edges: MilestoneEdge[] = [...project.edges, [parentId, childId]]
            return {
                ...project,
                milestones: { ...project.milestones, [childId]: child },
                edges,
                mastered: uncomplete(parentId, project.mastered, edges)
            }
        })
        focusNode(childId)
    }, [selectedId, updateActive, focusNode])

    // Add a parent above the goal: the new node becomes the tier-0 gold goal, the old goal drops to a
    // normal node beneath it, and every existing node shifts down a tier. The tab label follows the
    // goal name, so it flips to the new node instantly. Disabled on Root (nothing sits above Root).
    const addParent = useCallback(() => {
        if (activeId === ROOT_ID) return
        nextNodeId.current += 1
        const goalId = `node-${nextNodeId.current}`
        updateActive((project) => {
            const oldGoal = project.milestones[project.goalId]
            if (!oldGoal) return project
            const milestones: Record<string, Milestone> = {}
            for (const [id, milestone] of Object.entries(project.milestones)) {
                milestones[id] = { ...milestone, tier: milestone.tier + 1 }
            }
            milestones[goalId] = {
                id: goalId,
                name: "New Milestone",
                tag: "Goal",
                x: oldGoal.x,
                y: oldGoal.y - TIER_GAP,
                tier: 0,
                branch: "Goal",
                desc: ""
            }
            const edges: MilestoneEdge[] = [...project.edges, [goalId, project.goalId]]
            return { ...project, milestones, edges, goalId }
        })
        focusNode(goalId)
    }, [activeId, updateActive, focusNode])

    // Switch to another tab, selecting its goal so the card shows something valid immediately.
    const switchProject = useCallback(
        (id: string) => {
            setSection("roadmap")
            setActiveId(id)
            setSelectedId(projects[id]?.goalId ?? null)
        },
        [projects]
    )

    // A mirror node's popover "View" button opens the view it stands for.
    const openView = useCallback(
        (mirrorId: string) => {
            if (mirrorId.startsWith(VIEW_MIRROR_PREFIX)) switchProject(mirrorId.slice(VIEW_MIRROR_PREFIX.length))
        },
        [switchProject]
    )

    // Editing a mirror edits the view it stands for: patch that view's goal name/description. A name
    // change flows back to the tab and the chip (both read the goal name).
    const editMirror = useCallback((mirrorId: string, patch: Partial<Pick<Milestone, "name" | "desc">>) => {
        const pid = mirrorId.slice(VIEW_MIRROR_PREFIX.length)
        setProjects((prev) => {
            const project = prev[pid]
            if (!project) return prev
            const goal = project.milestones[project.goalId]
            if (!goal) return prev
            return {
                ...prev,
                [pid]: { ...project, milestones: { ...project.milestones, [project.goalId]: { ...goal, ...patch } } }
            }
        })
    }, [])

    // Create a blank view under `parentId` (ROOT_ID for a top-level view, else a sub-view). `activate`
    // opens it; leaving it false keeps you on the current tab so a new chip just appears in the hub.
    const addView = useCallback(
        (parentId: string, activate: boolean) => {
            setSection("roadmap")
            nextViewId.current += 1
            const id = `view-${nextViewId.current}`
            const project = newProject(id, "New Quest", parentId)
            setProjects((prev) => ({ ...prev, [id]: project }))
            setOrder((prev) => [...prev, id])
            if (activate) {
                // Open the new view and focus its goal.
                setActiveId(id)
                focusNode(project.goalId)
            } else {
                // Stay in the Root hub and focus the new view's chip.
                focusNode(`${VIEW_MIRROR_PREFIX}${id}`)
            }
        },
        [focusNode]
    )

    // Rename a tab == rename its goal node (both read the same name).
    const renameProject = useCallback((id: string, name: string) => {
        setProjects((prev) => {
            const project = prev[id]
            if (!project) return prev
            const goal = project.milestones[project.goalId]
            if (!goal) return prev
            return {
                ...prev,
                [id]: { ...project, milestones: { ...project.milestones, [project.goalId]: { ...goal, name } } }
            }
        })
    }, [])

    // Remove a tab, activating a neighbour if the active one went away. Root is pinned, and the last
    // tab can't be removed.
    const removeProject = useCallback(
        (id: string) => {
            if (id === ROOT_ID || order.length <= 1) return
            const index = order.indexOf(id)
            const nextOrder = order.filter((tabId) => tabId !== id)
            setOrder(nextOrder)
            setProjects((prev) => {
                // Reparent the removed view's children to its parent (or Root) so the hub tree stays whole.
                const newParent = prev[id]?.parentId ?? ROOT_ID
                const rest: Record<string, Project> = {}
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
                    setSelectedId(projects[neighbour]?.goalId ?? null)
                }
            }
        },
        [order, activeId, projects]
    )

    // Serialize the app's data (not the open tab) for the Export button to download.
    const handleExport = useCallback(
        () => serialize({ projects, order, mirrorPos, tasks, rewards }),
        [projects, order, mirrorPos, tasks, rewards]
    )

    // Replace the whole app from a loaded state -- an imported file or a roadmap synced down from another
    // device. Swaps every slice, resumes the id counters past it, and opens the default tab (first
    // non-Root view, else Root) selected on its goal.
    const applyLoaded = useCallback((loaded: PersistedSlices) => {
        setProjects(loaded.projects)
        setOrder(loaded.order)
        setMirrorPos(loaded.mirrorPos)
        setTasks(loaded.tasks)
        setRewards(loaded.rewards)
        setSection("roadmap")
        nextNodeId.current = maxCounter(
            Object.values(loaded.projects).flatMap((project) => Object.keys(project.milestones)),
            "node"
        )
        nextViewId.current = maxCounter(Object.keys(loaded.projects), "view")
        nextTaskId.current = maxCounter(
            loaded.tasks.map((task) => task.id),
            "task"
        )
        nextRewardId.current = maxCounter(
            loaded.rewards.map((reward) => reward.id),
            "reward"
        )
        const nextActive = loaded.order.find((id) => id !== ROOT_ID && loaded.projects[id]) ?? ROOT_ID
        setActiveId(nextActive)
        setSelectedId(loaded.projects[nextActive]?.goalId ?? null)
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
        () => ({ projects, order, mirrorPos, tasks, rewards }),
        [projects, order, mirrorPos, tasks, rewards]
    )
    const sync = useSync(syncSlices, applyLoaded)

    // A pairing link or a detected conflict needs attention now: jump to the Sync screen so the inline
    // confirm / choice is visible without the user hunting for it.
    useEffect(() => {
        if (sync.pendingAdopt !== null || sync.conflict) setSection("sync")
    }, [sync.pendingAdopt, sync.conflict])

    const tabs = order.flatMap((id) => {
        const project = projects[id]
        const goal = project?.milestones[project.goalId]
        return goal ? [{ id, name: goal.name, pinned: id === ROOT_ID }] : []
    })

    // What the canvas renders for the active tab. On Root, mirror every other view as a read-only
    // node beneath the Root node (a hub); elsewhere it's just the project's own graph.
    const view = useMemo<{
        milestones: Record<string, Milestone>
        edges: MilestoneEdge[]
        staticIds: ReadonlySet<string>
        completeIds: ReadonlySet<string>
    }>(() => {
        const rootGoal = active?.milestones[active.goalId]
        const others = order.filter((id) => id !== ROOT_ID)
        if (!active || activeId !== ROOT_ID || !rootGoal || others.length === 0) {
            return {
                milestones: active?.milestones ?? {},
                edges: active?.edges ?? [],
                staticIds: EMPTY_IDS,
                completeIds: EMPTY_IDS
            }
        }
        const milestones: Record<string, Milestone> = { ...active.milestones }
        const edges: MilestoneEdge[] = [...active.edges]
        const staticIds = new Set<string>()
        const completeIds = new Set<string>()

        // Depth in the hub tree (top-level view = 1); Root goal sits at depth 0.
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
            const goal = project?.milestones[project.goalId]
            if (!goal) continue
            const d = depthByPid[pid] ?? 1
            const slot = usedPerDepth[d] ?? 0
            usedPerDepth[d] = slot + 1
            const count = perDepth[d] ?? 1
            const id = `${VIEW_MIRROR_PREFIX}${pid}`
            const dragged = mirrorPos[id]
            milestones[id] = {
                id,
                name: goal.name,
                tag: "View",
                x: dragged ? dragged.x : rootGoal.x + (slot - (count - 1) / 2) * MIRROR_SPACING,
                y: dragged ? dragged.y : rootGoal.y + d * TIER_GAP,
                tier: 1,
                branch: "View",
                desc: goal.desc
            }
            // Hang under the parent view's chip, or under the Root node for a top-level view.
            const parentId = project?.parentId
            const source =
                parentId && parentId !== ROOT_ID && projects[parentId]
                    ? `${VIEW_MIRROR_PREFIX}${parentId}`
                    : active.goalId
            edges.push([source, id])
            staticIds.add(id)
            // The view is complete when its own goal is in its completed set.
            if (project?.mastered.has(project.goalId)) completeIds.add(id)
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

    const closing = selectedId === null && displayId !== null
    // A selected mirror shows the shared card in view mode; synthesize a milestone for its name.
    const shownIsView = displayId !== null && displayId.startsWith(VIEW_MIRROR_PREFIX)
    const shown: Milestone | undefined = (() => {
        if (displayId === null) return undefined
        if (!shownIsView) return active?.milestones[displayId]
        const project = projects[displayId.slice(VIEW_MIRROR_PREFIX.length)]
        const goal = project?.milestones[project.goalId]
        return goal
            ? { id: displayId, name: goal.name, tag: "View", x: 0, y: 0, tier: 1, branch: "View", desc: goal.desc }
            : undefined
    })()
    const isGoal = shown ? shown.tier === 0 : false
    // The Root node itself (not a mirror), which also offers "+ Add sub-view".
    const shownIsRootGoal = activeId === ROOT_ID && !shownIsView && !!shown && shown.id === active?.goalId
    // Delete wiring for the shown card. Root goal: never. View chip or a tab's goal: removes the whole
    // view (removeProject). A normal milestone: deletes its own subtree.
    const deleteKind: "milestone" | "view" = shownIsView || (isGoal && !shownIsRootGoal) ? "view" : "milestone"
    const canDelete = !!shown && !shownIsRootGoal
    const onDeleteShown = !canDelete
        ? undefined
        : deleteKind === "view"
          ? () => removeProject(shownIsView && displayId ? displayId.slice(VIEW_MIRROR_PREFIX.length) : activeId)
          : deleteSelected
    const deleteDescendantCount =
        canDelete && deleteKind === "milestone" && active && shown ? descendantsOf(shown.id, active.edges).length : 0

    return (
        <div className="relative flex min-h-screen flex-col overflow-hidden bg-[#f6edd6]">
            <TabBar
                tabs={tabs}
                activeId={section === "roadmap" ? activeId : ""}
                onSelect={switchProject}
                onRename={renameProject}
                leading={
                    <NavActions
                        onOpenTasks={openTasks}
                        tasksActive={section === "tasks"}
                        onOpenRewards={openRewards}
                        rewardsActive={section === "rewards"}
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
                    <div className="absolute inset-0 z-10 overflow-auto">
                        <TasksBoard
                            items={visible(tasks, Date.now())}
                            onAdd={addTaskItem}
                            onToggle={toggleTask}
                            onRemove={removeTask}
                            onReorder={reorderTask}
                        />
                    </div>
                ) : section === "rewards" ? (
                    <>
                        <div className="absolute inset-0 z-10 overflow-auto">
                            <RewardsBoard
                                gold={gold}
                                rewards={visibleRewards(rewards, Date.now())}
                                onRedeem={redeemReward}
                                onOpenAdd={toggleAddReward}
                                onRemoveReward={removeRewardItem}
                            />
                        </div>
                        {addRewardShown && (
                            <aside
                                data-add-reward-card=""
                                className="absolute right-4 top-4 z-20 w-[320px] max-w-[calc(100%-2rem)]"
                            >
                                <AddRewardCard
                                    onAdd={addRewardItem}
                                    closing={!addRewardOpen && addRewardShown}
                                    onExited={() => setAddRewardShown(false)}
                                />
                            </aside>
                        )}
                    </>
                ) : section === "sync" ? (
                    <div className="absolute inset-0 z-10 overflow-auto">
                        <SyncBoard sync={sync} />
                    </div>
                ) : (
                    <>
                        <div className="absolute inset-0 z-10">
                            {active && (
                                <MilestoneTree
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
                                <DetailCard
                                    key={shown.id}
                                    milestone={shown}
                                    state={stateOf(shown.id, active.mastered, active.edges)}
                                    todos={isGoal ? [] : (active.todos[shown.id] ?? [])}
                                    isGoal={isGoal}
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
                                    onAddParent={activeId === ROOT_ID ? undefined : addParent}
                                    onAddSubView={
                                        shownIsView && displayId
                                            ? () => addView(displayId.slice(VIEW_MIRROR_PREFIX.length), false)
                                            : shownIsRootGoal
                                              ? () => addView(ROOT_ID, false)
                                              : undefined
                                    }
                                    isView={shownIsView}
                                    onView={shownIsView && displayId ? () => openView(displayId) : undefined}
                                    onDelete={onDeleteShown}
                                    deleteKind={deleteKind}
                                    descendantCount={deleteDescendantCount}
                                    onExited={() => setDisplayId(null)}
                                />
                            </aside>
                        )}
                        <GoalCelebration burst={burst} />
                    </>
                )}
                </SectionTransition>
            </div>
        </div>
    )
}

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { addBounty, type Bounty, remove, reorder, SEED_BOUNTIES, toggle, visible } from "./bounties"
import { BountiesBoard } from "./BountiesBoard"
import { Corners } from "./Corners"
import { DetailCard } from "./DetailCard"
import { GoalCelebration } from "./GoalCelebration"
import { complete, stateOf, uncomplete } from "./graph"
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
} from "./merchant"
import { AddRewardCard, MerchantBoard } from "./MerchantBoard"
import { MilestoneTree } from "./MilestoneTree"
import type { Milestone, MilestoneEdge } from "./milestones"
import { NavActions } from "./NavActions"
import { deserialize, loadState, maxCounter, type PersistedSlices, saveState, serialize } from "./persist"
import { newProject, type Project, ROOT_ID, rootProject, seedProject } from "./project"
import { TabBar } from "./TabBar"
import { SyncBoard } from "./sync/SyncBoard"
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
    bounties: Bounty[]
    rewards: Reward[]
    activeId: string
    selectedId: string | null
    nextNodeId: number
    nextViewId: number
    nextBountyId: number
    nextRewardId: number
    hadHash: boolean
}
function computeBoot(): Boot {
    // Restore the autosaved data if present; otherwise start from Root + the bundled sample.
    const loaded = loadState()
    const projects = loaded?.projects ?? { [ROOT_ID]: rootProject(), seed: seedProject() }
    const order = loaded?.order ?? [ROOT_ID, "seed"]
    const mirrorPos = loaded?.mirrorPos ?? {}
    // Bounties and rewards seed only on a truly fresh start (no saved state at all); an existing save
    // from before these views simply had none, and loads empty rather than re-seeding.
    const bounties = loaded?.bounties ?? SEED_BOUNTIES
    const rewards = loaded?.rewards ?? SEED_REWARDS
    // Counters resume past whatever ids the loaded/seed data already uses.
    const nextNodeId = maxCounter(
        Object.values(projects).flatMap((project) => Object.keys(project.milestones)),
        "node"
    )
    const nextViewId = maxCounter(Object.keys(projects), "view")
    const nextBountyId = maxCounter(
        bounties.map((bounty) => bounty.id),
        "bounty"
    )
    const nextRewardId = maxCounter(
        rewards.map((reward) => reward.id),
        "reward"
    )
    const base = {
        projects,
        order,
        mirrorPos,
        bounties,
        rewards,
        nextNodeId,
        nextViewId,
        nextBountyId,
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
    // The app-level Bounties checklist (one flat list shared across every tab) and which top-level
    // section is on screen: the roadmap board, the Bounties list, or the Merchant shop.
    const [bounties, setBounties] = useState<Bounty[]>(boot.bounties)
    // The Merchant shelf. Gold isn't stored: it's earned from roadmap completion minus the price of
    // each redeemed reward (computed below), clamped at zero.
    const [rewards, setRewards] = useState<Reward[]>(boot.rewards)
    const [section, setSection] = useState<"roadmap" | "bounties" | "merchant" | "sync">("roadmap")
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
    const nextBountyId = useRef(boot.nextBountyId)
    const nextRewardId = useRef(boot.nextRewardId)
    // Fires the finale fanfare when the active tab's goal crosses into complete, anchored on that
    // goal node. Tracked per tab (seeded on first sight) so switching onto an already-done goal
    // doesn't fire; the burst carries the goal's board-relative centre + a nonce to (re)play.
    const boardRef = useRef<HTMLDivElement>(null)
    const goalDoneRef = useRef<Record<string, boolean>>({})
    const [burst, setBurst] = useState<{ x: number; y: number; nonce: number } | null>(null)

    const active = projects[activeId]

    // Gold in the purse: earned from progress (checklist boxes, bounties, milestones, goals) minus
    // what's been spent, floored at zero so un-completing work after a spend just empties the purse
    // rather than going negative.
    const gold = useMemo(
        () => Math.max(0, earnedGold(projects, bounties) - spentGold(rewards)),
        [projects, bounties, rewards]
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
    }, [active, activeId])

    useEffect(() => {
        if (selectedId !== null) setDisplayId(selectedId)
    }, [selectedId])

    // Reveal the add-reward card on open; leaving the Merchant view discards it outright.
    useEffect(() => {
        if (addRewardOpen) setAddRewardShown(true)
    }, [addRewardOpen])
    useEffect(() => {
        if (section !== "merchant") {
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
                target?.closest("[data-view-popover]")
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
        const timer = setTimeout(() => saveState({ projects, order, mirrorPos, bounties, rewards }), 400)
        return () => clearTimeout(timer)
    }, [projects, order, mirrorPos, bounties, rewards])

    // Select a node and pan the canvas onto it; the URL hash follows the selection.
    const focusNode = useCallback((id: string) => {
        setSelectedId(id)
        setFocusId(id)
        setFocusNonce((n) => n + 1)
    }, [])

    // Bounties: open the app-level list, and add / toggle / remove its items. One global list, so
    // these never touch the active project.
    const openBounties = useCallback(() => setSection("bounties"), [])
    const addBountyItem = useCallback((text: string) => {
        nextBountyId.current += 1
        setBounties((prev) => addBounty(prev, `bounty-${nextBountyId.current}`, text))
    }, [])
    const toggleBounty = useCallback((id: string) => setBounties((prev) => toggle(prev, id, Date.now())), [])
    const removeBounty = useCallback((id: string) => setBounties((prev) => remove(prev, id)), [])
    const reorderBounty = useCallback(
        (activeId: string, overId: string) => setBounties((prev) => reorder(prev, activeId, overId)),
        []
    )

    // Merchant: open the shop, and add / redeem / remove its rewards. One global shelf, so these never
    // touch the active project. Redeeming is a one-off buy: it stamps the reward's `redeemedAt` (when the
    // balance covers the price), which spends the gold and starts the 14-day shelf window.
    const openMerchant = useCallback(() => setSection("merchant"), [])
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
            nextRewardId.current += 1
            const replenishId = `reward-${nextRewardId.current}`
            setRewards((prev) => redeem(prev, id, gold, Date.now(), replenishId))
        },
        [gold]
    )

    const toggleTodo = useCallback(
        (index: number) => {
            if (selectedId === null) return
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
        [selectedId, updateActive]
    )

    // Mark the selected milestone complete — the pure rule guards that it is unlocked and every box
    // is ticked, so a no-op leaves the set (and reference) untouched.
    const completeSelected = useCallback(() => {
        if (selectedId === null) return
        updateActive((project) => {
            const allDone = (project.todos[selectedId] ?? []).every((todo) => todo.done)
            const mastered = complete(selectedId, project.mastered, allDone, project.edges)
            return mastered === project.mastered ? project : { ...project, mastered }
        })
    }, [selectedId, updateActive])

    // Mark it incomplete, cascading up so no completed parent is left with an incomplete child.
    const uncompleteSelected = useCallback(() => {
        if (selectedId === null) return
        updateActive((project) => {
            const mastered = uncomplete(selectedId, project.mastered, project.edges)
            return mastered === project.mastered ? project : { ...project, mastered }
        })
    }, [selectedId, updateActive])

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
            const project = newProject(id, "New View", parentId)
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
        () => serialize({ projects, order, mirrorPos, bounties, rewards }),
        [projects, order, mirrorPos, bounties, rewards]
    )

    // Replace the whole app from a loaded state -- an imported file or a roadmap synced down from another
    // device. Swaps every slice, resumes the id counters past it, and opens the default tab (first
    // non-Root view, else Root) selected on its goal.
    const applyLoaded = useCallback((loaded: PersistedSlices) => {
        setProjects(loaded.projects)
        setOrder(loaded.order)
        setMirrorPos(loaded.mirrorPos)
        setBounties(loaded.bounties)
        setRewards(loaded.rewards)
        setSection("roadmap")
        nextNodeId.current = maxCounter(
            Object.values(loaded.projects).flatMap((project) => Object.keys(project.milestones)),
            "node"
        )
        nextViewId.current = maxCounter(Object.keys(loaded.projects), "view")
        nextBountyId.current = maxCounter(
            loaded.bounties.map((bounty) => bounty.id),
            "bounty"
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
        () => ({ projects, order, mirrorPos, bounties, rewards }),
        [projects, order, mirrorPos, bounties, rewards]
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

    return (
        <div className="relative flex min-h-screen flex-col overflow-hidden bg-[#f6edd6]">
            <TabBar
                tabs={tabs}
                activeId={section === "roadmap" ? activeId : ""}
                onSelect={switchProject}
                onRename={renameProject}
                onRemove={removeProject}
                leading={
                    <NavActions
                        onOpenBounties={openBounties}
                        bountiesActive={section === "bounties"}
                        onOpenMerchant={openMerchant}
                        merchantActive={section === "merchant"}
                        onOpenSync={sync.enabled ? () => setSection("sync") : undefined}
                        syncActive={section === "sync"}
                        syncStatus={sync.status}
                    />
                }
                trailing={<IoButtons onExport={handleExport} onImport={handleImport} />}
            />
            <div ref={boardRef} className="board-surface relative isolate flex-1 overflow-hidden">
                <Corners />
                {section === "bounties" ? (
                    <div className="absolute inset-0 z-10 overflow-auto">
                        <BountiesBoard
                            items={visible(bounties, Date.now())}
                            onAdd={addBountyItem}
                            onToggle={toggleBounty}
                            onRemove={removeBounty}
                            onReorder={reorderBounty}
                        />
                    </div>
                ) : section === "merchant" ? (
                    <>
                        <div className="absolute inset-0 z-10 overflow-auto">
                            <MerchantBoard
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
                                    onSelect={setSelectedId}
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
                                    onExited={() => setDisplayId(null)}
                                />
                            </aside>
                        )}
                        <GoalCelebration burst={burst} />
                    </>
                )}
            </div>
        </div>
    )
}

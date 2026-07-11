// A Project is one tab's roadmap: its own milestone records, edges, checklists, and completed set.
// The tab's label is simply the goal (tier-0 root) milestone's name, so renaming the tab and
// renaming the goal are the same edit seen from two places.

import { descendantsOf, parentOf, uncomplete } from "./graph"
import {
    DEFAULT_GOAL_REWARD,
    DEFAULT_NODE_REWARD,
    EDGES,
    MASTERED,
    type Milestone,
    type MilestoneEdge,
    NODES,
    TODOS,
    type Todo
} from "./milestones"

// Vertical gap between tiers when a node is pushed down a tier (matches App's auto-placement).
const TIER_GAP = 160

export type Project = {
    id: string
    // The tier-0 root milestone; its name is the tab label.
    goalId: string
    // The view this one hangs under in the Root hub tree (another view's id, or ROOT_ID for a
    // top-level view). Root itself has none.
    parentId?: string
    milestones: Record<string, Milestone>
    edges: MilestoneEdge[]
    todos: Record<string, Todo[]>
    mastered: ReadonlySet<string>
}

// The bundled sample roadmap, as the first tab (a top-level view under Root). Everything is
// deep-copied so editing a project never mutates the module seeds.
export function seedProject(): Project {
    return {
        id: "seed",
        goalId: "learn",
        parentId: ROOT_ID,
        milestones: Object.fromEntries(NODES.map((node) => [node.id, { ...node }])),
        edges: EDGES.map((edge) => [...edge] as MilestoneEdge),
        todos: Object.fromEntries(Object.entries(TODOS).map(([id, list]) => [id, list.map((todo) => ({ ...todo }))])),
        mastered: new Set(MASTERED)
    }
}

// Default blurb on a fresh view's goal node (Root overrides its own below).
const NEW_GOAL_DESC = "The end goal for this view. Add sub-milestones to break it down into steps."

// A blank roadmap: a single gold goal node named after the tab, no children and nothing complete.
// `parentId` places it in the Root hub tree.
export function newProject(id: string, name: string, parentId?: string): Project {
    const goalId = `${id}-goal`
    const goal: Milestone = {
        id: goalId,
        name,
        tag: "Goal",
        x: 0,
        y: 0,
        tier: 0,
        branch: "Goal",
        description: NEW_GOAL_DESC,
        reward: DEFAULT_GOAL_REWARD
    }
    return { id, goalId, parentId, milestones: { [goalId]: goal }, edges: [], todos: {}, mastered: new Set() }
}

// The persistent first tab: a single "Quest Board" node that can't be deleted. It's the top of the view
// tree (no parent), with a default blurb on its node.
export const ROOT_ID = "root"
const ROOT_DESC = "Home base for every roadmap. Each view you create branches off this node; open one to dive in."
export function rootProject(): Project {
    const project = newProject(ROOT_ID, "Quest Board")
    const goal = project.milestones[project.goalId]
    if (!goal) return project
    return { ...project, milestones: { ...project.milestones, [project.goalId]: { ...goal, description: ROOT_DESC } } }
}

// Remove a milestone and its whole subtree from a project: the node, every descendant, the edges
// touching any of them, their checklists, and any completed marks. The goal (tier-0 root) is never
// removed this way -- deleting a whole view is a separate op (removeProject) -- and an unknown id is
// a no-op, both returning the same reference so callers can skip a redundant update.
export function deleteMilestone(project: Project, id: string): Project {
    if (id === project.goalId || !project.milestones[id]) return project
    const doomed = new Set<string>([id, ...descendantsOf(id, project.edges)])
    const milestones: Record<string, Milestone> = {}
    for (const [mid, milestone] of Object.entries(project.milestones)) {
        if (!doomed.has(mid)) milestones[mid] = milestone
    }
    const todos: Record<string, Todo[]> = {}
    for (const [mid, list] of Object.entries(project.todos)) {
        if (!doomed.has(mid)) todos[mid] = list
    }
    const edges = project.edges.filter(([parent, child]) => !doomed.has(parent) && !doomed.has(child))
    const mastered = new Set([...project.mastered].filter((mid) => !doomed.has(mid)))
    return { ...project, milestones, edges, todos, mastered }
}

// Insert a fresh, blank parent above `targetId`, opened later in edit mode. Above the goal (tier-0) the
// new node becomes the goal and every node shifts down a tier (a new top). Above a regular milestone M
// it splices in between M and its current parent P, so `P -> M` becomes `P -> N -> M`, and M with its
// whole subtree drops a tier; P, now holding a fresh incomplete child, drops out of the completed set
// (mirroring adding a sub-milestone). An unknown id is a no-op (same reference).
export function insertParent(project: Project, targetId: string, newId: string): Project {
    const target = project.milestones[targetId]
    if (!target) return project

    if (targetId === project.goalId) {
        const milestones: Record<string, Milestone> = {}
        for (const [id, milestone] of Object.entries(project.milestones)) {
            milestones[id] = { ...milestone, tier: milestone.tier + 1 }
        }
        milestones[newId] = {
            id: newId,
            name: "New Milestone",
            tag: "Goal",
            x: target.x,
            y: target.y - TIER_GAP,
            tier: 0,
            branch: "Goal",
            description: "",
            reward: DEFAULT_GOAL_REWARD
        }
        const edges: MilestoneEdge[] = [...project.edges, [newId, project.goalId]]
        return { ...project, milestones, edges, goalId: newId }
    }

    const subtree = new Set<string>([targetId, ...descendantsOf(targetId, project.edges)])
    const milestones: Record<string, Milestone> = {}
    for (const [id, milestone] of Object.entries(project.milestones)) {
        milestones[id] = subtree.has(id) ? { ...milestone, tier: milestone.tier + 1, y: milestone.y + TIER_GAP } : { ...milestone }
    }
    milestones[newId] = {
        id: newId,
        name: "New Milestone",
        tag: target.tag,
        x: target.x,
        y: target.y,
        tier: target.tier,
        branch: target.branch,
        description: "",
        reward: DEFAULT_NODE_REWARD
    }
    const oldParent = parentOf(targetId, project.edges)
    const edges: MilestoneEdge[] = project.edges.map((edge) => (edge[1] === targetId ? [edge[0], newId] : edge))
    edges.push([newId, targetId])
    const mastered = oldParent ? uncomplete(oldParent, project.mastered, edges) : project.mastered
    return { ...project, milestones, edges, mastered }
}

// A Project is one tab's roadmap: its own milestone records, edges, checklists, and completed set.
// The tab's label is simply the goal (tier-0 root) milestone's name, so renaming the tab and
// renaming the goal are the same edit seen from two places.

import { EDGES, MASTERED, type Milestone, type MilestoneEdge, NODES, TODOS, type Todo } from "./milestones"

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
    const goal: Milestone = { id: goalId, name, tag: "Goal", x: 0, y: 0, tier: 0, branch: "Goal", desc: NEW_GOAL_DESC }
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
    return { ...project, milestones: { ...project.milestones, [project.goalId]: { ...goal, desc: ROOT_DESC } } }
}

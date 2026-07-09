// Tutorial seed for the sample roadmap: a small self-teaching tree whose node names and
// descriptions explain the app itself. A single-rooted tree: the GOAL is the root at the TOP
// (tier 0); its sub-milestones branch DOWNWARD. A node unlocks once every child beneath it is
// complete, so progress climbs leaves -> root. The seed is pre-set to show all three states at
// once: one branch is complete (so its parent is unlocked / In Progress), the other is Locked
// until the user finishes the actionable leaf.

export type MilestoneState = "mastered" | "available" | "locked"

export type Todo = {
    text: string
    done: boolean
}

export type Milestone = {
    id: string
    name: string
    tag: string
    x: number
    y: number
    tier: number
    branch: string
    description: string
    // Gold minted when this milestone is completed. Seeded from DEFAULT_GOAL_REWARD (the tier-0 goal)
    // or DEFAULT_NODE_REWARD (every milestone below it) when the node is created, then editable per
    // node in the detail card. Required: reward-less data from before this field is upgraded on load
    // (see persist.deserialize), so every live milestone carries one.
    reward: number
}

// Default gold a milestone pays on completion, used to seed a new node's `reward` and to upgrade older
// data with none set (in persist.deserialize). The goal (tier 0) is the big payoff; every milestone
// below it pays the smaller node reward.
export const DEFAULT_NODE_REWARD = 3
export const DEFAULT_GOAL_REWARD = 5

// [parent (drawn above), child (drawn below)] -- child is a sub-milestone of parent.
export type MilestoneEdge = [parent: string, child: string]

export const NODES: Milestone[] = [
    {
        id: "learn",
        name: "Learn Questline",
        tag: "Goal",
        x: 700,
        y: 90,
        tier: 0,
        branch: "Goal",
        description: "This is your goal, the thing everything below builds toward. Click any node to open its card; the pencil (top-right) edits its name, description, checklist, and reward. Progress climbs from the bottom up: a node lights up once every step beneath it is done.",
        reward: DEFAULT_GOAL_REWARD
    },

    {
        id: "plan-goal",
        name: "Plan your goal",
        tag: "Track",
        x: 440,
        y: 250,
        tier: 1,
        branch: "Plan",
        description: "Sub-milestones split a goal into tracks. The step beneath this one is already done, so this track has unlocked and shows In Progress. Its own checklist decides when you can mark it complete.",
        reward: DEFAULT_NODE_REWARD
    },
    {
        id: "track-progress",
        name: "Track your progress",
        tag: "Track",
        x: 960,
        y: 250,
        tier: 1,
        branch: "Track",
        description: "This track is Locked: it waits until the milestone beneath it is complete. Finish the step below and watch this light up.",
        reward: DEFAULT_NODE_REWARD
    },

    {
        id: "break-steps",
        name: "Break it into steps",
        tag: "Step",
        x: 440,
        y: 410,
        tier: 2,
        branch: "Plan",
        description: "Every milestone carries a checklist, its definition of done. Every box here is ticked and the milestone is marked complete, which is why the track above unlocked.",
        reward: DEFAULT_NODE_REWARD
    },
    {
        id: "finish-milestone",
        name: "Finish a milestone",
        tag: "Step",
        x: 960,
        y: 410,
        tier: 2,
        branch: "Track",
        description: "Your turn: tick each item below, then press Mark Complete. The track above will unlock the moment this is done.",
        reward: DEFAULT_NODE_REWARD
    }
]

export const EDGES: MilestoneEdge[] = [
    ["learn", "plan-goal"],
    ["learn", "track-progress"],
    ["plan-goal", "break-steps"],
    ["track-progress", "finish-milestone"]
]

// Seed set of completed milestones: the left leaf is done, so its parent (plan-goal) has unlocked.
export const MASTERED: ReadonlySet<string> = new Set(["break-steps"])

// Each milestone (every node except the root goal) carries a checklist -- its definition of done.
// A node can only be marked complete once every item is ticked.
export const TODOS: Record<string, Todo[]> = {
    "plan-goal": [
        { text: "Name your goal", done: true },
        { text: "Add a sub-milestone or two", done: false }
    ],
    "track-progress": [{ text: "Complete the step below first", done: false }],
    "break-steps": [
        { text: "Open this card", done: true },
        { text: "Tick every box", done: true },
        { text: "Press Mark Complete", done: true }
    ],
    "finish-milestone": [
        { text: "Tick this box", done: false },
        { text: "Then tick this one", done: false }
    ]
}

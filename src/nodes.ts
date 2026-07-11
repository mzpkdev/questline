// Tutorial seed for the sample roadmap: a small self-teaching tree whose node names and
// descriptions explain the app itself. A single-rooted tree: the ROOT node is at the TOP
// (tier 0); its child nodes branch DOWNWARD. A node unlocks once every child beneath it is
// complete, so progress climbs leaves -> root. The seed is pre-set to show all three states at
// once: one branch is complete (so its parent is unlocked / In Progress), the other is Locked
// until the user finishes the actionable leaf.

export type NodeState = "mastered" | "available" | "locked"

export type Todo = {
    text: string
    done: boolean
}

// A tree node. Its kind is positional, never stored: the root node is the one whose id equals its
// board's rootId; a linked node (Phase 2) is any node carrying the `targetBoardId` key. A regular
// or root node carries `description` + `reward`; a linked node carries neither.
export type Node = {
    id: string
    name: string
    x: number
    y: number
    tier: number
    // Present on regular and root nodes; absent on a linked node.
    description?: string
    // Gold minted when this node is completed. Seeded from DEFAULT_ROOT_REWARD (the tier-0 root) or
    // DEFAULT_NODE_REWARD (every node below it) when the node is created, then editable per node in
    // the detail card. Absent on a linked node (which pays no gold).
    reward?: number
    // Presence marks a linked node: a board id once chosen, null while unlinked. Absent on regular and
    // root nodes. The display name of a linked node is derived live from its target board's root node
    // (see board.linkedNodeName), so a linked node's own `name` is unused.
    targetBoardId?: string | null
}

// Node kind is positional (never a stored flag): a linked node is any node carrying the `targetBoardId`
// key -- present as a board id (linked) or null (unlinked). Regular and root nodes omit the key. The
// root node is separately identified by `id === board.rootId`.
export const isLinkedNode = (node: Node): boolean => "targetBoardId" in node

// Default gold a node pays on completion, used to seed a new node's `reward`. The root node (tier 0)
// is the big payoff; every node below it pays the smaller node reward.
export const DEFAULT_NODE_REWARD = 3
export const DEFAULT_ROOT_REWARD = 5

// [parent (drawn above), child (drawn below)] -- child is a sub-node of parent.
export type Edge = [parent: string, child: string]

export const NODES: Node[] = [
    {
        id: "learn",
        name: "Learn Questline",
        x: 700,
        y: 90,
        tier: 0,
        description:
            "This is your goal, the thing everything below builds toward. Click any node to open its card; the pencil (top-right) edits its name, description, checklist, and reward. Progress climbs from the bottom up: a node lights up once every step beneath it is done.",
        reward: DEFAULT_ROOT_REWARD
    },

    {
        id: "plan-goal",
        name: "Plan your goal",
        x: 440,
        y: 250,
        tier: 1,
        description:
            "Child nodes split a goal into tracks. The step beneath this one is already done, so this track has unlocked and shows In Progress. Its own checklist decides when you can mark it complete.",
        reward: DEFAULT_NODE_REWARD
    },
    {
        id: "track-progress",
        name: "Track your progress",
        x: 960,
        y: 250,
        tier: 1,
        description:
            "This track is Locked: it waits until the node beneath it is complete. Finish the step below and watch this light up.",
        reward: DEFAULT_NODE_REWARD
    },

    {
        id: "break-steps",
        name: "Break it into steps",
        x: 440,
        y: 410,
        tier: 2,
        description:
            "Every node carries a checklist, its definition of done. Every box here is ticked and the node is marked complete, which is why the track above unlocked.",
        reward: DEFAULT_NODE_REWARD
    },
    {
        id: "finish-node",
        name: "Finish a node",
        x: 960,
        y: 410,
        tier: 2,
        description:
            "Your turn: tick each item below, then press Mark Complete. The track above will unlock the moment this is done.",
        reward: DEFAULT_NODE_REWARD
    }
]

export const EDGES: Edge[] = [
    ["learn", "plan-goal"],
    ["learn", "track-progress"],
    ["plan-goal", "break-steps"],
    ["track-progress", "finish-node"]
]

// Seed set of completed nodes: the left leaf is done, so its parent (plan-goal) has unlocked.
export const MASTERED: ReadonlySet<string> = new Set(["break-steps"])

// Each node (every node except the root) carries a checklist -- its definition of done.
// A node can only be marked complete once every item is ticked.
export const TODOS: Record<string, Todo[]> = {
    "plan-goal": [
        { text: "Name your goal", done: true },
        { text: "Add a child node or two", done: false }
    ],
    "track-progress": [{ text: "Complete the step below first", done: false }],
    "break-steps": [
        { text: "Open this card", done: true },
        { text: "Tick every box", done: true },
        { text: "Press Mark Complete", done: true }
    ],
    "finish-node": [
        { text: "Tick this box", done: false },
        { text: "Then tick this one", done: false }
    ]
}

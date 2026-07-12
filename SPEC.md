# Milestone tree, redefined

Supersedes the Root-hub model. Boards are now a flat, equal set; cross-board links are explicit nodes
placed on the tree rather than auto-derived mirror chips under a pinned Root.

## Vocabulary

- **board** — one roadmap (its own node tree). Replaces the old "view" / `Project`.
- **node** — a regular tree node (name, checklist, reward), the old "milestone".
- **root node** — the single tier-0 node of a board; its name is the board's tab label.
- **linked node** — a node that points at another board (`targetBoardId`); its action is "Go to Board".

Code follows this: `Board` (was `Project`), a `Node` base with a `rootNodeId` per board, a linked node
carrying `targetBoardId`, and the UI label "Go to Board".

## Rename map

Applied in Phase 0 (mechanical) and finished as the model changes land. Any leftover identifier follows
the rule: `Milestone*` -> `Node*`, `*Project*` -> `*Board*`, `View*` / `*view*` -> `Linked*` / board,
`goal` -> `root` for the tier-0 node, `goal` -> `board` where it means completion (e.g. `goalDoneRef`
-> `boardDoneRef`, `GoalCelebration` -> `BoardCelebration`). Full hygiene: no `goal` / `view` /
`milestone` / `project` / `mirror` token survives in code, tests, ids, or data-attrs.

**Concepts:** view / project -> board; milestone -> node; goal (tier 0) -> root node; mirror / view
chip -> linked node.

**Types and fields**

| old | new |
| --- | --- |
| `Project` | `Board` |
| `Milestone` | `Node` |
| `MilestoneState` | `NodeState` |
| `MilestoneEdge` (tuple), `MilestoneEdgeTuple` | `Edge` |
| `MilestoneFlowNode` / `MilestoneFlowEdge` / `MilestoneEdgeData` | `NodeFlowNode` / `NodeFlowEdge` / `EdgeData` |
| `project.goalId` | `board.rootId` |
| `node.tag` / `node.branch` value `"Goal"` / `"View"` | `"Root"` / `"Linked"` |
| `Project.parentId` | removed |
| `mirrorPos` | removed |
| `staticNodeIds` / `completeNodeIds` (mirror props) | removed (linked nodes are real, draggable; completion is per linked node) |

**Functions**

| old | new |
| --- | --- |
| `newProject` / `seedProject` | `newBoard` / `seedBoard` |
| `rootProject` | removed |
| `removeProject` / `renameProject` / `switchProject` | `removeBoard` / `renameBoard` / `switchBoard` |
| `deleteMilestone` | `deleteNode` |
| `makeMilestoneNode` / `makeViewNode` | `makeNode` / `makeLinkedNode` |
| `addView` | split: `addBoard` (nav) + `addLinkedNode` |
| `openView` | `goToBoard` |
| `editMirror` | `setLinkedTarget` (pick the board from the dropdown) |
| `insertParent`, `stateOf`, `complete`, `uncomplete`, `descendantsOf`, `parentOf` | unchanged (node-agnostic) |

**Ids and prefixes**

| old | new |
| --- | --- |
| `node-N` (node ids) | unchanged |
| `view-N` (board id) | `board-N` |
| `<id>-goal` (root node id) | `<id>-root` |
| `view-mirror-<id>`, `VIEW_MIRROR_PREFIX` | removed |
| `ROOT_ID`, the `"root"` board | removed |

**Files, components, DOM**

| old | new |
| --- | --- |
| `milestones.ts` / `project.ts` | `nodes.ts` / `board.ts` |
| `MilestoneTree` | `BoardTree` |
| `MilestoneNode` | `NodeCard` |
| `MilestoneEdge` (component) | `Edge` |
| `ViewNode` | `LinkedNode` |
| `GoalCelebration` | `BoardCelebration` |
| `NodeDetailCard` | unchanged |
| `data-view-node` | `data-linked-node` |
| `data-view-popover` | removed (dead orphan) |
| testid `goal-celebration` | `board-celebration` |

## Boards

- Every board owns a node tree, its checklists, and its completed set.
- Every board has one **root node** (tier 0). Its name is the tab label; deleting it deletes the board.
- All boards are equal. There is **no Root board / hub** and no tree between boards.
- The nav bar gains an **Add Board** button: it creates a board holding just a root node (named e.g.
  "New Quest") and opens it.
- A board is deleted by deleting its root node. No floor: the last board can go (the user adds a fresh
  one). Deleting the active board activates a neighbour tab; deleting the last one shows the Add Board
  prompt.
- Fresh install seeds exactly **one** board (no linked nodes in the seed).

## Node kinds

- **node** — as today: name, checklist (todos), reward, tier, position. Completed by ticking its boxes
  when unlocked; pays its reward into gold on completion.
- **root node** — the board's tier-0 node. One per board.
- **linked node** — points at another board via `targetBoardId` (null while unlinked). It has **no
  checklist and no reward of its own**. It can be a parent: nodes and linked nodes hang under it like
  any node.

### Tree invariant

Within a board the graph is a single tree rooted at the root node. Every action keeps it connected: no
free-floating nodes, ever.

- **Add child** (node or linked node) — appends a child (edge `parent -> child`), one tier down.
- **Add parent** — inserts a new node between the target and its parent (`P -> N -> M`), dropping the
  target's subtree one tier. The root node has no parent to insert above; adding a parent to the root
  makes the new node the root.
- **Delete** — removes just that node (and the edges touching it), leaving its children detached (their
  subtrees survive as parked orphans); the root node's deletion removes the board.

## Linked node semantics

- **Adding a linked node** attaches an empty (unlinked) linked node as a child of the node it's added
  from, selects it, and opens its detail card in **edit mode** with a **dropdown of every other board**
  (self excluded).
- **Picking a board** sets `targetBoardId`. The linked node's **name live-mirrors** the target board's
  root node name (rename the board, every linked node to it updates).
- With no other boards to pick, the dropdown is empty; the linked node stays unlinked and Go to Board
  disabled.
- The action is **Go to Board**, which routes to (activates) the target board. Disabled while unlinked.
- **Completion**: a linked node is *mastered* exactly when its target board is **complete** (its root
  node is mastered). An **unlinked linked node never masters**. Its mastery unlocks its children by the
  normal rule, so a subtree under an unlinked linked node stays locked.
- A linked node pays **no gold**. Its subtree (regular nodes under it) pays normally, once unlocked.

## Cross-board links

- Linked nodes form a directed multigraph over boards: any board may link any other, including mutual
  or cyclic links. Links are **navigation only** (Go to Board) and completion is read as a boolean,
  never cascaded across boards, so cycles are harmless.
- Cycles are **allowed** (recommended). Banning is a cheap reachability check at selection time if we
  ever want it, but it buys nothing here.
- Deleting a board **unlinks** every linked node pointing at it (they revert to the empty-dropdown
  state); the linked nodes and their subtrees stay put.

## Completion and gold

- A **board is complete** when its root node (tier 0) is mastered.
- The root node has no checklist of its own; it masters via the normal `complete` rule and action like
  any node (unchanged from today's goal), and that is what marks the board complete.
- **Gold** = sum of the reward of every mastered node across **all** boards. Linked nodes contribute
  nothing, so a target board's completion is never double-counted.
- A root node completing still fires the finale celebration; a linked node flipping to mastered (its
  target board finished elsewhere) is silent.

## Data model (v4)

Wire shapes (JSON). `mastered` crosses as an array and rebuilds into a `Set` live, as today; the active
board is not persisted (load opens a default board).

```ts
type Edge = [parentId: string, childId: string]

type Node = {
    id: string
    name: string
    x: number
    y: number
    tier: number
    // Regular and root nodes carry these; a linked node has neither.
    description?: string
    reward?: number
    // Presence marks a linked node: a board id once chosen, null while unlinked. Absent on regular
    // and root nodes.
    targetBoardId?: string | null
}

type Board = {
    id: string
    // The tier-0 node. Its name is the board's tab label; there is no separate board name.
    rootId: string
    nodes: Record<string, Node>
    edges: Edge[]
    // Per-node checklists; root and linked nodes have none.
    todos: Record<string, Todo[]>
    // Ids of nodes the user ticked complete. A linked node is never a member (its mastery is derived).
    mastered: string[]
}

type PersistedSlices = {
    // storage key: questline:v4
    boards: Record<string, Board>
    boardOrder: string[]
    tasks: Task[]
    rewards: Reward[]
    banked: Banked
    notes: Note[]
}
```

**Node kind is positional, not a stored field:**

- root node: `node.id === board.rootId`
- linked node: the `targetBoardId` key is present
- regular node: neither

The old `tag` / `branch` `"Goal"` / `"View"` fields are dropped; display derives from the two rules
above. Deserialize validators (`isBoard` / `isNode`) enforce the shape and reject anything malformed
(no salvage), matching the current strict loader.

**Derived completion (cross-board):**

- `boardComplete(id) = boards[id].rootId ∈ boards[id].mastered`
- a node is mastered when: linked node -> `targetBoardId != null && boardComplete(targetBoardId)`;
  otherwise -> `node.id ∈ board.mastered`
- so `stateOf` / `complete` / `uncomplete` gain access to the boards map (or a `boardComplete` lookup)
  to resolve a linked node's mastery for unlocking its children. Today they work within one board.

**Gold** = sum of `reward` over every id in each board's `mastered` set, across all boards. Linked
nodes are never in a `mastered` set and carry no `reward`, so a target board's completion never
double-counts.

## Ids and routing

- Node and board ids are **globally unique**, minted as `` `${prefix}-${crypto.randomUUID()}` ``
  (`node-...`, `board-...`). No counters: the old monotonic `next*Id` refs and `maxCounter` resume
  plumbing are dropped.
- The hand-authored seed board keeps readable ids (`learn`, `break-steps`); only minted ids are random.
  Tests read a new node's id from the URL hash or the selection instead of hardcoding it.
- The URL hash routes on one token: `#board-<id>` opens a board; `#node-<id>` opens the node's board and
  selects + pans onto it. The owning board is found by scanning boards for the id (trivial N); the
  `board-` / `node-` prefix disambiguates the two namespaces.

## Persistence

- The storage key bumps (e.g. `questline:v4`). **No back-compat / no migration**: prior versions are
  ignored and the app starts from one fresh board.
- Persisted per board: nodes, edges, todos, mastered, and each linked node's `targetBoardId`. Dropped
  from the old model: the Root board, `Project.parentId`, derived mirror chips, and `mirrorPos` (linked
  nodes are real nodes carrying their own `x/y`).
- Sync is unchanged: it rides the same v4 wire through the existing end-to-end envelope and 1 MiB cap,
  only the slice shapes differ. Conflicts adopt a whole document (no field merge), so ids never collide.

## Non-goals

- Untouched: Tasks, Rewards, Scribbles, the sync mechanism, and SFX.
- Deferred: reordering board tabs, and banning link cycles.

## Restructure (drop / abstract / keep)

A rewrite of the board/tree subsystem, not an in-place refactor. Renames live in the Rename map; the
deletes and the extraction below ride Phase 1 (after the Phase 0 rename). Node kind is positional (root
= `id === board.rootId`, linked = `targetBoardId` present); the old `tag` / `branch` fields are
write-only vestigial and dropped everywhere.

### Drop (delete, no refactor)

The whole Root-hub + mirror-chip subsystem:

- `VIEW_MIRROR_PREFIX`, `MIRROR_SPACING`, `EMPTY_IDS`, the derived `view` useMemo in App (depth /
  perDepth layout, mirror synth, `staticIds` / `completeIds`), and the mirror freeze effect.
- `mirrorPos` end to end (state, autosave, serialize, sync slice, `applyLoaded`, the `MirrorPos` type).
- `openView`, `editMirror`, `shownIsView` / `shownIsRootGoal` and their synthesized `shown`, the mirror
  hash-routing branches, and the `data-view-popover` guard (a dead attribute nothing mints).
- `ROOT_ID`, `ROOT_DESC`, `rootProject`, `Project.parentId` (field + `newProject` param + `removeProject`
  reparenting), and the `earnedGold` Root-skip.
- `tag` / `branch` fields (Goal / View / Track / Plan / Step), never read for render.
- `next*Id` counters and `maxCounter` (random ids replace them).
- `addView` splits into `addBoard` (nav) and `addLinkedNode`; its mirror-chip branch is deleted.

### Abstract (lift into pure `board.ts` ops + a reducer)

App's tree handlers each close over `activeId` and hand-spread the active project; lift them into pure
`(board, ...) -> board` ops behind a boards reducer: the todo ops, complete / uncomplete, `editNode`,
`moveNode`, `addChild`, `addParent` (`insertParent` is already pure), `deleteNode`, and `removeBoard`
(reshaped: no floor, no reparenting, unlink every linked node pointing at the deleted board), plus new
`addLinkedNode` / `setLinkedTarget`. `stateOf` / `complete` and `earnedGold` take a boards-aware
`boardComplete` lookup so a linked node resolves mastery from its target board.

### Keep

Node-agnostic logic survives (rename-only if its file is renamed): `insertParent`, `stateOf` /
`complete` / `uncomplete` / `parentOf` / `childrenOf` / `descendantsOf`, the edge and node-card visuals,
`NODE_SIZE`, the tree's drag / focus / fit + position-sync, the `serialize` / `deserialize` /
`loadState` / `saveState` mechanics (bump version, no migration), every persist validator, and all of
`sync/*` (decoupled through `PersistedSlices`). `MilestoneTree`'s `makeViewNode` is rewritten as a real,
draggable `makeLinkedNode` (kind by `targetBoardId`, not a static-id set).

### Tests

- Rewrite: `App.spec` (drop the Root-tab / hub / mirror / view-chip suites; add Add Board, linked-node
  add/pick/Go-to-Board, delete-unlinks), `project.spec` -> `board.spec`, `persist.spec` (v4 shape),
  `NodeDetailCard.spec` (isLinked, board dropdown), `MilestoneTree.spec` -> `BoardTree.spec`,
  `rewards.e2e` (drop the Root-hub gold case), `sync/sync.spec` (boards fixture), `sfxWiring.spec`
  (`data-linked-node`).
- Rename-only: `MilestoneEdge.spec` -> `Edge.spec`, `MilestoneNode.spec` -> `NodeCard.spec`,
  `GoalCelebration.spec` -> `BoardCelebration.spec`, `graph.spec` (+ `boardComplete` cases),
  `TabBar.spec` (drop pinned), `NavActions.spec` (+ Add Board).
- Untouched: tasks, rewards, notes, sfx, `sync/{compress,crypto}`, and the generic UI specs.

## Rollout phases

Sequential; each ends green (typecheck, tests, build) and ships on its own.

### Phase 0 — Rename to the new vocabulary

Mechanical, no behavior change: apply the whole Rename map (files, types, vars, tests, id prefixes,
data-attrs, testids), including `GoalCelebration` -> `BoardCelebration`, `goalDoneRef` ->
`boardDoneRef`, `data-view-node` -> `data-linked-node`, and dropping the dead `data-view-popover`. The
Root hub and mirror chips keep working under the new names; thematic "Quest" copy stays. Isolates the
rename from any logic change so the next phases are behavior-only diffs.

### Phase 1 — Flatten boards + restructure (drop Root, extract `board.ts`)

- Remove the Root hub, `parentId`, auto-derived mirror chips + `mirrorPos`, and drop the vestigial
  `tag` / `branch` fields; node kind becomes positional (root = `id === board.rootId`).
- v4 data model + storage-key bump (`questline:v4`), no migration; new `isBoard` / `isNode` validators;
  seed exactly one board.
- Switch id generation to random `` `${prefix}-${crypto.randomUUID()}` ``; delete the `next*Id`
  counters and `maxCounter`.
- Rework URL hash routing: `#board-<id>` / `#node-<id>` resolve by scanning boards; drop the mirror
  hash branches.
- Lift App's tree handlers into pure `board.ts` ops behind a boards reducer (the Restructure "abstract"
  list); make `earnedGold` sum mastered nodes across all boards.
- Boards are equal tabs; **Add Board** in the nav creates + opens a fresh board (root node only); delete
  a board by deleting its root node; no floor; zero-board state shows an Add Board prompt.
- Cross-board linking is absent this phase (the old add-sub-view is gone; linked nodes arrive next).
- Heavy phase; optionally split the `board.ts` + reducer extraction (1a) from the Root drop (1b).

### Phase 2 — Linked nodes (structure + navigation)

- Add the linked-node kind with `targetBoardId` (nullable), a real tree node (has `x/y`, can parent);
  rewrite `makeViewNode` as a draggable `makeLinkedNode` (kind by `targetBoardId`, not a static-id set).
- **Add linked node** on any node attaches an unlinked child, selects it, opens its card in edit mode
  with a **board dropdown** (self excluded); `editMirror` is replaced by `setLinkedTarget`.
- Picking a board sets `targetBoardId`; the name **live-mirrors** the target's root node name.
- **Go to Board** routes to the target (disabled while unlinked).
- Deleting a board unlinks every linked node that pointed at it.
- Completion is not wired yet: a linked node stays unmastered (cosmetic), its children follow normal
  rules as if under an incomplete parent.

### Phase 3 — Linked-node completion + unlock

- Give `stateOf` / `complete` a boards-aware `boardComplete(id)` lookup: a linked node masters exactly
  when its target board is complete (root node mastered); an unlinked one never masters.
- Its mastery unlocks its children by the normal rule; a subtree under an unlinked node stays locked.
- Confirm linked nodes pay no gold and never double-count a target board's completion.

## Removed

- Root board / hub, `parentId` board tree, auto-derived mirror chips, `mirrorPos`.

# Detach a node (persisted) + re-attach (click-to-attach)

Adds a **Detach** action to a node's edit-mode card that cuts the node (with its whole subtree) off its
parent **for real** — the edge removal is persisted immediately — and arms an optional re-hang: click or
tap a node to re-attach the branch under it. If you don't attach, the branch stays **actually detached
(orphaned)**, parked in a new disabled `"detached"` state, and re-homeable later via an **Attach** action
on its card. Layers on the tree/board model (SPEC.md); vocabulary is node / root node / board / edge. No
schema change: an edge already stores `[parentId, childId]`, so detach drops one edge and attach adds /
rewires one.

## Entry

- Edit mode gains a **Detach** button (Unlink icon) on every non-root node that still hangs on the tree,
  alongside add-child / add-parent / delete. A **parked orphan** shows an **Attach** button (Link icon)
  in its place; the root node shows neither (it has no parent).
- Clicking **Detach** removes the node's incoming edge **and persists that removal**, then enters
  **attach mode** (armed) so the loose branch can be re-hung at once.

## Attach mode

- **The cut-loose branch is `"detached"`.** With no path back to the root node it derives the new
  `"detached"` state by the normal reachability rule (dimmed / dashed, disabled — not completable, and it
  pays no gold); the rest of the board stays interactive.
- The board is not frozen: pan and zoom stay live so the user can reach a target.
- Entering attach mode dismisses the open detail card; while armed, a click / tap on a node
  **attaches** instead of selecting it. After a successful attach, selection returns to the moved node.
- A loose edge trails the pointer:
  - **Mouse** — one end pinned to the detached node, the other rubber-banding to the cursor; hovering a
    valid target highlights it (invalid targets stay dim).
  - **Touch** — no hover to follow, so the detached node shows an armed highlight and a hint ("Tap a
    node to reattach"). Only a **tap** attaches: a press that drifts past a small move threshold is a
    pan, not an attach, so panning to reach a target never misfires.
- One reparent at a time; Detach / Attach is unavailable on other nodes while armed.

## Targets

- A click / tap on a **valid** node attaches: the detached node is reparented under it (`newParent ->
  node` edge added, or simply added for a parked orphan with no incoming edge), reconnecting the whole
  branch to the tree.
- **Valid** = a node in the **same board** that is **reachable from the root** (so you can only re-home
  under the live tree, never under another parked branch) and is neither the detached node itself nor one
  of its descendants (attaching to a descendant would cycle). Invalid targets are non-clickable / not
  highlighted.
- **Cancel** = Escape, a click / tap on empty canvas, or a click / tap on the detached node itself:
  **only the arm is dropped — there is no revert.** The (already-persisted) detach stands, so the branch
  stays parked as a disabled `"detached"` orphan until it is re-attached.

## Re-attach a parked branch

- A parked orphan's card offers an **Attach** action (edit mode). It arms attach mode for that node
  without detaching anything (the node is already loose), then a click / tap on a valid target re-homes
  it exactly like a fresh detach.
- Re-attaching restores everything the branch kept while parked: its mastered marks were never cleared,
  so its gold payout returns the moment it is reachable from the root again.

## What moves

- **Detach** drops only the node's single incoming edge. The node, its **whole subtree**, every `x/y`,
  tier, checklist, and **mastered mark** stay exactly as they were — nothing is un-mastered (losing a
  child can never break a parent's completeness).
- **Attach** carries the whole subtree; the one incoming edge is rewired (or simply added, for a parked
  orphan). Each moved node **keeps its `x/y`** (position is untouched); tier is recomputed for the moved
  subtree so it stays `parent tier + 1` down the branch.
- On attach, the **new parent** (and its now-inconsistent ancestors) drop out of the completed set, since
  it gained a possibly-incomplete child (mirrors add-child / insert-parent). Moved nodes keep their own
  mastered marks.
- Completion re-resolves from reachability: while parked, the whole branch reads `"detached"` (disabled,
  no gold); once re-attached it returns to `locked` / `available` / `mastered` per its new path to the
  root, and its gold counts again.

## Persisted (no revert)

- **Detach persists immediately**: the edge removal is a real board op, so the branch is genuinely
  orphaned and survives a reload. There is no ephemeral "view-only" detach and no revert-on-cancel.
- Cancelling an arm (Escape / empty canvas / clicking the lifted node) drops only the transient arm — the
  branch stays parked as a disabled `"detached"` orphan. Only re-attaching (a committed `reparent`)
  reconnects it. The `"detached"` state itself is **derived** from reachability, never stored.

## Linked nodes

- A linked node reparents like any node (it has a parent and a subtree). Its `targetBoardId` and derived
  completion are unaffected by the move.

## Rollout phases

Sequential; each ends green (typecheck, tests, build) and ships on its own.

### Phase 1 — Reparent mechanic (pure op + desktop)

- Pure `reparent(board, nodeId, newParentId)`: reject the node itself and any descendant, else rewire
  the incoming edge, recompute the moved subtree's tiers, un-master the new parent up the chain, keep
  `x/y`. Unit-tested.
- **Detach** button on every non-root node's edit card; clicking it dismisses the card, detaches the
  edge, and arms reparent mode. The detached subtree goes inert (`locked` via derivation); the board
  stays live.
- Mouse: a rubber-band edge trails the cursor; a click on a valid target attaches; Escape, empty
  canvas, or the detached node cancels the arm. Selection returns to the moved node on attach.
  Interaction-tested.

### Phase 2 — Mobile + affordances

- Touch: a **tap** attaches, a press past the press-move threshold pans (never misfires); the detached
  node shows an armed highlight and the "Tap a node to reattach" hint.
- Hovering a valid target highlights it (invalid targets stay dim); the rubber-band overlay respects
  reduced-motion.

### Phase 3 — Detach persists (the parked-orphan model)

- Detach is a **persisted** board op `detach(board, nodeId)` (drops the single incoming edge, keeps
  everything else, un-masters nothing). Cancelling an arm no longer reverts — the branch stays parked.
- New derived `"detached"` state via a `reachableFromRoot(id, rootId, edges)` gate in `stateOf` (checked
  first, wins over mastered/available/locked); `boardGold` skips unreachable mastered nodes. `reparent`
  now also re-homes a parentless orphan (adds the edge). A parked node's card offers **Attach** (Link
  icon) in place of Detach, and a disabled `"Detached"` read-mode action with a re-attach hint.

## Tests

- Unit-test the pure `reparent` op: rejects the node itself / a descendant / the root (no-op, same
  reference); rewires the incoming edge (or **adds** it for a parked orphan), recomputes the moved
  subtree's tiers, un-masters the new parent up the chain, and keeps every moved node's `x/y`.
- Unit-test `detach`: removes only the incoming edge, keeps the subtree / positions / mastered marks;
  no-ops (same reference) on the root or an already-parentless node. `boardGold` drops a mastered node
  once it's detached and counts it again after re-attach. `stateOf` returns `"detached"` for an
  unreachable node when a `rootId` is passed (precedence over mastered), unchanged when omitted.
- Interaction test: Detach persists (edge removed, node reads `"detached"`, disabled); cancel leaves it
  parked; the parked node's card offers **Attach**, and attaching re-homes it under a clicked valid
  target; a descendant / an unreachable node is not a valid target.

## Implementation notes

- App / BoardTree hold a transient `reparenting: { nodeId } | null`; detach persists the edge removal
  before arming, so no original-parent id is stashed and cancel never reverts.
- `detach(board, nodeId)` is a pure board op (a `boardsReducer` `"detach"` case); attach is the pure
  `reparent(board, nodeId, newParentId)` op, which now also handles a parentless orphan by adding the
  edge. Both keep `x/y` and references stable on a no-op.
- Target hit-testing reuses the existing node-click path; the rubber-band edge is a pointer-tracked
  overlay drawn only while armed (respects reduced-motion). The tap-vs-pan threshold reuses the app's
  existing press-move tolerance.
- Attach is pointer / tap only; keyboard-driven attach is a non-goal (Escape still cancels the arm).
- No validator or `PersistedSlices` schema change: `detach` only mutates the existing `edges` array,
  which already persists structurally.

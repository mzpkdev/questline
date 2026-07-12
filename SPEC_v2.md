# Reparent a node (detach + click-to-attach)

Adds an **Unconnect** action to a node's edit-mode card that lifts the node (with its whole subtree) off
its parent and re-hangs it under a node you then click or tap. Layers on the tree/board model
(SPEC.md); vocabulary is node / root node / board / edge, and the mechanic is the same on the current
tree or the post-SPEC board model. No schema change: an edge already stores `[parentId, childId]`, so a
reparent just rewires one edge.

## Entry

- Edit mode gains an **Unconnect** button on every node **except the root node** (the root has no
  parent to detach from), alongside add-child / add-parent / delete.
- Clicking it detaches the node from its parent and enters **reparent mode** (armed): the node's
  incoming edge is removed and the branch is loose, waiting to be re-hung.

## Reparent mode

- **Only the detached subtree goes inert.** With no path back to the root node it resolves to `locked`
  by the normal state derivation (dimmed, not completable); the rest of the board stays interactive.
- The board is not frozen: pan and zoom stay live so the user can reach a target.
- Entering reparent mode dismisses the open detail card; while armed, a click / tap on a node
  **attaches** instead of selecting it. After a successful attach, selection returns to the moved node.
- A loose edge trails the pointer:
  - **Mouse** — one end pinned to the detached node, the other rubber-banding to the cursor; hovering a
    valid target highlights it (invalid targets stay dim).
  - **Touch** — no hover to follow, so the detached node shows an armed highlight and a hint ("Tap a
    node to reattach"). Only a **tap** attaches: a press that drifts past a small move threshold is a
    pan, not an attach, so panning to reach a target never misfires.
- One reparent at a time; Unconnect is unavailable on other nodes while armed.

## Targets

- A click / tap on a **valid** node attaches: the detached node is reparented under it (`newParent ->
  node` edge added), reconnecting the whole branch to the tree.
- **Valid** = a node in the **same board** that is neither the detached node itself nor one of its
  descendants (attaching to a descendant would cycle). Invalid targets are non-clickable / not
  highlighted.
- **Cancel** = Escape, a click / tap on empty canvas, or a click / tap on the detached node itself: the
  node reattaches to its **original** parent. No orphan is ever left or persisted.

## What moves on attach

- The node carries its **whole subtree**; only the one incoming edge is rewired.
- Each moved node **keeps its `x/y`** (position is untouched); tier is recomputed for the moved subtree
  so it stays `parent tier + 1` down the branch.
- The **new parent** (and its now-inconsistent ancestors) drop out of the completed set, since it
  gained a possibly-incomplete child (mirrors add-child / insert-parent). Moved nodes keep their own
  mastered marks.
- Completion re-resolves from the reconnected tree: a subtree that was `locked` while detached returns
  to `locked` / `available` / `mastered` per its new path to the root.

## Ephemeral

- The armed / detached state is **transient UI**, never persisted. A reload mid-detach reverts to the
  original parent; only a committed reparent (the rewired edge) is saved.

## Linked nodes

- A linked node reparents like any node (it has a parent and a subtree). Its `targetBoardId` and derived
  completion are unaffected by the move.

## Rollout phases

Sequential; each ends green (typecheck, tests, build) and ships on its own.

### Phase 1 — Reparent mechanic (pure op + desktop)

- Pure `reparent(board, nodeId, newParentId)`: reject the node itself and any descendant, else rewire
  the incoming edge, recompute the moved subtree's tiers, un-master the new parent up the chain, keep
  `x/y`. Unit-tested.
- **Unconnect** button on every non-root node's edit card; clicking it dismisses the card, detaches the
  edge, and arms reparent mode. The detached subtree goes inert (`locked` via derivation); the board
  stays live.
- Mouse: a rubber-band edge trails the cursor; a click on a valid target attaches; Escape, empty
  canvas, or the detached node cancels back to the original parent. Selection returns to the moved node
  on attach. Ephemeral (never persisted). Interaction-tested.

### Phase 2 — Mobile + affordances

- Touch: a **tap** attaches, a press past the press-move threshold pans (never misfires); the detached
  node shows an armed highlight and the "Tap a node to reattach" hint.
- Hovering a valid target highlights it (invalid targets stay dim); the rubber-band overlay respects
  reduced-motion.

## Tests

- Unit-test the pure `reparent(board, nodeId, newParentId)` op: rejects the node itself and any of its
  descendants (no-op, same reference); on a valid target rewires the incoming edge to `[newParentId,
  nodeId]`, recomputes the moved subtree's tiers, un-masters the new parent up the chain, and keeps every
  moved node's `x/y`.
- Light interaction test: Unconnect arms the mode and detaches the edge; tapping a valid target moves the
  edge and reconnects the branch; Escape / empty-tap reverts to the original parent; a descendant is not
  a valid target.

## Implementation notes

- App / BoardTree hold a transient `reparenting: nodeId | null`; entering it stashes the original parent
  id for cancel.
- Attach is a pure board op `reparent(board, nodeId, newParentId)`: reject when `newParentId` is the node
  or a descendant; else replace the node's incoming edge with `[newParentId, nodeId]`, recompute the
  moved subtree's tiers, and un-master the new parent up the chain. Keeps `x/y`.
- Target hit-testing reuses the existing node-click path; the rubber-band edge is a pointer-tracked
  overlay drawn only while armed (respects reduced-motion). The tap-vs-pan threshold reuses the app's
  existing press-move tolerance.
- Attach is pointer / tap only; keyboard-driven attach is a non-goal (Escape still cancels).
- No persistence, validator, or `PersistedSlices` change.

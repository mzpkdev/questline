import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { decompressFromUTF16 } from "lz-string"
import { App } from "./App"

// React Flow wraps each custom node in its own div that also carries data-id; our node's
// root is the one that also has data-state, so we target [data-id][data-state]. Clicks use
// fireEvent (not userEvent) to avoid React Flow's d3-zoom mousedown path crashing under jsdom.
const nodeRoot = (id: string) => document.querySelector(`[data-id="${id}"][data-state]`)
// A linked node is a real node too, but its card carries data-linked-node (no data-state), so match on
// that. Its id is minted at random, so tests read it from the URL hash after it's added.
const linkedNode = (id: string) => document.querySelector(`[data-id="${id}"][data-linked-node]`)
const selectedNodeId = () => window.location.hash.slice(1)
const waitForNode = (id: string) =>
    waitFor(() => {
        const el = nodeRoot(id)
        if (!el) throw new Error(`node ${id} not mounted yet`)
        return el as HTMLElement
    })

// Boards are equal tabs now: the app boots straight to the first (seed) board with its whole tree on
// screen. Selecting the board's root (its card) is a click on the tab, labelled after that root node.
const selectSeedRoot = () => fireEvent.click(screen.getByRole("button", { name: "Learn Questline" }))

// localStorage now holds lz-string-compressed JSON under the v4 key; unpack it to assert on the saved roadmap.
const savedRoadmap = () => decompressFromUTF16(localStorage.getItem("questline:v4") ?? "") ?? ""

describe("App", () => {
    // The app reads/writes window.location.hash for routing; reset it so tests don't leak into each other.
    beforeEach(() => {
        window.history.replaceState(null, "", window.location.pathname)
        localStorage.clear()
    })

    it("boots straight to the seed board (no Root hub) with its tree on screen", async () => {
        render(<App />)
        await waitForNode("learn")
        // The seed board is the one tab; there is no pinned "Quest Board" hub.
        expect(screen.getByRole("button", { name: "Learn Questline" })).toBeInTheDocument()
        expect(screen.queryByRole("button", { name: /quest board/i })).toBeNull()
        // Child nodes are on screen from the start (no tab switch needed to reveal them).
        expect(screen.getByText("Plan your goal")).toBeInTheDocument()
    })

    context("when a node is clicked", () => {
        it("swaps the detail card to that node", async () => {
            render(<App />)
            const node = await waitForNode("plan-goal")
            fireEvent.click(node)
            expect(await screen.findByRole("heading", { name: /plan your goal/i })).toBeInTheDocument()
        })
    })

    context("completing a node", () => {
        it("unlocks the parent once a leaf's boxes are checked and it is marked complete", async () => {
            render(<App />)
            // finish-node is a leaf; its parent track-progress starts locked (its only child is
            // still incomplete).
            const leaf = await waitForNode("finish-node")
            expect(nodeRoot("track-progress")?.getAttribute("data-state")).toBe("locked")

            fireEvent.click(leaf)
            await screen.findByRole("heading", { name: /finish a node/i })

            fireEvent.click(screen.getByRole("button", { name: "Check Tick this box" }))
            fireEvent.click(screen.getByRole("button", { name: "Check Then tick this one" }))
            fireEvent.click(screen.getByRole("button", { name: "Mark Complete" }))

            await waitFor(() => {
                expect(nodeRoot("finish-node")?.getAttribute("data-state")).toBe("mastered")
                expect(nodeRoot("track-progress")?.getAttribute("data-state")).toBe("available")
            })
        })

        it("cannot complete a leaf while any box is unchecked", async () => {
            render(<App />)
            const leaf = await waitForNode("finish-node")

            fireEvent.click(leaf)
            await screen.findByRole("heading", { name: /finish a node/i })

            expect(screen.getByRole("button", { name: "Mark Complete" })).toBeDisabled()
            expect(nodeRoot("finish-node")?.getAttribute("data-state")).toBe("available")
        })
    })

    context("completing a board's root node", () => {
        it("fires the finale fanfare over the board", async () => {
            render(<App />)
            await waitForNode("learn")

            // A fresh board's root is a lone leaf: add one, then complete its root.
            fireEvent.click(screen.getByRole("button", { name: "Add board" }))
            // The new board's root card opens in edit mode; finish editing to reveal the action.
            fireEvent.click(await screen.findByRole("button", { name: "Finish editing" }))
            expect(screen.queryByTestId("board-celebration")).toBeNull()

            fireEvent.click(await screen.findByRole("button", { name: "Complete Quest" }))

            expect(await screen.findByTestId("board-celebration")).toBeInTheDocument()
        })
    })

    context("editing a node", () => {
        it("renames the node live in the tree", async () => {
            render(<App />)
            const node = await waitForNode("plan-goal")

            fireEvent.click(node)
            await screen.findByRole("heading", { name: /plan your goal/i })

            fireEvent.click(screen.getByRole("button", { name: "Edit" }))
            fireEvent.change(screen.getByDisplayValue("Plan your goal"), { target: { value: "Plan it out" } })

            await waitFor(() => expect(nodeRoot("plan-goal")?.textContent).toContain("Plan it out"))
        })
    })

    context("tabs", () => {
        it("renames the tab when the root node is renamed", async () => {
            render(<App />)
            await waitForNode("learn")

            selectSeedRoot()
            fireEvent.click(screen.getByRole("button", { name: "Edit" }))
            fireEvent.change(screen.getByDisplayValue("Learn Questline"), { target: { value: "Launch 1.0" } })

            expect(await screen.findByRole("button", { name: "Launch 1.0" })).toBeInTheDocument()
        })

        it("renames the root node when the tab is renamed", async () => {
            render(<App />)
            await waitForNode("learn")

            fireEvent.dblClick(screen.getByRole("button", { name: "Learn Questline" }))
            const input = screen.getByRole("textbox", { name: "Rename board" })
            fireEvent.change(input, { target: { value: "Big Launch" } })
            fireEvent.keyDown(input, { key: "Enter" })

            await waitFor(() => expect(nodeRoot("learn")?.textContent).toContain("Big Launch"))
        })
    })

    context("Add Board", () => {
        it("creates and opens a fresh, blank board holding just a root node", async () => {
            render(<App />)
            await waitForNode("learn")

            fireEvent.click(screen.getByRole("button", { name: "Add board" }))

            // The new board opens on a lone "New Quest" root (its card in edit mode); the seed tree is gone.
            await waitFor(() => expect(nodeRoot("learn")).toBeNull())
            expect(screen.getByRole("button", { name: "New Quest" })).toBeInTheDocument() // the new tab
            expect(screen.getByDisplayValue("New Quest")).toBeInTheDocument() // root card, edit mode
            // The seed board is still a tab (boards are equal; nothing was replaced).
            expect(screen.getByRole("button", { name: "Learn Questline" })).toBeInTheDocument()
        })
    })

    context("adding a sub-node", () => {
        it("drops a new child node under the selected node", async () => {
            render(<App />)
            const leaf = await waitForNode("finish-node")

            fireEvent.click(leaf)
            await screen.findByRole("heading", { name: /finish a node/i })
            fireEvent.click(screen.getByRole("button", { name: "Edit" }))
            fireEvent.click(screen.getByRole("button", { name: "Add child node" }))

            expect(await screen.findByText("New Node")).toBeInTheDocument()
        })

        it("focuses a newly added sub-node, writing a random node id to the url", async () => {
            render(<App />)
            const leaf = await waitForNode("finish-node")

            fireEvent.click(leaf)
            await screen.findByRole("heading", { name: /finish a node/i })
            fireEvent.click(screen.getByRole("button", { name: "Edit" }))
            fireEvent.click(screen.getByRole("button", { name: "Add child node" }))

            // The new node becomes the selection, so the url follows it -- a random `#node-<uuid>`.
            await waitFor(() => expect(window.location.hash).toMatch(/^#node-/))
        })

        it("un-completes a completed parent when a fresh child is added", async () => {
            render(<App />)
            const step = await waitForNode("break-steps")
            expect(step.getAttribute("data-state")).toBe("mastered")

            fireEvent.click(step)
            await screen.findByRole("heading", { name: /break it into steps/i })
            fireEvent.click(screen.getByRole("button", { name: "Edit" }))
            fireEvent.click(screen.getByRole("button", { name: "Add child node" }))

            await waitFor(() => expect(nodeRoot("break-steps")?.getAttribute("data-state")).toBe("locked"))
        })
    })

    context("adding a parent node", () => {
        it("promotes a new gold root above the old one and renames the tab", async () => {
            render(<App />)
            await waitForNode("learn")

            // Selecting the board's root, then adding a parent, promotes a new tier-0 root above it.
            selectSeedRoot()
            fireEvent.click(screen.getByRole("button", { name: "Edit" }))
            fireEvent.click(screen.getByRole("button", { name: "Add parent node" }))

            // The tab follows the new root name, instantly (the tab is a button named after the root).
            expect(await screen.findByRole("button", { name: "New Node" })).toBeInTheDocument()
            expect(screen.queryByRole("button", { name: "Learn Questline" })).toBeNull()
            // The old root drops to normal size; the new node renders at root size (the one 240px card).
            expect((nodeRoot("learn") as HTMLElement).style.width).toBe("180px")
            const rootCards = Array.from(document.querySelectorAll("[data-id][data-state]")).filter(
                (el) => (el as HTMLElement).style.width === "240px"
            )
            expect(rootCards).toHaveLength(1)
            expect(rootCards[0]?.textContent).toContain("New Node")
        })
    })

    context("reparenting a node (Detach + click-to-attach)", () => {
        const band = () => screen.queryByTestId("reparent-band")

        it("offers Detach on a non-root node's edit card, but never on the root", async () => {
            render(<App />)
            const leaf = await waitForNode("finish-node")

            // A non-root node offers Detach in edit mode.
            fireEvent.click(leaf)
            await screen.findByRole("heading", { name: /finish a node/i })
            fireEvent.click(screen.getByRole("button", { name: "Edit" }))
            expect(screen.getByRole("button", { name: "Detach node" })).toBeInTheDocument()

            // The root node never does -- it has no parent to detach from.
            selectSeedRoot()
            await screen.findByRole("heading", { name: /learn questline/i })
            fireEvent.click(screen.getByRole("button", { name: "Edit" }))
            expect(screen.queryByRole("button", { name: "Detach node" })).toBeNull()
        })

        it("arms on Detach, then attaches the branch under a clicked valid target", async () => {
            render(<App />)
            await waitForNode("finish-node")

            // Seed baseline: plan-goal is unlocked (break-steps is done), track-progress is locked.
            expect(nodeRoot("plan-goal")?.getAttribute("data-state")).toBe("available")
            expect(nodeRoot("track-progress")?.getAttribute("data-state")).toBe("locked")

            // Detach finish-node: the card dismisses, the loose edge appears, and track-progress -- now
            // childless in the derived view -- reads as available while its old child floats detached.
            fireEvent.click(nodeRoot("finish-node") as Element)
            await screen.findByRole("heading", { name: /finish a node/i })
            fireEvent.click(screen.getByRole("button", { name: "Edit" }))
            fireEvent.click(screen.getByRole("button", { name: "Detach node" }))

            expect(await screen.findByTestId("reparent-band")).toBeInTheDocument()
            await waitFor(() => expect(nodeRoot("track-progress")?.getAttribute("data-state")).toBe("available"))

            // Click plan-goal (a valid target): the branch re-hangs under it and the mode disarms.
            fireEvent.click(nodeRoot("plan-goal") as Element)

            await waitFor(() => expect(band()).toBeNull())
            // plan-goal now owns an incomplete child -> locked; track-progress keeps no child -> available.
            await waitFor(() => {
                expect(nodeRoot("plan-goal")?.getAttribute("data-state")).toBe("locked")
                expect(nodeRoot("track-progress")?.getAttribute("data-state")).toBe("available")
            })
            // Selection returns to the moved node.
            expect(window.location.hash).toBe("#finish-node")
        })

        it("cancels back to the original parent on an empty-canvas click", async () => {
            render(<App />)
            await waitForNode("finish-node")

            fireEvent.click(nodeRoot("finish-node") as Element)
            await screen.findByRole("heading", { name: /finish a node/i })
            fireEvent.click(screen.getByRole("button", { name: "Edit" }))
            fireEvent.click(screen.getByRole("button", { name: "Detach node" }))
            await screen.findByTestId("reparent-band")
            await waitFor(() => expect(nodeRoot("track-progress")?.getAttribute("data-state")).toBe("available"))

            // A click on the empty board area (outside any node) cancels: finish-node snaps back under
            // track-progress, which locks again, and the loose edge is gone.
            fireEvent.click(document.querySelector(".board-surface") as Element)

            await waitFor(() => expect(band()).toBeNull())
            await waitFor(() => {
                expect(nodeRoot("track-progress")?.getAttribute("data-state")).toBe("locked")
                expect(nodeRoot("plan-goal")?.getAttribute("data-state")).toBe("available")
            })
        })

        it("ignores a descendant as a target, and Escape cancels the arm", async () => {
            render(<App />)
            await waitForNode("track-progress")

            // Detach track-progress (which carries finish-node beneath it).
            fireEvent.click(nodeRoot("track-progress") as Element)
            await screen.findByRole("heading", { name: /track your progress/i })
            fireEvent.click(screen.getByRole("button", { name: "Edit" }))
            fireEvent.click(screen.getByRole("button", { name: "Detach node" }))
            await screen.findByTestId("reparent-band")

            // finish-node is a descendant of track-progress, so it's not a valid target: clicking it
            // does nothing and the mode stays armed.
            fireEvent.click(nodeRoot("finish-node") as Element)
            expect(band()).toBeInTheDocument()

            // Escape cancels the arm.
            fireEvent.keyDown(document, { key: "Escape" })
            await waitFor(() => expect(band()).toBeNull())
        })
    })

    context("linked nodes", () => {
        // Create a second board "New Quest" (B), return to the seed board (A), add a linked node under
        // finish-node, and point it at B. Returns the linked node's (random) id from the URL hash.
        async function linkSeedNodeToNewBoard(): Promise<string> {
            fireEvent.click(screen.getByRole("button", { name: "Add board" }))
            await screen.findByDisplayValue("New Quest") // B's root card, edit mode
            fireEvent.click(screen.getByRole("button", { name: "Learn Questline" })) // back to seed board A

            const leaf = await waitForNode("finish-node")
            fireEvent.click(leaf)
            await screen.findByRole("heading", { name: /finish a node/i })
            fireEvent.click(screen.getByRole("button", { name: "Edit" }))
            fireEvent.click(screen.getByRole("button", { name: "Add linked node" }))

            const dropdown = await screen.findByRole("combobox", { name: "Link to board" })
            const option = within(dropdown).getByRole("option", { name: "New Quest" }) as HTMLOptionElement
            fireEvent.change(dropdown, { target: { value: option.value } })
            return selectedNodeId()
        }

        it("attaches a linked node, selects it, and opens its card in edit mode", async () => {
            render(<App />)
            const leaf = await waitForNode("finish-node")

            fireEvent.click(leaf)
            await screen.findByRole("heading", { name: /finish a node/i })
            fireEvent.click(screen.getByRole("button", { name: "Edit" }))
            fireEvent.click(screen.getByRole("button", { name: "Add linked node" }))

            // The new linked node becomes the selection (a random #node-<uuid> in the url)...
            await waitFor(() => expect(window.location.hash).toMatch(/^#node-/))
            const id = selectedNodeId()
            // ...it's a real linked node on the tree (data-linked-node, not a node card)...
            await waitFor(() => expect(linkedNode(id)).not.toBeNull())
            expect(nodeRoot(id)).toBeNull()
            // ...and its card opened in edit mode, showing the board dropdown.
            expect(screen.getByRole("combobox", { name: "Link to board" })).toBeInTheDocument()
        })

        it("has an empty dropdown and a disabled Go to Board when there is no other board", async () => {
            render(<App />)
            const leaf = await waitForNode("finish-node")

            fireEvent.click(leaf)
            await screen.findByRole("heading", { name: /finish a node/i })
            fireEvent.click(screen.getByRole("button", { name: "Edit" }))
            fireEvent.click(screen.getByRole("button", { name: "Add linked node" }))

            const dropdown = await screen.findByRole("combobox", { name: "Link to board" })
            // Only the placeholder option (the seed board itself is excluded, and it's the only board).
            expect(dropdown.querySelectorAll("option")).toHaveLength(1)
            // Go to Board is read-mode only: leave edit mode, where it renders but stays disabled (unlinked).
            fireEvent.click(screen.getByRole("button", { name: "Finish editing" }))
            expect(screen.getByRole("button", { name: "Go to Board" })).toBeDisabled()
        })

        it("sets the target on pick, and live-mirrors the target board's name onto the linked node", async () => {
            render(<App />)
            await waitForNode("learn")

            const id = await linkSeedNodeToNewBoard()
            // The linked node now reads its target board's root name.
            await waitFor(() => expect(linkedNode(id)?.textContent).toContain("New Quest"))

            // Rename board B via its tab; the linked node's label follows live (it's derived, not copied).
            fireEvent.dblClick(screen.getByRole("button", { name: "New Quest" }))
            const input = screen.getByRole("textbox", { name: "Rename board" })
            fireEvent.change(input, { target: { value: "Renamed Quest" } })
            fireEvent.keyDown(input, { key: "Enter" })

            await waitFor(() => expect(linkedNode(id)?.textContent).toContain("Renamed Quest"))
        })

        it("navigates to the target board when Go to Board is clicked", async () => {
            render(<App />)
            await waitForNode("learn")

            await linkSeedNodeToNewBoard()
            // Go to Board is read-mode only, so leave edit mode before navigating.
            fireEvent.click(screen.getByRole("button", { name: "Finish editing" }))
            fireEvent.click(screen.getByRole("button", { name: "Go to Board" }))

            // Now on board B: its root node "New Quest" is shown and the seed tree is gone.
            await waitFor(() => expect(nodeRoot("learn")).toBeNull())
            expect(await screen.findByRole("heading", { name: "New Quest" })).toBeInTheDocument()
        })

        it("unlinks a linked node when its target board is deleted, leaving the node in place", async () => {
            render(<App />)
            await waitForNode("learn")

            const id = await linkSeedNodeToNewBoard()
            await waitFor(() => expect(linkedNode(id)?.textContent).toContain("New Quest"))

            // Delete board B via its root card.
            fireEvent.click(screen.getByRole("button", { name: "New Quest" })) // switch to B
            await screen.findByRole("heading", { name: "New Quest" })
            fireEvent.click(screen.getByRole("button", { name: "Edit" }))
            fireEvent.click(screen.getByRole("button", { name: "Delete board" }))
            fireEvent.click(await screen.findByRole("button", { name: "Delete" }))

            // Back on the seed board, the linked node survives but has reverted to unlinked.
            await waitFor(() => expect(linkedNode(id)?.textContent).toContain("Unlinked"))
        })

        it("locks a subtree under an incomplete linked node, and unlocks it once the target board completes", async () => {
            render(<App />)
            await waitForNode("learn")

            // Aim finish-node's new linked node L at board B (still incomplete); L's card stays in
            // edit mode, so add a regular child C under it.
            await linkSeedNodeToNewBoard()
            fireEvent.click(screen.getByRole("button", { name: "Add child node" }))
            await waitFor(() => expect(window.location.hash).toMatch(/^#node-/))
            const childId = selectedNodeId()

            // C sits under an incomplete link -> the top-down gate locks it.
            await waitFor(() => expect(nodeRoot(childId)?.getAttribute("data-state")).toBe("locked"))

            // Complete board B (its lone root leaf) via its tab.
            fireEvent.click(screen.getByRole("button", { name: "New Quest" }))
            fireEvent.click(await screen.findByRole("button", { name: "Complete Quest" }))

            // Back on the seed board, L masters (derived from B), so C unlocks by the normal rule.
            fireEvent.click(screen.getByRole("button", { name: "Learn Questline" }))
            await waitFor(() => expect(nodeRoot(childId)?.getAttribute("data-state")).toBe("available"))
        })
    })

    context("deleting", () => {
        it("cascades a node's subtree and moves selection to its parent", async () => {
            render(<App />)
            const node = await waitForNode("plan-goal")
            // plan-goal has a child (break-steps); both go on delete.
            expect(nodeRoot("break-steps")).not.toBeNull()

            fireEvent.click(node)
            await screen.findByRole("heading", { name: /plan your goal/i })
            fireEvent.click(screen.getByRole("button", { name: "Edit" }))
            fireEvent.click(screen.getByRole("button", { name: "Delete node" }))
            fireEvent.click(await screen.findByRole("button", { name: "Delete" }))

            await waitFor(() => {
                expect(nodeRoot("plan-goal")).toBeNull()
                expect(nodeRoot("break-steps")).toBeNull()
            })
            expect(await screen.findByRole("heading", { name: /learn questline/i })).toBeInTheDocument()
        })

        it("removes the whole board when its root node is deleted, activating a neighbour", async () => {
            render(<App />)
            await waitForNode("learn")

            // Add a second board (it opens on its root, card in edit mode with the board-delete affordance).
            fireEvent.click(screen.getByRole("button", { name: "Add board" }))
            await screen.findByDisplayValue("New Quest")

            fireEvent.click(screen.getByRole("button", { name: "Delete board" }))
            fireEvent.click(await screen.findByRole("button", { name: "Delete" }))

            // The board (and its tab) is gone; the seed board is activated in its place.
            await waitFor(() => expect(screen.queryByRole("button", { name: "New Quest" })).toBeNull())
            expect(screen.getByRole("button", { name: "Learn Questline" })).toBeInTheDocument()
        })

        it("shows the Add Board prompt after the last board is deleted, and can add a fresh one", async () => {
            render(<App />)
            await waitForNode("learn")

            // Delete the only board via its root node.
            selectSeedRoot()
            await screen.findByTestId("detail-card")
            fireEvent.click(screen.getByRole("button", { name: "Edit" }))
            fireEvent.click(screen.getByRole("button", { name: "Delete board" }))
            fireEvent.click(await screen.findByRole("button", { name: "Delete" }))

            // Zero boards: the empty-state prompt shows and the seed tab is gone.
            expect(await screen.findByRole("button", { name: "Add a board" })).toBeInTheDocument()
            expect(screen.queryByRole("button", { name: "Learn Questline" })).toBeNull()

            // Adding one from the prompt restores a board.
            fireEvent.click(screen.getByRole("button", { name: "Add a board" }))
            expect(await screen.findByRole("button", { name: "New Quest" })).toBeInTheDocument()
        })
    })

    context("url routing", () => {
        it("writes the selected node id to the url hash", async () => {
            render(<App />)
            const node = await waitForNode("plan-goal")

            fireEvent.click(node)
            await waitFor(() => expect(window.location.hash).toBe("#plan-goal"))
        })

        it("opens the node named in a #<id> hash on load", async () => {
            window.history.replaceState(null, "", "#plan-goal")
            render(<App />)

            expect(await screen.findByRole("heading", { name: /plan your goal/i })).toBeInTheDocument()
        })

        it("opens the board named in a #<id> hash on load, selecting its root", async () => {
            window.history.replaceState(null, "", "#seed")
            render(<App />)

            // The seed board opens with its root node selected (its card shown).
            expect(await screen.findByRole("heading", { name: /learn questline/i })).toBeInTheDocument()
        })
    })

    context("when clicking outside the card", () => {
        it("plays the exit animation, then removes the card", async () => {
            render(<App />)
            const node = await waitForNode("learn")
            fireEvent.click(node)
            await screen.findByRole("heading", { name: /learn questline/i })
            const card = screen.getByTestId("detail-card")

            fireEvent.pointerDown(document.body)
            // Still mounted while the exit animation runs...
            expect(screen.getByTestId("detail-card")).toBeInTheDocument()

            // ...and gone once it finishes.
            fireEvent.animationEnd(card, { bubbles: true })
            expect(screen.queryByTestId("detail-card")).not.toBeInTheDocument()
        })
    })

    context("importing a file", () => {
        const exportFile = (json: string) => new File([json], "roadmap.json", { type: "application/json" })

        it("replaces the boards with the imported ones", async () => {
            render(<App />)
            await waitForNode("learn")

            // A minimal valid v4 export: one board whose root node is `solo-root`.
            const imported = {
                version: 4,
                boards: {
                    solo: {
                        id: "solo",
                        rootId: "solo-root",
                        nodes: {
                            "solo-root": { id: "solo-root", name: "Imported Goal", x: 0, y: 0, tier: 0, description: "", reward: 5 }
                        },
                        edges: [],
                        todos: {},
                        mastered: []
                    }
                },
                boardOrder: ["solo"],
                tasks: [],
                rewards: [],
                banked: { earned: 0, spent: 0 },
                notes: []
            }
            fireEvent.change(screen.getByTestId("import-input"), {
                target: { files: [exportFile(JSON.stringify(imported))] }
            })

            // The imported board's root is on screen; the seed roadmap is gone.
            await waitFor(() => expect(nodeRoot("solo-root")).not.toBeNull())
            expect(nodeRoot("learn")).toBeNull()
        })

        it("alerts and changes nothing on an invalid file", async () => {
            const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {})
            render(<App />)
            await waitForNode("learn")

            fireEvent.change(screen.getByTestId("import-input"), { target: { files: [exportFile("not json")] } })

            await waitFor(() => expect(alertSpy).toHaveBeenCalledTimes(1))
            expect(nodeRoot("learn")).not.toBeNull()
            alertSpy.mockRestore()
        })
    })

    context("autosave", () => {
        it("restores an edit after a remount", async () => {
            const first = render(<App />)
            await waitForNode("learn")

            // Rename the root, then wait past the 400ms autosave debounce.
            selectSeedRoot()
            fireEvent.click(screen.getByRole("button", { name: "Edit" }))
            fireEvent.change(screen.getByDisplayValue("Learn Questline"), { target: { value: "Restored Launch" } })
            await waitFor(() => expect(savedRoadmap()).toContain("Restored Launch"), { timeout: 2000 })

            // Remount from scratch: the edit is back on the tab, not the seed name.
            first.unmount()
            render(<App />)
            expect(await screen.findByRole("button", { name: "Restored Launch" })).toBeInTheDocument()
        })

        it("shows the seed roadmap on a first load with empty storage", async () => {
            render(<App />)
            await waitForNode("learn")
            expect(screen.getByText("Plan your goal")).toBeInTheDocument()
        })
    })

    context("the Tasks view", () => {
        const openTasks = () => fireEvent.click(screen.getByRole("button", { name: "Tasks" }))

        it("opens the seeded tasks list from the nav chip, swapping out the roadmap", async () => {
            render(<App />)
            openTasks()
            expect(await screen.findByText("Tick a task to complete it and earn gold to spend on rewards.")).toBeInTheDocument()
            // The roadmap board is gone while Tasks shows.
            expect(nodeRoot("learn")).toBeNull()
        })

        it("adds and toggles a task", async () => {
            render(<App />)
            openTasks()
            await screen.findByText("Tick a task to complete it and earn gold to spend on rewards.")

            // The + tile adds a default task and opens its card in edit mode; name it, then dismiss.
            fireEvent.click(screen.getByRole("button", { name: "Add task" }))
            await screen.findByTestId("task-detail-card")
            fireEvent.change(screen.getByLabelText("Task name"), { target: { value: "Slay the bog wyrm" } })
            fireEvent.keyDown(document, { key: "Escape" })
            expect(await screen.findByText("Slay the bog wyrm")).toBeInTheDocument()

            fireEvent.click(screen.getByRole("button", { name: "Check Slay the bog wyrm" }))
            expect(await screen.findByRole("button", { name: "Uncheck Slay the bog wyrm" })).toBeInTheDocument()
        })

        it("returns to the roadmap when a tab is clicked", async () => {
            render(<App />)
            openTasks()
            await screen.findByText("Tick a task to complete it and earn gold to spend on rewards.")

            fireEvent.click(screen.getByRole("button", { name: "Learn Questline" }))
            await waitForNode("learn")
            expect(screen.queryByText("Tick a task to complete it and earn gold to spend on rewards.")).toBeNull()
        })

        it("persists an added task across a remount", async () => {
            const first = render(<App />)
            openTasks()
            await screen.findByText("Tick a task to complete it and earn gold to spend on rewards.")

            fireEvent.click(screen.getByRole("button", { name: "Add task" }))
            await screen.findByTestId("task-detail-card")
            fireEvent.change(screen.getByLabelText("Task name"), { target: { value: "Guard the caravan" } })
            fireEvent.keyDown(document, { key: "Escape" })
            await screen.findByText("Guard the caravan")
            await waitFor(() => expect(savedRoadmap()).toContain("Guard the caravan"), { timeout: 2000 })

            first.unmount()
            render(<App />)
            fireEvent.click(screen.getByRole("button", { name: "Tasks" }))
            expect(await screen.findByText("Guard the caravan")).toBeInTheDocument()
        })

        it("deletes a task from its detail card", async () => {
            render(<App />)
            openTasks()
            await screen.findByText("Tick a task to complete it and earn gold to spend on rewards.")

            // The + tile adds a default task and opens its card in edit mode, so Delete task is right there.
            fireEvent.click(screen.getByRole("button", { name: "Add task" }))
            fireEvent.click(await screen.findByRole("button", { name: "Delete task" }))
            fireEvent.click(await screen.findByRole("button", { name: "Delete" }))

            await waitFor(() => expect(screen.queryByText("New Task")).toBeNull())
            expect(screen.queryByTestId("task-detail-card")).toBeNull()
        })
    })
})

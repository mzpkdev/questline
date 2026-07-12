import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { decompressFromUTF16 } from "lz-string"
import { App } from "./App"

// Excalidraw's ESM entry can't be imported under vitest (a transitive JSON module lacks an import
// attribute), so App's lazy Scribbles chunk would fail to load. Stub the package with light React shims --
// enough for the real ScribblesBoard / ScribbleEditor wrappers to mount -- since these tests exercise App's
// scribble wiring, not the canvas engine. The mocked editor renders under [data-testid="excalidraw-mock"],
// and its MainMenu.Item entries (e.g. "Delete scribble") become plain buttons that fire their onSelect.
vi.mock("@excalidraw/excalidraw", async () => {
    const React = await import("react")
    const Item = ({ children, onSelect }: { children?: unknown; onSelect?: () => void }) =>
        React.createElement("button", { type: "button", onClick: onSelect }, children as never)
    const MainMenu = Object.assign(
        ({ children }: { children?: unknown }) => React.createElement(React.Fragment, null, children as never),
        {
            Item,
            Separator: () => null,
            DefaultItems: {
                SaveAsImage: () => null,
                ChangeCanvasBackground: () => null,
                ClearCanvas: () => null,
                Help: () => null
            }
        }
    )
    return {
        Excalidraw: ({ children }: { children?: unknown }) =>
            React.createElement("div", { "data-testid": "excalidraw-mock" }, children as never),
        MainMenu,
        restore: (d: { elements?: unknown[]; appState?: unknown; files?: unknown }) => ({
            elements: d?.elements ?? [],
            appState: d?.appState ?? {},
            files: d?.files ?? {}
        }),
        exportToSvg: async () => document.createElementNS("http://www.w3.org/2000/svg", "svg"),
        getSceneVersion: () => 0,
        serializeAsJSON: () => "{}"
    }
})

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

// localStorage now holds lz-string-compressed JSON under the v5 key; unpack it to assert on the saved roadmap.
const savedRoadmap = () => decompressFromUTF16(localStorage.getItem("questline:v5") ?? "") ?? ""

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

        it("detaches the branch for real: it parks as detached, its old parent goes childless", async () => {
            render(<App />)
            await waitForNode("finish-node")

            fireEvent.click(nodeRoot("finish-node") as Element)
            await screen.findByRole("heading", { name: /finish a node/i })
            fireEvent.click(screen.getByRole("button", { name: "Edit" }))
            fireEvent.click(screen.getByRole("button", { name: "Detach node" }))
            await screen.findByTestId("reparent-band")

            // The detach PERSISTED: finish-node has no path to the root, so it derives "detached", and
            // its old parent track-progress -- now childless -- reads available. (The disabled "Detached"
            // card action is covered directly in NodeDetailCard.spec.)
            await waitFor(() => {
                expect(nodeRoot("finish-node")?.getAttribute("data-state")).toBe("detached")
                expect(nodeRoot("track-progress")?.getAttribute("data-state")).toBe("available")
            })
        })

        it("parks the branch as detached on an empty-canvas click (no revert to the original parent)", async () => {
            render(<App />)
            await waitForNode("finish-node")

            fireEvent.click(nodeRoot("finish-node") as Element)
            await screen.findByRole("heading", { name: /finish a node/i })
            fireEvent.click(screen.getByRole("button", { name: "Edit" }))
            fireEvent.click(screen.getByRole("button", { name: "Detach node" }))
            await screen.findByTestId("reparent-band")
            await waitFor(() => expect(nodeRoot("track-progress")?.getAttribute("data-state")).toBe("available"))

            // A click on the empty board area (outside any node) cancels the ARM only: the detach stands,
            // so finish-node stays parked (detached), track-progress keeps no child (stays available),
            // and the loose edge is gone. It does NOT snap back under track-progress.
            fireEvent.click(document.querySelector(".board-surface") as Element)

            await waitFor(() => expect(band()).toBeNull())
            await waitFor(() => {
                expect(nodeRoot("finish-node")?.getAttribute("data-state")).toBe("detached")
                expect(nodeRoot("track-progress")?.getAttribute("data-state")).toBe("available")
            })
        })

        it("re-homes a parked branch under a clicked target via the card's Attach action", async () => {
            render(<App />)
            await waitForNode("finish-node")

            // Detach finish-node, then Escape: it stays parked (detached).
            fireEvent.click(nodeRoot("finish-node") as Element)
            await screen.findByRole("heading", { name: /finish a node/i })
            fireEvent.click(screen.getByRole("button", { name: "Edit" }))
            fireEvent.click(screen.getByRole("button", { name: "Detach node" }))
            await screen.findByTestId("reparent-band")
            fireEvent.keyDown(document, { key: "Escape" })
            await waitFor(() => expect(nodeRoot("finish-node")?.getAttribute("data-state")).toBe("detached"))

            // The card dismissed on detach; finish its exit animation so re-selecting opens it fresh in
            // read mode (jsdom never fires the CSS animationend on its own, so the card would otherwise
            // linger in edit mode).
            fireEvent.animationEnd(screen.getByTestId("detail-card"), { bubbles: true })

            // Re-open the parked node: its edit card offers Attach (not Detach); clicking it re-arms attach-mode.
            fireEvent.click(nodeRoot("finish-node") as Element)
            await screen.findByRole("heading", { name: /finish a node/i })
            fireEvent.click(screen.getByRole("button", { name: "Edit" }))
            expect(screen.queryByRole("button", { name: "Detach node" })).toBeNull()
            fireEvent.click(screen.getByRole("button", { name: "Attach node" }))
            await screen.findByTestId("reparent-band")

            // Click plan-goal (a valid, on-tree target): the branch re-hangs under it and disarms.
            fireEvent.click(nodeRoot("plan-goal") as Element)
            await waitFor(() => expect(band()).toBeNull())
            await waitFor(() => {
                // No longer detached (back on the tree), and plan-goal now owns an incomplete child.
                expect(nodeRoot("finish-node")?.getAttribute("data-state")).not.toBe("detached")
                expect(nodeRoot("plan-goal")?.getAttribute("data-state")).toBe("locked")
            })
            // Selection returns to the moved node.
            expect(window.location.hash).toBe("#finish-node")
        })

        it("ignores a descendant as a target, and Escape leaves the branch parked (no revert)", async () => {
            render(<App />)
            await waitForNode("track-progress")

            // Detach track-progress (which carries finish-node beneath it): both go detached.
            fireEvent.click(nodeRoot("track-progress") as Element)
            await screen.findByRole("heading", { name: /track your progress/i })
            fireEvent.click(screen.getByRole("button", { name: "Edit" }))
            fireEvent.click(screen.getByRole("button", { name: "Detach node" }))
            await screen.findByTestId("reparent-band")

            // finish-node is a descendant of track-progress, so it's not a valid target: clicking it
            // does nothing and the mode stays armed.
            fireEvent.click(nodeRoot("finish-node") as Element)
            expect(band()).toBeInTheDocument()

            // Escape cancels the arm; the branch stays parked (detached), it does NOT snap back to the root.
            fireEvent.keyDown(document, { key: "Escape" })
            await waitFor(() => expect(band()).toBeNull())
            await waitFor(() => expect(nodeRoot("track-progress")?.getAttribute("data-state")).toBe("detached"))
        })
    })

    context("linked nodes", () => {
        // Create a second board "New Quest" (B), return to the seed board (A), convert finish-node in
        // place into a linked node, and point it at B. Returns finish-node's id (selection is unchanged
        // by the convert, so it stays the linked node).
        async function linkSeedNodeToNewBoard(): Promise<string> {
            fireEvent.click(screen.getByRole("button", { name: "Add board" }))
            await screen.findByDisplayValue("New Quest") // B's root card, edit mode
            fireEvent.click(screen.getByRole("button", { name: "Learn Questline" })) // back to seed board A

            const leaf = await waitForNode("finish-node")
            fireEvent.click(leaf)
            await screen.findByRole("heading", { name: /finish a node/i })
            fireEvent.click(screen.getByRole("button", { name: "Edit" }))
            // Convert finish-node into a linked node (confirm first), then pick its target board.
            fireEvent.click(screen.getByRole("button", { name: "Convert to linked node" }))
            fireEvent.click(await screen.findByRole("button", { name: "Convert" }))

            const dropdown = await screen.findByRole("combobox", { name: "Link to board" })
            const option = within(dropdown).getByRole("option", { name: "New Quest" }) as HTMLOptionElement
            fireEvent.change(dropdown, { target: { value: option.value } })
            return selectedNodeId()
        }

        it("converts a node into a linked node in place, keeping its card in edit mode", async () => {
            render(<App />)
            const leaf = await waitForNode("finish-node")

            fireEvent.click(leaf)
            await screen.findByRole("heading", { name: /finish a node/i })
            fireEvent.click(screen.getByRole("button", { name: "Edit" }))
            fireEvent.click(screen.getByRole("button", { name: "Convert to linked node" }))
            fireEvent.click(await screen.findByRole("button", { name: "Convert" }))

            // finish-node is now a real linked node on the tree (data-linked-node, not a node card)...
            await waitFor(() => expect(linkedNode("finish-node")).not.toBeNull())
            expect(nodeRoot("finish-node")).toBeNull()
            // ...and its card flipped to the linked edit layout, showing the board dropdown.
            expect(screen.getByRole("combobox", { name: "Link to board" })).toBeInTheDocument()
        })

        it("refills a node's data when converted back from linked in the same session", async () => {
            render(<App />)
            const leaf = await waitForNode("finish-node")
            fireEvent.click(leaf)
            await screen.findByRole("heading", { name: /finish a node/i })
            fireEvent.click(screen.getByRole("button", { name: "Edit" }))

            // Convert to linked (confirm): the node's stored name goes blank (a linked name is derived).
            fireEvent.click(screen.getByRole("button", { name: "Convert to linked node" }))
            fireEvent.click(await screen.findByRole("button", { name: "Convert" }))
            await waitFor(() => expect(linkedNode("finish-node")).not.toBeNull())

            // Convert back: the session snapshot refills its original name, not the "New Node" default.
            fireEvent.click(screen.getByRole("button", { name: "Convert to regular node" }))
            await waitFor(() => expect(nodeRoot("finish-node")?.textContent).toContain("Finish a node"))
            expect(nodeRoot("finish-node")?.textContent).not.toContain("New Node")
        })

        it("has an empty dropdown and a disabled Go to Board when there is no other board", async () => {
            render(<App />)
            const leaf = await waitForNode("finish-node")

            fireEvent.click(leaf)
            await screen.findByRole("heading", { name: /finish a node/i })
            fireEvent.click(screen.getByRole("button", { name: "Edit" }))
            fireEvent.click(screen.getByRole("button", { name: "Convert to linked node" }))
            fireEvent.click(await screen.findByRole("button", { name: "Convert" }))

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

            // Convert finish-node into a linked node L aimed at board B (still incomplete); its card
            // stays in edit mode, so add a regular child C under it.
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

    context("scribbles (linking scribbles to milestones)", () => {
        // Open finish-node's edit card and press "Add scribble" -> the Scribbles wall opens in link mode
        // bound to the node. Leaves the app on the link-mode wall (its Cancel / cards / + tile all in play).
        async function openLinkModeFromFinishNode() {
            const leaf = await waitForNode("finish-node")
            fireEvent.click(leaf)
            await screen.findByRole("heading", { name: /finish a node/i })
            fireEvent.click(screen.getByRole("button", { name: "Edit" }))
            fireEvent.click(screen.getByRole("button", { name: "Add scribble" }))
            await screen.findByRole("heading", { name: /attach a scribble to finish a node/i })
        }

        // Link mode -> start a new scribble from the + tile: it attaches to finish-node and opens straight
        // in the editor. Leaves the editor (excalidraw-mock) showing.
        async function linkNewScribbleToFinishNode() {
            await openLinkModeFromFinishNode()
            fireEvent.click(screen.getByRole("button", { name: "Add Scribble" }))
            await screen.findByTestId("excalidraw-mock")
        }

        // Create a standalone, unlinked scribble on the wall (Scribbles nav -> + -> editor -> back) so it
        // exists as a card to pick later. Leaves the app on the (normal) Scribbles wall.
        async function createStandaloneScribble() {
            fireEvent.click(screen.getByRole("button", { name: "Scribbles" }))
            fireEvent.click(await screen.findByRole("button", { name: "Add Scribble" }))
            await screen.findByTestId("excalidraw-mock")
            fireEvent.click(screen.getByRole("button", { name: "Back to scribbles" }))
            await screen.findByRole("button", { name: "Rename Scribble" })
        }

        it("links a new scribble to a node from the card's Add scribble button", async () => {
            render(<App />)
            await linkNewScribbleToFinishNode()

            // Back from the editor returns to the node (not the wall), and the fresh scribble is a chip.
            fireEvent.click(screen.getByRole("button", { name: "Back to scribbles" }))
            await screen.findByRole("heading", { name: /finish a node/i })
            expect(await screen.findByRole("button", { name: "Scribble" })).toBeInTheDocument()
        })

        it("links an existing scribble to a node by picking it in link mode", async () => {
            render(<App />)
            await waitForNode("finish-node")
            await createStandaloneScribble()

            fireEvent.click(screen.getByRole("button", { name: "Learn Questline" })) // back to the roadmap
            await openLinkModeFromFinishNode()

            // Click the existing card (its container) to link it and return to the node.
            const rename = await screen.findByRole("button", { name: "Rename Scribble" })
            fireEvent.click(rename.closest("[data-scribble-id]") as HTMLElement)

            await screen.findByRole("heading", { name: /finish a node/i })
            expect(await screen.findByRole("button", { name: "Scribble" })).toBeInTheDocument()
        })

        it("cancels link mode and returns to the node without linking", async () => {
            render(<App />)
            await openLinkModeFromFinishNode()

            fireEvent.click(screen.getByRole("button", { name: "Cancel" }))

            // Back on the node card, nothing was attached.
            await screen.findByRole("heading", { name: /finish a node/i })
            expect(screen.queryByRole("button", { name: "Scribble" })).toBeNull()
        })

        it("opens the scribble editor for a scribble when its chip is clicked", async () => {
            render(<App />)
            await linkNewScribbleToFinishNode()
            fireEvent.click(screen.getByRole("button", { name: "Back to scribbles" }))
            await screen.findByRole("heading", { name: /finish a node/i })

            fireEvent.click(await screen.findByRole("button", { name: "Scribble" }))

            // The scribble editor for that scribble is shown; the roadmap board is gone behind it.
            expect(await screen.findByTestId("excalidraw-mock")).toBeInTheDocument()
            await waitFor(() => expect(nodeRoot("finish-node")).toBeNull())
        })

        it("prunes the chip off a node when its scribble is deleted", async () => {
            render(<App />)
            await linkNewScribbleToFinishNode()

            // Already in the editor for the freshly-linked scribble: delete it from the menu (confirming).
            fireEvent.click(screen.getByRole("button", { name: "Delete scribble" }))
            fireEvent.click(await screen.findByRole("button", { name: "Delete" }))

            // Back on the roadmap, re-select the node: the link was swept, so no chip remains.
            fireEvent.click(screen.getByRole("button", { name: "Learn Questline" }))
            const leaf = await waitForNode("finish-node")
            fireEvent.click(leaf)
            await screen.findByRole("heading", { name: /finish a node/i })
            await waitFor(() => expect(screen.queryByRole("button", { name: "Scribble" })).toBeNull())
        })
    })

    context("deleting", () => {
        it("deletes only the node, parking its child as detached, and moves selection to its parent", async () => {
            render(<App />)
            const node = await waitForNode("plan-goal")
            // plan-goal has a child (break-steps). Deleting plan-goal removes only plan-goal; break-steps
            // survives but loses its parent, so it derives "detached".
            expect(nodeRoot("break-steps")).not.toBeNull()

            fireEvent.click(node)
            await screen.findByRole("heading", { name: /plan your goal/i })
            fireEvent.click(screen.getByRole("button", { name: "Edit" }))
            fireEvent.click(screen.getByRole("button", { name: "Delete node" }))
            fireEvent.click(await screen.findByRole("button", { name: "Delete" }))

            await waitFor(() => {
                expect(nodeRoot("plan-goal")).toBeNull() // the node is gone
                expect(nodeRoot("break-steps")?.getAttribute("data-state")).toBe("detached") // child parked
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

    context("dismissing the node card", () => {
        it("plays the exit animation, then removes the card, on a click outside it", async () => {
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

        // The node card used to ignore Escape entirely (unlike the task / reward cards); it now shares
        // their dismiss-on-outside wiring, so Escape closes it the same way a click outside does.
        it("plays the exit animation, then removes the card, on Escape", async () => {
            render(<App />)
            const node = await waitForNode("learn")
            fireEvent.click(node)
            await screen.findByRole("heading", { name: /learn questline/i })
            const card = screen.getByTestId("detail-card")

            fireEvent.keyDown(document, { key: "Escape" })
            // Still mounted while the exit animation runs...
            expect(screen.getByTestId("detail-card")).toBeInTheDocument()

            // ...and gone once it finishes.
            fireEvent.animationEnd(card, { bubbles: true })
            expect(screen.queryByTestId("detail-card")).not.toBeInTheDocument()
        })
    })

    context("leaving the roadmap section", () => {
        // The node card used to stay selected forever (unlike the task / reward cards, which already
        // closed outright on leaving their section); it now closes the same way, which -- since the
        // selected id mirrors into the url hash -- is observable as the hash clearing.
        it("closes the node card, clearing the url hash, when switching to another section", async () => {
            render(<App />)
            const node = await waitForNode("plan-goal")

            fireEvent.click(node)
            await waitFor(() => expect(window.location.hash).toBe("#plan-goal"))

            fireEvent.click(screen.getByRole("button", { name: "Tasks" }))

            await waitFor(() => expect(window.location.hash).toBe(""))
        })
    })

    context("importing a file", () => {
        const exportFile = (json: string) => new File([json], "roadmap.json", { type: "application/json" })

        it("replaces the boards with the imported ones", async () => {
            render(<App />)
            await waitForNode("learn")

            // A minimal valid v5 export: one board whose root node is `solo-root`.
            const imported = {
                version: 5,
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
                scribbles: []
            }
            fireEvent.change(screen.getByTestId("import-input"), {
                target: { files: [exportFile(JSON.stringify(imported))] }
            })

            // The imported board's root is on screen; the seed roadmap is gone.
            await waitFor(() => expect(nodeRoot("solo-root")).not.toBeNull())
            expect(nodeRoot("learn")).toBeNull()
        })

        it("shows a themed error dialog and changes nothing on an invalid file", async () => {
            render(<App />)
            await waitForNode("learn")

            fireEvent.change(screen.getByTestId("import-input"), { target: { files: [exportFile("not json")] } })

            expect(await screen.findByRole("alertdialog")).toHaveTextContent("Could not import")
            expect(nodeRoot("learn")).not.toBeNull()

            // Dismissing the dialog is a one-way acknowledgement -- there's nothing to confirm or undo.
            fireEvent.click(screen.getByRole("button", { name: "Got it" }))
            await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull())
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
            fireEvent.click(screen.getByRole("button", { name: "Add Task" }))
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

            fireEvent.click(screen.getByRole("button", { name: "Add Task" }))
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
            fireEvent.click(screen.getByRole("button", { name: "Add Task" }))
            fireEvent.click(await screen.findByRole("button", { name: "Delete task" }))
            fireEvent.click(await screen.findByRole("button", { name: "Delete" }))

            await waitFor(() => expect(screen.queryByText("New Task")).toBeNull())
            expect(screen.queryByTestId("task-detail-card")).toBeNull()
        })
    })
})

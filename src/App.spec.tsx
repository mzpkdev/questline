import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { decompressFromUTF16 } from "lz-string"
import { App } from "./App"

// React Flow wraps each custom node in its own div that also carries data-id; our node's
// root is the one that also has data-state, so we target [data-id][data-state]. Clicks use
// fireEvent (not userEvent) to avoid React Flow's d3-zoom mousedown path crashing under jsdom.
const nodeRoot = (id: string) => document.querySelector(`[data-id="${id}"][data-state]`)
// View chips (Root's mirror nodes) carry data-view-node instead of data-state.
const viewNode = (id: string) => document.querySelector(`[data-view-node][data-id="${id}"]`)

// With no url hash the app boots to the Root hub with nothing selected, so the sample roadmap's
// nodes aren't on screen. Clicking the sample tab (labelled after its goal) switches to it and
// selects that goal, mirroring how the seed view was reached before.
const openSampleTab = () => fireEvent.click(screen.getByRole("button", { name: "Learn Questline" }))

// localStorage now holds lz-string-compressed JSON; unpack it to assert on the saved roadmap text.
const savedRoadmap = () => decompressFromUTF16(localStorage.getItem("questline:v3") ?? "") ?? ""

describe("App", () => {
    // The app reads/writes window.location.hash for routing; reset it so tests don't leak into each other.
    beforeEach(() => {
        window.history.replaceState(null, "", window.location.pathname)
        localStorage.clear()
    })

    it("renders the roadmap and opens the goal in the detail card", async () => {
        render(<App />)
        openSampleTab()
        await waitFor(() => expect(nodeRoot("learn")).not.toBeNull())
        expect(screen.getByRole("heading", { name: /learn questline/i })).toBeInTheDocument()
        expect(screen.getByRole("button", { name: /^quest board$/i })).toBeInTheDocument()
    })

    context("when a milestone node is clicked", () => {
        it("swaps the detail card to that milestone", async () => {
            render(<App />)
            openSampleTab()
            const node = await waitFor(() => {
                const el = nodeRoot("plan-goal")
                if (!el) throw new Error("node not mounted yet")
                return el as HTMLElement
            })
            fireEvent.click(node)
            expect(await screen.findByRole("heading", { name: /plan your goal/i })).toBeInTheDocument()
        })
    })

    context("completing a milestone", () => {
        it("unlocks the parent once a leaf's boxes are checked and it is marked complete", async () => {
            render(<App />)
            openSampleTab()

            // finish-milestone is a leaf; its parent track-progress starts locked (its only child is
            // still incomplete).
            const leaf = await waitFor(() => {
                const el = nodeRoot("finish-milestone")
                if (!el) throw new Error("node not mounted yet")
                return el as HTMLElement
            })
            expect(nodeRoot("track-progress")?.getAttribute("data-state")).toBe("locked")

            fireEvent.click(leaf)
            await screen.findByRole("heading", { name: /finish a milestone/i })

            // Tick every checklist item (each is "Check ..." until pressed), then complete.
            fireEvent.click(screen.getByRole("button", { name: "Check Tick this box" }))
            fireEvent.click(screen.getByRole("button", { name: "Check Then tick this one" }))
            fireEvent.click(screen.getByRole("button", { name: "Mark Complete" }))

            // finish-milestone is now complete and track-progress has unlocked to available.
            await waitFor(() => {
                expect(nodeRoot("finish-milestone")?.getAttribute("data-state")).toBe("mastered")
                expect(nodeRoot("track-progress")?.getAttribute("data-state")).toBe("available")
            })
        })

        it("cannot complete a leaf while any box is unchecked", async () => {
            render(<App />)
            openSampleTab()
            const leaf = await waitFor(() => {
                const el = nodeRoot("finish-milestone")
                if (!el) throw new Error("node not mounted yet")
                return el as HTMLElement
            })

            fireEvent.click(leaf)
            await screen.findByRole("heading", { name: /finish a milestone/i })

            // No boxes ticked -> the action is disabled and the node stays available, not complete.
            expect(screen.getByRole("button", { name: "Mark Complete" })).toBeDisabled()
            expect(nodeRoot("finish-milestone")?.getAttribute("data-state")).toBe("available")
        })
    })

    context("completing a tab's goal", () => {
        it("fires the finale fanfare over the board", async () => {
            render(<App />)
            await waitFor(() => expect(nodeRoot("root-goal")).not.toBeNull())

            // Create a view (its goal is a lone leaf), open it, and complete that goal.
            fireEvent.click(screen.getByRole("button", { name: "Quest Board" }))
            await screen.findByTestId("detail-card")
            fireEvent.click(screen.getByRole("button", { name: "Edit" }))
            fireEvent.click(screen.getByRole("button", { name: "+ Add sub-view" }))
            fireEvent.click(await screen.findByRole("button", { name: "View" }))
            expect(screen.queryByTestId("goal-celebration")).toBeNull()

            fireEvent.click(await screen.findByRole("button", { name: "Complete Quest" }))

            expect(await screen.findByTestId("goal-celebration")).toBeInTheDocument()
        })
    })

    context("editing a milestone", () => {
        it("renames the node live in the tree", async () => {
            render(<App />)
            openSampleTab()
            const node = await waitFor(() => {
                const el = nodeRoot("plan-goal")
                if (!el) throw new Error("node not mounted yet")
                return el as HTMLElement
            })

            fireEvent.click(node)
            await screen.findByRole("heading", { name: /plan your goal/i })

            fireEvent.click(screen.getByRole("button", { name: "Edit" }))
            fireEvent.change(screen.getByDisplayValue("Plan your goal"), { target: { value: "Plan it out" } })

            await waitFor(() => expect(nodeRoot("plan-goal")?.textContent).toContain("Plan it out"))
        })
    })

    context("tabs", () => {
        it("keeps a persistent, undeletable Root tab holding a single Root node", async () => {
            render(<App />)
            // Leave Root for the sample tab, so switching back to Root is observable.
            openSampleTab()
            await waitFor(() => expect(nodeRoot("learn")).not.toBeNull())

            // Root is a tab with no remove affordance.
            expect(screen.getByRole("button", { name: "Quest Board" })).toBeInTheDocument()
            expect(screen.queryByRole("button", { name: "Remove Quest Board" })).not.toBeInTheDocument()

            // Switching to it shows only the lone Root node.
            fireEvent.click(screen.getByRole("button", { name: "Quest Board" }))
            await waitFor(() => expect(nodeRoot("root-goal")).not.toBeNull())
            expect(nodeRoot("root-goal")?.textContent).toContain("Quest Board")
            expect(nodeRoot("learn")).toBeNull()
        })

        it("opens a blank goal-only canvas for a new view", async () => {
            render(<App />)
            await waitFor(() => expect(nodeRoot("root-goal")).not.toBeNull())

            // Create a view from the Root node, then open it via its chip's View button.
            fireEvent.click(screen.getByRole("button", { name: "Quest Board" }))
            await screen.findByTestId("detail-card")
            fireEvent.click(screen.getByRole("button", { name: "Edit" }))
            fireEvent.click(screen.getByRole("button", { name: "+ Add sub-view" }))
            fireEvent.click(await screen.findByRole("button", { name: "View" }))

            // A lone goal node named "New Quest"; the seed roadmap is gone.
            await waitFor(() => expect(nodeRoot("view-1-goal")).not.toBeNull())
            expect(nodeRoot("view-1-goal")?.textContent).toContain("New Quest")
            expect(nodeRoot("learn")).toBeNull()
        })

        it("renames the tab when the goal node is renamed", async () => {
            render(<App />)
            openSampleTab()
            await waitFor(() => expect(nodeRoot("learn")).not.toBeNull())

            // Entering the tab selects its goal; rename it through the card's edit mode.
            fireEvent.click(screen.getByRole("button", { name: "Edit" }))
            fireEvent.change(screen.getByDisplayValue("Learn Questline"), { target: { value: "Launch 1.0" } })

            expect(await screen.findByRole("button", { name: "Launch 1.0" })).toBeInTheDocument()
        })

        it("renames the goal node when the tab is renamed", async () => {
            render(<App />)
            openSampleTab()
            await waitFor(() => expect(nodeRoot("learn")).not.toBeNull())

            fireEvent.dblClick(screen.getByRole("button", { name: "Learn Questline" }))
            const input = screen.getByRole("textbox", { name: "Rename view" })
            fireEvent.change(input, { target: { value: "Big Launch" } })
            fireEvent.keyDown(input, { key: "Enter" })

            await waitFor(() => expect(nodeRoot("learn")?.textContent).toContain("Big Launch"))
        })
    })

    context("adding a sub-milestone", () => {
        it("drops a new child node under the selected milestone", async () => {
            render(<App />)
            openSampleTab()
            const leaf = await waitFor(() => {
                const el = nodeRoot("finish-milestone")
                if (!el) throw new Error("node not mounted yet")
                return el as HTMLElement
            })

            fireEvent.click(leaf)
            await screen.findByRole("heading", { name: /finish a milestone/i })
            fireEvent.click(screen.getByRole("button", { name: "Edit" }))
            fireEvent.click(screen.getByRole("button", { name: "+ Add sub-milestone" }))

            await waitFor(() => expect(nodeRoot("node-1")).not.toBeNull())
            expect(nodeRoot("node-1")?.textContent).toContain("New Milestone")
        })

        it("focuses a newly added sub-milestone (selection and url)", async () => {
            render(<App />)
            openSampleTab()
            const leaf = await waitFor(() => {
                const el = nodeRoot("finish-milestone")
                if (!el) throw new Error("node not mounted yet")
                return el as HTMLElement
            })

            fireEvent.click(leaf)
            await screen.findByRole("heading", { name: /finish a milestone/i })
            fireEvent.click(screen.getByRole("button", { name: "Edit" }))
            fireEvent.click(screen.getByRole("button", { name: "+ Add sub-milestone" }))

            // The new node becomes the selection, so the url follows it.
            await waitFor(() => expect(window.location.hash).toBe("#node-1"))
        })

        it("un-completes a completed parent when a fresh child is added", async () => {
            render(<App />)
            openSampleTab()
            const step = await waitFor(() => {
                const el = nodeRoot("break-steps")
                if (!el) throw new Error("node not mounted yet")
                return el as HTMLElement
            })
            expect(step.getAttribute("data-state")).toBe("mastered")

            fireEvent.click(step)
            await screen.findByRole("heading", { name: /break it into steps/i })
            fireEvent.click(screen.getByRole("button", { name: "Edit" }))
            fireEvent.click(screen.getByRole("button", { name: "+ Add sub-milestone" }))

            // The new child is incomplete, so the completed node drops to locked.
            await waitFor(() => expect(nodeRoot("break-steps")?.getAttribute("data-state")).toBe("locked"))
        })
    })

    context("adding a parent milestone", () => {
        it("promotes a new gold goal above the old one and renames the tab", async () => {
            render(<App />)
            openSampleTab()
            await waitFor(() => expect(nodeRoot("learn")).not.toBeNull())

            // Entering the tab selects its goal; add a parent from its edit mode.
            fireEvent.click(screen.getByRole("button", { name: "Edit" }))
            fireEvent.click(screen.getByRole("button", { name: "+ Add parent milestone" }))

            await waitFor(() => expect(nodeRoot("node-1")).not.toBeNull())
            // The new node renders at goal size; the old goal drops to normal size.
            expect((nodeRoot("node-1") as HTMLElement).style.width).toBe("240px")
            expect((nodeRoot("learn") as HTMLElement).style.width).toBe("180px")
            // The tab follows the goal name, instantly.
            expect(screen.getByRole("button", { name: "New Milestone" })).toBeInTheDocument()
            expect(screen.queryByRole("button", { name: "Learn Questline" })).toBeNull()
        })

        it("offers no + Add parent milestone on the Root tab", async () => {
            render(<App />)
            await waitFor(() => expect(nodeRoot("root-goal")).not.toBeNull())

            fireEvent.click(screen.getByRole("button", { name: "Quest Board" }))
            await screen.findByTestId("detail-card")
            fireEvent.click(screen.getByRole("button", { name: "Edit" }))

            expect(screen.queryByRole("button", { name: "+ Add parent milestone" })).not.toBeInTheDocument()
            expect(screen.getByRole("button", { name: "+ Add sub-milestone" })).toBeInTheDocument()
        })
    })

    context("deleting", () => {
        it("cascades a milestone's subtree and moves selection to its parent", async () => {
            render(<App />)
            openSampleTab()
            const node = await waitFor(() => {
                const el = nodeRoot("plan-goal")
                if (!el) throw new Error("node not mounted yet")
                return el as HTMLElement
            })
            // plan-goal has a child (break-steps); both go on delete.
            expect(nodeRoot("break-steps")).not.toBeNull()

            fireEvent.click(node)
            await screen.findByRole("heading", { name: /plan your goal/i })
            fireEvent.click(screen.getByRole("button", { name: "Edit" }))
            fireEvent.click(screen.getByRole("button", { name: "Delete milestone" }))
            fireEvent.click(await screen.findByRole("button", { name: "Delete" }))

            // The node and its descendant are gone, and the parent (learn) is now shown.
            await waitFor(() => {
                expect(nodeRoot("plan-goal")).toBeNull()
                expect(nodeRoot("break-steps")).toBeNull()
            })
            expect(await screen.findByRole("heading", { name: /learn questline/i })).toBeInTheDocument()
        })

        it("removes a non-Root tab's whole view when its goal is deleted", async () => {
            render(<App />)
            openSampleTab()
            await waitFor(() => expect(nodeRoot("learn")).not.toBeNull())

            // Entering the tab selects its goal; a tab goal deletes the whole view.
            fireEvent.click(screen.getByRole("button", { name: "Edit" }))
            fireEvent.click(screen.getByRole("button", { name: "Delete view" }))
            fireEvent.click(await screen.findByRole("button", { name: "Delete" }))

            await waitFor(() => expect(screen.queryByRole("button", { name: "Learn Questline" })).toBeNull())
        })

        it("removes a view when its Root-hub chip is deleted", async () => {
            render(<App />)
            const chip = await waitFor(() => {
                const el = viewNode("view-mirror-seed")
                if (!el) throw new Error("view chip not mounted yet")
                return el as HTMLElement
            })

            fireEvent.click(chip)
            await screen.findByTestId("detail-card")
            fireEvent.click(screen.getByRole("button", { name: "Edit" }))
            fireEvent.click(screen.getByRole("button", { name: "Delete view" }))
            fireEvent.click(await screen.findByRole("button", { name: "Delete" }))

            await waitFor(() => expect(viewNode("view-mirror-seed")).toBeNull())
        })

        it("offers no delete on the Root goal", async () => {
            render(<App />)
            await waitFor(() => expect(nodeRoot("root-goal")).not.toBeNull())

            fireEvent.click(screen.getByRole("button", { name: "Quest Board" }))
            await screen.findByTestId("detail-card")
            fireEvent.click(screen.getByRole("button", { name: "Edit" }))

            expect(screen.queryByRole("button", { name: "Delete milestone" })).not.toBeInTheDocument()
            expect(screen.queryByRole("button", { name: "Delete view" })).not.toBeInTheDocument()
        })
    })

    context("Root as a hub of views", () => {
        it("mirrors each other view as a view chip under Root", async () => {
            render(<App />)

            // The app boots to the Root hub, which mirrors every other view as a chip.
            await waitFor(() => expect(viewNode("view-mirror-seed")).not.toBeNull())
            expect(viewNode("view-mirror-seed")?.textContent).toContain("Learn Questline")
        })

        it("clicking a view chip opens the shared card in view mode with a View button that switches tabs", async () => {
            render(<App />)

            const chip = await waitFor(() => {
                const el = viewNode("view-mirror-seed")
                if (!el) throw new Error("view chip not mounted yet")
                return el as HTMLElement
            })

            // The same detail card opens, with a "View" action (and it is editable).
            fireEvent.click(chip)
            expect(await screen.findByTestId("detail-card")).toBeInTheDocument()
            expect(screen.getByRole("button", { name: "View" })).toBeInTheDocument()

            // The View button switches to that view.
            fireEvent.click(screen.getByRole("button", { name: "View" }))
            await waitFor(() => expect(nodeRoot("learn")).not.toBeNull())
        })

        it("adds a descendant view chip via + Add sub-view on a chip", async () => {
            render(<App />)

            const chip = await waitFor(() => {
                const el = viewNode("view-mirror-seed")
                if (!el) throw new Error("view chip not mounted yet")
                return el as HTMLElement
            })

            fireEvent.click(chip)
            await screen.findByTestId("detail-card")
            fireEvent.click(screen.getByRole("button", { name: "Edit" }))
            fireEvent.click(screen.getByRole("button", { name: "+ Add sub-view" }))

            // A new sub-view chip appears in the hub (we stay on Root).
            await waitFor(() => expect(viewNode("view-mirror-view-1")).not.toBeNull())
        })

        it("adds a top-level view chip via + Add sub-view on the Root node", async () => {
            render(<App />)
            await waitFor(() => expect(nodeRoot("root-goal")).not.toBeNull())

            // Open the Root node's card, then add a top-level sub-view.
            fireEvent.click(screen.getByRole("button", { name: "Quest Board" }))
            await screen.findByTestId("detail-card")
            fireEvent.click(screen.getByRole("button", { name: "Edit" }))
            fireEvent.click(screen.getByRole("button", { name: "+ Add sub-view" }))

            await waitFor(() => expect(viewNode("view-mirror-view-1")).not.toBeNull())
        })

        it("marks a view chip complete once that view's goal is completed", async () => {
            render(<App />)
            await waitFor(() => expect(nodeRoot("root-goal")).not.toBeNull())

            // Create a view from Root, open it, and complete its (leaf) goal.
            fireEvent.click(screen.getByRole("button", { name: "Quest Board" }))
            await screen.findByTestId("detail-card")
            fireEvent.click(screen.getByRole("button", { name: "Edit" }))
            fireEvent.click(screen.getByRole("button", { name: "+ Add sub-view" }))
            fireEvent.click(await screen.findByRole("button", { name: "View" }))
            fireEvent.click(await screen.findByRole("button", { name: "Complete Quest" }))

            // Back on Root, the chip reads complete.
            fireEvent.click(screen.getByRole("button", { name: "Quest Board" }))
            await waitFor(() => expect(viewNode("view-mirror-view-1")?.hasAttribute("data-complete")).toBe(true))
        })

        it("renaming a view chip renames its tab and the chip", async () => {
            render(<App />)

            const chip = await waitFor(() => {
                const el = viewNode("view-mirror-seed")
                if (!el) throw new Error("view chip not mounted yet")
                return el as HTMLElement
            })

            fireEvent.click(chip)
            await screen.findByTestId("detail-card")
            fireEvent.click(screen.getByRole("button", { name: "Edit" }))
            fireEvent.change(screen.getByDisplayValue("Learn Questline"), { target: { value: "Launch Plan" } })

            // The seed tab and the chip both follow the goal name.
            expect(await screen.findByRole("button", { name: "Launch Plan" })).toBeInTheDocument()
            expect(viewNode("view-mirror-seed")?.textContent).toContain("Launch Plan")
        })
    })

    context("url routing", () => {
        it("writes the selected node id to the url hash", async () => {
            render(<App />)
            openSampleTab()
            const node = await waitFor(() => {
                const el = nodeRoot("plan-goal")
                if (!el) throw new Error("node not mounted yet")
                return el as HTMLElement
            })

            fireEvent.click(node)
            await waitFor(() => expect(window.location.hash).toBe("#plan-goal"))
        })

        it("opens the node named in the url hash on load", async () => {
            window.history.replaceState(null, "", "#plan-goal")
            render(<App />)

            // Boots straight to the seed view with that node selected.
            expect(await screen.findByRole("heading", { name: /plan your goal/i })).toBeInTheDocument()
        })

        it("routes a view-mirror hash to the Root hub", async () => {
            window.history.replaceState(null, "", "#view-mirror-seed")
            render(<App />)

            // Root is active and the mirror is selected: its view popover (View button) shows.
            expect(await screen.findByRole("button", { name: "View" })).toBeInTheDocument()
        })
    })

    context("when clicking outside the card", () => {
        it("plays the exit animation, then removes the card", async () => {
            render(<App />)
            // Open the sample goal card, then dismiss it by clicking the empty board.
            openSampleTab()
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

        it("replaces the roadmaps with the imported ones", async () => {
            render(<App />)
            await waitFor(() => expect(nodeRoot("root-goal")).not.toBeNull())

            // A minimal valid export: Root plus one view whose goal is `solo-goal`.
            const imported = {
                version: 3,
                projects: {
                    root: {
                        id: "root",
                        goalId: "root-goal",
                        milestones: {
                            "root-goal": {
                                id: "root-goal",
                                name: "Quest Board",
                                tag: "Goal",
                                x: 0,
                                y: 0,
                                tier: 0,
                                branch: "Goal",
                                description: ""
                            }
                        },
                        edges: [],
                        todos: {},
                        mastered: []
                    },
                    solo: {
                        id: "solo",
                        goalId: "solo-goal",
                        parentId: "root",
                        milestones: {
                            "solo-goal": {
                                id: "solo-goal",
                                name: "Imported Goal",
                                tag: "Goal",
                                x: 0,
                                y: 0,
                                tier: 0,
                                branch: "Goal",
                                description: ""
                            }
                        },
                        edges: [],
                        todos: {},
                        mastered: []
                    }
                },
                order: ["root", "solo"],
                mirrorPos: {},
                tasks: [],
                rewards: [],
                banked: { earned: 0, spent: 0 }
            }
            fireEvent.change(screen.getByTestId("import-input"), {
                target: { files: [exportFile(JSON.stringify(imported))] }
            })

            // The imported view's goal is on screen; the seed roadmap is gone.
            await waitFor(() => expect(nodeRoot("solo-goal")).not.toBeNull())
            expect(nodeRoot("learn")).toBeNull()
        })

        it("alerts and changes nothing on an invalid file", async () => {
            const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {})
            render(<App />)
            await waitFor(() => expect(nodeRoot("root-goal")).not.toBeNull())

            fireEvent.change(screen.getByTestId("import-input"), { target: { files: [exportFile("not json")] } })

            await waitFor(() => expect(alertSpy).toHaveBeenCalledTimes(1))
            expect(nodeRoot("root-goal")).not.toBeNull()
            alertSpy.mockRestore()
        })
    })

    context("autosave", () => {
        it("restores an edit after a remount", async () => {
            const first = render(<App />)
            openSampleTab()
            await waitFor(() => expect(nodeRoot("learn")).not.toBeNull())

            // Rename the goal, then wait past the 400ms autosave debounce.
            fireEvent.click(screen.getByRole("button", { name: "Edit" }))
            fireEvent.change(screen.getByDisplayValue("Learn Questline"), { target: { value: "Restored Launch" } })
            await waitFor(() => expect(savedRoadmap()).toContain("Restored Launch"), {
                timeout: 2000
            })

            // Remount from scratch: the edit is back on the tab, not the seed name.
            first.unmount()
            render(<App />)
            expect(await screen.findByRole("button", { name: "Restored Launch" })).toBeInTheDocument()
        })

        it("shows the seed roadmap on a first load with empty storage", async () => {
            render(<App />)
            openSampleTab()
            await waitFor(() => expect(nodeRoot("learn")).not.toBeNull())
            expect(screen.getByRole("heading", { name: /learn questline/i })).toBeInTheDocument()
        })
    })

    context("the Tasks view", () => {
        const openTasks = () => fireEvent.click(screen.getByRole("button", { name: "Tasks" }))

        it("opens the seeded tasks list from the nav chip, swapping out the roadmap", async () => {
            render(<App />)
            openTasks()
            expect(await screen.findByText("Tick a task to complete it and earn gold to spend on rewards.")).toBeInTheDocument()
            // The roadmap board is gone while Tasks shows.
            expect(nodeRoot("root-goal")).toBeNull()
        })

        it("adds and toggles a task", async () => {
            render(<App />)
            openTasks()
            await screen.findByText("Tick a task to complete it and earn gold to spend on rewards.")

            fireEvent.change(screen.getByRole("textbox", { name: "New task" }), {
                target: { value: "Slay the bog wyrm" }
            })
            fireEvent.click(screen.getByRole("button", { name: "Add task" }))
            expect(await screen.findByText("Slay the bog wyrm")).toBeInTheDocument()

            fireEvent.click(screen.getByRole("button", { name: "Check Slay the bog wyrm" }))
            expect(await screen.findByRole("button", { name: "Uncheck Slay the bog wyrm" })).toBeInTheDocument()
        })

        it("returns to the roadmap when a tab is clicked", async () => {
            render(<App />)
            openTasks()
            await screen.findByText("Tick a task to complete it and earn gold to spend on rewards.")

            fireEvent.click(screen.getByRole("button", { name: "Learn Questline" }))
            await waitFor(() => expect(nodeRoot("learn")).not.toBeNull())
            expect(screen.queryByText("Tick a task to complete it and earn gold to spend on rewards.")).toBeNull()
        })

        it("persists an added task across a remount", async () => {
            const first = render(<App />)
            openTasks()
            await screen.findByText("Tick a task to complete it and earn gold to spend on rewards.")

            fireEvent.change(screen.getByRole("textbox", { name: "New task" }), {
                target: { value: "Guard the caravan" }
            })
            fireEvent.click(screen.getByRole("button", { name: "Add task" }))
            await screen.findByText("Guard the caravan")
            await waitFor(() => expect(savedRoadmap()).toContain("Guard the caravan"), {
                timeout: 2000
            })

            first.unmount()
            render(<App />)
            fireEvent.click(screen.getByRole("button", { name: "Tasks" }))
            expect(await screen.findByText("Guard the caravan")).toBeInTheDocument()
        })

        it("deletes a task from its detail card", async () => {
            render(<App />)
            openTasks()
            await screen.findByText("Tick a task to complete it and earn gold to spend on rewards.")

            fireEvent.change(screen.getByRole("textbox", { name: "New task" }), { target: { value: "Temp task" } })
            fireEvent.click(screen.getByRole("button", { name: "Add task" }))
            fireEvent.click(await screen.findByRole("button", { name: "Open Temp task" }))
            fireEvent.click(await screen.findByRole("button", { name: "Edit" }))
            fireEvent.click(screen.getByRole("button", { name: "Delete task" }))
            fireEvent.click(await screen.findByRole("button", { name: "Delete" }))

            await waitFor(() => expect(screen.queryByText("Temp task")).toBeNull())
            expect(screen.queryByTestId("task-detail-card")).toBeNull()
        })
    })
})

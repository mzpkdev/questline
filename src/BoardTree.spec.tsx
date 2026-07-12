import { fireEvent, render, screen } from "@testing-library/react"
import { type Boards, boardCompleter, newBoard, UNLINKED_LABEL } from "./board"
import { BoardTree, buildEdges, isReparentTarget } from "./BoardTree"
import { EDGES, MASTERED, type Edge, type Node, NODES } from "./nodes"

const defaultNodes: Record<string, Node> = Object.fromEntries(NODES.map((n) => [n.id, n]))

// React Flow needs a sized parent to lay the flow out, and jsdom won't give it one, so every render
// is wrapped in a fixed-size box.
function renderTree(
    selectedId: string | null,
    onSelect: (id: string) => void,
    mastered: ReadonlySet<string> = MASTERED,
    nodes: Record<string, Node> = defaultNodes,
    edges: Edge[] = EDGES,
    rootId = "learn",
    boards: Boards = {}
) {
    return render(
        <div style={{ width: 1200, height: 800 }}>
            <BoardTree
                selectedId={selectedId}
                onSelect={onSelect}
                rootId={rootId}
                mastered={mastered}
                nodes={nodes}
                edges={edges}
                boards={boards}
                onMove={vi.fn()}
            />
        </div>
    )
}

describe("BoardTree", () => {
    it("renders the roadmap from the domain graph", async () => {
        renderTree(null, vi.fn())

        // The root node at the top plus at least one child node prove the domain mapped through.
        expect(await screen.findByText("Learn Questline")).toBeInTheDocument()
        expect(screen.getByText("Plan your goal")).toBeInTheDocument()
    })

    context("when a node is clicked", () => {
        it("selects it by id", async () => {
            const onSelect = vi.fn()
            const { container } = renderTree(null, onSelect)

            await screen.findByText("Learn Questline")

            // React Flow's own node wrapper also carries data-id; our card root is the element that
            // additionally carries data-state, so match on both to hit our node rather than the wrapper.
            const node = container.querySelector('[data-id="plan-goal"][data-state]')
            expect(node).not.toBeNull()

            // fireEvent.click dispatches only the click that React Flow's onNodeClick listens for. A
            // full userEvent pointer sequence also fires mousedown, which bubbles to the pane and trips
            // d3-zoom's pan handler — in jsdom event.view is null, so d3-drag throws. This keeps the
            // exact assertion (onSelect fired with the id) without that jsdom-only crash.
            fireEvent.click(node as Element)

            expect(onSelect).toHaveBeenCalledWith("plan-goal")
        })
    })

    context("when a node is selected", () => {
        it("draws the marching-ants selection box on it", async () => {
            const { container } = renderTree("learn", vi.fn())

            await screen.findByText("Learn Questline")

            const selboxes = container.querySelectorAll('[data-testid="node-selbox"]')
            expect(selboxes.length).toBeGreaterThanOrEqual(1)

            // and the box belongs to the selected node
            const selected = container.querySelector('[data-id="learn"][data-state]')
            expect(selected?.querySelector('[data-testid="node-selbox"]')).not.toBeNull()
        })
    })

    context("linked nodes (kind by targetBoardId, not a static id set)", () => {
        // A tiny board: a regular root with one linked child. The child's kind is decided purely by the
        // presence of its targetBoardId key -- no id list.
        const root: Node = { id: "g", name: "Goal", x: 200, y: 80, tier: 0, description: "", reward: 5 }
        const linked = (targetBoardId: string | null): Node => ({ id: "lk", name: "", x: 200, y: 240, tier: 1, targetBoardId })
        const targetBoards: Boards = { target: newBoard("target", "target-root", "Other Quest") }

        it("renders a linked child, live-mirroring its target board's root name", async () => {
            const { container } = renderTree(null, vi.fn(), new Set(), { g: root, lk: linked("target") }, [["g", "lk"]], "g", targetBoards)

            // The linked node reads as its target board's root name, and carries the linked-node marker
            // (not data-state, which is a regular node card's).
            expect(await screen.findByText("Other Quest")).toBeInTheDocument()
            const chip = container.querySelector('[data-id="lk"][data-linked-node]')
            expect(chip).not.toBeNull()
            expect(chip?.hasAttribute("data-state")).toBe(false)
            // The regular root is a node card (data-state), proving the two kinds split on targetBoardId.
            expect(container.querySelector('[data-id="g"][data-state]')).not.toBeNull()
            expect(container.querySelector('[data-id="g"][data-linked-node]')).toBeNull()
        })

        it("shows the placeholder for an unlinked linked node", async () => {
            renderTree(null, vi.fn(), new Set(), { g: root, lk: linked(null) }, [["g", "lk"]], "g", {})
            expect(await screen.findByText(UNLINKED_LABEL)).toBeInTheDocument()
        })

        it("selects a linked node by id on click, like any node", async () => {
            const onSelect = vi.fn()
            const { container } = renderTree(null, onSelect, new Set(), { g: root, lk: linked("target") }, [["g", "lk"]], "g", targetBoards)
            await screen.findByText("Other Quest")

            const chip = container.querySelector('[data-id="lk"][data-linked-node]')
            fireEvent.click(chip as Element)
            expect(onSelect).toHaveBeenCalledWith("lk")
        })
    })

    context("buildEdges (a link lights once the node below it is mastered)", () => {
        const edgeNodes: Record<string, Node> = {
            g: { id: "g", name: "Goal", x: 0, y: 0, tier: 0, description: "", reward: 5 },
            n: { id: "n", name: "Node", x: 0, y: 0, tier: 1, description: "", reward: 3 },
            lk: { id: "lk", name: "", x: 0, y: 0, tier: 1, targetBoardId: "target" }
        }
        // The lit flag of the single edge built from [g -> child].
        const litOf = (edges: Edge[], mastered: Set<string>, nodes: Record<string, Node>, boards: Boards) =>
            buildEdges(edges, mastered, nodes, boardCompleter(boards))[0]?.data?.lit

        it("lights a regular child in the mastered set (unchanged bottom-up rule)", () => {
            expect(litOf([["g", "n"]], new Set(["n"]), edgeNodes, {})).toBe(true)
        })

        it("leaves a regular child dark when not mastered", () => {
            expect(litOf([["g", "n"]], new Set(), edgeNodes, {})).toBe(false)
        })

        it("lights a linked child once its target board is complete (derived mastery)", () => {
            const boards: Boards = {
                target: { ...newBoard("target", "target-root", "Other Quest"), mastered: new Set(["target-root"]) }
            }
            expect(litOf([["g", "lk"]], new Set(), edgeNodes, boards)).toBe(true)
        })

        it("leaves a linked child dark while its target board is incomplete", () => {
            const boards: Boards = { target: newBoard("target", "target-root", "Other Quest") }
            expect(litOf([["g", "lk"]], new Set(), edgeNodes, boards)).toBe(false)
        })

        it("leaves a linked child dark while unlinked", () => {
            const unlinked: Record<string, Node> = { ...edgeNodes, lk: { id: "lk", name: "", x: 0, y: 0, tier: 1, targetBoardId: null } }
            expect(litOf([["g", "lk"]], new Set(), unlinked, {})).toBe(false)
        })
    })

    context("when a node is added after the tree has settled", () => {
        // Stub the Web Animations API jsdom lacks; a spawned card calls el.animate().
        const divProto = Object.getPrototypeOf(document.createElement("div")) as HTMLDivElement
        const origMatchMedia = window.matchMedia
        let animate: ReturnType<typeof vi.fn>

        beforeEach(() => {
            animate = vi.fn()
            divProto.animate = animate as unknown as HTMLDivElement["animate"]
            window.matchMedia = ((query: string) => ({ matches: false, media: query })) as typeof window.matchMedia
        })

        afterEach(() => {
            // biome-ignore lint/performance/noDelete: undo the stub jsdom never shipped
            delete (divProto as Partial<HTMLDivElement>).animate
            window.matchMedia = origMatchMedia
        })

        it("spawns the new card, proving the spawn context reaches React Flow's nodes", async () => {
            const root: Node = { id: "g", name: "Goal", x: 200, y: 80, tier: 0, description: "", reward: 5 }
            const onSelect = vi.fn()
            const { rerender } = renderTree(null, onSelect, new Set(), { g: root }, [], "g")
            await screen.findByText("Goal")
            animate.mockClear() // ignore anything from the initial settle; only the later add should animate

            const child: Node = { id: "c", name: "Fresh Node", x: 200, y: 240, tier: 1, description: "", reward: 3 }
            rerender(
                <div style={{ width: 1200, height: 800 }}>
                    <BoardTree
                        selectedId={null}
                        onSelect={onSelect}
                        rootId="g"
                        mastered={new Set()}
                        nodes={{ g: root, c: child }}
                        edges={[["g", "c"]]}
                        boards={{}}
                        onMove={vi.fn()}
                    />
                </div>
            )
            await screen.findByText("Fresh Node")

            expect(animate).toHaveBeenCalled()
        })
    })

    context("reparent affordances (Phase 2: touch + hover + reduced motion)", () => {
        // Render the tree already armed on `detached`, returning the onAttach spy + render utils.
        function renderArmed(detached: string, onAttach = vi.fn()) {
            const utils = render(
                <div style={{ width: 1200, height: 800 }}>
                    <BoardTree
                        selectedId={null}
                        onSelect={vi.fn()}
                        rootId="learn"
                        mastered={MASTERED}
                        nodes={defaultNodes}
                        edges={EDGES}
                        boards={{}}
                        onMove={vi.fn()}
                        reparenting={detached}
                        onAttach={onAttach}
                    />
                </div>
            )
            return { onAttach, ...utils }
        }

        // React Flow wraps each node's card in a div carrying data-id but no data-state; that wrapper is
        // what onNodeMouseEnter is wired to, so hover tests target it.
        const nodeWrapper = (container: HTMLElement, id: string) =>
            container.querySelector(`.react-flow__node[data-id="${id}"]`) as Element
        // Our node card root carries data-id AND data-state (the wrapper above has only data-id).
        const nodeCard = (container: HTMLElement, id: string) =>
            container.querySelector(`[data-id="${id}"][data-state]`) as Element
        // The BoardTree root (its own wrapper, an ancestor of React Flow's pane) captures presses; a
        // press dispatched here can't reach d3-zoom, which would crash under jsdom.
        const treeRoot = (container: HTMLElement) => container.querySelector(".relative.h-full.w-full") as HTMLElement

        context("isReparentTarget (validity mirrors App.attachTo, reusing descendantsOf)", () => {
            it("accepts a node that is neither the detached node nor a descendant", () => {
                expect(isReparentTarget("plan-goal", "track-progress", EDGES)).toBe(true)
            })
            it("rejects the detached node itself", () => {
                expect(isReparentTarget("track-progress", "track-progress", EDGES)).toBe(false)
            })
            it("rejects a descendant of the detached node (attaching there would cycle)", () => {
                // finish-node hangs under track-progress.
                expect(isReparentTarget("finish-node", "track-progress", EDGES)).toBe(false)
            })
        })

        context("tap-vs-pan (touch attaches only on a tap)", () => {
            it("attaches on a tap: a press that barely moves before the click", async () => {
                const { container, onAttach } = renderArmed("finish-node")
                await screen.findByText("Plan your goal")
                // Press then click at (near) the same spot -- within the press-move tolerance.
                fireEvent.pointerDown(treeRoot(container), { clientX: 100, clientY: 100 })
                fireEvent.click(nodeCard(container, "plan-goal"), { clientX: 103, clientY: 101 })
                expect(onAttach).toHaveBeenCalledWith("plan-goal")
            })

            it("does not attach when the press drifts past the tolerance (a pan to reach a target)", async () => {
                const { container, onAttach } = renderArmed("finish-node")
                await screen.findByText("Plan your goal")
                // Press, then release far away: the click that follows a pan must not misfire as attach.
                fireEvent.pointerDown(treeRoot(container), { clientX: 100, clientY: 100 })
                fireEvent.click(nodeCard(container, "plan-goal"), { clientX: 180, clientY: 160 })
                expect(onAttach).not.toHaveBeenCalled()
            })
        })

        it("shows the armed hint on the detached node while armed", async () => {
            renderArmed("finish-node")
            expect(await screen.findByText("Tap a node to reattach")).toBeInTheDocument()
        })

        it("highlights a valid hover target, but not the detached node or a descendant", async () => {
            const { container } = renderArmed("track-progress")
            await screen.findByText("Plan your goal")
            const targetRing = () => screen.queryByTestId("reparent-target")

            // No drop-target ring until a valid node is hovered.
            expect(targetRing()).toBeNull()
            // Hovering a valid node (React onMouseEnter is driven by the native mouseover) lights it...
            fireEvent.mouseOver(nodeWrapper(container, "plan-goal"))
            expect(targetRing()).toBeInTheDocument()
            fireEvent.mouseOut(nodeWrapper(container, "plan-goal"))
            expect(targetRing()).toBeNull()
            // ...but finish-node is a descendant of the detached track-progress, so it stays dim.
            fireEvent.mouseOver(nodeWrapper(container, "finish-node"))
            expect(targetRing()).toBeNull()
        })

        context("reduced motion (the band respects prefers-reduced-motion)", () => {
            const origMatchMedia = window.matchMedia
            const bandLine = () => screen.getByTestId("reparent-band").querySelector("path")
            afterEach(() => {
                window.matchMedia = origMatchMedia
            })

            it("marches the band's dashes by default", async () => {
                window.matchMedia = ((q: string) => ({ matches: false, media: q })) as typeof window.matchMedia
                renderArmed("finish-node")
                await screen.findByTestId("reparent-band")
                expect(bandLine()?.getAttribute("class") ?? "").toContain("march")
            })

            it("drops the animation under reduced motion, but still draws the band", async () => {
                window.matchMedia = ((q: string) => ({ matches: true, media: q })) as typeof window.matchMedia
                renderArmed("finish-node")
                await screen.findByTestId("reparent-band")
                expect(bandLine()).toBeInTheDocument()
                expect(bandLine()?.getAttribute("class") ?? "").not.toContain("march")
            })
        })
    })
})

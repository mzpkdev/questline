import { fireEvent, render, screen } from "@testing-library/react"
import { BoardTree } from "./BoardTree"
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
    rootId = "learn"
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
                        onMove={vi.fn()}
                    />
                </div>
            )
            await screen.findByText("Fresh Node")

            expect(animate).toHaveBeenCalled()
        })
    })
})

import { render } from "@testing-library/react"
import { type Edge, type Node, Position, ReactFlow } from "@xyflow/react"
import { afterEach, beforeEach, expect, vi } from "vitest"
import { MilestoneEdge } from "./MilestoneEdge"
import { NODE_REACHED } from "./nodeMotion"

// React Flow only mounts an edge once getEdgePosition() resolves, and that needs each node to be
// "initialized": it must carry measured dimensions plus handle bounds. jsdom never lays anything
// out and our ResizeObserver stub is a no-op, so nothing gets measured on its own. We therefore
// hand the nodes explicit width/height and handles — the parent's bottom source, the child's top
// target — which React Flow adopts verbatim, letting the glow edge render deterministically.
function buildNodes(): Node[] {
    return [
        {
            id: "a",
            position: { x: 0, y: 0 },
            data: {},
            width: 180,
            height: 60,
            handles: [{ type: "source", position: Position.Bottom, x: 90, y: 60 }]
        },
        {
            id: "b",
            position: { x: 0, y: 200 },
            data: {},
            width: 180,
            height: 60,
            handles: [{ type: "target", position: Position.Top, x: 90, y: 0 }]
        }
    ]
}

function tree(lit: boolean) {
    const edge: Edge = { id: "a-b", source: "a", target: "b", type: "glow", data: { lit } }
    return (
        <div style={{ width: 800, height: 600 }}>
            <ReactFlow nodes={buildNodes()} edges={[edge]} edgeTypes={{ glow: MilestoneEdge }} fitView />
        </div>
    )
}

function renderEdge(lit: boolean) {
    return render(tree(lit))
}

describe("MilestoneEdge", () => {
    context("when the child below is complete", () => {
        it("lights the over-path solid gold with no dashes", () => {
            const { container } = renderEdge(true)
            const over = container.querySelector('[data-testid="edge-over"]')

            expect(over).toBeInTheDocument()
            expect(over).toHaveAttribute("stroke", "#e9b949")
            expect(over).not.toHaveAttribute("stroke-dasharray")
        })

        it("keeps the old planned thread as a dotted ghost beneath, for the grow to draw over", () => {
            const { container } = renderEdge(true)
            const ghost = container.querySelector('[data-testid="edge-ghost"]')

            expect(ghost).toBeInTheDocument()
            expect(ghost).toHaveAttribute("stroke", "#c9ba95")
            expect(ghost).toHaveAttribute("stroke-dasharray", "2 9")
        })
    })

    context("when the child below is still planned", () => {
        it("renders the over-path dimmed and dotted", () => {
            const { container } = renderEdge(false)
            const over = container.querySelector('[data-testid="edge-over"]')

            expect(over).toBeInTheDocument()
            expect(over).toHaveAttribute("stroke", "#c9ba95")
            expect(over).toHaveAttribute("stroke-dasharray", "2 9")
        })

        it("renders no ghost thread (only the single dotted stroke)", () => {
            const { container } = renderEdge(false)
            expect(container.querySelector('[data-testid="edge-ghost"]')).not.toBeInTheDocument()
        })
    })

    context("when the child completes (planned -> lit)", () => {
        // jsdom implements neither getTotalLength nor the Web Animations API; the grow measures the
        // path then draws it in via el.animate(), so stub both to observe what the transition fires.
        // (SVGPathElement isn't a bare global here, so reach its prototype through a real element.)
        const pathProto = Object.getPrototypeOf(
            document.createElementNS("http://www.w3.org/2000/svg", "path")
        ) as SVGPathElement
        let animate: ReturnType<typeof vi.fn>
        // Each stubbed animation records its "finish" listeners so a test can fire them by hand.
        let started: Array<{ finish: Array<() => void> }>
        const origMatchMedia = window.matchMedia

        beforeEach(() => {
            started = []
            animate = vi.fn(() => {
                const rec = {
                    finish: [] as Array<() => void>,
                    addEventListener(type: string, cb: () => void) {
                        if (type === "finish") rec.finish.push(cb)
                    },
                    cancel() {}
                }
                started.push(rec)
                return rec
            })
            pathProto.getTotalLength = () => 300
            pathProto.animate = animate as unknown as SVGPathElement["animate"]
            window.matchMedia = ((query: string) => ({ matches: false, media: query })) as typeof window.matchMedia
        })

        afterEach(() => {
            // biome-ignore lint/performance/noDelete: undo the stubs jsdom never shipped
            delete (pathProto as Partial<SVGPathElement>).getTotalLength
            // biome-ignore lint/performance/noDelete: undo the stubs jsdom never shipped
            delete (pathProto as Partial<SVGPathElement>).animate
            window.matchMedia = origMatchMedia
        })

        it("grows both stacked paths in toward the parent above", () => {
            const { rerender } = render(tree(false))
            expect(animate).not.toHaveBeenCalled()

            rerender(tree(true))

            // Soft under-glow + crisp over-stroke draw in together.
            expect(animate).toHaveBeenCalledTimes(2)
            // Revealed from the target(child) end upward: dashoffset climbs from -length to 0.
            const keyframes = (animate.mock.calls[0]?.[0] ?? []) as Array<{ strokeDashoffset: number }>
            expect(keyframes[0]?.strokeDashoffset).toBe(-300)
            expect(keyframes[keyframes.length - 1]?.strokeDashoffset).toBe(0)
        })

        it("does not replay for an edge that mounts already lit", () => {
            render(tree(true))
            expect(animate).not.toHaveBeenCalled()
        })

        it("pops the node it reaches once the gold finishes climbing", () => {
            const reached = vi.fn()
            window.addEventListener(NODE_REACHED, reached)
            const { rerender } = render(tree(false))
            rerender(tree(true))

            // The over-stroke (drawn last) carries the arrival signal; fire its finish handlers.
            started.at(-1)?.finish.forEach((fn) => fn())
            window.removeEventListener(NODE_REACHED, reached)

            expect(reached).toHaveBeenCalledTimes(1)
            // Grows toward the parent, so the reached node is the edge's source ("a").
            expect((reached.mock.calls[0]?.[0] as CustomEvent<{ id: string }>).detail.id).toBe("a")
        })
    })
})

import { render } from "@testing-library/react"
import { afterEach, beforeEach, expect, vi } from "vitest"
import type { NodeState } from "./nodes"
import { NODE_REACHED, SpawnReadyContext, useCheckPop, useNodeMotion } from "./nodeMotion"

function Probe({ id, state = "available" }: { id: string; state?: NodeState }) {
    const ref = useNodeMotion<HTMLDivElement>(id, state)
    return <div data-testid="probe" ref={ref} />
}

function CheckProbe({ done }: { done: boolean }) {
    const ref = useCheckPop<HTMLDivElement>(done)
    return <div data-testid="probe" ref={ref} />
}

function reach(id: string) {
    window.dispatchEvent(new CustomEvent(NODE_REACHED, { detail: { id } }))
}

describe("useNodeMotion", () => {
    // jsdom ships no Web Animations API; stub el.animate (via a real element's prototype, since
    // HTMLDivElement isn't a bare global here) to observe whether a card animates.
    const divProto = Object.getPrototypeOf(document.createElement("div")) as HTMLDivElement
    let animate: ReturnType<typeof vi.fn>
    const origMatchMedia = window.matchMedia

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

    context("arrival pop", () => {
        it("pops when an edge reaches its id", () => {
            render(<Probe id="a" />)
            reach("a")
            expect(animate).toHaveBeenCalledTimes(1)
        })

        it("ignores arrivals at other nodes", () => {
            render(<Probe id="a" />)
            reach("b")
            expect(animate).not.toHaveBeenCalled()
        })
    })

    context("complete seal", () => {
        it("seals when the node crosses into mastered", () => {
            const { rerender } = render(<Probe id="a" state="available" />)
            expect(animate).not.toHaveBeenCalled()
            rerender(<Probe id="a" state="mastered" />)
            expect(animate).toHaveBeenCalledTimes(1)
        })

        it("does not seal a node that mounts already mastered", () => {
            render(<Probe id="a" state="mastered" />)
            expect(animate).not.toHaveBeenCalled()
        })

        it("does not animate when a node is un-completed (mastered -> available)", () => {
            const { rerender } = render(<Probe id="a" state="mastered" />)
            rerender(<Probe id="a" state="available" />)
            expect(animate).not.toHaveBeenCalled()
        })
    })

    context("unlock ignite", () => {
        it("ignites when a node unlocks (locked -> available)", () => {
            const { rerender } = render(<Probe id="a" state="locked" />)
            expect(animate).not.toHaveBeenCalled()
            rerender(<Probe id="a" state="available" />)
            expect(animate).toHaveBeenCalledTimes(1)
        })

        it("does not ignite a node that mounts available", () => {
            render(<Probe id="a" state="available" />)
            expect(animate).not.toHaveBeenCalled()
        })
    })

    context("spawn", () => {
        function mountWith(ready: boolean) {
            return render(
                <SpawnReadyContext.Provider value={ready}>
                    <Probe id="a" />
                </SpawnReadyContext.Provider>
            )
        }

        it("spawns a node that appears after the tree settled", () => {
            mountWith(true)
            expect(animate).toHaveBeenCalledTimes(1)
        })

        it("stays still for the initial-mount batch", () => {
            mountWith(false)
            expect(animate).not.toHaveBeenCalled()
        })
    })

    it("stays still throughout when reduced motion is preferred", () => {
        window.matchMedia = ((query: string) => ({ matches: true, media: query })) as typeof window.matchMedia
        const { rerender } = render(
            <SpawnReadyContext.Provider value={true}>
                <Probe id="a" state="available" />
            </SpawnReadyContext.Provider>
        )
        reach("a")
        rerender(
            <SpawnReadyContext.Provider value={true}>
                <Probe id="a" state="mastered" />
            </SpawnReadyContext.Provider>
        )
        expect(animate).not.toHaveBeenCalled()
    })
})

describe("useCheckPop", () => {
    const divProto = Object.getPrototypeOf(document.createElement("div")) as HTMLDivElement
    let animate: ReturnType<typeof vi.fn>
    const origMatchMedia = window.matchMedia

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

    it("bounces the box when it is ticked", () => {
        const { rerender } = render(<CheckProbe done={false} />)
        expect(animate).not.toHaveBeenCalled()
        rerender(<CheckProbe done={true} />)
        expect(animate).toHaveBeenCalledTimes(1)
    })

    it("stays still for a box that mounts already ticked", () => {
        render(<CheckProbe done={true} />)
        expect(animate).not.toHaveBeenCalled()
    })

    it("does not bounce when a box is un-ticked", () => {
        const { rerender } = render(<CheckProbe done={true} />)
        rerender(<CheckProbe done={false} />)
        expect(animate).not.toHaveBeenCalled()
    })
})

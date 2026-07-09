import { render, screen } from "@testing-library/react"
import { afterEach, beforeEach, expect, vi } from "vitest"
import { SectionTransition } from "./SectionTransition"

describe("SectionTransition", () => {
    // jsdom ships no Web Animations API; stub el.animate (via a real element's prototype, mirroring
    // nodeMotion.spec) to observe whether a section plays its entrance.
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

    it("fades in on mount when animate is set", () => {
        render(<SectionTransition animate={true}>content</SectionTransition>)
        expect(animate).toHaveBeenCalledTimes(1)
    })

    it("stays still for the section shown at first load", () => {
        render(<SectionTransition animate={false}>content</SectionTransition>)
        expect(animate).not.toHaveBeenCalled()
    })

    it("ignores a later flip to animate on the same instance", () => {
        // The decision is frozen at mount, so a stray re-render (prop flips false -> true without a
        // remount) must not retrigger the entrance.
        const { rerender } = render(<SectionTransition animate={false}>content</SectionTransition>)
        rerender(<SectionTransition animate={true}>content</SectionTransition>)
        expect(animate).not.toHaveBeenCalled()
    })

    it("replays when it remounts under a new key", () => {
        // How App drives it: a section change swaps the key, so a fresh instance mounts and animates.
        const { rerender } = render(
            <SectionTransition key="roadmap" animate={true}>
                content
            </SectionTransition>
        )
        rerender(
            <SectionTransition key="bounties" animate={true}>
                content
            </SectionTransition>
        )
        expect(animate).toHaveBeenCalledTimes(2)
    })

    it("stays still when reduced motion is preferred", () => {
        window.matchMedia = ((query: string) => ({ matches: true, media: query })) as typeof window.matchMedia
        render(<SectionTransition animate={true}>content</SectionTransition>)
        expect(animate).not.toHaveBeenCalled()
    })

    it("renders its children", () => {
        render(
            <SectionTransition animate={false}>
                <span>hello</span>
            </SectionTransition>
        )
        expect(screen.getByText("hello")).toBeInTheDocument()
    })
})

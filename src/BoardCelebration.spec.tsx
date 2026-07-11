import { render } from "@testing-library/react"
import { afterEach, beforeEach, expect } from "vitest"
import { BoardCelebration } from "./BoardCelebration"

describe("BoardCelebration", () => {
    const origMatchMedia = window.matchMedia

    beforeEach(() => {
        window.matchMedia = ((query: string) => ({ matches: false, media: query })) as typeof window.matchMedia
    })
    afterEach(() => {
        window.matchMedia = origMatchMedia
    })

    it("bursts a ring and a full ring of gold motes from the root node's position", () => {
        const { container } = render(<BoardCelebration burst={{ x: 300, y: 120, nonce: 1 }} />)
        const fanfare = container.querySelector('[data-testid="board-celebration"]')

        expect(fanfare).toBeInTheDocument()
        expect(fanfare?.querySelectorAll("span")).toHaveLength(16)
        // Motes anchor on the passed origin, not the board centre.
        expect((fanfare?.querySelector("span") as HTMLElement).style.left).toBe("300px")
    })

    it("shows nothing until the root node has completed", () => {
        const { container } = render(<BoardCelebration burst={null} />)
        expect(container.querySelector('[data-testid="board-celebration"]')).not.toBeInTheDocument()
    })

    it("stays silent under reduced motion", () => {
        window.matchMedia = ((query: string) => ({ matches: true, media: query })) as typeof window.matchMedia
        const { container } = render(<BoardCelebration burst={{ x: 300, y: 120, nonce: 1 }} />)
        expect(container.querySelector('[data-testid="board-celebration"]')).not.toBeInTheDocument()
    })
})

// @vitest-environment node
// Node env for a real CompressionStream (jsdom has none), matching sync.spec.
import { deflate, inflate } from "./compress"

describe("compress", () => {
    it("round-trips text through deflate/inflate", async () => {
        const text = JSON.stringify({ greeting: "hello world", nums: Array.from({ length: 50 }, (_, i) => i) })
        expect(await inflate(await deflate(text))).toBe(text)
    })

    it("shrinks repetitive JSON well under a third", async () => {
        const text = JSON.stringify(
            Array.from({ length: 200 }, (_, i) => ({ id: `node-${i}`, tag: "Step", branch: "Plan", reward: 3 }))
        )
        const bytes = await deflate(text)
        expect(bytes.length).toBeLessThan(text.length / 3)
    })
})

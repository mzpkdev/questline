import { createSfx } from "./sfx"

const EFFECTS = ["blip", "success", "tick", "coin", "fanfare"] as const

describe("createSfx", () => {
    it("returns a frozen kit exposing every effect plus the lifecycle controls", () => {
        const sfx = createSfx()
        for (const name of EFFECTS) expect(typeof sfx[name]).toBe("function")
        expect(typeof sfx.unlock).toBe("function")
        expect(typeof sfx.setMuted).toBe("function")
        expect(typeof sfx.isMuted).toBe("function")
        expect(Object.isFrozen(sfx)).toBe(true)
    })

    it("degrades to a silent no-op when WebAudio is unavailable (jsdom), never throwing", () => {
        const sfx = createSfx()
        expect(() => {
            sfx.unlock()
            for (const name of EFFECTS) sfx[name]()
        }).not.toThrow()
    })

    it("tracks the mute flag through setMuted / isMuted", () => {
        const sfx = createSfx()
        expect(sfx.isMuted()).toBe(false)
        sfx.setMuted(true)
        expect(sfx.isMuted()).toBe(true)
        sfx.setMuted(false)
        expect(sfx.isMuted()).toBe(false)
    })
})

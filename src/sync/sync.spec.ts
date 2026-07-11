// @vitest-environment node
// Node env: real WebCrypto (no polyfill) + a mocked global fetch. sync.ts touches no DOM/localStorage,
// so the round-trip below runs the genuine encrypt→store→decrypt path end to end.

import { seedBoard } from "../board"
import { generateCode } from "./crypto"
import { pull, push, syncEnabled } from "./sync"

const slices = () => ({
    boards: { seed: seedBoard() },
    boardOrder: ["seed"],
    tasks: [],
    rewards: [],
    banked: { earned: 0, spent: 0 },
    notes: []
})

describe("sync client", () => {
    afterEach(() => {
        vi.unstubAllEnvs()
        vi.unstubAllGlobals()
    })

    it("no-ops and never fetches when VITE_SYNC_URL is unset", async () => {
        vi.stubEnv("VITE_SYNC_URL", "")
        const fetchSpy = vi.fn()
        vi.stubGlobal("fetch", fetchSpy)
        expect(syncEnabled()).toBe(false)
        expect(await pull("code")).toBeNull()
        expect(await push("code", slices(), 1)).toEqual({ ok: true, version: 0 })
        expect(fetchSpy).not.toHaveBeenCalled()
    })

    it("round-trips push -> pull through the encrypted envelope, carrying the server version", async () => {
        vi.stubEnv("VITE_SYNC_URL", "https://sync.example/")
        const code = generateCode()
        let stored = ""
        const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
            if (init?.method === "PUT") {
                stored = init.body as string
                return new Response(null, { status: 204, headers: { "x-sync-version": "111" } })
            }
            return new Response(stored, { status: 200, headers: { "x-sync-version": "111" } })
        })
        vi.stubGlobal("fetch", fetchMock)

        expect(await push(code, slices(), 999)).toEqual({ ok: true, version: 111 })
        // The stored body is opaque ciphertext, not the plaintext roadmap.
        expect(stored).not.toContain("Learn Questline")

        const pulled = await pull(code)
        expect(pulled?.version).toBe(111)
        expect(pulled?.slices.boardOrder).toEqual(["seed"])
        expect(pulled?.slices.boards.seed?.mastered).toBeInstanceOf(Set)
    })

    it("returns null when the blob is absent (404)", async () => {
        vi.stubEnv("VITE_SYNC_URL", "https://sync.example")
        vi.stubGlobal(
            "fetch",
            vi.fn(async () => new Response(null, { status: 404 }))
        )
        expect(await pull(generateCode())).toBeNull()
    })

    it("returns null when the stored blob can't be decrypted (wrong key / garbage)", async () => {
        vi.stubEnv("VITE_SYNC_URL", "https://sync.example")
        vi.stubGlobal(
            "fetch",
            vi.fn(async () => new Response("this-is-not-a-valid-ciphertext", { status: 200 }))
        )
        expect(await pull(generateCode())).toBeNull()
    })

    it("throws on an unexpected server error during pull", async () => {
        vi.stubEnv("VITE_SYNC_URL", "https://sync.example")
        vi.stubGlobal(
            "fetch",
            vi.fn(async () => new Response(null, { status: 500 }))
        )
        await expect(pull(generateCode())).rejects.toThrow()
    })

    it("classifies 429/5xx as retryable and 4xx as not", async () => {
        vi.stubEnv("VITE_SYNC_URL", "https://sync.example")
        vi.stubGlobal(
            "fetch",
            vi.fn(async () => new Response(null, { status: 429 }))
        )
        expect(await push(generateCode(), slices(), 1)).toEqual({ ok: false, status: 429, retryable: true })
        vi.stubGlobal(
            "fetch",
            vi.fn(async () => new Response(null, { status: 400 }))
        )
        expect(await push(generateCode(), slices(), 1)).toEqual({ ok: false, status: 400, retryable: false })
    })
})

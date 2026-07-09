// @vitest-environment node
// Node env: exercise the blob data-path functions directly against a Map-backed KV stub -- no workerd,
// no wrangler, no network. Node's global Request/Response stand in for the Workers runtime's.

import { readBlob, writeBlob, type Env } from "./blob"

const VALID_ID = "A".repeat(43) // 32 bytes of base64url, the shape deriveKeys() produces

function makeEnv(): Env {
    const store = new Map<string, { value: string; metadata: unknown }>()
    const QUESTLINE = {
        async getWithMetadata(key: string) {
            const entry = store.get(key)
            return { value: entry?.value ?? null, metadata: entry?.metadata ?? null }
        },
        async put(key: string, value: string, opts?: { metadata?: unknown }) {
            store.set(key, { value, metadata: opts?.metadata ?? null })
        }
    }
    return { QUESTLINE } as unknown as Env
}

function put(env: Env, id: string, body: string): Promise<Response> {
    return writeBlob(env, id, new Request(`https://pages.example/v1/blob/${id}`, { method: "PUT", body }))
}

describe("sync blob store", () => {
    it("stores a blob and reads it back with the same server version", async () => {
        const env = makeEnv()
        const written = await put(env, VALID_ID, "cipher-text-blob")
        expect(written.status).toBe(204)
        const version = written.headers.get("x-sync-version")
        expect(version).toBeTruthy()

        const read = await readBlob(env, VALID_ID)
        expect(read.status).toBe(200)
        expect(await read.text()).toBe("cipher-text-blob")
        expect(read.headers.get("x-sync-version")).toBe(version)
    })

    it("404s an absent blob", async () => {
        expect((await readBlob(makeEnv(), VALID_ID)).status).toBe(404)
    })

    it("rejects a malformed id (wrong length or char) with 400", async () => {
        const env = makeEnv()
        expect((await readBlob(env, "short")).status).toBe(400)
        expect((await put(env, `${"A".repeat(42)}.`, "x")).status).toBe(400)
    })

    it("rejects an oversized body with 413", async () => {
        const big = "A".repeat(1_048_577) // one byte over the 1 MiB cap
        expect((await put(makeEnv(), VALID_ID, big)).status).toBe(413)
    })
})

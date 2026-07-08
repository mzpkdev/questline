// @vitest-environment node
// Node env: exercise the Worker's fetch handler directly against a Map-backed KV stub -- no workerd,
// no wrangler, no network. Node's global Request/Response/URL stand in for the Workers runtime's.

import worker, { type Env } from "./index"

const VALID_ID = "A".repeat(43) // 32 bytes of base64url, the shape deriveKeys() produces
const ORIGIN = "https://app.example"

function makeEnv(allow: string = ORIGIN): Env {
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
    return { QUESTLINE, ALLOWED_ORIGIN: allow } as unknown as Env
}

function call(env: Env, method: string, id: string, init: RequestInit = {}): Promise<Response> {
    return worker.fetch(new Request(`https://worker.example/v1/blob/${id}`, { method, ...init }), env)
}

describe("sync worker", () => {
    it("answers a CORS preflight with the allowed origin and methods", async () => {
        const res = await worker.fetch(
            new Request(`https://worker.example/v1/blob/${VALID_ID}`, {
                method: "OPTIONS",
                headers: { origin: ORIGIN }
            }),
            makeEnv()
        )
        expect(res.status).toBe(204)
        expect(res.headers.get("access-control-allow-origin")).toBe(ORIGIN)
        expect(res.headers.get("access-control-allow-methods")).toContain("PUT")
    })

    it("stores a blob and reads it back with the same server version", async () => {
        const env = makeEnv()
        const put = await call(env, "PUT", VALID_ID, { body: "cipher-text-blob" })
        expect(put.status).toBe(204)
        const version = put.headers.get("x-sync-version")
        expect(version).toBeTruthy()

        const get = await call(env, "GET", VALID_ID)
        expect(get.status).toBe(200)
        expect(await get.text()).toBe("cipher-text-blob")
        expect(get.headers.get("x-sync-version")).toBe(version)
        expect(get.headers.get("access-control-expose-headers")).toContain("x-sync-version")
    })

    it("404s an absent blob", async () => {
        expect((await call(makeEnv(), "GET", VALID_ID)).status).toBe(404)
    })

    it("rejects a malformed id (wrong length or char) with 400", async () => {
        const env = makeEnv()
        expect((await call(env, "GET", "short")).status).toBe(400)
        expect((await call(env, "PUT", `${"A".repeat(42)}.`, { body: "x" })).status).toBe(400)
    })

    it("404s an unknown path", async () => {
        const res = await worker.fetch(new Request("https://worker.example/health", { method: "GET" }), makeEnv())
        expect(res.status).toBe(404)
    })

    it("rejects an oversized body with 413", async () => {
        const big = "A".repeat(1_048_577) // one byte over the 1 MiB cap
        expect((await call(makeEnv(), "PUT", VALID_ID, { body: big })).status).toBe(413)
    })

    it("rejects unsupported methods with 405", async () => {
        const res = await call(makeEnv(), "DELETE", VALID_ID)
        expect(res.status).toBe(405)
        expect(res.headers.get("allow")).toContain("GET")
    })

    it("echoes an allowlisted origin, else falls back to the first configured", async () => {
        const env = makeEnv("https://a.example,https://b.example")
        const allowed = await worker.fetch(
            new Request(`https://worker.example/v1/blob/${VALID_ID}`, { method: "GET", headers: { origin: "https://b.example" } }),
            env
        )
        expect(allowed.headers.get("access-control-allow-origin")).toBe("https://b.example")

        const foreign = await worker.fetch(
            new Request(`https://worker.example/v1/blob/${VALID_ID}`, { method: "GET", headers: { origin: "https://evil.example" } }),
            env
        )
        expect(foreign.headers.get("access-control-allow-origin")).toBe("https://a.example")
    })
})

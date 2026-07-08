// The whole sync backend: a dumb, zero-knowledge ciphertext store on Cloudflare KV. It never sees a
// key or plaintext -- the client (src/sync) encrypts end to end, so a blob here is opaque bytes keyed
// by an id the client derives from its secret sync code.
//
// Two routes under /v1/blob/:id -- GET reads the blob, PUT overwrites it. Conflict policy is
// last-write-wins ordered by receipt: each PUT stamps a server-side version (ms) into KV metadata and
// returns it in a header, so clients reconcile on the server's clock, never their own. There is no
// auth beyond holding the id: whoever has it can read/overwrite that one blob (a write-DoS risk, but
// they can't forge valid ciphertext -- a bad write just fails the client's auth tag and self-heals
// from local). Confidentiality rests entirely on the id/code staying secret and storage being
// ciphertext-only.

export interface Env {
    QUESTLINE: KVNamespace
    // Comma-separated origin allowlist (e.g. "https://user.github.io,http://localhost:5173"). The
    // matching request Origin is echoed back; CORS is defense-in-depth, not the access control.
    ALLOWED_ORIGIN: string
}

const BLOB_PREFIX = "/v1/blob/"
// 32 raw bytes as unpadded base64url -> exactly 43 chars. Pinning the shape blocks path abuse and
// oversized keys, and matches deriveKeys() in the client.
const ID_RE = /^[A-Za-z0-9_-]{43}$/
// A roadmap blob is kilobytes; cap well above that but small enough that KV/logs stay cheap.
const MAX_BODY_BYTES = 1_048_576 // 1 MiB
const VERSION_HEADER = "x-sync-version"

export default {
    async fetch(request: Request, env: Env): Promise<Response> {
        const withCors = (res: Response) => cors(env, request, res)

        if (request.method === "OPTIONS") return withCors(new Response(null, { status: 204 }))

        const { pathname } = new URL(request.url)
        if (!pathname.startsWith(BLOB_PREFIX)) return withCors(new Response("not found", { status: 404 }))
        const id = pathname.slice(BLOB_PREFIX.length)
        if (!ID_RE.test(id)) return withCors(new Response("bad id", { status: 400 }))

        if (request.method === "GET") return withCors(await handleGet(env, id))
        if (request.method === "PUT") return withCors(await handlePut(request, env, id))
        return withCors(new Response("method not allowed", { status: 405, headers: { allow: "GET, PUT, OPTIONS" } }))
    }
}

async function handleGet(env: Env, id: string): Promise<Response> {
    const { value, metadata } = await env.QUESTLINE.getWithMetadata<{ version: number }>(id)
    if (value === null) return new Response(null, { status: 404 })
    return new Response(value, { status: 200, headers: { [VERSION_HEADER]: String(metadata?.version ?? 0) } })
}

async function handlePut(request: Request, env: Env, id: string): Promise<Response> {
    // Reject on the declared size before buffering, then re-check the actual length (Content-Length can
    // be absent or wrong).
    const declared = Number(request.headers.get("content-length") ?? "0")
    if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
        return new Response("payload too large", { status: 413 })
    }
    const body = await request.text()
    if (body.length > MAX_BODY_BYTES) return new Response("payload too large", { status: 413 })

    const version = Date.now()
    await env.QUESTLINE.put(id, body, { metadata: { version } })
    return new Response(null, { status: 204, headers: { [VERSION_HEADER]: String(version) } })
}

// Which allowlisted origin to echo: the request's own Origin if allowed, else the first configured one
// (so a same-origin/no-Origin request still gets a sane value). `vary: origin` keeps caches honest.
function allowedOrigin(env: Env, request: Request): string {
    const list = env.ALLOWED_ORIGIN.split(",")
        .map((entry) => entry.trim())
        .filter(Boolean)
    const origin = request.headers.get("origin") ?? ""
    if (list.includes(origin)) return origin
    return list[0] ?? ""
}

function cors(env: Env, request: Request, res: Response): Response {
    const headers = new Headers(res.headers)
    headers.set("access-control-allow-origin", allowedOrigin(env, request))
    headers.set("access-control-allow-methods", "GET, PUT, OPTIONS")
    headers.set("access-control-allow-headers", "content-type")
    headers.set("access-control-expose-headers", VERSION_HEADER)
    headers.set("access-control-max-age", "86400")
    headers.append("vary", "origin")
    return new Response(res.body, { status: res.status, statusText: res.statusText, headers })
}

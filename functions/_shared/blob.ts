// The whole sync backend: a dumb, zero-knowledge ciphertext store on Cloudflare KV. It never sees a
// key or plaintext -- the client (src/sync) encrypts end to end, so a blob here is opaque bytes keyed
// by an id the client derives from its secret sync code.
//
// Conflict policy is last-write-wins ordered by receipt: each PUT stamps a server-side version (ms)
// into KV metadata and returns it in the x-sync-version header, so clients reconcile on the server's
// clock, never their own. There is no auth beyond holding the id: whoever has it can read/overwrite
// that one blob (a write-DoS risk), but they can't forge valid ciphertext -- a bad write just fails
// the client's auth tag and self-heals from local. Confidentiality rests entirely on the id/code
// staying secret and storage being ciphertext-only.
//
// Framework-free on purpose: the two data-path functions each own their id-validation and size-cap and
// return a Response, so they stay unit-testable without a Pages context. The Pages Function in
// v1/blob/[id].ts is just a thin method wrapper. App and API are same-origin on Pages, so there is no
// CORS / OPTIONS / 405 layer -- file-routing dispatches the method and the browser never preflights.

export interface Env {
    QUESTLINE: KVNamespace
}

// 32 raw bytes as unpadded base64url -> exactly 43 chars. Pinning the shape blocks path abuse and
// oversized keys, and matches deriveKeys() in the client.
const ID_RE = /^[A-Za-z0-9_-]{43}$/
// A roadmap blob is kilobytes; cap well above that but small enough that KV/logs stay cheap.
const MAX_BODY_BYTES = 1_048_576 // 1 MiB
const VERSION_HEADER = "x-sync-version"

export async function readBlob(env: Env, id: string): Promise<Response> {
    if (!ID_RE.test(id)) return new Response("bad id", { status: 400 })
    const { value, metadata } = await env.QUESTLINE.getWithMetadata<{ version: number }>(id)
    if (value === null) return new Response(null, { status: 404 })
    return new Response(value, { status: 200, headers: { [VERSION_HEADER]: String(metadata?.version ?? 0) } })
}

export async function writeBlob(env: Env, id: string, request: Request): Promise<Response> {
    if (!ID_RE.test(id)) return new Response("bad id", { status: 400 })
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

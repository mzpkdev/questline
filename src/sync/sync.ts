// The network boundary for cross-device sync: pull the roadmap down, push it back up, both as
// ciphertext. It wraps persist.ts's serialize/deserialize in an encrypted envelope and speaks to the
// Worker over fetch. No React, no localStorage, no DOM here -- App owns state and scheduling; this
// module owns "get bytes to/from the server, encrypted." Kept that way so it unit-tests in node.
//
// Conflict policy is last-write-wins ordered by the SERVER's receipt time (returned as a version
// header), not a client clock, so skewed device clocks can't transpose who wins. App compares those
// versions to decide reconcile; this module just carries them.

import { deserialize, type PersistedSlices, serialize } from "../persist"
import { deflate, inflate } from "./compress"
import { decryptBytes, deriveKeys, encryptBytes } from "./crypto"

// The plaintext we encrypt: the persist wire string plus reconcile metadata. Separate from the persist
// format so persist.ts stays untouched; `updatedAt` is only a human-readable hint (the server version
// is authoritative). Versioned so the envelope shape can change later.
const ENVELOPE_VERSION = 1
type Envelope = { v: number; updatedAt: number; data: string }

const BLOB_PATH = "/v1/blob/"
// Response header carrying the server-stamped version (KV receipt time, ms). Case-insensitive; the
// Worker sets the same name and lists it in Access-Control-Expose-Headers so the browser can read it.
const VERSION_HEADER = "x-sync-version"

export type PullResult = { slices: PersistedSlices; version: number }
// A single PUT's result. Retry/backoff and the dirty flag live in App's scheduler, not here, so push
// stays one request and easy to test; it only classifies whether a failure is worth retrying.
export type PushOutcome = { ok: true; version: number } | { ok: false; status: number; retryable: boolean }

// The Worker base with any trailing slash trimmed, or undefined when sync is off (VITE_SYNC_URL unset).
// Read lazily, not at module load, so tests can stub the env per case.
function syncBase(): string | undefined {
    const configured = import.meta.env.VITE_SYNC_URL
    // An explicit value wins: a URL points sync at that origin, "" turns it off. When unset (the common
    // case now that one Cloudflare Worker serves both the app and the API), default to same-origin.
    if (configured !== undefined) return configured ? configured.replace(/\/+$/, "") : undefined
    return typeof window === "undefined" ? undefined : window.location.origin
}

export function syncEnabled(): boolean {
    return syncBase() !== undefined
}

// Fetch and decrypt the remote roadmap. Returns null for "no usable remote" (sync off, 404, or a blob
// we can't decrypt/parse/validate -- treated like deserialize's null: reject, change nothing). Throws
// on transport failure or an unexpected status, so App's scheduler can surface it and retry later.
export async function pull(code: string): Promise<PullResult | null> {
    const base = syncBase()
    if (!base) return null
    const { id, key } = await deriveKeys(code)
    const res = await fetch(`${base}${BLOB_PATH}${id}`, { method: "GET" })
    if (res.status === 404) return null
    if (!res.ok) throw new Error(`sync pull failed: ${res.status}`)
    const bytes = await decryptBytes(key, await res.text())
    if (bytes === null) return null
    // Decrypt gives the compressed payload; inflate back to the envelope JSON. Bad/garbage data throws
    // here, treated like a failed decrypt: reject, change nothing.
    let plaintext: string
    try {
        plaintext = await inflate(bytes)
    } catch {
        return null
    }
    const envelope = parseEnvelope(plaintext)
    if (!envelope) return null
    const slices = deserialize(envelope.data)
    if (!slices) return null
    return { slices, version: serverVersion(res, envelope.updatedAt) }
}

// Encrypt and upload the roadmap. `updatedAt` is the client's stamp for the envelope hint; the returned
// version is the server's. `keepalive` lets a best-effort flush outlive a page being hidden.
export async function push(
    code: string,
    slices: PersistedSlices,
    updatedAt: number,
    opts: { keepalive?: boolean } = {}
): Promise<PushOutcome> {
    const base = syncBase()
    if (!base) return { ok: true, version: 0 }
    const { id, key } = await deriveKeys(code)
    const envelope: Envelope = { v: ENVELOPE_VERSION, updatedAt, data: serialize(slices) }
    // Compress the envelope, then encrypt the compressed bytes: the 1 MiB blob cap measures the
    // encrypted body, and DEFLATE only bites before encryption (ciphertext won't compress).
    const body = await encryptBytes(key, await deflate(JSON.stringify(envelope)))
    const res = await fetch(`${base}${BLOB_PATH}${id}`, {
        method: "PUT",
        headers: { "content-type": "text/plain" },
        body,
        keepalive: opts.keepalive
    })
    if (res.ok) return { ok: true, version: serverVersion(res, updatedAt) }
    // 429 (KV's ~1 write/sec/key) and 5xx are transient; 4xx (bad id, too large) is not.
    return { ok: false, status: res.status, retryable: res.status === 429 || res.status >= 500 }
}

function serverVersion(res: Response, fallback: number): number {
    const raw = res.headers.get(VERSION_HEADER)
    const parsed = raw ? Number(raw) : Number.NaN
    return Number.isFinite(parsed) ? parsed : fallback
}

function parseEnvelope(text: string): Envelope | null {
    let raw: unknown
    try {
        raw = JSON.parse(text)
    } catch {
        return null
    }
    if (typeof raw !== "object" || raw === null) return null
    const e = raw as Record<string, unknown>
    if (typeof e.data !== "string") return null
    return {
        v: typeof e.v === "number" ? e.v : 0,
        updatedAt: typeof e.updatedAt === "number" ? e.updatedAt : 0,
        data: e.data
    }
}

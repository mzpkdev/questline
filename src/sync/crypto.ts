// End-to-end crypto for cross-device sync. The sync code is a bearer secret: it is never sent to the
// server, and everything the Worker stores is ciphertext this module produces. Kept free of React and
// of the network so it unit-tests directly (like persist.ts / graph.ts).
//
// One high-entropy code (32 random bytes) is split by HKDF into two independent values: a lookup id
// (the KV key, the only thing the server sees) and an AES-256-GCM key (never leaves the client). The
// id is a one-way function of the code, so holding the id yields neither the key nor the code.

// Fixed, shared HKDF inputs. The salt is a constant (NOT random): both devices derive from the same
// code and must land on the same id/key, so differentiation comes from `info`, not the salt. The
// version suffixes give headroom to rotate the derivation without colliding with existing data.
const HKDF_SALT = "questline-sync-hkdf-salt-v1"
const INFO_ID = "questline-sync-id-v1"
const INFO_KEY = "questline-sync-key-v1"

// The one byte of framing prepended to every ciphertext, so the format can change later. It is fed to
// AES-GCM as additional data, so flipping it fails the auth tag rather than reaching a stale branch.
const BLOB_VERSION = 1

// Byte lengths: 32-byte code/id (256-bit), 12-byte GCM IV (96-bit, the recommended size), 16-byte tag.
const CODE_BYTES = 32
const IV_BYTES = 12
const MIN_BLOB_BYTES = 1 + IV_BYTES + 16 // version + iv + smallest possible GCM tag

const encoder = new TextEncoder()
const decoder = new TextDecoder()

// TextEncoder yields a Uint8Array the DOM lib types as ArrayBufferLike-backed; copy into a plainly
// ArrayBuffer-backed one so it satisfies WebCrypto's BufferSource parameters.
function utf8(text: string): Uint8Array<ArrayBuffer> {
    return new Uint8Array(encoder.encode(text))
}

// A fresh, unguessable sync code: 32 CSPRNG bytes as base64url. This is the whole credential.
export function generateCode(): string {
    return toBase64Url(crypto.getRandomValues(new Uint8Array(CODE_BYTES)))
}

// Split a code into its server-visible lookup id and its client-only AES-GCM key. Deterministic: the
// same code always yields the same pair, which is what lets a second device pair from just the code.
export async function deriveKeys(code: string): Promise<{ id: string; key: CryptoKey }> {
    const ikm = await crypto.subtle.importKey("raw", fromBase64Url(code), "HKDF", false, ["deriveBits"])
    const idBits = await deriveBits(ikm, INFO_ID)
    const keyBits = await deriveBits(ikm, INFO_KEY)
    const key = await crypto.subtle.importKey("raw", keyBits, { name: "AES-GCM" }, false, ["encrypt", "decrypt"])
    return { id: toBase64Url(new Uint8Array(idBits)), key }
}

// Encrypt a string to base64url(version ‖ iv ‖ ciphertext). A new random IV every call is required:
// reusing a nonce under one key breaks GCM, so this must never be derived from the plaintext.
export async function encrypt(key: CryptoKey, plaintext: string): Promise<string> {
    const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES))
    const aad = new Uint8Array([BLOB_VERSION])
    const ct = new Uint8Array(
        await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: aad }, key, utf8(plaintext))
    )
    const out = new Uint8Array(1 + IV_BYTES + ct.length)
    out[0] = BLOB_VERSION
    out.set(iv, 1)
    out.set(ct, 1 + IV_BYTES)
    return toBase64Url(out)
}

// Reverse of encrypt, or null on anything we don't understand (bad base64, short/truncated blob, wrong
// version, failed auth tag from a wrong key or tampering). Callers treat null like deserialize's null:
// reject, change nothing.
export async function decrypt(key: CryptoKey, blob: string): Promise<string | null> {
    try {
        const bytes = fromBase64Url(blob)
        if (bytes.length < MIN_BLOB_BYTES) return null
        const version = bytes[0]
        if (version !== BLOB_VERSION) return null
        const iv = bytes.subarray(1, 1 + IV_BYTES)
        const ct = bytes.subarray(1 + IV_BYTES)
        const aad = new Uint8Array([version])
        const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv, additionalData: aad }, key, ct)
        return decoder.decode(pt)
    } catch {
        return null
    }
}

function deriveBits(ikm: CryptoKey, info: string): Promise<ArrayBuffer> {
    return crypto.subtle.deriveBits(
        { name: "HKDF", hash: "SHA-256", salt: utf8(HKDF_SALT), info: utf8(info) },
        ikm,
        CODE_BYTES * 8
    )
}

// base64url (RFC 4648 §5): the alphabet is url- and fragment-safe (`-_`, no `=` padding), which every
// carrier here needs -- the code rides in a URL fragment, the id is both a KV key and a URL path
// segment, and the ciphertext is a plain string body.
export function toBase64Url(bytes: Uint8Array): string {
    let binary = ""
    for (const byte of bytes) binary += String.fromCharCode(byte)
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

export function fromBase64Url(text: string): Uint8Array<ArrayBuffer> {
    const b64 = text.replace(/-/g, "+").replace(/_/g, "/")
    const padded = b64.length % 4 === 0 ? b64 : b64 + "=".repeat(4 - (b64.length % 4))
    const binary = atob(padded)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    return bytes
}

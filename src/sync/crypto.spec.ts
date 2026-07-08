// @vitest-environment node
// Node env (not jsdom): Node 24 exposes global WebCrypto natively, so these pure crypto tests need no
// polyfill. jsdom would lack crypto.subtle.

import { decrypt, deriveKeys, encrypt, fromBase64Url, generateCode, toBase64Url } from "./crypto"

const BASE64URL_43 = /^[A-Za-z0-9_-]{43}$/

describe("sync crypto", () => {
    it("round-trips a payload through encrypt/decrypt", async () => {
        const { key } = await deriveKeys(generateCode())
        const text = JSON.stringify({ hello: "world", n: 42 })
        expect(await decrypt(key, await encrypt(key, text))).toBe(text)
    })

    it("derives a stable 43-char id and interoperable key for a given code", async () => {
        const code = generateCode()
        const a = await deriveKeys(code)
        const b = await deriveKeys(code)
        expect(a.id).toBe(b.id)
        expect(a.id).toMatch(BASE64URL_43)
        // Same code on a second device: encrypt under one derivation, decrypt under the other.
        expect(await decrypt(b.key, await encrypt(a.key, "same"))).toBe("same")
    })

    it("gives different codes different ids and non-interoperable keys", async () => {
        const a = await deriveKeys(generateCode())
        const b = await deriveKeys(generateCode())
        expect(a.id).not.toBe(b.id)
        expect(await decrypt(b.key, await encrypt(a.key, "secret"))).toBeNull()
    })

    it("returns null when the ciphertext is tampered", async () => {
        const { key } = await deriveKeys(generateCode())
        const bytes = fromBase64Url(await encrypt(key, "tamper me"))
        const last = bytes.length - 1
        bytes[last] = (bytes[last] ?? 0) ^ 0xff // flip a tag byte
        expect(await decrypt(key, toBase64Url(bytes))).toBeNull()
    })

    it("returns null when the version byte is altered", async () => {
        const { key } = await deriveKeys(generateCode())
        const bytes = fromBase64Url(await encrypt(key, "x"))
        bytes[0] = 2 // unknown version, also breaks the AAD
        expect(await decrypt(key, toBase64Url(bytes))).toBeNull()
    })

    it("returns null on garbage and truncated input", async () => {
        const { key } = await deriveKeys(generateCode())
        expect(await decrypt(key, "!!! not base64 !!!")).toBeNull()
        expect(await decrypt(key, "AAAA")).toBeNull() // too short to hold iv + tag
    })

    it("generates unique, well-formed codes", () => {
        expect(generateCode()).not.toBe(generateCode())
        expect(generateCode()).toMatch(BASE64URL_43)
    })
})

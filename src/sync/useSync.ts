// The sync lifecycle as one hook, so App.tsx only has to hand over its current slices and a way to
// apply an incoming roadmap. Everything stateful and timing-related lives here: adopting a pairing
// link, reconciling on boot / reconnect / tab-refocus, the trailing-throttled push, and the conflict
// prompt. When VITE_SYNC_URL is unset the hook is inert (`enabled` false) and registers no behaviour,
// so the app is byte-for-byte what it was before sync existed.
//
// Conflict policy is last-write-wins, but we never silently clobber a device that has its own data:
// the two ambiguous cases -- first pairing when both sides hold a roadmap, and the server moving ahead
// while we have unpushed edits -- surface a 3-way prompt instead. "Safe" takes (a fresh device joining,
// or the server simply being newer with nothing local pending) apply on their own.

import { useCallback, useEffect, useRef, useState } from "react"
import { loadState, type PersistedSlices } from "../persist"
import { generateCode } from "./crypto"
import { pull, push, syncEnabled } from "./sync"

const CODE_KEY = "questline:sync-code"
const VERSION_KEY = "questline:sync-version"
// Trailing debounce before a push: coalesces a burst of edits (and stays clear of KV's ~1 write/sec/key).
const PUSH_DELAY_MS = 2000
// Backoff for re-reading a just-paired blob: KV is eventually consistent, so a fresh write can 404 for
// a few seconds. Retry before concluding the remote is empty, or we'd overwrite it with local data.
const ADOPT_RETRY_MS = [500, 1500, 3000]
// Matches a pairing fragment: #sync=<43-char base64url code>.
const FRAGMENT_RE = /^#sync=([A-Za-z0-9_-]{43})$/

export type SyncStatus = "off" | "idle" | "syncing" | "error" | "conflict"
export type ConflictChoice = "remote" | "local"

export type UseSyncResult = {
    // Feature compiled in (VITE_SYNC_URL set). When false, everything below is a no-op / null.
    enabled: boolean
    // A sync code is set on this device.
    active: boolean
    status: SyncStatus
    code: string | null
    pairingLink: string | null
    // A code arrived via a link and is awaiting the user's confirm before we adopt it.
    pendingAdopt: string | null
    // Both sides diverged; the user must choose. Null when there's no conflict.
    conflict: boolean
    enable: () => void
    disable: () => void
    regenerate: () => void
    confirmAdopt: () => void
    cancelAdopt: () => void
    resolveConflict: (choice: ConflictChoice) => void
}

export function useSync(slices: PersistedSlices, applyRemote: (slices: PersistedSlices) => void): UseSyncResult {
    const enabled = syncEnabled()

    const [status, setStatus] = useState<SyncStatus>(enabled ? "idle" : "off")
    const [code, setCode] = useState<string | null>(() => (enabled ? readCode() : null))
    // A pairing code from the URL fragment, captured during render (before any effect can strip the
    // fragment) and held until the user confirms. Ignored when it's already this device's own code.
    const [pendingAdopt, setPendingAdopt] = useState<string | null>(() => {
        if (!enabled) return null
        const fromLink = readFragmentCode()
        return fromLink && fromLink !== readCode() ? fromLink : null
    })
    const [conflict, setConflict] = useState<{ slices: PersistedSlices; version: number } | null>(null)

    // Latest-value refs so timers and event handlers read current state without re-subscribing.
    const slicesRef = useRef(slices)
    slicesRef.current = slices
    const applyRemoteRef = useRef(applyRemote)
    applyRemoteRef.current = applyRemote
    const codeRef = useRef(code)
    codeRef.current = code
    const conflictRef = useRef(false)
    conflictRef.current = conflict !== null
    const pendingRef = useRef(pendingAdopt !== null)
    pendingRef.current = pendingAdopt !== null

    // Did this device hold a saved roadmap at first mount? Captured once, before autosave runs, so
    // "device has its own data" isn't confused by the bundled seed a fresh start shows.
    const hadSaveRef = useRef(enabled && loadState() !== null)
    // Local edits not yet confirmed on the server.
    const dirtyRef = useRef(false)
    // The initial reconcile has settled; until then the push scheduler holds off.
    const readyRef = useRef(false)
    // Set around applyRemote so the slices change it causes isn't mistaken for a local edit.
    const suppressRef = useRef(false)
    // Skip the mount snapshot of the slices effect (loading isn't an edit).
    const firstSlicesRun = useRef(true)

    // One PUT of the current slices. Retry/backoff isn't here -- a failed retryable push just leaves the
    // dirty flag set for the next edit or reconcile to carry.
    const doPush = useCallback(async (activeCode: string) => {
        if (conflictRef.current || pendingRef.current) return
        setStatus("syncing")
        try {
            const outcome = await push(activeCode, slicesRef.current, Date.now())
            if (outcome.ok) {
                dirtyRef.current = false
                writeVersion(outcome.version)
                setStatus("idle")
            } else {
                setStatus("error")
            }
        } catch {
            setStatus("error")
        }
    }, [])

    const applyRemoteSuppressed = useCallback((remote: PersistedSlices) => {
        suppressRef.current = true
        applyRemoteRef.current(remote)
    }, [])

    // Pull the remote and decide who wins. `mode` only changes the staleness handling: an "adopt" just
    // wrote (or expects) a blob, so a 404 gets retried before we treat the remote as empty.
    const reconcile = useCallback(
        async (activeCode: string, mode: "boot" | "live" | "adopt") => {
            setStatus("syncing")
            try {
                let remote = await pull(activeCode)
                if (remote === null && mode === "adopt") {
                    for (const delay of ADOPT_RETRY_MS) {
                        await sleep(delay)
                        remote = await pull(activeCode)
                        if (remote) break
                    }
                }
                const stored = readVersion()

                if (remote === null) {
                    // No usable remote: seed it from this device.
                    await doPush(activeCode)
                    return
                }
                if (stored === null) {
                    // First time syncing this code. A fresh device joins silently; a device that already
                    // had its own roadmap must choose rather than lose either side.
                    if (hadSaveRef.current) {
                        setConflict(remote)
                        setStatus("conflict")
                        return
                    }
                    applyRemoteSuppressed(remote.slices)
                    writeVersion(remote.version)
                    dirtyRef.current = false
                } else if (remote.version > stored) {
                    // Server moved ahead. Safe to take unless we also have unpushed edits.
                    if (dirtyRef.current) {
                        setConflict(remote)
                        setStatus("conflict")
                        return
                    }
                    applyRemoteSuppressed(remote.slices)
                    writeVersion(remote.version)
                    dirtyRef.current = false
                } else if (dirtyRef.current) {
                    // We're at or ahead of the server and hold local edits: push them.
                    await doPush(activeCode)
                    return
                }
                setStatus("idle")
            } catch {
                setStatus("error")
            } finally {
                readyRef.current = true
            }
        },
        [doPush, applyRemoteSuppressed]
    )

    // Initial reconcile, once, on mount. A pending adopt waits for confirm; no code means enabled but
    // not activated -- both just mark us ready so the push scheduler can run later.
    useEffect(() => {
        if (!enabled) return
        if (pendingRef.current || !codeRef.current) {
            readyRef.current = true
            return
        }
        void reconcile(codeRef.current, "boot")
    }, [enabled, reconcile])

    // Mark local edits dirty and (re)arm the trailing push. The mount snapshot and applied-remote
    // changes are skipped so neither counts as an edit.
    useEffect(() => {
        if (!enabled) return
        if (firstSlicesRun.current) {
            firstSlicesRun.current = false
            return
        }
        if (suppressRef.current) {
            suppressRef.current = false
            return
        }
        dirtyRef.current = true
        const timer = setTimeout(() => {
            const active = codeRef.current
            if (active && readyRef.current && dirtyRef.current && !conflictRef.current && !pendingRef.current) {
                void doPush(active)
            }
        }, PUSH_DELAY_MS)
        return () => clearTimeout(timer)
    }, [enabled, doPush, slices])

    // Reconcile when the network or tab comes back; best-effort flush when the tab is hidden. The
    // hidden flush is not guaranteed (async crypto + unload), so the on-visible reconcile is the real
    // catch-up path.
    useEffect(() => {
        if (!enabled) return
        const wake = () => {
            const active = codeRef.current
            if (active && !conflictRef.current && !pendingRef.current) void reconcile(active, "live")
        }
        const onVisibility = () => {
            const active = codeRef.current
            if (document.visibilityState === "visible") {
                wake()
            } else if (active && dirtyRef.current && !conflictRef.current && !pendingRef.current) {
                void push(active, slicesRef.current, Date.now(), { keepalive: true })
            }
        }
        window.addEventListener("online", wake)
        document.addEventListener("visibilitychange", onVisibility)
        return () => {
            window.removeEventListener("online", wake)
            document.removeEventListener("visibilitychange", onVisibility)
        }
    }, [enabled, reconcile])

    // Turn sync on for this device (or re-key it), making this device's roadmap the source and orphaning
    // any previous code. A brand-new random code can't collide, so we just push -- no pull first.
    const startFresh = useCallback(() => {
        const fresh = generateCode()
        writeCode(fresh)
        writeVersion(null)
        setCode(fresh)
        setConflict(null)
        dirtyRef.current = true
        readyRef.current = true
        void doPush(fresh)
    }, [doPush])

    const disable = useCallback(() => {
        writeCode(null)
        writeVersion(null)
        setCode(null)
        setConflict(null)
        dirtyRef.current = false
        setStatus("idle")
    }, [])

    const confirmAdopt = useCallback(() => {
        const adopting = pendingAdopt
        if (!adopting) return
        writeCode(adopting)
        writeVersion(null) // treat as a first pairing for this code
        setCode(adopting)
        setPendingAdopt(null)
        dirtyRef.current = false
        stripFragment()
        void reconcile(adopting, "adopt")
    }, [pendingAdopt, reconcile])

    const cancelAdopt = useCallback(() => {
        setPendingAdopt(null)
        stripFragment()
    }, [])

    const resolveConflict = useCallback(
        (choice: ConflictChoice) => {
            const active = codeRef.current
            const pending = conflict
            if (!active || !pending) return
            setConflict(null)
            if (choice === "remote") {
                applyRemoteSuppressed(pending.slices)
                writeVersion(pending.version)
                dirtyRef.current = false
                setStatus("idle")
            } else {
                dirtyRef.current = true
                void doPush(active) // upload local, overwriting the remote
            }
        },
        [conflict, applyRemoteSuppressed, doPush]
    )

    return {
        enabled,
        active: code !== null,
        status,
        code,
        pairingLink: code ? pairingLink(code) : null,
        pendingAdopt,
        conflict: conflict !== null,
        enable: startFresh,
        disable,
        regenerate: startFresh,
        confirmAdopt,
        cancelAdopt,
        resolveConflict
    }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

function readFragmentCode(): string | null {
    try {
        const match = FRAGMENT_RE.exec(window.location.hash)
        return match ? (match[1] ?? null) : null
    } catch {
        return null
    }
}

function stripFragment(): void {
    try {
        window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`)
    } catch {
        // ignore
    }
}

function pairingLink(code: string): string {
    return `${window.location.origin}${window.location.pathname}#sync=${code}`
}

function readCode(): string | null {
    try {
        return localStorage.getItem(CODE_KEY)
    } catch {
        return null
    }
}

function writeCode(code: string | null): void {
    try {
        if (code) localStorage.setItem(CODE_KEY, code)
        else localStorage.removeItem(CODE_KEY)
    } catch {
        // ignore
    }
}

function readVersion(): number | null {
    try {
        const raw = localStorage.getItem(VERSION_KEY)
        if (!raw) return null
        const parsed = Number(raw)
        return Number.isFinite(parsed) ? parsed : null
    } catch {
        return null
    }
}

function writeVersion(version: number | null): void {
    try {
        if (version === null) localStorage.removeItem(VERSION_KEY)
        else localStorage.setItem(VERSION_KEY, String(version))
    } catch {
        // ignore
    }
}

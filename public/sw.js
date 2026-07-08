// Questline service worker: makes the installed app launch and run offline. Data already lives in
// localStorage (see src/persist.ts), so this only has to keep the app *shell* and its hashed assets
// available without the network. Sync (/v1/*) is never cached -- it must always reach Cloudflare KV.
//
// Bump VERSION to force a fresh cache on the next deploy; activate() prunes older Questline caches.
// Paths are relative to the SW's scope, so this works whether the app is served from "/" (Cloudflare)
// or a subpath (e.g. GitHub Pages project sites).

const VERSION = "v1"
const CACHE = `questline-${VERSION}`

// The minimal shell to boot offline. Hashed /assets/* files are cached on first use at runtime, since
// their names change every build and can't be listed ahead of time.
const SHELL = [
    "./",
    "./index.html",
    "./manifest.webmanifest",
    "./icon.svg",
    "./icon-192.png",
    "./icon-512.png",
    "./apple-touch-icon.png",
    "./favicon-32.png",
]

self.addEventListener("install", (event) => {
    event.waitUntil(
        (async () => {
            const cache = await caches.open(CACHE)
            await cache.addAll(SHELL)
            await self.skipWaiting()
        })()
    )
})

self.addEventListener("activate", (event) => {
    event.waitUntil(
        (async () => {
            const keys = await caches.keys()
            await Promise.all(
                keys.filter((key) => key.startsWith("questline-") && key !== CACHE).map((key) => caches.delete(key))
            )
            await self.clients.claim()
        })()
    )
})

const isGoogleFont = (url) => url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com"

self.addEventListener("fetch", (event) => {
    const req = event.request
    if (req.method !== "GET") return

    const url = new URL(req.url)

    // The sync API must always hit the network -- never serve a stale (or any) cached blob.
    if (url.origin === self.location.origin && url.pathname.startsWith("/v1/")) return

    // Navigations: network-first so a new deploy is picked up, falling back to the cached shell offline.
    if (req.mode === "navigate") {
        event.respondWith(
            (async () => {
                try {
                    const fresh = await fetch(req)
                    const cache = await caches.open(CACHE)
                    cache.put("./index.html", fresh.clone())
                    return fresh
                } catch {
                    const cache = await caches.open(CACHE)
                    return (await cache.match("./index.html")) || (await cache.match("./")) || Response.error()
                }
            })()
        )
        return
    }

    const sameOrigin = url.origin === self.location.origin
    // Leave unrelated cross-origin requests alone; only same-origin assets and Google Fonts are cached.
    if (!sameOrigin && !isGoogleFont(url)) return

    // Cache-first: /assets/* are content-hashed (immutable) and fonts rarely change, so a hit is safe.
    event.respondWith(
        (async () => {
            const cache = await caches.open(CACHE)
            const cached = await cache.match(req)
            if (cached) return cached
            try {
                const res = await fetch(req)
                if (res && (res.ok || res.type === "opaque")) cache.put(req, res.clone())
                return res
            } catch {
                return cached || Response.error()
            }
        })()
    )
})

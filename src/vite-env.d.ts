/// <reference types="vite/client" />

interface ImportMetaEnv {
    // Overrides where the sync client sends requests. Unset -> same-origin (one Worker serves app + API);
    // a URL points it at another origin; "" disables sync (local-only). Public, baked into the bundle.
    readonly VITE_SYNC_URL?: string
}

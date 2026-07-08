/// <reference types="vite/client" />

interface ImportMetaEnv {
    // Base URL of the sync Worker (e.g. https://questline-sync.<sub>.workers.dev). Cross-device sync is
    // disabled and the app stays local-only when this is unset. Public, not a secret -- baked into the bundle.
    readonly VITE_SYNC_URL?: string
}

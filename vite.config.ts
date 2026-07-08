/// <reference types="vitest/config" />
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

import { cloudflare } from "@cloudflare/vite-plugin";

// Base public path. Local dev / preview serve from root; the GitHub Pages workflow passes VITE_BASE
// from the configure-pages `base_path` output (e.g. "/repo"), so assets resolve under the project
// site's subpath. Normalised to a leading + trailing slash, which Vite expects.
const rawBase = process.env.VITE_BASE?.trim()
const base = !rawBase || rawBase === "/" ? "/" : `/${rawBase.replace(/^\/|\/$/g, "")}/`

export default defineConfig({
    base,
    // The Cloudflare plugin wires the Worker into build/dev, but its Worker environment clashes with
    // Vitest's config, so leave it out under test (VITEST is set by the test runner).
    plugins: [react(), tailwindcss(), ...(process.env.VITEST ? [] : [cloudflare()])],
    test: {
        environment: "jsdom",
        globals: true,
        setupFiles: ["./src/test/setup.ts"],
        // Keep sync disabled under test; the same-origin default would otherwise switch it on in jsdom.
        // sync.spec stubs this per case.
        env: { VITE_SYNC_URL: "" }
    }
})
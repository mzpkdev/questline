/// <reference types="vitest/config" />
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

// Base public path. Local dev / preview serve from root; the GitHub Pages workflow passes VITE_BASE
// from the configure-pages `base_path` output (e.g. "/repo"), so assets resolve under the project
// site's subpath. Normalised to a leading + trailing slash, which Vite expects.
const rawBase = process.env.VITE_BASE?.trim()
const base = !rawBase || rawBase === "/" ? "/" : `/${rawBase.replace(/^\/|\/$/g, "")}/`

export default defineConfig({
    base,
    plugins: [react(), tailwindcss()],
    test: {
        environment: "jsdom",
        globals: true,
        setupFiles: ["./src/test/setup.ts"]
    }
})

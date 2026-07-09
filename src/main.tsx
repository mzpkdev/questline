import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { App } from "./App"
import { SfxProvider } from "./SfxProvider"
import "@xyflow/react/dist/style.css"
import "./index.css"

const root = document.getElementById("root")
if (!root) {
    throw new Error("missing #root mount node")
}

createRoot(root).render(
    <StrictMode>
        <SfxProvider>
            <App />
        </SfxProvider>
    </StrictMode>
)

// Register the PWA service worker so the installed app launches and runs offline. Production only:
// in dev it would sit in front of Vite's HMR. Scoped via BASE_URL so it works under a subpath too.
if (import.meta.env.PROD && "serviceWorker" in navigator) {
    window.addEventListener("load", () => {
        navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => {})
    })
}

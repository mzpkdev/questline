import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { App } from "./App"
import "@xyflow/react/dist/style.css"
import "./index.css"

const root = document.getElementById("root")
if (!root) {
    throw new Error("missing #root mount node")
}

createRoot(root).render(
    <StrictMode>
        <App />
    </StrictMode>
)

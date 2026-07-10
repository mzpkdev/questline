// The Excalidraw view: a full-canvas whiteboard reached from the Draw chip in the nav bar. v1 mounts
// the stock editor with a parchment/gold reskin (excalidraw-theme.css), no persistence into questline
// state yet. App lazy-loads this module so Excalidraw's weight (and its CSS) only ship once the tab opens.

import "@excalidraw/excalidraw/index.css"
import "./excalidraw-theme.css"
import { Excalidraw } from "@excalidraw/excalidraw"

// Start the canvas on parchment. Read once at mount, so keep it a stable object (not recreated per render).
const INITIAL_DATA = { appState: { viewBackgroundColor: "#f6edd6" } }

export function ExcalidrawBoard() {
    // Fills the board surface (a relative, flex-1 parent); Excalidraw sizes itself to this box. Locked to
    // the light theme so the parchment overrides in excalidraw-theme.css always apply.
    return (
        <div className="absolute inset-0 z-10">
            <Excalidraw theme="light" initialData={INITIAL_DATA} />
        </div>
    )
}

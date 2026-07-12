// The Excalidraw editor for a single scribble: opened from a card on the ScribblesBoard wall. It mounts
// the stock editor with the parchment/gold reskin (excalidraw-theme.css), seeds it from the scribble's
// saved scene, and streams edits back to App (debounced) so the scribble persists into questline state
// like everything else. A header bar above the canvas holds the editable name and a Back-to-scribbles
// button. App lazy-loads this module (with ScribblesBoard) so Excalidraw's weight only ships on open.

import "@excalidraw/excalidraw/index.css"
import "./excalidraw-theme.css"
import { Excalidraw, getSceneVersion, MainMenu, restore, serializeAsJSON } from "@excalidraw/excalidraw"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { ConfirmDialog } from "./ConfirmDialog"
import { DEFAULT_SCRIBBLE_TITLE, type Scribble, type ScribbleScene } from "./scribbles"

// A trash glyph for the delete menu item.
function TrashIcon() {
    return (
        <svg viewBox="0 0 24 24" width={16} height={16} fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
        </svg>
    )
}

// The back-arrow glyph for the header's Back button.
function BackChevron() {
    return (
        <svg viewBox="0 0 24 24" width={14} height={14} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M15 18l-6-6 6-6" />
        </svg>
    )
}

// Drop the image tool (roadmaps + scribbles stay vector-only; keeps synced blobs small). Stable object.
const UI_OPTIONS = { tools: { image: false } }
// Coalesce the rapid onChange stream (fires on every pointer move while drawing) into one save.
const SAVE_DEBOUNCE_MS = 500
// The canvas starts on parchment when a scribble has no saved background of its own.
const PARCHMENT = "#f6edd6"

type ScribbleEditorProps = {
    scribble: Scribble
    onChange: (scene: ScribbleScene) => void
    onRename: (title: string) => void
    onBack: () => void
    onDelete: () => void
}

export function ScribbleEditor({ scribble, onChange, onRename, onBack, onDelete }: ScribbleEditorProps) {
    const [confirmDelete, setConfirmDelete] = useState(false)
    // The scribble's name, editable in the header bar. A local draft (seeded once per scribble -- App
    // keys this component by scribble id, so a different scribble remounts and re-seeds) so keystrokes
    // don't churn the scribbles list; it commits on blur / Enter. A blank falls back to the default, and
    // the draft snaps to that fallback so the field never shows an empty name the store rejected.
    const [title, setTitle] = useState(scribble.title)
    const commitTitle = () => {
        const next = title.trim() || DEFAULT_SCRIBBLE_TITLE
        setTitle(next)
        onRename(next)
    }

    // Seed the editor from the scribble's saved scene. Read once per mounted scribble (App keys this
    // component by scribble id, so a different scribble remounts and re-seeds); it must not reset as the
    // user draws.
    // biome-ignore lint/correctness/useExhaustiveDependencies: re-seed only when a different scribble opens
    const initialData = useMemo(() => {
        const restored = restore(
            { elements: scribble.scene.elements, appState: scribble.scene.appState, files: scribble.scene.files } as never,
            null,
            null
        )
        // The parchment canvas is a theme default, not per-scribble data: force it on every scribble (as
        // the original single-canvas board did), so restore()'s default white never leaks through.
        return {
            elements: restored.elements,
            appState: { ...restored.appState, viewBackgroundColor: PARCHMENT },
            files: restored.files,
            scrollToContent: true
        }
    }, [scribble.id])

    // Keep the latest onChange reachable from the stable Excalidraw handler without re-registering it.
    const onChangeRef = useRef(onChange)
    onChangeRef.current = onChange

    // Save bookkeeping: the last scene version we persisted (to skip appState/selection-only churn), the
    // debounce timer, and the scene waiting to be written.
    const lastVersion = useRef<number | null>(null)
    const timer = useRef<number | null>(null)
    const pending = useRef<ScribbleScene | null>(null)

    const flush = useCallback(() => {
        if (timer.current !== null) {
            window.clearTimeout(timer.current)
            timer.current = null
        }
        if (pending.current) {
            onChangeRef.current(pending.current)
            pending.current = null
        }
    }, [])

    const handleChange = useCallback(
        (elements: readonly { isDeleted?: boolean }[], appState: unknown, files: unknown) => {
            const version = getSceneVersion(elements as never)
            // The first emit is Excalidraw echoing the initial data on mount — record it and skip, so
            // opening a scribble never rewrites it. Later emits with the same version are appState/selection
            // noise we don't persist.
            if (lastVersion.current === null) {
                lastVersion.current = version
                return
            }
            if (version === lastVersion.current) return
            lastVersion.current = version
            const clean = JSON.parse(serializeAsJSON(elements as never, appState as never, files as never, "local")) as {
                elements: unknown[]
                appState: Record<string, unknown>
                files?: Record<string, unknown>
            }
            pending.current = { elements: clean.elements, appState: clean.appState, files: clean.files ?? {} }
            if (timer.current !== null) window.clearTimeout(timer.current)
            timer.current = window.setTimeout(flush, SAVE_DEBOUNCE_MS)
        },
        [flush]
    )

    // Persist any pending edit when the editor unmounts (leaving for the wall or switching scribbles).
    useEffect(() => flush, [flush])

    const back = () => {
        flush()
        onBack()
    }

    // A slim header bar (Back + the scribble's name) sits above the canvas, the same on desktop and
    // mobile, so the name is always visible and never fights Excalidraw's floating toolbars. The canvas
    // fills the rest, locked to light so the parchment overrides in excalidraw-theme.css always apply.
    return (
        <div className="absolute inset-0 z-10 flex flex-col">
            <div className="relative flex h-11 flex-none items-center justify-center border-b border-[#8a641d]/25 bg-[#f4ead0] px-3 shadow-[0_1px_4px_-2px_rgba(120,80,20,0.45)]">
                <button
                    type="button"
                    onClick={back}
                    title="Back to scribbles"
                    aria-label="Back to scribbles"
                    className="absolute left-3 inline-flex items-center gap-1.5 rounded-lg border border-[#8a641d]/30 bg-[#faf2dc] px-2.5 py-1.5 font-display text-[11.5px] font-semibold tracking-wide text-[#4a3410] transition-colors duration-150 ease-out hover:bg-[#efe3c4]"
                >
                    <BackChevron />
                    <span className="hidden sm:inline">Scribbles</span>
                </button>
                <input
                    aria-label="Scribble name"
                    value={title}
                    maxLength={60}
                    placeholder={DEFAULT_SCRIBBLE_TITLE}
                    onChange={(event) => setTitle(event.target.value)}
                    onBlur={commitTitle}
                    onKeyDown={(event) => {
                        if (event.key === "Enter") event.currentTarget.blur()
                    }}
                    className="w-[min(60%,260px)] rounded-lg border border-transparent bg-transparent px-2 py-1 text-center font-display text-[14px] font-semibold text-[#4a3410] transition-colors duration-150 ease-out placeholder:font-normal placeholder:italic placeholder:text-[#a2916c] hover:border-[#8a641d]/20 focus:border-[#b8892b] focus:bg-[#fffdf5] focus:outline-none focus:ring-2 focus:ring-[#e6c458]/40"
                />
            </div>
            <div className="relative flex-1">
                <Excalidraw
                    theme="light"
                    initialData={initialData}
                    UIOptions={UI_OPTIONS}
                    onChange={handleChange}
                >
                    <MainMenu>
                        <MainMenu.DefaultItems.SaveAsImage />
                        <MainMenu.DefaultItems.ChangeCanvasBackground />
                        <MainMenu.DefaultItems.ClearCanvas />
                        <MainMenu.DefaultItems.Help />
                        <MainMenu.Separator />
                        <MainMenu.Item onSelect={() => setConfirmDelete(true)} icon={<TrashIcon />} style={{ color: "#a5482a" }}>
                            Delete scribble
                        </MainMenu.Item>
                    </MainMenu>
                </Excalidraw>
            </div>
            <ConfirmDialog
                open={confirmDelete}
                title="Delete this scribble?"
                message={
                    <>
                        Delete <strong className="font-semibold text-[#4a3410]">{scribble.title}</strong>? This can't be
                        undone.
                    </>
                }
                confirmLabel="Delete"
                onConfirm={() => {
                    setConfirmDelete(false)
                    onDelete()
                }}
                onOpenChange={(open) => {
                    if (!open) setConfirmDelete(false)
                }}
            />
        </div>
    )
}

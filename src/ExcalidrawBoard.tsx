// The Excalidraw editor for a single Draw note: opened from a card on the DrawBoard wall. It mounts
// the stock editor with the parchment/gold reskin (excalidraw-theme.css), seeds it from the note's
// saved scene, and streams edits back to App (debounced) so the note persists into questline state
// like everything else. A "Scribbles" button (top-right on desktop, the main menu on mobile) returns
// to the wall. App lazy-loads this module (with DrawBoard) so Excalidraw's weight only ships on open.

import "@excalidraw/excalidraw/index.css"
import "./excalidraw-theme.css"
import { Excalidraw, getSceneVersion, MainMenu, restore, serializeAsJSON } from "@excalidraw/excalidraw"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { ConfirmDialog } from "./ConfirmDialog"
import { DEFAULT_NOTE_TITLE, type Note, type NoteScene } from "./notes"

// A trash glyph for the delete menu item.
function TrashIcon() {
    return (
        <svg viewBox="0 0 24 24" width={16} height={16} fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
        </svg>
    )
}

// The back-arrow glyph, shared by the desktop top-right button and the mobile main-menu item.
function BackChevron() {
    return (
        <svg viewBox="0 0 24 24" width={14} height={14} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M15 18l-6-6 6-6" />
        </svg>
    )
}

// Drop the image tool (roadmaps + notes stay vector-only; keeps synced blobs small). Stable object.
const UI_OPTIONS = { tools: { image: false } }
// Coalesce the rapid onChange stream (fires on every pointer move while drawing) into one save.
const SAVE_DEBOUNCE_MS = 500
// The canvas starts on parchment when a note has no saved background of its own.
const PARCHMENT = "#f6edd6"

type ExcalidrawBoardProps = {
    note: Note
    onChange: (scene: NoteScene) => void
    onRename: (title: string) => void
    onBack: () => void
    onDelete: () => void
}

export function ExcalidrawBoard({ note, onChange, onRename, onBack, onDelete }: ExcalidrawBoardProps) {
    const [confirmDelete, setConfirmDelete] = useState(false)
    // The scribble's name, editable in a top-right pill. A local draft (seeded once per note -- App keys
    // this component by note id, so a different note remounts and re-seeds) so keystrokes don't churn the
    // notes list; it commits on blur / Enter. A blank falls back to the default, and the draft snaps to
    // that fallback so the field never shows an empty name the store rejected.
    const [title, setTitle] = useState(note.title)
    const commitTitle = () => {
        const next = title.trim() || DEFAULT_NOTE_TITLE
        setTitle(next)
        onRename(next)
    }

    // Excalidraw decides "mobile" by container width (that's the flag renderTopRightUI hands us). Mirror
    // it into state -- written to a ref inside that render callback, reconciled here -- so the mobile-only
    // name field in the main menu keys off the EXACT same cutoff as the suppressed desktop pill, with no
    // width band where neither shows.
    const [isMobile, setIsMobile] = useState(false)
    const mobileRef = useRef(false)
    useEffect(() => {
        if (mobileRef.current !== isMobile) setIsMobile(mobileRef.current)
    })
    // Seed the editor from the note's saved scene. Read once per mounted note (App keys this component
    // by note id, so a different note remounts and re-seeds); it must not reset as the user draws.
    // biome-ignore lint/correctness/useExhaustiveDependencies: re-seed only when a different note opens
    const initialData = useMemo(() => {
        const restored = restore(
            { elements: note.scene.elements, appState: note.scene.appState, files: note.scene.files } as never,
            null,
            null
        )
        // The parchment canvas is a theme default, not per-note data: force it on every note (as the
        // original single-canvas board did), so restore()'s default white never leaks through.
        return {
            elements: restored.elements,
            appState: { ...restored.appState, viewBackgroundColor: PARCHMENT },
            files: restored.files,
            scrollToContent: true
        }
    }, [note.id])

    // Keep the latest onChange reachable from the stable Excalidraw handler without re-registering it.
    const onChangeRef = useRef(onChange)
    onChangeRef.current = onChange

    // Save bookkeeping: the last scene version we persisted (to skip appState/selection-only churn), the
    // debounce timer, and the scene waiting to be written.
    const lastVersion = useRef<number | null>(null)
    const timer = useRef<number | null>(null)
    const pending = useRef<NoteScene | null>(null)

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
            // opening a note never rewrites it. Later emits with the same version are appState/selection
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

    // Persist any pending edit when the editor unmounts (leaving for the wall or switching notes).
    useEffect(() => flush, [flush])

    const back = () => {
        flush()
        onBack()
    }

    // Fills the board surface (a relative, flex-1 parent). Locked to light so the parchment overrides
    // in excalidraw-theme.css always apply.
    return (
        <div className="absolute inset-0 z-10">
            <Excalidraw
                theme="light"
                initialData={initialData}
                UIOptions={UI_OPTIONS}
                onChange={handleChange}
                // Desktop has room for a top-right button; on mobile it fights Excalidraw's toolbar, so
                // there the back action lives in the main menu (below) instead.
                renderTopRightUI={(mobile) => {
                    // Stash Excalidraw's mobile flag (reconciled into `isMobile` by the effect above), then
                    // render the top-right cluster on desktop only: on mobile it fights Excalidraw's
                    // toolbar, so the name moves into the main menu instead (below).
                    mobileRef.current = mobile
                    return mobile ? null : (
                        <div className="flex items-center gap-2">
                            <input
                                aria-label="Scribble name"
                                value={title}
                                maxLength={60}
                                placeholder={DEFAULT_NOTE_TITLE}
                                onChange={(event) => setTitle(event.target.value)}
                                onBlur={commitTitle}
                                onKeyDown={(event) => {
                                    if (event.key === "Enter") event.currentTarget.blur()
                                }}
                                className="w-[170px] rounded-lg border border-[#8a641d]/30 bg-[#f4ead0] px-2.5 py-1.5 font-display text-[12.5px] font-semibold text-[#4a3410] shadow-[0_1px_4px_-1px_rgba(120,80,20,0.3)] transition-colors duration-150 ease-out placeholder:font-normal placeholder:italic placeholder:text-[#a2916c] focus:border-[#b8892b] focus:outline-none focus:ring-2 focus:ring-[#e6c458]/40"
                            />
                            <button
                                type="button"
                                onClick={back}
                                title="Back to scribbles"
                                className="inline-flex items-center gap-1.5 rounded-lg border border-[#8a641d]/30 bg-[#f4ead0] px-3 py-1.5 font-display text-[11.5px] font-semibold tracking-wide text-[#4a3410] shadow-[0_1px_4px_-1px_rgba(120,80,20,0.3)] transition-colors duration-150 ease-out hover:bg-[#efe3c4]"
                            >
                                <BackChevron />
                                Scribbles
                            </button>
                        </div>
                    )
                }}
            >
                <MainMenu>
                    {isMobile && (
                        // Mobile: the top-right pill is suppressed, so the name lives here in the menu --
                        // where Back and Delete already are -- as an editable field. Commits on blur / Enter.
                        <>
                            <MainMenu.ItemCustom>
                                <label className="flex w-full flex-col gap-1 text-left">
                                    <span className="font-display text-[10px] uppercase tracking-widest text-[#8a6b28]">
                                        Name
                                    </span>
                                    <input
                                        aria-label="Scribble name"
                                        value={title}
                                        maxLength={60}
                                        placeholder={DEFAULT_NOTE_TITLE}
                                        onChange={(event) => setTitle(event.target.value)}
                                        onBlur={commitTitle}
                                        onKeyDown={(event) => {
                                            if (event.key === "Enter") event.currentTarget.blur()
                                        }}
                                        className="w-full rounded-md border border-[#d8c48f] bg-[#fffdf5] px-2 py-1.5 font-display text-[13px] font-semibold text-[#4a3410] placeholder:font-normal placeholder:italic placeholder:text-[#a2916c] focus:border-[#b8892b] focus:outline-none focus:ring-2 focus:ring-[#e6c458]/40"
                                    />
                                </label>
                            </MainMenu.ItemCustom>
                            <MainMenu.Separator />
                        </>
                    )}
                    <MainMenu.Item onSelect={back} icon={<BackChevron />}>
                        Back to scribbles
                    </MainMenu.Item>
                    <MainMenu.Separator />
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
            <ConfirmDialog
                open={confirmDelete}
                title="Delete this scribble?"
                message={
                    <>
                        Delete <strong className="font-semibold text-[#4a3410]">{note.title}</strong>? This can't be
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

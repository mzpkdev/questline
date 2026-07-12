// The Draw view: a masonry wall of the user's Excalidraw notes, one card per drawing, plus a dashed
// tile to start a new one. Deliberately bare — no search, grouping, or filters. Each card previews the
// actual sketch (a static SVG exported headless from the scene) at its own aspect ratio, so the wall
// staggers into a real masonry via CSS multi-column. Clicking a card opens it full-screen in
// ExcalidrawBoard; the title renames inline; the × removes it. Styling matches RewardsBoard's shelf
// (the parchment + gold double-gradient card frame).
//
// This module imports @excalidraw/excalidraw (for the thumbnail export), so App lazy-loads it — the
// heavy canvas bundle ships only once the Draw tab is opened, never on first paint.

import { exportToSvg, restore } from "@excalidraw/excalidraw"
import { useEffect, useState } from "react"
import { Plus } from "./icons"
import type { Note, NoteScene } from "./notes"

// The card frame: the same double-gradient border trick as a reward tile (a cream padding-box fill
// beneath a gold border-box frame).
const CARD_STYLE = {
    border: "2px solid transparent",
    background:
        "linear-gradient(180deg,#faf2dc,#efe1bd) padding-box, linear-gradient(180deg,#fbeeb8,#b8892b) border-box"
} as const

const CARD_SHADOW =
    "shadow-[0_10px_22px_-16px_rgba(60,40,10,0.6),inset_0_1px_0_rgba(255,255,255,0.6)] hover:shadow-[0_16px_26px_-12px_rgba(60,40,10,0.7),inset_0_1px_0_rgba(255,255,255,0.6)]"

// Short date for a card's footer, e.g. "Jul 8".
const shortDate = (ms: number) => new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric" })

// --- Thumbnail rendering -------------------------------------------------------------------------
// A note's scene is exported to a standalone SVG once and memoised by `${id}:${updatedAt}`, so the
// costly export runs only when a drawing actually changes (updatedAt bumps). Only one entry per note is
// kept: a fresh render evicts the note's older one, so the cache can't grow without bound as a note is
// edited. Returns the SVG's markup (not the node) so React can inject it and remounts stay cheap.
const thumbCache = new Map<string, Promise<string | null>>()

async function renderThumb(scene: NoteScene): Promise<string | null> {
    // restore() rehydrates the stored scene into typed elements exportToSvg accepts.
    const restored = restore({ elements: scene.elements, appState: scene.appState, files: scene.files } as never, null, null)
    const elements = restored.elements.filter((element) => !element.isDeleted)
    if (elements.length === 0) return null
    const svg = await exportToSvg({
        elements: elements as never,
        // Transparent thumbnail: no background rect, so the sketch sits on the card's own fill.
        appState: { ...restored.appState, exportBackground: false },
        files: restored.files,
        exportPadding: 12,
        // Cap the raster so thumbnails stay small; skip font inlining (a preview doesn't need embedded
        // fonts, and it keeps the export fast + the markup tiny).
        maxWidthOrHeight: 480,
        skipInliningFonts: true
    })
    // Make it fluid inside the card: drop the fixed pixel dims but keep the viewBox, so the card's
    // height follows the drawing's aspect ratio (what gives the wall its masonry stagger).
    svg.removeAttribute("width")
    svg.removeAttribute("height")
    svg.setAttribute("style", "width:100%;height:auto;display:block")
    return svg.outerHTML
}

function thumbFor(note: Note): Promise<string | null> {
    const key = `${note.id}:${note.updatedAt}`
    const cached = thumbCache.get(key)
    if (cached) return cached
    for (const existing of thumbCache.keys()) if (existing.startsWith(`${note.id}:`)) thumbCache.delete(existing)
    const pending = renderThumb(note.scene).catch(() => null)
    thumbCache.set(key, pending)
    return pending
}

function NoteThumbnail({ note }: { note: Note }) {
    const [markup, setMarkup] = useState<string | null>(null)
    const [ready, setReady] = useState(false)

    useEffect(() => {
        let cancelled = false
        setReady(false)
        thumbFor(note).then((svg) => {
            if (cancelled) return
            setMarkup(svg)
            setReady(true)
        })
        return () => {
            cancelled = true
        }
        // Keyed on the scene version, not the note object (which is a fresh reference on any rename).
    }, [note.id, note.updatedAt])

    if (!ready) return <div className="h-[132px] animate-[pulse2_1.4s_ease-in-out_infinite] bg-[#efe6cc]" />
    if (!markup) {
        return (
            <div className="grid h-[132px] place-items-center">
                <div className="flex flex-col items-center gap-1.5 text-[#c2ad78]">
                    <svg viewBox="0 0 24 24" width={26} height={26} fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M12 20h9" />
                        <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
                    </svg>
                    <span className="font-display text-[11px] uppercase tracking-[1.5px]">Empty</span>
                </div>
            </div>
        )
    }
    // The markup is this device's own drawing (local, same-origin), exported by Excalidraw — not remote
    // content — so injecting it is safe.
    return (
        <div
            className="max-h-[380px] overflow-hidden [&>svg]:block [&>svg]:h-auto [&>svg]:w-full"
            // biome-ignore lint/security/noDangerouslySetInnerHtml: self-authored local SVG from exportToSvg
            dangerouslySetInnerHTML={{ __html: markup }}
        />
    )
}

// --- Card ----------------------------------------------------------------------------------------
const TITLE_INPUT =
    "w-full min-w-0 rounded-md border border-[#d8c48f] bg-[#fffdf5] px-1.5 py-0.5 font-display text-[13px] font-semibold text-[#4a3410] focus:border-[#b8892b] focus:shadow-[0_0_0_2px_rgba(230,196,88,0.35)] focus:outline-none"

function NoteCard({
    note,
    onOpen,
    onRename,
    highlighted
}: {
    note: Note
    onOpen: (id: string) => void
    onRename: (id: string, title: string) => void
    highlighted?: boolean
}) {
    const [editing, setEditing] = useState(false)
    const [draft, setDraft] = useState(note.title)

    const commit = () => {
        onRename(note.id, draft)
        setEditing(false)
    }

    return (
        <div
            data-note-id={note.id}
            onClick={() => onOpen(note.id)}
            className={`group relative mb-4 flex break-inside-avoid cursor-pointer flex-col gap-2 rounded-[15px] p-2.5 transition-[box-shadow] duration-150 ease-out animate-[itemIn_0.25s_ease] ${CARD_SHADOW} ${
                highlighted ? "ring-2 ring-[#e6c458] ring-offset-1 ring-offset-[#f6edd6]" : ""
            }`}
            style={CARD_STYLE}
        >
            <div className="overflow-hidden rounded-[10px]">
                <NoteThumbnail note={note} />
            </div>
            <div className="flex items-center justify-between gap-2 px-0.5">
                {editing ? (
                    // biome-ignore lint/a11y/noAutofocus: opening the inline rename should take focus
                    <input
                        autoFocus
                        aria-label="Note title"
                        className={TITLE_INPUT}
                        value={draft}
                        maxLength={60}
                        onClick={(event) => event.stopPropagation()}
                        onChange={(event) => setDraft(event.target.value)}
                        onBlur={commit}
                        onKeyDown={(event) => {
                            if (event.key === "Enter") commit()
                            else if (event.key === "Escape") setEditing(false)
                        }}
                    />
                ) : (
                    <button
                        type="button"
                        aria-label={`Rename ${note.title}`}
                        title="Click to rename"
                        onClick={(event) => {
                            event.stopPropagation()
                            setDraft(note.title)
                            setEditing(true)
                        }}
                        className="min-w-0 truncate bg-transparent text-left font-display text-[13.5px] font-semibold text-[#4a3410] transition-colors duration-150 ease-out hover:text-[#8a641d]"
                    >
                        {note.title}
                    </button>
                )}
                <time className="flex-none font-display text-[11px] text-[#a2916c]">{shortDate(note.updatedAt)}</time>
            </div>
        </div>
    )
}

type DrawBoardProps = {
    notes: Note[]
    onOpen: (id: string) => void
    onAdd: () => void
    onRename: (id: string, title: string) => void
    // The just-added scribble id, ringed briefly on the wall.
    highlightId?: string | null
}

export function DrawBoard({ notes, onOpen, onAdd, onRename, highlightId }: DrawBoardProps) {
    return (
        <div className="mx-auto w-[95%] max-w-[1400px] px-1 py-10">
            <div className="mb-6">
                <h2 className="font-decorative text-[21px] font-bold tracking-[0.4px] text-[#4a3410]">Scribbles</h2>
                <p className="mt-0.5 text-[13.5px] italic text-[#a2916c]">
                    A wall of your scribbles. Each one is its own canvas: open one to draw, or start a new one.
                </p>
            </div>

            <div className="columns-2 gap-4 sm:columns-3 lg:columns-4 xl:columns-5">
                <button
                    type="button"
                    data-add-note-trigger=""
                    aria-label="Add Scribble"
                    title="Add Scribble"
                    onClick={onAdd}
                    className="mb-4 flex aspect-[4/3] w-full break-inside-avoid items-center justify-center gap-2 rounded-[15px] border-2 border-dashed border-[#cdb373] bg-transparent font-display text-[12.5px] font-semibold uppercase tracking-[1px] text-[#b79a52] opacity-60 transition-[color,border-color,background-color,opacity] duration-150 ease-out hover:border-[#b8892b] hover:bg-white/30 hover:text-[#8a6b28] hover:opacity-100"
                >
                    <Plus size={22} />
                </button>
                {notes.map((note) => (
                    <NoteCard
                        key={note.id}
                        note={note}
                        onOpen={onOpen}
                        onRename={onRename}
                        highlighted={note.id === highlightId}
                    />
                ))}
            </div>
        </div>
    )
}

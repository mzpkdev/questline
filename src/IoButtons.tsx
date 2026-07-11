// The quiet export / import cluster, ported from the mockup's `.io` group. Export downloads the
// JSON that App hands back from onExport(); Import reads a chosen file and passes its text to
// onImport(). The DOM plumbing (Blob download, hidden file input) lives here; the state and the
// wire format live in App and persist.ts.

import { type ChangeEvent, useRef } from "react"

export const ioButtonClass =
    "grid size-[26px] appearance-none place-items-center rounded-lg border border-transparent bg-transparent text-[#b3a074] opacity-[.42] transition-[opacity,color,background-color,transform] duration-150 ease-out hover:opacity-100 hover:bg-[#f4ead0]/70 hover:text-[#8a6b28] active:scale-95"

type IoButtonsProps = {
    // Returns the JSON string to download.
    onExport: () => string
    // Receives the raw text of a chosen file; validates and applies (or alerts) inside App.
    onImport: (json: string) => void
}

export function IoButtons({ onExport, onImport }: IoButtonsProps) {
    const fileRef = useRef<HTMLInputElement>(null)

    const exportRoadmap = () => {
        const blob = new Blob([onExport()], { type: "application/json" })
        const url = URL.createObjectURL(blob)
        const anchor = document.createElement("a")
        anchor.href = url
        anchor.download = "questline.json"
        anchor.click()
        URL.revokeObjectURL(url)
    }

    const importRoadmap = async (event: ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0]
        event.target.value = "" // let the same file re-trigger onChange next time
        if (!file) return
        onImport(await file.text())
    }

    return (
        <div className="flex items-center gap-1">
            <button
                type="button"
                onClick={exportRoadmap}
                aria-label="Export roadmap"
                title="Export roadmap"
                className={ioButtonClass}
            >
                <svg
                    width={15}
                    height={15}
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={1.8}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                >
                    <path d="M12 3v11" />
                    <path d="M8 10l4 4 4-4" />
                    <path d="M5 20h14" />
                </svg>
            </button>
            <button
                type="button"
                onClick={() => fileRef.current?.click()}
                aria-label="Import roadmap"
                title="Import roadmap"
                className={ioButtonClass}
            >
                <svg
                    width={15}
                    height={15}
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={1.8}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                >
                    <path d="M12 15V4" />
                    <path d="M8 8l4-4 4 4" />
                    <path d="M5 20h14" />
                </svg>
            </button>
            <input
                ref={fileRef}
                type="file"
                accept="application/json,.json"
                onChange={importRoadmap}
                className="hidden"
                data-testid="import-input"
            />
        </div>
    )
}

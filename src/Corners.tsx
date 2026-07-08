// The four filigree corner flourishes, ported from the mockup's `.corner` SVGs (index.html
// ~L81-85, markup ~L254-257). Purely decorative: each is aria-hidden and pointer-events-none, and
// positions itself against whatever positioned ancestor the App supplies. The single corner path
// is drawn once (top-left) and the other three are the same art mirrored via CSS transforms.

const cornerPath = "M2 2 C2 22 10 34 34 34 M2 2 C22 2 34 10 34 34 M2 2 C2 14 7 20 16 22 M2 2 C14 2 20 7 22 16"

const corners: { id: string; position: string; transform?: string }[] = [
    { id: "tl", position: "top-2 left-3" },
    { id: "tr", position: "top-2 right-3", transform: "scaleX(-1)" },
    { id: "bl", position: "bottom-2 left-3", transform: "scaleY(-1)" },
    { id: "br", position: "bottom-2 right-3", transform: "scale(-1,-1)" }
]

export function Corners() {
    return (
        <>
            {corners.map((corner) => (
                <svg
                    key={corner.id}
                    data-testid="corner"
                    aria-hidden="true"
                    viewBox="0 0 40 40"
                    className={`pointer-events-none absolute z-[2] h-16 w-16 opacity-30 ${corner.position}`}
                    style={{ transform: corner.transform }}
                >
                    <path d={cornerPath} fill="none" stroke="#b8892b" strokeWidth="1.3" strokeLinecap="round" />
                </svg>
            ))}
        </>
    )
}

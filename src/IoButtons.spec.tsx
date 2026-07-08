import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { IoButtons } from "./IoButtons"

describe("IoButtons", () => {
    it("renders the export and import buttons", () => {
        render(<IoButtons onExport={() => "{}"} onImport={() => {}} />)

        expect(screen.getByRole("button", { name: /export roadmap/i })).toBeInTheDocument()
        expect(screen.getByRole("button", { name: /import roadmap/i })).toBeInTheDocument()
    })

    it("downloads the exported JSON when export is clicked", () => {
        // jsdom has no object-URL / download; stub the two APIs the handler touches.
        const createObjectURL = vi.fn(() => "blob:stub")
        const revokeObjectURL = vi.fn()
        vi.stubGlobal("URL", { ...URL, createObjectURL, revokeObjectURL })
        const onExport = vi.fn(() => '{"version":1}')

        render(<IoButtons onExport={onExport} onImport={() => {}} />)
        fireEvent.click(screen.getByRole("button", { name: /export roadmap/i }))

        expect(onExport).toHaveBeenCalledTimes(1)
        expect(createObjectURL).toHaveBeenCalledTimes(1)
        vi.unstubAllGlobals()
    })

    it("passes a chosen file's text to onImport", async () => {
        const onImport = vi.fn()
        render(<IoButtons onExport={() => "{}"} onImport={onImport} />)

        const file = new File(['{"version":1}'], "roadmap.json", { type: "application/json" })
        fireEvent.change(screen.getByTestId("import-input"), { target: { files: [file] } })

        await waitFor(() => expect(onImport).toHaveBeenCalledWith('{"version":1}'))
    })
})

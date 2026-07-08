import "@testing-library/jest-dom/vitest"
import { describe } from "vitest"

// rspec-style alias so specs read as `context(...)`, matching the reference suite
globalThis.context = describe

// jsdom lacks the layout APIs React Flow and Ark UI reach for; stub them so components render.
class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
}
globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver

class DOMMatrixStub {
    m22 = 1
}
globalThis.DOMMatrixReadOnly = DOMMatrixStub as unknown as typeof DOMMatrixReadOnly

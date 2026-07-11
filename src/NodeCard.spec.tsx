import { render, screen } from "@testing-library/react"
import { ReactFlow } from "@xyflow/react"
import type { NodeFlowNode } from "./flow"
import { byId } from "./graph"
import { NodeCard } from "./NodeCard"
import type { NodeState } from "./nodes"

const nodeTypes = { milestone: NodeCard }

type NodeOverrides = {
    id?: string
    state?: NodeState
    isRoot?: boolean
    isSelected?: boolean
}

function renderNode(overrides: NodeOverrides = {}) {
    const milestone = byId(overrides.id ?? "plan-goal")
    if (!milestone) throw new Error(`missing milestone fixture: ${overrides.id}`)

    const node: NodeFlowNode = {
        id: milestone.id,
        type: "milestone",
        position: { x: 0, y: 0 },
        data: {
            milestone,
            state: overrides.state ?? "available",
            isRoot: overrides.isRoot ?? false,
            isSelected: overrides.isSelected ?? false
        }
    }

    return render(
        <div style={{ width: 800, height: 600 }}>
            <ReactFlow nodes={[node]} nodeTypes={nodeTypes} />
        </div>
    )
}

describe("NodeCard", () => {
    it("renders the milestone title", () => {
        renderNode({ id: "plan-goal" })
        expect(screen.getByText("Plan your goal")).toBeInTheDocument()
    })

    it("exposes the state on the root element", () => {
        const { container } = renderNode({ id: "plan-goal", state: "locked" })
        // React Flow's own node wrapper also carries data-id; our card root is the
        // element that carries data-state, so match on both to target it.
        const root = container.querySelector('[data-id="plan-goal"][data-state]')
        expect(root).toHaveAttribute("data-state", "locked")
    })

    context("when the node is selected", () => {
        it("renders the marching-ants selection box", () => {
            renderNode({ isSelected: true })
            expect(screen.getByTestId("node-selbox")).toBeInTheDocument()
        })
    })

    context("when the node is not selected", () => {
        it("omits the selection box", () => {
            renderNode({ isSelected: false })
            expect(screen.queryByTestId("node-selbox")).not.toBeInTheDocument()
        })
    })

    context("for a normal node", () => {
        it("renders the left accent bar", () => {
            renderNode({ id: "plan-goal", isRoot: false })
            expect(screen.getByTestId("node-bar")).toBeInTheDocument()
        })
    })

    context("for the root node", () => {
        it("omits the left accent bar", () => {
            renderNode({ id: "learn", isRoot: true })
            expect(screen.queryByTestId("node-bar")).not.toBeInTheDocument()
        })
    })

    it("renders the glow layer for an available node", () => {
        renderNode({ state: "available" })
        expect(screen.getByTestId("node-glow")).toBeInTheDocument()
    })
})

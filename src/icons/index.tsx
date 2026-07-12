// Local, dependency-free icon set (replaces lucide-react). Two groups share the file:
//
//  - Generic UI glyphs (Plus, X, Check, Pencil): lucide node data, wrapped in the shared <Icon>.
//  - Node-action glyphs (AddParent, AddChild, DetachNode, AttachNode, LinkNode, PlainNode, DeleteNode):
//    a cohesive custom set for the detail card's edit-mode actions. Every one is built from the same
//    primitive -- a rounded square standing for a tree node (echoing the node cards) -- plus edges and a
//    small modifier, so the icon reads as what the action does to the node in the tree.
import { Icon, type IconProps } from "./Icon"

// --- Generic UI glyphs -------------------------------------------------------------------------------

export function Plus(props: IconProps) {
    return (
        <Icon {...props}>
            <path d="M5 12h14" />
            <path d="M12 5v14" />
        </Icon>
    )
}

export function X(props: IconProps) {
    return (
        <Icon {...props}>
            <path d="M18 6 6 18" />
            <path d="m6 6 12 12" />
        </Icon>
    )
}

export function Check(props: IconProps) {
    return (
        <Icon {...props}>
            <path d="M20 6 9 17l-5-5" />
        </Icon>
    )
}

export function Pencil(props: IconProps) {
    return (
        <Icon {...props}>
            <path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z" />
            <path d="m15 5 4 4" />
        </Icon>
    )
}

// Scribble: a pencil over a baseline -- the scribble glyph, matching ScribblesBoard's empty-state mark.
export function Scribble(props: IconProps) {
    return (
        <Icon {...props}>
            <path d="M12 20h9" />
            <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
        </Icon>
    )
}

// --- Node-action glyphs (shared rounded-square node primitive) ---------------------------------------

// Add parent: a new (+) node ABOVE this node, joined by an edge.
export function AddParent(props: IconProps) {
    return (
        <Icon {...props}>
            <rect x="8" y="2" width="8" height="8" rx="2" />
            <path d="M12 4v4" />
            <path d="M10 6h4" />
            <path d="M12 10v4" />
            <rect x="8" y="14" width="8" height="8" rx="2" />
        </Icon>
    )
}

// Add child: a new (+) node BELOW this node, joined by an edge.
export function AddChild(props: IconProps) {
    return (
        <Icon {...props}>
            <rect x="8" y="2" width="8" height="8" rx="2" />
            <path d="M12 10v4" />
            <rect x="8" y="14" width="8" height="8" rx="2" />
            <path d="M12 16v4" />
            <path d="M10 18h4" />
        </Icon>
    )
}

// Detach: this node with the edge to its parent SNAPPED (two offset stubs, a gap between).
export function DetachNode(props: IconProps) {
    return (
        <Icon {...props}>
            <path d="M13 3v3" />
            <path d="M11 10v3" />
            <rect x="8" y="13" width="8" height="8" rx="2" />
        </Icon>
    )
}

// Attach: this node with an edge running UP into a parent, arrowhead pointing up (re-hanging it).
export function AttachNode(props: IconProps) {
    return (
        <Icon {...props}>
            <path d="M12 13V5" />
            <path d="M9 8l3-3 3 3" />
            <rect x="8" y="13" width="8" height="8" rx="2" />
        </Icon>
    )
}

// Convert to linked: this node with an arrow leaving it to another board (an external-link mark).
export function LinkNode(props: IconProps) {
    return (
        <Icon {...props}>
            <rect x="4" y="13" width="8" height="8" rx="2" />
            <path d="M13 11 20 4" />
            <path d="M20 9V4h-5" />
        </Icon>
    )
}

// Convert to regular: a plain node, no modifier.
export function PlainNode(props: IconProps) {
    return (
        <Icon {...props}>
            <rect x="6" y="6" width="12" height="12" rx="3" />
        </Icon>
    )
}

// Delete: this node crossed out with an X.
export function DeleteNode(props: IconProps) {
    return (
        <Icon {...props}>
            <rect x="5" y="5" width="14" height="14" rx="3" />
            <path d="M9.5 9.5l5 5" />
            <path d="M14.5 9.5l-5 5" />
        </Icon>
    )
}

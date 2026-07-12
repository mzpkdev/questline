// Local, dependency-free icon set replacing lucide-react. Most glyphs are lucide node data (paths /
// lines / rects) wrapped in the shared <Icon> (24x24, currentColor stroke), named to match lucide so a
// consumer only swaps the import path. AddParent / AddChild are custom: a stacked pair of nodes joined
// by an edge, where the plus marks WHERE the new node lands (on top for a parent, below for a child).
// Add a glyph here when a new one is needed rather than re-adding the dependency.
import { Icon, type IconProps } from "./Icon"

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

export function Circle(props: IconProps) {
    return (
        <Icon {...props}>
            <circle cx="12" cy="12" r="10" />
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

export function Trash2(props: IconProps) {
    return (
        <Icon {...props}>
            <path d="M10 11v6" />
            <path d="M14 11v6" />
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
            <path d="M3 6h18" />
            <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
        </Icon>
    )
}

export function Link(props: IconProps) {
    return (
        <Icon {...props}>
            <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
            <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
        </Icon>
    )
}

export function Link2(props: IconProps) {
    return (
        <Icon {...props}>
            <path d="M9 17H7A5 5 0 0 1 7 7h2" />
            <path d="M15 7h2a5 5 0 1 1 0 10h-2" />
            <line x1="8" x2="16" y1="12" y2="12" />
        </Icon>
    )
}

export function Unlink(props: IconProps) {
    return (
        <Icon {...props}>
            <path d="m18.84 12.25 1.72-1.71h-.02a5.004 5.004 0 0 0-.12-7.07 5.006 5.006 0 0 0-6.95 0l-1.72 1.71" />
            <path d="m5.17 11.75-1.71 1.71a5.004 5.004 0 0 0 .12 7.07 5.006 5.006 0 0 0 6.95 0l1.71-1.71" />
            <line x1="8" x2="8" y1="2" y2="5" />
            <line x1="2" x2="5" y1="8" y2="8" />
            <line x1="16" x2="16" y1="19" y2="22" />
            <line x1="19" x2="22" y1="16" y2="16" />
        </Icon>
    )
}

// Add parent: the new (plus) node sits ABOVE this node, joined by an edge.
export function AddParent(props: IconProps) {
    return (
        <Icon {...props}>
            <circle cx="12" cy="6" r="4" />
            <path d="M10 6h4" />
            <path d="M12 4v4" />
            <path d="M12 10v4" />
            <circle cx="12" cy="18" r="4" />
        </Icon>
    )
}

// Add child: the new (plus) node sits BELOW this node, joined by an edge.
export function AddChild(props: IconProps) {
    return (
        <Icon {...props}>
            <circle cx="12" cy="6" r="4" />
            <path d="M12 10v4" />
            <circle cx="12" cy="18" r="4" />
            <path d="M10 18h4" />
            <path d="M12 16v4" />
        </Icon>
    )
}

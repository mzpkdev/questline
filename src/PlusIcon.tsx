// The shared + glyph for every "add" affordance (task / reward tiles, node + linked-node add buttons), so
// they all read as the one action. Sized by `size`; inherits colour via currentColor and is decorative
// (the button's text carries the accessible name).
export function PlusIcon({ size = 17 }: { size?: number }) {
    return (
        <svg
            width={size}
            height={size}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.9}
            strokeLinecap="round"
            aria-hidden="true"
        >
            <path d="M12 5v14M5 12h14" />
        </svg>
    )
}

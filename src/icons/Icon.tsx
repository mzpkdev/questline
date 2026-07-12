import type { ReactNode, SVGProps } from "react"

// Shared wrapper for the local icon set -- a small, dependency-free reimplementation of the handful of
// lucide glyphs the app uses (paths lifted verbatim from lucide so they render identically). Matches
// lucide's SVG contract: a 24x24 viewBox, no fill, currentColor stroke, round caps/joins, and
// aria-hidden (every icon sits inside a control that carries its own aria-label). `size` drives width
// and height; any other SVG prop (strokeWidth, className, ...) passes straight through.
export type IconProps = Omit<SVGProps<SVGSVGElement>, "width" | "height"> & { size?: number }

export function Icon({ size = 24, strokeWidth = 2, children, ...rest }: IconProps & { children: ReactNode }) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width={size}
            height={size}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            {...rest}
        >
            {children}
        </svg>
    )
}

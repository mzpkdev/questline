// The Merchant view: a shop of gold-framed reward cards on the same parchment board as the roadmap, a
// re-port of the mockup's shop-shelves.html. The purse (top-right) shows gold earned on the roadmap
// minus what's been spent; each card offers a Redeem when it's affordable and a dimmed "Need N more"
// when it isn't. The trailing dashed tile opens an inline add form. Every reward is repeatable in this
// first cut, so redeeming just spends gold and leaves the card on the shelf (App owns the state; the
// pure ops + gold rule live in merchant.ts).

import { type FormEvent, useEffect, useRef, useState } from "react"
import { ConfirmDialog } from "./ConfirmDialog"
import { ioButtonClass } from "./IoButtons"
import type { Reward } from "./merchant"
import { prefersReducedMotion } from "./nodeMotion"

// Card faces (mockup `.reward`): the double-gradient border trick -- a cream padding-box fill beneath a
// gold border-box frame. Affordable wears the bright gold frame; locked dims to a muted tan.
const CARD_STYLE = {
    border: "2px solid transparent",
    background:
        "linear-gradient(180deg,#faf2dc,#efe1bd) padding-box, linear-gradient(180deg,#fbeeb8,#b8892b) border-box"
} as const
const CARD_LOCKED_STYLE = {
    border: "2px solid transparent",
    background:
        "linear-gradient(180deg,#efe9d8,#e2d8bf) padding-box, linear-gradient(180deg,#e0d3ad,#a99a72) border-box"
} as const

// The coin-purse pill (mockup `.purse`): the same gold frame as a card, sized for the balance.
const PURSE_STYLE = {
    border: "2px solid transparent",
    background:
        "linear-gradient(180deg,#faf2dc,#efe1bd) padding-box, linear-gradient(180deg,#fbeeb8,#b8892b) border-box"
} as const

// The "New reward" card panel: the milestone tree's detail-card shell (identical gold frame, radius,
// shadow, and padding to DetailCard's CARD_STYLE), so App can drop it into the same top-right aside.
const ADD_CARD_STYLE = {
    border: "2px solid transparent",
    borderRadius: "16px",
    background:
        "linear-gradient(180deg,#faf2dc,#efe1bd) padding-box, linear-gradient(180deg,#fbeeb8,#b8892b) border-box",
    boxShadow: "0 24px 50px -20px rgba(60,40,10,0.6), inset 0 1px 0 rgba(255,255,255,0.6)",
    padding: "18px 20px 20px"
} as const

// The card's submit button, matching DetailCard's gold action button (rounded-[11px], py-3).
const ADD_BTN =
    "mt-[18px] w-full rounded-[11px] py-3 font-display text-[14px] font-bold uppercase tracking-wide text-[#3a2a0c] bg-[#e6c458] shadow-[0_3px_9px_-5px_rgba(184,137,43,0.7),inset_0_1px_0_rgba(255,255,255,0.4)] transition-colors duration-150 ease-out hover:bg-[#eccb63]"

const CARD_SHADOW =
    "shadow-[0_10px_22px_-16px_rgba(60,40,10,0.6),inset_0_1px_0_rgba(255,255,255,0.6)] hover:shadow-[0_16px_26px_-12px_rgba(60,40,10,0.7),inset_0_1px_0_rgba(255,255,255,0.6)]"
// Unaffordable / redeemed tiles lift only faintly on hover, so out-of-reach rewards stay quiet.
const CARD_SHADOW_SUBTLE =
    "shadow-[0_10px_22px_-16px_rgba(60,40,10,0.5),inset_0_1px_0_rgba(255,255,255,0.55)] hover:shadow-[0_12px_22px_-15px_rgba(60,40,10,0.55),inset_0_1px_0_rgba(255,255,255,0.55)]"

// Redeem / disabled action buttons (mockup `.act-unlock` / `.act-off`).
const UNLOCK_BTN =
    "w-full rounded-[10px] border-0 p-2.5 font-display text-[12.5px] font-bold uppercase tracking-[1px] text-[#3a2a0c] bg-[#e6c458] shadow-[0_3px_9px_-5px_rgba(184,137,43,0.7),inset_0_1px_0_rgba(255,255,255,0.4)] transition-colors duration-150 ease-out hover:bg-[#eccb63] active:translate-y-px"
const OFF_BTN =
    "w-full rounded-[10px] border-0 p-2.5 font-display text-[12.5px] font-bold uppercase tracking-[1px] text-[#8a7c5a] bg-[#e0d5b6] shadow-[inset_0_1px_3px_rgba(90,60,10,0.2)]"

// A one-shot gold bloom on the card just redeemed (the roadmap's node-flash look), and the purse's
// bump when the balance changes -- both filter/transform only, honouring reduced-motion.
const FLASH: Keyframe[] = [
    { filter: "none", offset: 0 },
    { filter: "drop-shadow(0 0 16px rgba(245,214,110,0.95)) brightness(1.1)", offset: 0.28 },
    { filter: "none", offset: 1 }
]
const BUMP: Keyframe[] = [
    { transform: "none", offset: 0 },
    { transform: "scale(1.07)", offset: 0.3 },
    { transform: "none", offset: 1 }
]
const canAnimate = (el: HTMLElement | null): el is HTMLElement =>
    !!el && !prefersReducedMotion() && typeof el.animate === "function"

// The detailed gold coin, ported from the mockup's inline SVG symbol so the purse and prices carry the
// same minted look. Decorative only.
function Coin({ size, className }: { size: number; className?: string }) {
    return (
        <svg
            viewBox="0 0 512 512"
            width={size}
            height={size}
            aria-hidden="true"
            className={className}
            style={{ filter: "drop-shadow(0 1px 1px rgba(90,60,10,0.35))" }}
        >
            <path
                fill="#d9a509"
                d="M460 385C442.8 414 417.4 440 390 458.7C345.9 488.7 292.7 506.3 239 504C89.7 497.4-23 354.1 6.2 208 12.4 177.1 24.9 147.3 42.3 121 63.8 88.7 92.2 61.5 126 42.3 165.2 20 209 8.9 254 9c37.5.1 77.1 11.5 110 29.3-31.7-18.6-67.8-30.2-105-33C130.3-1.2 6.1 105.7 0 245c-6.3 144.7 120.4 273.4 267 259.2 59.6-5.8 115.1-29.3 158-72.2 11.9-11.9 31-30.1 35-47z"
            />
            <path
                fill="#e9c34f"
                d="M234 9.4C175.5 17.1 123.1 35 79 76.1 57.4 96.2 39.9 120.7 26.8 147c-69.4 139.2 11.5 312 162.2 349.6 30.2 7.5 61.3 9.1 92 5.1C398.3 486.3 490.8 385.2 496 267 501.2 147.7 415.1 37.6 298 14.2 277.6 10.1 254.8 6.7 234 9.4z"
            />
            <path
                fill="#d7a301"
                d="M233 43.4C187 49.5 144.6 63 108.4 93.7 89 110.2 73.5 130.9 61.1 153c-48 86.1-28.2 202 47.3 266.3 45.2 38.4 106.9 56.5 165.6 49.4 32.2-3.9 63.7-14.8 91-32.4 103-66.3 129.5-216.7 52-313.1C389.7 89.3 352.4 64.7 311 52 286.8 44.5 258.3 40.1 233 43.4z"
            />
            <path
                fill="#e9c34f"
                d="M240 51.4C198.5 56.9 160.4 68.4 126.6 94.3 106.5 109.8 89.8 129.5 76.4 151c-53.4 85.8-32 201.5 46 265.3 45.2 37 105.1 52.6 162.6 44.4 28.5-4 55.5-14.9 80-29.9 19.5-11.9 36.7-27.9 50.8-45.8 70.2-89.2 54-226.3-38.8-293.5-19.6-14.2-41.7-25.4-65-32.1-22.5-6.5-48.6-11-72-7.9z"
            />
            <path
                fill="#d7a301"
                d="M248 154l-31.9 57L203 236l-2-2c-6.1 3.4-16.8-2.2-23-4-17.6-5.1-39.8-14.5-58-15v3c7.8 4.4 11.4 19.2 15.2 27l32 64c3.3 6.6 7.3 20.7 13.4 25 3.8 2.6 12 1 16.4 1 14.1 0 28-1 42-1 19.3 0 38.7 1 58 1 6.2 0 16.9 2.1 22.6-.6 7.1-3.3 12.7-22.5 16.2-29.4 10-19.9 19.3-40.2 29.5-60 4.9-9.6 12.8-20.4 14.7-31-3.5.5-9.5 1.1-10 5-9.5-1.7-19.9 3.2-29 6-14.8 4.5-30 7.8-45 12-3.1-10.6-11.4-20.5-16.9-30.2-9.5-16.7-17.8-38.9-31.1-52.8z"
            />
        </svg>
    )
}

// Bump the purse whenever the balance changes, so gold leaving (or arriving) reads on screen.
function usePurseBump(gold: number) {
    const ref = useRef<HTMLDivElement>(null)
    const prev = useRef(gold)
    useEffect(() => {
        const before = prev.current
        prev.current = gold
        if (before === gold) return
        if (canAnimate(ref.current)) {
            ref.current.animate(BUMP, { duration: 480, easing: "cubic-bezier(.2,.75,.25,1)" })
        }
    }, [gold])
    return ref
}

type MerchantBoardProps = {
    gold: number
    rewards: Reward[]
    onRedeem: (id: string) => void
    // Opens the "New reward" card (rendered by App in the shared detail-card aside).
    onOpenAdd: () => void
    onRemoveReward: (id: string) => void
}

// Short date for a redeemed reward's tile, e.g. "Jul 8".
const redeemedOn = (ms: number) => new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric" })

function RewardTile({
    reward,
    gold,
    onRedeem,
    onRequestRemove
}: {
    reward: Reward
    gold: number
    onRedeem: (id: string) => void
    onRequestRemove: (reward: Reward) => void
}) {
    const cardRef = useRef<HTMLDivElement>(null)
    const redeemed = reward.redeemedAt !== undefined
    const affordable = !redeemed && gold >= reward.price
    const need = reward.price - gold

    const redeem = () => {
        if (!affordable) return
        if (canAnimate(cardRef.current)) cardRef.current.animate(FLASH, { duration: 900, easing: "ease-out" })
        onRedeem(reward.id)
    }

    return (
        <div
            ref={cardRef}
            data-reward-id={reward.id}
            className={`relative flex min-h-[132px] flex-col gap-3 rounded-[15px] p-4 transition-[box-shadow] duration-150 ease-out animate-[itemIn_0.25s_ease] ${
                affordable ? CARD_SHADOW : CARD_SHADOW_SUBTLE
            } ${redeemed ? "opacity-[0.58]" : affordable ? "" : "opacity-[0.92]"}`}
            style={affordable ? CARD_STYLE : CARD_LOCKED_STYLE}
        >
            {/* Redeemed rewards are locked in: no remove affordance. */}
            {!redeemed && (
                <button
                    type="button"
                    aria-label={`Remove ${reward.name}`}
                    onClick={() => onRequestRemove(reward)}
                    className={`${ioButtonClass} absolute right-3 top-3 text-[15px] leading-none`}
                >
                    &times;
                </button>
            )}
            <span
                className={`inline-flex items-start gap-1.5 break-words pr-8 font-display text-[16px] font-semibold leading-tight ${
                    redeemed ? "text-[#a2916c] line-through" : affordable ? "text-[#6f5316]" : "text-[#8a7c5a]"
                }`}
            >
                {reward.name}
                {reward.replenish && (
                    <svg
                        viewBox="0 0 24 24"
                        width={13}
                        height={13}
                        fill="none"
                        stroke="currentColor"
                        strokeWidth={2.2}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        className="mt-0.5 flex-none text-[#b0954e]"
                        aria-label="Auto-replenishes"
                    >
                        <title>Auto-replenishes</title>
                        <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
                        <path d="M21 3v5h-5" />
                        <path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
                        <path d="M3 21v-5h5" />
                    </svg>
                )}
            </span>
            <span
                className={`mt-auto inline-flex items-center gap-1.5 font-display text-[17px] font-bold ${
                    affordable ? "text-[#4a3410]" : "text-[#8a7c5a]"
                }`}
            >
                <Coin size={17} className={affordable ? "animate-[coinPulse_2.6s_ease-in-out_infinite]" : undefined} />
                {reward.price}
            </span>
            {redeemed ? (
                <div className="rounded-[10px] bg-[#e0d5b6]/50 p-2.5 text-center font-display text-[12.5px] font-bold uppercase tracking-[1px] text-[#8a7c5a]">
                    Redeemed {reward.redeemedAt !== undefined ? redeemedOn(reward.redeemedAt) : ""}
                </div>
            ) : (
                <button
                    type="button"
                    aria-label={`Redeem ${reward.name}`}
                    disabled={!affordable}
                    onClick={redeem}
                    className={affordable ? UNLOCK_BTN : OFF_BTN}
                >
                    {affordable ? "Redeem" : `Need ${need} more`}
                </button>
            )}
        </div>
    )
}

// Shared field look for the card's two inputs.
const INPUT_CLASS =
    "w-full rounded-lg border border-[#d8c48f] bg-[#fffdf5] px-2.5 py-2 font-display text-[15px] font-semibold text-[#4a3410] focus:border-[#b8892b] focus:shadow-[0_0_0_2px_rgba(230,196,88,0.35)] focus:outline-none"

// The "New reward" card: the milestone DetailCard's shell (same gold frame, cardSwap in / cardSwapOut
// on close) with the add form as its contents. App renders it in the identical top-right aside the
// milestone card uses, and drives open / close (outside-click + Escape) the same way, passing
// `closing` for the exit animation and `onExited` to unmount after it plays. Submitting adds the reward
// (App then closes the card); a blank name is ignored.
export function AddRewardCard({
    onAdd,
    closing,
    onExited
}: {
    onAdd: (name: string, price: number, replenish: boolean) => void
    closing?: boolean
    onExited?: () => void
}) {
    const [name, setName] = useState("")
    const [price, setPrice] = useState("")
    const [replenish, setReplenish] = useState(false)
    const rootRef = useRef<HTMLDivElement>(null)

    // Fire onExited once the dismissal animation ends, mirroring DetailCard, so App unmounts the card
    // only after the exit plays.
    useEffect(() => {
        if (!closing || !onExited) return
        const el = rootRef.current
        if (!el) return
        const handleEnd = () => onExited()
        el.addEventListener("animationend", handleEnd)
        return () => el.removeEventListener("animationend", handleEnd)
    }, [closing, onExited])

    const submit = (event: FormEvent) => {
        event.preventDefault()
        if (!name.trim()) return
        onAdd(name, Number(price), replenish)
        setName("")
        setPrice("")
        setReplenish(false)
    }

    const animation = closing
        ? "animate-[cardSwapOut_0.2s_ease-in_forwards]"
        : "animate-[cardSwap_0.26s_cubic-bezier(0.2,0.75,0.25,1)]"

    return (
        <div
            ref={rootRef}
            data-testid="add-reward-card"
            className={`relative font-serif ${animation}`}
            style={ADD_CARD_STYLE}
        >
            <form onSubmit={submit} className="flex flex-col">
                <h3 className="mt-0.5 font-display text-[20px] font-bold text-[#4a3410]">New reward</h3>
                <p className="my-[14px] text-[15.5px] leading-relaxed text-[#5a4a2c]">
                    Name it and set what it costs in gold.
                </p>
                {/* biome-ignore lint/a11y/noAutofocus: opening the card should take focus for a quick entry */}
                <input
                    autoFocus
                    aria-label="Reward name"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    placeholder="Reward name"
                    maxLength={60}
                    className={INPUT_CLASS}
                />
                <span className="mb-1.5 mt-4 font-display text-[10.5px] uppercase tracking-[1.5px] text-[#9a7a34]">
                    Cost in gold
                </span>
                <div className="flex items-center gap-2">
                    <Coin size={20} />
                    <input
                        aria-label="Cost in gold"
                        value={price}
                        onChange={(event) => setPrice(event.target.value)}
                        type="number"
                        min={1}
                        step={1}
                        placeholder="0"
                        className={`${INPUT_CLASS} min-w-0 flex-1 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none`}
                    />
                </div>
                <label className="mt-4 flex cursor-pointer select-none items-start gap-2.5">
                    <input
                        type="checkbox"
                        checked={replenish}
                        onChange={(event) => setReplenish(event.target.checked)}
                        className="sr-only"
                    />
                    <span
                        className={`mt-0.5 grid size-5 flex-none place-items-center rounded-md border-[1.5px] transition-colors duration-150 ease-out ${
                            replenish ? "border-[#cdb373] bg-[#ecdcae]" : "border-[#b8892b] bg-[#fffdf5]"
                        }`}
                    >
                        {replenish && (
                            <svg
                                viewBox="0 0 24 24"
                                width={13}
                                height={13}
                                fill="none"
                                stroke="#3a2a0c"
                                strokeWidth={3}
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                aria-hidden="true"
                            >
                                <path d="M5 12l5 5L20 6" />
                            </svg>
                        )}
                    </span>
                    <span className="text-[14px] leading-tight text-[#5a4a2c]">
                        Auto-replenish
                        <small className="mt-0.5 block text-[12px] italic text-[#a2916c]">
                            Restocks a fresh copy each time it's redeemed
                        </small>
                    </span>
                </label>
                <button type="submit" className={ADD_BTN}>
                    Add reward
                </button>
            </form>
        </div>
    )
}

export function MerchantBoard({ gold, rewards, onRedeem, onOpenAdd, onRemoveReward }: MerchantBoardProps) {
    const purseRef = usePurseBump(gold)
    // The reward pending removal: set by its ×, cleared on confirm or cancel. Drives the same confirm
    // modal the tabs use before deleting.
    const [pendingRemove, setPendingRemove] = useState<Reward | null>(null)

    return (
        <div className="mx-auto w-[95%] max-w-[1040px] px-1 py-10">
            <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
                <div>
                    <h2 className="font-decorative text-[21px] font-bold tracking-[0.4px] text-[#4a3410]">Merchant</h2>
                    <p className="mt-0.5 text-[13.5px] italic text-[#a2916c]">
                        Spend the gold you earn from bounties and finished milestones. Add your own rewards and set the
                        price.
                    </p>
                </div>
                <div
                    ref={purseRef}
                    data-testid="purse"
                    aria-label={`${gold} gold`}
                    className="inline-flex items-center gap-2.5 rounded-[13px] px-3.5 py-2 shadow-[0_6px_16px_-10px_rgba(60,40,10,0.7),inset_0_1px_0_rgba(255,255,255,0.6)]"
                    style={PURSE_STYLE}
                >
                    <Coin size={27} />
                    <div>
                        <div className="font-display text-[20px] font-bold leading-none text-[#4a3410]">{gold}</div>
                        <div className="mt-0.5 font-display text-[10.5px] uppercase tracking-[1.5px] text-[#9a7a34]">
                            gold
                        </div>
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-[repeat(auto-fill,minmax(210px,1fr))] gap-3.5">
                {rewards.map((reward) => (
                    <RewardTile
                        key={reward.id}
                        reward={reward}
                        gold={gold}
                        onRedeem={onRedeem}
                        onRequestRemove={setPendingRemove}
                    />
                ))}
                <button
                    type="button"
                    data-add-reward-trigger=""
                    aria-label="Add a reward"
                    title="Add a reward"
                    onClick={onOpenAdd}
                    className="grid min-h-[132px] w-full place-items-center rounded-[15px] border-2 border-dashed border-[#cdb373] bg-transparent text-[#b79a52] opacity-50 transition-[color,border-color,background-color,opacity] duration-150 ease-out hover:border-[#b8892b] hover:bg-white/30 hover:text-[#8a6b28] hover:opacity-100"
                >
                    <svg
                        viewBox="0 0 24 24"
                        width={40}
                        height={40}
                        fill="none"
                        stroke="currentColor"
                        strokeWidth={1.8}
                        strokeLinecap="round"
                        aria-hidden="true"
                    >
                        <path d="M12 5v14M5 12h14" />
                    </svg>
                </button>
            </div>

            <ConfirmDialog
                open={pendingRemove !== null}
                title="Remove this reward?"
                message={
                    <>
                        Delete <strong className="font-semibold text-[#4a3410]">{pendingRemove?.name}</strong>? This
                        can't be undone.
                    </>
                }
                confirmLabel="Remove"
                onConfirm={() => {
                    if (pendingRemove) onRemoveReward(pendingRemove.id)
                    setPendingRemove(null)
                }}
                onOpenChange={(open) => {
                    if (!open) setPendingRemove(null)
                }}
            />
        </div>
    )
}

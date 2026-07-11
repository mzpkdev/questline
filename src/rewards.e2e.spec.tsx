import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { decompressFromUTF16 } from "lz-string"
import { App } from "./App"
import { SfxProvider } from "./SfxProvider"
import { REDEEMED_TTL_MS } from "./rewards"
import { DONE_TTL_MS } from "./tasks"

// The seed roadmap ships one pre-completed milestone (break-steps, reward 3), so a fresh purse holds 3.
const BASE_GOLD = 3

// A structural stand-in for the slice of WebAudio the SFX kit touches (jsdom has none), recording each
// oscillator's waveform + base frequency so a test can assert which cue played. Mirrors sfxWiring.spec.
type Voice = { type: OscillatorType; frequency: number }
let voices: Voice[] = []
class FakeAudioContext {
    currentTime = 0
    state: AudioContextState = "running"
    destination = {} as AudioDestinationNode
    resume() {
        return Promise.resolve()
    }
    createGain() {
        return {
            gain: { setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} },
            connect: (node: unknown) => node
        }
    }
    createOscillator() {
        let frequency = 0
        const oscillator = {
            type: "sine" as OscillatorType,
            frequency: {
                setValueAtTime: (value: number) => {
                    frequency = value
                },
                exponentialRampToValueAtTime() {}
            },
            connect: (node: unknown) => node,
            start: () => voices.push({ type: oscillator.type, frequency }),
            stop() {}
        }
        return oscillator
    }
}
// The coin clink is a sine at 1046.5Hz (see sfx.ts / sfxWiring.spec).
const playedCoin = () => voices.some((voice) => voice.type === "sine" && voice.frequency === 1046.5)

// React Flow wraps each node in a div carrying data-id; our node root also has data-state (linked-node
// chips carry data-linked-node instead), so [data-id][data-state] targets a node card specifically.
const nodeRoot = (id: string) => document.querySelector(`[data-id="${id}"][data-state]`) as HTMLElement | null
const waitForNode = (id: string) =>
    waitFor(() => {
        const el = nodeRoot(id)
        if (!el) throw new Error(`node ${id} not mounted yet`)
        return el
    })

const openShop = () => fireEvent.click(screen.getByRole("button", { name: "Rewards" }))
const openTasksView = () => fireEvent.click(screen.getByRole("button", { name: "Tasks" }))
const openSampleTab = () => fireEvent.click(screen.getByRole("button", { name: "Learn Questline" }))

// The purse pill carries aria-label `N gold`; read the number back for balance assertions.
const purse = () => screen.getByTestId("purse")
const balance = () => Number((purse().getAttribute("aria-label") ?? "").replace(/ gold$/, ""))

// localStorage holds lz-string-compressed JSON now; unpack it to assert on the saved roadmap text.
const savedRoadmap = () => decompressFromUTF16(localStorage.getItem("questline:v4") ?? "") ?? ""

// Real wall-clock, captured before any Date.now spy so frozen-time tests can still let RTL's waitFor
// tick against real time when they aren't pinning the clock.
const realDateNow = Date.now.bind(Date)
// When null, Date.now flows from the real clock (so waitFor/findBy behave normally); a test sets this to
// pin the clock for redemption-date and 14-day-window assertions.
let mockNow: number | null = null
const setNow = (ms: number) => {
    mockNow = ms
}

// Complete the seed's finish-milestone leaf through the roadmap UI (+3 gold). Leaves the sample tab open.
async function completeFinishMilestone() {
    openSampleTab()
    const leaf = await waitForNode("finish-milestone")
    fireEvent.click(leaf)
    await screen.findByRole("heading", { name: /finish a milestone/i })
    fireEvent.click(screen.getByRole("button", { name: "Check Tick this box" }))
    fireEvent.click(screen.getByRole("button", { name: "Check Then tick this one" }))
    fireEvent.click(screen.getByRole("button", { name: "Mark Complete" }))
    await waitFor(() => expect(nodeRoot("finish-milestone")?.getAttribute("data-state")).toBe("mastered"))
}

// Post a task worth `reward` gold and check it off, minting `reward` into the purse. Leaves the Tasks view.
async function earnViaTask(text: string, reward = 1) {
    openTasksView()
    // The + tile adds a default task and opens its card in edit mode; name it (and set the reward), dismiss.
    fireEvent.click(await screen.findByRole("button", { name: "Add task" }))
    const card = await screen.findByTestId("task-detail-card")
    fireEvent.change(within(card).getByLabelText("Task name"), { target: { value: text } })
    if (reward !== 1) {
        fireEvent.change(within(card).getByLabelText("Reward in gold"), { target: { value: String(reward) } })
    }
    fireEvent.keyDown(document, { key: "Escape" })
    fireEvent.click(await screen.findByRole("button", { name: `Check ${text}` }))
    await screen.findByRole("button", { name: `Uncheck ${text}` })
}

// Add a reward: the shelf's + tile instantly creates a default reward and opens its card in edit mode;
// set the name / price (and optional auto-replenish), then dismiss. Assumes the shop is open.
async function addRewardViaCard(name: string, price: number, replenish = false) {
    fireEvent.click(screen.getByRole("button", { name: "Add a reward" }))
    const card = await screen.findByTestId("reward-detail-card")
    fireEvent.change(within(card).getByLabelText("Reward name"), { target: { value: name } })
    fireEvent.change(within(card).getByLabelText("Cost in gold"), { target: { value: String(price) } })
    if (replenish) fireEvent.click(within(card).getByRole("checkbox"))
    fireEvent.keyDown(document, { key: "Escape" })
    await screen.findByRole("button", { name: `Open ${name}` })
}

describe("Rewards & gold (e2e)", () => {
    beforeEach(() => {
        window.history.replaceState(null, "", window.location.pathname)
        localStorage.clear()
        mockNow = null
        vi.spyOn(Date, "now").mockImplementation(() => mockNow ?? realDateNow())
    })
    afterEach(() => {
        vi.restoreAllMocks()
        vi.unstubAllGlobals()
    })

    context("earning gold on the roadmap", () => {
        // Open the roadmap, select track-progress (available once finish-milestone is done), tick its box
        // and complete it. Assumes finish-milestone is already mastered.
        async function completeTrackProgress() {
            openSampleTab()
            const track = await waitForNode("track-progress")
            fireEvent.click(track)
            await screen.findByRole("heading", { name: /track your progress/i })
            fireEvent.click(screen.getByRole("button", { name: "Check Complete the step below first" }))
            fireEvent.click(screen.getByRole("button", { name: "Mark Complete" }))
            await waitFor(() => expect(nodeRoot("track-progress")?.getAttribute("data-state")).toBe("mastered"))
        }

        it("mints a milestone's reward into the purse when it is marked complete", async () => {
            render(<App />)
            await completeFinishMilestone() // finish-milestone reward is 3
            openShop()
            await screen.findByRole("button", { name: "Open Fancy coffee" })
            expect(balance()).toBe(BASE_GOLD + 3)
        })

        it("mints the larger root reward when a board's tier-0 root node is completed", async () => {
            render(<App />)
            await waitForNode("learn")

            // A fresh board's root is a lone leaf worth the larger root reward (5); complete it.
            fireEvent.click(screen.getByRole("button", { name: "Add board" }))
            fireEvent.click(await screen.findByRole("button", { name: "Finish editing" }))
            fireEvent.click(await screen.findByRole("button", { name: "Complete Quest" }))

            openShop()
            await screen.findByRole("button", { name: "Open Fancy coffee" })
            expect(balance()).toBe(BASE_GOLD + 5)
        })

        it("adds each newly mastered milestone's reward, accumulating across the tree", async () => {
            render(<App />)
            await completeFinishMilestone() // +3
            await completeTrackProgress() // +3, on top of the first
            openShop()
            await screen.findByRole("button", { name: "Open Fancy coffee" })
            expect(balance()).toBe(BASE_GOLD + 3 + 3)
        })

        it("sums gold across every board, not just the active tab", async () => {
            render(<App />)
            await completeFinishMilestone() // earned in the seed board (+3)

            // Add a second board and complete its root node (a lone leaf, +5). The purse counts both.
            fireEvent.click(screen.getByRole("button", { name: "Add board" }))
            fireEvent.click(await screen.findByRole("button", { name: "Finish editing" }))
            fireEvent.click(await screen.findByRole("button", { name: "Complete Quest" }))

            openShop()
            await screen.findByRole("button", { name: "Open Fancy coffee" })
            expect(balance()).toBe(BASE_GOLD + 3 + 5)
        })

        it("does not add gold while a milestone stays available or locked (only on complete)", async () => {
            render(<App />)
            openSampleTab()
            const leaf = await waitForNode("finish-milestone")
            fireEvent.click(leaf)
            await screen.findByRole("heading", { name: /finish a milestone/i })

            // Tick both boxes but do NOT mark complete: the milestone is still merely available.
            fireEvent.click(screen.getByRole("button", { name: "Check Tick this box" }))
            fireEvent.click(screen.getByRole("button", { name: "Check Then tick this one" }))
            expect(nodeRoot("finish-milestone")?.getAttribute("data-state")).toBe("available")

            openShop()
            await screen.findByRole("button", { name: "Open Fancy coffee" })
            expect(balance()).toBe(BASE_GOLD)
        })

        it("removes a milestone's reward from the purse when it is un-completed", async () => {
            render(<App />)
            await completeFinishMilestone() // +3
            openShop()
            await screen.findByRole("button", { name: "Open Fancy coffee" })
            expect(balance()).toBe(BASE_GOLD + 3)

            // Re-select the milestone and mark it incomplete: its reward leaves the purse.
            openSampleTab()
            fireEvent.click(await waitForNode("finish-milestone"))
            await screen.findByRole("heading", { name: /finish a milestone/i })
            fireEvent.click(screen.getByRole("button", { name: "Mark Incomplete" }))

            openShop()
            await waitFor(() => expect(balance()).toBe(BASE_GOLD))
        })

        it("drops the whole cascade's gold when un-completing un-masters ancestors too", async () => {
            render(<App />)
            await completeFinishMilestone() // +3
            await completeTrackProgress() // +3 (track-progress is finish-milestone's parent)
            openShop()
            await screen.findByRole("button", { name: "Open Fancy coffee" })
            expect(balance()).toBe(BASE_GOLD + 6)

            // Un-completing the leaf cascades up: its mastered parent track-progress drops too, so BOTH
            // rewards leave the purse, not just the leaf's.
            openSampleTab()
            fireEvent.click(await waitForNode("finish-milestone"))
            await screen.findByRole("heading", { name: /finish a milestone/i })
            fireEvent.click(screen.getByRole("button", { name: "Mark Incomplete" }))
            await waitFor(() => expect(nodeRoot("track-progress")?.getAttribute("data-state")).not.toBe("mastered"))

            openShop()
            await waitFor(() => expect(balance()).toBe(BASE_GOLD))
        })

        it("reclaims a completed parent's gold when a fresh incomplete child un-completes it", async () => {
            render(<App />)
            openSampleTab()
            const step = await waitForNode("break-steps")
            expect(step.getAttribute("data-state")).toBe("mastered") // seed ships it complete (+3, the base)

            // Adding a fresh, incomplete child un-completes the parent, reclaiming its already-minted gold.
            fireEvent.click(step)
            await screen.findByRole("heading", { name: /break it into steps/i })
            fireEvent.click(screen.getByRole("button", { name: "Edit" }))
            fireEvent.click(screen.getByRole("button", { name: "Add child node" }))
            await waitFor(() => expect(nodeRoot("break-steps")?.getAttribute("data-state")).not.toBe("mastered"))

            openShop()
            await waitFor(() => expect(balance()).toBe(BASE_GOLD - 3))
        })

        it("loses a mastered node's gold when that node (or its subtree) is deleted", async () => {
            render(<App />)
            openSampleTab()
            const step = await waitForNode("break-steps")
            expect(step.getAttribute("data-state")).toBe("mastered")

            fireEvent.click(step)
            await screen.findByRole("heading", { name: /break it into steps/i })
            fireEvent.click(screen.getByRole("button", { name: "Edit" }))
            fireEvent.click(screen.getByRole("button", { name: "Delete node" }))
            fireEvent.click(await screen.findByRole("button", { name: "Delete" }))
            await waitFor(() => expect(nodeRoot("break-steps")).toBeNull())

            openShop()
            await waitFor(() => expect(balance()).toBe(BASE_GOLD - 3))
        })
    })

    context("earning gold from the Tasks list", () => {
        it("adds a task's reward to the purse when it is checked off", async () => {
            render(<App />)
            openTasksView()
            fireEvent.click(await screen.findByRole("button", { name: /^Check Tick a task/ }))
            await screen.findByRole("button", { name: /^Uncheck Tick a task/ })

            openShop()
            await screen.findByRole("button", { name: "Open Fancy coffee" })
            expect(balance()).toBe(BASE_GOLD + 1)
        })

        it("removes that reward when the task is unchecked again", async () => {
            render(<App />)
            openTasksView()
            fireEvent.click(await screen.findByRole("button", { name: /^Check Tick a task/ }))
            fireEvent.click(await screen.findByRole("button", { name: /^Uncheck Tick a task/ }))
            await screen.findByRole("button", { name: /^Check Tick a task/ })

            openShop()
            await screen.findByRole("button", { name: "Open Fancy coffee" })
            expect(balance()).toBe(BASE_GOLD)
        })

        it("keeps the balance when a done task is deleted (banks the earn)", async () => {
            render(<App />)
            await earnViaTask("Chore", 2) // balance BASE_GOLD + 2
            openShop()
            await waitFor(() => expect(balance()).toBe(BASE_GOLD + 2))

            // Delete the done task from its card; its earned gold is banked, so the balance holds.
            openTasksView()
            fireEvent.click(await screen.findByRole("button", { name: "Open Chore" }))
            fireEvent.click(await screen.findByRole("button", { name: "Edit" }))
            fireEvent.click(screen.getByRole("button", { name: "Delete task" }))
            fireEvent.click(await screen.findByRole("button", { name: "Delete" }))
            await waitFor(() => expect(screen.queryByRole("button", { name: "Open Chore" })).toBeNull())

            openShop()
            expect(balance()).toBe(BASE_GOLD + 2)
        })

        it("keeps earned gold when a completed task ages off the board after 14 days", async () => {
            const start = Date.UTC(2026, 6, 9, 12)
            setNow(start)
            render(<App />)
            openTasksView()
            fireEvent.click(await screen.findByRole("button", { name: /^Check Tick a task/ }))
            await screen.findByRole("button", { name: /^Uncheck Tick a task/ })

            // Jump past the 14-day window: the completed task drops off the board...
            setNow(start + DONE_TTL_MS + 1)
            openShop()
            openTasksView()
            await waitFor(() => expect(screen.queryByText(/^Tick a task/)).toBeNull())

            // ...but its earned gold is kept.
            openShop()
            await screen.findByRole("button", { name: "Open Fancy coffee" })
            expect(balance()).toBe(BASE_GOLD + 1)
        })

        it("combines task gold with roadmap gold in a single purse total", async () => {
            render(<App />)
            await completeFinishMilestone() // +3 roadmap gold
            await earnViaTask("Chore", 2) // +2 task gold

            openShop()
            await screen.findByRole("button", { name: "Open Fancy coffee" })
            expect(balance()).toBe(BASE_GOLD + 3 + 2)
        })
    })

    context("the purse", () => {
        it("seeds a fresh install's purse from the sample roadmap's one pre-completed milestone", async () => {
            render(<App />)
            openShop()
            await screen.findByRole("button", { name: "Open Fancy coffee" })
            expect(balance()).toBe(BASE_GOLD)
        })

        it("shows earned minus spent as the live balance", async () => {
            render(<App />)
            await earnViaTask("Earn five", 5) // 3 + 5 = 8 earned
            openShop()
            await screen.findByRole("button", { name: "Open Fancy coffee" })
            expect(balance()).toBe(8)

            // Redeem Fancy coffee (3): balance is earned(8) - spent(3) = 5.
            fireEvent.click(screen.getByRole("button", { name: "Redeem Fancy coffee" }))
            await waitFor(() => expect(balance()).toBe(5))
        })

        it("exposes the balance to assistive tech via its `N gold` label", async () => {
            render(<App />)
            openShop()
            await screen.findByRole("button", { name: "Open Fancy coffee" })
            expect(purse()).toHaveAttribute("aria-label", `${BASE_GOLD} gold`)
        })

        it("updates the balance the moment gold is earned or spent, without a reload", async () => {
            render(<App />)
            openShop()
            await screen.findByRole("button", { name: "Open Fancy coffee" })
            expect(balance()).toBe(BASE_GOLD)

            // Redeeming spends immediately...
            fireEvent.click(screen.getByRole("button", { name: "Redeem Fancy coffee" }))
            await waitFor(() => expect(balance()).toBe(0))
        })
    })

    context("redeeming a reward (spending)", () => {
        it("spends the reward's price and lowers the purse by exactly that amount", async () => {
            render(<App />)
            await earnViaTask("Coins", 5) // 3 + 5 = 8
            openShop()
            await screen.findByRole("button", { name: "Open Fancy coffee" })
            expect(balance()).toBe(8)

            fireEvent.click(screen.getByRole("button", { name: "Redeem Fancy coffee" }))
            await waitFor(() => expect(balance()).toBe(5)) // lowered by exactly the price (3)
        })

        it("stamps the tile as redeemed, showing the redemption date", async () => {
            const t = Date.UTC(2026, 6, 9, 12)
            setNow(t)
            render(<App />)
            openShop()
            fireEvent.click(await screen.findByRole("button", { name: "Redeem Fancy coffee" }))

            const stamped = new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" })
            expect(await screen.findByText(`Redeemed ${stamped}`)).toBeInTheDocument()
        })

        it("keeps a redeemed tile openable for edits, with no re-redeem or tile-remove control", async () => {
            render(<App />)
            openShop()
            fireEvent.click(await screen.findByRole("button", { name: "Redeem Fancy coffee" }))
            await screen.findByText(/^Redeemed /)

            // The tile stays on the shelf, with no re-redeem and no tile-level remove...
            expect(document.querySelector('[data-reward-id="reward-1"]')).not.toBeNull()
            expect(screen.queryByRole("button", { name: "Redeem Fancy coffee" })).toBeNull()
            expect(screen.queryByRole("button", { name: "Remove Fancy coffee" })).toBeNull()
            // ...but it opens the detail card for edits, like any other reward.
            fireEvent.click(screen.getByRole("button", { name: "Open Fancy coffee" }))
            expect(await screen.findByTestId("reward-detail-card")).toBeInTheDocument()
        })

        it("plays the coin sound only when the redemption actually goes through", async () => {
            voices = []
            vi.stubGlobal("AudioContext", FakeAudioContext)
            render(
                <SfxProvider>
                    <App />
                </SfxProvider>
            )

            // Opening the shop is plain navigation: no coin.
            openShop()
            await screen.findByRole("button", { name: "Redeem Fancy coffee" })
            expect(playedCoin()).toBe(false)

            // A redemption that goes through (Fancy coffee is affordable at the base balance) rings the coin.
            fireEvent.click(screen.getByRole("button", { name: "Redeem Fancy coffee" }))
            expect(playedCoin()).toBe(true)
        })

        it("allows a redemption when the balance exactly equals the price", async () => {
            render(<App />)
            openShop()
            // Fresh balance is exactly Fancy coffee's price (3), so it is redeemable, not gated.
            const redeem = await screen.findByRole("button", { name: "Redeem Fancy coffee" })
            expect(redeem).toBeEnabled()

            fireEvent.click(redeem)
            await waitFor(() => expect(balance()).toBe(0))
        })

        it("lets several rewards be redeemed until the purse can no longer afford the next", async () => {
            render(<App />)
            await earnViaTask("Coins", 8) // 3 + 8 = 11
            openShop()
            await screen.findByRole("button", { name: "Open Fancy coffee" })

            fireEvent.click(screen.getByRole("button", { name: "Redeem Fancy coffee" })) // 11 - 3 = 8
            fireEvent.click(await screen.findByRole("button", { name: "Redeem Takeout dinner" })) // 8 - 8 = 0
            await waitFor(() => expect(balance()).toBe(0))

            // Movie night (12) can no longer be afforded, so its Redeem is gated.
            expect(screen.getByRole("button", { name: "Redeem Movie night" })).toBeDisabled()
        })

        it("un-redeems from the detail card, returning the gold", async () => {
            render(<App />)
            openShop()
            fireEvent.click(await screen.findByRole("button", { name: "Redeem Fancy coffee" })) // 3 -> 0
            await screen.findByText(/^Redeemed /)
            expect(balance()).toBe(0)

            // Open the redeemed tile and un-redeem from the card.
            fireEvent.click(screen.getByRole("button", { name: "Open Fancy coffee" }))
            fireEvent.click(await screen.findByRole("button", { name: "Unredeem" }))

            // The gold is back and the tile is redeemable again.
            await waitFor(() => expect(balance()).toBe(BASE_GOLD))
            expect(await screen.findByRole("button", { name: "Redeem Fancy coffee" })).toBeEnabled()
        })
    })

    context("affordability gating", () => {
        it("disables Redeem and shows `Need N more` when gold is below the price", async () => {
            render(<App />)
            openShop()
            const takeout = await screen.findByRole("button", { name: "Redeem Takeout dinner" })
            expect(takeout).toBeDisabled()
            expect(takeout).toHaveTextContent("Need 5 more") // price 8 - balance 3
        })

        it("counts down `Need N more` as gold is earned toward the price", async () => {
            render(<App />)
            openShop()
            expect(await screen.findByRole("button", { name: "Redeem Takeout dinner" })).toHaveTextContent("Need 5 more")

            await earnViaTask("Coins", 2) // balance 3 -> 5
            openShop()
            expect(await screen.findByRole("button", { name: "Redeem Takeout dinner" })).toHaveTextContent("Need 3 more")
        })

        it("flips a locked tile to redeemable the instant the balance reaches the price", async () => {
            render(<App />)
            openShop()
            expect(await screen.findByRole("button", { name: "Redeem Takeout dinner" })).toBeDisabled()

            await earnViaTask("Coins", 5) // balance 3 -> 8, exactly Takeout's price
            openShop()
            expect(await screen.findByRole("button", { name: "Redeem Takeout dinner" })).toBeEnabled()
        })

        it("re-locks other tiles once a redemption spends the balance back below their price", async () => {
            render(<App />)
            await earnViaTask("Coins", 5) // balance 8
            openShop()
            expect(await screen.findByRole("button", { name: "Redeem Takeout dinner" })).toBeEnabled()

            // Spend on Fancy coffee (3): balance drops to 5, so Takeout (8) locks again.
            fireEvent.click(screen.getByRole("button", { name: "Redeem Fancy coffee" }))
            await waitFor(() => expect(screen.getByRole("button", { name: "Redeem Takeout dinner" })).toBeDisabled())
            expect(screen.getByRole("button", { name: "Redeem Takeout dinner" })).toHaveTextContent("Need 3 more")
        })

        it("re-evaluates affordability when a reward's price is edited", async () => {
            render(<App />)
            openShop()
            expect(await screen.findByRole("button", { name: "Redeem Takeout dinner" })).toBeDisabled()

            // Drop Takeout's price to within the base balance (3) via its detail card; it turns redeemable.
            fireEvent.click(screen.getByRole("button", { name: "Open Takeout dinner" }))
            fireEvent.click(await screen.findByRole("button", { name: "Edit" }))
            fireEvent.change(screen.getByLabelText("Cost in gold"), { target: { value: "2" } })

            await waitFor(() => expect(screen.getByRole("button", { name: "Redeem Takeout dinner" })).toBeEnabled())
        })
    })

    context("auto-replenishing rewards", () => {
        it("marks a replenish reward with the recurring badge on its tile", async () => {
            render(<App />)
            openShop()
            await addRewardViaCard("Latte", 2, true)
            expect(await screen.findByTitle("Auto-replenishes")).toBeInTheDocument()
        })

        it("restocks a fresh unredeemed copy right after a replenish reward is redeemed", async () => {
            render(<App />)
            openShop()
            await addRewardViaCard("Latte", 2, true) // affordable at the base balance (3)
            fireEvent.click(screen.getByRole("button", { name: "Redeem Latte" }))

            // The spent copy is stamped redeemed, and a fresh, unredeemed copy is dropped back on the shelf.
            // Both are openable now, so two Open Latte tiles are present.
            await screen.findByText(/^Redeemed /)
            expect(screen.getAllByRole("button", { name: "Open Latte" })).toHaveLength(2)
        })

        it("keeps the spent copy on the shelf lingering out its window beside the restock", async () => {
            render(<App />)
            openShop()
            await addRewardViaCard("Latte", 2, true)
            fireEvent.click(screen.getByRole("button", { name: "Redeem Latte" }))
            await screen.findByText(/^Redeemed /)

            // Both are present at once: the spent copy (redeemed, lingering) and the restocked copy. Both
            // open now, so there is one Redeemed label beside two Open Latte tiles.
            expect(screen.getByText(/^Redeemed /)).toBeInTheDocument()
            expect(screen.getAllByRole("button", { name: "Open Latte" })).toHaveLength(2)
        })

        it("lets a replenish reward be redeemed again once the balance covers it", async () => {
            render(<App />)
            openShop()
            await addRewardViaCard("Latte", 2, true)
            fireEvent.click(screen.getByRole("button", { name: "Redeem Latte" })) // balance 3 -> 1, restock unaffordable
            await screen.findByText(/^Redeemed /)

            await earnViaTask("Coins", 2) // balance 1 -> 3, restock affordable again
            openShop()
            fireEvent.click(await screen.findByRole("button", { name: "Redeem Latte" }))

            // Two copies are now spent (2 x 2 gold), leaving earned(5) - spent(4) = 1.
            await waitFor(() => expect(screen.getAllByText(/^Redeemed /)).toHaveLength(2))
            expect(balance()).toBe(1)
        })

        it("does not restock a copy for a plain (non-replenish) reward", async () => {
            render(<App />)
            openShop()
            fireEvent.click(await screen.findByRole("button", { name: "Redeem Fancy coffee" }))
            await screen.findByText(/^Redeemed /)

            // Only the one spent tile remains (openable now); no fresh copy respawns, so exactly one.
            expect(screen.getAllByRole("button", { name: "Open Fancy coffee" })).toHaveLength(1)
            expect(screen.getAllByText("Fancy coffee")).toHaveLength(1)
        })
    })

    context("adding a reward", () => {
        it("creates a default reward and opens it in edit mode from the dashed add tile", async () => {
            render(<App />)
            openShop()
            fireEvent.click(await screen.findByRole("button", { name: "Add a reward" }))
            // A default reward lands on the shelf, its card open in edit mode (the name field is live).
            expect(await screen.findByRole("button", { name: "Open New Reward" })).toBeInTheDocument()
            const card = await screen.findByTestId("reward-detail-card")
            expect(within(card).getByLabelText("Reward name")).toBeInTheDocument()
        })

        it("adds a named, priced reward via the card", async () => {
            render(<App />)
            openShop()
            await addRewardViaCard("Sushi", 4)
            expect(screen.getByRole("button", { name: "Open Sushi" })).toBeInTheDocument()
        })

        it("coerces the price to a whole number of at least 1", async () => {
            render(<App />)
            openShop()
            await addRewardViaCard("Round", 2.6) // -> 3
            await addRewardViaCard("Floor", 0) // -> 1

            // Ids are random now, so find each tile by its name (the Open button lives inside the tile).
            const roundTile = screen.getByRole("button", { name: "Open Round" }).closest("[data-reward-id]") as HTMLElement
            const floorTile = screen.getByRole("button", { name: "Open Floor" }).closest("[data-reward-id]") as HTMLElement
            expect(within(roundTile).getByText("3")).toBeInTheDocument()
            expect(within(floorTile).getByText("1")).toBeInTheDocument()
        })

        it("creates an auto-replenishing reward when the checkbox is ticked", async () => {
            render(<App />)
            openShop()
            await addRewardViaCard("Latte", 2, true)
            expect(await screen.findByTitle("Auto-replenishes")).toBeInTheDocument()
        })

        it("keeps the new reward when its card is dismissed on Escape", async () => {
            render(<App />)
            openShop()
            fireEvent.click(await screen.findByRole("button", { name: "Add a reward" }))
            await screen.findByTestId("reward-detail-card")
            fireEvent.keyDown(document, { key: "Escape" })
            // Instant-create persists: the reward stays on the shelf even without editing.
            expect(await screen.findByRole("button", { name: "Open New Reward" })).toBeInTheDocument()
        })

        it("persists a just-created reward across leaving and returning to the shop", async () => {
            render(<App />)
            openShop()
            fireEvent.click(await screen.findByRole("button", { name: "Add a reward" }))
            await screen.findByRole("button", { name: "Open New Reward" })

            openSampleTab()
            await waitForNode("learn")
            openShop()
            expect(await screen.findByRole("button", { name: "Open New Reward" })).toBeInTheDocument()
        })
    })

    context("removing a reward", () => {
        // Deletion lives only in the detail card now (no tile × ): open the card, Edit, then Delete reward.
        const openCardDelete = async () => {
            fireEvent.click(await screen.findByRole("button", { name: "Open Fancy coffee" }))
            fireEvent.click(await screen.findByRole("button", { name: "Edit" }))
            fireEvent.click(screen.getByRole("button", { name: "Delete reward" }))
        }

        it("asks for confirmation before deleting an unredeemed reward", async () => {
            render(<App />)
            openShop()
            await openCardDelete()
            expect(await screen.findByText("Remove this reward?")).toBeInTheDocument()
            expect(document.querySelector('[data-reward-id="reward-1"]')).not.toBeNull() // not yet removed
        })

        it("removes the reward from the shelf once the deletion is confirmed", async () => {
            render(<App />)
            openShop()
            await openCardDelete()
            fireEvent.click(await screen.findByRole("button", { name: "Remove" }))
            await waitFor(() => expect(screen.queryByRole("button", { name: "Open Fancy coffee" })).toBeNull())
        })

        it("keeps the reward when the confirm dialog is cancelled", async () => {
            render(<App />)
            openShop()
            await openCardDelete()
            await screen.findByText("Remove this reward?")
            fireEvent.click(screen.getByRole("button", { name: "Close" }))

            await waitFor(() => expect(screen.queryByText("Remove this reward?")).toBeNull())
            expect(screen.getByRole("button", { name: "Open Fancy coffee" })).toBeInTheDocument()
        })

        it("offers no tile-level remove affordance", async () => {
            render(<App />)
            openShop()
            await screen.findByRole("button", { name: "Open Fancy coffee" })
            expect(screen.queryByRole("button", { name: "Remove Fancy coffee" })).toBeNull()
        })

        it("leaves the purse balance unchanged when an unredeemed reward is removed", async () => {
            render(<App />)
            openShop()
            await screen.findByRole("button", { name: "Open Fancy coffee" })
            expect(balance()).toBe(BASE_GOLD)

            await openCardDelete()
            fireEvent.click(await screen.findByRole("button", { name: "Remove" }))
            await waitFor(() => expect(screen.queryByRole("button", { name: "Open Fancy coffee" })).toBeNull())
            expect(balance()).toBe(BASE_GOLD)
        })

        it("keeps the balance when a redeemed reward is deleted (banks the spend)", async () => {
            render(<App />)
            openShop()
            fireEvent.click(await screen.findByRole("button", { name: "Redeem Fancy coffee" })) // 3 -> 0
            await screen.findByText(/^Redeemed /)
            expect(balance()).toBe(0)

            // Delete the redeemed reward from its card; the spend is banked, so it never refunds.
            fireEvent.click(screen.getByRole("button", { name: "Open Fancy coffee" }))
            fireEvent.click(await screen.findByRole("button", { name: "Edit" }))
            fireEvent.click(screen.getByRole("button", { name: "Delete reward" }))
            fireEvent.click(await screen.findByRole("button", { name: "Remove" }))
            await waitFor(() => expect(screen.queryByRole("button", { name: "Open Fancy coffee" })).toBeNull())

            expect(balance()).toBe(0)
        })
    })

    context("the delete confirm modal", () => {
        it("stays open when the reward modal itself is clicked (only outside / x closes it)", async () => {
            render(<App />)
            openShop()
            fireEvent.click(await screen.findByRole("button", { name: "Open Fancy coffee" }))
            fireEvent.click(await screen.findByRole("button", { name: "Edit" }))
            fireEvent.click(screen.getByRole("button", { name: "Delete reward" }))
            const title = await screen.findByText("Remove this reward?")

            // A click inside the modal (a portal outside the card) must not start the card's dismissal.
            // Firing animationEnd would complete any exit that got triggered, so a caught bug unmounts here.
            fireEvent.pointerDown(title)
            fireEvent.animationEnd(screen.getByTestId("reward-detail-card"))
            expect(screen.getByText("Remove this reward?")).toBeInTheDocument()
        })

        it("stays open when the task modal itself is clicked", async () => {
            render(<App />)
            openTasksView()
            fireEvent.click(await screen.findByRole("button", { name: /^Open Tick a task/ }))
            fireEvent.click(await screen.findByRole("button", { name: "Edit" }))
            fireEvent.click(screen.getByRole("button", { name: "Delete task" }))
            const title = await screen.findByText("Delete this task?")

            fireEvent.pointerDown(title)
            fireEvent.animationEnd(screen.getByTestId("task-detail-card"))
            expect(screen.getByText("Delete this task?")).toBeInTheDocument()
        })
    })

    // Implemented (not todos): the reward detail-card UI. These drive <App /> and assert only card
    // behaviour (open / edit / delete / add-vs-edit), never gold or redeem math.
    context("the reward detail card", () => {
        beforeEach(() => {
            window.history.replaceState(null, "", window.location.pathname)
            localStorage.clear()
        })
        const openShop = () => fireEvent.click(screen.getByRole("button", { name: "Rewards" }))

        it("opens when a reward tile is clicked", async () => {
            render(<App />)
            openShop()
            await screen.findByRole("button", { name: "Open Fancy coffee" })

            // Click the tile body itself (not a control), which should open the card.
            fireEvent.click(document.querySelector('[data-reward-id="reward-1"]') as HTMLElement)
            const card = await screen.findByTestId("reward-detail-card")
            expect(within(card).getByRole("heading", { name: "Fancy coffee" })).toBeInTheDocument()
        })

        it("renames a reward live through the pencil", async () => {
            render(<App />)
            openShop()
            fireEvent.click(await screen.findByRole("button", { name: "Open Fancy coffee" }))
            fireEvent.click(await screen.findByRole("button", { name: "Edit" }))
            fireEvent.change(screen.getByLabelText("Reward name"), { target: { value: "Espresso" } })

            expect(await screen.findByRole("button", { name: "Open Espresso" })).toBeInTheDocument()
        })

        it("toggles auto-replenish on an existing reward", async () => {
            render(<App />)
            openShop()
            fireEvent.click(await screen.findByRole("button", { name: "Open Fancy coffee" }))
            fireEvent.click(await screen.findByRole("button", { name: "Edit" }))
            fireEvent.click(screen.getByRole("checkbox"))

            // The tile grows the auto-replenish badge (its svg carries this title).
            expect(await screen.findByTitle("Auto-replenishes")).toBeInTheDocument()
        })

        it("deletes a reward from its card", async () => {
            render(<App />)
            openShop()
            fireEvent.click(await screen.findByRole("button", { name: "Open Fancy coffee" }))
            fireEvent.click(await screen.findByRole("button", { name: "Edit" }))
            fireEvent.click(screen.getByRole("button", { name: "Delete reward" }))
            fireEvent.click(await screen.findByRole("button", { name: "Remove" }))

            await waitFor(() => expect(screen.queryByRole("button", { name: "Open Fancy coffee" })).toBeNull())
            expect(screen.queryByTestId("reward-detail-card")).toBeNull()
        })

        it("swaps the detail card to another reward when its tile is clicked", async () => {
            render(<App />)
            openShop()
            // Instant-create opens the new reward's card in edit mode...
            fireEvent.click(await screen.findByRole("button", { name: "Add a reward" }))
            const card = await screen.findByTestId("reward-detail-card")
            expect(within(card).getByLabelText("Reward name")).toHaveValue("New Reward")

            // ...and clicking a different tile swaps the card to that reward's read view.
            fireEvent.click(screen.getByRole("button", { name: "Open Fancy coffee" }))
            expect(await screen.findByRole("heading", { name: "Fancy coffee" })).toBeInTheDocument()
        })
    })

    context("the shelf lifecycle (14-day window)", () => {
        // Force a re-render of the shop so its visible() filter re-reads the (mocked) clock, without
        // touching gold: bounce out to the Tasks view and back.
        async function rerenderShop() {
            openTasksView()
            await screen.findByRole("button", { name: "Add task" })
            openShop()
            await screen.findByTestId("purse")
        }

        it("always shows unredeemed rewards regardless of age", async () => {
            const start = Date.UTC(2026, 6, 9, 12)
            setNow(start)
            render(<App />)
            openShop()
            await screen.findByRole("button", { name: "Open Fancy coffee" })

            // Jump far past the redeemed window; an unredeemed reward has no expiry, so it stays.
            setNow(start + REDEEMED_TTL_MS * 50)
            await rerenderShop()
            expect(screen.getByRole("button", { name: "Open Fancy coffee" })).toBeInTheDocument()
        })

        it("keeps a redeemed reward on the shelf for 14 days after purchase", async () => {
            const start = Date.UTC(2026, 6, 9, 12)
            setNow(start)
            render(<App />)
            openShop()
            fireEvent.click(await screen.findByRole("button", { name: "Redeem Fancy coffee" }))
            await screen.findByText(/^Redeemed /)

            // One second shy of the 14-day window: still on the shelf.
            setNow(start + REDEEMED_TTL_MS - 1000)
            await rerenderShop()
            expect(screen.getByText(/^Redeemed /)).toBeInTheDocument()
        })

        it("drops a redeemed reward off the shelf once its 14 days elapse", async () => {
            const start = Date.UTC(2026, 6, 9, 12)
            setNow(start)
            render(<App />)
            openShop()
            fireEvent.click(await screen.findByRole("button", { name: "Redeem Fancy coffee" }))
            await screen.findByText(/^Redeemed /)

            // Just past the window: the redeemed tile drops off the shelf.
            setNow(start + REDEEMED_TTL_MS + 1)
            await rerenderShop()
            expect(screen.queryByText(/^Redeemed /)).toBeNull()
            expect(document.querySelector('[data-reward-id="reward-1"]')).toBeNull()
        })

        it("still counts an aged-off redemption against the balance (no refund)", async () => {
            const start = Date.UTC(2026, 6, 9, 12)
            setNow(start)
            render(<App />)
            openShop()
            fireEvent.click(await screen.findByRole("button", { name: "Redeem Fancy coffee" })) // 3 -> 0
            await waitFor(() => expect(balance()).toBe(0))

            // After it ages off the shelf, the spend is not refunded: the balance is still 0, not back to 3.
            setNow(start + REDEEMED_TTL_MS + 1)
            await rerenderShop()
            expect(screen.queryByText(/^Redeemed /)).toBeNull()
            expect(balance()).toBe(0)
        })
    })

    context("balance rules", () => {
        it("subtracts a reward's full value when its work is un-completed, even if the purse goes negative", async () => {
            render(<App />)
            await earnViaTask("Work", 5) // earned 3 (base) + 5 = 8
            openShop()
            await addRewardViaCard("Splurge", 8)
            fireEvent.click(screen.getByRole("button", { name: "Redeem Splurge" })) // spent 8, balance 0
            await waitFor(() => expect(balance()).toBe(0))

            // Un-completing the work that funded it drops earned to 3, but the 8 spend stands: -5.
            openTasksView()
            fireEvent.click(await screen.findByRole("button", { name: "Uncheck Work" }))
            openShop()
            await waitFor(() => expect(balance()).toBe(-5))
        })

        it("keeps a redeemed reward bought for good: the spend is permanent", async () => {
            render(<App />)
            await earnViaTask("Work", 5) // earned 8
            openShop()
            await addRewardViaCard("Splurge", 8)
            fireEvent.click(screen.getByRole("button", { name: "Redeem Splurge" }))
            await screen.findByText(/^Redeemed /)

            // Even after the funding work is undone, the reward stays bought (redeemed) and un-redeemable.
            openTasksView()
            fireEvent.click(await screen.findByRole("button", { name: "Uncheck Work" }))
            openShop()
            expect(screen.getByText(/^Redeemed /)).toBeInTheDocument()
            expect(screen.queryByRole("button", { name: "Redeem Splurge" })).toBeNull()
        })

        it("restores a positive balance once new work out-earns the prior spend", async () => {
            render(<App />)
            await earnViaTask("Work", 5) // earned 8
            openShop()
            await addRewardViaCard("Splurge", 8)
            fireEvent.click(screen.getByRole("button", { name: "Redeem Splurge" }))
            openTasksView()
            fireEvent.click(await screen.findByRole("button", { name: "Uncheck Work" }))
            openShop()
            await waitFor(() => expect(balance()).toBe(-5)) // in the red

            // Fresh work that out-earns the 8 already spent brings the purse back into the black.
            await earnViaTask("Bounty", 6) // earned 3 (base) + 6 = 9, spent 8
            openShop()
            await waitFor(() => expect(balance()).toBe(1))
        })
    })

    context("persistence across a reload", () => {
        it("seeds the three starter rewards only on a truly fresh install", async () => {
            const first = render(<App />)
            openShop()
            await screen.findByRole("button", { name: "Open Fancy coffee" })
            expect(screen.getAllByRole("button", { name: /^Open / })).toHaveLength(3)

            // Remove one from its card, let it autosave, and remount: the saved shelf loads as-is (two
            // rewards), never re-seeded back to three.
            fireEvent.click(screen.getByRole("button", { name: "Open Movie night" }))
            fireEvent.click(await screen.findByRole("button", { name: "Edit" }))
            fireEvent.click(screen.getByRole("button", { name: "Delete reward" }))
            fireEvent.click(await screen.findByRole("button", { name: "Remove" }))
            await waitFor(() => expect(screen.queryByRole("button", { name: "Open Movie night" })).toBeNull())
            // Wait for the post-removal autosave specifically (kept rewards present, removed one gone), not
            // just any save -- the initial seed save also contains "Fancy coffee".
            await waitFor(
                () => {
                    const saved = savedRoadmap()
                    expect(saved).toContain("Fancy coffee")
                    expect(saved).not.toContain("Movie night")
                },
                { timeout: 2000 }
            )

            first.unmount()
            render(<App />)
            openShop()
            await screen.findByRole("button", { name: "Open Fancy coffee" })
            expect(screen.getAllByRole("button", { name: /^Open / })).toHaveLength(2)
            expect(screen.queryByRole("button", { name: "Open Movie night" })).toBeNull()
        })

        it("keeps a user's added rewards after a remount", async () => {
            const first = render(<App />)
            openShop()
            await addRewardViaCard("Sushi", 4)
            await waitFor(() => expect(savedRoadmap()).toContain("Sushi"), { timeout: 2000 })

            first.unmount()
            render(<App />)
            openShop()
            expect(await screen.findByRole("button", { name: "Open Sushi" })).toBeInTheDocument()
        })

        it("keeps redemptions (and thus spent gold) after a remount", async () => {
            setNow(Date.UTC(2026, 6, 9, 12))
            const first = render(<App />)
            openShop()
            fireEvent.click(await screen.findByRole("button", { name: "Redeem Fancy coffee" })) // balance 3 -> 0
            await screen.findByText(/^Redeemed /)
            await waitFor(() => expect(savedRoadmap()).toContain("redeemedAt"), { timeout: 2000 })

            first.unmount()
            render(<App />)
            openShop()
            // The redemption (and its spend) survive the reload.
            expect(await screen.findByText(/^Redeemed /)).toBeInTheDocument()
            expect(balance()).toBe(0)
        })

        it("recomputes earned gold from persisted roadmap and task progress on load", async () => {
            const first = render(<App />)
            await completeFinishMilestone() // +3 roadmap
            await earnViaTask("Chore", 2) // +2 task
            openShop()
            await waitFor(() => expect(balance()).toBe(BASE_GOLD + 5))
            await waitFor(() => expect(savedRoadmap()).toContain("Chore"), { timeout: 2000 })

            first.unmount()
            render(<App />)
            openShop()
            await screen.findByRole("button", { name: "Open Fancy coffee" })
            expect(balance()).toBe(BASE_GOLD + 5) // recomputed from the persisted mastered set + done task
        })

        it("compacts an aged completed task on reload: banks it, drops the record, holds the balance", async () => {
            const start = Date.UTC(2026, 0, 1, 12)
            setNow(start)
            const first = render(<App />)
            await earnViaTask("Old chore", 2) // completedAt stamped at `start`
            openShop()
            await waitFor(() => expect(balance()).toBe(BASE_GOLD + 2))
            await waitFor(() => expect(savedRoadmap()).toContain("Old chore"), { timeout: 2000 })

            // Age it past the 14-day window and reload: boot folds it into banked and drops the record.
            setNow(start + DONE_TTL_MS + 1)
            first.unmount()
            render(<App />)
            openShop()
            await screen.findByRole("button", { name: "Open Fancy coffee" })
            expect(balance()).toBe(BASE_GOLD + 2) // unchanged: banked covers the pruned task

            await waitFor(
                () => {
                    const saved = savedRoadmap()
                    expect(saved).not.toContain("Old chore") // record gone
                    expect(saved).toContain('"earned":2') // folded into banked
                },
                { timeout: 2000 }
            )
            openTasksView()
            expect(screen.queryByRole("button", { name: "Open Old chore" })).toBeNull()
        })
    })

    context("navigating between views", () => {
        it("carries the same purse balance between the roadmap, Tasks, and Rewards views", async () => {
            render(<App />)
            await completeFinishMilestone() // earned 6

            openShop()
            await screen.findByRole("button", { name: "Open Fancy coffee" })
            expect(balance()).toBe(6)

            // Bounce through Tasks and the roadmap; the purse reads the same each time we return.
            openTasksView()
            await screen.findByRole("button", { name: "Add task" })
            openShop()
            expect(balance()).toBe(6)

            openSampleTab()
            await waitForNode("learn")
            openShop()
            expect(balance()).toBe(6)
        })

        it("shows gold earned on the roadmap immediately after switching to Rewards", async () => {
            render(<App />)
            await completeFinishMilestone() // +3 on the roadmap
            openShop()
            await screen.findByRole("button", { name: "Open Fancy coffee" })
            expect(balance()).toBe(BASE_GOLD + 3)
        })

        it("shows gold earned in Tasks immediately after switching to Rewards", async () => {
            render(<App />)
            openTasksView()
            fireEvent.click(await screen.findByRole("button", { name: /^Check Tick a task/ }))
            await screen.findByRole("button", { name: /^Uncheck Tick a task/ })

            openShop()
            await screen.findByRole("button", { name: "Open Fancy coffee" })
            expect(balance()).toBe(BASE_GOLD + 1)
        })
    })
})

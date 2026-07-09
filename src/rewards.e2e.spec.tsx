describe("Rewards & gold (e2e)", () => {
    context("earning gold on the roadmap", () => {
        it.todo("mints a milestone's reward into the purse when it is marked complete")
        it.todo("mints the larger goal reward when a tab's tier-0 goal is completed")
        it.todo("adds each newly mastered milestone's reward, accumulating across the tree")
        it.todo("sums gold across every roadmap/view, not just the active tab")
        it.todo("never mints gold for the Root hub node")
        it.todo("does not add gold while a milestone stays available or locked (only on complete)")
        it.todo("removes a milestone's reward from the purse when it is un-completed")
        it.todo("drops the whole cascade's gold when un-completing un-masters ancestors too")
        it.todo("reclaims a completed parent's gold when a fresh incomplete child un-completes it")
        it.todo("loses a mastered node's gold when that node (or its subtree) is deleted")
    })

    context("earning gold from the Tasks list", () => {
        it.todo("adds a task's reward to the purse when it is checked off")
        it.todo("removes that reward when the task is unchecked again")
        it.todo("keeps earned gold when a completed task ages off the board after 14 days")
        it.todo("loses a done task's reward when the task is deleted")
        it.todo("combines task gold with roadmap gold in a single purse total")
    })

    context("the purse", () => {
        it.todo("shows zero gold on a fresh install before any work is done")
        it.todo("shows earned minus spent as the live balance")
        it.todo("exposes the balance to assistive tech via its `N gold` label")
        it.todo("updates the balance the moment gold is earned or spent, without a reload")
    })

    context("redeeming a reward (spending)", () => {
        it.todo("spends the reward's price and lowers the purse by exactly that amount")
        it.todo("stamps the tile as redeemed, showing the redemption date")
        it.todo("keeps the redeemed tile on the shelf but strips its Redeem and Remove actions")
        it.todo("plays the coin sound only when the redemption actually goes through")
        it.todo("allows a redemption when the balance exactly equals the price")
        it.todo("lets several rewards be redeemed until the purse can no longer afford the next")
    })

    context("affordability gating", () => {
        it.todo("disables Redeem and shows `Need N more` when gold is below the price")
        it.todo("counts down `Need N more` as gold is earned toward the price")
        it.todo("flips a locked tile to redeemable the instant the balance reaches the price")
        it.todo("re-locks other tiles once a redemption spends the balance back below their price")
        it.todo("re-evaluates affordability when a reward's price is edited")
    })

    context("auto-replenishing rewards", () => {
        it.todo("marks a replenish reward with the recurring badge on its tile")
        it.todo("restocks a fresh unredeemed copy right after a replenish reward is redeemed")
        it.todo("keeps the spent copy on the shelf lingering out its window beside the restock")
        it.todo("lets a replenish reward be redeemed again once the balance covers it")
        it.todo("does not restock a copy for a plain (non-replenish) reward")
    })

    context("adding a reward", () => {
        it.todo("opens the New reward card from the dashed add tile")
        it.todo("adds a named, priced reward to the shelf and closes the card")
        it.todo("ignores a blank / whitespace-only name")
        it.todo("coerces the price to a whole number of at least 1")
        it.todo("creates an auto-replenishing reward when the checkbox is ticked")
        it.todo("dismisses the card on Escape and on a click outside it")
        it.todo("discards the unsubmitted card when leaving the Rewards view")
    })

    context("removing a reward", () => {
        it.todo("asks for confirmation before deleting an unredeemed reward")
        it.todo("removes the reward from the shelf once the deletion is confirmed")
        it.todo("keeps the reward when the confirm dialog is cancelled")
        it.todo("offers no remove affordance on a redeemed tile")
        it.todo("leaves the purse balance unchanged when an unredeemed reward is removed")
    })

    context("the shelf lifecycle (14-day window)", () => {
        it.todo("always shows unredeemed rewards regardless of age")
        it.todo("keeps a redeemed reward on the shelf for 14 days after purchase")
        it.todo("drops a redeemed reward off the shelf once its 14 days elapse")
        it.todo("still counts an aged-off redemption against the balance (no refund)")
    })

    context("balance rules", () => {
        it.todo("subtracts a reward's full value when its work is un-completed, even if the purse goes negative")
        it.todo("keeps a redeemed reward bought for good: the spend is permanent")
        it.todo("restores a positive balance once new work out-earns the prior spend")
    })

    context("persistence across a reload", () => {
        it.todo("seeds the three starter rewards only on a truly fresh install")
        it.todo("keeps a user's added rewards after a remount")
        it.todo("keeps redemptions (and thus spent gold) after a remount")
        it.todo("recomputes earned gold from persisted roadmap and task progress on load")
    })

    context("navigating between views", () => {
        it.todo("carries the same purse balance between the roadmap, Tasks, and Rewards views")
        it.todo("shows gold earned on the roadmap immediately after switching to Rewards")
        it.todo("shows gold earned in Tasks immediately after switching to Rewards")
    })
})

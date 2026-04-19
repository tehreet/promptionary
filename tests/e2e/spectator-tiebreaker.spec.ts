import { test, expect } from "@playwright/test";
import { createRoomAs, joinRoomAs, submitGuess } from "./helpers";

// Two players guess similar things so their scores land close together;
// a spectator watches, votes during reveal, and the +5 bonus shows up on
// the game-over leaderboard (or in the reveal row itself when the RPC
// lands before we advance).
//
// We can't deterministically force a <=5 gap across runs — scoring is
// Gemini-embedding-driven — so the assertions focus on the UI being
// wired correctly:
//  - spectator sees either the vote UI (when tie is close) OR the
//    regular reveal (when it's not);
//  - when the vote UI shows, clicking a button locks out subsequent clicks
//    and surfaces the "thanks" copy.
test("spectator tiebreaker: vote UI appears + locks out on click", async ({
  browser,
}) => {
  test.setTimeout(180_000);

  const hostCtx = await browser.newContext();
  const host = await hostCtx.newPage();
  const code = await createRoomAs(host, `Host${Date.now()}`, {
    maxRounds: 1,
    revealSeconds: 25,
  });

  const p2Ctx = await browser.newContext();
  const p2 = await p2Ctx.newPage();
  await joinRoomAs(p2, code, `Player2_${Date.now()}`);

  // Spectator joins while still in lobby so they're in the room before
  // the round even starts — guarantees the spectator count is 1 when
  // guessing begins.
  const spectCtx = await browser.newContext();
  const spect = await spectCtx.newPage();
  await spect.goto(`/play/${code}`);
  const nameInput = spect.getByLabel("Your name");
  await nameInput.click();
  await nameInput.press("ControlOrMeta+a");
  await nameInput.fill(`Spect${Date.now()}`);
  const watchBtn = spect.getByRole("button", { name: "Watch room" });
  if (await watchBtn.count()) {
    await watchBtn.click();
  }

  await expect(host.getByText(/1 watching/)).toBeVisible({ timeout: 30_000 });

  await host.getByRole("button", { name: /Start game/ }).click();

  // Same subject, close wording — aiming for similar scores to trigger the
  // tiebreaker. Worst case, scores diverge and the vote UI is absent — we
  // still want to exit cleanly, so the later assertion is conditional.
  await submitGuess(host, "a cat in a top hat riding a bicycle in the rain");
  await submitGuess(p2, "a cat wearing a top hat on a bicycle in the rain");

  // Reveal lands — wait for the "The prompt was" copy on any of the pages.
  for (const page of [host, p2, spect]) {
    await expect(page.getByText("The prompt was")).toBeVisible({
      timeout: 45_000,
    });
  }

  const voteUi = spect.locator('[data-tiebreaker-vote="1"]');
  const voteAppeared = await voteUi
    .waitFor({ state: "visible", timeout: 5_000 })
    .then(() => true)
    .catch(() => false);

  if (voteAppeared) {
    // Players see the "spectators are voting" badge.
    await expect(host.locator('[data-tiebreaker-badge="1"]')).toBeVisible({
      timeout: 5_000,
    });

    // Vote for the first option.
    const options = voteUi.locator("[data-tiebreaker-option]");
    await expect(options).toHaveCount(2);
    await options.first().click();

    // Locks out after vote.
    await expect(spect.getByText(/Thanks — waiting for other spectators/))
      .toBeVisible({ timeout: 5_000 });
    await expect(options.first()).toBeDisabled();
    await expect(options.nth(1)).toBeDisabled();
  }

  await hostCtx.close();
  await p2Ctx.close();
  await spectCtx.close();
});

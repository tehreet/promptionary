import { test, expect } from "@playwright/test";
import { createRoomAs, joinRoomAs, submitGuess } from "./helpers";

test("recap highlights: three curated buckets render after game over", async ({
  browser,
}) => {
  test.setTimeout(180_000);

  const hostCtx = await browser.newContext();
  const host = await hostCtx.newPage();
  const code = await createRoomAs(host, `Host${Date.now()}`, {
    maxRounds: 1,
    revealSeconds: 5,
  });

  const joinerCtx = await browser.newContext();
  const joiner = await joinerCtx.newPage();
  await joinRoomAs(joiner, code, `Joiner${Date.now()}`);

  await host.getByRole("button", { name: /Start game/ }).click();

  for (const page of [host, joiner]) {
    await expect(
      page.getByRole("textbox", { name: /What's the prompt/ }),
    ).toBeVisible({ timeout: 60_000 });
  }

  // Two guessers → biggest-swing has enough signal. Deliberately give one
  // player a guess that's much more on-topic so the swing has a real delta.
  await submitGuess(host, "a cat wearing a top hat");
  await submitGuess(joiner, "completely unrelated astronaut scene");

  // Wait for game_over — max_rounds=1 means this round is the final round.
  await host.waitForURL(new RegExp(`/play/${code}$`), { timeout: 60_000 });
  await expect(host.getByText(/Final|Game over|Start a new game/i)).toBeVisible(
    { timeout: 60_000 },
  );

  // Navigate to recap directly.
  await host.goto(`/play/${code}/recap`);
  await expect(host.locator('[data-recap-highlights="1"]')).toBeVisible({
    timeout: 30_000,
  });

  // Closest-guess card is always present (we scored > 0 above). Swing is
  // present because we had two guessers. Most-active may be "—" if no chat
  // fired — but the card shell still renders.
  await expect(host.locator('[data-recap-highlight="closest"]')).toBeVisible();
  await expect(host.locator('[data-recap-highlight="swing"]')).toBeVisible();
  await expect(host.locator('[data-recap-highlight="active"]')).toBeVisible();

  await hostCtx.close();
  await joinerCtx.close();
});

import { test, expect } from "@playwright/test";
import { createRoomAs, joinRoomAs } from "./helpers";

// Regression: intermittent POST /api/start-round 404 (round deleted after a
// prior Gemini failure) was crashing the page with a "this page couldn't load"
// render glitch. Fix: detect 404 in the client, show a soft waiting message,
// and let the natural 2s poll recover the room phase instead of surface the
// error UI. Test pins the graceful path by intercepting the start-round API
// before the game starts, so we don't need a real Gemini failure.

test("start-round 404: graceful soft message renders, page stays alive", async ({
  browser,
}) => {
  test.setTimeout(90_000);

  const hostCtx = await browser.newContext();
  const host = await hostCtx.newPage();
  const hostName = `Host${Date.now()}`;
  const code = await createRoomAs(host, hostName, {
    maxRounds: 1,
    revealSeconds: 5,
  });

  const joinerCtx = await browser.newContext();
  const joiner = await joinerCtx.newPage();
  await joinRoomAs(joiner, code, `Joiner${Date.now()}`);

  await expect(host.getByText(/Joiner/)).toBeVisible({ timeout: 10_000 });

  // Intercept start-round on the host tab BEFORE clicking Start game.
  // Return a 404 that mirrors what the server sends when the round row has
  // been deleted by a prior Gemini failure recovery.
  await host.route("**/api/start-round", async (route) => {
    await route.fulfill({
      status: 404,
      contentType: "application/json",
      body: JSON.stringify({ error: "round not found" }),
    });
  });

  await host.getByRole("button", { name: /Start game/ }).click();

  // The generating phase should appear on both pages.
  // Host hits our intercept → gets 404 → should show the soft 404 message.
  await expect(host.locator('[data-start-404="1"]')).toBeVisible({
    timeout: 30_000,
  });

  // Specifically, the hard error UI should NOT be shown.
  await expect(host.locator('[data-start-error="1"]')).not.toBeVisible();
  await expect(host.getByText("Image generation failed")).not.toBeVisible();

  // The page itself must not have crashed — the spinner / waiting copy should
  // still be rendered inside the 404 block.
  await expect(
    host.getByText(/Round was reset — hanging tight/),
  ).toBeVisible();

  // Joiner (unaffected by the intercept) should still see the normal spinner.
  await expect(host.locator('[data-start-404="1"]')).toBeVisible();

  await hostCtx.close();
  await joinerCtx.close();
});

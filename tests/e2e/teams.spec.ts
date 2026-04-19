import { test, expect } from "@playwright/test";
import { createRoomAs, joinRoomAs, submitGuess } from "./helpers";

test("teams mode: toggle, assignments, team leaderboard at game over", async ({
  browser,
}) => {
  test.setTimeout(240_000);

  const hostCtx = await browser.newContext();
  const host = await hostCtx.newPage();
  const stamp = Date.now();
  const code = await createRoomAs(host, `H${stamp}`, {
    maxRounds: 1,
    revealSeconds: 5,
  });

  const p2Ctx = await browser.newContext();
  const p2 = await p2Ctx.newPage();
  await joinRoomAs(p2, code, `B${stamp}`);

  const p3Ctx = await browser.newContext();
  const p3 = await p3Ctx.newPage();
  await joinRoomAs(p3, code, `C${stamp}`);

  const p4Ctx = await browser.newContext();
  const p4 = await p4Ctx.newPage();
  await joinRoomAs(p4, code, `D${stamp}`);

  // Wait for all 4 players to be reflected in the host's lobby before flipping
  // modes, so the seed loop on the server sees everyone.
  await expect(host.getByRole("heading", { name: /Players \(4\)/ })).toBeVisible({
    timeout: 20_000,
  });

  // Controlled checkbox — use click() (fires the change event) and poll for
  // the DOM to reflect the new state via the team panels appearing.
  await host.locator('input[data-teams-toggle="1"]').click();

  await expect(host.locator('[data-team="1"]')).toBeVisible({ timeout: 15_000 });
  await expect(host.locator('[data-team="2"]')).toBeVisible();

  // Both team panels should list two members each. The exact split is
  // deterministic (alternating by join order) but we only assert the count so
  // the test survives future changes to the seed policy.
  await expect(host.locator('[data-team="1"] li')).toHaveCount(2, {
    timeout: 15_000,
  });
  await expect(host.locator('[data-team="2"] li')).toHaveCount(2);

  await host.getByRole("button", { name: /Start game/ }).click();

  await submitGuess(host, "a cat in a hat");
  await submitGuess(p2, "dog on the moon");
  await submitGuess(p3, "robot painter");
  await submitGuess(p4, "dragon in a library");

  for (const page of [host, p2, p3, p4]) {
    await expect(page.getByText("Final team leaderboard")).toBeVisible({
      timeout: 60_000,
    });
    // Both teams render.
    await expect(page.locator('[data-team-rank="1"]')).toBeVisible();
    await expect(page.locator('[data-team-rank="2"]')).toBeVisible();
  }

  await hostCtx.close();
  await p2Ctx.close();
  await p3Ctx.close();
  await p4Ctx.close();
});

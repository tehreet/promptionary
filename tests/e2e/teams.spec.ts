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

  // Host toggles teams mode. Players auto-seed into alternating teams by join
  // order so each team has two members after the toggle.
  const toggle = host.locator('input[data-teams-toggle="1"]');
  await toggle.check();

  await expect(host.locator('[data-team="1"]').first()).toBeVisible({
    timeout: 10_000,
  });
  await expect(host.locator('[data-team="2"]').first()).toBeVisible();

  // Everyone should see their own chip inside a team panel once the realtime
  // poll syncs the assignment.
  for (const page of [p2, p3, p4]) {
    await expect(page.locator('[data-team="1"], [data-team="2"]')).toHaveCount(
      2,
      { timeout: 15_000 },
    );
  }

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

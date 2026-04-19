import { test, expect, type Page } from "@playwright/test";

async function setName(page: Page, idx: number, name: string) {
  const input = page.getByLabel("Your name").nth(idx);
  await input.click();
  await input.press("ControlOrMeta+a");
  await input.fill(name);
}

async function joinRoom(page: Page, code: string, name: string) {
  await page.goto("/");
  await setName(page, 1, name);
  await page.getByLabel("Room code").fill(code);
  await page.getByRole("button", { name: "Join Room" }).click();
  await page.waitForURL(new RegExp(`/play/${code}$`), { timeout: 30_000 });
}

test("spectator: mid-game visitor sees watch UI, can observe, can't guess", async ({
  browser,
}) => {
  test.setTimeout(180_000);

  // Host creates + starts a game with a second real player
  const hostCtx = await browser.newContext();
  const host = await hostCtx.newPage();
  await host.goto("/");
  const hostName = `Host${Date.now()}`;
  await setName(host, 0, hostName);
  await host.getByRole("button", { name: "Create Room" }).click();
  await host.waitForURL(/\/play\/[A-Z]{4}$/, { timeout: 30_000 });
  const code = host.url().match(/\/play\/([A-Z]{4})$/)![1];

  const p2Ctx = await browser.newContext();
  const p2 = await p2Ctx.newPage();
  await joinRoom(p2, code, `Player2_${Date.now()}`);

  await host.getByRole("button", { name: /Start game/ }).click();
  await expect(
    host.getByRole("textbox", { name: /What's the prompt/ }),
  ).toBeVisible({ timeout: 60_000 });

  // Spectator arrives mid-game
  const spectCtx = await browser.newContext();
  const spect = await spectCtx.newPage();
  await spect.goto(`/play/${code}`);

  // Should see the watch CTA, not the regular join
  await expect(spect.getByRole("button", { name: "Watch room" })).toBeVisible();
  const spectName = `Spect${Date.now()}`;
  const nameInput = spect.getByLabel("Your name");
  await nameInput.click();
  await nameInput.press("ControlOrMeta+a");
  await nameInput.fill(spectName);
  await spect.getByRole("button", { name: "Watch room" }).click();

  // Lands in the game, sees "Spectating" badge, no guess input
  await expect(spect.getByText(/Spectating/).first()).toBeVisible({
    timeout: 30_000,
  });
  await expect(
    spect.getByText(/guesses are hidden until reveal/),
  ).toBeVisible();
  await expect(
    spect.getByRole("textbox", { name: /What's the prompt/ }),
  ).toHaveCount(0);

  // Host's scoreboard shows "1 watching"
  await expect(host.getByText(/1 watching/)).toBeVisible({ timeout: 10_000 });

  // Submission counter on host should be /2 (two non-spectators), not /3
  await expect(host.getByText(/Submissions: 0\/2/)).toBeVisible();

  await hostCtx.close();
  await p2Ctx.close();
  await spectCtx.close();
});

import { test, expect } from "@playwright/test";
import { createRoomAs, joinRoomAs } from "./helpers";

test("spectator: mid-game visitor sees watch UI, can observe, can't guess", async ({
  browser,
}) => {
  test.setTimeout(120_000);

  const hostCtx = await browser.newContext();
  const host = await hostCtx.newPage();
  const code = await createRoomAs(host, `Host${Date.now()}`, {
    maxRounds: 1,
    revealSeconds: 5,
  });

  const p2Ctx = await browser.newContext();
  const p2 = await p2Ctx.newPage();
  await joinRoomAs(p2, code, `Player2_${Date.now()}`);

  await host.getByRole("button", { name: /Start game/ }).click();
  await expect(
    host.getByRole("textbox", { name: /What's the prompt/ }),
  ).toBeVisible({ timeout: 60_000 });

  const spectCtx = await browser.newContext();
  const spect = await spectCtx.newPage();
  await spect.goto(`/play/${code}`);

  await expect(spect.getByRole("button", { name: "Watch room" })).toBeVisible();
  const spectName = `Spect${Date.now()}`;
  const nameInput = spect.getByLabel("Your name");
  await nameInput.click();
  await nameInput.press("ControlOrMeta+a");
  await nameInput.fill(spectName);
  await spect.getByRole("button", { name: "Watch room" }).click();

  await expect(spect.getByText(/Spectating/).first()).toBeVisible({
    timeout: 30_000,
  });
  await expect(
    spect.getByText(/guesses are hidden until reveal/),
  ).toBeVisible();
  await expect(
    spect.getByRole("textbox", { name: /What's the prompt/ }),
  ).toHaveCount(0);

  await expect(host.getByText(/1 watching/)).toBeVisible({ timeout: 10_000 });
  await expect(host.getByText(/Submissions: 0\/2/)).toBeVisible();

  await hostCtx.close();
  await p2Ctx.close();
  await spectCtx.close();
});

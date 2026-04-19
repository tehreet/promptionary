import { test, expect } from "@playwright/test";
import { createRoomAs, joinRoomAs } from "./helpers";

test("loading phrases cycle during the generating phase", async ({
  browser,
}) => {
  test.setTimeout(90_000);

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

  // A loading phrase should be visible while the AI is painting. Use the host
  // page — they're the fastest to see the generating phase.
  const phrase = host.locator('[data-loading-phrase="1"]');
  await expect(phrase).toBeVisible({ timeout: 15_000 });
  const firstText = (await phrase.textContent())?.trim() ?? "";
  expect(firstText.length).toBeGreaterThan(3);

  await hostCtx.close();
  await joinerCtx.close();
});

import { test, expect, type Page } from "@playwright/test";
import { joinRoomAs, submitGuess } from "./helpers";

test("artist mode + teams: toggle coexists, team leaderboard at game over", async ({
  browser,
}) => {
  test.setTimeout(240_000);

  const hostCtx = await browser.newContext();
  const host = await hostCtx.newPage();
  const stamp = Date.now();
  const hostName = `H${stamp}`;

  await host.goto("/");
  const nameInput = host.getByLabel("Your name").first();
  await nameInput.click();
  await nameInput.press("ControlOrMeta+a");
  await nameInput.fill(hostName);
  await host.getByRole("button", { name: "Artist" }).click();
  await host.getByRole("button", { name: /Customize rounds/ }).click();
  const maxRounds = host.locator("#cfg-maxRounds");
  await maxRounds.click();
  await maxRounds.press("ControlOrMeta+a");
  await maxRounds.fill("1");
  const revealSeconds = host.locator("#cfg-revealSeconds");
  await revealSeconds.click();
  await revealSeconds.press("ControlOrMeta+a");
  await revealSeconds.fill("5");
  await host.getByRole("button", { name: "Create Room" }).click();
  await host.waitForURL(/\/play\/[A-Z]{4}$/, { timeout: 30_000 });
  const code = host.url().match(/\/play\/([A-Z]{4})$/)![1];

  const p2Ctx = await browser.newContext();
  const p2 = await p2Ctx.newPage();
  await joinRoomAs(p2, code, `B${stamp}`);

  const p3Ctx = await browser.newContext();
  const p3 = await p3Ctx.newPage();
  await joinRoomAs(p3, code, `C${stamp}`);

  const p4Ctx = await browser.newContext();
  const p4 = await p4Ctx.newPage();
  await joinRoomAs(p4, code, `D${stamp}`);

  // Wait for all 4 in host lobby, then flip teams ON — this must work in
  // artist mode too (the bug we're fixing).
  await expect(host.getByRole("heading", { name: /Players \(4\)/ })).toBeVisible({
    timeout: 20_000,
  });
  const toggle = host.locator('input[data-teams-toggle="1"]');
  await expect(toggle).toBeVisible();
  await toggle.click();

  await expect(host.locator('[data-team="1"] li')).toHaveCount(2, {
    timeout: 15_000,
  });
  await expect(host.locator('[data-team="2"] li')).toHaveCount(2);

  await host.getByRole("button", { name: /Start game/ }).click();

  // Artist rotation is randomized — wait for whoever got picked.
  const [artist, , artistName] = await Promise.race<[Page, Page, string]>([
    host
      .getByText(/You.+re the artist/)
      .waitFor({ timeout: 30_000 })
      .then(() => [host, p2, hostName] as [Page, Page, string]),
    p2
      .getByText(/You.+re the artist/)
      .waitFor({ timeout: 30_000 })
      .then(() => [p2, host, `B${stamp}`] as [Page, Page, string]),
    p3
      .getByText(/You.+re the artist/)
      .waitFor({ timeout: 30_000 })
      .then(() => [p3, host, `C${stamp}`] as [Page, Page, string]),
    p4
      .getByText(/You.+re the artist/)
      .waitFor({ timeout: 30_000 })
      .then(() => [p4, host, `D${stamp}`] as [Page, Page, string]),
  ]);
  void artistName;

  const promptArea = artist.getByRole("textbox");
  await promptArea.fill(
    "a corgi in a purple beret painting a sunset in oil pastel",
  );
  await artist.getByRole("button", { name: /Send to the AI/ }).click();

  const guessers = [host, p2, p3, p4].filter((p) => p !== artist);
  for (const g of guessers) {
    await submitGuess(g, "a dog wearing a hat painting the sunset");
  }

  for (const page of [host, p2, p3, p4]) {
    await expect(page.getByText("Final team leaderboard")).toBeVisible({
      timeout: 60_000,
    });
    await expect(page.locator('[data-team-rank="1"]')).toBeVisible();
    await expect(page.locator('[data-team-rank="2"]')).toBeVisible();
  }

  await hostCtx.close();
  await p2Ctx.close();
  await p3Ctx.close();
  await p4Ctx.close();
});

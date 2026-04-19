import { test, expect, type Page } from "@playwright/test";
import { joinRoomAs, submitGuess } from "./helpers";

test("artist mode: one player writes the prompt, the other guesses", async ({
  browser,
}) => {
  test.setTimeout(180_000);

  const hostCtx = await browser.newContext();
  const host = await hostCtx.newPage();

  await host.goto("/");
  const hostName = `Host${Date.now()}`;
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

  const joinerCtx = await browser.newContext();
  const joiner = await joinerCtx.newPage();
  const joinerName = `Joiner${Date.now()}`;
  await joinRoomAs(joiner, code, joinerName);

  await expect(host.getByText(joinerName)).toBeVisible({ timeout: 10_000 });
  await host.getByRole("button", { name: /Start game/ }).click();

  // Artist rotation is randomized now — either host or joiner may be picked
  // as the first artist. Wait for "You're the artist" to appear on either
  // page and key the rest of the test on that.
  const [artist, guesser, artistName] = await Promise.race<
    [Page, Page, string]
  >([
    host
      .getByText(/You.+re the artist/)
      .waitFor({ timeout: 20_000 })
      .then(() => [host, joiner, hostName] as [Page, Page, string]),
    joiner
      .getByText(/You.+re the artist/)
      .waitFor({ timeout: 20_000 })
      .then(() => [joiner, host, joinerName] as [Page, Page, string]),
  ]);

  const promptArea = artist.getByRole("textbox");
  await promptArea.fill(
    "a corgi in a purple beret painting a sunset in oil pastel",
  );
  await artist.getByRole("button", { name: /Send to the AI/ }).click();

  await expect(
    guesser.getByRole("textbox", { name: /What's the prompt/ }),
  ).toBeVisible({ timeout: 90_000 });
  await expect(artist.getByText(/You wrote this one/)).toBeVisible();
  await expect(guesser.getByText(/Prompt by/)).toBeVisible();

  await expect(guesser.getByText(/Submissions: 0\/1/)).toBeVisible();

  await submitGuess(guesser, "a dog wearing a hat painting at sunset");

  for (const page of [artist, guesser]) {
    await expect(page.getByText("The prompt was")).toBeVisible({
      timeout: 30_000,
    });
  }

  for (const page of [artist, guesser]) {
    await expect(page.getByText("Final leaderboard")).toBeVisible({
      timeout: 30_000,
    });
  }

  // Artist gets credit for the average guesser score.
  await expect(artist.getByText(artistName)).toBeVisible();

  await hostCtx.close();
  await joinerCtx.close();
});

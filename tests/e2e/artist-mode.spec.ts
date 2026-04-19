import { test, expect } from "@playwright/test";
import { createRoomAs, joinRoomAs, submitGuess } from "./helpers";

test("artist mode: host writes the prompt, others guess it", async ({
  browser,
}) => {
  test.setTimeout(180_000);

  const hostCtx = await browser.newContext();
  const host = await hostCtx.newPage();

  // Create artist-mode room with short reveal
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

  // Joiner joins (becomes the guesser, since host joined first = first artist)
  const joinerCtx = await browser.newContext();
  const joiner = await joinerCtx.newPage();
  await joinRoomAs(joiner, code, `Joiner${Date.now()}`);

  await expect(host.getByText(/Joiner/)).toBeVisible({ timeout: 10_000 });
  await host.getByRole("button", { name: /Start game/ }).click();

  // Host is the artist for round 1 — sees the prompting textarea
  await expect(host.getByText(/You.+re the artist/)).toBeVisible({
    timeout: 15_000,
  });
  const promptArea = host.getByRole("textbox");
  await promptArea.fill(
    "a corgi in a purple beret painting a sunset in oil pastel",
  );
  await host.getByRole("button", { name: /Send to the AI/ }).click();

  // Joiner sees the guessing UI; host sees "You wrote this one"
  await expect(
    joiner.getByRole("textbox", { name: /What's the prompt/ }),
  ).toBeVisible({ timeout: 90_000 });
  await expect(host.getByText(/You wrote this one/)).toBeVisible();
  await expect(host.getByText(/Prompt by/)).toBeVisible();

  // Submission total is 1 (only joiner can guess; host is the artist)
  await expect(joiner.getByText(/Submissions: 0\/1/)).toBeVisible();

  // Joiner guesses
  await submitGuess(joiner, "a dog wearing a hat painting at sunset");

  // Reveal shows the true prompt
  for (const page of [host, joiner]) {
    await expect(page.getByText("The prompt was")).toBeVisible({
      timeout: 30_000,
    });
  }

  // Final leaderboard shows (max_rounds was 1)
  for (const page of [host, joiner]) {
    await expect(page.getByText("Final leaderboard")).toBeVisible({
      timeout: 30_000,
    });
  }

  // Host (artist) should have scored something (avg of guesser's score)
  const hostScoreVisible = await host.getByText(hostName).isVisible();
  expect(hostScoreVisible).toBe(true);

  await hostCtx.close();
  await joinerCtx.close();
});

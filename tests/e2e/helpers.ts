import { expect, type Page } from "@playwright/test";

export async function createRoomAs(
  page: Page,
  name: string,
  opts: { maxRounds?: number; guessSeconds?: number; revealSeconds?: number } = {},
) {
  await page.goto("/");
  const nameInput = page.getByLabel("Your name").first();
  await nameInput.click();
  await nameInput.press("ControlOrMeta+a");
  await nameInput.fill(name);

  if (opts.maxRounds !== undefined || opts.guessSeconds !== undefined || opts.revealSeconds !== undefined) {
    await page.getByRole("button", { name: /Customize rounds/ }).click();
    if (opts.maxRounds !== undefined) {
      const f = page.locator('#cfg-maxRounds');
      await f.click();
      await f.press("ControlOrMeta+a");
      await f.fill(String(opts.maxRounds));
    }
    if (opts.guessSeconds !== undefined) {
      const f = page.locator('#cfg-guessSeconds');
      await f.click();
      await f.press("ControlOrMeta+a");
      await f.fill(String(opts.guessSeconds));
    }
    if (opts.revealSeconds !== undefined) {
      const f = page.locator('#cfg-revealSeconds');
      await f.click();
      await f.press("ControlOrMeta+a");
      await f.fill(String(opts.revealSeconds));
    }
  }

  await page.getByRole("button", { name: "Create Room" }).click();
  await page.waitForURL(/\/play\/[A-Z]{4}$/, { timeout: 30_000 });
  return page.url().match(/\/play\/([A-Z]{4})$/)![1];
}

export async function joinRoomAs(page: Page, code: string, name: string) {
  await page.goto("/");
  const nameInput = page.getByLabel("Your name").nth(1);
  await nameInput.click();
  await nameInput.press("ControlOrMeta+a");
  await nameInput.fill(name);
  await page.getByLabel("Room code").fill(code);
  await page.getByRole("button", { name: "Join Room" }).click();
  await page.waitForURL(new RegExp(`/play/${code}$`), { timeout: 30_000 });
}

export async function submitGuess(page: Page, text: string) {
  const input = page.getByRole("textbox", { name: /What's the prompt/ });
  await input.waitFor({ state: "visible", timeout: 60_000 });
  await input.fill(text);
  await page.getByRole("button", { name: "Guess", exact: true }).click();
  await expect(page.getByText(/Guess in!/)).toBeVisible({ timeout: 10_000 });
}

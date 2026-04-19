import { test, expect, type Page } from "@playwright/test";

async function setName(page: Page, fieldIndex: number, name: string) {
  const input = page.getByLabel("Your name").nth(fieldIndex);
  await input.click();
  await input.press("ControlOrMeta+a");
  await input.fill(name);
}

test("full round cycle: create, join, start, guess, reveal", async ({ browser }) => {
  test.setTimeout(180_000);

  // Host creates room
  const hostCtx = await browser.newContext();
  const host = await hostCtx.newPage();
  await host.goto("/");
  const hostName = `Host${Date.now()}`;
  await setName(host, 0, hostName);
  await host.getByRole("button", { name: "Create Room" }).click();
  await host.waitForURL(/\/play\/[A-Z]{4}$/, { timeout: 30_000 });
  const code = host.url().match(/\/play\/([A-Z]{4})$/)![1];

  // Joiner joins
  const joinerCtx = await browser.newContext();
  const joiner = await joinerCtx.newPage();
  await joiner.goto("/");
  const joinerName = `Joiner${Date.now()}`;
  await setName(joiner, 1, joinerName);
  await joiner.getByLabel("Room code").fill(code);
  await joiner.getByRole("button", { name: "Join Room" }).click();
  await joiner.waitForURL(new RegExp(`/play/${code}$`), { timeout: 30_000 });

  // Host waits for joiner to show in the list, then starts
  await expect(host.getByText(joinerName)).toBeVisible({ timeout: 10_000 });
  await host.getByRole("button", { name: /Start game/ }).click();

  // Both wait for guessing phase: image renders + "Guess" input appears
  for (const page of [host, joiner]) {
    await expect(
      page.getByRole("textbox", { name: /What's the prompt/ }),
    ).toBeVisible({ timeout: 60_000 });
    await expect(page.locator('img[alt="Round"]')).toBeVisible();
  }

  // Both submit guesses
  for (const [page, text] of [
    [host, "a cat wearing a top hat"] as const,
    [joiner, "astronaut riding a horse"] as const,
  ]) {
    const input = page.getByRole("textbox", { name: /What's the prompt/ });
    await input.fill(text);
    await page.getByRole("button", { name: "Guess", exact: true }).click();
    await expect(page.getByText(/Guess in!/)).toBeVisible({ timeout: 10_000 });
  }

  // Wait for reveal — the true prompt appears
  for (const page of [host, joiner]) {
    await expect(page.getByText("The prompt was")).toBeVisible({
      timeout: 90_000,
    });
  }

  await hostCtx.close();
  await joinerCtx.close();
});

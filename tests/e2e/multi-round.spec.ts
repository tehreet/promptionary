import { test, expect, type Page } from "@playwright/test";

async function setName(page: Page, fieldIndex: number, name: string) {
  const input = page.getByLabel("Your name").nth(fieldIndex);
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

async function submitGuess(page: Page, text: string) {
  const input = page.getByRole("textbox", { name: /What's the prompt/ });
  await input.waitFor({ state: "visible", timeout: 60_000 });
  await input.fill(text);
  await page.getByRole("button", { name: "Guess", exact: true }).click();
  await expect(page.getByText(/Guess in!/)).toBeVisible({ timeout: 10_000 });
}

test("3 players, multi-round: submissions count real, round rolls over cleanly", async ({
  browser,
}) => {
  test.setTimeout(360_000);

  // Host
  const hostCtx = await browser.newContext();
  const host = await hostCtx.newPage();
  await host.goto("/");
  const hostName = `Host${Date.now()}`;
  await setName(host, 0, hostName);
  await host.getByRole("button", { name: "Create Room" }).click();
  await host.waitForURL(/\/play\/[A-Z]{4}$/, { timeout: 30_000 });
  const code = host.url().match(/\/play\/([A-Z]{4})$/)![1];

  // Two joiners
  const aliceCtx = await browser.newContext();
  const alice = await aliceCtx.newPage();
  await joinRoom(alice, code, `Alice${Date.now()}`);

  const bobCtx = await browser.newContext();
  const bob = await bobCtx.newPage();
  await joinRoom(bob, code, `Bob${Date.now()}`);

  // Host starts
  await expect(host.getByRole("button", { name: /Start game \(3/ })).toBeVisible({
    timeout: 15_000,
  });
  await host.getByRole("button", { name: /Start game/ }).click();

  // Round 1
  await submitGuess(host, "a cat wearing a top hat in the rain");
  await submitGuess(alice, "majestic stag in a pixel art forest");

  // Alice submits first — her UI should show count climbing past 1 once Bob/host
  // submit. Checks that the SECURITY DEFINER count function is wired in.
  await expect(alice.getByText(/Submissions: 2\//)).toBeVisible({ timeout: 20_000 });

  await submitGuess(bob, "an astronaut riding a horse on mars");

  await expect(alice.getByText(/Submissions: 3\//)).toBeVisible({ timeout: 20_000 });

  // Reveal for round 1
  for (const page of [host, alice, bob]) {
    await expect(page.getByText("The prompt was")).toBeVisible({ timeout: 90_000 });
  }

  // Round 2 — kicks in after reveal_seconds (default 10)
  for (const page of [host, alice, bob]) {
    await expect(
      page.getByRole("textbox", { name: /What's the prompt/ }),
    ).toBeVisible({ timeout: 90_000 });
  }

  // Text box should remain visible — not flash away
  await host.waitForTimeout(1000);
  await expect(
    host.getByRole("textbox", { name: /What's the prompt/ }),
  ).toBeVisible();

  await submitGuess(host, "round 2 guess");
  await submitGuess(alice, "something random");
  await submitGuess(bob, "more words");

  for (const page of [host, alice, bob]) {
    await expect(page.getByText("The prompt was")).toBeVisible({ timeout: 90_000 });
  }

  await hostCtx.close();
  await aliceCtx.close();
  await bobCtx.close();
});

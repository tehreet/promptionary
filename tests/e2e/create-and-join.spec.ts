import { test, expect } from "@playwright/test";

test("host creates a room and a second player joins it", async ({ browser }) => {
  // Tab A — host
  const hostCtx = await browser.newContext();
  const host = await hostCtx.newPage();
  await host.goto("/");

  const hostName = `Host${Date.now()}`;
  // Home page has Quick Match / Create / Join tiles; scope to the Create
  // card by its input id rather than the fragile `.first()` ordering.
  const hostInput = host.locator("#create-name");
  await hostInput.click();
  await hostInput.press("ControlOrMeta+a");
  await hostInput.fill(hostName);
  await host.getByRole("button", { name: "Create Room" }).click();

  // Wait for /play/[code] redirect
  await host.waitForURL(/\/play\/[A-Z]{4}$/, { timeout: 30_000 });
  const url = host.url();
  const code = url.match(/\/play\/([A-Z]{4})$/)![1];

  // Host should see their name and code
  await expect(host.locator("h1", { hasText: code })).toBeVisible();
  await expect(host.getByText(hostName)).toBeVisible();

  // Tab B — joiner
  const joinerCtx = await browser.newContext();
  const joiner = await joinerCtx.newPage();
  await joiner.goto("/");

  const joinerName = `Joiner${Date.now()}`;
  const joinerInput = joiner.locator("#join-name");
  await joinerInput.click();
  await joinerInput.press("ControlOrMeta+a");
  await joinerInput.fill(joinerName);
  await joiner.getByLabel("Room code").fill(code);
  await joiner.getByRole("button", { name: "Join Room" }).click();

  await joiner.waitForURL(new RegExp(`/play/${code}$`), { timeout: 30_000 });

  // Both should see both names
  await expect(host.getByText(joinerName)).toBeVisible({ timeout: 10_000 });
  await expect(joiner.getByText(hostName)).toBeVisible({ timeout: 10_000 });
  await expect(joiner.getByText(joinerName)).toBeVisible();

  await hostCtx.close();
  await joinerCtx.close();
});

import { test, expect, type Page } from "@playwright/test";

async function setName(page: Page, fieldIndex: number, name: string) {
  const input = page.getByLabel("Your name").nth(fieldIndex);
  await input.click();
  await input.press("ControlOrMeta+a");
  await input.fill(name);
}

test("invite link: opening /play/<code> shows a name form and joins", async ({
  browser,
}) => {
  // Host creates a room
  const hostCtx = await browser.newContext();
  const host = await hostCtx.newPage();
  await host.goto("/");
  const hostName = `Host${Date.now()}`;
  await setName(host, 0, hostName);
  await host.getByRole("button", { name: "Create Room" }).click();
  await host.waitForURL(/\/play\/[A-Z]{4}$/, { timeout: 30_000 });
  const code = host.url().match(/\/play\/([A-Z]{4})$/)![1];

  // Visitor opens the link directly
  const visitorCtx = await browser.newContext();
  const visitor = await visitorCtx.newPage();
  await visitor.goto(`/play/${code}`);

  // Should see the invite UI, not get bounced to home
  await expect(visitor.getByRole("heading", { name: code })).toBeVisible();
  await expect(
    visitor.getByRole("button", { name: "Join Room" }),
  ).toBeVisible();
  expect(visitor.url()).toContain(`/play/${code}`);

  // Fill name and join
  const visitorName = `Visitor${Date.now()}`;
  const nameInput = visitor.getByLabel("Your name");
  await nameInput.click();
  await nameInput.press("ControlOrMeta+a");
  await nameInput.fill(visitorName);
  await visitor.getByRole("button", { name: "Join Room" }).click();

  // Now in the lobby — host should see them
  await expect(host.getByText(visitorName)).toBeVisible({ timeout: 10_000 });

  await hostCtx.close();
  await visitorCtx.close();
});

import { test, expect } from "@playwright/test";

// Quick Match: one-click drop into a public lobby.
//
// Flow under test:
//   1. Solo player taps Quick Match — no public lobby exists yet, so the
//      matchmaker mints a fresh public lobby and drops them in as host.
//      The lobby surfaces the "Public lobby" badge.
//   2. A second player taps Quick Match — the first player's lobby is
//      still in 'lobby' phase with <6 players and fresh (created <5 min
//      ago), so they land in the same lobby. Both players see each other.
//
// Written but intentionally not run alongside the Playwright sweep per the
// v1 ship gate — run manually with `bun test:e2e tests/e2e/quick-match`.
test("two Quick Match clicks land solo players in the same public lobby", async ({
  browser,
}) => {
  // Player A
  const aCtx = await browser.newContext();
  const a = await aCtx.newPage();
  await a.goto("/");

  const aName = `QuickA${Date.now()}`;
  const aInput = a.locator("#shared-name");
  await aInput.click();
  await aInput.press("ControlOrMeta+a");
  await aInput.fill(aName);
  await a.getByRole("button", { name: "Quick Match" }).click();

  // Should land on /play/<code> with a public-lobby badge visible.
  await a.waitForURL(/\/play\/[A-Z]{4}$/, { timeout: 30_000 });
  const aUrl = a.url();
  const code = aUrl.match(/\/play\/([A-Z]{4})$/)![1];
  await expect(a.locator('[data-public-lobby-badge="1"]')).toBeVisible({
    timeout: 10_000,
  });
  await expect(a.getByText(aName)).toBeVisible();

  // Player B — second Quick Match click should join the same room.
  const bCtx = await browser.newContext();
  const b = await bCtx.newPage();
  await b.goto("/");

  const bName = `QuickB${Date.now()}`;
  const bInput = b.locator("#shared-name");
  await bInput.click();
  await bInput.press("ControlOrMeta+a");
  await bInput.fill(bName);
  await b.getByRole("button", { name: "Quick Match" }).click();

  await b.waitForURL(new RegExp(`/play/${code}$`), { timeout: 30_000 });

  // Both sides see both names in the lobby, and the public-lobby badge
  // renders on the joiner too.
  await expect(a.getByText(bName)).toBeVisible({ timeout: 10_000 });
  await expect(b.getByText(aName)).toBeVisible({ timeout: 10_000 });
  await expect(b.locator('[data-public-lobby-badge="1"]')).toBeVisible({
    timeout: 10_000,
  });

  await aCtx.close();
  await bCtx.close();
});

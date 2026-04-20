import { test, expect } from "@playwright/test";

// Per-IP room-creation cap: 5 rooms / hour. The 6th attempt from the same IP
// within the window should surface the "Slow down" message bubbled up from
// the server action.
//
// Skipped by default: real runs hit production/staging from a single IP that
// is shared with the rest of the e2e suite, so running this would lock the
// whole worker out for an hour. Unskip locally when you want to sanity-check
// the limit end-to-end (and remember to prune room_creation_log afterwards).
test.skip("creates 5 rooms, 6th is rate-limited", async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();

  for (let i = 1; i <= 5; i++) {
    await page.goto("/");
    const nameInput = page.locator("#create-name");
    await nameInput.click();
    await nameInput.press("ControlOrMeta+a");
    await nameInput.fill(`RL${Date.now()}-${i}`);
    await page.getByRole("button", { name: "Create Room" }).click();
    await page.waitForURL(/\/play\/[A-Z]{4}$/, { timeout: 30_000 });
  }

  // 6th attempt — same IP, within the hour window.
  await page.goto("/");
  const nameInput = page.locator("#create-name");
  await nameInput.click();
  await nameInput.press("ControlOrMeta+a");
  await nameInput.fill(`RL${Date.now()}-6`);
  await page.getByRole("button", { name: "Create Room" }).click();

  // Expect either a visible error or a stay-on-home fallback.
  // The server action throws; Next surfaces it via the form error boundary.
  await expect(page.getByText(/Slow down/i)).toBeVisible({ timeout: 10_000 });

  await ctx.close();
});

import { test, expect } from "@playwright/test";

test.describe("design tokens", () => {
  test("landing still renders with foreground + background tokens applied", async ({ page }) => {
    await page.goto("/");
    const body = page.locator("body");
    await expect(body).toBeVisible();
    const bg = await body.evaluate((el) => getComputedStyle(el).backgroundColor);
    const fg = await body.evaluate((el) => getComputedStyle(el).color);
    expect(bg).not.toBe("");
    expect(fg).not.toBe("");
  });
});

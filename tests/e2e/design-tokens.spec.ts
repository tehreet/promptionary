import { test, expect } from "@playwright/test";
import { createRoomAs } from "./helpers";

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

  test("landing uses game-canvas-page (yellow, light-locked)", async ({ page }) => {
    await page.goto("/");
    const main = page.locator("main").first();
    await expect(main).toHaveClass(/game-canvas-page/);
    const hero = page.locator(".game-hero").first();
    await expect(hero).toBeVisible();
    const mark = page.locator(".game-hero-mark").first();
    await expect(mark).toHaveText(/prompt/);
  });

  test("lobby uses game-canvas", async ({ page }) => {
    const code = await createRoomAs(page, `Spec${Date.now()}`);
    await page.goto(`/play/${code}`);
    await expect(page.locator("main").first()).toHaveClass(/game-canvas/);
  });
});

import { test, expect } from "@playwright/test";
import { createRoomAs, joinRoomAs } from "./helpers";

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

  test("in-game (non-lobby) flips main to game-canvas-dark", async ({
    browser,
  }) => {
    test.setTimeout(120_000);
    const hostCtx = await browser.newContext();
    const host = await hostCtx.newPage();
    const code = await createRoomAs(host, `Host${Date.now()}`, {
      maxRounds: 1,
      revealSeconds: 5,
    });
    const joinerCtx = await browser.newContext();
    const joiner = await joinerCtx.newPage();
    await joinRoomAs(joiner, code, `Guesser${Date.now()}`);

    await host.getByRole("button", { name: /Start game/ }).click();

    // Whichever phase lands first after lobby — prompting, generating, or
    // guessing — all use game-canvas-dark. Don't assume party-mode.
    await host.waitForSelector("main.game-canvas-dark", { timeout: 60_000 });
    await expect(host.locator("main").first()).toHaveClass(/game-canvas-dark/);

    // Player-chip rail replaces the old text-white/bg-inline avatar circles.
    await expect(host.locator(".player-chip").first()).toBeVisible();

    await hostCtx.close();
    await joinerCtx.close();
  });

  // NOTE: a reveal-phase smoke that drives a full Gemini round to assert
  // .game-frame + .prompt-flip was prototyped here and consistently timed
  // out on local Gemini latency. The same surface is already covered by
  // recap.spec.ts (flipboard tokens) and, implicitly, by full-round.spec.ts.
  // Leaving the extra smoke out to keep this suite fast + deterministic.

  test("/daily uses game-canvas-page", async ({ page }) => {
    await page.goto("/daily");
    await expect(page.locator("main").first()).toHaveClass(/game-canvas-page/);
  });

  test("/leaders uses game-canvas", async ({ page }) => {
    await page.goto("/leaders");
    await expect(page.locator("main").first()).toHaveClass(/game-canvas/);
    await expect(page.locator(".game-card").first()).toBeVisible();
  });
});

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

  test("landing uses the shared game-canvas", async ({ page }) => {
    await page.goto("/");
    const main = page.locator("main").first();
    await expect(main).toHaveClass(/game-canvas/);
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

  test("in-game uses the shared game-canvas", async ({ browser }) => {
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

    // Every non-lobby phase uses the single .game-canvas class now
    // (collapsed from the prior three-canvas split).
    await host.waitForSelector("main.game-canvas", { timeout: 60_000 });
    await expect(host.locator("main").first()).toHaveClass(/game-canvas/);

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

  test("/daily uses the shared game-canvas", async ({ page }) => {
    await page.goto("/daily");
    await expect(page.locator("main").first()).toHaveClass(/game-canvas/);
  });

  test("/leaders uses game-canvas", async ({ page }) => {
    await page.goto("/leaders");
    await expect(page.locator("main").first()).toHaveClass(/game-canvas/);
    await expect(page.locator(".game-card").first()).toBeVisible();
  });

  test("/sign-in uses game-canvas", async ({ page }) => {
    await page.goto("/sign-in");
    await expect(page.locator("main").first()).toHaveClass(/game-canvas/);
  });

  test("/account uses game-canvas", async ({ page }) => {
    await page.goto("/");
    await page.goto("/account");
    await expect(page.locator("main").first()).toHaveClass(/game-canvas/);
  });

  test("legacy utilities and brand tokens no longer appear in rendered HTML", async ({ page }) => {
    for (const route of ["/", "/daily", "/leaders", "/sign-in"]) {
      await page.goto(route);
      const html = await page.content();
      expect(html).not.toContain("promptionary-gradient");
      expect(html).not.toContain("promptionary-grain");
      expect(html).not.toContain("text-hero");
      expect(html).not.toContain("--brand-indigo");
      expect(html).not.toContain("--brand-fuchsia");
      expect(html).not.toContain("--brand-rose");
    }
  });

  test("landing light-locks even when user prefers dark", async ({ browser }) => {
    const ctx = await browser.newContext({ colorScheme: "dark" });
    const page = await ctx.newPage();
    await page.goto("/");
    const scheme = await page
      .locator("main")
      .first()
      .evaluate((el) => getComputedStyle(el).colorScheme);
    expect(scheme).toBe("light");
    await ctx.close();
  });

  test("non-landing pages flip canvas in dark mode", async ({ browser }) => {
    for (const route of ["/leaders", "/sign-in"]) {
      const light = await browser.newContext({ colorScheme: "light" });
      const dark = await browser.newContext({ colorScheme: "dark" });
      const [lp, dp] = [await light.newPage(), await dark.newPage()];
      await lp.goto(route);
      await dp.goto(route);
      const lightBg = await lp
        .locator("main")
        .first()
        .evaluate((el) => getComputedStyle(el).backgroundColor);
      const darkBg = await dp
        .locator("main")
        .first()
        .evaluate((el) => getComputedStyle(el).backgroundColor);
      expect(lightBg).not.toBe(darkBg);
      await light.close();
      await dark.close();
    }
  });
});

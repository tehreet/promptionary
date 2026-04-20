import { test, expect } from "@playwright/test";
import { createRoomAs, joinRoomAs } from "./helpers";

// 3 players (party mode). Once the image lands, each non-spectator clicks
// "Skip this one". Threshold is ceil(3/2)=2 — the 3rd click just exercises
// the already-voted disabled state. At threshold any tab POSTs
// /api/skip-round, which deletes the old round and rerolls to a new image.
// Skipped unless PROMPTIONARY_MOCK_GEMINI=1.
test.describe("vote-to-skip (mock Gemini)", () => {
  test.skip(
    process.env.PROMPTIONARY_MOCK_GEMINI !== "1",
    "mock mode required; run with PROMPTIONARY_MOCK_GEMINI=1 bun dev",
  );

  test("majority skip votes reroll the round", async ({ browser }) => {
    test.setTimeout(90_000);

    const hostCtx = await browser.newContext();
    const host = await hostCtx.newPage();
    const code = await createRoomAs(host, `Host${Date.now()}`, {
      maxRounds: 1,
      guessSeconds: 60, // leave room for the reroll before reveal fires
      revealSeconds: 5,
    });

    const aCtx = await browser.newContext();
    const a = await aCtx.newPage();
    await joinRoomAs(a, code, `A${Date.now()}`);
    const bCtx = await browser.newContext();
    const b = await bCtx.newPage();
    await joinRoomAs(b, code, `B${Date.now()}`);

    await host.getByRole("button", { name: /Start game/ }).click();

    const originalUrls: string[] = [];
    for (const page of [host, a, b]) {
      const img = page.locator('img[alt="Round painting"]');
      await img.waitFor({ state: "visible", timeout: 30_000 });
      originalUrls.push((await img.getAttribute("src")) ?? "");
    }
    expect(originalUrls.every(Boolean)).toBe(true);

    for (const page of [host, a, b]) {
      await page.locator('[data-skip-vote="1"] button').first().click();
    }

    for (const [i, page] of [host, a, b].entries()) {
      await expect
        .poll(
          async () => {
            const src = await page
              .locator('img[alt="Round painting"]')
              .getAttribute("src");
            return src && src !== originalUrls[i] ? "rerolled" : "same";
          },
          { timeout: 30_000, intervals: [500, 1000, 2000] },
        )
        .toBe("rerolled");
    }

    for (const page of [host, a, b]) {
      await expect(page.getByText(/Skips used 1\/2/)).toBeVisible({
        timeout: 5_000,
      });
    }

    await hostCtx.close();
    await aCtx.close();
    await bCtx.close();
  });
});

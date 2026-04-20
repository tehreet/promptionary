import { test, expect } from "@playwright/test";
import { createRoomAs, joinRoomAs, submitGuess } from "./helpers";

// Mirror of full-round.spec.ts but aimed at a dev server running with
// `PROMPTIONARY_MOCK_GEMINI=1`. The mock bypasses the real 30-90s Gemini
// author + image + embed cycle, so the whole round lands in a few seconds
// instead of ~60s+. Keeps full-round.spec.ts as the real-Gemini canary
// against prod.
//
// Skips gracefully if the flag isn't set, so you can run the whole suite
// without caring whether the target server is mocked.
test.describe("full round (mock Gemini)", () => {
  test.skip(
    process.env.PROMPTIONARY_MOCK_GEMINI !== "1",
    "mock mode required; run with PROMPTIONARY_MOCK_GEMINI=1 bun dev",
  );

  test("full round cycle completes quickly with mocked Gemini", async ({
    browser,
  }) => {
    // Tighter budget than full-round.spec.ts — if this blows 60s something
    // has regressed in the mock plumbing, not Gemini. Dev server adds a few
    // seconds of first-paint compile; prod/CI will be snappier.
    test.setTimeout(60_000);

    const hostCtx = await browser.newContext();
    const host = await hostCtx.newPage();
    const code = await createRoomAs(host, `Host${Date.now()}`, {
      maxRounds: 1,
      revealSeconds: 5,
    });

    const joinerCtx = await browser.newContext();
    const joiner = await joinerCtx.newPage();
    await joinRoomAs(joiner, code, `Joiner${Date.now()}`);

    await host.getByRole("button", { name: /Start game/ }).click();

    for (const page of [host, joiner]) {
      await expect(
        page.getByRole("textbox", { name: /What's the prompt/ }),
      ).toBeVisible({ timeout: 30_000 });
      // Guessing-phase img has alt="Round painting"; reveal-phase is "Round".
      // Match either so this works before and after submission.
      await expect(
        page.locator('img[alt="Round painting"], img[alt="Round"]'),
      ).toBeVisible();
    }

    await submitGuess(host, "a cat wearing a top hat");
    await submitGuess(joiner, "astronaut riding a horse");

    for (const page of [host, joiner]) {
      await expect(page.getByText("The prompt was")).toBeVisible({
        timeout: 15_000,
      });
    }

    await hostCtx.close();
    await joinerCtx.close();
  });
});

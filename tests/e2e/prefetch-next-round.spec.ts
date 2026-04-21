import { test, expect } from "@playwright/test";
import { createRoomAs, joinRoomAs, submitGuess } from "./helpers";

// Speculative round N+1 pre-generation: during round N's guessing phase
// the client fires /api/prefetch-next-round, which authors + renders the
// next prompt/image and stashes it on `rooms.prefetched_*`. When
// /api/start-round runs for round N+1 it consumes the cache — no Gemini
// call — and flips phase in ~1s.
//
// We don't assert the precise consume-path log here (hard to surface
// reliably from the Next dev server to Playwright). The signal we rely on
// is that a two-round game completes green in under the time it would take
// if BOTH rounds paid the full Gemini latency. In mock mode both round
// paths are cheap, so this spec mostly guards that the prefetch pipeline
// doesn't break the flow.
test.describe("prefetch next round (mock Gemini)", () => {
  test.skip(
    process.env.PROMPTIONARY_MOCK_GEMINI !== "1",
    "mock mode required; run with PROMPTIONARY_MOCK_GEMINI=1 bun dev",
  );

  test("2 rounds both complete with prefetch enabled", async ({ browser }) => {
    test.setTimeout(90_000);

    const hostCtx = await browser.newContext();
    const host = await hostCtx.newPage();
    const code = await createRoomAs(host, `Host${Date.now()}`, {
      maxRounds: 2,
      revealSeconds: 5,
    });

    const joinerCtx = await browser.newContext();
    const joiner = await joinerCtx.newPage();
    await joinRoomAs(joiner, code, `Joiner${Date.now()}`);

    await expect(
      host.getByRole("button", { name: /Start game \(2/ }),
    ).toBeVisible({ timeout: 15_000 });
    await host.getByRole("button", { name: /Start game/ }).click();

    // Round 1
    await submitGuess(host, "a cat wearing a top hat");
    await submitGuess(joiner, "an astronaut on mars");

    for (const page of [host, joiner]) {
      await expect(page.getByText("The prompt was")).toBeVisible({
        timeout: 30_000,
      });
    }

    // Round 2 — prefetched during round 1's guessing phase, so the
    // generating phase should flip to guessing quickly.
    for (const page of [host, joiner]) {
      await expect(
        page.getByRole("textbox", { name: /What's the prompt/ }),
      ).toBeVisible({ timeout: 45_000 });
    }

    await submitGuess(host, "round two guess");
    await submitGuess(joiner, "also round two");

    for (const page of [host, joiner]) {
      await expect(page.getByText("Final leaderboard")).toBeVisible({
        timeout: 30_000,
      });
    }

    await hostCtx.close();
    await joinerCtx.close();
  });
});

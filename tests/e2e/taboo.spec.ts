import { test, expect, type Page } from "@playwright/test";
import { createRoomAs, joinRoomAs } from "./helpers";

// 2-player artist-mode with Taboo on. Artist sees 3 random chips (read from
// the DOM since the pool is random). Banned-word draft disables submit with
// a "Remove X first" label; a clean draft advances. Skipped unless
// PROMPTIONARY_MOCK_GEMINI=1.
test.describe("taboo (mock Gemini)", () => {
  test.skip(
    process.env.PROMPTIONARY_MOCK_GEMINI !== "1",
    "mock mode required; run with PROMPTIONARY_MOCK_GEMINI=1 bun dev",
  );

  test("artist sees 3 taboo chips and is blocked on banned words", async ({
    browser,
  }) => {
    test.setTimeout(90_000);

    const hostCtx = await browser.newContext();
    const host = await hostCtx.newPage();
    const hostName = `Host${Date.now()}`;
    const code = await createRoomAs(host, hostName, {
      mode: "artist",
      maxRounds: 1,
      revealSeconds: 5,
    });

    await host.locator('[data-taboo-toggle="1"] input[type="checkbox"]').check();

    const joinerCtx = await browser.newContext();
    const joiner = await joinerCtx.newPage();
    const joinerName = `Joiner${Date.now()}`;
    await joinRoomAs(joiner, code, joinerName);

    await expect(host.getByText(joinerName)).toBeVisible({ timeout: 10_000 });
    await host.getByRole("button", { name: /Start game/ }).click();

    const [artist] = await Promise.race<[Page]>([
      host.getByText(/You.+re the artist/).waitFor({ timeout: 20_000 })
        .then(() => [host] as [Page]),
      joiner.getByText(/You.+re the artist/).waitFor({ timeout: 20_000 })
        .then(() => [joiner] as [Page]),
    ]);

    const panel = artist.locator('[data-artist-taboo="1"]');
    await expect(panel).toBeVisible({ timeout: 10_000 });
    const chipWords = await panel
      .locator("[data-taboo-word]")
      .evaluateAll((els) => els.map((e) => e.getAttribute("data-taboo-word") ?? ""));
    expect(chipWords).toHaveLength(3);
    expect(chipWords.every((w) => w.length > 0)).toBe(true);

    const textarea = artist.getByRole("textbox");
    const banned = chipWords[0];
    await textarea.fill(`a scene featuring a ${banned} on a hillside at dusk`);
    const removeBtn = artist.getByRole("button", {
      name: new RegExp(`Remove "${banned}"`),
    });
    await expect(removeBtn).toBeVisible();
    await expect(removeBtn).toBeDisabled();
    await expect(
      panel.locator(`[data-taboo-word="${banned}"][data-taboo-hit="1"]`),
    ).toBeVisible();

    // Neutralize each banned word so we dodge all 3 regardless of pool roll.
    const clean = chipWords.reduce(
      (s, w) => s.replace(new RegExp(w, "gi"), "x".repeat(w.length)),
      "majestic zeppelin hovering above wispy clouds",
    );
    await textarea.fill(clean);
    await artist.getByRole("button", { name: /Send to the AI/ }).click();

    await expect(artist.getByText(/You wrote this one/)).toBeVisible({
      timeout: 30_000,
    });

    await hostCtx.close();
    await joinerCtx.close();
  });
});

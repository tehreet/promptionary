import { test, expect, type Page } from "@playwright/test";
import { createRoomAs, joinRoomAs } from "./helpers";

// Artist-mode moderation: when the artist submits something that trips the
// Gemini classifier, the server returns a 400 with a player-friendly reason
// and the client surfaces it via the existing inline error UX.
test("artist mode: moderation rejects a harmful prompt", async ({ browser }) => {
  test.setTimeout(120_000);

  const hostCtx = await browser.newContext();
  const host = await hostCtx.newPage();
  const hostName = `Host${Date.now()}`;
  const code = await createRoomAs(host, hostName, {
    mode: "artist",
    maxRounds: 1,
    revealSeconds: 5,
  });

  const joinerCtx = await browser.newContext();
  const joiner = await joinerCtx.newPage();
  const joinerName = `Joiner${Date.now()}`;
  await joinRoomAs(joiner, code, joinerName);

  await expect(host.getByText(joinerName)).toBeVisible({ timeout: 10_000 });
  await host.getByRole("button", { name: /Start game/ }).click();

  // Either player may be picked as the first artist — resolve by watching
  // for the artist header on both pages.
  const [artist] = await Promise.race<[Page]>([
    host
      .getByText(/You.+re the artist/)
      .waitFor({ timeout: 20_000 })
      .then(() => [host] as [Page]),
    joiner
      .getByText(/You.+re the artist/)
      .waitFor({ timeout: 20_000 })
      .then(() => [joiner] as [Page]),
  ]);

  // A clearly unsafe, graphic/hateful prompt. The exact wording here is
  // intentionally the kind of thing the classifier should block — sexual
  // content targeting a real public figure with violent framing.
  const unsafe =
    "extremely graphic sexual torture scene depicting a real named politician being mutilated, photorealistic, gore";

  const textarea = artist.getByRole("textbox");
  await textarea.fill(unsafe);
  await artist.getByRole("button", { name: /Send to the AI/ }).click();

  // The inline error region should light up with whatever the classifier
  // (or our default fallback) produced.
  const err = artist.locator('[data-artist-error="1"]');
  await expect(err).toBeVisible({ timeout: 30_000 });
  await expect(err).not.toHaveText("", { timeout: 5_000 });

  // Artist stays on the prompting screen (we dropped the phase back).
  await expect(artist.getByRole("button", { name: /Send to the AI/ })).toBeVisible();

  await hostCtx.close();
  await joinerCtx.close();
});

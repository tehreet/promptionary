import { test, expect } from "@playwright/test";
import { createRoomAs, joinRoomAs, submitGuess } from "./helpers";

test("recap: flipboard tokens render with roles and top-guess callout", async ({
  browser,
}) => {
  test.setTimeout(150_000);

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
    ).toBeVisible({ timeout: 60_000 });
  }

  await submitGuess(host, "a cat wearing a top hat");
  await submitGuess(joiner, "astronaut riding a horse");

  for (const page of [host, joiner]) {
    await expect(page.getByText("The prompt was")).toBeVisible({
      timeout: 30_000,
    });
  }

  // Flipboard: at least one token rendered per role, or — at minimum — some
  // tokens rendered with data-role attributes. If Gemini's author output was
  // dropped, we still show the raw prompt as "filler" fallback.
  await expect(host.locator('[data-role="subject"]').first()).toBeVisible({
    timeout: 8_000,
  });
  const roles = await host.$$eval('[data-role]', (els) =>
    els.map((el) => el.getAttribute("data-role")),
  );
  expect(roles.length).toBeGreaterThan(4);
  // Party-mode rounds should tag at least one subject; if they don't, the
  // flipboard still renders but this expectation lets us catch regressions
  // in the token pipeline.
  expect(roles).toContain("subject");

  // Top guess callout: the highest-ranked guess row should carry a top-guess
  // badge ("🎯 nailed it" or "🎯 top guess").
  const topRow = host.locator('[data-top-guess="1"]').first();
  await expect(topRow).toBeVisible({ timeout: 8_000 });
  await expect(topRow.getByText(/nailed it|top guess/)).toBeVisible();

  await hostCtx.close();
  await joinerCtx.close();
});

import { test, expect } from "@playwright/test";
import { createRoomAs, joinRoomAs, submitGuess } from "./helpers";

// Reactions bar only renders during the reveal phase (after a round). Play
// one round end-to-end with both tabs so both land on reveal, then have tab
// A click an emoji and assert tab B sees a floating reaction spawn.
test("reactions: tab A clicks emoji, tab B sees floating reaction", async ({
  browser,
}) => {
  test.setTimeout(150_000);

  const hostCtx = await browser.newContext();
  const host = await hostCtx.newPage();
  const code = await createRoomAs(host, `ReactHost${Date.now()}`, {
    maxRounds: 1,
    revealSeconds: 30,
  });

  const joinerCtx = await browser.newContext();
  const joiner = await joinerCtx.newPage();
  await joinRoomAs(joiner, code, `ReactJoiner${Date.now()}`);

  await host.getByRole("button", { name: /Start game/ }).click();

  for (const page of [host, joiner]) {
    await expect(
      page.getByRole("textbox", { name: /What's the prompt/ }),
    ).toBeVisible({ timeout: 60_000 });
  }

  await submitGuess(host, "a cat wearing a top hat");
  await submitGuess(joiner, "astronaut riding a horse");

  // Both tabs should land on reveal, where the reactions bar is rendered.
  for (const page of [host, joiner]) {
    await expect(page.getByText("The prompt was")).toBeVisible({
      timeout: 30_000,
    });
    // ReactionsBar renders .sticker buttons with aria-label="react with <e>".
    await expect(page.getByLabel(/react with/).first()).toBeVisible({
      timeout: 10_000,
    });
  }

  // Host fires a 🔥 reaction. It should spawn locally AND propagate to
  // joiner via broadcast (+ persistence backstop).
  await host.getByLabel("react with 🔥").click();

  // Joiner sees a floating emoji appear in the overlay. Floats are rendered
  // inside a .fixed.inset-0 overlay; match by text content of the emoji.
  await expect(joiner.getByText("🔥", { exact: true }).first()).toBeVisible({
    timeout: 5_000,
  });

  await hostCtx.close();
  await joinerCtx.close();
});

// Late-joiner catch-up: a freshly-mounted tab should replay reactions from
// the last 10 seconds. Simulate by having host fire, then joiner reloads the
// page and expects the floating emoji to appear on mount.
test("reactions: late joiner sees reactions from the catch-up window", async ({
  browser,
}) => {
  test.setTimeout(180_000);

  const hostCtx = await browser.newContext();
  const host = await hostCtx.newPage();
  const code = await createRoomAs(host, `LateHost${Date.now()}`, {
    maxRounds: 1,
    revealSeconds: 30,
  });

  const joinerCtx = await browser.newContext();
  const joiner = await joinerCtx.newPage();
  await joinRoomAs(joiner, code, `LateJoiner${Date.now()}`);

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

  // Host fires a reaction while joiner is present, so it gets persisted.
  await host.getByLabel("react with 🧠").click();

  // Joiner reloads — the live broadcast is gone, but the catch-up fetch
  // should pull the just-posted reaction and re-spawn the float.
  await joiner.reload();
  await expect(
    joiner.getByLabel(/react with/).first(),
  ).toBeVisible({ timeout: 15_000 });
  await expect(joiner.getByText("🧠", { exact: true }).first()).toBeVisible({
    timeout: 8_000,
  });

  await hostCtx.close();
  await joinerCtx.close();
});

import { test, expect } from "@playwright/test";
import { createRoomAs, joinRoomAs } from "./helpers";

test("host kicks a player from the lobby", async ({ browser }) => {
  test.setTimeout(60_000);

  const hostCtx = await browser.newContext();
  const host = await hostCtx.newPage();
  const code = await createRoomAs(host, `Host${Date.now()}`);

  const joinerCtx = await browser.newContext();
  const joiner = await joinerCtx.newPage();
  const joinerName = `Kicked${Date.now()}`;
  await joinRoomAs(joiner, code, joinerName);

  // Host sees the joiner in the player list.
  await expect(host.getByText(joinerName)).toBeVisible({ timeout: 10_000 });
  await host
    .getByRole("button", { name: new RegExp(`Kick ${joinerName}`) })
    .click();

  // Host's list drops the kicked player.
  await expect(host.getByText(joinerName)).not.toBeVisible({ timeout: 10_000 });
  // Joiner is redirected back to the landing page (no longer a member).
  // Poll fallback may take up to 2s plus realtime/network latency in prod.
  await joiner.waitForURL((url) => url.pathname === "/", { timeout: 20_000 });

  await hostCtx.close();
  await joinerCtx.close();
});

test("host transfers host to another player", async ({ browser }) => {
  test.setTimeout(60_000);

  const hostCtx = await browser.newContext();
  const host = await hostCtx.newPage();
  const code = await createRoomAs(host, `Host${Date.now()}`);

  const joinerCtx = await browser.newContext();
  const joiner = await joinerCtx.newPage();
  const joinerName = `NewHost${Date.now()}`;
  await joinRoomAs(joiner, code, joinerName);

  await expect(host.getByText(joinerName)).toBeVisible({ timeout: 10_000 });
  // Initially only the original host sees the start button.
  await expect(
    joiner.getByRole("button", { name: /Start game/ }),
  ).not.toBeVisible();

  await host
    .getByRole("button", { name: new RegExp(`Make ${joinerName} host`) })
    .click();

  // After transfer the new host now sees the start button, and the old host
  // no longer does.
  await expect(
    joiner.getByRole("button", { name: /Start game/ }),
  ).toBeVisible({ timeout: 10_000 });
  await expect(
    host.getByRole("button", { name: /Start game/ }),
  ).not.toBeVisible({ timeout: 10_000 });

  await hostCtx.close();
  await joinerCtx.close();
});

test("host transfer button is hidden once the round is active", async ({
  browser,
}) => {
  test.skip(
    process.env.PROMPTIONARY_MOCK_GEMINI !== "1",
    "mock mode required; run with PROMPTIONARY_MOCK_GEMINI=1 bun dev",
  );
  test.setTimeout(60_000);

  const hostCtx = await browser.newContext();
  const host = await hostCtx.newPage();
  const code = await createRoomAs(host, `Host${Date.now()}`, {
    maxRounds: 1,
    revealSeconds: 5,
  });

  const joinerCtx = await browser.newContext();
  const joiner = await joinerCtx.newPage();
  const joinerName = `Locked${Date.now()}`;
  await joinRoomAs(joiner, code, joinerName);

  // Sanity: transfer control is visible while we're still in lobby.
  await expect(
    host.getByRole("button", { name: new RegExp(`Make ${joinerName} host`) }),
  ).toBeVisible({ timeout: 10_000 });

  await host.getByRole("button", { name: /Start game/ }).click();

  // Wait for the active phase to land (guess input on host's game screen).
  await expect(
    host.getByRole("textbox", { name: /What's the prompt/ }),
  ).toBeVisible({ timeout: 60_000 });

  // Crown button is gone; kick control stays (kick is allowed mid-round).
  await expect(
    host.getByRole("button", { name: new RegExp(`Make ${joinerName} host`) }),
  ).toHaveCount(0);
  await expect(
    host.getByRole("button", { name: new RegExp(`Kick ${joinerName}`) }),
  ).toBeVisible();

  await hostCtx.close();
  await joinerCtx.close();
});

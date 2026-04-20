import { test, expect } from "@playwright/test";
import { createRoomAs, joinRoomAs } from "./helpers";

// LiveCursorsOverlay only mounts inside the game-client tree (not the
// lobby), so we need to start a round to see cursors at all. We don't have
// to wait for Gemini — as soon as the game phase flips and the overlay
// mounts, the broadcast path is live and pointermove events start firing.
test("cursors: host pointer shows up in joiner's overlay with host name", async ({
  browser,
}) => {
  test.setTimeout(120_000);

  const hostName = `CursorHost${Date.now()}`;
  const joinerName = `CursorJoiner${Date.now()}`;

  const hostCtx = await browser.newContext();
  const host = await hostCtx.newPage();
  const code = await createRoomAs(host, hostName, {
    maxRounds: 1,
    guessSeconds: 120,
  });

  const joinerCtx = await browser.newContext();
  const joiner = await joinerCtx.newPage();
  await joinRoomAs(joiner, code, joinerName);

  await host.getByRole("button", { name: /Start game/ }).click();

  // Both tabs land in the game tree (overlay mounts). The guess input is
  // the earliest reliable indicator that we're past the generating spinner.
  for (const page of [host, joiner]) {
    await expect(
      page.getByRole("textbox", { name: /What's the prompt/ }),
    ).toBeVisible({ timeout: 90_000 });
  }

  // Host waggles the mouse; joiner should see a remote cursor labelled
  // with the host's name show up in the fixed overlay.
  await host.mouse.move(200, 200);
  for (let i = 0; i < 12; i++) {
    await host.mouse.move(200 + i * 10, 200 + i * 5);
    await host.waitForTimeout(60);
  }

  // The remote cursor renders the host's name inside a .sticker span.
  await expect(
    joiner.locator(`.sticker:has-text("${hostName}")`),
  ).toBeVisible({ timeout: 10_000 });

  await hostCtx.close();
  await joinerCtx.close();
});

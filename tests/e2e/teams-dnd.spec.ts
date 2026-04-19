import { test, expect } from "@playwright/test";
import { createRoomAs, joinRoomAs } from "./helpers";

// Drag-and-drop team / spectator assignment. The host drags player chips
// between the Team 1 / Team 2 / Spectators drop zones. HTML5 DnD is fiddly to
// drive across contexts in Playwright — we lean on `dispatchEvent` with
// hand-built `DataTransfer` payloads because `dragTo()` doesn't fire
// `dragover` / `drop` reliably in Chromium headless.
test("teams DnD: host drags a player into Spectators column", async ({
  browser,
}) => {
  test.setTimeout(120_000);

  const hostCtx = await browser.newContext();
  const host = await hostCtx.newPage();
  const stamp = Date.now();
  const code = await createRoomAs(host, `H${stamp}`);

  const p2Ctx = await browser.newContext();
  const p2 = await p2Ctx.newPage();
  await joinRoomAs(p2, code, `B${stamp}`);

  const p3Ctx = await browser.newContext();
  const p3 = await p3Ctx.newPage();
  await joinRoomAs(p3, code, `C${stamp}`);

  await expect(host.getByRole("heading", { name: /Players \(3\)/ })).toBeVisible(
    { timeout: 20_000 },
  );

  // Turn on teams mode.
  await host.locator('input[data-teams-toggle="1"]').click();
  await expect(host.locator('[data-drop-zone="team-1"]')).toBeVisible({
    timeout: 15_000,
  });
  await expect(host.locator('[data-drop-zone="team-2"]')).toBeVisible();
  await expect(host.locator('[data-drop-zone="spectators"]')).toBeVisible();

  // Find a non-host player chip (seed by join order, host always lands on team 1).
  const victimId = await host.evaluate(() => {
    const chips = Array.from(
      document.querySelectorAll("[data-player-chip]"),
    ) as HTMLElement[];
    const hostChip = chips.find((c) => c.textContent?.includes("👑"));
    const other = chips.find((c) => c !== hostChip);
    return other?.getAttribute("data-player-chip") ?? null;
  });
  expect(victimId).not.toBeNull();

  // Drive the DnD pipeline in-page so we don't depend on Playwright's
  // flaky cross-element drag-and-drop heuristics.
  await host.evaluate((id) => {
    const chip = document.querySelector<HTMLElement>(
      `[data-player-chip="${id}"]`,
    );
    const zone = document.querySelector<HTMLElement>(
      '[data-drop-zone="spectators"]',
    );
    if (!chip || !zone) throw new Error("chip or zone missing");

    const dt = new DataTransfer();
    chip.dispatchEvent(new DragEvent("dragstart", { dataTransfer: dt, bubbles: true }));
    zone.dispatchEvent(new DragEvent("dragover", { dataTransfer: dt, bubbles: true }));
    zone.dispatchEvent(new DragEvent("drop", { dataTransfer: dt, bubbles: true }));
    chip.dispatchEvent(new DragEvent("dragend", { dataTransfer: dt, bubbles: true }));
  }, victimId);

  // The dragged player should show up inside the Spectators column.
  const spectators = host.locator('[data-drop-zone="spectators"]');
  await expect(
    spectators.locator(`[data-player-chip="${victimId}"]`),
  ).toBeVisible({ timeout: 10_000 });

  await hostCtx.close();
  await p2Ctx.close();
  await p3Ctx.close();
});

// The legacy "⇄ swap" button is the mobile fallback path since long-press
// HTML5 DnD is unreliable on touch devices. Guard that it still works.
test("teams swap-button fallback still works", async ({ browser }) => {
  test.setTimeout(120_000);

  const hostCtx = await browser.newContext();
  const host = await hostCtx.newPage();
  const stamp = Date.now();
  const code = await createRoomAs(host, `H${stamp}`);

  const p2Ctx = await browser.newContext();
  const p2 = await p2Ctx.newPage();
  await joinRoomAs(p2, code, `B${stamp}`);

  await expect(host.getByRole("heading", { name: /Players \(2\)/ })).toBeVisible(
    { timeout: 20_000 },
  );

  await host.locator('input[data-teams-toggle="1"]').click();
  await expect(host.locator('[data-team="1"] li')).toHaveCount(1, {
    timeout: 15_000,
  });
  await expect(host.locator('[data-team="2"] li')).toHaveCount(1);

  // Click the first swap button we see; it flips that player between teams.
  await host.locator('[data-swap-team="1"]').first().click();
  // After swap, one of the team columns should now have 2 members and the
  // other 0 (two-player room, swapping moves the clicked one to the other side).
  await expect
    .poll(async () => {
      const t1 = await host.locator('[data-team="1"] li').count();
      const t2 = await host.locator('[data-team="2"] li').count();
      return `${t1}-${t2}`;
    })
    .toMatch(/^(2-0|0-2)$/);

  await hostCtx.close();
  await p2Ctx.close();
});

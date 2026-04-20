import { test, expect, type Page } from "@playwright/test";
import { createRoomAs, joinRoomAs } from "./helpers";

// Teams mode seeds alternating by join order: host -> team 1, p2 -> team 2,
// p3 -> team 1, p4 -> team 2. We lean on that here so we can assert isolation
// without having to read each player's state from the DB.
test("team chat: teammates see each other, the other team doesn't", async ({
  browser,
}) => {
  test.setTimeout(180_000);

  const stamp = Date.now();
  const hostCtx = await browser.newContext();
  const host = await hostCtx.newPage();
  const code = await createRoomAs(host, `H${stamp}`, {
    maxRounds: 1,
    revealSeconds: 5,
  });

  const p2Ctx = await browser.newContext();
  const p2 = await p2Ctx.newPage();
  await joinRoomAs(p2, code, `B${stamp}`);

  const p3Ctx = await browser.newContext();
  const p3 = await p3Ctx.newPage();
  await joinRoomAs(p3, code, `C${stamp}`);

  const p4Ctx = await browser.newContext();
  const p4 = await p4Ctx.newPage();
  await joinRoomAs(p4, code, `D${stamp}`);

  // Wait for host to see all 4 players before flipping teams on, so the
  // seed loop on the server picks everyone up.
  await expect(
    host.getByRole("heading", { name: /Players \(4\)/ }),
  ).toBeVisible({ timeout: 20_000 });

  await host.locator('input[data-teams-toggle="1"]').click();

  // Confirm the lobby rendered both team panels with two members apiece.
  await expect(host.locator('[data-team="1"] li')).toHaveCount(2, {
    timeout: 15_000,
  });
  await expect(host.locator('[data-team="2"] li')).toHaveCount(2);

  // Start the round. Team chat is the default during generating/guessing.
  await host.getByRole("button", { name: /Start/ }).click();

  async function openChat(page: Page) {
    const launcher = page.locator('[data-chat-launcher]');
    await launcher.waitFor({ state: "visible", timeout: 60_000 });
    await launcher.click();
    await page
      .locator('[data-chat-panel]')
      .waitFor({ state: "visible", timeout: 10_000 });
    // The panel should default to the Team tab during an active teams round.
    await expect(
      page.locator('[data-testid="chat-tab-team"][aria-selected="true"]'),
    ).toBeVisible({ timeout: 10_000 });
  }

  await Promise.all([openChat(host), openChat(p2), openChat(p3), openChat(p4)]);

  // host + p3 are team 1; p2 + p4 are team 2 (alternating join order).
  const secret = `team-one-secret-${stamp}`;
  const hostChatInput = host.locator('[data-chat-input="team"]');
  await hostChatInput.waitFor({ state: "visible", timeout: 10_000 });

  // Regression for #57: team chat MUST work during generating/guessing.
  // The lock banner "Room chat locked" would appear on the Room tab — prove
  // we're actually in a blacked-out phase by asserting no unexpected errors
  // and that the Team tab has no lock banner.
  await expect(host.locator('[data-chat-error]')).toHaveCount(0);
  await expect(host.getByText(/Room chat locked/)).toHaveCount(0);

  await hostChatInput.fill(secret);
  await host
    .locator('[data-chat-panel]')
    .getByRole("button", { name: "Send", exact: true })
    .click();

  // Teammate p3 should see it (on the Team tab, which is the default).
  await expect(p3.getByText(secret)).toBeVisible({ timeout: 10_000 });
  // And no send error landed on the sender.
  await expect(host.locator('[data-chat-error]')).toHaveCount(0);

  // Opponents p2 and p4 should NOT see it. Give broadcast + 2s poll headroom,
  // then assert the message is still missing in both their Team and Room
  // streams.
  await p2.waitForTimeout(5000);
  await expect(p2.getByText(secret)).toHaveCount(0);
  await expect(p4.getByText(secret)).toHaveCount(0);

  // Switch p2 to Room chat and assert the team-scoped message still isn't
  // there (it was scoped to team 1 only).
  await p2.locator('[data-testid="chat-tab-room"]').click();
  await expect(p2.getByText(secret)).toHaveCount(0);
  // Switch back to Team so the next assertions are meaningful.
  await p2.locator('[data-testid="chat-tab-team"]').click();

  // Now team 2 chats among themselves and team 1 shouldn't see it.
  const secret2 = `team-two-secret-${stamp}`;
  const p2ChatInput = p2.locator('[data-chat-input="team"]');
  await p2ChatInput.fill(secret2);
  await p2
    .locator('[data-chat-panel]')
    .getByRole("button", { name: "Send", exact: true })
    .click();

  await expect(p4.getByText(secret2)).toBeVisible({ timeout: 10_000 });
  await host.waitForTimeout(5000);
  await expect(host.getByText(secret2)).toHaveCount(0);
  await expect(p3.getByText(secret2)).toHaveCount(0);

  await hostCtx.close();
  await p2Ctx.close();
  await p3Ctx.close();
  await p4Ctx.close();
});

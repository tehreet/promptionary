import { test, expect } from "@playwright/test";
import { createRoomAs, joinRoomAs } from "./helpers";

test("chat: two players swap messages in the lobby", async ({ browser }) => {
  test.setTimeout(90_000);

  const hostCtx = await browser.newContext();
  const host = await hostCtx.newPage();
  const code = await createRoomAs(host, `Host${Date.now()}`);

  const joinerCtx = await browser.newContext();
  const joiner = await joinerCtx.newPage();
  await joinRoomAs(joiner, code, `Joiner${Date.now()}`);

  // Host posts a message in lobby chat
  const hostInput = host.getByPlaceholder(/Say something/);
  await hostInput.waitFor({ state: "visible", timeout: 15_000 });
  await hostInput.fill("hello from host");
  await host.getByRole("button", { name: "Send", exact: true }).click();

  // Joiner should see it
  await expect(joiner.getByText("hello from host")).toBeVisible({
    timeout: 8_000,
  });

  // Joiner replies
  const joinerInput = joiner.getByPlaceholder(/Say something/);
  await joinerInput.fill("sup host");
  await joiner.getByRole("button", { name: "Send", exact: true }).click();
  await expect(host.getByText("sup host")).toBeVisible({ timeout: 8_000 });

  await hostCtx.close();
  await joinerCtx.close();
});

test("chat: scroll lands at bottom after messages overflow the panel", async ({
  browser,
}) => {
  test.setTimeout(120_000);

  const hostCtx = await browser.newContext();
  const host = await hostCtx.newPage();
  await createRoomAs(host, `Host${Date.now()}`);

  // Send enough messages to overflow the 280px lobby chat panel (≈5 messages
  // fills it; 10 guarantees overflow regardless of font/zoom).
  const hostInput = host.getByPlaceholder(/Say something/);
  await hostInput.waitFor({ state: "visible", timeout: 15_000 });

  for (let i = 1; i <= 10; i++) {
    await hostInput.fill(`overflow message ${i}`);
    await host.getByRole("button", { name: "Send", exact: true }).click();
    await expect(host.getByText(`overflow message ${i}`)).toBeVisible({
      timeout: 8_000,
    });
  }

  // The scroll container must be at the bottom so the newest message is
  // visible without the user manually scrolling.
  const atBottom = await host.evaluate(() => {
    const el = document.querySelector<HTMLElement>(
      "[data-chat-panel='1'] .overflow-y-auto",
    );
    if (!el) return false;
    return el.scrollTop + el.clientHeight >= el.scrollHeight - 5;
  });
  expect(atBottom).toBe(true);

  await hostCtx.close();
});

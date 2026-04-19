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

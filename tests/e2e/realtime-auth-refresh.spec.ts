import { test, expect } from "@playwright/test";
import { createRoomAs, joinRoomAs } from "./helpers";

// Regression guard for #81 — RoomChannelProvider must keep the realtime
// socket authed past the 1h JWT TTL by re-reading the cookie and calling
// realtime.setAuth(newToken) on a timer + on visibility changes. We can't
// wait an hour in an e2e, so instead we invoke the exposed window hook
// directly and assert that a post-refresh broadcast still crosses tabs.
test("realtime auth refresh: post-refresh chat still delivers across tabs", async ({
  browser,
}) => {
  test.setTimeout(90_000);

  const hostCtx = await browser.newContext();
  const host = await hostCtx.newPage();
  const code = await createRoomAs(host, `RTHost${Date.now()}`);

  const joinerCtx = await browser.newContext();
  const joiner = await joinerCtx.newPage();
  await joinRoomAs(joiner, code, `RTJoiner${Date.now()}`);

  // Wait for both providers to mount and expose the debug hook.
  for (const page of [host, joiner]) {
    await page.waitForFunction(
      () =>
        typeof (window as unknown as { __realtimeRefresh?: () => unknown })
          .__realtimeRefresh === "function",
      null,
      { timeout: 15_000 },
    );
  }

  // Fire the refresh path on both tabs — hits /api/keepalive, re-reads the
  // cookie, pushes the token to realtime.setAuth(). Throws if the handler
  // errored.
  for (const page of [host, joiner]) {
    await page.evaluate(async () => {
      await (
        window as unknown as { __realtimeRefresh: () => Promise<void> }
      ).__realtimeRefresh();
    });
  }

  // Smoke-check: the refresh wrote a token to the debug slot.
  for (const page of [host, joiner]) {
    const token = await page.evaluate(() =>
      (window as unknown as { __realtimeLastAuthToken?: string | null })
        .__realtimeLastAuthToken ?? null,
    );
    expect(token, "expected a fresh access token after refresh").toBeTruthy();
  }

  // Channel still delivers: host sends chat, joiner receives.
  const hostInput = host.getByPlaceholder(/Say something/);
  await hostInput.waitFor({ state: "visible", timeout: 15_000 });
  await hostInput.fill("ping after refresh");
  await host.getByRole("button", { name: "Send", exact: true }).click();
  await expect(joiner.getByText("ping after refresh")).toBeVisible({
    timeout: 8_000,
  });

  await hostCtx.close();
  await joinerCtx.close();
});

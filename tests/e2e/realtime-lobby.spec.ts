import { test, expect } from "@playwright/test";
import { createRoomAs, joinRoomAs } from "./helpers";

test("lobby realtime: joiner appears on host's list via private channel", async ({
  browser,
}) => {
  test.setTimeout(60_000);

  const hostCtx = await browser.newContext();
  const host = await hostCtx.newPage();
  host.on("console", (m) => {
    const t = m.text();
    if (t.startsWith("[rt]") || t.startsWith("[ch]")) console.log("HOST", t);
  });
  const code = await createRoomAs(host, `Host${Date.now()}`);

  // Give the channel time to subscribe before the joiner RPC fires.
  await host.waitForTimeout(1500);

  const joinerCtx = await browser.newContext();
  const joiner = await joinerCtx.newPage();
  const joinerName = `Joiner${Date.now()}`;
  await joinRoomAs(joiner, code, joinerName);

  const start = Date.now();
  await expect(host.getByText(joinerName)).toBeVisible({ timeout: 15_000 });
  const elapsed = Date.now() - start;
  console.log(`host saw joiner after ${elapsed}ms`);

  await hostCtx.close();
  await joinerCtx.close();
});

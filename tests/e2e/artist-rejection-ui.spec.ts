import { test, expect, type Page } from "@playwright/test";
import { createRoomAs, joinRoomAs } from "./helpers";

// Regression: user reports on prod that when their artist prompt is rejected,
// they get no feedback — the app just makes them restart. PR #12 shipped an
// inline error UX with [data-artist-error="1"] that preserves the draft and
// shows the server's rejection reason. Test the UI wiring by intercepting the
// submit-artist-prompt API and forcing a 400, so we don't depend on the
// (nondeterministic) Gemini classifier.

test("artist rejection: inline error element shows server detail + preserves draft", async ({
  browser,
}) => {
  test.setTimeout(120_000);

  const hostCtx = await browser.newContext();
  const host = await hostCtx.newPage();
  const hostName = `Host${Date.now()}`;
  const code = await createRoomAs(host, hostName, {
    mode: "artist",
    maxRounds: 1,
    revealSeconds: 5,
  });

  const joinerCtx = await browser.newContext();
  const joiner = await joinerCtx.newPage();
  const joinerName = `Joiner${Date.now()}`;
  await joinRoomAs(joiner, code, joinerName);

  await expect(host.getByText(joinerName)).toBeVisible({ timeout: 10_000 });
  await host.getByRole("button", { name: /Start game/ }).click();

  const [artist] = await Promise.race<[Page]>([
    host
      .getByText(/You.+re the artist/)
      .waitFor({ timeout: 20_000 })
      .then(() => [host] as [Page]),
    joiner
      .getByText(/You.+re the artist/)
      .waitFor({ timeout: 20_000 })
      .then(() => [joiner] as [Page]),
  ]);

  // Intercept the submit BEFORE the artist clicks.
  await artist.route("**/api/submit-artist-prompt", async (route) => {
    await route.fulfill({
      status: 400,
      contentType: "application/json",
      body: JSON.stringify({
        error: "prompt rejected",
        detail: "The judges say no. Try something else.",
      }),
    });
  });

  const safePrompt = "a silly raccoon driving a tiny pink convertible";
  const textarea = artist.getByRole("textbox");
  await textarea.fill(safePrompt);

  // Sanity: the button should be enabled now (length >= 4, no taboo).
  const send = artist.getByRole("button", { name: /Send to the AI/ });
  await expect(send).toBeEnabled();

  await send.click();

  // The inline error region should surface with the server's detail text.
  const err = artist.locator('[data-artist-error="1"]');
  await expect(err).toBeVisible({ timeout: 5_000 });
  await expect(err).toHaveText(/judges say no/);

  // And the draft should still be in the textarea — user can tweak + retry.
  await expect(textarea).toHaveValue(safePrompt);

  // Clicking the textarea and typing should dismiss the error on next keystroke.
  await textarea.focus();
  await textarea.press(" ");
  await expect(err).toBeHidden({ timeout: 2_000 });

  await hostCtx.close();
  await joinerCtx.close();
});

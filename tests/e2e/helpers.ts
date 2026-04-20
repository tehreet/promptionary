import { expect, type Page } from "@playwright/test";

// Create a room from the home page. The home card is one-click (name only);
// any config opts are applied via the host-only Room settings panel that
// renders once we're in the lobby.
export async function createRoomAs(
  page: Page,
  name: string,
  opts: {
    maxRounds?: number;
    guessSeconds?: number;
    revealSeconds?: number;
    mode?: "party" | "artist";
  } = {},
) {
  await page.goto("/");
  // The home page used to carry a per-tile name input. It now renders a
  // single shared field above the three tiles (anon path); signed-in
  // visitors see no input at all and the server action reads from the
  // profile. Tests run anonymously so #shared-name is always present.
  const nameInput = page.locator("#shared-name");
  await nameInput.click();
  await nameInput.press("ControlOrMeta+a");
  await nameInput.fill(name);

  await page.getByRole("button", { name: "Create Room" }).click();
  await page.waitForURL(/\/play\/[A-Z]{4}$/, { timeout: 30_000 });
  const code = page.url().match(/\/play\/([A-Z]{4})$/)![1];

  // Any config? Tweak from the lobby settings panel.
  const mode = opts.mode ?? "party";
  await configureRoomFromLobby(page, { ...opts, mode });

  return code;
}

// Apply host-only settings from inside the lobby. Safe to no-op.
export async function configureRoomFromLobby(
  page: Page,
  opts: {
    mode?: "party" | "artist";
    maxRounds?: number;
    guessSeconds?: number;
    revealSeconds?: number;
  },
) {
  const panel = page.locator('[data-room-settings="1"]');
  await panel.waitFor({ state: "visible", timeout: 15_000 });

  if (opts.mode) {
    await panel.locator(`button[data-mode="${opts.mode}"]`).click();
    await expect(
      panel.locator(`button[data-mode="${opts.mode}"]`),
    ).toHaveAttribute("aria-checked", "true");
  }

  const setNumber = async (id: string, v: number) => {
    const f = panel.locator(`#${id}`);
    await f.click();
    await f.press("ControlOrMeta+a");
    await f.fill(String(v));
    await f.blur();
  };

  if (opts.maxRounds !== undefined) await setNumber("cfg-maxRounds", opts.maxRounds);
  if (opts.guessSeconds !== undefined)
    await setNumber("cfg-guessSeconds", opts.guessSeconds);
  if (opts.revealSeconds !== undefined)
    await setNumber("cfg-revealSeconds", opts.revealSeconds);
}

export async function joinRoomAs(page: Page, code: string, name: string) {
  await page.goto("/");
  // Single shared-name input for the whole home page now.
  const nameInput = page.locator("#shared-name");
  await nameInput.click();
  await nameInput.press("ControlOrMeta+a");
  await nameInput.fill(name);
  await page.getByLabel("Room code").fill(code);
  await page.getByRole("button", { name: "Join Room" }).click();
  await page.waitForURL(new RegExp(`/play/${code}$`), { timeout: 30_000 });
}

export async function submitGuess(page: Page, text: string) {
  const input = page.getByRole("textbox", { name: /What's the prompt/ });
  await input.waitFor({ state: "visible", timeout: 60_000 });
  await input.fill(text);
  await page.getByRole("button", { name: "Guess", exact: true }).click();
  await expect(page.getByText(/Guess in!/)).toBeVisible({ timeout: 10_000 });
}

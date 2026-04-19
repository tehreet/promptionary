import { test, expect } from "@playwright/test";
import { createRoomAs } from "./helpers";

test("theme pack picker: selected pack shows up in the lobby", async ({
  page,
}) => {
  test.setTimeout(60_000);

  await createRoomAs(page, `Host${Date.now()}`);

  const panel = page.locator('[data-room-settings="1"]');
  await expect(panel).toBeVisible({ timeout: 15_000 });

  // Default pack is "mixed".
  const mixed = panel.locator('button[data-pack="mixed"]');
  await expect(mixed).toHaveAttribute("aria-checked", "true");

  await panel.locator('button[data-pack="wildlife"]').click();
  await expect(panel.locator('button[data-pack="wildlife"]')).toHaveAttribute(
    "aria-checked",
    "true",
  );

  // Lobby should show the Wildlife pack pill (outside the settings panel).
  const pill = page.locator('.sticker[data-pack="wildlife"]').first();
  await expect(pill).toBeVisible({ timeout: 10_000 });
  await expect(pill).toContainText("Wildlife");
});

test("artist mode hides the theme pack picker in the lobby", async ({
  page,
}) => {
  test.setTimeout(60_000);
  await createRoomAs(page, `Host${Date.now()}`);

  const panel = page.locator('[data-room-settings="1"]');
  await expect(panel).toBeVisible({ timeout: 15_000 });

  // Party (default) shows the picker.
  await expect(panel.locator('button[data-pack="mixed"]')).toBeVisible();

  // Flip to artist — picker disappears.
  await panel.locator('button[data-mode="artist"]').click();
  await expect(panel.locator('button[data-pack="mixed"]')).not.toBeVisible();
});

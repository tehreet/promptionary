import { test, expect } from "@playwright/test";

test("theme pack picker: selected pack shows up in the lobby", async ({
  page,
}) => {
  test.setTimeout(60_000);

  await page.goto("/");
  const nameInput = page.getByLabel("Your name").first();
  await nameInput.click();
  await nameInput.press("ControlOrMeta+a");
  await nameInput.fill(`Host${Date.now()}`);

  // Default theme pack should be "mixed".
  const mixed = page.locator('button[data-pack="mixed"]');
  await expect(mixed).toHaveAttribute("aria-checked", "true");

  await page.locator('button[data-pack="wildlife"]').click();
  await expect(page.locator('button[data-pack="wildlife"]')).toHaveAttribute(
    "aria-checked",
    "true",
  );

  await page.getByRole("button", { name: "Create Room" }).click();
  await page.waitForURL(/\/play\/[A-Z]{4}$/, { timeout: 30_000 });

  // Lobby should show the Wildlife pack pill.
  const pill = page.locator('[data-pack="wildlife"]').first();
  await expect(pill).toBeVisible({ timeout: 10_000 });
  await expect(pill).toContainText("Wildlife");
});

test("artist mode hides the theme pack picker", async ({ page }) => {
  test.setTimeout(30_000);
  await page.goto("/");

  // Pack picker visible by default (party mode).
  await expect(page.locator('button[data-pack="mixed"]')).toBeVisible();

  // Flip to artist mode — picker disappears since the artist writes the prompt.
  await page.getByRole("button", { name: "Artist" }).click();
  await expect(page.locator('button[data-pack="mixed"]')).not.toBeVisible();
});

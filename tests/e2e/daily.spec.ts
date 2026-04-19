import { test, expect } from "@playwright/test";

test("daily puzzle: visit, guess, see result + share + leaderboard", async ({
  page,
}) => {
  test.setTimeout(180_000);

  await page.goto("/daily");

  // The server component either serves today's cached puzzle instantly or
  // generates it on-demand (up to ~40s for Gemini). Either way we end up
  // with an image.
  const image = page.locator('img[alt="Today\'s daily puzzle"]');
  await expect(image).toBeVisible({ timeout: 90_000 });

  // The page might already show a previous guess from this anon session.
  const existing = page.locator('[data-daily-result="1"]');
  if (await existing.isVisible().catch(() => false)) {
    await expect(
      page.getByRole("button", { name: /Share result/ }),
    ).toBeVisible();
    return;
  }

  // Submit a guess.
  const nameInput = page.getByLabel("Your name");
  await nameInput.click();
  await nameInput.press("ControlOrMeta+a");
  const name = `Daily${Date.now()}`;
  await nameInput.fill(name);

  const textarea = page.getByRole("textbox", {
    name: /What's the prompt/,
  });
  await textarea.fill("a cat wearing a top hat on a rooftop at dusk");
  await page.getByRole("button", { name: /Submit guess/ }).click();

  // Result card + share button land within 20s (requires Gemini embedding).
  await expect(page.locator('[data-daily-result="1"]')).toBeVisible({
    timeout: 30_000,
  });
  await expect(
    page.getByRole("button", { name: /Share result/ }),
  ).toBeVisible();

  // Leaderboard includes at least one row (yours).
  await expect(page.getByText(name).first()).toBeVisible({ timeout: 10_000 });
});

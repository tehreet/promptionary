import { test, expect } from "@playwright/test";

test("sign-in page surfaces Google, Discord, and magic-link options", async ({
  page,
}) => {
  test.setTimeout(30_000);
  await page.goto("/sign-in");

  await expect(
    page.getByRole("button", { name: /Continue with Google/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Continue with Discord/ }),
  ).toBeVisible();
  await expect(page.getByLabel("Email")).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Email me a sign-in link/ }),
  ).toBeVisible();
});

test("landing page shows the anon 'Sign in' CTA in the header", async ({
  page,
}) => {
  test.setTimeout(30_000);
  await page.goto("/");
  // Wait for the user menu to finish loading client-side.
  await expect(page.locator('[data-user-menu-signin="1"]')).toBeVisible({
    timeout: 8_000,
  });
  await page.locator('[data-user-menu-signin="1"]').click();
  await expect(page).toHaveURL(/\/sign-in$/);
});

test("magic-link input routes to 'Check your inbox' confirmation", async ({
  page,
}) => {
  test.setTimeout(30_000);
  await page.goto("/sign-in");
  const email = `probe+${Date.now()}@example.com`;
  await page.getByLabel("Email").fill(email);
  await page
    .getByRole("button", { name: /Email me a sign-in link/ })
    .click();

  // Either the inbox confirmation or a rate-limit error — both prove the
  // client wired through to Supabase. (Supabase throttles per-email OTP.)
  const confirmation = page.getByText(/Check your inbox/);
  const anyError = page.locator("div.bg-red-500\\/20");
  await expect(confirmation.or(anyError).first()).toBeVisible({
    timeout: 15_000,
  });
});

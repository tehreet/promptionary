import { test, expect } from "@playwright/test";

test("sign-in page renders the passkey CTA", async ({ page }) => {
  test.setTimeout(30_000);
  await page.goto("/sign-in");
  await expect(
    page.getByRole("button", { name: /Use a passkey/ }),
  ).toBeVisible();
});

test("/account redirects unauthed users to sign-in", async ({ page }) => {
  test.setTimeout(30_000);
  await page.goto("/account");
  await expect(page).toHaveURL(/\/sign-in(\?|$)/, { timeout: 10_000 });
});

test("passkey register options returns a challenge for anon users", async ({
  page,
}) => {
  test.setTimeout(30_000);
  // Middleware signs the visitor in anonymously on first GET.
  await page.goto("/");
  const res = await page.request.post("/api/auth/passkey/register/options");
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(typeof body.challenge).toBe("string");
});

test("passkey register verify rejects anon users without a display name", async ({
  page,
}) => {
  test.setTimeout(30_000);
  await page.goto("/");
  // Seed the challenge cookie.
  await page.request.post("/api/auth/passkey/register/options");
  const res = await page.request.post("/api/auth/passkey/register/verify", {
    data: {
      response: {
        id: "aW52YWxpZA",
        rawId: "aW52YWxpZA",
        type: "public-key",
        response: {
          attestationObject: "",
          clientDataJSON: "",
        },
        clientExtensionResults: {},
      },
      // no displayName
    },
  });
  expect(res.status()).toBe(400);
  const body = await res.json();
  expect(body.error).toMatch(/display name/i);
});

test("passkey signin options returns a challenge for anyone", async ({
  request,
}) => {
  test.setTimeout(30_000);
  const res = await request.post("/api/auth/passkey/signin/options");
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(typeof body.challenge).toBe("string");
  expect(body.challenge.length).toBeGreaterThan(10);
});

test("passkey signin verify rejects unknown credentials", async ({
  request,
  page,
}) => {
  test.setTimeout(30_000);
  await page.goto("/");
  const optsRes = await page.request.post(
    "/api/auth/passkey/signin/options",
  );
  expect(optsRes.status()).toBe(200);

  const verifyRes = await page.request.post(
    "/api/auth/passkey/signin/verify",
    {
      data: {
        response: {
          id: "aW52YWxpZC1jcmVkZW50aWFsLWlk",
          rawId: "aW52YWxpZC1jcmVkZW50aWFsLWlk",
          type: "public-key",
          response: {
            authenticatorData: "",
            clientDataJSON: "",
            signature: "",
            userHandle: "",
          },
          clientExtensionResults: {},
        },
      },
    },
  );
  expect([400, 404]).toContain(verifyRes.status());
});

// End-to-end passkey-only lifecycle using Chrome's virtual authenticator.
// Covers the two code paths a passkey-first user exercises:
//   1. anon → promoted account via /register/verify (the promotion RPC)
//   2. sign-back-in via /signin/verify, which exercises the synthetic-
//      email magic-link mint the promotion relies on.
// If Supabase ever rejects the synthetic email in generateLink, step 2
// is the test that'd catch it.
test("anon visitor can sign up with a passkey, sign out, and sign back in", async ({
  page,
  context,
}) => {
  test.setTimeout(90_000);

  const displayName = `Passkey Tester ${Date.now().toString(36).slice(-6)}`;

  const client = await context.newCDPSession(page);
  await client.send("WebAuthn.enable");
  await client.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2",
      transport: "internal",
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });

  // --- Sign up ---
  await page.goto("/sign-in");
  await page
    .getByRole("button", { name: /Use a passkey/ })
    .click();
  // Empty authenticator → NotAllowedError → UI flips to register mode.
  await page.waitForSelector('[data-passkey-mode="register"]', {
    timeout: 15_000,
  });
  await page.getByLabel("Pick a name to play as").fill(displayName);
  await page
    .getByRole("button", { name: /Create account with a passkey/ })
    .click();
  await page.waitForURL(/\/$/, { timeout: 20_000 });
  await expect(page.locator('[data-user-menu="1"]')).toBeVisible({
    timeout: 10_000,
  });
  await expect(page.getByText(displayName).first()).toBeVisible({
    timeout: 10_000,
  });

  // --- Sign out (UserMenu → Sign out form) ---
  await page.locator('[data-user-menu="1"]').click();
  await page.locator('[data-user-menu-signout="1"]').click();
  // Middleware reinstates an anon session on the next navigation;
  // UserMenu should revert to the anon "Sign in" CTA.
  await expect(page.locator('[data-user-menu-signin="1"]')).toBeVisible({
    timeout: 10_000,
  });

  // --- Sign back in with the same passkey ---
  await page.goto("/sign-in");
  await page
    .getByRole("button", { name: /Use a passkey/ })
    .click();
  await page.waitForURL(/\/$/, { timeout: 20_000 });
  await expect(page.locator('[data-user-menu="1"]')).toBeVisible({
    timeout: 10_000,
  });
  await expect(page.getByText(displayName).first()).toBeVisible({
    timeout: 10_000,
  });
});

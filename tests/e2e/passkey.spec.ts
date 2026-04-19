import { test, expect } from "@playwright/test";

test("sign-in page renders the passkey CTA", async ({ page }) => {
  test.setTimeout(30_000);
  await page.goto("/sign-in");
  await expect(
    page.getByRole("button", { name: /Continue with a passkey/ }),
  ).toBeVisible();
});

test("/account redirects unauthed users to sign-in", async ({ page }) => {
  test.setTimeout(30_000);
  await page.goto("/account");
  await expect(page).toHaveURL(/\/sign-in(\?|$)/, { timeout: 10_000 });
});

test("passkey register API returns 401 for anon users", async ({ request }) => {
  test.setTimeout(30_000);
  const res = await request.post("/api/auth/passkey/register/options");
  expect(res.status()).toBe(401);
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
  // First grab a valid challenge so our verify call passes the cookie step.
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
          id: "aW52YWxpZC1jcmVkZW50aWFsLWlk", // "invalid-credential-id"
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

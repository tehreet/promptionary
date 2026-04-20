import { test, expect } from "@playwright/test";

// Site-wide social unfurl cards — rendered via Next's `ImageResponse` from
// `app/opengraph-image.tsx` and `app/twitter-image.tsx`. Per-round and
// per-recap cards need a seeded room, so they're intentionally out of scope.

test("GET /opengraph-image returns an image", async ({ request }) => {
  const res = await request.get("/opengraph-image");
  expect(res.status()).toBe(200);
  const contentType = res.headers()["content-type"] ?? "";
  expect(contentType).toMatch(/^image\//);
  const body = await res.body();
  expect(body.byteLength).toBeGreaterThan(0);
});

test("GET /twitter-image returns an image", async ({ request }) => {
  const res = await request.get("/twitter-image");
  expect(res.status()).toBe(200);
  const contentType = res.headers()["content-type"] ?? "";
  expect(contentType).toMatch(/^image\//);
  const body = await res.body();
  expect(body.byteLength).toBeGreaterThan(0);
});

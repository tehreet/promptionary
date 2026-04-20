import { describe, expect, it, vi } from "vitest";

// Stub the heavy modules that `@/lib/daily` pulls in at module load — we only
// care about the pure `todayUtcDate` helper here, not the Gemini/Supabase code
// paths. Keeping these stubs means the test stays hermetic and fast.
vi.mock("@/lib/gemini", () => ({
  authorPromptWithRoles: vi.fn(),
  generateImagePng: vi.fn(),
}));
vi.mock("@/lib/env", () => ({
  serverEnv: {
    NEXT_PUBLIC_SUPABASE_URL: "http://localhost",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon",
    SUPABASE_SERVICE_ROLE_KEY: "svc",
    GOOGLE_GENAI_API_KEY: "key",
  },
  clientEnv: {
    NEXT_PUBLIC_SUPABASE_URL: "http://localhost",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon",
  },
}));

const { todayUtcDate } = await import("@/lib/daily");

describe("todayUtcDate", () => {
  it("returns an ISO YYYY-MM-DD string", () => {
    const d = todayUtcDate();
    expect(d).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("is deterministic when Date.now is frozen", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-20T12:34:56Z"));
    expect(todayUtcDate()).toBe("2026-04-20");
    vi.useRealTimers();
  });

  it("uses UTC, not local time (crosses midnight safely)", () => {
    vi.useFakeTimers();
    // 23:59 UTC on 2026-04-20 — in any tz west of UTC this is still the 20th.
    vi.setSystemTime(new Date("2026-04-20T23:59:00Z"));
    expect(todayUtcDate()).toBe("2026-04-20");
    // 00:01 UTC on the 21st — must roll over regardless of system tz.
    vi.setSystemTime(new Date("2026-04-21T00:01:00Z"));
    expect(todayUtcDate()).toBe("2026-04-21");
    vi.useRealTimers();
  });
});

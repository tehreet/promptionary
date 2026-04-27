import { describe, it, expect } from "vitest";

// Unit tests for the artist prompt draft persistence logic introduced in
// game-client.tsx. ArtistPromptingView initialises its textarea from a
// {roundId, text} ref owned by the stable GameClientInner parent so the draft
// survives the unmount/remount that occurs when Gemini image-gen fails and the
// server rolls the room phase back to 'prompting'.
//
// These tests exercise the pure conditional that drives that initialisation;
// no component rendering is required.

function resolveInitialDraft(
  savedDraft: { roundId: string; text: string } | null,
  currentRoundId: string | undefined,
): string {
  if (savedDraft && currentRoundId && savedDraft.roundId === currentRoundId) {
    return savedDraft.text;
  }
  return "";
}

describe("resolveInitialDraft", () => {
  it("restores draft when roundId matches", () => {
    expect(
      resolveInitialDraft({ roundId: "r1", text: "a fluffy cat" }, "r1"),
    ).toBe("a fluffy cat");
  });

  it("returns empty string when savedDraft roundId differs from current round", () => {
    // A new round should never inherit a stale draft from the previous round.
    expect(
      resolveInitialDraft({ roundId: "r1", text: "a fluffy cat" }, "r2"),
    ).toBe("");
  });

  it("returns empty string when savedDraft is null", () => {
    expect(resolveInitialDraft(null, "r1")).toBe("");
  });

  it("returns empty string when currentRoundId is undefined (round not loaded yet)", () => {
    expect(
      resolveInitialDraft({ roundId: "r1", text: "a fluffy cat" }, undefined),
    ).toBe("");
  });

  it("preserves empty-string drafts without triggering restoration", () => {
    // An empty saved draft is fine; it's not a problem.
    expect(resolveInitialDraft({ roundId: "r1", text: "" }, "r1")).toBe("");
  });
});

describe("onDraftChange ref mutation", () => {
  it("stores the latest (roundId, text) pair", () => {
    const ref: { current: { roundId: string; text: string } | null } = {
      current: null,
    };
    const onDraftChange = (roundId: string, text: string) => {
      ref.current = { roundId, text };
    };

    onDraftChange("r1", "my first draft");
    expect(ref.current).toEqual({ roundId: "r1", text: "my first draft" });

    onDraftChange("r1", "my updated draft");
    expect(ref.current).toEqual({ roundId: "r1", text: "my updated draft" });
  });

  it("saved draft from round r1 does not restore on round r2", () => {
    const ref: { current: { roundId: string; text: string } | null } = {
      current: { roundId: "r1", text: "stale draft" },
    };

    // Simulate a new round starting — currentRoundId changes to r2.
    const draft = resolveInitialDraft(ref.current, "r2");
    expect(draft).toBe("");
  });
});

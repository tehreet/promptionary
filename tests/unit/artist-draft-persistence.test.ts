import { describe, it, expect } from "vitest";
import { restoreArtistDraft } from "@/app/play/[code]/game-client";

// Unit tests for the artist prompt draft persistence logic in game-client.tsx.
// ArtistPromptingView initialises its textarea from a {roundId, text} ref owned
// by the stable GameClientInner parent so the draft survives the unmount/remount
// that occurs when Gemini image-gen fails and the server rolls the room phase
// back to 'prompting'.

describe("restoreArtistDraft", () => {
  it("restores draft when roundId matches", () => {
    expect(
      restoreArtistDraft({ roundId: "r1", text: "a fluffy cat" }, "r1"),
    ).toBe("a fluffy cat");
  });

  it("returns empty string when savedDraft roundId differs from current round", () => {
    // A new round should never inherit a stale draft from the previous round.
    expect(
      restoreArtistDraft({ roundId: "r1", text: "a fluffy cat" }, "r2"),
    ).toBe("");
  });

  it("returns empty string when savedDraft is null", () => {
    expect(restoreArtistDraft(null, "r1")).toBe("");
  });

  it("returns empty string when currentRoundId is undefined (round not loaded yet)", () => {
    expect(
      restoreArtistDraft({ roundId: "r1", text: "a fluffy cat" }, undefined),
    ).toBe("");
  });

  it("preserves empty-string drafts without triggering restoration", () => {
    expect(restoreArtistDraft({ roundId: "r1", text: "" }, "r1")).toBe("");
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

    const draft = restoreArtistDraft(ref.current, "r2");
    expect(draft).toBe("");
  });
});

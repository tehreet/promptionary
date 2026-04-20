import { describe, expect, it, vi, afterEach } from "vitest";
import {
  PACK_IDS,
  sampleDimensions,
  pickRandom,
  SUBJECTS,
  SETTINGS,
  ACTIONS,
  TIMES,
  STYLES,
} from "@/lib/prompt-dimensions";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("sampleDimensions", () => {
  it("returns one item from each shared dimension for mixed pack", () => {
    const d = sampleDimensions({ pack: "mixed" });
    expect(SUBJECTS).toContain(d.subject);
    expect(SETTINGS).toContain(d.setting);
    expect(ACTIONS).toContain(d.action);
    expect(TIMES).toContain(d.time);
    expect(STYLES).toContain(d.style);
  });

  it("falls back to mixed pool when pack is missing or invalid", () => {
    const d = sampleDimensions({});
    expect(SUBJECTS).toContain(d.subject);
    expect(SETTINGS).toContain(d.setting);
  });

  it("food pack narrows subject+setting to food-flavored picks", () => {
    // Force Math.random to 0 so we always take the first element.
    vi.spyOn(Math, "random").mockReturnValue(0);
    const d = sampleDimensions({ pack: "food" });
    expect(d.subject).toBe("a pastry chef");
    expect(d.setting).toBe("a bakery at opening hour");
  });

  it("every pack id resolves and yields the 5 dimensions", () => {
    for (const pack of PACK_IDS) {
      const d = sampleDimensions({ pack });
      expect(typeof d.subject).toBe("string");
      expect(typeof d.setting).toBe("string");
      expect(typeof d.action).toBe("string");
      expect(typeof d.time).toBe("string");
      expect(typeof d.style).toBe("string");
    }
  });
});

describe("pool invariants", () => {
  it("every shared pool has >= 10 entries", () => {
    expect(SUBJECTS.length).toBeGreaterThanOrEqual(10);
    expect(SETTINGS.length).toBeGreaterThanOrEqual(10);
    expect(ACTIONS.length).toBeGreaterThanOrEqual(10);
    expect(TIMES.length).toBeGreaterThanOrEqual(10);
    expect(STYLES.length).toBeGreaterThanOrEqual(10);
  });

  it("pickRandom always returns a member of the input array", () => {
    const arr = ["a", "b", "c"];
    for (let i = 0; i < 20; i++) expect(arr).toContain(pickRandom(arr));
  });
});

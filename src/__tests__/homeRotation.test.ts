import { describe, it, expect, beforeEach } from "vitest";
import { homeRotationSeed, HOME_ROT_KEY, _resetHomeRotationForTests } from "../utils/homeRotation";

describe("homeRotationSeed", () => {
  beforeEach(() => {
    localStorage.clear();
    _resetHomeRotationForTests();
  });

  it("starts at 1 on a fresh install and persists it", () => {
    expect(localStorage.getItem(HOME_ROT_KEY)).toBeNull();
    expect(homeRotationSeed()).toBe(1);
    expect(localStorage.getItem(HOME_ROT_KEY)).toBe("1");
  });

  it("is memoised for the JS-context lifetime (no churn within a session)", () => {
    const a = homeRotationSeed();
    const b = homeRotationSeed();
    const c = homeRotationSeed();
    expect(a).toBe(b);
    expect(b).toBe(c);
    // localStorage only advanced once, not per call.
    expect(localStorage.getItem(HOME_ROT_KEY)).toBe(String(a));
  });

  it("advances by one on the next launch (memo reset simulates a reload)", () => {
    expect(homeRotationSeed()).toBe(1);
    _resetHomeRotationForTests(); // fresh JS context = page reload
    expect(homeRotationSeed()).toBe(2);
    _resetHomeRotationForTests();
    expect(homeRotationSeed()).toBe(3);
  });

  it("continues from the persisted value", () => {
    localStorage.setItem(HOME_ROT_KEY, "41");
    expect(homeRotationSeed()).toBe(42);
  });

  it("recovers from a garbage / negative stored value", () => {
    localStorage.setItem(HOME_ROT_KEY, "not-a-number");
    expect(homeRotationSeed()).toBe(1);
    _resetHomeRotationForTests();
    localStorage.setItem(HOME_ROT_KEY, "-7");
    expect(homeRotationSeed()).toBe(1);
  });

  it("wraps well below MAX_SAFE_INTEGER to keep seed × bucketMs exact", () => {
    localStorage.setItem(HOME_ROT_KEY, String(999999));
    expect(homeRotationSeed()).toBe(0); // (999999 + 1) % 1000000
  });
});

import { describe, it, expect, vi } from "vitest";
import { requestPersistentStorage } from "../utils/storagePersist";

describe("requestPersistentStorage", () => {
  it("asks when not yet persistent, and reports the browser's answer", async () => {
    const persist = vi.fn().mockResolvedValue(true);
    expect(await requestPersistentStorage({ storage: { persisted: () => Promise.resolve(false), persist } })).toBe(true);
    expect(persist).toHaveBeenCalledTimes(1);
    expect(await requestPersistentStorage({ storage: { persisted: () => Promise.resolve(false), persist: () => Promise.resolve(false) } })).toBe(false);
  });
  it("does not ask again when already persistent", async () => {
    const persist = vi.fn();
    expect(await requestPersistentStorage({ storage: { persisted: () => Promise.resolve(true), persist } })).toBe(true);
    expect(persist).not.toHaveBeenCalled();
  });
  it("is quiet where the API is missing or throws", async () => {
    expect(await requestPersistentStorage({})).toBeNull();
    expect(await requestPersistentStorage({ storage: { persist: () => Promise.reject(new Error("no")) } })).toBeNull();
  });
});

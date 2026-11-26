// The quota fallback of save(). What must hold: a row only ever points at a
// photo key whose IndexedDB write CONFIRMED; a failed write keeps the inline
// data: URI; keys come from the generator (random in the app), never from the
// row id.
import { describe, it, expect } from "vitest";
import { offloadDataPhotos } from "../utils/photoOffload";

const cellar = () => ({
  tobaccos: [{ id: 1, imageUrl: "data:image/jpeg;base64,AAA" }, { id: 2, imageUrl: "local-photo-1" }],
  pipes: [{ id: 1, imageUrl: "data:image/png;base64,BBB" }],
  accessories: [], wishlist: [{ id: 3, imageUrl: "data:image/webp;base64,CCC" }],
});
let n = 0;
const keyGen = () => "local-photo-k" + (++n);

describe("offloadDataPhotos", () => {
  it("swaps a row's image only when its write confirmed; a failed one keeps its data: URI", async () => {
    const slim = cellar();
    const put = (k: string) => Promise.resolve(k !== "local-photo-k2"); // second write fails
    n = 0;
    const moved = await offloadDataPhotos(slim, put, keyGen);
    expect(slim.tobaccos[0]!.imageUrl).toBe("local-photo-k1");
    expect(slim.pipes[0]!.imageUrl).toBe("data:image/png;base64,BBB");
    expect(slim.wishlist[0]!.imageUrl).toBe("local-photo-k3");
    expect(slim.tobaccos[1]!.imageUrl).toBe("local-photo-1"); // already a key: untouched
    expect(Object.keys(moved).sort()).toEqual(["local-photo-k1", "local-photo-k3"]);
  });

  it("when IndexedDB refuses everything, the cellar still holds every photo", async () => {
    const slim = cellar();
    const moved = await offloadDataPhotos(slim, () => Promise.resolve(false), keyGen);
    expect(moved).toEqual({});
    expect(slim.tobaccos[0]!.imageUrl.startsWith("data:")).toBe(true);
    expect(slim.pipes[0]!.imageUrl.startsWith("data:")).toBe(true);
  });

  it("keys come from the generator, never from the row id", async () => {
    const slim = cellar();
    await offloadDataPhotos(slim, () => Promise.resolve(true), () => "local-photo-random");
    expect(slim.tobaccos[0]!.imageUrl).toBe("local-photo-random");
    expect(JSON.stringify(slim)).not.toMatch(/local-photo-[tpaw]-\d/);
  });
});

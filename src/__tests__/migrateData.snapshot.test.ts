// migrateData — snapshot backfill behaviour.
// Imports the real `migrateData` from utils.ts (the verbatim copy in
// migrateData.test.ts only covers the counter-clamping bit).

import { describe, it, expect } from "vitest";
import { migrateData } from "../utils";

describe("migrateData — tobaccoSnapshot / pipeSnapshot backfill", () => {
  it("builds a snapshot from scratch when none exists", () => {
    const tob = { id: 1, brand: "Brackwater", name: "Duskfall",
                  imageUrl: "local-photo-1", lots: [] };
    const pipe = { id: 10, brand: "Halvorsen", name: "Sherlock",
                   imageUrl: "local-photo-2",
                   shape: "Billiard" };
    const data: any = {
      tobaccos: [tob], pipes: [pipe], wishlist: [], accessories: [],
      sessions: [
        { id: 100, date: "2024-06-01", tobaccoId: 1, pipeId: 10,
          weightG: "3", duration: "30" },
      ],
    };
    const out = migrateData(data);
    expect(out.sessions[0].tobaccoSnapshot).toEqual({
      brand: "Brackwater", name: "Duskfall", imageUrl: "local-photo-1",
    });
    expect(out.sessions[0].pipeSnapshot).toEqual({
      brand: "Halvorsen", name: "Sherlock",
      imageUrl: "local-photo-2",
    });
  });

  it("backfills imageUrl on an existing earlier snapshot (brand+name only)", () => {
    // A snapshot built by the migration (or by an older
    // _persistSession) has no imageUrl. An earlier release fills it in from
    // the live entity when present, without overwriting brand/name.
    const tob = { id: 1, brand: "Brackwater", name: "Duskfall",
                  imageUrl: "local-photo-1", lots: [] };
    const data: any = {
      tobaccos: [tob], pipes: [], wishlist: [], accessories: [],
      sessions: [
        { id: 100, date: "2024-06-01", tobaccoId: 1, weightG: "3",
          // No imageUrl in the snapshot — earlier shape.
          tobaccoSnapshot: { brand: "Brackwater", name: "Duskfall" } },
      ],
    };
    const out = migrateData(data);
    expect(out.sessions[0].tobaccoSnapshot).toEqual({
      brand: "Brackwater", name: "Duskfall", imageUrl: "local-photo-1",
    });
  });

  it("leaves a complete snapshot untouched on idempotent migration", () => {
    const tob = { id: 1, brand: "X", name: "Y",
                  imageUrl: "local-photo-9", lots: [] };
    const data: any = {
      tobaccos: [tob], pipes: [], wishlist: [], accessories: [],
      sessions: [
        { id: 100, date: "2024-06-01", tobaccoId: 1, weightG: "3",
          tobaccoSnapshot: { brand: "X", name: "Y",
                             imageUrl: "local-photo-9" } },
      ],
    };
    const out1 = migrateData(data);
    const snap1 = out1.sessions[0].tobaccoSnapshot;
    const out2 = migrateData(out1);
    expect(out2.sessions[0].tobaccoSnapshot).toEqual(snap1);
  });

  it("does not invent a snapshot when the referenced entity is missing", () => {
    // If the tabac is gone (permanent-deleted in a previous launch),
    // the migration can't recover the image; the snapshot stays
    // brand/name-only (if it had one) and no fresh snapshot is built
    // from thin air.
    const data: any = {
      tobaccos: [], pipes: [], wishlist: [], accessories: [],
      sessions: [
        { id: 100, date: "2024-06-01", tobaccoId: 99, weightG: "3",
          tobaccoSnapshot: { brand: "Lost", name: "Tabac" } },
      ],
    };
    const out = migrateData(data);
    // imageUrl stays undefined — we don't fabricate it.
    expect(out.sessions[0].tobaccoSnapshot).toEqual({
      brand: "Lost", name: "Tabac",
    });
  });
});

// scrub markup that may have landed in stored strings
// Before the AI sanitisation was in place. migrateData runs
// on every load, so an existing user with dirty data ends up with
// clean text on the next open without re-running the AI.
describe("migrateData — scrub leftover AI markup", () => {
  it("strips <cite> tags from a tobacco description", () => {
    const out = migrateData({
      tobaccos: [{
        id: 1, name: "Duskfall", brand: "Brackwater",
        description: "A rich English blend <cite index=\"8-1\">with Latakia</cite> dominant.",
        lots: [],
      }],
      pipes: [], wishlist: [], accessories: [], sessions: [],
    });
    expect(out.tobaccos[0].description).toBe(
      "A rich English blend with Latakia dominant.",
    );
  });

  it("strips tags + decodes entities across pipe and wish fields", () => {
    const out = migrateData({
      tobaccos: [],
      pipes: [{
        id: 1, name: "Shell <span>Briar</span>", brand: "Brackwater",
        notes: "Filter &amp; brush",
      }],
      wishlist: [{
        id: 1, name: "Kestrel", brand: "Saltcote",
        blend: "Virginia &amp; Perique <em>blend</em>",
      }],
      accessories: [], sessions: [],
    });
    expect(out.pipes[0].name).toBe("Shell Briar");
    expect(out.pipes[0].notes).toBe("Filter & brush");
    expect(out.wishlist[0].blend).toBe("Virginia & Perique blend");
  });

  it("leaves clean strings untouched (no false positives on '2 < 3')", () => {
    const out = migrateData({
      tobaccos: [{
        id: 1, name: "Clean Tin", brand: "BrandX",
        description: "Aged 2 < 3 years before opening",
        lots: [],
      }],
      pipes: [], wishlist: [], accessories: [], sessions: [],
    });
    expect(out.tobaccos[0].description).toBe("Aged 2 < 3 years before opening");
  });
});

/**
 * TagChipRow — the item's own collections on a fiche, folded away.
 *
 * Reported from the app: "cacher les tags derrière un menu dépliant sinon ça
 * prend trop de place. À tous les endroits où ils se trouvent." An earlier
 * pass did the three list filter rows; this is the three fiches, which each carried a
 * byte-identical copy of the block before it was promoted here.
 *
 * The count on the closed label is part of the contract, not decoration: a
 * disclosure that hides HOW MUCH it hides forces a tap to find out, which
 * costs more than the row it saved.
 */

import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { TagChipRow } from "../../components/curator/TagChipRow";

const t = (k: string) => k;

describe("TagChipRow", () => {
  it("renders nothing when there are no tags", () => {
    expect(render(<TagChipRow tags={[]} t={t} />).container.textContent).toBe("");
    expect(render(<TagChipRow tags={undefined} t={t} />).container.textContent).toBe("");
    // Defensive: `tags` comes from stored data, which migrateData sanitises but
    // a hand-edited import could still carry anything.
    expect(render(<TagChipRow tags={"voyage" as any} t={t} />).container.textContent).toBe("");
  });

  it("hides the chips by default and announces how many there are", () => {
    const { container } = render(<TagChipRow tags={["voyage", "cadeaux", "hiver"]} t={t} />);
    expect(container.textContent).not.toContain("# voyage");
    expect(container.textContent).toContain("sec_tags");
    expect(container.textContent).toContain("· 3");
  });

  it("reveals every chip when tapped, and folds back", () => {
    const { container } = render(<TagChipRow tags={["voyage", "cadeaux"]} t={t} />);
    const btn = container.querySelector("[aria-expanded]") as HTMLElement;
    expect(btn.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(btn);
    expect(btn.getAttribute("aria-expanded")).toBe("true");
    expect(container.textContent).toContain("# voyage");
    expect(container.textContent).toContain("# cadeaux");
    fireEvent.click(btn);
    expect(container.textContent).not.toContain("# voyage");
  });

  it("opens the filtered list with the tapped tag", () => {
    const onOpen = vi.fn();
    const { container } = render(<TagChipRow tags={["voyage", "cadeaux"]} onOpen={onOpen} t={t} />);
    fireEvent.click(container.querySelector("[aria-expanded]") as HTMLElement);
    const chips = Array.from(container.querySelectorAll("button")).filter(
      (b) => (b.textContent || "").includes("#"));
    fireEvent.click(chips[1]!);
    expect(onOpen).toHaveBeenCalledWith("cadeaux");
  });

  it("does not throw when no onOpen is wired (a hard-deleted target)", () => {
    const { container } = render(<TagChipRow tags={["voyage"]} t={t} />);
    fireEvent.click(container.querySelector("[aria-expanded]") as HTMLElement);
    const chip = Array.from(container.querySelectorAll("button")).find(
      (b) => (b.textContent || "").includes("# voyage"))!;
    expect(() => fireEvent.click(chip)).not.toThrow();
  });
});

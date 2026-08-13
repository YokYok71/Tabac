/**
 * TagEditor — the shared collections editor used by the tobacco, pipe and
 * accessory forms. An earlier release folded its REUSE SUGGESTIONS away.
 *
 * Why only the suggestions: up to 12 dashed chips is two or three rows inside a
 * form section, and they are an accelerator rather than something you need in
 * view while typing. The item's OWN tags and the input stay visible — hiding
 * either would make the editor worse, not smaller.
 */

import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { TagEditor } from "../../components/curator/TagEditor";

const t = (k: string) => k;
const SUGGESTIONS = ["voyage", "cadeaux", "hiver", "soirée"];

describe("TagEditor — folded reuse suggestions", () => {
  it("keeps the item's own tags and the input visible", () => {
    const { container } = render(
      <TagEditor tags={["voyage"]} suggestions={SUGGESTIONS} onChange={() => {}} t={t} />);
    expect(container.textContent).toContain("voyage");
    expect(container.querySelector("input")).toBeTruthy();
  });

  it("hides the suggestions behind a disclosure that states the count", () => {
    const { container } = render(
      <TagEditor tags={[]} suggestions={SUGGESTIONS} onChange={() => {}} t={t} />);
    expect(container.textContent).not.toContain("+ cadeaux");
    expect(container.textContent).toContain("tag_reuse");
    expect(container.textContent).toContain("· 4");
  });

  it("reveals them when tapped", () => {
    const { container } = render(
      <TagEditor tags={[]} suggestions={SUGGESTIONS} onChange={() => {}} t={t} />);
    fireEvent.click(container.querySelector("[aria-expanded]") as HTMLElement);
    expect(container.textContent).toContain("+ cadeaux");
    expect(container.textContent).toContain("+ soirée");
  });

  it("adding a suggestion still goes through onChange", () => {
    const onChange = vi.fn();
    const { container } = render(
      <TagEditor tags={["voyage"]} suggestions={SUGGESTIONS} onChange={onChange} t={t} />);
    fireEvent.click(container.querySelector("[aria-expanded]") as HTMLElement);
    const chip = Array.from(container.querySelectorAll("button")).find(
      (b) => (b.textContent || "").trim() === "+ cadeaux")!;
    fireEvent.click(chip);
    expect(onChange).toHaveBeenCalledWith(["voyage", "cadeaux"]);
  });

  it("offers no disclosure when every suggestion is already applied", () => {
    const { container } = render(
      <TagEditor tags={SUGGESTIONS} suggestions={SUGGESTIONS} onChange={() => {}} t={t} />);
    expect(container.querySelectorAll("[aria-expanded]").length).toBe(0);
    expect(container.textContent).not.toContain("tag_reuse");
  });

  it("typing + Enter still adds a tag with the suggestions folded", () => {
    const onChange = vi.fn();
    const { container } = render(
      <TagEditor tags={[]} suggestions={SUGGESTIONS} onChange={onChange} t={t} />);
    const input = container.querySelector("input") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "été" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith(["été"]);
  });
});

// ── touch target ────────────────────────────────────────────
// Found by a consistency audit. 20x20 fails even WCAG 2.5.8's 24px AA floor,
// and this × is shared by the tobacco / pipe / accessory forms. Deliberately
// NOT the project's 44px IconBtn rule (2.5.5, AAA) — that would grow a ~28px
// chip out of proportion; the reasoning is recorded at the call site.
describe("TagEditor remove button target", () => {
  it("meets the 24px AA minimum", () => {
    const { container } = render(
      <TagEditor tags={["voyage"]} suggestions={[]} onChange={() => {}} />,
    );
    const btn = Array.from(container.querySelectorAll("button"))
      .find((b) => (b.getAttribute("aria-label") || "").length > 0) as HTMLElement;
    expect(btn).toBeTruthy();
    expect(parseInt(btn.style.width, 10)).toBeGreaterThanOrEqual(24);
    expect(parseInt(btn.style.height, 10)).toBeGreaterThanOrEqual(24);
  });
});

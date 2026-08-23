// `MaintFormModal` had NO test file at all, which is the state it was in when
// build 34 changed one of its labels.
//
// It is the only editing surface for the maintenance log, and the log is what
// drives the "à entretenir" reminder — so what it writes decides whether a
// pipe surfaces on the Home. Two of its behaviours are load-bearing and were
// asserted by nothing:
//
//   • the NEW-entry prefill seeds date AND time, and seeds them in the OPEN
//     effect rather than from an effect keyed on the fields themselves. The
//     time is the whole reason a bowl smoked the same day as a cleaning can be
//     ordered against it; the seeding SITE is the documented prefill-race trap
//     (an effect that writes a user-editable field and lists that field in its
//     deps snaps the value back while the user types).
//
//   • it must not re-use the session form's `lbl_time` ("Heure de début").
//     A cleaning is an event: it has a time, it does not start. That reuse
//     shipped, and its own comment justified it as "not minting a synonym for
//     the same field" — they are not the same field.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fireEvent } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { renderWithCtx } from "../viewTestUtils";
import { CuratorMaintFormModal } from "../../views/curator/MaintFormModal";

const pipe: any = { id: "1", brand: "Halvorsen", name: "Sherlock Holmes", maintenance: [] };

function open(over: any = {}) {
  const onSave = vi.fn();
  const onClose = vi.fn();
  const onDelete = vi.fn();
  const r = renderWithCtx(
    <CuratorMaintFormModal
      open onClose={onClose} onSave={onSave}
      data={over.data !== undefined ? over.data : { pipe }}
      onDelete={over.onDelete !== undefined ? over.onDelete : onDelete}
    />,
    { t: (k: string) => k },
  );
  return { ...r, onSave, onClose, onDelete };
}

/** The Save / Add action.
 *
 * `ModalAction` renders a `PressCard` — a div carrying `role="button"` — not a
 * `<button>`, so a tag-name query finds nothing. And PressCard installs a
 * one-shot capture listener to swallow the trusted click that follows a
 * pointer release (the ghost-click defence), which eats a programmatic
 * `click()`; activating by KEYBOARD goes through its `onKeyDown` and exercises
 * the a11y path as a bonus. Both facts are documented elsewhere in this repo
 * and both cost a debugging round here.
 */
function activate(container: HTMLElement, text: string) {
  const el = Array.from(container.querySelectorAll('[role="button"]'))
    .find((b) => (b.textContent || "").includes(text)) as HTMLElement | undefined;
  expect(el, `no control labelled ${text}`).toBeTruthy();
  fireEvent.keyDown(el!, { key: "Enter" });
}

/** The value a `type="time"` / `type="date"` input currently holds. */
function inputValue(container: HTMLElement, type: string): string {
  const el = container.querySelector(`input[type="${type}"]`) as HTMLInputElement | null;
  expect(el, `no input[type=${type}] rendered`).toBeTruthy();
  return el!.value;
}

describe("MaintFormModal — a new entry is stamped with NOW", () => {
  beforeEach(() => vi.setSystemTime(new Date(2026, 4, 19, 14, 35, 0)));
  afterEach(() => vi.useRealTimers());

  it("prefills both the date and the time", () => {
    const { container } = open();
    expect(inputValue(container, "date")).toBe("2026-05-19");
    // The half that had no coverage. Without it the entry reads as NOON, which
    // is the right fallback for a LEGACY row and wrong for one created now:
    // a cleaning logged this afternoon would sort before a bowl smoked this
    // morning.
    expect(inputValue(container, "time"), "a new cleaning must carry the time").toBe("14:35");
  });

  it("an EDITED entry keeps its own values — the prefill is for new ones only", () => {
    const entry = { id: 7, date: "2026-01-05", time: "09:15", kind: "full", tasks: ["ream"], notes: "n" };
    const { container } = open({ data: { pipe, entry } });
    expect(inputValue(container, "date")).toBe("2026-01-05");
    expect(inputValue(container, "time")).toBe("09:15");
  });

  it("the time can be CLEARED and stays cleared", () => {
    // The prefill-race trap, exercised rather than described: an effect keyed
    // on the field it writes would re-fire on the empty value and put 14:35
    // straight back, and the user would report "I cannot clear this field".
    const { container, onSave } = open();
    const el = container.querySelector('input[type="time"]') as HTMLInputElement;
    fireEvent.change(el, { target: { value: "" } });
    expect(el.value).toBe("");
    activate(container, "btn_add");
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave.mock.calls[0]![0].time, "the cleared time came back").toBe("");
  });
});

describe("MaintFormModal — the time field is labelled for a cleaning", () => {
  it("uses maint_time_label, NOT the session form's lbl_time", () => {
    const { container } = open();
    expect(container.textContent).toContain("maint_time_label");
    // `lbl_time` is "Heure de DÉBUT" in all six languages ("Start time",
    // "Startzeit", "Ora di inizio"…). Right for a tasting, wrong here.
    expect(container.textContent, "a cleaning does not have a START time")
      .not.toContain("lbl_time");
  });

  it("the two keys are genuinely different in the shipped dictionary", () => {
    // Non-vacuity: if someone "simplified" maint_time_label to the same value
    // as lbl_time, the assertion above would still pass while the screen went
    // back to saying « Heure de début ».
    const fr = readFileSync("src/i18n/fr.ts", "utf8");
    const val = (k: string) => new RegExp(`^\\s*${k}:"([^"]*)"`, "m").exec(fr)?.[1];
    expect(val("maint_time_label")).toBe("Heure");
    expect(val("lbl_time")).toBe("Heure de début");
  });
});

describe("MaintFormModal — kind, tasks and the delete affordance", () => {
  it("only an EDIT offers delete — there is nothing to delete on a new entry", () => {
    const add = open();
    expect(add.container.textContent).not.toContain("btn_delete");
    const edit = open({ data: { pipe, entry: { id: 7, date: "2026-01-05", kind: "light", tasks: [], notes: "" } } });
    expect(edit.container.textContent).toContain("btn_delete");
  });

  it("the 'none' kind warns that it does not reset the reminder", () => {
    // The one thing a user can get wrong here: logging a repair and expecting
    // the pipe to drop off the "à entretenir" list. Only light/full count.
    const { container } = open({ data: { pipe, entry: { id: 7, date: "2026-01-05", kind: "none", tasks: [], notes: "" } } });
    expect(container.textContent).toContain("maint_kind_none_hint");
    const other = open({ data: { pipe, entry: { id: 8, date: "2026-01-05", kind: "light", tasks: [], notes: "" } } });
    expect(other.container.textContent).not.toContain("maint_kind_none_hint");
  });

  it("a task chip toggles, and announces its state rather than showing it in colour", () => {
    const { container, onSave } = open();
    const chip = container.querySelector('[role="checkbox"]') as HTMLElement;
    expect(chip, "no task chip rendered").toBeTruthy();
    expect(chip.getAttribute("aria-checked")).toBe("false");
    fireEvent.click(chip);
    expect(chip.getAttribute("aria-checked"), "state conveyed by colour alone").toBe("true");
    fireEvent.click(chip);
    expect(chip.getAttribute("aria-checked")).toBe("false");
    expect(onSave).not.toHaveBeenCalled();
  });

  it("saving hands back the whole entry, tasks included", () => {
    const { container, onSave } = open();
    const chips = Array.from(container.querySelectorAll('[role="checkbox"]')) as HTMLElement[];
    fireEvent.click(chips[0]!);
    fireEvent.click(chips[2]!);
    activate(container, "btn_add");
    const entry = onSave.mock.calls[0]![0];
    expect(entry.tasks.length).toBe(2);
    expect(entry.kind).toBe("light");
  });
});

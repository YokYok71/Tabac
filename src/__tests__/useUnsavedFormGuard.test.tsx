// useUnsavedFormGuard registers an { isDirty, onSave, onDiscard }
// guard with App while an edit form is active. goBack consults it to warn
// before leaving a modified form.

import { describe, it, expect, vi } from "vitest";
import { render, act } from "@testing-library/react";
import { AppCtx, type AppCtxType } from "../AppContext";
import { useUnsavedFormGuard } from "../hooks/useUnsavedFormGuard";

type Guard = { isDirty: () => boolean; onSave: () => void; onDiscard: () => void } | null;

function setup(initialForm: any, active = true) {
  let current: Guard = null;
  const setFormGuard = vi.fn((g: Guard) => { current = g; });
  const onSave = vi.fn();
  const onDiscard = vi.fn();

  function Harness({ form, active }: { form: any; active: boolean }) {
    return (
      <AppCtx.Provider value={{ setFormGuard } as unknown as AppCtxType}>
        <Inner form={form} active={active} />
      </AppCtx.Provider>
    );
  }
  function Inner({ form, active }: { form: any; active: boolean }) {
    useUnsavedFormGuard(active, form, onSave, onDiscard);
    return null;
  }

  const utils = render(<Harness form={initialForm} active={active} />);
  return { getGuard: () => current, setFormGuard, onSave, onDiscard, utils, Harness };
}

describe("useUnsavedFormGuard", () => {
  it("registers a guard while active and clears it when inactive", () => {
    const { getGuard, setFormGuard, utils, Harness } = setup({ name: "A" }, true);
    expect(getGuard()).not.toBeNull();
    act(() => { utils.rerender(<Harness form={{ name: "A" }} active={false} />); });
    // The last setFormGuard call cleared it.
    expect(setFormGuard).toHaveBeenLastCalledWith(null);
  });

  it("isDirty is false initially and true after the form changes", () => {
    const { getGuard, utils, Harness } = setup({ name: "A", brand: "X" }, true);
    expect(getGuard()!.isDirty()).toBe(false);
    act(() => { utils.rerender(<Harness form={{ name: "A EDITED", brand: "X" }} active={true} />); });
    expect(getGuard()!.isDirty()).toBe(true);
  });

  it("stays clean when the form is re-set to the same value", () => {
    const { getGuard, utils, Harness } = setup({ name: "A" }, true);
    act(() => { utils.rerender(<Harness form={{ name: "A" }} active={true} />); });
    expect(getGuard()!.isDirty()).toBe(false);
  });

  it("onSave / onDiscard proxy to the latest handlers", () => {
    const { getGuard, onSave, onDiscard } = setup({ name: "A" }, true);
    act(() => { getGuard()!.onSave(); });
    expect(onSave).toHaveBeenCalledTimes(1);
    act(() => { getGuard()!.onDiscard(); });
    expect(onDiscard).toHaveBeenCalledTimes(1);
  });
});

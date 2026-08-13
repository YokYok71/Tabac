// Unit tests for src/components/curator/FormFields.tsx.
//
// Coverage focus (a11y invariants):
//   - useFocusRing hook: focus/blur state + style payload
//   - TextField / TextAreaField / SelectField generate useId() and pass
//     htmlFor to the FieldLabel so SR users hear the field name
//   - FieldLabel renders <label> when htmlFor is provided, <div> otherwise
//   - required marker shows when required=true
//   - input value changes call onChange with the raw string

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, renderHook, act } from "@testing-library/react";
import { AppCtx } from "../../AppContext";
import {
  TextField,
  TextAreaField,
  SelectField,
  FieldLabel,
  useFocusRing,
} from "../../components/curator/FormFields";

function renderWithMin(ui: React.ReactElement) {
  return render(
    <AppCtx.Provider value={{ doFetchUrl: undefined } as any}>
      {ui}
    </AppCtx.Provider>,
  );
}

describe("useFocusRing", () => {
  it("returns focused=false and style=undefined initially", () => {
    const { result } = renderHook(() => useFocusRing());
    expect(result.current.focused).toBe(false);
    expect(result.current.style).toBeUndefined();
  });

  it("flips focused=true on onFocus, returns a style with boxShadow", () => {
    const { result } = renderHook(() => useFocusRing());
    act(() => result.current.onFocus());
    expect(result.current.focused).toBe(true);
    expect(result.current.style).toBeDefined();
    expect((result.current.style as any).boxShadow).toMatch(/inset|0 0 0|rgba|#/);
  });

  it("flips focused=false on onBlur and clears style", () => {
    const { result } = renderHook(() => useFocusRing());
    act(() => result.current.onFocus());
    act(() => result.current.onBlur());
    expect(result.current.focused).toBe(false);
    expect(result.current.style).toBeUndefined();
  });
});

describe("FieldLabel", () => {
  it("renders a real <label htmlFor=...> when htmlFor is provided", () => {
    const { container } = render(<FieldLabel htmlFor="my-id">Brand</FieldLabel>);
    const label = container.querySelector("label");
    expect(label).toBeTruthy();
    expect(label?.getAttribute("for")).toBe("my-id");
  });

  it("renders a styled <div> when no htmlFor (back-compat path)", () => {
    const { container } = render(<FieldLabel>Brand</FieldLabel>);
    expect(container.querySelector("label")).toBeNull();
    expect(container.querySelector("div")).toBeTruthy();
  });

  it("shows a * asterisk when required is true", () => {
    const { container } = render(<FieldLabel required>Brand</FieldLabel>);
    expect(container.textContent).toContain("*");
  });
});

describe("TextField", () => {
  it("associates the label with the input via htmlFor / id", () => {
    renderWithMin(
      <TextField label="Brand" value="" onChange={() => {}} />,
    );
    const input = screen.getByLabelText("Brand");
    expect(input).toBeTruthy();
    expect(input.tagName).toBe("INPUT");
  });

  it("propagates value to the input and fires onChange on user input", () => {
    const onChange = vi.fn();
    renderWithMin(<TextField label="Brand" value="Brackwater" onChange={onChange} />);
    const input = screen.getByLabelText("Brand") as HTMLInputElement;
    expect(input.value).toBe("Brackwater");
    fireEvent.change(input, { target: { value: "Halvorsen" } });
    expect(onChange).toHaveBeenCalledWith("Halvorsen");
  });

  it("renders the required marker when required is set", () => {
    renderWithMin(
      <TextField label="Name" required value="" onChange={() => {}} />,
    );
    // The * lives in the label, so the rendered text should contain it.
    expect(screen.getByText(/Name/).parentElement?.textContent).toContain("*");
  });

  it("supports type='date' verbatim", () => {
    renderWithMin(
      <TextField label="Born" type="date" value="2024-03-15" onChange={() => {}} />,
    );
    const input = screen.getByLabelText("Born") as HTMLInputElement;
    expect(input.type).toBe("date");
  });

  // numeric inputs render as type="text" inputMode="decimal"
  // so the comma-key works on FR mobile keyboards. The onChange
  // normaliser converts "," → "." before persisting, so parseFloat
  // downstream sees "2.5" regardless of what the user typed.
  it("renders type='number' as text+inputMode=decimal", () => {
    renderWithMin(
      <TextField label="Price" type="number" step="0.01" value="42" onChange={() => {}} />,
    );
    const input = screen.getByLabelText("Price") as HTMLInputElement;
    expect(input.type).toBe("text");
    expect(input.inputMode).toBe("decimal");
    expect(input.step).toBe("0.01");
  });

  it("normalises comma to dot on type='number' input", () => {
    const onChange = vi.fn();
    renderWithMin(
      <TextField label="Weight" type="number" value="" onChange={onChange} />,
    );
    const input = screen.getByLabelText("Weight") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "2,5" } });
    expect(onChange).toHaveBeenCalledWith("2.5");
  });

  it("leaves dot decimal untouched on type='number'", () => {
    const onChange = vi.fn();
    renderWithMin(
      <TextField label="Weight" type="number" value="" onChange={onChange} />,
    );
    const input = screen.getByLabelText("Weight") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "2.5" } });
    expect(onChange).toHaveBeenCalledWith("2.5");
  });

  it("does NOT normalise commas in non-numeric inputs", () => {
    const onChange = vi.fn();
    renderWithMin(
      <TextField label="Notes" value="" onChange={onChange} />,
    );
    const input = screen.getByLabelText("Notes") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Hello, world" } });
    expect(onChange).toHaveBeenCalledWith("Hello, world");
  });
});

describe("TextAreaField", () => {
  it("associates the label with the textarea", () => {
    renderWithMin(
      <TextAreaField label="Notes" value="" onChange={() => {}} />,
    );
    const ta = screen.getByLabelText("Notes");
    expect(ta.tagName).toBe("TEXTAREA");
  });

  it("propagates value and fires onChange", () => {
    const onChange = vi.fn();
    renderWithMin(
      <TextAreaField label="Notes" value="initial" onChange={onChange} />,
    );
    const ta = screen.getByLabelText("Notes") as HTMLTextAreaElement;
    expect(ta.value).toBe("initial");
    fireEvent.change(ta, { target: { value: "next" } });
    expect(onChange).toHaveBeenCalledWith("next");
  });

  it("defaults to an 80px min-height", () => {
    renderWithMin(<TextAreaField label="Notes" value="" onChange={() => {}} />);
    expect((screen.getByLabelText("Notes") as HTMLTextAreaElement).style.minHeight).toBe("80px");
  });

  it("honours a custom min-height (doubled description fields)", () => {
    renderWithMin(<TextAreaField label="Notes" value="" onChange={() => {}} minHeight={160} />);
    expect((screen.getByLabelText("Notes") as HTMLTextAreaElement).style.minHeight).toBe("160px");
  });
});

describe("SelectField", () => {
  it("associates the label with the select", () => {
    renderWithMin(
      <SelectField
        label="Category"
        value=""
        onChange={() => {}}
        options={[
          { value: "a", label: "Anglais" },
          { value: "b", label: "Burley" },
        ]}
      />,
    );
    const select = screen.getByLabelText("Category");
    expect(select.tagName).toBe("SELECT");
  });

  it("renders an option per entry plus the placeholder empty value", () => {
    renderWithMin(
      <SelectField
        label="Category"
        value=""
        onChange={() => {}}
        options={[
          { value: "a", label: "Anglais" },
          { value: "b", label: "Burley" },
        ]}
      />,
    );
    const select = screen.getByLabelText("Category") as HTMLSelectElement;
    // Placeholder empty option + 2 entries = 3 total
    expect(select.querySelectorAll("option").length).toBe(3);
  });

  it("calls onChange when the user picks an option", () => {
    const onChange = vi.fn();
    renderWithMin(
      <SelectField
        label="Cut"
        value=""
        onChange={onChange}
        options={[
          { value: "flake", label: "Flake" },
          { value: "rope", label: "Rope" },
        ]}
      />,
    );
    const select = screen.getByLabelText("Cut") as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "rope" } });
    expect(onChange).toHaveBeenCalledWith("rope");
  });

  it("renders <optgroup> headers when `groups` is supplied", () => {
    renderWithMin(
      <SelectField
        label="Shape"
        value=""
        onChange={() => {}}
        groups={[
          { label: "Billiard", options: [{ value: "Billiard", label: "Billiard" }, { value: "Pot", label: "Pot" }] },
          { label: "Calabash", options: [{ value: "Calabash", label: "Calabash" }] },
        ]}
      />,
    );
    const select = screen.getByLabelText("Shape") as HTMLSelectElement;
    const groups = select.querySelectorAll("optgroup");
    expect(groups.length).toBe(2);
    expect(groups[0]!.getAttribute("label")).toBe("Billiard");
    expect(groups[1]!.getAttribute("label")).toBe("Calabash");
    // Placeholder + 3 grouped options = 4 total.
    expect(select.querySelectorAll("option").length).toBe(4);
  });
});

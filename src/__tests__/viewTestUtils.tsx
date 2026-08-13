import { render } from "@testing-library/react";
import { AppCtx, type AppCtxType } from "../AppContext.tsx";
import { vi } from "vitest";

// Minimal t() that returns the key (enough to check rendered text)
export const mockT = (k: string) => k;
export const mockXl = (v: string) => v;

// Minimal btn() that renders a <button>
export const mockBtn = (label: string, onClick?: () => void, _bg?: any, _color?: any, _small?: any, _disabled?: any, _block?: any, _extra?: any) =>
  <button onClick={onClick} disabled={!!_disabled}>{label}</button>;

// Minimal stars() that renders a <span>
export const mockStars = (v: number, _set?: any, _sz?: number) =>
  <span data-testid="stars">{v}</span>;

// Minimal dInp() that renders an <input>
export const mockDInp = (val: any, onChange: any) =>
  <input type="date" value={val || ""} onChange={(e) => onChange(e.target.value)} />;

// Minimal urlField() that renders nothing
export const mockUrlField = () => null;

// Minimal aiCard() that renders nothing
export const mockAiCard = () => null;

// Minimal statBox() that renders a <div> with the value
export const mockStatBox = (val: any, label: string, _icon?: string, onClick?: () => void) =>
  <div data-testid="stat-box" onClick={onClick}><span>{val}</span><span>{label}</span></div>;

export function renderWithCtx(
  ui: React.ReactElement,
  ctx: Record<string, any> = {}
) {
  const defaultCtx: Record<string, any> = {
    t: mockT,
    xl: mockXl,
    lang: "fr",
    btn: mockBtn,
    stars: mockStars,
    dInp: mockDInp,
    urlField: mockUrlField,
    aiCard: mockAiCard,
    statBox: mockStatBox,
    nav: vi.fn(),
    view: "home",
    data: { wishlist: [], tobaccos: [], pipes: [], accessories: [], sessions: [] },
    weightUnit: "g",
    lengthUnit: "mm",
    dateFormat: "fr",
    currencySymbol: "€",
    detail: null,
    gold: "#c9b458",
    hi: "#f0f0f0",
  };
  return render(
    <AppCtx.Provider value={{ ...defaultCtx, ...ctx } as AppCtxType}>
      {ui}
    </AppCtx.Provider>
  );
}

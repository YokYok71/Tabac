// Every <iframe> the app renders is a THIRD-PARTY page inside ours (today:
// the OpenStreetMap embed on a session fiche). Unsandboxed, such a frame may
// navigate the top window away from the app, submit forms and raise modal
// prompts over it. This walks the production sources so a new iframe cannot
// ship without the attribute, and so the existing one cannot be widened to
// top-navigation.

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const SRC = resolve(__dirname, "..");

function walk(dir: string, acc: string[]): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "__tests__") continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, acc);
    else if (/\.(tsx|jsx)$/.test(name)) acc.push(full);
  }
  return acc;
}

/** Each JSX `<iframe … />` element, comments blanked so prose cannot satisfy it. */
function iframes(): { file: string; tag: string }[] {
  const out: { file: string; tag: string }[] = [];
  for (const f of walk(SRC, [])) {
    const code = readFileSync(f, "utf8")
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/[^\n]*$/gm, "");
    const re = /<iframe\b[\s\S]*?\/>/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(code)) !== null) out.push({ file: f.replace(SRC + "/", ""), tag: m[0] });
  }
  return out;
}

describe("iframes are sandboxed", () => {
  it("finds at least the session map (the walk is not vacuous)", () => {
    expect(iframes().some((i) => i.file.endsWith("JournalView.tsx"))).toBe(true);
  });

  it("every iframe carries a sandbox that withholds top navigation and forms", () => {
    for (const { file, tag } of iframes()) {
      const sb = tag.match(/sandbox="([^"]*)"/);
      expect(sb, `${file}: <iframe> without a sandbox attribute`).toBeTruthy();
      const tokens = sb![1]!.split(/\s+/);
      expect(tokens.filter((t) => /^allow-top-navigation/.test(t)), `${file}: top navigation`).toEqual([]);
      expect(tokens, `${file}: form submission`).not.toContain("allow-forms");
      expect(tokens, `${file}: modal prompts`).not.toContain("allow-modals");
    }
  });
});

// L'IDENTITÉ DE FUSION EST FRAPPÉE À LA CRÉATION — et quatre des cinq sites de
// frappe n'étaient asservis par rien.
//
// `newUid()` est l'identité de fusion inter-appareils : `resolveMergeMatch` la
// consulte EN PREMIER, et le repli sur `brand|name` refuse d'agir dès que deux
// lignes partagent ce couple — auquel cas la ligne importée est AJOUTÉE, c'est
// le doublement silencieux déjà documenté. Le contrat, écrit dans CLAUDE.md,
// est « frappée UNE FOIS à la création et portée dans les sauvegardes ».
//
// MESURÉ PAR SONDE, sur 387 cas : retirer la frappe de `addPipe`, `addWish`,
// `addAccessory` ou `addSession` laisse la suite entièrement VERTE. Seul
// `addTobacco` rougit (un cas, dans sa propre suite). Quatre sites sur cinq, y
// compris celui dont la conséquence est permanente — voir plus bas.
//
// CE QUI ABSORBE, ET JUSQU'OÙ. `migrateData._backfillUid` repose une uid sur les
// QUATRE collections de premier niveau, au chargement suivant — donc pour une
// pipe, une envie ou un accessoire, la perte n'est pas éternelle : elle dure le
// temps d'une session. Ce n'est pas rien pour autant, parce que la sauvegarde
// cloud automatique part 1,2 s après l'enregistrement : une sauvegarde prise
// dans cette fenêtre emporte une ligne SANS uid, et les deux appareils frappent
// alors deux uid DIFFÉRENTES pour le même objet — exactement le mécanisme du
// doublement silencieux. C'est aussi la raison pour laquelle le chemin de
// chargement persiste le rattrapage immédiatement (« un export pris avant la
// première sauvegarde portait des uid éphémères »).
//
// LES SÉANCES SONT LE CAS DUR, et l'exclusion est délibérée : `_backfillUid`
// ne les touche pas, parce qu'une séance ancienne rattrapée à deux uid
// différentes sur deux appareils serait SCINDÉE par la garde des uid
// distinctes. Conséquence : pour une séance, la frappe à la création est la
// SEULE source d'uid qui existe. La perdre ne se rattrape jamais.
//
// LA CHARGE EST INVERSÉE ci-dessous : le dernier cas ne redit pas la liste des
// entités, il la DÉRIVE des appels `_backfillUid(d.…)` de `migrateData` et
// exige qu'une entité rattrapée là-bas soit frappée ici. Une sixième entité de
// premier niveau ne peut donc pas arriver sans garde.

import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { useTobaccoStore } from "../hooks/useTobaccoStore";
import { usePipeStore } from "../hooks/usePipeStore";
import { useAccessoryStore } from "../hooks/useAccessoryStore";
import { useWishStore } from "../hooks/useWishStore";
import { useSessionStore } from "../hooks/useSessionStore";

/** Une uid utilisable : une chaîne non vide. */
function expectUid(v: unknown, what: string) {
  expect(typeof v, what + " : l'uid n'est pas une chaîne").toBe("string");
  expect(String(v).length, what + " : l'uid est vide").toBeGreaterThan(0);
}

describe("l'identité de fusion est frappée à la création", () => {
  it("addTobacco frappe une uid", () => {
    const save = vi.fn();
    const { result } = renderHook(() =>
      useTobaccoStore({
        data: { tobaccos: [], nxT: 1 }, save, nav: vi.fn(),
        setView: vi.fn(), setSearch: vi.fn(), fromWishRef: { current: null },
      } as any),
    );
    act(() => { result.current.setForm((f: any) => ({ ...f, name: "Duskfall", brand: "Brackwater" })); });
    act(() => { result.current.addTobacco(); });
    expectUid(save.mock.calls[0]![0].tobaccos[0].uid, "tabac");
  });

  it("addPipe frappe une uid", () => {
    const save = vi.fn();
    const { result } = renderHook(() =>
      usePipeStore({ data: { pipes: [], nxP: 1 }, save, nav: vi.fn() } as any),
    );
    act(() => { result.current.setPipeForm((f: any) => ({ ...f, name: "Foxtrot", brand: "Halvorsen" })); });
    act(() => { result.current.addPipe(); });
    expectUid(save.mock.calls[0]![0].pipes[0].uid, "pipe");
  });

  it("addAccessory frappe une uid", () => {
    const save = vi.fn();
    const { result } = renderHook(() =>
      useAccessoryStore({ data: { accessories: [], nxA: 1 }, save, nav: vi.fn() } as any),
    );
    act(() => { result.current.setAccForm((f: any) => ({ ...f, name: "Bourre-pipe", brand: "Vondel" })); });
    act(() => { result.current.addAccessory(); });
    expectUid(save.mock.calls[0]![0].accessories[0].uid, "accessoire");
  });

  it("addWish frappe une uid", () => {
    const save = vi.fn();
    const { result } = renderHook(() =>
      useWishStore({
        data: { wishlist: [], nxW: 1 }, save, nav: vi.fn(), setForm: vi.fn(),
        fromWishRef: { current: null }, scrollSaveRef: { current: {} },
      } as any),
    );
    act(() => { result.current.setWishForm((f: any) => ({ ...f, name: "Corvane", brand: "Aldwych" })); });
    act(() => { result.current.addWish(); });
    expectUid(save.mock.calls[0]![0].wishlist[0].uid, "envie");
  });

  it("addSession frappe une uid — et c'est la SEULE source qu'une séance aura", () => {
    // `_backfillUid` exclut délibérément les séances (voir l'en-tête), donc
    // ici la perte est définitive et non pas d'une session.
    const save = vi.fn();
    const { result } = renderHook(() =>
      useSessionStore({
        data: { tobaccos: [], sessions: [], nxJ: 1 }, save, nav: vi.fn(), weightUnit: "g",
      } as any),
    );
    act(() => { result.current.setSessForm((f: any) => ({ ...f, date: "2026-05-02", weightG: "0" })); });
    act(() => { result.current.addSession(); });
    expectUid(save.mock.calls[0]![0].sessions[0].uid, "séance");
  });

  it("deux créations successives ne partagent pas la même uid", () => {
    // Sans ça, une constante satisferait « une chaîne non vide » tout en
    // rendant l'identité inutilisable — deux pipes fusionneraient en une.
    const save = vi.fn();
    const { result, rerender } = renderHook(
      (props: { data: any }) => usePipeStore({ data: props.data, save, nav: vi.fn() } as any),
      { initialProps: { data: { pipes: [] as any[], nxP: 1 } } },
    );
    act(() => { result.current.setPipeForm((f: any) => ({ ...f, name: "Foxtrot", brand: "Halvorsen" })); });
    act(() => { result.current.addPipe(); });
    const first = save.mock.calls[0]![0].pipes[0];
    rerender({ data: { pipes: [first], nxP: 2 } });
    act(() => { result.current.setPipeForm((f: any) => ({ ...f, name: "Ridgeline", brand: "Halvorsen" })); });
    act(() => { result.current.addPipe(); });
    const second = save.mock.calls[1]![0].pipes[1];
    expectUid(second.uid, "seconde pipe");
    expect(second.uid).not.toBe(first.uid);
  });

  it("chaque collection rattrapée par migrateData est frappée ici", () => {
    // La liste vient de `migrateData`, seul endroit qui énumère déjà les
    // entités portant une uid ; la redire ici serait la deuxième source de
    // vérité que ce dépôt paie en boucle.
    const utils = readFileSync("src/utils.ts", "utf8");
    const collections = [...utils.matchAll(/_backfillUid\(d\.(\w+)\)/g)].map((m) => m[1]!);
    expect(collections.length, "les appels `_backfillUid(d.…)` ont disparu de migrateData")
      .toBeGreaterThanOrEqual(4);

    const self = readFileSync("src/__tests__/entityUidMinted.test.ts", "utf8");
    // Le nom du store se déduit du singulier de la collection : `tobaccos`
    // -> `addTobacco`. Table explicite plutôt que dépluralisation devinée —
    // une entité inconnue doit faire ÉCHOUER, pas passer par une règle
    // approximative.
    const ADDER: Record<string, string> = Object.assign(Object.create(null), {
      tobaccos: "addTobacco", pipes: "addPipe",
      accessories: "addAccessory", wishlist: "addWish",
    });
    const missing = collections.filter((c) => {
      const adder = Object.prototype.hasOwnProperty.call(ADDER, c) ? ADDER[c] : null;
      return !adder || !self.includes(adder + "()");
    });
    expect(missing,
      "ces collections reçoivent une uid de rattrapage sans que la frappe à la " +
      "création soit gardée ici — ajouter le cas, ou l'entrée dans ADDER")
      .toEqual([]);
  });
});

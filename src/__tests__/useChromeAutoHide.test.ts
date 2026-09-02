/**
 * LE CÂBLAGE DE L'ESCAMOTAGE — ce que la règle pure ne peut pas attester.
 *
 * `chromeAutoHide.test.ts` éprouve la DÉCISION ; ce fichier éprouve ce que le
 * hook en fait. La distinction n'est pas de principe : les deux défauts que ce
 * fichier garde ont vécu dans le hook, pas dans la règle.
 *
 *  • LA MESURE PAR TRAME. La règle sait cumuler une course, encore faut-il
 *    qu'on lui repasse son propre état d'une trame à l'autre. Si le hook
 *    repartait d'un état neuf à chaque mesure, le cumul vaudrait le pas et le
 *    glissement posé ne masquerait toujours pas — la règle, elle, resterait
 *    verte.
 *  • LA RÉVÉLATION À L'ARRÊT. `setHidden(false)` seul ne suffit PAS : la
 *    mémoire de la règle vit dans une ref que le minuteur doit remettre à zéro
 *    aussi, sinon la trame suivante retrouve son ancrage d'avant l'arrêt,
 *    remasque aussitôt, et le minuteur paraît ne rien faire.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useChromeAutoHide } from "../hooks/useChromeAutoHide";
import { CHROME_IDLE_REVEAL_MS, CHROME_REVEAL_TOP_PX, CHROME_HIDE_DELTA_PX }
  from "../utils/chromeAutoHide";

const BAS = CHROME_REVEAL_TOP_PX + 500;

/** Une page franchement plus longue que l'écran — sinon la règle refuse de
 *  masquer et tous les cas ci-dessous passeraient pour rien. */
function pageLongue() {
  Object.defineProperty(window, "innerHeight", { value: 800, configurable: true });
  Object.defineProperty(document.documentElement, "scrollHeight", { value: 4000, configurable: true });
}

/** Une trame : on déplace le défilement, on émet l'évènement, on laisse le
 *  rappel d'animation passer. `advanceTimersByTime` fait avancer les deux —
 *  vitest simule `requestAnimationFrame` avec les minuteurs. */
function trame(y: number) {
  act(() => {
    Object.defineProperty(window, "scrollY", { value: y, configurable: true });
    window.dispatchEvent(new Event("scroll"));
    vi.advanceTimersByTime(20);
  });
}

describe("useChromeAutoHide", () => {
  beforeEach(() => { vi.useFakeTimers(); pageLongue(); Object.defineProperty(window, "scrollY", { value: 0, configurable: true }); });
  afterEach(() => { vi.useRealTimers(); });

  it("UN GLISSEMENT POSÉ finit par masquer — l'état survit d'une trame à l'autre", () => {
    // Le rapport d'usage, rejoué au plus près : cinq trames de 3 px, chacune
    // INDIVIDUELLEMENT sous le seuil. Si le hook n'accumulait pas, on aurait
    // ici le comportement livré — jamais masqué, quel que soit le temps passé
    // à glisser.
    expect(3).toBeLessThan(CHROME_HIDE_DELTA_PX);
    // On MONTE déjà en bas de page : sinon la première trame serait un saut de
    // 580 px depuis le sommet, qui masque à bon droit et rendrait le cas creux.
    Object.defineProperty(window, "scrollY", { value: BAS, configurable: true });
    const { result } = renderHook(() => useChromeAutoHide(true));
    expect(result.current).toBe(false);
    for (let i = 1; i <= 5; i++) trame(BAS + i * 3);
    expect(result.current, "cinq pas de 3 px n'ont pas masqué").toBe(true);
  });

  it("l'arrêt révèle, ET LA COURSE REPART DE ZÉRO", () => {
    const { result } = renderHook(() => useChromeAutoHide(true));
    trame(BAS);
    trame(BAS + 300);
    expect(result.current).toBe(true);

    act(() => { vi.advanceTimersByTime(CHROME_IDLE_REVEAL_MS + 10); });
    expect(result.current, "le minuteur d'immobilité n'a pas révélé").toBe(false);

    // LA MOITIÉ QUI COMPTE. Un pixel de plus, très en deçà du seuil : si la
    // mémoire de la règle avait gardé son ancrage d'avant l'arrêt, le cumul
    // dépasserait encore et la barre repartirait aussitôt. L'utilisateur
    // verrait un clignotement, pas une révélation.
    trame(BAS + 301);
    expect(result.current, "la chrome se remasque au premier pixel après l'arrêt").toBe(false);
  });

  it("une vue hors périmètre ne s'escamote jamais, quoi qu'on défile", () => {
    const { result } = renderHook(() => useChromeAutoHide(false));
    trame(BAS);
    trame(BAS + 500);
    expect(result.current).toBe(false);
  });
});

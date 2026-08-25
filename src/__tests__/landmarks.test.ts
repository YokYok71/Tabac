// L'APP N'AVAIT QU'UN SEUL REPÈRE DE RÉGION, ET CE N'ÉTAIT PAS LE CONTENU.
//
// Balayé sur tout `src/` : `BottomDock` porte un `<nav>` et il n'y avait rien
// d'autre — pas de `<main>`, nulle part. La conséquence est petite et
// permanente : un lecteur d'écran n'offre pas de saut « aller au contenu », donc
// atteindre la page demande de traverser la barre du haut à chaque navigation,
// sur toutes les vues, à chaque fois.
//
// POURQUOI AU NIVEAU DE LA SOURCE ET NON PAR UN RENDU. `CuratorApp` monte
// TOUTES les vues et exige le contexte complet ; ce qui pourrit ici n'est pas
// un comportement mais la BALISE, et une assertion sur la balise se lit là où
// elle est écrite. Les commentaires sont blanchis d'abord : celui qui explique
// le choix contient le mot `<main>`, donc une recherche naïve le trouverait et
// déclarerait le repère présent — le piège que ce dépôt a rencontré quatre fois.
//
// CE QUI N'EST PAS EXIGÉ : un `<header>` par vue. Chaque `TopBar` est un
// candidat, mais elles sont une par écran et la valeur d'un deuxième repère est
// bien moindre que celle du premier ; l'imposer serait la garde trop stricte
// qui fait réécrire vingt-neuf vues pour satisfaire une règle.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

function blank(p: string): string {
  return readFileSync(p, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, (m) => " ".repeat(m.length))
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, (m) => " ".repeat(m.length))
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, p1) => p1 + " ".repeat(m.length - p1.length));
}

describe("l'application déclare ses régions", () => {
  it("la colonne de contenu est un <main>, ouvert et fermé", () => {
    const src = blank("src/CuratorApp.tsx");
    expect(src, "aucun <main> dans la coquille").toMatch(/<main\s/);
    expect(src, "<main> jamais refermé").toContain("</main>");
    // Un seul : deux régions principales est une erreur d'analyse pour une
    // technologie d'assistance, pas une redondance inoffensive.
    expect((src.match(/<main[\s>]/g) || []).length).toBe(1);
    expect((src.match(/<\/main>/g) || []).length).toBe(1);
  });

  it("la barre de navigation garde le sien", () => {
    // Non-vacuité dans l'autre sens : le repère qui existait déjà ne doit pas
    // disparaître au passage.
    expect(blank("src/components/curator/BottomDock.tsx")).toMatch(/<nav\s/);
  });
});

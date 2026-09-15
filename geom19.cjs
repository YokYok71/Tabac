const { chromium } = require("playwright-core");
(async () => {
  const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
  const p = await b.newPage({ viewport: { width: 395, height: 859 } });
  await p.goto("http://127.0.0.1:4173/", { waitUntil: "networkidle" });
  await p.evaluate(() => { try { localStorage.setItem("cave-terms-accepted","1");localStorage.setItem("cave-curator-welcomed","1");localStorage.setItem("cave-lang","fr"); } catch {} });
  await p.reload({ waitUntil: "networkidle" });
  await p.waitForTimeout(900);
  const r = await p.evaluate(() => {
    const bar = document.querySelector('[data-topbar]') || document.querySelector('div[style*="sticky"]');
    if (!bar) return { erreur: "pas de barre", corps: document.body.innerText.slice(0, 200) };
    const cs = getComputedStyle(bar); const bb = bar.getBoundingClientRect();
    // le premier nœud de texte visible de la barre
    let titre = null;
    const w = document.createTreeWalker(bar, NodeFilter.SHOW_TEXT);
    let n; while ((n = w.nextNode())) {
      if (!n.textContent.trim()) continue;
      const rg = document.createRange(); rg.selectNodeContents(n);
      const rr = rg.getBoundingClientRect();
      if (rr.height > 4) { titre = { texte: n.textContent.trim().slice(0, 24), haut: rr.top, hauteur: Math.round(rr.height) }; break; }
    }
    return { barre: { haut: bb.top, hauteur: Math.round(bb.height) },
             paddingTop: cs.paddingTop, paddingBottom: cs.paddingBottom,
             titre, offsetTitre: titre ? Math.round(titre.haut - bb.top) : null };
  });
  console.log(JSON.stringify(r, null, 1));
  await b.close();
})();

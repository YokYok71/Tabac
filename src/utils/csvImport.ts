/**
 * CSV import for tobaccos + their lots.
 *
 * `parseTobaccoCsv(text)` reads the SAME per-lot CSV shape the app exports
 * (`buildCsvLines` in useExportImport) — one row per lot, the tobacco fields
 * repeated — so an export can be edited in a spreadsheet and re-imported
 * (round-trip). It also accepts a hand-built subset: columns are matched by
 * HEADER NAME (accent-/case-insensitive, units in parentheses stripped), not
 * by position, so `Marque;Nom;Poids;Prix` is enough. Only Marque + Nom are
 * required (the tobacco identity).
 *
 * Rows sharing the same brand+name (case-insensitive) collapse into ONE
 * tobacco with several lots. Every value is coerced defensively (enums snap to
 * the canonical list or "Autre", ratings clamp 0–5, dates normalise, garbage
 * numbers blank out), and the whole thing is pure + string-only so it can be
 * fuzzed. The result is a tobaccos-only payload fed to the merge import path.
 */

import { CATS, CUTS, CAT_MAP, CUT_MAP, BT, BL } from "../constants.ts";

/**
 * One entry per row the parser could not read as written.
 *
 * The counts alone are not actionable: on a 400-row cellar export « 3 valeurs
 * non reconnues » leaves the user to find them in a spreadsheet. `row` counts
 * the header as line 1, so it matches the gutter they are looking at.
 */
export interface CsvImportIssue {
  row: number;
  kind: "no-identity" | "category" | "cut" | "number" | "status";
  brand: string;
  name: string;
  /** The offending label, for the taxonomy kinds and for `number`. */
  value: string;
}

/** Detail-list cap. The COUNTS below stay exact; only the list is bounded.
 *  Separate from the catalogue's `MAX_CATALOGUE_ISSUES` on purpose: it is a
 *  display bound, not a rule the two importers must agree on. */
export var MAX_CSV_ISSUES = 500;

export interface CsvImportResult {
  tobaccos: any[];   // full Tobacco objects (id + lots) ready for the merge import
  rows: number;      // data rows read (excludes header + blank lines)
  skipped: number;   // rows dropped for missing brand+name
  lots: number;      // lots created
  headers: string[]; // canonical field keys recognised in the header
  sectioned: boolean; // true if a "=== SECTION ===" marker was hit (multi-section export CSV)
  capped: boolean;    // true if MAX_ROWS was reached and the rest was dropped
  badCategory: number; // rows whose category was snapped to "Autre" (EXACT)
  badCut: number;      // rows whose cut was snapped to "Autre" (EXACT)
  badNumber: number;   // numeric cells that held something unreadable (EXACT)
  /** Lot rows whose STATUS cell held a word the parser could not place, and
   *  which therefore fell through to "cellar" (EXACT).
   *
   *  Reported because the fall-through is SILENT and produces a perfect-looking
   *  row: an opened jar imported as a sealed tin, with its `dateOpened` then
   *  back-filled by the lifecycle repair. A blank cell is NOT counted — it
   *  legitimately means cellar. */
  badStatus: number;
  issues: CsvImportIssue[]; // capped at MAX_CSV_ISSUES
  issuesTruncated: boolean; // the list hit the cap; the counts above did not
}

// Defence-in-depth soft cap on the number of DATA rows processed.
// FileReader already materialises the whole file as a string, so a pathological
// multi-hundred-MB import can't be prevented here, but this bounds the work +
// output size to a sane ceiling (a real cellar is hundreds of lot-rows, not
// tens of thousands) and lets the caller warn that rows were dropped rather
// than silently truncating.
export var MAX_ROWS = 50000;

/**
 * THE delimiter every CSV this app WRITES uses — and the reason is a
 * spreadsheet, not a parser.
 *
 * Reading is delimiter-agnostic: `detectDelim` sniffs the header line, so a
 * comma file, a semicolon file and a tab file all import identically, and every
 * catalogue already loaded goes on reading exactly as before. What differs is
 * what happens when someone DOUBLE-CLICKS the file — which is the whole point
 * of a template, and the ordinary way an export gets looked at.
 *
 * Excel picks its delimiter from the system list separator, and in every
 * comma-decimal locale that separator is `;`. Five of the app's six UI
 * languages are comma-decimal (fr, es, de, it, pt), so a comma file opens as
 * ONE column for most users — a template nobody can fill in.
 *
 * It is not merely preferable for the cellar export, it is the coherent
 * choice: the app stores weights and prices AS THE USER TYPED THEM, so a French
 * cellar legitimately holds `2,5`. `csvEsc` quotes every cell, so a comma
 * decimal survives either way — but a file whose delimiter and whose decimal
 * mark are the same character is one editing mistake away from splitting.
 *
 * The residual, stated rather than hidden: in an English locale Excel expects
 * `,`, so an English user gets the one-column open instead. A `sep=;` preamble
 * would fix both — Excel and LibreOffice honour it — and is deliberately NOT
 * used: Numbers does not, and it would show a stray first row on the platform
 * this app is built for first. One rule, five languages of six.
 *
 * WRITERS ONLY. Never feed this to a reader: `detectDelim` is what decides how
 * an incoming file is split, and hardcoding a delimiter there would refuse the
 * comma files this app itself emitted for years.
 */
export var CSV_DELIM = ";";

// ── low-level CSV tokeniser ──────────────────────────────────────────────────

// EXPORTED so the catalogue importer (`utils/userCatalogue.ts`)
// can reuse them. Both read a CSV a human may have edited in a spreadsheet, so
// they need the same delimiter sniffing and the same RFC-4180 handling of
// quoted fields, "" escapes and embedded newlines. Writing that a second time
// is the failure this repo keeps paying for — the tag predicate lived in four
// copies before it was shared. What differs between the two importers is the COLUMN
// contract, which is where each one keeps its own code.
export function detectDelim(headerLineRaw: string): string {
  var headerLine = String(headerLineRaw);
  var counts: Record<string, number> = { ";": 0, ",": 0, "\t": 0 };
  var inQ = false;
  for (var i = 0; i < headerLine.length; i++) {
    var ch = headerLine.charAt(i);
    if (ch === '"') inQ = !inQ;
    else if (!inQ && counts[ch] !== undefined) counts[ch] = (counts[ch] || 0) + 1;
  }
  var best = ";", bestN = -1;
  Object.keys(counts).forEach(function (d) {
    if ((counts[d] || 0) > bestN) { bestN = counts[d] || 0; best = d; }
  });
  return best;
}

// Full RFC-4180-ish tokeniser: handles quoted fields, "" escapes, quoted
// newlines, CRLF/LF. Returns an array of rows, each an array of string cells.
export function tokenize(textRaw: string, delim: string): string[][] {
  var text = String(textRaw);
  var rows: string[][] = [];
  var row: string[] = [];
  var field = "";
  var inQ = false;
  var i = 0;
  var n = text.length;
  while (i < n) {
    var ch = text.charAt(i);
    if (inQ) {
      if (ch === '"') {
        if (text.charAt(i + 1) === '"') { field += '"'; i += 2; continue; }
        inQ = false; i++; continue;
      }
      field += ch; i++; continue;
    }
    if (ch === '"') { inQ = true; i++; continue; }
    if (ch === delim) { row.push(field); field = ""; i++; continue; }
    if (ch === "\r") { i++; continue; }
    if (ch === "\n") { row.push(field); rows.push(row); row = []; field = ""; i++; continue; }
    field += ch; i++;
  }
  // flush last field/row
  row.push(field);
  rows.push(row);
  return rows;
}

// ── header mapping ───────────────────────────────────────────────────────────

function fold(s: any): string {
  return String(s == null ? "" : s)
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/\([^)]*\)/g, " ")   // strip "(g)" / "(€)" units
    .replace(/\s+/g, " ")
    .trim().toLowerCase();
}

// Reverse the export's CSV formula-injection guard. `csvEsc`
// (useExportImport) prepends a single "'" to any cell whose first char is a
// formula metacharacter [= + - @ tab CR |]. Without undoing it on import, a
// brand / name legitimately starting with those chars accretes a permanent "'"
// on every round-trip — corrupting the value AND breaking the dupKey match so
// the merge duplicates the blend instead of topping up its lots. Strip exactly
// the guard apostrophe (one leading "'" followed by a metachar); a genuine
// leading "'" NOT followed by a metachar (e.g. "'twas") is left untouched. The
// guard isn't perfectly injective — a real "'=x" also collapses to "=x" — but
// that is vanishingly rare next to the common leading -/+/@/= brand case.
var _CSV_FORMULA_META = /^[=+\-@\t\r|]/;
function unescapeFormulaGuard(v: string): string {
  var s = String(v == null ? "" : v);
  if (s.charAt(0) === "'" && _CSV_FORMULA_META.test(s.slice(1))) return s.slice(1);
  return s;
}

// The FIXED set of section markers buildCsvLines emits (post-apostrophe-strip).
// Matching the exact set — instead of any "=== …" prefix — means a user brand
// that happens to start with "===" is parsed as a tobacco instead of silently
// triggering the section-stop and dropping that row + every row after it. FR
// export strings plus the EN aliases an older/foreign export might carry.
var _CSV_SECTION_MARKERS = [
  "=== PIPES ===", "=== WISHLIST ===", "=== ACCESSOIRES ===",
  "=== ACCESSORIES ===", "=== SEANCES ===", "=== JOURNAL ===",
];

var HEADER_ALIASES: Record<string, string> = {
  "marque": "brand", "brand": "brand",
  "nom": "name", "name": "name",
  "categorie": "category", "category": "category", "famille": "category",
  "composition": "blend", "blend": "blend", "melange": "blend",
  "coupe": "cut", "cut": "cut",
  "force": "force", "strength": "force",
  "room note": "roomNote", "roomnote": "roomNote",
  "gout": "taste", "taste": "taste", "gout taste": "taste",
  "description": "description",
  "note": "rating", "rating": "rating", "note perso": "rating",
  "a reprendre": "rebuy", "reprendre": "rebuy", "rebuy": "rebuy", "a racheter": "rebuy",
  "notes degustation": "tastingNotes", "tasting notes": "tastingNotes", "degustation": "tastingNotes",
  "age max cave": "agingMax", "age max": "agingMax", "vieillissement": "agingMax", "aging max": "agingMax", "aging": "agingMax",
  "statut": "status", "status": "status",
  "elimine": "disposed", "disposed": "disposed", "jete": "disposed",
  "poids": "weightG", "weight": "weightG", "poids actuel": "weightG",
  "poids initial": "weightInitial", "weight initial": "weightInitial", "initial weight": "weightInitial", "poids depart": "weightInitial",
  "statut origine": "originalStatus", "original status": "originalStatus",
  "date achat": "datePurchased", "achat": "datePurchased", "purchase date": "datePurchased", "date purchased": "datePurchased",
  "date production": "dateProduction", "production": "dateProduction", "production date": "dateProduction",
  "date mise en pot": "dateOpened", "mise en pot": "dateOpened", "date opened": "dateOpened", "opened": "dateOpened",
  "date fin": "dateFinished", "fin": "dateFinished", "date finished": "dateFinished", "finished date": "dateFinished",
  "no boite": "boxNumber", "boite": "boxNumber", "box": "boxNumber", "box number": "boxNumber",
  "lieu de stockage": "storageLocation", "stockage": "storageLocation", "storage": "storageLocation", "storage location": "storageLocation", "lieu": "storageLocation",
  "prix": "price", "price": "price",
  "vendeur": "seller", "seller": "seller",
  "site vendeur": "sellerUrl", "url vendeur": "sellerUrl", "seller url": "sellerUrl", "site du vendeur": "sellerUrl",
  "image url": "imageUrl", "image": "imageUrl",
  // Les quatre champs que l'élargissement avait laissés sans alias hors
  // FR/EN. Trois PORTENT UNE DONNÉE, donc l'écrivain ne peut pas émettre
  // leur en-tête localisé tant que le lecteur ne le connaît pas — c'est la
  // moitié qui rend l'export localisé possible.
  "nota de ambiente": "roomNote", "eliminado": "disposed", "estado origen": "originalStatus", "url de imagen": "imageUrl",  // es
  "raumnote": "roomNote", "entsorgt": "disposed", "ursprungsstatus": "originalStatus", "bild-url": "imageUrl",  // de
  "nota d'ambiente": "roomNote", "eliminato": "disposed", "stato originale": "originalStatus", "url immagine": "imageUrl",  // it
  "estado de origem": "originalStatus", "url da imagem": "imageUrl",  // pt (« nota de ambiente » et « eliminado » sont déjà là, es/pt partagent le mot)
  // "age" (computed display column) intentionally has NO mapping — ignored.

  // ── the four other UI languages ────────────────────────────────────────
  //
  // The WRITER was French and is no longer — see `CSV_COLUMNS` below for why,
  // and note the order: the reader had to learn a language BEFORE the writer
  // could emit it. That direction is not a detail, it is what keeps every file
  // the app has ever produced readable. Measured before this: the
  // table knew FR + EN only, so a Spanish, German, Italian or Portuguese user
  // who translated the headers in their spreadsheet — the natural thing to do
  // with a template they cannot read — got `csv_import_empty`, whose message
  // then told them to look for columns called « Marque » and « Nom ».
  //
  // Widening the reader is purely ADDITIVE: no file that imported before
  // changes meaning, because every one of these keys was previously unknown.
  //
  // THE RULE FOR ADDING ONE: it must not already exist pointing at a DIFFERENT
  // field. Two languages sharing a word for the same field is fine and common
  // (`Marca` is brand in es/it/pt, `Peso` is weight in es/it/pt). What is not
  // fine is a homograph: Italian « Note » (notes) folds to `note`, which is
  // already the FRENCH rating column — so Italian uses `Voto` for the rating
  // and `Note di degustazione` for the notes. `csvHeaderLanguages.test.ts`
  // re-derives that check over the whole table, so the next language cannot
  // introduce one by accident.
  // es
  "marca": "brand", "nombre": "name", "categoria": "category",
  "composicion": "blend", "corte": "cut", "fuerza": "force", "sabor": "taste",
  "descripcion": "description", "valoracion": "rating", "recomprar": "rebuy",
  "notas de cata": "tastingNotes", "envejecimiento": "agingMax", "estado": "status",
  "peso": "weightG", "peso inicial": "weightInitial",
  "fecha compra": "datePurchased", "fecha produccion": "dateProduction",
  "fecha apertura": "dateOpened", "fecha fin": "dateFinished",
  "num. caja": "boxNumber", "num caja": "boxNumber", "caja": "boxNumber",
  "ubicacion": "storageLocation", "precio": "price", "vendedor": "seller",
  "sitio vendedor": "sellerUrl",
  // de
  "marke": "brand", "kategorie": "category", "mischung": "blend",
  "schnitt": "cut", "starke": "force", "geschmack": "taste",
  "beschreibung": "description", "bewertung": "rating", "nachkaufen": "rebuy",
  "verkostungsnotizen": "tastingNotes", "reifung": "agingMax",
  "gewicht": "weightG", "anfangsgewicht": "weightInitial",
  "kaufdatum": "datePurchased", "herstellungsdatum": "dateProduction",
  "offnungsdatum": "dateOpened", "enddatum": "dateFinished",
  "dosennummer": "boxNumber", "lagerort": "storageLocation",
  "preis": "price", "handler": "seller", "handler-website": "sellerUrl",
  // it
  "nome": "name", "composizione": "blend", "taglio": "cut", "forza": "force",
  "gusto": "taste", "descrizione": "description", "voto": "rating",
  "ricomprare": "rebuy", "note di degustazione": "tastingNotes",
  "invecchiamento": "agingMax", "stato": "status", "peso iniziale": "weightInitial",
  "data acquisto": "datePurchased", "data produzione": "dateProduction",
  "data apertura": "dateOpened", "data fine": "dateFinished",
  "numero scatola": "boxNumber", "posizione": "storageLocation",
  "prezzo": "price", "venditore": "seller", "sito venditore": "sellerUrl",
  // pt
  "composicao": "blend", "forca": "force", "descricao": "description",
  "classificacao": "rating", "notas de prova": "tastingNotes",
  "envelhecimento": "agingMax",
  "data compra": "datePurchased", "data producao": "dateProduction",
  "data abertura": "dateOpened", "data fim": "dateFinished",
  "numero caixa": "boxNumber", "localizacao": "storageLocation",
  "preco": "price", "site vendedor": "sellerUrl",
};

// ── ce que l'app ÉCRIT ────────────────────────────────────────────────────────
//
// L'en-tête d'un CSV produit par l'app, par champ et par langue. Elle vit ICI,
// collée à `HEADER_ALIASES`, pour la raison exacte qui a fait naître
// `CSV_DELIM` : l'écrivain et le lecteur doivent partager un fichier, sans quoi
// ils dérivent. Chaque cellule de cette table DOIT se replier, via la table
// ci-dessus, sur le champ qui la porte — c'est l'aller-retour, et
// `csvExportLanguages.test.ts` le vérifie pour les six langues plutôt que de le
// promettre.
//
// POURQUOI L'ÉCRIVAIN A CESSÉ D'ÊTRE FRANÇAIS, alors que ce fichier a longtemps
// porté l'acquittement inverse. Sa raison était : « le lecteur compare les
// en-têtes à une table d'alias FR+EN, donc localiser casserait silencieusement
// la ré-importation d'un fichier exporté sous une autre langue ». Cette prémisse
// a cessé d'être vraie quand le lecteur a appris les six langues — et un
// commentaire qui invoque un mécanisme disparu est pire que pas de commentaire.
//
// CE QUI REND LE BASCULEMENT SÛR, et c'est une MESURE et non un espoir : le
// danger n'était pas l'aller-retour dans la version courante (le lecteur
// comprend tout) mais un ANCIEN build lisant un fichier neuf. Or l'élargissement
// du lecteur fut purement additif : pour es/de/it/pt, AUCUN en-tête n'était
// connu avant, donc un ancien build ne trouve ni marque ni nom et échoue
// BRUYAMMENT sur `csv_import_empty`. Il n'atteint jamais la colonne Statut,
// dont l'échec, lui, serait SILENCIEUX (repli en cave). L'en-tête masque donc
// la valeur : c'est pour cela que les deux se localisent ENSEMBLE, jamais l'une
// sans l'autre. fr et en étaient déjà compris de bout en bout.
var CSV_COLUMNS: Record<string, Record<string, string>> = {
  brand: { fr: "Marque", en: "Brand", es: "Marca", de: "Marke", it: "Marca", pt: "Marca" },
  name: { fr: "Nom", en: "Name", es: "Nombre", de: "Name", it: "Nome", pt: "Nome" },
  category: { fr: "Categorie", en: "Category", es: "Categoría", de: "Kategorie", it: "Categoria", pt: "Categoria" },
  blend: { fr: "Composition", en: "Blend", es: "Composición", de: "Mischung", it: "Composizione", pt: "Composição" },
  cut: { fr: "Coupe", en: "Cut", es: "Corte", de: "Schnitt", it: "Taglio", pt: "Corte" },
  force: { fr: "Force", en: "Strength", es: "Fuerza", de: "Stärke", it: "Forza", pt: "Forca" },
  roomNote: { fr: "Room Note", en: "Room Note", es: "Nota de ambiente", de: "Raumnote", it: "Nota d'ambiente", pt: "Nota de ambiente" },
  taste: { fr: "Gout", en: "Taste", es: "Sabor", de: "Geschmack", it: "Gusto", pt: "Sabor" },
  description: { fr: "Description", en: "Description", es: "Descripción", de: "Beschreibung", it: "Descrizione", pt: "Descrição" },
  rating: { fr: "Note", en: "Rating", es: "Valoración", de: "Bewertung", it: "Voto", pt: "Classificação" },
  rebuy: { fr: "A reprendre", en: "Rebuy", es: "Recomprar", de: "Nachkaufen", it: "Ricomprare", pt: "Recomprar" },
  tastingNotes: { fr: "Notes degustation", en: "Tasting notes", es: "Notas de cata", de: "Verkostungsnotizen", it: "Note di degustazione", pt: "Notas de prova" },
  agingMax: { fr: "Age max cave", en: "Aging max", es: "Envejecimiento", de: "Reifung", it: "Invecchiamento", pt: "Envelhecimento" },
  status: { fr: "Statut", en: "Status", es: "Estado", de: "Status", it: "Stato", pt: "Estado" },
  disposed: { fr: "Elimine", en: "Disposed", es: "Eliminado", de: "Entsorgt", it: "Eliminato", pt: "Eliminado" },
  weightG: { fr: "Poids", en: "Weight", es: "Peso", de: "Gewicht", it: "Peso", pt: "Peso" },
  weightInitial: { fr: "Poids initial", en: "Initial weight", es: "Peso inicial", de: "Anfangsgewicht", it: "Peso iniziale", pt: "Peso inicial" },
  originalStatus: { fr: "Statut origine", en: "Original status", es: "Estado origen", de: "Ursprungsstatus", it: "Stato originale", pt: "Estado de origem" },
  datePurchased: { fr: "Date achat", en: "Purchase date", es: "Fecha compra", de: "Kaufdatum", it: "Data acquisto", pt: "Data compra" },
  dateProduction: { fr: "Date production", en: "Production date", es: "Fecha produccion", de: "Herstellungsdatum", it: "Data produzione", pt: "Data produção" },
  dateOpened: { fr: "Date mise en pot", en: "Date opened", es: "Fecha apertura", de: "Öffnungsdatum", it: "Data apertura", pt: "Data abertura" },
  dateFinished: { fr: "Date fin", en: "Finished date", es: "Fecha fin", de: "Enddatum", it: "Data fine", pt: "Data fim" },
  boxNumber: { fr: "No boite", en: "Box number", es: "Núm. caja", de: "Dosennummer", it: "Numero scatola", pt: "Numero caixa" },
  storageLocation: { fr: "Lieu de stockage", en: "Storage location", es: "Ubicación", de: "Lagerort", it: "Posizione", pt: "Localização" },
  price: { fr: "Prix", en: "Price", es: "Precio", de: "Preis", it: "Prezzo", pt: "Preco" },
  seller: { fr: "Vendeur", en: "Seller", es: "Vendedor", de: "Händler", it: "Venditore", pt: "Vendedor" },
  sellerUrl: { fr: "Site vendeur", en: "Seller url", es: "Sitio vendedor", de: "Händler-Website", it: "Sito venditore", pt: "Site vendedor" },
  imageUrl: { fr: "Image URL", en: "Image URL", es: "URL de imagen", de: "Bild-URL", it: "URL immagine", pt: "URL da imagem" },
  age: { fr: "Age", en: "Age", es: "Edad", de: "Alter", it: "Età", pt: "Idade" },

  // ── colonnes des QUATRE AUTRES BLOCS (pipes / envies / accessoires /
  // séances). Elles sont d'AFFICHAGE PUR : `parseTobaccoCsv` s'arrête au
  // premier marqueur `=== SECTION ===`, donc le lecteur ne les voit jamais et
  // aucune contrainte de repliement ne pèse sur elles.
  //
  // Elles sont ici QUAND MÊME, et c'est le point : un export dont le bloc
  // tabacs serait traduit et les quatre autres français serait un fichier
  // MIXTE — c'est-à-dire pire qu'un fichier entièrement français. Traduire à
  // moitié ne fait pas la moitié du bien ; cela fait un fichier incohérent.
  pipeModel: { fr: "Modele", en: "Model", es: "Modelo", de: "Modell", it: "Modello", pt: "Modelo" },
  shape: { fr: "Forme", en: "Shape", es: "Forma", de: "Form", it: "Forma", pt: "Forma" },
  bend: { fr: "Courbure", en: "Bend", es: "Curvatura", de: "Biegung", it: "Curvatura", pt: "Curvatura" },
  length: { fr: "Longueur", en: "Length", es: "Longitud", de: "Länge", it: "Lunghezza", pt: "Comprimento" },
  filterType: { fr: "Filtre", en: "Filter", es: "Filtro", de: "Filter", it: "Filtro", pt: "Filtro" },
  chamberDiameter: { fr: "Diam. foyer (mm)", en: "Chamber dia. (mm)", es: "Diam. cazoleta (mm)", de: "Brennkammer-Durchm. (mm)", it: "Diam. fornello (mm)", pt: "Diam. fornilho (mm)" },
  chamberDepth: { fr: "Prof. foyer (mm)", en: "Chamber depth (mm)", es: "Prof. cazoleta (mm)", de: "Brennkammer-Tiefe (mm)", it: "Prof. fornello (mm)", pt: "Prof. fornilho (mm)" },
  bowlMaterial: { fr: "Matiere bol", en: "Bowl material", es: "Material cazoleta", de: "Material Kopf", it: "Materiale fornello", pt: "Material do fornilho" },
  stemMaterial: { fr: "Matiere bec", en: "Stem material", es: "Material boquilla", de: "Material Mundstück", it: "Materiale bocchino", pt: "Material da boquilha" },
  finish: { fr: "Finition", en: "Finish", es: "Acabado", de: "Oberfläche", it: "Finitura", pt: "Acabamento" },
  notes: { fr: "Remarque", en: "Notes", es: "Observaciones", de: "Anmerkung", it: "Osservazioni", pt: "Observações" },
  priority: { fr: "Priorite", en: "Priority", es: "Prioridad", de: "Priorität", it: "Priorità", pt: "Prioridade" },
  accType: { fr: "Type", en: "Type", es: "Tipo", de: "Typ", it: "Tipo", pt: "Tipo" },
  fuel: { fr: "Carburant", en: "Fuel", es: "Combustible", de: "Brennstoff", it: "Combustibile", pt: "Combustível" },
  sessDate: { fr: "Date", en: "Date", es: "Fecha", de: "Datum", it: "Data", pt: "Data" },
  sessTime: { fr: "Heure", en: "Time", es: "Hora", de: "Uhrzeit", it: "Ora", pt: "Hora" },
  sessTobacco: { fr: "Tabac", en: "Tobacco", es: "Tabaco", de: "Tabak", it: "Tabacco", pt: "Tabaco" },
  sessPipe: { fr: "Pipe", en: "Pipe", es: "Pipa", de: "Pfeife", it: "Pipa", pt: "Cachimbo" },
  duration: { fr: "Duree (min)", en: "Duration (min)", es: "Duración (min)", de: "Dauer (Min.)", it: "Durata (min)", pt: "Duração (min)" },
  smoked: { fr: "Quantite fumee", en: "Amount smoked", es: "Cantidad fumada", de: "Gerauchte Menge", it: "Quantità fumata", pt: "Quantidade fumada" },
  aromas: { fr: "Aromes", en: "Aromas", es: "Aromas", de: "Aromen", it: "Aromi", pt: "Aromas" },
  place: { fr: "Lieu", en: "Place", es: "Lugar", de: "Ort", it: "Luogo", pt: "Local" },
  city: { fr: "Commune", en: "City", es: "Municipio", de: "Gemeinde", it: "Comune", pt: "Localidade" },
  country: { fr: "Pays", en: "Country", es: "País", de: "Land", it: "Paese", pt: "País" },
  lat: { fr: "Latitude", en: "Latitude", es: "Latitud", de: "Breitengrad", it: "Latitudine", pt: "Latitude" },
  lng: { fr: "Longitude", en: "Longitude", es: "Longitud", de: "Längengrad", it: "Longitudine", pt: "Longitude" },
};

/** Les valeurs que l'app écrit dans les colonnes fermées. Chacune doit être un
 *  mot que `normStatus` / `parseRebuy` placent — même contrat, même test. */
var CSV_VALUES: Record<string, Record<string, string>> = {
  cellar:   { fr: "Cave", en: "Cellar", es: "Bodega", de: "Keller", it: "Cantina", pt: "Adega" },
  jar:      { fr: "Pot", en: "Jar", es: "Tarro", de: "Glas", it: "Barattolo", pt: "Frasco" },
  finished: { fr: "Termine", en: "Finished", es: "Acabado", de: "Aufgeraucht", it: "Finito", pt: "Terminado" },
  yes:      { fr: "Oui", en: "Yes", es: "Sí", de: "Ja", it: "Si", pt: "Sim" },
  no:       { fr: "Non", en: "No", es: "No", de: "Nein", it: "No", pt: "Não" },
  // Statuts d'AFFICHAGE PUR (pipes, accessoires) : le lecteur ne lit jamais ces
  // blocs, donc aucun `normStatus` ne les contraint. Les accessoires écrivaient
  // le jeton interne brut (`active` / `retired`) dans toutes les langues —
  // incohérent avant comme après, mais visible maintenant que l'en-tête voisin
  // est traduit.
  pipeActive:   { fr: "Active", en: "Active", es: "Activa", de: "Aktiv", it: "Attiva", pt: "Ativo" },
  pipeFinished: { fr: "Finie", en: "Retired", es: "Retirada", de: "Ausgemustert", it: "Ritirata", pt: "Retirado" },
  accActive:    { fr: "Actif", en: "Active", es: "Activo", de: "Aktiv", it: "Attivo", pt: "Ativo" },
  accRetired:   { fr: "Retire", en: "Retired", es: "Retirado", de: "Ausgemustert", it: "Ritirato", pt: "Retirado" },
};

/** La langue d'écriture : celle demandée si l'app l'a, sinon le FRANÇAIS.
 *  Le repli est le français et NON l'anglais, contrairement au reste de l'app :
 *  ce module produit la forme CANONIQUE, celle que tout build a toujours sue
 *  lire. Un code inconnu doit donc donner le fichier le plus universellement
 *  ré-importable, pas le plus lisible. */
export function csvLang(lang: any): string {
  var l = String(lang || "");
  return Object.prototype.hasOwnProperty.call(CSV_COLUMNS["brand"] || {}, l) ? l : "fr";
}

/** L'en-tête du champ `field` dans la langue d'écriture, `unit` suffixé quand
 *  la colonne en porte une (poids, prix). */
export function csvHeader(field: string, lang: any, unit?: string): string {
  var row = Object.prototype.hasOwnProperty.call(CSV_COLUMNS, field) ? CSV_COLUMNS[field] : null;
  var h = row ? row[csvLang(lang)] || row["fr"] || field : field;
  return unit ? h + " (" + unit + ")" : String(h);
}

/** La valeur canonique `key` dans la langue d'écriture. */
export function csvValue(key: string, lang: any): string {
  var row = Object.prototype.hasOwnProperty.call(CSV_VALUES, key) ? CSV_VALUES[key] : null;
  return row ? String(row[csvLang(lang)] || row["fr"]) : "";
}

/** Test-only : la table complète, pour que l'aller-retour se dérive au lieu de
 *  se réécrire (une copie serait une deuxième source de vérité). */
export var _CSV_COLUMNS_FOR_TESTS = CSV_COLUMNS;
export var _CSV_VALUES_FOR_TESTS = CSV_VALUES;

// ── value coercion ───────────────────────────────────────────────────────────

function clamp05(v: any): number {
  var n = parseInt(String(v == null ? "" : v).trim(), 10);
  if (!Number.isFinite(n)) return 0;
  return n < 0 ? 0 : n > 5 ? 5 : n;
}

/**
 * The IMPORT CONTRACT applies here too.
 *
 * `CAT_MAP` / `CUT_MAP` are the trade labels a source may write (`Navy Cut`,
 * `Cigar`, `Krumble Kake`) mapped onto the app's canonical value. They existed
 * for the catalogue importer and this one never consulted them: a cellar CSV
 * saying `Navy Cut` became `Autre` while the same word in a catalogue becomes
 * `Flake`. That was an oversight, not a decision — a hand-typed cellar CSV is
 * at least as likely to carry a trade label as a curated delivery is, since it
 * is copied off the tin or exported from another app.
 *
 * FOLDED index, unlike the catalogue's exact `mapCut`: that one answers "is
 * this a trade label the contract knows?" and must not turn a typo into a
 * match, whereas this file is hand-typed — and this module has always been accent- and
 * case-tolerant against `CATS`/`CUTS`, so tolerating the same on the map is
 * the module's own contract rather than a new invention. Precomputed once:
 * per-row folding of a few dozen keys × MAX_ROWS would be real work.
 */
function foldIndex(map: Record<string, string>): Record<string, string> {
  var out: Record<string, string> = Object.create(null);
  for (var k in map) out[fold(k)] = map[k] as string;
  return out;
}
var _CAT_FOLD = foldIndex(CAT_MAP as unknown as Record<string, string>);
var _CUT_FOLD = foldIndex(CUT_MAP as unknown as Record<string, string>);

function canonEnum(v: any, list: readonly string[], map?: Record<string, string>): string {
  var raw = String(v == null ? "" : v).trim();
  if (!raw) return "";
  var f = fold(raw);
  for (var i = 0; i < list.length; i++) {
    if (fold(list[i]) === f) return list[i] as string;
  }
  if (map) {
    var mapped = map[f];
    // The target is re-checked against the list rather than trusted. It cannot
    // fail today (`enumMapsSingleSource.test.ts` asserts every map target is
    // canonical), and the check keeps this function total if that ever slips:
    // a bad target falls through to "Autre", the older behaviour.
    if (mapped) {
      var mf = fold(mapped);
      for (var j = 0; j < list.length; j++) {
        if (fold(list[j]) === mf) return list[j] as string;
      }
    }
  }
  // Coerced, NOT kept verbatim — and that is the opposite of what the
  // catalogue parser does, deliberately. A cellar fiche is edited in a form
  // whose dropdown is fixed, so an unrecognised value would be silently
  // rewritten the first time the user opens and saves it.
  // Snapping at import is deterministic; the caller REPORTS it.
  return list.indexOf("Autre") >= 0 ? "Autre" : "";
}

function parseRebuy(v: any): boolean | null {
  var f = fold(v);
  // `si` (es/it, accent folded from Sí/Sì), `ja` (de), `sim` (pt) — the words
  // the app itself renders for yes. NOTE `no` was ALREADY the negative here
  // and is the Spanish/Italian/Portuguese word for no, so the negative side
  // needed nothing: the three languages that say « no » were covered by the
  // English alias all along. German « nein » is the one addition.
  if (f === "oui" || f === "yes" || f === "y" || f === "true" || f === "1" || f === "o"
    || f === "si" || f === "ja" || f === "sim") return true;
  if (f === "non" || f === "no" || f === "n" || f === "false" || f === "0"
    || f === "nein" || f === "nao") return false;
  return null;
}

// « cette cellule dit-elle oui ? » — UNE règle, une implémentation. Elle en
// avait deux : `parseRebuy` (tri-état, élargi aux six langues) et cette
// fonction, restée FR/EN, qui sert la colonne « Éliminé ». Le motif que ce
// dépôt paie en boucle : quand une règle existe sur deux chemins, c'est le
// SECOND qui n'est pas testé. Depuis que l'app ÉCRIT « Sim » ou « Ja » dans
// cette colonne, l'écart n'était plus théorique.
function parseBool(v: any): boolean {
  return parseRebuy(v) === true;
}

/**
 * The status cell, in the six UI languages.
 *
 * The words are the ones the APP SHOWS — `lot_jar` / `lot_cellar` /
 * `lot_finished_lbl` and their `f_*` filter-chip siblings — because that is
 * what a user transcribes into a spreadsheet. They were read out of the
 * dictionaries rather than invented; `csvHeaderLanguages.test.ts` re-derives
 * them from `src/i18n/*.ts`, so a relabelled chip cannot leave this list behind.
 *
 * Why it matters more than the headers: an unreadable HEADER loses a column
 * loudly (the import reports it, and without brand+name it refuses outright),
 * whereas an unreadable STATUS used to fall through to `|| "cellar"` — so a
 * Spanish user writing « Tarro » had every opened jar imported as a SEALED
 * tin, silently, with the row otherwise perfect. That default stays (a blank
 * cell must still mean cellar), but the caller now reports the coercion.
 */
function normStatus(v: any): string {
  var f = fold(v);
  if (f === "jar" || f === "pot" || f === "en pot" || f === "ouvert" || f === "ouverte"
    || f === "tarro" || f === "en tarro"           // es
    || f === "glas" || f === "im glas"             // de
    || f === "barattolo" || f === "in barattolo"   // it
    || f === "frasco" || f === "em frasco") return "jar"; // pt
  if (f === "finished" || f === "fini" || f === "finie" || f === "termine" || f === "termine e" || f === "terminee"
    || f === "acabado" || f === "lote acabado"     // es
    || f === "aufgeraucht" || f === "aufgerauchtes los" // de
    || f === "finito" || f === "lotto finito"      // it
    || f === "terminado" || f === "lote terminado") return "finished"; // pt
  if (f === "cellar" || f === "cave" || f === "en cave" || f === "scelle" || f === "scellee"
    || f === "bodega" || f === "en bodega"         // es
    || f === "keller" || f === "im keller"         // de
    || f === "cantina" || f === "in cantina"       // it
    || f === "adega" || f === "na adega") return "cellar"; // pt
  return "";
}

/** Group separators a spreadsheet emits: ASCII space, NBSP, narrow NBSP, thin
 *  space, and the Swiss apostrophe (straight and typographic). */
var GROUP_SEP_RE = /[ \u00A0\u202F\u2009'\u2019]/g;
/** A plain decimal, once grouping is stripped and the decimal mark is a dot.
 *  Deliberately STRICTER than `parseFloat`, which stops at the first character
 *  it cannot read and reports nothing — that silence is the defect. */
var PLAIN_NUM_RE = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/;
/** The same decimal followed by a UNIT — a trailing run holding no digit.
 *
 *  Strictness against `parseFloat` is right for `1 234,5` → 1, where the answer
 *  is silently wrong by three orders of magnitude. It is WRONG for `50g`, where
 *  `parseFloat` returns 50, i.e. the correct answer: refusing that cell fixes
 *  no defect and destroys a weight this parser had always read. A tin is sold
 *  as "50g" or "2oz", so a hand-built file is likely to carry one, and this
 *  module's contract is tolerance everywhere else (accent-insensitive headers,
 *  FR+EN aliases, `dd.mm.yyyy`, EN-locale dates).
 *
 *  A suffix with no digit in it can only name the unit the column already
 *  names, so the number is unambiguous. A leading word (`env. 12` — an
 *  approximation) or a second number (`12abc34`) is refused and REPORTED,
 *  which is the half that was genuinely missing. */
var NUM_WITH_UNIT_RE = /^([+-]?(?:\d+(?:\.\d*)?|\.\d+))[^\d]*$/;

/**
 * Read a numeric cell.
 *
 * `value` is the canonical decimal string, or "" when the cell is empty OR
 * unreadable — the caller stores "" either way, and the app already reads an
 * absent weight as "untracked" rather than as zero. `bad` carries the raw text
 * when the cell held SOMETHING the parser could not read, so the caller can
 * report it; an EMPTY cell is never `bad`, because an absence is not a defect.
 *
 * It used to be `String(v).trim().replace(",", ".")` then `parseFloat` — ONE
 * comma, no other separator, and a parse that stops at the first character it
 * cannot read while reporting nothing. So `1 234,5` (what a fr/de spreadsheet
 * emits) imported as **1** and `1,234.56` as **1.234**: three orders of
 * magnitude of stock, on a module whose stated contract is that an export
 * edited in a spreadsheet round-trips, with the row neither `skipped` nor
 * listed in `issues`.
 */
function readNum(v: any): { value: string; bad: string } {
  var raw = String(v == null ? "" : v).trim();
  if (!raw) return { value: "", bad: "" };
  var s = raw.replace(GROUP_SEP_RE, "");
  var lastComma = s.lastIndexOf(",");
  var lastDot = s.lastIndexOf(".");
  if (lastComma >= 0 && lastDot >= 0) {
    // Both marks present: the LAST one is the decimal, the other is grouping.
    // `1.234,56` and `1,234.56` are the same number written two ways.
    if (lastComma > lastDot) s = String(s).replace(/\./g, "").replace(",", ".");
    else s = String(s).replace(/,/g, "");
  } else if (lastComma >= 0) {
    // A SINGLE comma stays a DECIMAL mark — that is what this parser has always
    // done and what a French spreadsheet emits, so `2,000` reads as 2 and not
    // as 2000. Genuinely ambiguous, and changing it would silently multiply
    // every fr-locale weight by a thousand. SEVERAL commas can only be grouping.
    if (s.indexOf(",") === lastComma) s = String(s).replace(",", ".");
    else s = String(s).replace(/,/g, "");
  }
  if (!PLAIN_NUM_RE.test(s)) {
    var unit = NUM_WITH_UNIT_RE.exec(s);
    if (!unit) return { value: "", bad: raw };
    s = unit[1] as string;
  }
  var n = parseFloat(s);
  if (!Number.isFinite(n) || n < 0) return { value: "", bad: raw };
  return { value: String(n), bad: "" };
}

var EN_MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
function _pad2(n: number): string { return (n < 10 ? "0" : "") + n; }

function normDate(v: any): string {
  var raw = String(v == null ? "" : v).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  // Keep a partial `YYYY-MM` production date verbatim. It's
  // a valid lot date (fmtDate passes it through unchanged), so blanking it here
  // made the CSV round-trip non-idempotent — the lot's `lotMergeKey` changed and
  // a re-import appended it as a duplicate.
  if (/^\d{4}-\d{2}$/.test(raw)) return raw;
  if (/^\d{4}$/.test(raw)) return raw;
  // dd.mm.yyyy or dd/mm/yyyy → yyyy-mm-dd
  var m = raw.match(/^(\d{2})[./](\d{2})[./](\d{4})$/);
  if (m) return m[3] + "-" + m[2] + "-" + m[1];
  // mm.yyyy → yyyy-mm. The FR export of a MONTH-precision production date,
  // which `fmtDate` now formats instead of emitting raw ISO. Without this the
  // export would round-trip to "" and the lot would silently lose its
  // production date — and `lotMergeKey` would change, so a re-import would
  // append it as a duplicate. Unambiguous against the rule above: that one
  // needs three groups, this one two.
  var mm = raw.match(/^(\d{2})[./](\d{4})$/);
  if (mm) {
    var mmi = parseInt(String(mm[1]), 10);
    if (mmi >= 1 && mmi <= 12) return mm[2] + "-" + mm[1];
  }
  // EN-locale export dates ("Mar 15, 2024" — fmtDate en-mode output)
  // → ISO, so a CSV exported with the English date format round-trips its lot
  // dates instead of silently blanking them.
  var me = raw.match(/^([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})$/);
  if (me) {
    var mon = EN_MONTHS.indexOf(String(me[1]).slice(0, 3).toLowerCase());
    var day = parseInt(String(me[2]), 10);
    if (mon >= 0 && day >= 1 && day <= 31) return me[3] + "-" + _pad2(mon + 1) + "-" + _pad2(day);
  }
  // "Sep 2017" — the EN-locale export of the same month-precision date. The
  // rule above requires a day, so this one cannot shadow it.
  var mey = raw.match(/^([A-Za-z]{3,9})\.?\s+(\d{4})$/);
  if (mey) {
    var mony = EN_MONTHS.indexOf(String(mey[1]).slice(0, 3).toLowerCase());
    if (mony >= 0) return mey[2] + "-" + _pad2(mony + 1);
  }
  return "";
}

function normAging(v: any): string {
  var raw = String(v == null ? "" : v).trim();
  if (/^\d+$/.test(raw)) return raw;
  if (/^\d+\s*-\s*\d+$/.test(raw)) return raw.replace(/\s+/g, "");
  return "";
}

// ── main ─────────────────────────────────────────────────────────────────────

var LOT_FIELDS = ["status", "weightG", "weightInitial", "originalStatus", "datePurchased",
  "dateProduction", "dateOpened", "dateFinished", "boxNumber", "storageLocation",
  "price", "seller", "sellerUrl", "disposed"];

export function parseTobaccoCsv(
  text: string,
  opts?: { idBase?: number; todayIso?: string },
): CsvImportResult {
  var empty: CsvImportResult = { tobaccos: [], rows: 0, skipped: 0, lots: 0, headers: [], sectioned: false, capped: false, badCategory: 0, badCut: 0, badNumber: 0, badStatus: 0, issues: [], issuesTruncated: false };
  if (typeof text !== "string") return empty;
  var clean = String(text).replace(/^\uFEFF/, "");
  if (!clean.trim()) return empty;

  var firstNl = clean.indexOf("\n");
  var headerLine = firstNl >= 0 ? clean.substring(0, firstNl) : clean;
  var delim = detectDelim(headerLine);
  var grid = tokenize(clean, delim);
  if (grid.length < 1) return empty;

  var headerCells = grid[0] || [];
  var colKey: (string | null)[] = headerCells.map(function (h) {
    // hasOwnProperty guard: a column literally named "__proto__" or
    // "constructor" would otherwise resolve to Object.prototype / the
    // Object function via prototype-chain lookup (both truthy), leaking a
    // non-string into `colKey` / the returned `headers: string[]` and
    // producing a junk `rec` write-key. Only genuine own-property aliases map.
    var f = fold(h);
    return Object.prototype.hasOwnProperty.call(HEADER_ALIASES, f) ? HEADER_ALIASES[f]! : null;
  });
  var recognised = colKey.filter(function (k): k is string { return !!k; });
  if (recognised.indexOf("brand") < 0 || recognised.indexOf("name") < 0) {
    // Without a brand + name column there's nothing to key on.
    return Object.assign({}, empty, { headers: recognised });
  }

  var idBase = (opts && typeof opts.idBase === "number" && Number.isFinite(opts.idBase))
    ? opts.idBase : 1;
  // The caller's clock, injected — see the lifecycle back-fill below.
  var today = normDate((opts && opts.todayIso) || "") || "";
  var lotSeq = 0;

  var order: string[] = [];
  var groups: Record<string, any> = Object.create(null);
  var dataRows = 0, skipped = 0, lotCount = 0;
  var sectioned = false, capped = false;
  var badCategory = 0, badCut = 0, badNumber = 0, badStatus = 0;
  var issues: CsvImportIssue[] = [];
  var note = function (row: number, kind: CsvImportIssue["kind"], b: string, n: string, value: string) {
    if (issues.length < MAX_CSV_ISSUES) issues.push({ row: row, kind: kind, brand: b, name: n, value: value });
  };

  for (var r = 1; r < grid.length; r++) {
    var cells = grid[r] || [];
    // The full CSV EXPORT (buildCsvLines) is multi-section: the tobacco block
    // is followed by "=== PIPES ===" / "=== ACCESSOIRES ===" / "=== JOURNAL ==="
    // separators + rows with different columns. STOP at the first section
    // marker so those rows aren't misread as tobaccos (which used to mint a
    // junk tobacco named "=== PIPES ==="). The tobacco block round-trips; the
    // caller warns that only tabacs were imported.
    var firstCell = String(cells[0] == null ? "" : cells[0]).trim();
    // The export's `csvEsc` prefixes a "'" to any cell starting with "=" (CSV
    // formula-injection guard), so the real section marker arrives as
    // "'=== PIPES ===". Strip the guard apostrophe before the marker check —
    // otherwise the section-stop is silently defeated and the
    // PIPES/ACCESSOIRES/JOURNAL rows get misread as tobaccos.
    firstCell = unescapeFormulaGuard(firstCell);
    // Match the EXACT known markers, not any "===" prefix,
    // so a user brand like "=== rare ===" is parsed as a tobacco instead of
    // triggering the section-stop and dropping that row + everything after.
    if (_CSV_SECTION_MARKERS.indexOf(firstCell) >= 0) { sectioned = true; break; }
    // skip a fully-empty line
    var anyVal = cells.some(function (c) { return String(c == null ? "" : c).trim() !== ""; });
    if (!anyVal) continue;
    if (dataRows >= MAX_ROWS) { capped = true; break; }
    dataRows++;

    var rec: Record<string, string> = Object.create(null);
    for (var c = 0; c < cells.length; c++) {
      var key = colKey[c];
      if (!key) continue;
      // Undo the export's formula-guard apostrophe so a
      // brand/name/field starting with = + - @ | round-trips cleanly.
      var val = unescapeFormulaGuard(String(cells[c] == null ? "" : cells[c]).trim());
      if (rec[key] === undefined || rec[key] === "") rec[key] = val;
    }

    var brand = String(rec["brand"] || "").trim();
    var name = String(rec["name"] || "").trim();
    // `r` indexes the token GRID, whose row 0 is the header — so `r + 1` is
    // the 1-based line the user sees in a spreadsheet. (A quoted newline
    // inside a cell shifts the physical line; the logical row is what the
    // parser and the reader agree on, and it is what the catalogue side
    // reports too.)
    var lineNo = r + 1;
    if (!brand && !name) { skipped++; note(lineNo, "no-identity", "", "", ""); continue; }

    var gk = fold(brand) + "|" + fold(name);
    var tob = groups[gk];
    if (!tob) {
      // The enum values are read from the FIRST row of a brand+name group —
      // later rows of the same group only contribute lots — so a coercion is
      // reported against the row it was actually read from.
      var rawCat = String(rec["category"] || "").trim();
      var rawCut = String(rec["cut"] || "").trim();
      var canonCat = canonEnum(rawCat, CATS, _CAT_FOLD);
      var canonCut = canonEnum(rawCut, CUTS, _CUT_FOLD);
      // A row that literally says "Autre" was understood; only a value the
      // parser could not place counts as a coercion.
      if (rawCat && canonCat === "Autre" && fold(rawCat) !== "autre") {
        badCategory++; note(lineNo, "category", brand, name, rawCat);
      }
      if (rawCut && canonCut === "Autre" && fold(rawCut) !== "autre") {
        badCut++; note(lineNo, "cut", brand, name, rawCut);
      }
      tob = Object.assign({}, BT, {
        id: idBase + order.length,
        brand: brand, name: name,
        category: canonCat,
        blend: rec["blend"] || "",
        cut: canonCut,
        force: clamp05(rec["force"]),
        roomNote: clamp05(rec["roomNote"]),
        taste: clamp05(rec["taste"]),
        rating: clamp05(rec["rating"]),
        rebuy: parseRebuy(rec["rebuy"]),
        tastingNotes: rec["tastingNotes"] || "",
        description: rec["description"] || "",
        agingMax: normAging(rec["agingMax"]),
        imageUrl: "",   // external URLs are cleared by migrateData; local keys never come via CSV
        lots: [],
      });
      groups[gk] = tob;
      order.push(gk);
    }

    // A lot is created when the row carries any lot-level data.
    var hasLot = LOT_FIELDS.some(function (f) { return String(rec[f] || "").trim() !== ""; });
    if (hasLot) {
      // A numeric cell the parser could not read is BLANKED (as it always was)
      // and now REPORTED — the silence was the costly half of the defect, since
      // a truncated `1 234,5` looked exactly like a clean import.
      var readCell = function (field: string): string {
        var res = readNum(rec[field]);
        if (res.bad) { badNumber++; note(lineNo, "number", brand, name, res.bad); }
        return res.value;
      };
      var wG = readCell("weightG");
      var wInit = readCell("weightInitial") || wG;
      // A smoked-down lot can never have
      // current weight > initial. A hand-edited spreadsheet row with weightG >
      // weightInitial would otherwise persist a balance-overflow lot (the
      // invariants flag it, but it's still stored). Clamp the initial up to the
      // current so the imported lot is coherent (treated as full / unsmoked).
      var _wGn = parseFloat(wG), _wIn = parseFloat(wInit);
      if (Number.isFinite(_wGn) && Number.isFinite(_wIn) && _wGn > _wIn) wInit = wG;
      // A status the parser cannot place falls through to "cellar" — and that
      // default STAYS, because a blank cell legitimately means a sealed tin and
      // most hand-built files carry no status column at all. What was missing
      // was the report: a word it could not read produced an otherwise perfect
      // row, so an opened jar arrived SEALED with nothing said. Only a
      // NON-EMPTY unreadable cell counts.
      var rawStatus = String(rec["status"] || "").trim();
      var status = normStatus(rawStatus) || "cellar";
      if (rawStatus && !normStatus(rawStatus)) {
        badStatus++; note(lineNo, "status", brand, name, rawStatus);
      }
      lotSeq++;
      var lot = Object.assign({}, BL, {
        id: idBase + 100000 + lotSeq,
        status: status,
        originalStatus: normStatus(rec["originalStatus"]) || (status === "finished" ? "cellar" : status),
        weightG: wG,
        weightInitial: wInit,
        datePurchased: normDate(rec["datePurchased"]),
        dateProduction: normDate(rec["dateProduction"]),
        dateOpened: normDate(rec["dateOpened"]),
        dateFinished: normDate(rec["dateFinished"]),
        // (these two are back-filled below — see fillLifecycleDate.)
        boxNumber: rec["boxNumber"] || "",
        storageLocation: rec["storageLocation"] || "",
        price: readCell("price"),
        seller: rec["seller"] || "",
        sellerUrl: rec["sellerUrl"] || "",
        disposed: parseBool(rec["disposed"]),
      });
      // A status IMPLIES a date, so back-fill the one it implies.
      //
      // The shipped CSV template had a `Statut = Pot` example row and no "Date
      // mise en pot" column, so importing the app's OWN template turned the
      // Settings → Diagnostic panel red (`jar-has-dateOpened`,
      // `finished-has-dateFinished`) on the exact path the help documents:
      // download the template, fill it, import it. The EXPORT emits both columns
      // and the parser reads them, so an export round-trip was always clean —
      // this only ever bit a template or hand-built file.
      //
      // Fixing it in the PARSER rather than only in the template is the point:
      // any hand-built CSV can say "Pot" without a date, and the app fabricates
      // this date everywhere else on purpose (`applyLifecycleDates` stamps today
      // when the user promotes a lot in the form). The guess here is the
      // narrowest one available — a tin cannot have been opened before it was
      // bought — falling back to the import date, which is exactly the form's
      // guess. `todayIso` is INJECTED so this module stays pure and fuzzable.
      if (lot.status === "jar" && !lot.dateOpened) {
        lot.dateOpened = lot.datePurchased || today;
      }
      if (lot.status === "finished" && !lot.dateFinished) {
        lot.dateFinished = lot.dateOpened || lot.datePurchased || today;
      }
      tob.lots.push(lot);
      lotCount++;
    }
  }

  var tobaccos = order.map(function (k) { return groups[k]; });
  return { tobaccos: tobaccos, rows: dataRows, skipped: skipped, lots: lotCount, headers: recognised, sectioned: sectioned, capped: capped, badCategory: badCategory, badCut: badCut, badNumber: badNumber, badStatus: badStatus, issues: issues, issuesTruncated: issues.length >= MAX_CSV_ISSUES };
}

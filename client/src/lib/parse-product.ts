// Parser quick-add prodotto: una sola riga di testo libero → campi strutturati.
// Esempi:
//   "fusto birra Messina 30lt"        → name="Birra Messina", unit="fusto", unitSize="30lt", packSize=1
//   "Coca Cola 33cl cassa 24"          → name="Coca Cola", unit="cassa", unitSize="33cl", packSize=24
//   "Birra Moretti 0.66 cassa 12"      → name="Birra Moretti", unit="cassa", unitSize="0.66lt", packSize=12
//   "Prosciutto Crudo 200g"            → name="Prosciutto Crudo", unit="pz", unitSize="200g"
//   "Olio EVO 5lt"                     → name="Olio EVO", unit="lt", unitSize="5lt"
//   "Farina 00 sacco 25kg"             → name="Farina 00", unit="sacco", unitSize="25kg"

export interface ParsedProduct {
  name: string;
  brand: string;
  unit: string;          // "pz" | "cassa" | "fusto" | "bt" | "kg" | "lt" | "conf" | "sacco" | "mazzo" | "cartone"
  unitSize: string;      // es. "33cl", "30lt", "25kg"
  packSize: number;      // 1 di default, >1 se è una confezione multipla
}

// Mappa parole → unità canonica
const UNIT_MAP: Record<string, string> = {
  // canone
  pz: "pz", cassa: "cassa", fusto: "fusto", bt: "bt", kg: "kg", lt: "lt",
  conf: "conf", sacco: "sacco", mazzo: "mazzo", cartone: "cartone",
  // alias / plurali
  pezzo: "pz", pezzi: "pz",
  casse: "cassa",
  fusti: "fusto",
  bottiglia: "bt", bottiglie: "bt", bot: "bt", botti: "bt",
  chilo: "kg", chili: "kg", kilo: "kg",
  litro: "lt", litri: "lt", l: "lt",
  confezione: "conf", confezioni: "conf",
  sacchi: "sacco", sacchetto: "sacco",
  mazzi: "mazzo", mazzetto: "mazzo",
  cartoni: "cartone", scatola: "cartone", scatole: "cartone",
  rotolo: "rotolo", rotoli: "rotolo",
  latta: "pz", lattina: "pz", lattine: "pz", barattolo: "pz", barattoli: "pz",
};

// Regex per formati. Cattura un numero (anche decimale, virgola o punto) + unità di volume/peso.
const SIZE_RE = /^(\d+(?:[.,]\d+)?)\s*(cl|ml|lt|l|kg|g)$/i;
// Formati "tutto attaccato" tipo "0.5lt", "33cl", "750ml"
const SIZE_INLINE_RE = /(\d+(?:[.,]\d+)?)(cl|ml|lt|l|kg|g)\b/i;
// Pack size: "x24", "×24", "24x", o numero standalone dopo l'unità (gestito separatamente)
const PACK_RE = /^[x×](\d{1,3})$|^(\d{1,3})[x×]$/i;

export function parseProduct(input: string): ParsedProduct {
  const raw = input.trim();
  if (!raw) return { name: "", brand: "", unit: "pz", unitSize: "", packSize: 1 };

  // Tokenizza preservando capitalizzazione
  let tokens = raw.split(/\s+/);

  let unit = "";
  let unitSize = "";
  let packSize = 1;
  let unitTokenIndex = -1; // dove era l'unità (per capire se il numero dopo è pack)

  // ── 1) Estrai unità di misura (prima occorrenza) ──────────────────────────
  for (let i = 0; i < tokens.length; i++) {
    const lc = tokens[i].toLowerCase().replace(/[.,;:!?]+$/, "");
    if (UNIT_MAP[lc]) {
      unit = UNIT_MAP[lc];
      unitTokenIndex = i;
      tokens.splice(i, 1);
      i--;
      break; // solo la prima
    }
  }

  // ── 2) Estrai formato (33cl, 30lt, 0.5lt, 25kg, 200g) ─────────────────────
  for (let i = 0; i < tokens.length; i++) {
    // Forma "33cl" tutta attaccata
    const m1 = tokens[i].match(SIZE_RE);
    if (m1) {
      unitSize = normalizeSize(m1[1], m1[2]);
      tokens.splice(i, 1);
      i--;
      continue;
    }
    // Forma "33 cl" separata
    if (i + 1 < tokens.length && /^\d+(?:[.,]\d+)?$/.test(tokens[i]) && /^(cl|ml|lt|l|kg|g)$/i.test(tokens[i + 1])) {
      unitSize = normalizeSize(tokens[i], tokens[i + 1]);
      tokens.splice(i, 2);
      i--;
      continue;
    }
    // Forma inline ma con altro testo prima (es. "33clx24" — raro)
    const mInline = tokens[i].match(SIZE_INLINE_RE);
    if (mInline && !unitSize) {
      unitSize = normalizeSize(mInline[1], mInline[2]);
      tokens[i] = tokens[i].replace(mInline[0], "").trim();
      if (!tokens[i]) { tokens.splice(i, 1); i--; }
      continue;
    }
  }

  // ── 3) Estrai pack size ────────────────────────────────────────────────────
  for (let i = 0; i < tokens.length; i++) {
    const m = tokens[i].match(PACK_RE);
    if (m) {
      const n = parseInt(m[1] || m[2], 10);
      if (n >= 2 && n <= 999) {
        packSize = n;
        tokens.splice(i, 1);
        i--;
        continue;
      }
    }
    // Numero intero standalone DOPO l'unità (es. "cassa 24")
    if (/^\d{1,3}$/.test(tokens[i]) && unit && unit !== "pz" && packSize === 1) {
      const n = parseInt(tokens[i], 10);
      if (n >= 2 && n <= 999) {
        packSize = n;
        tokens.splice(i, 1);
        i--;
        continue;
      }
    }
  }

  // ── 4) Numero solo (decimale) → probabilmente formato in lt se nessun size ─
  if (!unitSize) {
    for (let i = 0; i < tokens.length; i++) {
      const t = tokens[i].replace(",", ".");
      if (/^\d+\.\d+$/.test(t)) {
        // es. "0.66" senza unità → assumiamo lt (formato bevande)
        const n = parseFloat(t);
        if (n > 0 && n < 100) {
          unitSize = `${t}lt`;
          tokens.splice(i, 1);
          break;
        }
      }
    }
  }

  // ── 5) Default unità ────────────────────────────────────────────────────────
  if (!unit) unit = "pz";

  // ── 6) Ricostruisci nome ───────────────────────────────────────────────────
  const name = capitalize(tokens.join(" ").replace(/\s+/g, " ").trim());

  return { name: name || raw, brand: "", unit, unitSize, packSize };
}

function normalizeSize(num: string, unit: string): string {
  return `${num.replace(",", ".")}${unit.toLowerCase()}`;
}

function capitalize(s: string): string {
  if (!s) return s;
  // Capitalizza la prima lettera di ogni parola "significativa", lascia gli altri
  return s.split(" ").map(w => {
    if (w.length === 0) return w;
    // Mantieni come è se ha già maiuscole o numeri
    if (/[A-Z0-9]/.test(w)) return w;
    return w[0].toUpperCase() + w.slice(1);
  }).join(" ");
}

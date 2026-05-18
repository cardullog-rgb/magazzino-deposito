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
  initialStock: number;  // quantità iniziale dedotta dal testo (es. "30 forchette" → 30)
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
  if (!raw) return { name: "", brand: "", unit: "pz", unitSize: "", packSize: 1, initialStock: 0 };

  // Tokenizza preservando capitalizzazione
  let tokens = raw.split(/\s+/);

  let unit = "";
  let unitSize = "";
  let packSize = 1;
  let initialStock = 0;
  let unitExplicit = false;

  // ── 0) Numero iniziale standalone = quantità iniziale ────────────────────
  // Es. "30 forchette" → initialStock=30, name="Forchette".
  // Solo se è davvero in posizione 0 ed è un intero ragionevole.
  if (tokens.length > 1 && /^\d{1,4}$/.test(tokens[0])) {
    const n = parseInt(tokens[0], 10);
    if (n >= 1 && n <= 9999) {
      initialStock = n;
      tokens.shift();
    }
  }

  // ── 1) Estrai unità di misura ──────────────────────────────────────────────
  // Rimuove TUTTE le occorrenze (es. "casse … cassa 24" non lascia "cassa" nel nome).
  // Caso speciale: lt/kg/cl/ml/g dopo un numero è FORMATO, non unità di
  // confezionamento. Es. "Olio EVO 5 lt" → unitSize="5lt", unit non settata.
  for (let i = 0; i < tokens.length; i++) {
    const lc = tokens[i].toLowerCase().replace(/[.,;:!?]+$/, "");
    if (!UNIT_MAP[lc]) continue;

    const isMeasure = /^(lt|l|kg|g|cl|ml)$/i.test(lc);
    if (isMeasure && i > 0 && /^\d+(?:[.,]\d+)?$/.test(tokens[i - 1])) {
      // "5 lt" → formato 5lt
      if (!unitSize) unitSize = normalizeSize(tokens[i - 1], lc);
      tokens.splice(i - 1, 2);
      i -= 2;
      continue;
    }
    if (!unitExplicit) {
      unit = UNIT_MAP[lc];
      unitExplicit = true;
    }
    tokens.splice(i, 1);
    i--;
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
    if (/^\d{1,4}$/.test(tokens[i]) && unitExplicit && packSize === 1) {
      const n = parseInt(tokens[i], 10);
      if (n >= 2 && n <= 999) {
        packSize = n;
        tokens.splice(i, 1);
        i--;
        continue;
      }
    }
  }

  // ── 3b) Fallback: numero intero standalone se nessuna unità esplicita →
  //        è la quantità iniziale (es. "Pasta 24" → 24 pezzi di pasta).
  if (!unitExplicit && initialStock === 0) {
    for (let i = 0; i < tokens.length; i++) {
      if (/^\d{1,4}$/.test(tokens[i])) {
        const n = parseInt(tokens[i], 10);
        if (n >= 1 && n <= 9999) {
          initialStock = n;
          tokens.splice(i, 1);
          break;
        }
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

  return { name: name || raw, brand: "", unit, unitSize, packSize, initialStock };
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

// ─── Inferenza categoria dal testo libero ───────────────────────────────────
// Quando l'utente scrive "fusto birra Messina 30lt" e la categoria "Birre"
// NON esiste ancora, deduciamo qui un template ragionevole e la creiamo al
// volo lato server. Fallback: "Altro" (sezione bevande).
export interface CategoryTemplate {
  name: string;
  icon: string;
  color: string;
  macroCategory: string;
  section: string;       // "bevande" | "cucina"
  sortOrder: number;
}

const CATEGORY_TEMPLATES: Array<{ keywords: string[]; tpl: CategoryTemplate }> = [
  // Termini molto specifici PRIMA dei più generici (per non far matchare "lievito di birra" a Birre)
  { keywords: ["farina","semola","lievito","impasto","manitoba"],
    tpl: { name: "Farine", icon: "🌾", color: "#d97706", macroCategory: "cucina", section: "cucina", sortOrder: 20 } },

  { keywords: ["acqua","ferrarelle","panna","sanpellegrino","levissima","uliveto","lete"],
    tpl: { name: "Acqua", icon: "💧", color: "#3b82f6", macroCategory: "acqua", section: "bevande", sortOrder: 1 } },

  { keywords: ["birra","fusto","heineken","moretti","peroni","corona","ichnusa","ceres","tuborg","forst","menabrea","becks","carlsberg","budweiser","leffe","duvel","chimay","messina","affligem","blanche","erdinger","fischer","bombola","co2"],
    tpl: { name: "Birre", icon: "🍺", color: "#eab308", macroCategory: "birre", section: "bevande", sortOrder: 2 } },

  { keywords: ["cola","coca","fanta","sprite","schweppes","gazzosa","chinotto","aranciata","limonata","ginger","tonica","redbull","red bull","pepsi"],
    tpl: { name: "Bibite", icon: "🥤", color: "#22c55e", macroCategory: "analcolici", section: "bevande", sortOrder: 3 } },

  { keywords: ["succo","ace"],
    tpl: { name: "Succhi", icon: "🧃", color: "#f97316", macroCategory: "analcolici", section: "bevande", sortOrder: 4 } },

  { keywords: ["amaro","fernet","montenegro","averna","ramazzotti","branca","jagermeister","jägermeister","baileys","limoncello","sambuca","grappa","unicum","disaronno","amaretto"],
    tpl: { name: "Amari", icon: "🥃", color: "#92400e", macroCategory: "alcolici", section: "bevande", sortOrder: 5 } },

  { keywords: ["whisky","whiskey","jack daniel","jameson","ballantine","cognac","rum","zacapa","havana","bourbon","bushmills","jefferson"],
    tpl: { name: "Spirits", icon: "🍸", color: "#7c3aed", macroCategory: "alcolici", section: "bevande", sortOrder: 6 } },

  { keywords: ["gin","bombay","tanqueray","hendrick","gordon","mare","portofino","etsu"],
    tpl: { name: "Gin", icon: "🫙", color: "#0891b2", macroCategory: "alcolici", section: "bevande", sortOrder: 7 } },

  { keywords: ["vodka","absolut","belvedere","grey goose","skyy","beluga","smirnoff"],
    tpl: { name: "Vodka", icon: "🧊", color: "#6366f1", macroCategory: "alcolici", section: "bevande", sortOrder: 8 } },

  { keywords: ["tequila","mezcal","jose cuervo","patron","sierra","olmeca","don julio"],
    tpl: { name: "Tequila & Rum", icon: "🌊", color: "#059669", macroCategory: "alcolici", section: "bevande", sortOrder: 9 } },

  { keywords: ["aperol","campari","martini","cinzano","lillet","vermouth","spritz"],
    tpl: { name: "Aperitivi", icon: "🍊", color: "#ea580c", macroCategory: "alcolici", section: "bevande", sortOrder: 10 } },

  { keywords: ["vino bianco","bianco","chardonnay","sauvignon","grillo","catarratto","prosecco"],
    tpl: { name: "Vini Bianchi", icon: "🥂", color: "#fde047", macroCategory: "vini", section: "bevande", sortOrder: 11 } },

  { keywords: ["vino rosso","rosso","cabernet","merlot","nero d'avola","etna rosso","frappato","syrah","nerello"],
    tpl: { name: "Vini Rossi", icon: "🍷", color: "#991b1b", macroCategory: "vini", section: "bevande", sortOrder: 12 } },

  { keywords: ["vino","passito","zibibbo","moscato","marsala"],
    tpl: { name: "Vini", icon: "🍷", color: "#991b1b", macroCategory: "vini", section: "bevande", sortOrder: 13 } },

  { keywords: ["pomodoro","pelati","passata","ciliegino","datterino","pachino","conserva"],
    tpl: { name: "Pomodoro", icon: "🍅", color: "#ef4444", macroCategory: "cucina", section: "cucina", sortOrder: 21 } },

  { keywords: ["mozzarella","ricotta","formaggio","parmigiano","gorgonzola","fontina","burrata","stracchino","grana","pecorino","provola","scamorza","caciocavallo","fior di latte"],
    tpl: { name: "Latticini", icon: "🧀", color: "#fbbf24", macroCategory: "cucina", section: "cucina", sortOrder: 22 } },

  { keywords: ["prosciutto","salame","mortadella","speck","bresaola","coppa","'nduja","nduja","pancetta","guanciale","lardo","salume"],
    tpl: { name: "Salumi", icon: "🥩", color: "#b45309", macroCategory: "cucina", section: "cucina", sortOrder: 23 } },

  { keywords: ["basilico","insalata","rucola","spinaci","carciofi","carote","melanzane","zucchine","cipolla","verdura","peperone","funghi"],
    tpl: { name: "Verdure", icon: "🥦", color: "#16a34a", macroCategory: "cucina", section: "cucina", sortOrder: 24 } },

  { keywords: ["olio","aceto","origano","sale","spezie","peperoncino"],
    tpl: { name: "Oli & Condimenti", icon: "🫙", color: "#ca8a04", macroCategory: "cucina", section: "cucina", sortOrder: 25 } },

  { keywords: ["tonno","acciughe","capperi","gamberi","calamari","polpo","cozze","vongole","sgombro","pesce"],
    tpl: { name: "Pesce", icon: "🐟", color: "#0ea5e9", macroCategory: "cucina", section: "cucina", sortOrder: 26 } },

  { keywords: ["pasta","caffè","caffe","zucchero","riso","biscotti","cracker"],
    tpl: { name: "Dispensa", icon: "🥫", color: "#78716c", macroCategory: "cucina", section: "cucina", sortOrder: 27 } },

  { keywords: ["forchetta","forchette","coltello","coltelli","cucchiaio","cucchiai","posata","posate","tovagliolo","tovaglioli","tovaglia","tovaglie","bicchiere","bicchieri","piatto","piatti","calice","calici","cannuccia","cannucce","stuzzicadenti","sottobicchier"],
    tpl: { name: "Sala & Materiali", icon: "🍴", color: "#a3a3a3", macroCategory: "sala", section: "cucina", sortOrder: 30 } },

  { keywords: ["carta","scottex","scontrino","sacchetto","busta","detergente","detersivo","sgrassatore","spugna","panno","guanti","sapone"],
    tpl: { name: "Pulizia & Carta", icon: "🧴", color: "#94a3b8", macroCategory: "sala", section: "cucina", sortOrder: 31 } },
];

/**
 * Inferisce un template di categoria a partire dal testo libero del prodotto.
 * Restituisce sempre qualcosa: il fallback è "Altro" se nulla matcha.
 */
export function inferCategoryTemplate(text: string): CategoryTemplate {
  const lc = text.toLowerCase();
  for (const { keywords, tpl } of CATEGORY_TEMPLATES) {
    for (const kw of keywords) {
      if (wordIncludes(lc, kw)) return tpl;
    }
  }
  return {
    name: "Altro",
    icon: "📦",
    color: "#94a3b8",
    macroCategory: "altro",
    section: "cucina",
    sortOrder: 99,
  };
}

// Word boundary match: evita che "ciliegino" matchi "gin".
function wordIncludes(text: string, kw: string): boolean {
  const escaped = kw.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");
  return new RegExp(`(?:^|\\W)${escaped}(?:\\W|$)`, "i").test(text);
}

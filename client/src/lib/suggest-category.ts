import type { Category, Product } from "@shared/schema";

/**
 * Suggerisce la categoria più probabile per un prodotto a partire dal suo nome
 * (e marca). Strategia, in ordine:
 *
 * 1. **Prodotti simili**: se esiste già un prodotto con lo stesso brand o con
 *    una parola in comune nel nome, prendi la sua categoria. Funziona molto
 *    bene man mano che il catalogo si popola.
 *
 * 2. **Radice del nome categoria**: confronta le parole del nome prodotto con
 *    le radici (primi 4 caratteri) delle parole del nome categoria.
 *    Es. "Birra Moretti" → "Birre" / "Birra & Fusti".
 *
 * 3. **Sinonimi noti**: pochi mapping comuni per coprire i casi in cui il
 *    nome del prodotto non contiene letteralmente la categoria
 *    (es. "Prosciutto" → categoria "Salumi & Affettati").
 *
 * Restituisce l'id della categoria suggerita, o null se non c'è abbastanza
 * informazione per decidere.
 */
export function suggestCategoryId(
  name: string,
  brand: string,
  products: Product[],
  categories: Category[],
): number | null {
  const text = `${name} ${brand}`.toLowerCase().trim();
  if (text.length < 2 || categories.length === 0) return null;

  const tokens = tokenize(text);
  if (tokens.length === 0) return null;

  // ── 1. Prodotti simili (brand match, poi token match) ──────────────────────
  const brandLc = brand.trim().toLowerCase();
  if (brandLc.length >= 2) {
    const sameBrand = products.find(p => p.active && p.brand.toLowerCase() === brandLc);
    if (sameBrand) return sameBrand.categoryId;
  }
  // Token in comune sui prodotti esistenti
  let bestProd: { p: Product; score: number } | null = null;
  for (const p of products) {
    if (!p.active) continue;
    const pTokens = tokenize(`${p.name} ${p.brand}`.toLowerCase());
    let score = 0;
    for (const t of tokens) if (pTokens.includes(t)) score++;
    if (score > 0 && (!bestProd || score > bestProd.score)) {
      bestProd = { p, score };
    }
  }
  if (bestProd && bestProd.score >= 1) return bestProd.p.categoryId;

  // ── 2. Radice del nome categoria ───────────────────────────────────────────
  // Categorie più specifiche prima (nomi più lunghi) per evitare match troppo larghi.
  const sortedCats = [...categories].sort((a, b) => b.name.length - a.name.length);
  for (const c of sortedCats) {
    const catTokens = tokenize(c.name.toLowerCase());
    for (const ct of catTokens) {
      const stem = ct.slice(0, Math.min(4, ct.length));
      if (stem.length < 3) continue;
      for (const t of tokens) {
        if (t.startsWith(stem) || stem.startsWith(t.slice(0, 4))) {
          return c.id;
        }
      }
    }
  }

  // ── 3. Sinonimi noti ───────────────────────────────────────────────────────
  // Mappa parola chiave → "keyword di categoria" da cercare poi nel nome cat.
  const SYNONYMS: Record<string, string[]> = {
    birr:    ["moretti","heineken","peroni","corona","ichnusa","ceres","tuborg","forst","menabrea","becks","carlsberg","budweiser","leffe","duvel","chimay"],
    vin:     ["chardonnay","sauvignon","cabernet","merlot","prosecco","etna","passito","zibibbo","grillo","frappato","nerello","catarratto"],
    salu:    ["prosciutto","salame","mortadella","speck","bresaola","coppa","'nduja","nduja","pancetta","guanciale","lardo"],
    formag:  ["mozzarella","ricotta","parmigiano","gorgonzola","fontina","burrata","stracchino","grana","pecorino","provola","scamorza","caciocavallo"],
    pomod:   ["pelati","passata","ciliegino","datterino","pachino","san marzano","conserva"],
    farin:   ["farina","semola","lievito","sale","impasto"],
    verdur:  ["basilico","melanzane","zucchine","cipolla","pomodorino","insalata","rucola","spinaci","carciofi","carote"],
    olio:    ["olio","evo","origano","peperoncino","aceto","sale grosso"],
    pesc:    ["acciughe","capperi","tonno","gamberi","gambero","calamari","polpo","cozze","vongole","sgombro"],
    acqu:    ["ferrarelle","panna","sanpellegrino","levissima","uliveto","lete"],
    soft:    ["coca","cola","fanta","sprite","schweppes","gazzosa","chinotto","aranciata","limonata","red bull","redbull"],
    succh:   ["succo","ace","arancia","pesca","ananas","pera","mela"],
    amar:    ["amaro","fernet","montenegro","averna","ramazzotti","branca","jagermeister","jägermeister","baileys","limoncello","sambuca","grappa"],
    spirit:  ["whisky","whiskey","jack daniel","jameson","ballantine","cognac","rum","zacapa","havana","bourbon"],
    gin:     ["bombay","tanqueray","hendrick","gordon","mare","portofino","etsu","monkey 47"],
    vodk:    ["absolut","belvedere","grey goose","skyy","beluga","smirnoff"],
    tequil:  ["jose cuervo","patron","sierra","olmeca","don julio"],
    aperit:  ["aperol","campari","martini","cinzano","lillet","vermouth"],
    sala:    ["forchetta","forchette","coltello","coltelli","cucchiaio","cucchiai","posata","posate","tovagliolo","tovaglioli","tovaglia","tovaglie","bicchiere","bicchieri","piatto","piatti","calice","calici","cannuccia","cannucce"],
    puliz:   ["detergente","detersivo","sgrassatore","spugna","panno","guanti","sapone","scottex"],
  };

  for (const [catStem, keywords] of Object.entries(SYNONYMS)) {
    if (keywords.some(kw => wordBoundaryIncludes(text, kw))) {
      // Cerca una categoria che abbia una parola che inizia con `catStem`
      const cat = categories.find(c =>
        c.name.toLowerCase().split(/[\s&\-,]+/).some(w => w.startsWith(catStem))
      );
      if (cat) return cat.id;
    }
  }

  return null;
}

function tokenize(s: string): string[] {
  return s
    .normalize("NFD").replace(/[̀-ͯ]/g, "")  // toglie accenti
    .split(/[^a-z0-9]+/i)
    .filter(t => t.length >= 3);
}

// `text` contiene `kw` come PAROLA intera (non come sottostringa). Evita falsi
// positivi tipo "ciliegino" che matcha "gin".
function wordBoundaryIncludes(text: string, kw: string): boolean {
  const escaped = kw.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");
  return new RegExp(`(?:^|\\W)${escaped}(?:\\W|$)`, "i").test(text);
}

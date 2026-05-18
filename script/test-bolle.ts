// Test del parser quick-add su scenari di scansione bolle DDT tipici di una
// pizzeria/ristorante. Per ogni riga simula cosa il sistema riconoscerebbe:
// nome / unità / formato / pack / quantità iniziale / categoria suggerita
// o categoria creata al volo.

import { parseProduct, inferCategoryTemplate } from "../client/src/lib/parse-product";
import { suggestCategoryId } from "../client/src/lib/suggest-category";
import type { Category, Product } from "../shared/schema";

const bolle: Record<string, string[]> = {
  "BOLLA BEVANDE (es. Distribuzione bevande)": [
    "5 fusti Heineken 30lt",
    "3 fusti Affligem 20lt",
    "2 fusti Messina 30lt",
    "2 bombola CO2 10kg",
    "10 casse Heineken 33cl x24",
    "5 casse Corona 33cl 24",
    "8 casse Coca Cola 33cl cassa 24",
    "5 casse Coca Zero 33cl cassa 24",
    "3 casse Coca Cola 1lt 12",
    "4 casse Acqua Naturale 0.5lt 24",
    "4 casse Acqua Frizzante 0.5lt 24",
    "2 casse Schweppes Tonica 18cl 24",
    "3 casse Chinotto 24",
  ],
  "BOLLA ALCOLICI (es. Banqueting Sicilia)": [
    "2 bottiglie Gin Bombay Sapphire 70cl",
    "1 bottiglia Aperol 1lt",
    "2 bottiglie Campari 1lt",
    "1 bottiglia Vodka Absolut 70cl",
    "1 bottiglia Tequila Jose Cuervo 70cl",
    "2 bottiglie Whisky Jameson 70cl",
    "3 bottiglie Amaro Montenegro 70cl",
    "2 bottiglie Limoncello 50cl",
    "1 Jagermeister 70cl",
    "1 Martini Bianco 1lt",
  ],
  "BOLLA VINI (cantina locale)": [
    "6 Vino Bianco Etna Tornatore 0.75",
    "6 Vino Rosso Nero d'Avola 0.75",
    "4 Prosecco Carpenè Malvolti 0.75",
    "3 Passito Pantelleria 0.5",
  ],
  "BOLLA CUCINA (es. grossista alimentari)": [
    "4 sacchi Farina 00 Caputo 25kg",
    "2 sacchi Semola Rimacinata 25kg",
    "8 lievito di birra fresco 500g",
    "12 cartoni Pomodoro San Marzano DOP 6",
    "5 kg Pomodorino Ciliegino",
    "30 Mozzarella Fior di Latte 200g",
    "15 Mozzarella Bufala DOP 200g",
    "3 kg Ricotta Fresca",
    "10 Salame Piccante Calabrese 200g",
    "3 kg Prosciutto Cotto",
    "2 kg Mortadella IGP",
    "8 'Nduja Calabrese 200g",
    "5 mazzo Basilico Fresco",
    "6 kg Melanzane",
    "5 lt Olio EVO 5lt",
    "10 conf Pasta Secca De Cecco 1kg",
    "3 kg Caffè in Grani Mokarico",
  ],
  "BOLLA SALA / MATERIALI": [
    "30 forchette",
    "30 coltelli",
    "24 cucchiai",
    "100 tovaglioli carta",
    "12 tovaglie",
    "48 bicchieri",
    "24 calici vino",
    "200 stuzzicadenti",
    "5 rotoli scottex",
  ],
  "INPUT DISORDINATI / CASI LIMITE": [
    "30 Forchette",                     // come tipica scansione bolla
    "Birra Moretti",                    // senza tutto, solo nome
    "Heineken cassa 24",                // pack senza size
    "0.5lt acqua naturale",             // formato all'inizio
    "Aperol 1L",                        // L maiuscolo
    "12 BOTTIGLIE COCA COLA",           // tutto maiuscolo
    "Pomodoro Pelati 6x400g",           // pack inline
    "200 stuzzicadenti",                // numero alto
    "Olio EVO 5 lt",                    // numero + unità separati
  ],
};

// Categorie iniziali fittizie (simuliamo un DB con qualche categoria pre-esistente
// per testare anche il match suggestCategoryId)
const categoriesPre: Category[] = [
  { id: 1, name: "Birre",       section: "bevande", macroCategory: "birre",      icon: "🍺", color: "#000", sortOrder: 2 },
  { id: 2, name: "Vini Bianchi",section: "bevande", macroCategory: "vini",       icon: "🥂", color: "#000", sortOrder: 11 },
  { id: 3, name: "Vini Rossi",  section: "bevande", macroCategory: "vini",       icon: "🍷", color: "#000", sortOrder: 12 },
];
const products: Product[] = [];

let totalOk = 0;
let totalWarn = 0;
let totalRows = 0;

const PALE = "\x1b[2m"; const RESET = "\x1b[0m";
const GREEN = "\x1b[32m"; const YELLOW = "\x1b[33m"; const CYAN = "\x1b[36m";

for (const [titolo, righe] of Object.entries(bolle)) {
  console.log(`\n${CYAN}━━━ ${titolo} ━━━${RESET}`);
  for (const riga of righe) {
    totalRows++;
    const p = parseProduct(riga);
    const matchedId = suggestCategoryId(p.name, p.brand, products, categoriesPre);
    const matched = categoriesPre.find(c => c.id === matchedId);
    const tpl = matched ? null : inferCategoryTemplate(`${p.name} ${p.brand}`);
    const catLabel = matched
      ? `${matched.icon} ${matched.name}`
      : tpl ? `${tpl.icon} ${tpl.name}${tpl.name === "Altro" ? `${YELLOW} (fallback!)${RESET}` : `${PALE} (nuova)${RESET}`}` : "—";

    // Verifica risultato di qualità
    const issues: string[] = [];
    if (!p.name) issues.push("nome vuoto");
    if (tpl && tpl.name === "Altro") issues.push("→ Altro");
    // Quantità persa: solo se inizia con un INTERO standalone (non decimale tipo "0.5lt")
    if (p.initialStock === 0 && /^\d+\s/.test(riga) && !/^\d+(?:[.,]\d+)?(?:cl|ml|lt|l|kg|g)/i.test(riga)) {
      issues.push("quantità iniziale persa?");
    }

    const tag = issues.length === 0 ? `${GREEN}✓${RESET}` : `${YELLOW}⚠${RESET}`;
    if (issues.length === 0) totalOk++; else totalWarn++;

    console.log(`  ${tag} "${riga}"`);
    console.log(`    ${PALE}name=${RESET}${p.name}  ${PALE}unit=${RESET}${p.unit}  ${PALE}size=${RESET}${p.unitSize || "—"}  ${PALE}pack=${RESET}${p.packSize}  ${PALE}qty=${RESET}${p.initialStock}`);
    console.log(`    ${PALE}categoria→${RESET} ${catLabel}${issues.length > 0 ? `  ${YELLOW}[${issues.join(", ")}]${RESET}` : ""}`);
  }
}

console.log(`\n${CYAN}━━━ RIEPILOGO ━━━${RESET}`);
console.log(`  ${GREEN}✓ ${totalOk} righe ok${RESET}`);
console.log(`  ${YELLOW}⚠ ${totalWarn} righe con dubbi${RESET}`);
console.log(`  Totale: ${totalRows}\n`);

// Popola il DB con l'inventario reale del cliente (4 fogli forniti).
// Idempotente: se una categoria/prodotto esiste già con lo stesso nome, skip.
//
// Uso:
//   1. ferma il dev server (lock SQLite)
//   2. `npx tsx script/seed-inventario.ts`
//   3. ri-avvia il server

import Database from "better-sqlite3";

const DB_PATH = process.env.DB_PATH || "data.db";
const db = new Database(DB_PATH);

// ─── Categorie (idempotente) ─────────────────────────────────────────────────
type CatDef = {
  name: string; section: "bevande" | "cucina"; macroCategory: string;
  icon: string; color: string; sortOrder: number;
};

const CATEGORIES: CatDef[] = [
  { name: "Acqua",                  section: "bevande", macroCategory: "acqua",      icon: "💧", color: "#3b82f6", sortOrder: 1 },
  { name: "Birra & Fusti",          section: "bevande", macroCategory: "birre",      icon: "🍺", color: "#eab308", sortOrder: 2 },
  { name: "Bibite & Soft Drink",    section: "bevande", macroCategory: "analcolici", icon: "🥤", color: "#22c55e", sortOrder: 3 },
  { name: "Succhi",                 section: "bevande", macroCategory: "analcolici", icon: "🧃", color: "#f97316", sortOrder: 4 },
  { name: "Amari & Digestivi",      section: "bevande", macroCategory: "alcolici",   icon: "🥃", color: "#92400e", sortOrder: 5 },
  { name: "Spirits & Liquori",      section: "bevande", macroCategory: "alcolici",   icon: "🍸", color: "#7c3aed", sortOrder: 6 },
  { name: "Gin",                    section: "bevande", macroCategory: "alcolici",   icon: "🫙", color: "#0891b2", sortOrder: 7 },
  { name: "Vodka",                  section: "bevande", macroCategory: "alcolici",   icon: "🧊", color: "#6366f1", sortOrder: 8 },
  { name: "Tequila & Rum",          section: "bevande", macroCategory: "alcolici",   icon: "🌊", color: "#059669", sortOrder: 9 },
  { name: "Aperitivi & Vermouth",   section: "bevande", macroCategory: "alcolici",   icon: "🍊", color: "#ea580c", sortOrder: 10 },
  { name: "Vini Bianchi",           section: "bevande", macroCategory: "vini",       icon: "🥂", color: "#fde047", sortOrder: 11 },
  { name: "Vini Rossi",             section: "bevande", macroCategory: "vini",       icon: "🍷", color: "#991b1b", sortOrder: 12 },
  { name: "Vini Dolci & Passiti",   section: "bevande", macroCategory: "vini",       icon: "🍯", color: "#f59e0b", sortOrder: 13 },
];

// ─── Prodotti (dai 4 fogli del cliente) ──────────────────────────────────────
// Convenzioni: stock iniziale 0 (sarà popolato col primo carico). minStock e
// idealStock sono valori di default ragionevoli. Per i fusti e le bombole
// packSize=1 (sono singoli). Per le casse di bevande in cassa packSize=24
// (eccetto Coca 1lt da 12 e acqua da 12).
type ProdDef = {
  category: string;
  name: string;
  brand?: string;
  unit?: string;
  unitSize?: string;
  packSize?: number;
  minStock?: number;
  idealStock?: number;
};

const PRODUCTS: ProdDef[] = [
  // ACQUA (3)
  { category: "Acqua", name: "Acqua Naturale",          unit: "cassa", unitSize: "24×0.5lt", packSize: 12 },
  { category: "Acqua", name: "Acqua Frizzante",         unit: "cassa", unitSize: "24×0.5lt", packSize: 12 },
  { category: "Acqua", name: "Acqua Ferrarelle",        brand: "Ferrarelle", unit: "cassa", unitSize: "24×0.5lt", packSize: 12 },

  // BIRRA & FUSTI (10)
  { category: "Birra & Fusti", name: "Fusti Heineken",  brand: "Heineken",         unit: "fusto", unitSize: "30lt" },
  { category: "Birra & Fusti", name: "Fusti Affligem",  brand: "Affligem",         unit: "fusto", unitSize: "20lt" },
  { category: "Birra & Fusti", name: "Fusti Messina",   brand: "Messina",          unit: "fusto", unitSize: "30lt" },
  { category: "Birra & Fusti", name: "Bombola CO2",                                unit: "pz",    unitSize: "10kg" },
  { category: "Birra & Fusti", name: "Heineken 0.0",    brand: "Heineken",         unit: "cassa", unitSize: "33cl",  packSize: 24 },
  { category: "Birra & Fusti", name: "Heineken",        brand: "Heineken",         unit: "cassa", unitSize: "33cl",  packSize: 24 },
  { category: "Birra & Fusti", name: "Corona",          brand: "Corona",           unit: "cassa", unitSize: "33cl",  packSize: 24 },
  { category: "Birra & Fusti", name: "Erdinger",        brand: "Erdinger",         unit: "cassa", unitSize: "33cl",  packSize: 24 },
  { category: "Birra & Fusti", name: "Fischer",         brand: "Fischer",          unit: "cassa", unitSize: "33cl",  packSize: 24 },
  { category: "Birra & Fusti", name: "Blanche De Namur", brand: "Blanche De Namur", unit: "cassa", unitSize: "33cl", packSize: 24 },

  // BIBITE & SOFT DRINK (10)
  { category: "Bibite & Soft Drink", name: "Coca Zero 33cl",    brand: "Coca-Cola", unit: "cassa", unitSize: "33cl latt.", packSize: 24 },
  { category: "Bibite & Soft Drink", name: "Coca Cola 33cl",    brand: "Coca-Cola", unit: "cassa", unitSize: "33cl latt.", packSize: 24 },
  { category: "Bibite & Soft Drink", name: "Coca Cola 1lt",     brand: "Coca-Cola", unit: "cassa", unitSize: "1lt",        packSize: 12 },
  { category: "Bibite & Soft Drink", name: "Chinotto",          unit: "cassa", unitSize: "27.5cl", packSize: 24 },
  { category: "Bibite & Soft Drink", name: "Gazzosa",           unit: "cassa", unitSize: "27.5cl", packSize: 24 },
  { category: "Bibite & Soft Drink", name: "Limonata",          unit: "cassa", unitSize: "27.5cl", packSize: 24 },
  { category: "Bibite & Soft Drink", name: "Aranciata Bio",     unit: "cassa", unitSize: "27.5cl", packSize: 24 },
  { category: "Bibite & Soft Drink", name: "Acqua Tonica",      brand: "Schweppes", unit: "cassa", unitSize: "18cl", packSize: 24 },
  { category: "Bibite & Soft Drink", name: "Schweppes Lemon",   brand: "Schweppes", unit: "cassa", unitSize: "18cl", packSize: 24 },
  { category: "Bibite & Soft Drink", name: "Ginger Beer",       unit: "cassa", unitSize: "20cl", packSize: 24 },

  // SUCCHI (3)
  { category: "Succhi", name: "Succo Ananas",  unit: "cassa", unitSize: "200ml", packSize: 12 },
  { category: "Succhi", name: "Succo Arancia", unit: "cassa", unitSize: "200ml", packSize: 12 },
  { category: "Succhi", name: "Succo Pesca",   unit: "cassa", unitSize: "200ml", packSize: 12 },

  // AMARI & DIGESTIVI (12 + lim + baileys + grand marnier + drambuie + cointreau + sambuca = vedi)
  // Dal foglio 2: tutto tra "Amaro Amara" e prima di "Jefferson" (esclusi liquori puri come Jefferson)
  { category: "Amari & Digestivi", name: "Amaro Amara",         brand: "Amara",       unit: "bt", unitSize: "0.7lt" },
  { category: "Amari & Digestivi", name: "Amaretto Disaronno",  brand: "Disaronno",   unit: "bt", unitSize: "0.7lt" },
  { category: "Amari & Digestivi", name: "Amaro Unnimaffissu",                        unit: "bt", unitSize: "0.7lt" },
  { category: "Amari & Digestivi", name: "Amaro Montenegro",    brand: "Montenegro",  unit: "bt", unitSize: "0.7lt" },
  { category: "Amari & Digestivi", name: "Amaro Averna",        brand: "Averna",      unit: "bt", unitSize: "0.7lt" },
  { category: "Amari & Digestivi", name: "Amaro Del Capo",      brand: "Del Capo",    unit: "bt", unitSize: "0.7lt" },
  { category: "Amari & Digestivi", name: "Amaro Del Capo Piccante", brand: "Del Capo", unit: "bt", unitSize: "0.7lt" },
  { category: "Amari & Digestivi", name: "Amaro Dell'Etna",                           unit: "bt", unitSize: "0.7lt" },
  { category: "Amari & Digestivi", name: "Amaro Unicum",        brand: "Unicum",      unit: "bt", unitSize: "0.7lt" },
  { category: "Amari & Digestivi", name: "Branca Menta",        brand: "Branca",      unit: "bt", unitSize: "0.7lt" },
  { category: "Amari & Digestivi", name: "Fernet Branca",       brand: "Branca",      unit: "bt", unitSize: "0.7lt" },
  { category: "Amari & Digestivi", name: "Jagermeister",        brand: "Jägermeister", unit: "bt", unitSize: "0.7lt" },
  { category: "Amari & Digestivi", name: "Limoncello",                                unit: "bt", unitSize: "0.7lt" },
  { category: "Amari & Digestivi", name: "Baileys",             brand: "Baileys",     unit: "bt", unitSize: "0.7lt" },
  { category: "Amari & Digestivi", name: "Grand Marnier",       brand: "Grand Marnier", unit: "bt", unitSize: "0.7lt" },
  { category: "Amari & Digestivi", name: "Drambuie",            brand: "Drambuie",    unit: "bt", unitSize: "0.7lt" },
  { category: "Amari & Digestivi", name: "Sambuca",                                   unit: "bt", unitSize: "0.7lt" },
  { category: "Amari & Digestivi", name: "Cointreau",           brand: "Cointreau",   unit: "bt", unitSize: "0.7lt" },
  { category: "Amari & Digestivi", name: "Triple Sec",                                unit: "bt", unitSize: "0.7lt" },
  { category: "Amari & Digestivi", name: "Kahlua",              brand: "Kahlúa",      unit: "bt", unitSize: "0.7lt" },
  { category: "Amari & Digestivi", name: "Curacao Blu",                               unit: "bt", unitSize: "0.7lt" },
  { category: "Amari & Digestivi", name: "Peachtree",           brand: "Peachtree",   unit: "bt", unitSize: "0.7lt" },
  { category: "Amari & Digestivi", name: "St Germain",          brand: "St Germain",  unit: "bt", unitSize: "0.7lt" },
  { category: "Amari & Digestivi", name: "Midori",              brand: "Midori",      unit: "bt", unitSize: "0.7lt" },
  { category: "Amari & Digestivi", name: "Malibu",              brand: "Malibu",      unit: "bt", unitSize: "0.7lt" },
  { category: "Amari & Digestivi", name: "Passoa Passion Fruit", brand: "Passoa",     unit: "bt", unitSize: "0.7lt" },
  { category: "Amari & Digestivi", name: "Batida De Coco",      brand: "Batida",      unit: "bt", unitSize: "0.7lt" },

  // SPIRITS & LIQUORI (whisky, cognac, rum, grappe)
  { category: "Spirits & Liquori", name: "Jefferson",            brand: "Jefferson",        unit: "bt", unitSize: "0.7lt" },
  { category: "Spirits & Liquori", name: "Jack Daniels",         brand: "Jack Daniel's",    unit: "bt", unitSize: "0.7lt" },
  { category: "Spirits & Liquori", name: "Ballantines",          brand: "Ballantine's",     unit: "bt", unitSize: "0.7lt" },
  { category: "Spirits & Liquori", name: "Bushmills",            brand: "Bushmills",        unit: "bt", unitSize: "0.7lt" },
  { category: "Spirits & Liquori", name: "Martell Cognac",       brand: "Martell",          unit: "bt", unitSize: "0.7lt" },
  { category: "Spirits & Liquori", name: "Prime Uve",                                       unit: "bt", unitSize: "0.7lt" },
  { category: "Spirits & Liquori", name: "Grappa Barricata 903", brand: "903",              unit: "bt", unitSize: "0.7lt" },
  { category: "Spirits & Liquori", name: "Diciotto Lune",                                   unit: "bt", unitSize: "0.7lt" },
  { category: "Spirits & Liquori", name: "Zacapa 23",            brand: "Ron Zacapa",       unit: "bt", unitSize: "0.7lt" },
  { category: "Spirits & Liquori", name: "Matusalem",            brand: "Matusalem",        unit: "bt", unitSize: "0.7lt" },
  { category: "Spirits & Liquori", name: "Pampero",              brand: "Pampero",          unit: "bt", unitSize: "0.7lt" },

  // GIN (11)
  { category: "Gin", name: "Gin Bombay",        brand: "Bombay",     unit: "bt", unitSize: "0.7lt" },
  { category: "Gin", name: "Gin Gordon",        brand: "Gordon's",   unit: "bt", unitSize: "0.7lt" },
  { category: "Gin", name: "Gin Hendrick's",    brand: "Hendrick's", unit: "bt", unitSize: "0.7lt" },
  { category: "Gin", name: "Gin Tanqueray",     brand: "Tanqueray",  unit: "bt", unitSize: "0.7lt" },
  { category: "Gin", name: "Gin Portofino",     brand: "Portofino",  unit: "bt", unitSize: "0.5lt" },
  { category: "Gin", name: "Gin Etsu",          brand: "Etsu",       unit: "bt", unitSize: "0.7lt" },
  { category: "Gin", name: "Gin Panarea Island", brand: "Panarea",   unit: "bt", unitSize: "0.7lt" },
  { category: "Gin", name: "Gin Panarea Sunset", brand: "Panarea",   unit: "bt", unitSize: "0.7lt" },
  { category: "Gin", name: "Gin Etneum",        brand: "Etneum",     unit: "bt", unitSize: "0.7lt" },
  { category: "Gin", name: "Gin Legend",        brand: "Legend",     unit: "bt", unitSize: "0.7lt" },
  { category: "Gin", name: "Gin Mare",          brand: "Mare",       unit: "bt", unitSize: "0.7lt" },

  // VODKA (9)
  { category: "Vodka", name: "Vodka Raspberry",                       unit: "bt", unitSize: "0.7lt" },
  { category: "Vodka", name: "Vodka Absolut",      brand: "Absolut",      unit: "bt", unitSize: "0.7lt" },
  { category: "Vodka", name: "Vodka Belvedere",    brand: "Belvedere",    unit: "bt", unitSize: "0.7lt" },
  { category: "Vodka", name: "Vodka Grey Goose",   brand: "Grey Goose",   unit: "bt", unitSize: "0.7lt" },
  { category: "Vodka", name: "Vodka Sky",          brand: "Skyy",         unit: "bt", unitSize: "0.7lt" },
  { category: "Vodka", name: "Vodka Beluga",       brand: "Beluga",       unit: "bt", unitSize: "0.7lt" },
  { category: "Vodka", name: "Vodka alla Pesca",                          unit: "bt", unitSize: "0.7lt" },
  { category: "Vodka", name: "Vodka alla Fragola",                        unit: "bt", unitSize: "0.7lt" },
  { category: "Vodka", name: "Vodka Moskowskai",                          unit: "bt", unitSize: "0.7lt" },

  // TEQUILA & RUM (3 — i Rum sono in Spirits, qui solo Tequila)
  { category: "Tequila & Rum", name: "Tequila Jose Cuervo",        brand: "Jose Cuervo",  unit: "bt", unitSize: "0.7lt" },
  { category: "Tequila & Rum", name: "Tequila Jose Cuervo Silver", brand: "Jose Cuervo",  unit: "bt", unitSize: "0.7lt" },
  { category: "Tequila & Rum", name: "Tequila",                                            unit: "bt", unitSize: "0.7lt" },
  { category: "Tequila & Rum", name: "Havana Club 7",              brand: "Havana Club",  unit: "bt", unitSize: "0.7lt" },
  { category: "Tequila & Rum", name: "Havana Club 3",              brand: "Havana Club",  unit: "bt", unitSize: "0.7lt" },

  // APERITIVI & VERMOUTH (5)
  { category: "Aperitivi & Vermouth", name: "Aperol",            brand: "Aperol",   unit: "bt", unitSize: "0.7lt" },
  { category: "Aperitivi & Vermouth", name: "Campari",           brand: "Campari",  unit: "bt", unitSize: "0.7lt" },
  { category: "Aperitivi & Vermouth", name: "Martini Bianco",    brand: "Martini",  unit: "bt", unitSize: "0.75lt" },
  { category: "Aperitivi & Vermouth", name: "Martini Rosso",     brand: "Martini",  unit: "bt", unitSize: "0.75lt" },
  { category: "Aperitivi & Vermouth", name: "Martini Extra Dry", brand: "Martini",  unit: "bt", unitSize: "0.75lt" },

  // VINI BIANCHI (11)
  { category: "Vini Bianchi", name: "Carizza",                                                  unit: "bt", unitSize: "0.75lt" },
  { category: "Vini Bianchi", name: "Cusumano Cubia",         brand: "Cusumano",                unit: "bt", unitSize: "0.75lt" },
  { category: "Vini Bianchi", name: "Ciuri",                  brand: "Cantine Florio",          unit: "bt", unitSize: "0.75lt" },
  { category: "Vini Bianchi", name: "Tornatore Etna Bianco",  brand: "Tornatore",               unit: "bt", unitSize: "0.75lt" },
  { category: "Vini Bianchi", name: "Grillo Mesa Santa Tresa", brand: "Santa Tresa",            unit: "bt", unitSize: "0.75lt" },
  { category: "Vini Bianchi", name: "Iancura",                                                  unit: "bt", unitSize: "0.75lt" },
  { category: "Vini Bianchi", name: "Murgo Tenuta San Michele", brand: "Murgo",                 unit: "bt", unitSize: "0.75lt" },
  { category: "Vini Bianchi", name: "Gulfi Caricanti",        brand: "Gulfi",                   unit: "bt", unitSize: "0.75lt" },
  { category: "Vini Bianchi", name: "Borgo del Tiglio Prosecco", brand: "Borgo del Tiglio",     unit: "bt", unitSize: "0.75lt" },
  { category: "Vini Bianchi", name: "Carpenè Malvolti",       brand: "Carpenè Malvolti",        unit: "bt", unitSize: "0.75lt" },
  { category: "Vini Bianchi", name: "Chardonnay Principi di Butera", brand: "Principi di Butera", unit: "bt", unitSize: "0.75lt" },

  // VINI ROSSI (12)
  { category: "Vini Rossi", name: "Tornatore Etna Rosso",      brand: "Tornatore",          unit: "bt", unitSize: "0.75lt" },
  { category: "Vini Rossi", name: "Surya Nero d'Avola",                                     unit: "bt", unitSize: "0.75lt" },
  { category: "Vini Rossi", name: "Sul Vulcano Etna Rosso",                                 unit: "bt", unitSize: "0.75lt" },
  { category: "Vini Rossi", name: "Santa Tresa Frappato",      brand: "Santa Tresa",        unit: "bt", unitSize: "0.75lt" },
  { category: "Vini Rossi", name: "Santa Tresa Cerasuolo di Vittoria", brand: "Santa Tresa", unit: "bt", unitSize: "0.75lt" },
  { category: "Vini Rossi", name: "Maria Costanza",            brand: "Maria Costanza",     unit: "bt", unitSize: "0.75lt" },
  { category: "Vini Rossi", name: "Kayd Syrah",                                             unit: "bt", unitSize: "0.75lt" },
  { category: "Vini Rossi", name: "Cottanèra Etna Rosso",      brand: "Cottanèra",          unit: "bt", unitSize: "0.75lt" },
  { category: "Vini Rossi", name: "Cottana Etna",                                           unit: "bt", unitSize: "0.75lt" },
  { category: "Vini Rossi", name: "Buttitta",                                               unit: "bt", unitSize: "0.75lt" },
  { category: "Vini Rossi", name: "Anatra Nero d'Avola",                                    unit: "bt", unitSize: "0.75lt" },
  { category: "Vini Rossi", name: "L'Amuri Nero d'Avola",                                   unit: "bt", unitSize: "0.75lt" },

  // VINI DOLCI & PASSITI (3)
  { category: "Vini Dolci & Passiti", name: "Passito",            unit: "bt", unitSize: "0.5lt" },
  { category: "Vini Dolci & Passiti", name: "Vino alle Mandorle", unit: "bt", unitSize: "0.5lt" },
  { category: "Vini Dolci & Passiti", name: "Zibibbo",            unit: "bt", unitSize: "0.5lt" },
];

// ─── Esecuzione ──────────────────────────────────────────────────────────────
function upsertCategory(c: CatDef): number {
  const existing = db.prepare("SELECT id FROM categories WHERE LOWER(name) = LOWER(?)").get(c.name) as { id: number } | undefined;
  if (existing) return existing.id;
  const res = db.prepare(`
    INSERT INTO categories (name, section, macro_category, icon, color, sort_order)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(c.name, c.section, c.macroCategory, c.icon, c.color, c.sortOrder);
  return Number(res.lastInsertRowid);
}

function upsertProduct(p: ProdDef, catId: number): "created" | "skipped" {
  const existing = db.prepare(
    "SELECT id FROM products WHERE LOWER(name) = LOWER(?) AND category_id = ?"
  ).get(p.name, catId);
  if (existing) return "skipped";
  db.prepare(`
    INSERT INTO products
      (category_id, name, brand, unit, unit_size, pack_size, supplier,
       current_stock, min_stock, ideal_stock, location, notes, active)
    VALUES (?, ?, ?, ?, ?, ?, '', 0, ?, ?, '', '', 1)
  `).run(
    catId,
    p.name,
    p.brand ?? "",
    p.unit ?? "pz",
    p.unitSize ?? "",
    p.packSize ?? 1,
    p.minStock ?? 2,
    p.idealStock ?? 5,
  );
  return "created";
}

const catIds = new Map<string, number>();
for (const c of CATEGORIES) catIds.set(c.name, upsertCategory(c));

let created = 0, skipped = 0;
for (const p of PRODUCTS) {
  const catId = catIds.get(p.category);
  if (!catId) {
    console.warn(`⚠ categoria sconosciuta: ${p.category} (${p.name})`);
    continue;
  }
  const r = upsertProduct(p, catId);
  if (r === "created") created++; else skipped++;
}

console.log(`\nCategorie: ${CATEGORIES.length}`);
console.log(`Prodotti aggiunti: ${created}, già presenti: ${skipped}, totale in DB: ${created + skipped}`);

db.close();

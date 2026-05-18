import { drizzle } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import { eq, desc, and, gte, lte, sql } from "drizzle-orm";
import {
  categories, products, movements, users, sheets, sheetRows,
  type Category, type InsertCategory,
  type Product, type InsertProduct,
  type Movement, type InsertMovement,
  type User, type InsertUser,
  type Sheet,
  type SheetRow,
} from "@shared/schema";

// DB_PATH env var → Railway persistent volume (/data/data.db)
// Falls back to local data.db for development
const DB_PATH = process.env.DB_PATH || "data.db";
const sqlite = new Database(DB_PATH);
const db = drizzle(sqlite);

// ─── DDL ──────────────────────────────────────────────────────────────────────
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    username TEXT NOT NULL UNIQUE,
    password TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'staff',
    color TEXT NOT NULL DEFAULT '#f97316',
    active INTEGER NOT NULL DEFAULT 1
  );
  CREATE TABLE IF NOT EXISTS categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    section TEXT NOT NULL,
    macro_category TEXT NOT NULL DEFAULT '',
    icon TEXT NOT NULL DEFAULT '📦',
    color TEXT NOT NULL DEFAULT '#f97316',
    sort_order INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    category_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    brand TEXT NOT NULL DEFAULT '',
    unit TEXT NOT NULL DEFAULT 'pz',
    unit_size TEXT NOT NULL DEFAULT '',
    pack_size REAL NOT NULL DEFAULT 1,
    supplier TEXT NOT NULL DEFAULT '',
    current_stock REAL NOT NULL DEFAULT 0,
    min_stock REAL NOT NULL DEFAULT 2,
    ideal_stock REAL NOT NULL DEFAULT 5,
    location TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    active INTEGER NOT NULL DEFAULT 1
  );
  CREATE TABLE IF NOT EXISTS movements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL,
    type TEXT NOT NULL,
    quantity REAL NOT NULL,
    stock_before REAL NOT NULL,
    stock_after REAL NOT NULL,
    note TEXT NOT NULL DEFAULT '',
    user_id TEXT NOT NULL DEFAULT '',
    sheet_id INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sheets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    start_date INTEGER NOT NULL,
    end_date INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'open',
    created_at INTEGER NOT NULL,
    closed_at INTEGER,
    closed_by_user_id INTEGER,
    notes TEXT NOT NULL DEFAULT ''
  );
  CREATE TABLE IF NOT EXISTS sheet_rows (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sheet_id INTEGER NOT NULL,
    product_id INTEGER NOT NULL,
    initial REAL NOT NULL DEFAULT 0,
    entries REAL NOT NULL DEFAULT 0,
    exits REAL NOT NULL DEFAULT 0,
    final_calculated REAL NOT NULL DEFAULT 0,
    final_counted REAL,
    notes TEXT NOT NULL DEFAULT ''
  );
`);

// ─── Migrazione colonne aggiunte successivamente ──────────────────────────────
// SQLite non supporta `ADD COLUMN IF NOT EXISTS`, quindi ispezioniamo lo schema
// runtime con PRAGMA e applichiamo l'ALTER solo se la colonna manca.
function ensureColumn(table: string, col: string, ddl: string): void {
  const info = sqlite.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!info.some(c => c.name === col)) {
    sqlite.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
  }
}
ensureColumn("categories", "macro_category", "macro_category TEXT NOT NULL DEFAULT ''");
ensureColumn("products", "pack_size", "pack_size REAL NOT NULL DEFAULT 1");
ensureColumn("products", "supplier", "supplier TEXT NOT NULL DEFAULT ''");
ensureColumn("movements", "sheet_id", "sheet_id INTEGER NOT NULL DEFAULT 0");

// ─── Helper periodo settimanale (lunedì → domenica) ───────────────────────────
function getWeekRange(d: Date): { start: number; end: number } {
  const day = d.getDay() || 7; // 1=Lun..7=Dom (getDay() ritorna 0=Dom → diventa 7)
  const monday = new Date(d);
  monday.setDate(d.getDate() - (day - 1));
  monday.setHours(0, 0, 0, 0);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  sunday.setHours(23, 59, 59, 999);
  return { start: monday.getTime(), end: sunday.getTime() };
}

function formatWeekName(start: number, end: number): string {
  const s = new Date(start);
  const e = new Date(end);
  const meseS = s.toLocaleDateString("it-IT", { month: "long" });
  const meseE = e.toLocaleDateString("it-IT", { month: "long" });
  const year = e.getFullYear();
  if (meseS === meseE) return `Settimana ${s.getDate()}–${e.getDate()} ${meseE} ${year}`;
  return `Settimana ${s.getDate()} ${meseS} – ${e.getDate()} ${meseE} ${year}`;
}

// ─── Seed ─────────────────────────────────────────────────────────────────────
const uc = db.select({ c: sql<number>`count(*)` }).from(users).get();
if (!uc || uc.c === 0) {
  db.insert(users).values([
    { name: "Roberto Admin", username: "admin", password: "admin123", role: "admin", color: "#f97316" },
    { name: "Staff Magazzino", username: "staff", password: "staff123", role: "staff", color: "#3b82f6" },
  ]).run();

  // ─── Categorie Bevande ────────────────────────────────────────────────────
  // Ogni categoria porta la sua macroCategory per raggrupparle nella UI.
  const catDefs = [
    // Bevande – analcolici
    { name: "Acqua", section: "bevande", macroCategory: "acqua", icon: "💧", color: "#3b82f6", sortOrder: 1 },
    { name: "Birra & Fusti", section: "bevande", macroCategory: "birre", icon: "🍺", color: "#eab308", sortOrder: 2 },
    { name: "Bibite & Soft Drink", section: "bevande", macroCategory: "analcolici", icon: "🥤", color: "#22c55e", sortOrder: 3 },
    { name: "Succhi", section: "bevande", macroCategory: "analcolici", icon: "🧃", color: "#f97316", sortOrder: 4 },
    // Bevande – vini (la vecchia categoria generica "Vino" non viene più seedata,
    // sostituita dalle 3 categorie specifiche più sotto)
    { name: "Amari & Digestivi", section: "bevande", macroCategory: "alcolici", icon: "🥃", color: "#92400e", sortOrder: 6 },
    { name: "Spirits & Liquori", section: "bevande", macroCategory: "alcolici", icon: "🍸", color: "#7c3aed", sortOrder: 7 },
    { name: "Gin", section: "bevande", macroCategory: "alcolici", icon: "🫙", color: "#0891b2", sortOrder: 8 },
    { name: "Vodka", section: "bevande", macroCategory: "alcolici", icon: "🧊", color: "#6366f1", sortOrder: 9 },
    { name: "Tequila & Rum & Altro", section: "bevande", macroCategory: "alcolici", icon: "🌊", color: "#059669", sortOrder: 10 },
    { name: "Aperitivi & Vermouth", section: "bevande", macroCategory: "alcolici", icon: "🍊", color: "#ea580c", sortOrder: 11 },
    // Vini (tre nuove categorie specifiche)
    { name: "Vini Bianchi", section: "bevande", macroCategory: "vini", icon: "🥂", color: "#fde047", sortOrder: 12 },
    { name: "Vini Rossi", section: "bevande", macroCategory: "vini", icon: "🍷", color: "#991b1b", sortOrder: 13 },
    { name: "Vini Dolci & Passiti", section: "bevande", macroCategory: "vini", icon: "🍯", color: "#f59e0b", sortOrder: 14 },
    // Cucina
    { name: "Farine & Impasto", section: "cucina", macroCategory: "cucina", icon: "🌾", color: "#d97706", sortOrder: 20 },
    { name: "Pomodoro & Conserve", section: "cucina", macroCategory: "cucina", icon: "🍅", color: "#ef4444", sortOrder: 21 },
    { name: "Latticini & Formaggi", section: "cucina", macroCategory: "cucina", icon: "🧀", color: "#fbbf24", sortOrder: 22 },
    { name: "Salumi & Affettati", section: "cucina", macroCategory: "cucina", icon: "🥩", color: "#b45309", sortOrder: 23 },
    { name: "Verdure & Ortaggi", section: "cucina", macroCategory: "cucina", icon: "🥦", color: "#16a34a", sortOrder: 24 },
    { name: "Oli & Condimenti", section: "cucina", macroCategory: "cucina", icon: "🫙", color: "#ca8a04", sortOrder: 25 },
    { name: "Pesce & Mare", section: "cucina", macroCategory: "cucina", icon: "🐟", color: "#0ea5e9", sortOrder: 26 },
    { name: "Secchi & Dispensa", section: "cucina", macroCategory: "cucina", icon: "🥫", color: "#78716c", sortOrder: 27 },
  ];

  const cats = db.insert(categories).values(catDefs).returning().all();
  const cm: Record<string, number> = {};
  for (const c of cats) cm[c.name] = c.id;

  // ─── Prodotti Bevande ─────────────────────────────────────────────────────

  // ACQUA – casse da 12 bottiglie
  db.insert(products).values([
    { categoryId: cm["Acqua"], name: "Acqua Naturale", brand: "", unit: "cassa", unitSize: "24×0.5lt", packSize: 12, currentStock: 8, minStock: 4, idealStock: 12, location: "Magazzino" },
    { categoryId: cm["Acqua"], name: "Acqua Frizzante", brand: "", unit: "cassa", unitSize: "24×0.5lt", packSize: 12, currentStock: 6, minStock: 4, idealStock: 10, location: "Magazzino" },
    { categoryId: cm["Acqua"], name: "Acqua Ferrarelle", brand: "Ferrarelle", unit: "cassa", unitSize: "24×0.5lt", packSize: 12, currentStock: 4, minStock: 2, idealStock: 8, location: "Magazzino" },
  ]).run();

  // BIRRA & FUSTI – fusti packSize=1, bottiglie cassa da 24, bombola CO2 packSize=1
  db.insert(products).values([
    { categoryId: cm["Birra & Fusti"], name: "Fusto Heineken", brand: "Heineken", unit: "fusto", unitSize: "30lt", packSize: 1, currentStock: 2, minStock: 1, idealStock: 3, location: "Cantina" },
    { categoryId: cm["Birra & Fusti"], name: "Fusto Affligem", brand: "Affligem", unit: "fusto", unitSize: "20lt", packSize: 1, currentStock: 1, minStock: 1, idealStock: 2, location: "Cantina" },
    { categoryId: cm["Birra & Fusti"], name: "Fusto Messina", brand: "Messina", unit: "fusto", unitSize: "30lt", packSize: 1, currentStock: 2, minStock: 1, idealStock: 3, location: "Cantina" },
    { categoryId: cm["Birra & Fusti"], name: "Bombola CO2", brand: "", unit: "pz", unitSize: "10kg", packSize: 1, currentStock: 2, minStock: 1, idealStock: 3, location: "Cantina" },
    { categoryId: cm["Birra & Fusti"], name: "Heineken 0.0 33cl", brand: "Heineken", unit: "cassa", unitSize: "24 bt", packSize: 24, currentStock: 2, minStock: 1, idealStock: 4, location: "Frigo Bar" },
    { categoryId: cm["Birra & Fusti"], name: "Heineken 33cl", brand: "Heineken", unit: "cassa", unitSize: "24 bt", packSize: 24, currentStock: 3, minStock: 2, idealStock: 6, location: "Frigo Bar" },
    { categoryId: cm["Birra & Fusti"], name: "Corona 33cl", brand: "Corona", unit: "cassa", unitSize: "24 bt", packSize: 24, currentStock: 2, minStock: 1, idealStock: 4, location: "Frigo Bar" },
    { categoryId: cm["Birra & Fusti"], name: "Erdinger", brand: "Erdinger", unit: "cassa", unitSize: "24 bt", packSize: 24, currentStock: 1, minStock: 1, idealStock: 3, location: "Frigo Bar" },
    { categoryId: cm["Birra & Fusti"], name: "Fisher", brand: "Fischer", unit: "cassa", unitSize: "24 bt", packSize: 24, currentStock: 1, minStock: 1, idealStock: 3, location: "Frigo Bar" },
    { categoryId: cm["Birra & Fusti"], name: "Blanche de Namur", brand: "Blanche de Namur", unit: "cassa", unitSize: "24 bt", packSize: 24, currentStock: 1, minStock: 1, idealStock: 2, location: "Frigo Bar" },
  ]).run();

  // BIBITE & SOFT – tutte cassa packSize=24, eccetto Coca-Cola 1lt (cassa da 12)
  db.insert(products).values([
    { categoryId: cm["Bibite & Soft Drink"], name: "Coca-Cola 33cl", brand: "Coca-Cola", unit: "cassa", unitSize: "24 latt.", packSize: 24, currentStock: 5, minStock: 3, idealStock: 8, location: "Magazzino" },
    { categoryId: cm["Bibite & Soft Drink"], name: "Coca Zero 33cl", brand: "Coca-Cola", unit: "cassa", unitSize: "24 latt.", packSize: 24, currentStock: 4, minStock: 2, idealStock: 6, location: "Magazzino" },
    { categoryId: cm["Bibite & Soft Drink"], name: "Coca-Cola 1lt", brand: "Coca-Cola", unit: "cassa", unitSize: "12 bt", packSize: 12, currentStock: 3, minStock: 2, idealStock: 6, location: "Magazzino" },
    { categoryId: cm["Bibite & Soft Drink"], name: "Chinotto", brand: "", unit: "cassa", unitSize: "24 bt", packSize: 24, currentStock: 2, minStock: 1, idealStock: 4, location: "Magazzino" },
    { categoryId: cm["Bibite & Soft Drink"], name: "Gazzosa", brand: "", unit: "cassa", unitSize: "24 bt", packSize: 24, currentStock: 2, minStock: 1, idealStock: 4, location: "Magazzino" },
    { categoryId: cm["Bibite & Soft Drink"], name: "Limonata", brand: "", unit: "cassa", unitSize: "24 bt", packSize: 24, currentStock: 2, minStock: 1, idealStock: 4, location: "Magazzino" },
    { categoryId: cm["Bibite & Soft Drink"], name: "Aranciata Bio", brand: "", unit: "cassa", unitSize: "24 bt", packSize: 24, currentStock: 2, minStock: 1, idealStock: 4, location: "Magazzino" },
    { categoryId: cm["Bibite & Soft Drink"], name: "Acqua Tonica Schweppes", brand: "Schweppes", unit: "cassa", unitSize: "24 bt", packSize: 24, currentStock: 3, minStock: 2, idealStock: 6, location: "Magazzino" },
    { categoryId: cm["Bibite & Soft Drink"], name: "Schweppes Lemon", brand: "Schweppes", unit: "cassa", unitSize: "24 bt", packSize: 24, currentStock: 2, minStock: 1, idealStock: 4, location: "Magazzino" },
    { categoryId: cm["Bibite & Soft Drink"], name: "Ginger Beer", brand: "", unit: "cassa", unitSize: "24 bt", packSize: 24, currentStock: 2, minStock: 1, idealStock: 4, location: "Magazzino" },
  ]).run();

  // SUCCHI – cassa da 12 brick
  db.insert(products).values([
    { categoryId: cm["Succhi"], name: "Succo Ananas", brand: "", unit: "cassa", unitSize: "12×200ml", packSize: 12, currentStock: 3, minStock: 2, idealStock: 6, location: "Magazzino" },
    { categoryId: cm["Succhi"], name: "Succo Arancia", brand: "", unit: "cassa", unitSize: "12×200ml", packSize: 12, currentStock: 3, minStock: 2, idealStock: 6, location: "Magazzino" },
    { categoryId: cm["Succhi"], name: "Succo Pesca", brand: "", unit: "cassa", unitSize: "12×200ml", packSize: 12, currentStock: 3, minStock: 2, idealStock: 6, location: "Magazzino" },
  ]).run();

  // AMARI & DIGESTIVI – tutte bottiglie singole packSize=1
  // NB: i vini dolci ("Passito Vino alle Mandorle", "Zibibbo") sono spostati
  // nella nuova categoria "Vini Dolci & Passiti".
  db.insert(products).values([
    { categoryId: cm["Amari & Digestivi"], name: "Amaro Amara", brand: "Amara", unit: "bt", unitSize: "0.7lt", packSize: 1, currentStock: 3, minStock: 1, idealStock: 4, location: "Bar" },
    { categoryId: cm["Amari & Digestivi"], name: "Amaretto Disaronno", brand: "Disaronno", unit: "bt", unitSize: "0.7lt", packSize: 1, currentStock: 2, minStock: 1, idealStock: 3, location: "Bar" },
    { categoryId: cm["Amari & Digestivi"], name: "Amaro Unnimaffissu", brand: "", unit: "bt", unitSize: "0.7lt", packSize: 1, currentStock: 2, minStock: 1, idealStock: 3, location: "Bar" },
    { categoryId: cm["Amari & Digestivi"], name: "Amaro Montenegro", brand: "Montenegro", unit: "bt", unitSize: "0.7lt", packSize: 1, currentStock: 2, minStock: 1, idealStock: 3, location: "Bar" },
    { categoryId: cm["Amari & Digestivi"], name: "Amaro Averna", brand: "Averna", unit: "bt", unitSize: "0.7lt", packSize: 1, currentStock: 2, minStock: 1, idealStock: 3, location: "Bar" },
    { categoryId: cm["Amari & Digestivi"], name: "Amaro del Capo", brand: "Del Capo", unit: "bt", unitSize: "0.7lt", packSize: 1, currentStock: 2, minStock: 1, idealStock: 3, location: "Bar" },
    { categoryId: cm["Amari & Digestivi"], name: "Amaro del Capo Piccante", brand: "Del Capo", unit: "bt", unitSize: "0.7lt", packSize: 1, currentStock: 1, minStock: 1, idealStock: 2, location: "Bar" },
    { categoryId: cm["Amari & Digestivi"], name: "Amaro dell'Etna", brand: "", unit: "bt", unitSize: "0.7lt", packSize: 1, currentStock: 2, minStock: 1, idealStock: 3, location: "Bar" },
    { categoryId: cm["Amari & Digestivi"], name: "Amaro Unicum", brand: "Unicum", unit: "bt", unitSize: "0.7lt", packSize: 1, currentStock: 1, minStock: 1, idealStock: 2, location: "Bar" },
    { categoryId: cm["Amari & Digestivi"], name: "Branca Menta", brand: "Branca", unit: "bt", unitSize: "0.7lt", packSize: 1, currentStock: 1, minStock: 1, idealStock: 2, location: "Bar" },
    { categoryId: cm["Amari & Digestivi"], name: "Fernet Branca", brand: "Branca", unit: "bt", unitSize: "0.7lt", packSize: 1, currentStock: 2, minStock: 1, idealStock: 3, location: "Bar" },
    { categoryId: cm["Amari & Digestivi"], name: "Limoncello", brand: "", unit: "bt", unitSize: "0.7lt", packSize: 1, currentStock: 3, minStock: 2, idealStock: 5, location: "Bar" },
    { categoryId: cm["Amari & Digestivi"], name: "Grappa Barricata 903", brand: "903", unit: "bt", unitSize: "0.7lt", packSize: 1, currentStock: 1, minStock: 1, idealStock: 2, location: "Bar" },
    { categoryId: cm["Amari & Digestivi"], name: "Diciotto Lune", brand: "", unit: "bt", unitSize: "0.7lt", packSize: 1, currentStock: 1, minStock: 1, idealStock: 2, location: "Bar" },
    { categoryId: cm["Amari & Digestivi"], name: "Baileys", brand: "Baileys", unit: "bt", unitSize: "0.7lt", packSize: 1, currentStock: 2, minStock: 1, idealStock: 3, location: "Bar" },
    { categoryId: cm["Amari & Digestivi"], name: "Grand Marnier", brand: "Grand Marnier", unit: "bt", unitSize: "0.7lt", packSize: 1, currentStock: 1, minStock: 1, idealStock: 2, location: "Bar" },
    { categoryId: cm["Amari & Digestivi"], name: "Drambuie", brand: "Drambuie", unit: "bt", unitSize: "0.7lt", packSize: 1, currentStock: 1, minStock: 1, idealStock: 2, location: "Bar" },
    { categoryId: cm["Amari & Digestivi"], name: "St Germain", brand: "St Germain", unit: "bt", unitSize: "0.7lt", packSize: 1, currentStock: 1, minStock: 1, idealStock: 2, location: "Bar" },
    { categoryId: cm["Amari & Digestivi"], name: "Kahlúa", brand: "Kahlúa", unit: "bt", unitSize: "0.7lt", packSize: 1, currentStock: 1, minStock: 1, idealStock: 2, location: "Bar" },
    { categoryId: cm["Amari & Digestivi"], name: "Midori", brand: "Midori", unit: "bt", unitSize: "0.7lt", packSize: 1, currentStock: 1, minStock: 1, idealStock: 2, location: "Bar" },
    { categoryId: cm["Amari & Digestivi"], name: "Malibu", brand: "Malibu", unit: "bt", unitSize: "0.7lt", packSize: 1, currentStock: 1, minStock: 1, idealStock: 2, location: "Bar" },
    { categoryId: cm["Amari & Digestivi"], name: "Passoa Passion Fruit", brand: "Passoa", unit: "bt", unitSize: "0.7lt", packSize: 1, currentStock: 1, minStock: 1, idealStock: 2, location: "Bar" },
    { categoryId: cm["Amari & Digestivi"], name: "Peachtree", brand: "Peachtree", unit: "bt", unitSize: "0.7lt", packSize: 1, currentStock: 1, minStock: 1, idealStock: 2, location: "Bar" },
    { categoryId: cm["Amari & Digestivi"], name: "Sambuca", brand: "", unit: "bt", unitSize: "0.7lt", packSize: 1, currentStock: 2, minStock: 1, idealStock: 3, location: "Bar" },
    { categoryId: cm["Amari & Digestivi"], name: "Cointreau", brand: "Cointreau", unit: "bt", unitSize: "0.7lt", packSize: 1, currentStock: 1, minStock: 1, idealStock: 2, location: "Bar" },
    { categoryId: cm["Amari & Digestivi"], name: "Triple Sec", brand: "", unit: "bt", unitSize: "0.7lt", packSize: 1, currentStock: 1, minStock: 1, idealStock: 2, location: "Bar" },
    { categoryId: cm["Amari & Digestivi"], name: "Curaçao Blu", brand: "", unit: "bt", unitSize: "0.7lt", packSize: 1, currentStock: 1, minStock: 1, idealStock: 2, location: "Bar" },
  ]).run();

  // SPIRITS & LIQUORI – bottiglie singole packSize=1
  db.insert(products).values([
    { categoryId: cm["Spirits & Liquori"], name: "Jefferson", brand: "Jefferson", unit: "bt", unitSize: "0.7lt", packSize: 1, currentStock: 1, minStock: 1, idealStock: 2, location: "Bar" },
    { categoryId: cm["Spirits & Liquori"], name: "Jägermeister", brand: "Jägermeister", unit: "bt", unitSize: "0.7lt", packSize: 1, currentStock: 2, minStock: 1, idealStock: 3, location: "Bar" },
    { categoryId: cm["Spirits & Liquori"], name: "Jack Daniel's", brand: "Jack Daniel's", unit: "bt", unitSize: "0.7lt", packSize: 1, currentStock: 2, minStock: 1, idealStock: 3, location: "Bar" },
    { categoryId: cm["Spirits & Liquori"], name: "Ballantine's", brand: "Ballantine's", unit: "bt", unitSize: "0.7lt", packSize: 1, currentStock: 2, minStock: 1, idealStock: 3, location: "Bar" },
    { categoryId: cm["Spirits & Liquori"], name: "Bushmills", brand: "Bushmills", unit: "bt", unitSize: "0.7lt", packSize: 1, currentStock: 1, minStock: 1, idealStock: 2, location: "Bar" },
    { categoryId: cm["Spirits & Liquori"], name: "Martell Cognac", brand: "Martell", unit: "bt", unitSize: "0.7lt", packSize: 1, currentStock: 1, minStock: 1, idealStock: 2, location: "Bar" },
    { categoryId: cm["Spirits & Liquori"], name: "Cognac Prime Uve", brand: "", unit: "bt", unitSize: "0.7lt", packSize: 1, currentStock: 1, minStock: 1, idealStock: 2, location: "Bar" },
    { categoryId: cm["Spirits & Liquori"], name: "Zacapa 23", brand: "Ron Zacapa", unit: "bt", unitSize: "0.7lt", packSize: 1, currentStock: 1, minStock: 1, idealStock: 2, location: "Bar" },
    { categoryId: cm["Spirits & Liquori"], name: "Matusalem 7 Anni", brand: "Matusalem", unit: "bt", unitSize: "0.7lt", packSize: 1, currentStock: 1, minStock: 1, idealStock: 2, location: "Bar" },
    { categoryId: cm["Spirits & Liquori"], name: "Pampero", brand: "Pampero", unit: "bt", unitSize: "0.7lt", packSize: 1, currentStock: 1, minStock: 1, idealStock: 2, location: "Bar" },
    { categoryId: cm["Spirits & Liquori"], name: "Batida de Coco", brand: "Batida", unit: "bt", unitSize: "0.7lt", packSize: 1, currentStock: 1, minStock: 1, idealStock: 2, location: "Bar" },
    { categoryId: cm["Spirits & Liquori"], name: "Vodka Raspberry", brand: "", unit: "bt", unitSize: "0.7lt", packSize: 1, currentStock: 1, minStock: 1, idealStock: 2, location: "Bar" },
    { categoryId: cm["Spirits & Liquori"], name: "Vodka alla Pesca", brand: "", unit: "bt", unitSize: "0.7lt", packSize: 1, currentStock: 1, minStock: 1, idealStock: 2, location: "Bar" },
    { categoryId: cm["Spirits & Liquori"], name: "Vodka alla Fragola", brand: "", unit: "bt", unitSize: "0.7lt", packSize: 1, currentStock: 1, minStock: 1, idealStock: 2, location: "Bar" },
  ]).run();

  // GIN – bottiglie singole packSize=1
  db.insert(products).values([
    { categoryId: cm["Gin"], name: "Gin Bombay Sapphire", brand: "Bombay", unit: "bt", unitSize: "0.7lt", packSize: 1, currentStock: 2, minStock: 1, idealStock: 3, location: "Bar" },
    { categoryId: cm["Gin"], name: "Gin Gordon's", brand: "Gordon's", unit: "bt", unitSize: "0.7lt", packSize: 1, currentStock: 2, minStock: 1, idealStock: 3, location: "Bar" },
    { categoryId: cm["Gin"], name: "Gin Hendrick's", brand: "Hendrick's", unit: "bt", unitSize: "0.7lt", packSize: 1, currentStock: 2, minStock: 1, idealStock: 3, location: "Bar" },
    { categoryId: cm["Gin"], name: "Gin Tanqueray", brand: "Tanqueray", unit: "bt", unitSize: "0.7lt", packSize: 1, currentStock: 2, minStock: 1, idealStock: 3, location: "Bar" },
    { categoryId: cm["Gin"], name: "Gin Portofino", brand: "Portofino", unit: "bt", unitSize: "0.5lt", packSize: 1, currentStock: 1, minStock: 1, idealStock: 2, location: "Bar" },
    { categoryId: cm["Gin"], name: "Gin Etsu", brand: "Etsu", unit: "bt", unitSize: "0.7lt", packSize: 1, currentStock: 1, minStock: 1, idealStock: 2, location: "Bar" },
    { categoryId: cm["Gin"], name: "Gin Panarea Island", brand: "Panarea", unit: "bt", unitSize: "0.7lt", packSize: 1, currentStock: 1, minStock: 1, idealStock: 2, location: "Bar" },
    { categoryId: cm["Gin"], name: "Gin Panarea Sunset", brand: "Panarea", unit: "bt", unitSize: "0.7lt", packSize: 1, currentStock: 1, minStock: 1, idealStock: 2, location: "Bar" },
    { categoryId: cm["Gin"], name: "Gin Etneum", brand: "Etneum", unit: "bt", unitSize: "0.7lt", packSize: 1, currentStock: 1, minStock: 1, idealStock: 2, location: "Bar" },
    { categoryId: cm["Gin"], name: "Gin Legend", brand: "Legend", unit: "bt", unitSize: "0.7lt", packSize: 1, currentStock: 1, minStock: 1, idealStock: 2, location: "Bar" },
    { categoryId: cm["Gin"], name: "Gin Mare", brand: "Mare", unit: "bt", unitSize: "0.7lt", packSize: 1, currentStock: 1, minStock: 1, idealStock: 2, location: "Bar" },
  ]).run();

  // VODKA – bottiglie singole packSize=1
  db.insert(products).values([
    { categoryId: cm["Vodka"], name: "Vodka Absolut", brand: "Absolut", unit: "bt", unitSize: "0.7lt", packSize: 1, currentStock: 2, minStock: 1, idealStock: 3, location: "Bar" },
    { categoryId: cm["Vodka"], name: "Vodka Belvedere", brand: "Belvedere", unit: "bt", unitSize: "0.7lt", packSize: 1, currentStock: 1, minStock: 1, idealStock: 2, location: "Bar" },
    { categoryId: cm["Vodka"], name: "Vodka Grey Goose", brand: "Grey Goose", unit: "bt", unitSize: "0.7lt", packSize: 1, currentStock: 1, minStock: 1, idealStock: 2, location: "Bar" },
    { categoryId: cm["Vodka"], name: "Vodka Skyy", brand: "Skyy", unit: "bt", unitSize: "0.7lt", packSize: 1, currentStock: 1, minStock: 1, idealStock: 2, location: "Bar" },
    { categoryId: cm["Vodka"], name: "Vodka Beluga", brand: "Beluga", unit: "bt", unitSize: "0.7lt", packSize: 1, currentStock: 1, minStock: 1, idealStock: 2, location: "Bar" },
  ]).run();

  // TEQUILA & RUM & ALTRO – bottiglie singole packSize=1
  db.insert(products).values([
    { categoryId: cm["Tequila & Rum & Altro"], name: "Tequila Jose Cuervo Reposado", brand: "Jose Cuervo", unit: "bt", unitSize: "0.7lt", packSize: 1, currentStock: 2, minStock: 1, idealStock: 3, location: "Bar" },
    { categoryId: cm["Tequila & Rum & Altro"], name: "Tequila Jose Cuervo Silver", brand: "Jose Cuervo", unit: "bt", unitSize: "0.7lt", packSize: 1, currentStock: 1, minStock: 1, idealStock: 2, location: "Bar" },
    { categoryId: cm["Tequila & Rum & Altro"], name: "Havana Club 7 Anni", brand: "Havana Club", unit: "bt", unitSize: "0.7lt", packSize: 1, currentStock: 2, minStock: 1, idealStock: 3, location: "Bar" },
    { categoryId: cm["Tequila & Rum & Altro"], name: "Havana Club 3 Anni", brand: "Havana Club", unit: "bt", unitSize: "0.7lt", packSize: 1, currentStock: 2, minStock: 1, idealStock: 3, location: "Bar" },
  ]).run();

  // APERITIVI & VERMOUTH – bottiglie singole packSize=1
  db.insert(products).values([
    { categoryId: cm["Aperitivi & Vermouth"], name: "Aperol", brand: "Aperol", unit: "bt", unitSize: "0.7lt", packSize: 1, currentStock: 3, minStock: 2, idealStock: 5, location: "Bar" },
    { categoryId: cm["Aperitivi & Vermouth"], name: "Campari", brand: "Campari", unit: "bt", unitSize: "0.7lt", packSize: 1, currentStock: 2, minStock: 1, idealStock: 3, location: "Bar" },
    { categoryId: cm["Aperitivi & Vermouth"], name: "Martini Bianco", brand: "Martini", unit: "bt", unitSize: "0.75lt", packSize: 1, currentStock: 2, minStock: 1, idealStock: 3, location: "Bar" },
    { categoryId: cm["Aperitivi & Vermouth"], name: "Martini Rosso", brand: "Martini", unit: "bt", unitSize: "0.75lt", packSize: 1, currentStock: 2, minStock: 1, idealStock: 3, location: "Bar" },
    { categoryId: cm["Aperitivi & Vermouth"], name: "Martini Extra Dry", brand: "Martini", unit: "bt", unitSize: "0.75lt", packSize: 1, currentStock: 2, minStock: 1, idealStock: 3, location: "Bar" },
  ]).run();

  // ─── Vini ─────────────────────────────────────────────────────────────────
  // Parametri comuni: unit="bt", packSize=1, location="Cantina", minStock=2, idealStock=6.
  // Bianchi e Rossi: unitSize="0.75lt". Passiti hanno taglio specifico.
  db.insert(products).values([
    // Bianchi
    { categoryId: cm["Vini Bianchi"], name: "Carizza", brand: "", unit: "bt", unitSize: "0.75lt", packSize: 1, currentStock: 4, minStock: 2, idealStock: 6, location: "Cantina" },
    { categoryId: cm["Vini Bianchi"], name: "Cusumano Cubìa", brand: "Cusumano", unit: "bt", unitSize: "0.75lt", packSize: 1, currentStock: 4, minStock: 2, idealStock: 6, location: "Cantina" },
    { categoryId: cm["Vini Bianchi"], name: "Ciuri (Cantine Florio)", brand: "Cantine Florio", unit: "bt", unitSize: "0.75lt", packSize: 1, currentStock: 4, minStock: 2, idealStock: 6, location: "Cantina" },
    { categoryId: cm["Vini Bianchi"], name: "Tornatore Etna Bianco", brand: "Tornatore", unit: "bt", unitSize: "0.75lt", packSize: 1, currentStock: 4, minStock: 2, idealStock: 6, location: "Cantina" },
    { categoryId: cm["Vini Bianchi"], name: "Grillo Mesa di Santa Tresa", brand: "Santa Tresa", unit: "bt", unitSize: "0.75lt", packSize: 1, currentStock: 4, minStock: 2, idealStock: 6, location: "Cantina" },
    { categoryId: cm["Vini Bianchi"], name: "Iancura", brand: "", unit: "bt", unitSize: "0.75lt", packSize: 1, currentStock: 4, minStock: 2, idealStock: 6, location: "Cantina" },
    { categoryId: cm["Vini Bianchi"], name: "Murgo Tenuta San Michele", brand: "Murgo", unit: "bt", unitSize: "0.75lt", packSize: 1, currentStock: 4, minStock: 2, idealStock: 6, location: "Cantina" },
    { categoryId: cm["Vini Bianchi"], name: "Gulfi Caricanti", brand: "Gulfi", unit: "bt", unitSize: "0.75lt", packSize: 1, currentStock: 4, minStock: 2, idealStock: 6, location: "Cantina" },
    { categoryId: cm["Vini Bianchi"], name: "Borgo del Tiglio Prosecco", brand: "Borgo del Tiglio", unit: "bt", unitSize: "0.75lt", packSize: 1, currentStock: 4, minStock: 2, idealStock: 6, location: "Cantina" },
    { categoryId: cm["Vini Bianchi"], name: "Carpenè Malvolti Prosecco", brand: "Carpenè Malvolti", unit: "bt", unitSize: "0.75lt", packSize: 1, currentStock: 4, minStock: 2, idealStock: 6, location: "Cantina" },
    { categoryId: cm["Vini Bianchi"], name: "Chardonnay Principi di Butera", brand: "Principi di Butera", unit: "bt", unitSize: "0.75lt", packSize: 1, currentStock: 4, minStock: 2, idealStock: 6, location: "Cantina" },
    // Rossi
    { categoryId: cm["Vini Rossi"], name: "Tornatore Etna Rosso", brand: "Tornatore", unit: "bt", unitSize: "0.75lt", packSize: 1, currentStock: 4, minStock: 2, idealStock: 6, location: "Cantina" },
    { categoryId: cm["Vini Rossi"], name: "Surya Nero d'Avola", brand: "", unit: "bt", unitSize: "0.75lt", packSize: 1, currentStock: 4, minStock: 2, idealStock: 6, location: "Cantina" },
    { categoryId: cm["Vini Rossi"], name: "Sul Vulcano Etna Rosso", brand: "", unit: "bt", unitSize: "0.75lt", packSize: 1, currentStock: 4, minStock: 2, idealStock: 6, location: "Cantina" },
    { categoryId: cm["Vini Rossi"], name: "Santa Tresa Frappato", brand: "Santa Tresa", unit: "bt", unitSize: "0.75lt", packSize: 1, currentStock: 4, minStock: 2, idealStock: 6, location: "Cantina" },
    { categoryId: cm["Vini Rossi"], name: "Santa Tresa Cerasuolo di Vittoria", brand: "Santa Tresa", unit: "bt", unitSize: "0.75lt", packSize: 1, currentStock: 4, minStock: 2, idealStock: 6, location: "Cantina" },
    { categoryId: cm["Vini Rossi"], name: "Maria Costanza Etna Rosso", brand: "Maria Costanza", unit: "bt", unitSize: "0.75lt", packSize: 1, currentStock: 4, minStock: 2, idealStock: 6, location: "Cantina" },
    { categoryId: cm["Vini Rossi"], name: "Kayd Syrah", brand: "", unit: "bt", unitSize: "0.75lt", packSize: 1, currentStock: 4, minStock: 2, idealStock: 6, location: "Cantina" },
    { categoryId: cm["Vini Rossi"], name: "Cottanèra Etna Rosso", brand: "Cottanèra", unit: "bt", unitSize: "0.75lt", packSize: 1, currentStock: 4, minStock: 2, idealStock: 6, location: "Cantina" },
    { categoryId: cm["Vini Rossi"], name: "Buttitta", brand: "", unit: "bt", unitSize: "0.75lt", packSize: 1, currentStock: 4, minStock: 2, idealStock: 6, location: "Cantina" },
    { categoryId: cm["Vini Rossi"], name: "Anatra Nero d'Avola", brand: "", unit: "bt", unitSize: "0.75lt", packSize: 1, currentStock: 4, minStock: 2, idealStock: 6, location: "Cantina" },
    { categoryId: cm["Vini Rossi"], name: "L'Amuri Nero d'Avola", brand: "", unit: "bt", unitSize: "0.75lt", packSize: 1, currentStock: 4, minStock: 2, idealStock: 6, location: "Cantina" },
    // Passiti (formato 0.5lt)
    { categoryId: cm["Vini Dolci & Passiti"], name: "Passito Vino alle Mandorle", brand: "", unit: "bt", unitSize: "0.5lt", packSize: 1, currentStock: 3, minStock: 1, idealStock: 4, location: "Cantina" },
    { categoryId: cm["Vini Dolci & Passiti"], name: "Zibibbo", brand: "", unit: "bt", unitSize: "0.5lt", packSize: 1, currentStock: 2, minStock: 1, idealStock: 3, location: "Cantina" },
  ]).run();

  // ─── Prodotti Cucina (base) ───────────────────────────────────────────────
  // packSize=1 di default; per il pomodoro "6×400g" packSize=6 (cartone da 6 latte).
  db.insert(products).values([
    { categoryId: cm["Farine & Impasto"], name: "Farina 00 W330", brand: "Caputo", unit: "sacco", unitSize: "25kg", packSize: 1, currentStock: 4, minStock: 2, idealStock: 8, location: "Dispensa" },
    { categoryId: cm["Farine & Impasto"], name: "Semola Rimacinata", brand: "Lo Conte", unit: "sacco", unitSize: "25kg", packSize: 1, currentStock: 2, minStock: 1, idealStock: 4, location: "Dispensa" },
    { categoryId: cm["Farine & Impasto"], name: "Lievito di Birra Fresco", brand: "Lesaffre", unit: "pz", unitSize: "500g", packSize: 1, currentStock: 8, minStock: 4, idealStock: 12, location: "Frigo Cucina" },
    { categoryId: cm["Farine & Impasto"], name: "Sale Grosso", brand: "", unit: "sacco", unitSize: "10kg", packSize: 1, currentStock: 3, minStock: 1, idealStock: 5, location: "Dispensa" },
    { categoryId: cm["Pomodoro & Conserve"], name: "Pomodoro San Marzano DOP", brand: "La Valle", unit: "cartone", unitSize: "6×400g", packSize: 6, currentStock: 12, minStock: 6, idealStock: 20, location: "Dispensa" },
    { categoryId: cm["Pomodoro & Conserve"], name: "Pomodorino Ciliegino", brand: "", unit: "kg", unitSize: "", packSize: 1, currentStock: 5, minStock: 3, idealStock: 10, location: "Frigo Cucina" },
    { categoryId: cm["Latticini & Formaggi"], name: "Fior di Latte 200g", brand: "", unit: "pz", unitSize: "200g", packSize: 1, currentStock: 30, minStock: 20, idealStock: 60, location: "Frigo 1" },
    { categoryId: cm["Latticini & Formaggi"], name: "Mozzarella di Bufala DOP", brand: "", unit: "pz", unitSize: "200g", packSize: 1, currentStock: 15, minStock: 10, idealStock: 30, location: "Frigo 1" },
    { categoryId: cm["Latticini & Formaggi"], name: "Ricotta Fresca di Pecora", brand: "", unit: "kg", unitSize: "", packSize: 1, currentStock: 3, minStock: 2, idealStock: 6, location: "Frigo 1" },
    { categoryId: cm["Salumi & Affettati"], name: "Salame Piccante Calabrese", brand: "", unit: "pz", unitSize: "200g", packSize: 1, currentStock: 10, minStock: 6, idealStock: 20, location: "Frigo 2" },
    { categoryId: cm["Salumi & Affettati"], name: "Prosciutto Cotto Alta Qualità", brand: "", unit: "kg", unitSize: "", packSize: 1, currentStock: 3, minStock: 2, idealStock: 6, location: "Frigo 2" },
    { categoryId: cm["Salumi & Affettati"], name: "Mortadella IGP", brand: "", unit: "kg", unitSize: "", packSize: 1, currentStock: 2, minStock: 1, idealStock: 4, location: "Frigo 2" },
    { categoryId: cm["Salumi & Affettati"], name: "'Nduja Calabrese", brand: "", unit: "pz", unitSize: "200g", packSize: 1, currentStock: 8, minStock: 4, idealStock: 15, location: "Frigo 2" },
    { categoryId: cm["Verdure & Ortaggi"], name: "Basilico Fresco", brand: "", unit: "mazzo", unitSize: "", packSize: 1, currentStock: 5, minStock: 3, idealStock: 10, location: "Frigo Cucina" },
    { categoryId: cm["Verdure & Ortaggi"], name: "Melanzane", brand: "", unit: "kg", unitSize: "", packSize: 1, currentStock: 6, minStock: 3, idealStock: 10, location: "Dispensa" },
    { categoryId: cm["Oli & Condimenti"], name: "Olio EVO DOP Sicilia", brand: "", unit: "lt", unitSize: "5lt", packSize: 1, currentStock: 5, minStock: 2, idealStock: 8, location: "Dispensa" },
    { categoryId: cm["Oli & Condimenti"], name: "Olio di Semi Frittura", brand: "", unit: "lt", unitSize: "5lt", packSize: 1, currentStock: 4, minStock: 2, idealStock: 8, location: "Dispensa" },
    { categoryId: cm["Oli & Condimenti"], name: "Origano Essiccato", brand: "", unit: "pz", unitSize: "100g", packSize: 1, currentStock: 6, minStock: 3, idealStock: 10, location: "Dispensa" },
    { categoryId: cm["Pesce & Mare"], name: "Acciughe sott'olio", brand: "Rizzoli", unit: "pz", unitSize: "90g", packSize: 1, currentStock: 8, minStock: 4, idealStock: 15, location: "Dispensa" },
    { categoryId: cm["Pesce & Mare"], name: "Capperi sotto sale", brand: "Pantelleria", unit: "pz", unitSize: "200g", packSize: 1, currentStock: 6, minStock: 3, idealStock: 10, location: "Dispensa" },
    { categoryId: cm["Secchi & Dispensa"], name: "Pasta Secca", brand: "De Cecco", unit: "conf", unitSize: "1kg", packSize: 1, currentStock: 10, minStock: 5, idealStock: 20, location: "Dispensa" },
    { categoryId: cm["Secchi & Dispensa"], name: "Caffè in Grani", brand: "Mokarico", unit: "kg", unitSize: "", packSize: 1, currentStock: 3, minStock: 2, idealStock: 6, location: "Bar" },
    { categoryId: cm["Secchi & Dispensa"], name: "Zucchero Semolato", brand: "", unit: "sacco", unitSize: "5kg", packSize: 1, currentStock: 2, minStock: 1, idealStock: 3, location: "Dispensa" },
  ]).run();
}

// ─── Storage Interface ────────────────────────────────────────────────────────
export interface IStorage {
  getUserByUsername(u: string): User | undefined;
  getUserById(id: number): User | undefined;
  getUsers(): User[];
  createUser(d: InsertUser): User;
  updateUser(id: number, d: Partial<InsertUser>): User | undefined;
  deleteUser(id: number): void;
  getCategories(): Category[];
  createCategory(d: InsertCategory): Category;
  updateCategory(id: number, d: Partial<InsertCategory>): Category | undefined;
  deleteCategory(id: number): void;
  getProducts(): Product[];
  getProductById(id: number): Product | undefined;
  getLowStockProducts(): Product[];
  createProduct(d: InsertProduct): Product;
  updateProduct(id: number, d: Partial<InsertProduct>): Product | undefined;
  deleteProduct(id: number): void;
  getMovements(limit?: number): Movement[];
  getMovementsByProduct(productId: number): Movement[];
  getMovementsFiltered(opts: { productId?: number; type?: string; from?: number; to?: number; sheetId?: number }): Movement[];
  addMovement(d: InsertMovement): Movement;
  getStockSummary(): { total: number; low: number; ok: number; outOfStock: number };
  getRecentActivity(limit: number, sheetId?: number): Movement[];

  // ─── Fogli settimanali ────────────────────────────────────────────────────
  getCurrentSheet(): Sheet | undefined;
  getSheetById(id: number): Sheet | undefined;
  getSheets(): Sheet[];
  getSheetRows(sheetId: number): Array<SheetRow & { product: Product; category: Category }>;
  getSheetRow(sheetId: number, productId: number): SheetRow | undefined;
  addSheetMovement(opts: { sheetId: number; productId: number; type: "entrata" | "uscita"; quantity: number; userId: string; note?: string }): { row: SheetRow; movement: Movement };
  addSheetMovementsBatch(items: Array<{ productId: number; type: "entrata" | "uscita"; quantity: number; note?: string }>, opts: { sheetId: number; userId: string }): { rows: SheetRow[]; movements: Movement[] };
  undoSheetMovement(movementId: number, userId: string, opts?: { allowAnyUser?: boolean }): { row: SheetRow; removedMovement: Movement };
  recordCount(sheetId: number, productId: number, count: number): SheetRow;
  closeSheet(sheetId: number, userId: number): { closedSheet: Sheet; newSheet: Sheet };
  ensureCurrentSheet(): Sheet;
  ensureSheetRowsForAllProducts(sheetId: number): void;
}

export const storage: IStorage = {
  getUserByUsername(u) { return db.select().from(users).where(eq(users.username, u)).get(); },
  getUserById(id) { return db.select().from(users).where(eq(users.id, id)).get(); },
  getUsers() { return db.select().from(users).all(); },
  createUser(d) { return db.insert(users).values(d).returning().get(); },
  updateUser(id, d) { return db.update(users).set(d).where(eq(users.id, id)).returning().get(); },
  deleteUser(id) { db.delete(users).where(eq(users.id, id)).run(); },

  getCategories() { return db.select().from(categories).orderBy(categories.sortOrder).all(); },
  createCategory(d) { return db.insert(categories).values(d).returning().get(); },
  updateCategory(id, d) { return db.update(categories).set(d).where(eq(categories.id, id)).returning().get(); },
  deleteCategory(id) { db.delete(categories).where(eq(categories.id, id)).run(); },

  getProducts() { return db.select().from(products).all(); },
  getProductById(id) { return db.select().from(products).where(eq(products.id, id)).get(); },
  getLowStockProducts() {
    return db.select().from(products).where(and(
      eq(products.active, true),
      sql`${products.currentStock} <= ${products.minStock}`
    )).all();
  },
  createProduct(d) { return db.insert(products).values(d).returning().get(); },
  updateProduct(id, d) { return db.update(products).set(d).where(eq(products.id, id)).returning().get(); },
  deleteProduct(id) { db.delete(products).where(eq(products.id, id)).run(); },

  getMovements(limit = 200) { return db.select().from(movements).orderBy(desc(movements.createdAt)).limit(limit).all(); },
  getMovementsByProduct(productId) {
    return db.select().from(movements).where(eq(movements.productId, productId)).orderBy(desc(movements.createdAt)).all();
  },
  getMovementsFiltered({ productId, type, from, to, sheetId }) {
    const conds: any[] = [];
    if (productId) conds.push(eq(movements.productId, productId));
    if (type) conds.push(eq(movements.type, type));
    if (from) conds.push(gte(movements.createdAt, from));
    if (to) conds.push(lte(movements.createdAt, to));
    if (sheetId !== undefined) conds.push(eq(movements.sheetId, sheetId));
    let q = db.select().from(movements) as any;
    if (conds.length > 0) q = q.where(and(...conds));
    return q.orderBy(desc(movements.createdAt)).limit(500).all();
  },
  addMovement(d) {
    const now = Date.now();
    const product = db.select().from(products).where(eq(products.id, d.productId)).get();
    if (!product) throw new Error("Prodotto non trovato");
    const stockBefore = product.currentStock;
    let stockAfter: number;
    if (d.type === "carico") stockAfter = stockBefore + d.quantity;
    else if (d.type === "scarico") stockAfter = Math.max(0, stockBefore - d.quantity);
    else stockAfter = d.quantity;
    db.update(products).set({ currentStock: stockAfter }).where(eq(products.id, d.productId)).run();
    return db.insert(movements).values({ ...d, stockBefore, stockAfter, createdAt: now }).returning().get();
  },

  getStockSummary() {
    const all = db.select().from(products).where(eq(products.active, true)).all();
    const low = all.filter(p => p.currentStock > 0 && p.currentStock <= p.minStock).length;
    const outOfStock = all.filter(p => p.currentStock <= 0).length;
    return { total: all.length, low, ok: all.length - low - outOfStock, outOfStock };
  },
  getRecentActivity(limit, sheetId) {
    if (sheetId !== undefined) {
      return db.select().from(movements)
        .where(eq(movements.sheetId, sheetId))
        .orderBy(desc(movements.createdAt)).limit(limit).all();
    }
    return db.select().from(movements).orderBy(desc(movements.createdAt)).limit(limit).all();
  },

  // ─── Fogli settimanali ────────────────────────────────────────────────────
  getCurrentSheet() {
    // Foglio aperto più recente
    return db.select().from(sheets).where(eq(sheets.status, "open")).orderBy(desc(sheets.startDate)).get();
  },

  getSheetById(id) {
    return db.select().from(sheets).where(eq(sheets.id, id)).get();
  },

  getSheets() {
    return db.select().from(sheets).orderBy(desc(sheets.startDate)).all();
  },

  getSheetRows(sheetId) {
    // Join manuale per restituire product + category denormalizzati.
    // Drizzle non ha tipo nativo per row.product/category, quindi facciamo
    // due query e mergiamo in memoria (numeri di righe sempre piccoli, ~100).
    const rows = db.select().from(sheetRows).where(eq(sheetRows.sheetId, sheetId)).all();
    const allProducts = db.select().from(products).all();
    const allCats = db.select().from(categories).all();
    const prodMap = new Map<number, Product>(allProducts.map(p => [p.id, p]));
    const catMap = new Map<number, Category>(allCats.map(c => [c.id, c]));
    const out: Array<SheetRow & { product: Product; category: Category }> = [];
    for (const r of rows) {
      const product = prodMap.get(r.productId);
      if (!product) continue; // prodotto eliminato: skip
      const category = catMap.get(product.categoryId);
      if (!category) continue;
      out.push({ ...r, product, category });
    }
    return out;
  },

  getSheetRow(sheetId, productId) {
    return db.select().from(sheetRows)
      .where(and(eq(sheetRows.sheetId, sheetId), eq(sheetRows.productId, productId)))
      .get();
  },

  addSheetMovement({ sheetId, productId, type, quantity, userId, note }) {
    // 1. Trova o crea la riga del foglio per il prodotto
    let row = db.select().from(sheetRows)
      .where(and(eq(sheetRows.sheetId, sheetId), eq(sheetRows.productId, productId)))
      .get();
    const product = db.select().from(products).where(eq(products.id, productId)).get();
    if (!product) throw new Error("Prodotto non trovato");

    if (!row) {
      row = db.insert(sheetRows).values({
        sheetId,
        productId,
        initial: product.currentStock,
        entries: 0,
        exits: 0,
        finalCalculated: product.currentStock,
        finalCounted: null,
        notes: "",
      }).returning().get();
    }

    // 2. Aggiorna contatori riga
    let entries = row.entries;
    let exits = row.exits;
    let newStock = product.currentStock;
    if (type === "entrata") {
      entries += quantity;
      newStock = product.currentStock + quantity;
    } else {
      exits += quantity;
      newStock = Math.max(0, product.currentStock - quantity);
    }
    const finalCalculated = row.initial + entries - exits;

    const updatedRow = db.update(sheetRows).set({
      entries,
      exits,
      finalCalculated,
    }).where(eq(sheetRows.id, row.id)).returning().get()!;

    // 3. Aggiorna stock prodotto
    db.update(products).set({ currentStock: newStock }).where(eq(products.id, productId)).run();

    // 4. Inserisce il movimento corrispondente (mappa entrata→carico, uscita→scarico)
    const movementType = type === "entrata" ? "carico" : "scarico";
    const movement = db.insert(movements).values({
      productId,
      type: movementType,
      quantity,
      stockBefore: product.currentStock,
      stockAfter: newStock,
      note: note ?? "",
      userId,
      sheetId,
      createdAt: Date.now(),
    }).returning().get();

    return { row: updatedRow, movement };
  },

  addSheetMovementsBatch(items, { sheetId, userId }) {
    const rows: SheetRow[] = [];
    const movs: Movement[] = [];
    const tx = sqlite.transaction((list: typeof items) => {
      for (const it of list) {
        const res = this.addSheetMovement({
          sheetId,
          productId: it.productId,
          type: it.type,
          quantity: it.quantity,
          userId,
          note: it.note,
        });
        rows.push(res.row);
        movs.push(res.movement);
      }
    });
    tx(items);
    return { rows, movements: movs };
  },

  undoSheetMovement(movementId, userId, opts) {
    const m = db.select().from(movements).where(eq(movements.id, movementId)).get();
    if (!m) throw new Error("Movimento non trovato");
    if (!opts?.allowAnyUser && m.userId !== userId) {
      throw new Error("Puoi annullare solo i tuoi movimenti");
    }
    const sheet = m.sheetId ? db.select().from(sheets).where(eq(sheets.id, m.sheetId)).get() : undefined;
    if (!sheet) throw new Error("Foglio del movimento non trovato");
    if (sheet.status !== "open") throw new Error("Foglio già chiuso, undo non permesso");

    const row = db.select().from(sheetRows)
      .where(and(eq(sheetRows.sheetId, m.sheetId), eq(sheetRows.productId, m.productId)))
      .get();
    if (!row) throw new Error("Riga foglio non trovata");

    // Inverti l'effetto del movimento (carico = entrata, scarico = uscita)
    let entries = row.entries;
    let exits = row.exits;
    if (m.type === "carico") entries = Math.max(0, entries - m.quantity);
    else if (m.type === "scarico") exits = Math.max(0, exits - m.quantity);
    const finalCalculated = row.initial + entries - exits;

    const updatedRow = db.update(sheetRows).set({
      entries,
      exits,
      finalCalculated,
    }).where(eq(sheetRows.id, row.id)).returning().get()!;

    // Allinea stock prodotto: stockAfter del movimento → stockBefore
    db.update(products).set({ currentStock: m.stockBefore }).where(eq(products.id, m.productId)).run();

    // Elimina il movimento
    db.delete(movements).where(eq(movements.id, movementId)).run();

    return { row: updatedRow, removedMovement: m };
  },

  recordCount(sheetId, productId, count) {
    // Registra la conta fisica. Se la riga non esiste la creiamo con initial=stock attuale.
    let row = db.select().from(sheetRows)
      .where(and(eq(sheetRows.sheetId, sheetId), eq(sheetRows.productId, productId)))
      .get();
    if (!row) {
      const product = db.select().from(products).where(eq(products.id, productId)).get();
      if (!product) throw new Error("Prodotto non trovato");
      row = db.insert(sheetRows).values({
        sheetId,
        productId,
        initial: product.currentStock,
        entries: 0,
        exits: 0,
        finalCalculated: product.currentStock,
        finalCounted: count,
        notes: "",
      }).returning().get();
      return row;
    }
    const updated = db.update(sheetRows).set({ finalCounted: count })
      .where(eq(sheetRows.id, row.id))
      .returning().get()!;
    return updated;
  },

  closeSheet(sheetId, userId) {
    const sheet = db.select().from(sheets).where(eq(sheets.id, sheetId)).get();
    if (!sheet) throw new Error("Foglio non trovato");
    if (sheet.status === "closed") throw new Error("Foglio già chiuso");

    // 1. Per ogni riga: se manca la conta fisica, usa il valore calcolato.
    //    Aggiorna lo stock del prodotto col valore "definitivo" (conta fisica).
    const rows = db.select().from(sheetRows).where(eq(sheetRows.sheetId, sheetId)).all();
    for (const r of rows) {
      const finalValue = r.finalCounted ?? r.finalCalculated;
      if (r.finalCounted === null || r.finalCounted === undefined) {
        db.update(sheetRows).set({ finalCounted: finalValue })
          .where(eq(sheetRows.id, r.id)).run();
      }
      // Allinea il magazzino al valore confermato
      db.update(products).set({ currentStock: finalValue })
        .where(eq(products.id, r.productId)).run();
    }

    // 2. Chiude il foglio
    const closedSheet = db.update(sheets).set({
      status: "closed",
      closedAt: Date.now(),
      closedByUserId: userId,
    }).where(eq(sheets.id, sheetId)).returning().get()!;

    // 3. Crea il foglio della settimana successiva
    const nextStart = new Date(sheet.endDate + 1); // 1ms dopo la domenica precedente → lunedì 00:00
    const { start, end } = getWeekRange(nextStart);
    const newSheet = db.insert(sheets).values({
      name: formatWeekName(start, end),
      startDate: start,
      endDate: end,
      status: "open",
      closedAt: null,
      closedByUserId: null,
      notes: "",
    }).returning().get();

    // 4. Popola sheetRows del nuovo foglio con i valori riportati
    const activeProducts = db.select().from(products).where(eq(products.active, true)).all();
    // Mappa per recupero veloce dei valori finali del foglio chiuso
    const closedRowsMap = new Map<number, SheetRow>();
    for (const r of rows) closedRowsMap.set(r.productId, r);
    for (const p of activeProducts) {
      const prev = closedRowsMap.get(p.id);
      const initial = prev ? (prev.finalCounted ?? prev.finalCalculated) : p.currentStock;
      db.insert(sheetRows).values({
        sheetId: newSheet.id,
        productId: p.id,
        initial,
        entries: 0,
        exits: 0,
        finalCalculated: initial,
        finalCounted: null,
        notes: "",
      }).run();
    }

    return { closedSheet, newSheet };
  },

  ensureCurrentSheet() {
    const existing = db.select().from(sheets).where(eq(sheets.status, "open")).orderBy(desc(sheets.startDate)).get();
    if (existing) return existing;
    const { start, end } = getWeekRange(new Date());
    const created = db.insert(sheets).values({
      name: formatWeekName(start, end),
      startDate: start,
      endDate: end,
      status: "open",
      closedAt: null,
      closedByUserId: null,
      notes: "",
    }).returning().get();
    this.ensureSheetRowsForAllProducts(created.id);
    return created;
  },

  ensureSheetRowsForAllProducts(sheetId) {
    const existing = db.select({ pid: sheetRows.productId }).from(sheetRows).where(eq(sheetRows.sheetId, sheetId)).all();
    const existingSet = new Set<number>(existing.map(e => e.pid));
    const activeProducts = db.select().from(products).where(eq(products.active, true)).all();
    for (const p of activeProducts) {
      if (existingSet.has(p.id)) continue;
      db.insert(sheetRows).values({
        sheetId,
        productId: p.id,
        initial: p.currentStock,
        entries: 0,
        exits: 0,
        finalCalculated: p.currentStock,
        finalCounted: null,
        notes: "",
      }).run();
    }
  },
};

// ─── Inizializzazione al boot ─────────────────────────────────────────────────
// Garantisce che esista sempre un foglio aperto per la settimana corrente.
storage.ensureCurrentSheet();

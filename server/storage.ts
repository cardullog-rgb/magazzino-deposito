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
import { hashPassword, verifyPassword, isHashedPassword } from "./crypto-password";

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
    active INTEGER NOT NULL DEFAULT 1,
    must_change_password INTEGER NOT NULL DEFAULT 0
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
ensureColumn("users", "must_change_password", "must_change_password INTEGER NOT NULL DEFAULT 0");

// ─── Migrazione one-time: hasha eventuali password ancora in plain text ──────
// Se l'app è stata aggiornata da una versione precedente con password in
// chiaro, le promuoviamo automaticamente al primo boot.
{
  const rows = sqlite.prepare("SELECT id, password FROM users").all() as Array<{ id: number; password: string }>;
  const update = sqlite.prepare("UPDATE users SET password = ? WHERE id = ?");
  for (const r of rows) {
    if (!isHashedPassword(r.password)) {
      update.run(hashPassword(r.password), r.id);
    }
  }
}

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
// Prima installazione: crea solo l'utente admin iniziale. Nessun prodotto né
// categoria demo: il gestore parte da zero e costruisce il proprio catalogo.
// La password iniziale è "changeme" (o INITIAL_ADMIN_PASSWORD se impostata
// nell'env): deve essere cambiata al primo login (mustChangePassword=true).
const uc = db.select({ c: sql<number>`count(*)` }).from(users).get();
if (!uc || uc.c === 0) {
  const initialPassword = process.env.INITIAL_ADMIN_PASSWORD ?? "changeme";
  db.insert(users).values([
    {
      name: "Admin",
      username: "admin",
      password: hashPassword(initialPassword),
      role: "admin",
      color: "#f97316",
      active: true,
      mustChangePassword: true,
    },
    {
      // Utente "iPad dietro bancone": uno solo, condiviso, usato dallo staff
      // per scarico/carico veloce. Login senza password (quick-login).
      name: "iPad",
      username: "ipad",
      password: hashPassword("ipad"), // valore segnaposto; il login passa per /api/auth/quick-login-ipad
      role: "staff",
      color: "#3b82f6",
      active: true,
      mustChangePassword: false,
    },
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
  createUser(d) {
    // Hasha la password se passata in chiaro
    const payload = { ...d };
    if (payload.password && !isHashedPassword(payload.password)) {
      payload.password = hashPassword(payload.password);
    }
    return db.insert(users).values(payload).returning().get();
  },
  updateUser(id, d) {
    const payload: any = { ...d };
    if (payload.password !== undefined) {
      if (typeof payload.password !== "string" || payload.password.length === 0) {
        delete payload.password; // niente cambio password se vuoto
      } else if (!isHashedPassword(payload.password)) {
        payload.password = hashPassword(payload.password);
        // Cambio esplicito della password → annulla l'obbligo di reset
        if (payload.mustChangePassword === undefined) payload.mustChangePassword = false;
      }
    }
    return db.update(users).set(payload).where(eq(users.id, id)).returning().get();
  },
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

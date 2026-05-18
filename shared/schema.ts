import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// ─── Sezioni magazzino ────────────────────────────────────────────────────────
// "bevande" | "cucina"

// ─── Categorie ────────────────────────────────────────────────────────────────
export const categories = sqliteTable("categories", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  section: text("section").notNull(), // "bevande" | "cucina"
  // Macro-categoria: "analcolici" | "birre" | "alcolici" | "vini" | "cucina"
  macroCategory: text("macro_category").notNull().default(""),
  icon: text("icon").notNull().default("📦"),
  color: text("color").notNull().default("#f97316"),
  sortOrder: integer("sort_order").notNull().default(0),
});

export const insertCategorySchema = createInsertSchema(categories).omit({ id: true });
export type InsertCategory = z.infer<typeof insertCategorySchema>;
export type Category = typeof categories.$inferSelect;

// ─── Prodotti ─────────────────────────────────────────────────────────────────
export const products = sqliteTable("products", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  categoryId: integer("category_id").notNull(),
  name: text("name").notNull(),
  brand: text("brand").notNull().default(""),
  unit: text("unit").notNull().default("pz"),  // pz | cassa | fusto | kg | lt | conf | sacko | rotolo
  unitSize: text("unit_size").notNull().default(""),  // es. "24bt 0.5lt", "30lt", "25kg"
  // Numero di pezzi singoli contenuti in una unità di confezionamento.
  // Es: una cassa di Coca da 33cl ha packSize=24; un fusto ha packSize=1;
  // una bottiglia singola ha packSize=1.
  packSize: real("pack_size").notNull().default(1),
  // Fornitore di riferimento (testo libero)
  supplier: text("supplier").notNull().default(""),
  currentStock: real("current_stock").notNull().default(0),
  minStock: real("min_stock").notNull().default(2),   // soglia alert
  idealStock: real("ideal_stock").notNull().default(5), // quanto riordinare
  location: text("location").notNull().default(""),    // es. "frigo 1", "dispensa", "cantina"
  notes: text("notes").notNull().default(""),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
});

export const insertProductSchema = createInsertSchema(products).omit({ id: true });
export type InsertProduct = z.infer<typeof insertProductSchema>;
export type Product = typeof products.$inferSelect;

// ─── Movimenti (carico / scarico / rettifica) ─────────────────────────────────
export const movements = sqliteTable("movements", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  productId: integer("product_id").notNull(),
  type: text("type").notNull(), // "carico" | "scarico" | "rettifica"
  quantity: real("quantity").notNull(),  // sempre positivo
  stockBefore: real("stock_before").notNull(),
  stockAfter: real("stock_after").notNull(),
  note: text("note").notNull().default(""),
  userId: text("user_id").notNull().default(""),
  // Foglio settimanale di appartenenza (0 = movimento orfano / pre-introduzione fogli)
  sheetId: integer("sheet_id").notNull().default(0),
  createdAt: integer("created_at").notNull().$defaultFn(() => Date.now()),
});

export const insertMovementSchema = createInsertSchema(movements).omit({ id: true, createdAt: true });
export type InsertMovement = z.infer<typeof insertMovementSchema>;
export type Movement = typeof movements.$inferSelect;

// ─── Utenti ───────────────────────────────────────────────────────────────────
export const users = sqliteTable("users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
  role: text("role").notNull().default("staff"), // admin | staff
  color: text("color").notNull().default("#f97316"),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
});

export const insertUserSchema = createInsertSchema(users).omit({ id: true });
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;

// ─── Fogli settimanali ────────────────────────────────────────────────────────
// Ogni foglio rappresenta una settimana (lunedì→domenica). Replica il foglio
// cartaceo: [INIZIALE] [+ ENTRATE] [- USCITE] [= RIMANENZA]. A fine settimana
// la conta fisica (finalCounted) sovrascrive il calcolo teorico (finalCalculated)
// e il valore confermato diventa l'INIZIALE del foglio successivo.
export const sheets = sqliteTable("sheets", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),                          // es "Settimana 18-24 Maggio 2026"
  startDate: integer("start_date").notNull(),            // ts lunedì 00:00
  endDate: integer("end_date").notNull(),                // ts domenica 23:59
  status: text("status").notNull().default("open"),      // "open" | "closed"
  createdAt: integer("created_at").notNull().$defaultFn(() => Date.now()),
  closedAt: integer("closed_at"),                        // nullable
  closedByUserId: integer("closed_by_user_id"),          // nullable
  notes: text("notes").notNull().default(""),
});
export const insertSheetSchema = createInsertSchema(sheets).omit({ id: true, createdAt: true });
export type InsertSheet = z.infer<typeof insertSheetSchema>;
export type Sheet = typeof sheets.$inferSelect;

// ─── Righe di un foglio settimanale (una riga per prodotto) ────────────────────
export const sheetRows = sqliteTable("sheet_rows", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  sheetId: integer("sheet_id").notNull(),
  productId: integer("product_id").notNull(),
  initial: real("initial").notNull().default(0),         // riportato dal foglio precedente
  entries: real("entries").notNull().default(0),         // somma entrate del periodo
  exits: real("exits").notNull().default(0),             // somma uscite del periodo
  finalCalculated: real("final_calculated").notNull().default(0),  // = initial + entries - exits
  finalCounted: real("final_counted"),                   // null finché non chiuso; conta fisica
  notes: text("notes").notNull().default(""),
});
export const insertSheetRowSchema = createInsertSchema(sheetRows).omit({ id: true });
export type InsertSheetRow = z.infer<typeof insertSheetRowSchema>;
export type SheetRow = typeof sheetRows.$inferSelect;

import type { Express, Request, Response, NextFunction } from "express";
import { createServer, type Server } from "http";
import rateLimit from "express-rate-limit";
import { storage } from "./storage";
import { verifyPassword } from "./crypto-password";

// ─── Tipi locali per identificare l'utente sulla request ──────────────────────
// In assenza di session middleware (non ancora wired in index.ts), leggiamo
// l'identità dall'header `x-user-id` inviato dal client dopo il login. Quando
// verrà introdotto express-session, basterà sostituire `requireAuth` per
// leggere `req.session.user` senza toccare gli endpoint.
interface AuthedRequest extends Request {
  authUser?: { id: number; role: string; username: string; name: string };
}

export function registerRoutes(httpServer: Server, app: Express): void {

  // ─── Health check (Railway) ─────────────────────────────────────────────────
  app.get("/api/health", (_req, res) => res.json({ ok: true, ts: Date.now() }));

  // ─── Rate limiting (sicurezza) ──────────────────────────────────────────────
  const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minuti
    max: 20, // max 20 tentativi per IP
    message: { error: "Troppi tentativi. Riprova tra 15 minuti." },
    standardHeaders: true,
    legacyHeaders: false,
  });

  // ─── Middleware autenticazione ─────────────────────────────────────────────
  // requireAuth: pretende un x-user-id valido. requireAdmin: aggiunge il check
  // del ruolo. Sono volutamente semplici: appena introdurremo le sessioni
  // sostituiamo il body senza cambiare i call site.
  const requireAuth = (req: AuthedRequest, res: Response, next: NextFunction): void => {
    const raw = req.header("x-user-id");
    const id = raw ? Number(raw) : NaN;
    if (!raw || Number.isNaN(id)) {
      res.status(401).json({ error: "Autenticazione richiesta" });
      return;
    }
    const user = storage.getUserById(id);
    if (!user || !user.active) {
      res.status(401).json({ error: "Utente non valido" });
      return;
    }
    req.authUser = { id: user.id, role: user.role, username: user.username, name: user.name };
    next();
  };

  const requireAdmin = (req: AuthedRequest, res: Response, next: NextFunction): void => {
    if (!req.authUser || req.authUser.role !== "admin") {
      res.status(403).json({ error: "Privilegi admin richiesti" });
      return;
    }
    next();
  };

  // ─── Auth ──────────────────────────────────────────────────────────────────
  app.post("/api/auth/login", loginLimiter, (req, res) => {
    const { username, password } = req.body ?? {};
    if (!username || !password) return res.status(400).json({ error: "Credenziali mancanti" });
    const user = storage.getUserByUsername(username);
    if (!user || !user.active || !verifyPassword(password, user.password)) {
      return res.status(401).json({ error: "Username o password errati" });
    }
    const { password: _, ...safe } = user;
    res.json(safe);
  });

  // Quick-login dell'iPad dietro bancone: entra come utente "ipad" senza
  // password. Inteso per uso interno su rete LAN. L'admin può disabilitare
  // l'utente "ipad" dalla pagina Utenti per chiudere questa porta.
  app.post("/api/auth/quick-login-ipad", loginLimiter, (_req, res) => {
    const user = storage.getUserByUsername("ipad");
    if (!user || !user.active || user.role !== "staff") {
      return res.status(404).json({ error: "Utente iPad non disponibile" });
    }
    const { password: _, ...safe } = user;
    res.json(safe);
  });

  // Quick-login admin senza password. Uso interno su rete LAN - chiunque puo'
  // accedere al gestionale con pieni poteri. Se serve riattivare la password
  // basta riassegnare al campo password dell'utente admin un hash valido e
  // togliere questa rotta.
  app.post("/api/auth/quick-login-admin", loginLimiter, (_req, res) => {
    const user = storage.getUserByUsername("admin");
    if (!user || !user.active || user.role !== "admin") {
      return res.status(404).json({ error: "Utente admin non disponibile" });
    }
    // Se l'admin era marcato come "must change password" lo liberiamo, cosi
    // non viene rimandato alla schermata di cambio password ad ogni accesso.
    if (user.mustChangePassword) {
      storage.updateUser(user.id, { mustChangePassword: false } as any);
    }
    const fresh = storage.getUserById(user.id)!;
    const { password: _, ...safe } = fresh;
    res.json(safe);
  });

  // Cambio password (anche obbligatorio al primo login).
  app.post("/api/auth/change-password", requireAuth, (req: AuthedRequest, res) => {
    const { currentPassword, newPassword } = req.body ?? {};
    if (!newPassword || typeof newPassword !== "string" || newPassword.length < 6) {
      return res.status(400).json({ error: "La nuova password deve avere almeno 6 caratteri" });
    }
    const user = storage.getUserById(req.authUser!.id);
    if (!user) return res.status(404).json({ error: "Utente non trovato" });
    // Verifica la password attuale (saltabile solo se l'utente è in mustChangePassword)
    if (!user.mustChangePassword) {
      if (!currentPassword || !verifyPassword(currentPassword, user.password)) {
        return res.status(401).json({ error: "Password attuale errata" });
      }
    }
    const updated = storage.updateUser(user.id, {
      password: newPassword,
      mustChangePassword: false,
    } as any);
    if (!updated) return res.status(500).json({ error: "Aggiornamento fallito" });
    const { password: _, ...safe } = updated;
    res.json(safe);
  });

  // ─── Users ─────────────────────────────────────────────────────────────────
  app.get("/api/users", requireAuth, requireAdmin, (_, res) => {
    res.json(storage.getUsers().map(({ password: _, ...u }) => u));
  });
  app.post("/api/users", requireAuth, requireAdmin, (req, res) => {
    const u = storage.createUser(req.body);
    const { password: _, ...safe } = u;
    res.json(safe);
  });
  app.put("/api/users/:id", requireAuth, requireAdmin, (req, res) => {
    const u = storage.updateUser(Number(req.params.id), req.body);
    if (!u) return res.status(404).json({ error: "Utente non trovato" });
    const { password: _, ...safe } = u;
    res.json(safe);
  });
  app.delete("/api/users/:id", requireAuth, requireAdmin, (req, res) => {
    storage.deleteUser(Number(req.params.id));
    res.json({ ok: true });
  });

  // ─── Categories ────────────────────────────────────────────────────────────
  app.get("/api/categories", (_, res) => res.json(storage.getCategories()));
  app.post("/api/categories", requireAuth, requireAdmin, (req, res) => res.json(storage.createCategory(req.body)));
  app.put("/api/categories/:id", requireAuth, requireAdmin, (req, res) => {
    const c = storage.updateCategory(Number(req.params.id), req.body);
    if (!c) return res.status(404).json({ error: "Not found" });
    res.json(c);
  });
  app.delete("/api/categories/:id", requireAuth, requireAdmin, (req, res) => {
    storage.deleteCategory(Number(req.params.id));
    res.json({ ok: true });
  });

  // ─── Products ──────────────────────────────────────────────────────────────
  app.get("/api/products", (_, res) => res.json(storage.getProducts()));
  app.get("/api/products/low-stock", (_, res) => res.json(storage.getLowStockProducts()));
  app.get("/api/products/:id", (req, res) => {
    const p = storage.getProductById(Number(req.params.id));
    if (!p) return res.status(404).json({ error: "Prodotto non trovato" });
    res.json(p);
  });
  app.post("/api/products", requireAuth, requireAdmin, (req, res) => res.json(storage.createProduct(req.body)));
  app.put("/api/products/:id", requireAuth, requireAdmin, (req, res) => {
    const p = storage.updateProduct(Number(req.params.id), req.body);
    if (!p) return res.status(404).json({ error: "Not found" });
    res.json(p);
  });
  app.delete("/api/products/:id", requireAuth, requireAdmin, (req, res) => {
    storage.deleteProduct(Number(req.params.id));
    res.json({ ok: true });
  });

  // ─── Movements ─────────────────────────────────────────────────────────────
  // Default: limita al foglio corrente (così Dashboard/UI live mostrano solo
  // la settimana aperta). Per vedere tutto lo storico passare `sheetId=all`,
  // o uno specifico `sheetId=<n>` per i fogli chiusi.
  app.get("/api/movements", (req, res) => {
    const { productId, type, from, to, limit, sheetId } = req.query;
    let resolvedSheetId: number | undefined;
    if (sheetId === "all") resolvedSheetId = undefined;
    else if (sheetId !== undefined) resolvedSheetId = Number(sheetId);
    else resolvedSheetId = storage.getCurrentSheet()?.id;

    if (productId || type || from || to || resolvedSheetId !== undefined) {
      return res.json(storage.getMovementsFiltered({
        productId: productId ? Number(productId) : undefined,
        type: type as string | undefined,
        from: from ? Number(from) : undefined,
        to: to ? Number(to) : undefined,
        sheetId: resolvedSheetId,
      }));
    }
    res.json(storage.getMovements(limit ? Number(limit) : 200));
  });

  app.get("/api/movements/product/:id", (req, res) => {
    res.json(storage.getMovementsByProduct(Number(req.params.id)));
  });

  app.post("/api/movements", (req, res) => {
    try {
      const movement = storage.addMovement(req.body);
      res.json(movement);
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  // ─── Stats ─────────────────────────────────────────────────────────────────
  app.get("/api/stats/summary", (_, res) => res.json(storage.getStockSummary()));
  app.get("/api/stats/activity", (req, res) => {
    // Default: solo movimenti del foglio corrente (la Dashboard si pulisce
    // automaticamente alla chiusura settimanale). `sheetId=all` per tutto.
    const { sheetId } = req.query;
    let resolvedSheetId: number | undefined;
    if (sheetId === "all") resolvedSheetId = undefined;
    else if (sheetId !== undefined) resolvedSheetId = Number(sheetId);
    else resolvedSheetId = storage.getCurrentSheet()?.id;
    res.json(storage.getRecentActivity(Number(req.query.limit ?? 20), resolvedSheetId));
  });

  // ─── Sheets (fogli settimanali) ────────────────────────────────────────────
  // Foglio aperto corrente con righe denormalizzate (product + category).
  app.get("/api/sheet/current", (_req, res) => {
    const sheet = storage.getCurrentSheet();
    if (!sheet) return res.status(404).json({ error: "Nessun foglio aperto" });
    // Allinea le righe a tutti i prodotti attivi (può aggiungerne se ne sono
    // stati creati di nuovi dopo l'apertura del foglio).
    storage.ensureSheetRowsForAllProducts(sheet.id);
    const rows = storage.getSheetRows(sheet.id);
    res.json({ sheet, rows });
  });

  // Storico fogli (dal più recente).
  app.get("/api/sheets", (_req, res) => res.json(storage.getSheets()));

  // Dettaglio di un singolo foglio.
  app.get("/api/sheet/:id", (req, res) => {
    const id = Number(req.params.id);
    const sheet = storage.getSheetById(id);
    if (!sheet) return res.status(404).json({ error: "Foglio non trovato" });
    const rows = storage.getSheetRows(id);
    res.json({ sheet, rows });
  });

  // Registra entrata o uscita sul foglio aperto corrente.
  app.post("/api/sheet/movement", requireAuth, (req: AuthedRequest, res) => {
    const { productId, type, quantity, note } = req.body ?? {};
    if (!["entrata", "uscita"].includes(type)) return res.status(400).json({ error: "type non valido" });
    if (!productId || !quantity || quantity <= 0) return res.status(400).json({ error: "Dati invalidi" });
    const sheet = storage.getCurrentSheet();
    if (!sheet) return res.status(400).json({ error: "Nessun foglio aperto" });
    try {
      const result = storage.addSheetMovement({
        sheetId: sheet.id,
        productId: Number(productId),
        type,
        quantity: Number(quantity),
        userId: String(req.authUser!.id),
        note,
      });
      res.json(result);
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  // Registra più movimenti in batch (usato dal Carico e dal carico da scansione).
  app.post("/api/sheet/movements/batch", requireAuth, (req: AuthedRequest, res) => {
    const { items } = req.body ?? {};
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: "Nessun movimento da registrare" });
    }
    for (const it of items) {
      if (!it.productId || !["entrata", "uscita"].includes(it.type) || !it.quantity || it.quantity <= 0) {
        return res.status(400).json({ error: "Riga batch invalida" });
      }
    }
    const sheet = storage.getCurrentSheet();
    if (!sheet) return res.status(400).json({ error: "Nessun foglio aperto" });
    try {
      const result = storage.addSheetMovementsBatch(items, {
        sheetId: sheet.id,
        userId: String(req.authUser!.id),
      });
      res.json(result);
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  // Annulla un movimento (solo se utente proprietario o admin, e foglio ancora aperto).
  app.post("/api/sheet/movement/undo", requireAuth, (req: AuthedRequest, res) => {
    const { movementId } = req.body ?? {};
    if (!movementId) return res.status(400).json({ error: "movementId richiesto" });
    try {
      const result = storage.undoSheetMovement(
        Number(movementId),
        String(req.authUser!.id),
        { allowAnyUser: req.authUser!.role === "admin" },
      );
      res.json(result);
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  // Registra conta fisica per un prodotto sul foglio corrente.
  app.post("/api/sheet/count", requireAuth, (req: AuthedRequest, res) => {
    const { productId, count } = req.body ?? {};
    if (!productId || count === undefined || count === null) {
      return res.status(400).json({ error: "Dati invalidi" });
    }
    const sheet = storage.getCurrentSheet();
    if (!sheet) return res.status(400).json({ error: "Nessun foglio aperto" });
    try {
      const row = storage.recordCount(sheet.id, Number(productId), Number(count));
      res.json(row);
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  // Chiude il foglio corrente, calcola riporti e apre la settimana successiva.
  app.post("/api/sheet/close", requireAuth, requireAdmin, (req: AuthedRequest, res) => {
    const sheet = storage.getCurrentSheet();
    if (!sheet) return res.status(400).json({ error: "Nessun foglio aperto" });
    try {
      const result = storage.closeSheet(sheet.id, req.authUser!.id);
      res.json(result);
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });
}

export async function setupRoutes(app: Express): Promise<Server> {
  const httpServer = createServer(app);
  registerRoutes(httpServer, app);
  return httpServer;
}

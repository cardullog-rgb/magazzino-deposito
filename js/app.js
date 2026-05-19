// Stato Alpine — versione semplificata.
// Una sola interfaccia per tutti. L'admin (PIN) sblocca solo:
//  - la visibilità dei prezzi (costo + vendita) nelle card e nel form prodotto
//  - l'accesso alla tab Impostazioni (backup, PIN, timeout, azzera)
// Tutto il resto (modificare prodotti, scorte, soglie, categorie, fornitori,
// annullare movimenti) è disponibile a tutti.

import {
  openDb, seedIfEmpty,
  getAll, get, put, remove, clear, bulkPut,
  getSetting, setSetting,
  recordMovement, undoMovement, newId,
} from './db.js';
import {
  hasPin, setPin, verifyPin,
  startInactivityTimer, stopInactivityTimer, remainingMs,
} from './auth.js';
import {
  exportBackup, exportMovementsCsv, exportShoppingListCsv, restoreFromJson,
} from './export.js';
import { lowStock } from './reports.js';

const DAY_MS = 24 * 60 * 60 * 1000;

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function todayKey() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function formatPrice(v) {
  const n = Number(v) || 0;
  return n.toLocaleString('it-IT', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2 });
}

export function initApp() {
  return {
    // ====== Stato ======
    ready: false,
    setupMode: false,

    // Sblocco admin: gated solo i prezzi e la tab Impostazioni
    adminUnlocked: false,
    adminRemainingSec: 0,
    _countdownTimer: null,

    // Vista corrente
    view: 'products', // 'products' | 'storico' | 'avvisi' | 'fornitori' | 'impostazioni'
    activeCategory: 'acque',

    theme: 'dark',

    dayClosed: false,
    lastCloseSummary: null,
    closeConfirmOpen: false,
    dayStartedAt: 0,

    categories: [],
    products: [],
    movements: [],
    suppliers: [],

    inactivityTimeoutMs: 120000,
    showBackupReminder: false,

    // Ricerca
    searchQuery: '',
    searchOpen: false,

    // Dialog quantità
    qtyDialog: { open: false, product: null, qty: 1, mode: 'out' },

    // Pulse animation
    pulseState: {},

    // Toast
    toasts: [],

    // Dialog PIN
    pinDialog: { open: false, mode: 'login', step: 1, value: '', confirm: '', error: '' },

    // Dialog prodotto
    productDialog: {
      open: false, isNew: true, original: null,
      form: {
        id: '', name: '', category: '', unit: 'bottiglia',
        currentStock: 0, minThreshold: 2, costPrice: 0, salePrice: 0,
        supplierId: '',
      }
    },

    // Dialog fornitore
    supplierDialog: {
      open: false, isNew: true,
      form: { id: '', name: '', phone: '', email: '', note: '' }
    },

    // Conferma generica
    confirmDialog: { open: false, title: '', message: '', onConfirm: null, danger: false },

    // Gestione categorie
    categoryManager: { open: false },
    categoryDialog: {
      open: false, isNew: true, original: null,
      form: { id: '', name: '', icon: '' },
    },

    // Filtri movimenti
    movementFilter: { productId: '', days: 7 },

    // ====== Init ======
    async init() {
      await openDb();
      await this.loadTheme();
      await seedIfEmpty();
      this.inactivityTimeoutMs = await getSetting('inactivityTimeoutMs', 120000);
      await this.reloadAll();
      await this._loadDayCloseState();
      const pinExists = await hasPin();
      if (!pinExists) {
        this.setupMode = true;
        this.pinDialog = { open: true, mode: 'setup', step: 1, value: '', confirm: '', error: '' };
      }
      this.ready = true;
      this._checkBackupReminder();
      this._scheduleMidnightCheck();
    },

    // ====== Theme ======
    async loadTheme() {
      let t = await getSetting('theme', null);
      if (!t) {
        try {
          t = window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
        } catch { t = 'dark'; }
      }
      this.theme = t;
      document.documentElement.dataset.theme = t;
    },
    async toggleTheme() {
      this.theme = this.theme === 'dark' ? 'light' : 'dark';
      document.documentElement.dataset.theme = this.theme;
      await setSetting('theme', this.theme);
    },

    // ====== Chiusura giornata ======
    async _loadDayCloseState() {
      const today = todayKey();
      const todayClose = await get('dailyCloses', today);
      this.dayStartedAt = await getSetting('dayStartedAt', 0);
      const advancedPast = todayClose && this.dayStartedAt > todayClose.closedAt;
      this.dayClosed = !!todayClose && !advancedPast;
      this.lastCloseSummary = todayClose || null;

      const lastSeen = await getSetting('lastSeenDate', null);
      if (lastSeen && lastSeen !== today && !this.dayClosed) {
        const prevClose = await get('dailyCloses', lastSeen);
        if (prevClose) {
          setTimeout(() => {
            this._pushToast({
              kind: 'info',
              qtyLabel: '☀',
              productName: 'Buongiorno · nuova giornata aperta',
            });
          }, 400);
        }
      }
      await setSetting('lastSeenDate', today);
    },

    _scheduleMidnightCheck() {
      const now = new Date();
      const next = new Date(now);
      next.setHours(0, 0, 5, 0);
      if (next <= now) next.setDate(next.getDate() + 1);
      const ms = next - now;
      setTimeout(async () => {
        await this._loadDayCloseState();
        this._scheduleMidnightCheck();
      }, ms);
    },

    askCloseDay() { this.closeConfirmOpen = true; },
    cancelCloseDay() { this.closeConfirmOpen = false; },

    async confirmCloseDay() {
      const date = todayKey();
      const start = startOfToday();
      const todayMovs = this.movements.filter((m) => m.timestamp >= start);
      const summary = {
        date,
        closedAt: Date.now(),
        out: this.todayStats.out,
        in: this.todayStats.in,
        lowCount: this.countLow,
        movementCount: todayMovs.length,
        stockSnapshot: this.products
          .filter((p) => !p.archived)
          .map((p) => ({ id: p.id, name: p.name, stock: p.currentStock, unit: p.unit, category: p.category })),
      };
      try {
        await put('dailyCloses', summary);
        const saved = await get('dailyCloses', date);
        if (!saved) throw new Error('Record non trovato dopo il salvataggio');
      } catch (err) {
        this.closeConfirmOpen = false;
        alert('Errore salvataggio chiusura giornata: ' + err.message);
        return;
      }
      this.closeConfirmOpen = false;
      this.dayClosed = true;
      this.lastCloseSummary = summary;
      await this._loadDayCloseState();
      this._pushToast({ kind: 'info', qtyLabel: '✓', productName: 'Giornata registrata' });
    },

    async startNewDay() {
      const now = Date.now();
      await setSetting('dayStartedAt', now);
      this.dayStartedAt = now;
      this.dayClosed = false;
      await this._loadDayCloseState();
    },

    async undoCloseDay() {
      const date = todayKey();
      await remove('dailyCloses', date);
      this.dayClosed = false;
      this.lastCloseSummary = null;
      await this._loadDayCloseState();
    },

    formatCloseDate(dateStr) {
      const d = new Date(dateStr + 'T12:00:00');
      return d.toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    },

    async reloadAll() {
      const [cats, prods, mvs, sups] = await Promise.all([
        getAll('categories'), getAll('products'), getAll('movements'), getAll('suppliers'),
      ]);
      this.categories = cats.sort((a, b) => a.order - b.order);
      this.products = prods;
      this.movements = mvs.sort((a, b) => b.timestamp - a.timestamp);
      this.suppliers = sups;
      if (!this.categories.find((c) => c.id === this.activeCategory) && this.categories[0]) {
        this.activeCategory = this.categories[0].id;
      }
    },

    async _checkBackupReminder() {
      const last = await getSetting('lastExportAt', 0);
      this.showBackupReminder = last && (Date.now() - last) > 7 * DAY_MS;
    },

    // ====== Date labels ======
    get todayLabel() {
      const d = new Date();
      return d.toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long' });
    },
    get todayLabelShort() {
      const d = new Date();
      const wd = d.toLocaleDateString('it-IT', { weekday: 'short' }).replace('.', '');
      const day = d.getDate();
      const mon = d.toLocaleDateString('it-IT', { month: 'short' }).replace('.', '');
      return `${wd} ${day} ${mon}`;
    },

    formatPrice,

    // ====== Derived ======
    get visibleProducts() {
      return this.products
        .filter((p) => !p.archived && p.category === this.activeCategory)
        .sort((a, b) => (a.order ?? 9999) - (b.order ?? 9999) || a.name.localeCompare(b.name, 'it'));
    },

    get allActiveProducts() {
      return this.products
        .filter((p) => !p.archived)
        .sort((a, b) => (a.order ?? 9999) - (b.order ?? 9999) || a.name.localeCompare(b.name, 'it'));
    },

    get searchResults() {
      const q = this.searchQuery.trim().toLowerCase();
      if (!q) return [];
      return this.products
        .filter((p) => !p.archived && p.name.toLowerCase().includes(q))
        .slice(0, 8);
    },

    get lowStockProducts() { return lowStock(this.products); },
    get countLow() { return this.lowStockProducts.length; },
    get visibleLowCount() { return this.visibleProducts.filter((p) => this.isLow(p)).length; },

    get countLowByCategory() {
      const map = {};
      for (const p of this.lowStockProducts) map[p.category] = (map[p.category] || 0) + 1;
      return map;
    },

    get activeCategoryObj() {
      return this.categories.find((c) => c.id === this.activeCategory);
    },

    get dayStart() {
      return Math.max(this.dayStartedAt || 0, startOfToday());
    },

    get todayStats() {
      const start = this.dayStart;
      let out = 0, inn = 0;
      for (const m of this.movements) {
        if (m.timestamp < start) continue;
        if (m.type === 'out') out += m.quantity;
        else if (m.type === 'in') inn += m.quantity;
      }
      return { out, in: inn };
    },

    productById(id) { return this.products.find((p) => p.id === id); },
    categoryById(id) { return this.categories.find((c) => c.id === id); },
    supplierById(id) { return this.suppliers.find((s) => s.id === id); },

    isLow(prod) { return prod.currentStock <= (prod.minThreshold || 0); },

    formatTimestamp(ts) {
      return new Date(ts).toLocaleString('it-IT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
    },

    jumpToFirstLow() {
      const firstLow = this.lowStockProducts[0];
      if (firstLow) { this.view = 'products'; this.activeCategory = firstLow.category; }
    },

    _triggerPulse(productId, kind) {
      this.pulseState = { ...this.pulseState, [productId]: kind };
      setTimeout(() => {
        const ns = { ...this.pulseState };
        delete ns[productId];
        this.pulseState = ns;
      }, 600);
    },

    // ====== Dialog quantità ======
    openQty(product, mode = 'out') {
      this.qtyDialog = { open: true, product, qty: 1, mode };
    },
    qtyAdd(n) { this.qtyDialog.qty = Math.max(1, this.qtyDialog.qty + n); },
    qtySet(n) { this.qtyDialog.qty = Math.max(1, n); },
    qtyCancel() { this.qtyDialog.open = false; },

    async qtyConfirm() {
      const { product, qty, mode } = this.qtyDialog;
      if (!product || qty < 1) return;
      const mv = await recordMovement({
        productId: product.id, quantity: qty, type: mode,
        userMode: this.adminUnlocked ? 'admin' : 'staff',
      });
      this.qtyDialog.open = false;
      this._triggerPulse(product.id, mode === 'out' ? 'minus' : 'plus');
      await this.reloadAll();
      this._pushToast({
        kind: mode,
        qtyLabel: (mode === 'out' ? '−' : '+') + qty + ' ' + product.unit,
        productName: product.name,
        movementId: mv.id,
      });
    },

    // ====== Toast ======
    _pushToast(opts) {
      const id = newId();
      const toast = {
        id,
        kind: opts.kind || 'info',
        qtyLabel: opts.qtyLabel || '',
        productName: opts.productName || '',
        movementId: opts.movementId || null,
        timer: null,
      };
      toast.timer = setTimeout(() => this._dismissToast(id), 10000);
      this.toasts.push(toast);
      while (this.toasts.length > 4) {
        const old = this.toasts.shift();
        if (old.timer) clearTimeout(old.timer);
      }
    },
    _dismissToast(id) {
      const idx = this.toasts.findIndex((t) => t.id === id);
      if (idx >= 0) {
        if (this.toasts[idx].timer) clearTimeout(this.toasts[idx].timer);
        this.toasts.splice(idx, 1);
      }
    },
    async undoToast(toast) {
      if (toast.movementId) await undoMovement(toast.movementId);
      this._dismissToast(toast.id);
      await this.reloadAll();
    },

    // ====== Search ======
    pickSearchResult(prod) {
      this.searchQuery = '';
      this.searchOpen = false;
      this.view = 'products';
      this.activeCategory = prod.category;
      this.openQty(prod, 'out');
    },

    // ====== PIN / admin ======
    openPinLogin() {
      this.pinDialog = { open: true, mode: 'login', step: 1, value: '', confirm: '', error: '' };
    },
    pinDigit(d) {
      const max = 6;
      const key = this.pinDialog.step === 1 ? 'value' : 'confirm';
      if (this.pinDialog[key].length < max) this.pinDialog[key] += String(d);
      this.pinDialog.error = '';
    },
    pinBackspace() {
      const key = this.pinDialog.step === 1 ? 'value' : 'confirm';
      this.pinDialog[key] = this.pinDialog[key].slice(0, -1);
    },
    pinClear() {
      const key = this.pinDialog.step === 1 ? 'value' : 'confirm';
      this.pinDialog[key] = '';
    },
    async pinSubmit() {
      const d = this.pinDialog;
      if (d.mode === 'setup') {
        if (d.step === 1) {
          if (d.value.length < 4) { d.error = 'Inserisci almeno 4 cifre.'; return; }
          d.step = 2;
          return;
        }
        if (d.confirm !== d.value) { d.error = 'I PIN non coincidono.'; d.confirm = ''; return; }
        try {
          await setPin(d.value);
          this.pinDialog.open = false;
          this.setupMode = false;
        } catch (e) { d.error = e.message; }
        return;
      }
      if (d.mode === 'change') {
        if (d.step === 1) {
          const ok = await verifyPin(d.value);
          if (!ok) { d.error = 'PIN errato.'; d.value = ''; return; }
          d.step = 2; d.value = ''; return;
        }
        if (d.step === 2) {
          if (d.value.length < 4) { d.error = 'Almeno 4 cifre.'; return; }
          d.step = 3; return;
        }
        if (d.confirm !== d.value) { d.error = 'I PIN non coincidono.'; d.confirm = ''; return; }
        await setPin(d.value);
        this.pinDialog.open = false;
        this._pushToast({ kind: 'info', qtyLabel: '✓', productName: 'PIN aggiornato' });
        return;
      }
      // login
      const ok = await verifyPin(d.value);
      if (!ok) { d.error = 'PIN errato.'; d.value = ''; return; }
      this.pinDialog.open = false;
      this.enterAdmin();
    },
    pinCancel() { this.pinDialog.open = false; },

    enterAdmin() {
      this.adminUnlocked = true;
      this._startAdminTimer();
    },

    exitAdmin() {
      this.adminUnlocked = false;
      if (this.view === 'impostazioni') this.view = 'products';
      stopInactivityTimer();
      if (this._countdownTimer) { clearInterval(this._countdownTimer); this._countdownTimer = null; }
      this.adminRemainingSec = 0;
    },

    _startAdminTimer() {
      startInactivityTimer(this.inactivityTimeoutMs, () => this.exitAdmin());
      if (this._countdownTimer) clearInterval(this._countdownTimer);
      this._countdownTimer = setInterval(() => {
        this.adminRemainingSec = Math.ceil(remainingMs() / 1000);
        if (!this.adminUnlocked) {
          clearInterval(this._countdownTimer);
          this._countdownTimer = null;
        }
      }, 500);
    },

    openChangePin() {
      this.pinDialog = { open: true, mode: 'change', step: 1, value: '', confirm: '', error: '' };
    },

    // ====== Prodotti ======
    openNewProduct() {
      this.productDialog = {
        open: true, isNew: true, original: null,
        form: {
          id: '', name: '', category: this.activeCategory || this.categories[0]?.id || '',
          unit: 'bottiglia', currentStock: 0, minThreshold: 2,
          costPrice: 0, salePrice: 0, supplierId: '',
        },
      };
    },
    openEditProduct(prod) {
      this.productDialog = {
        open: true, isNew: false, original: prod,
        form: {
          id: prod.id, name: prod.name, category: prod.category,
          unit: prod.unit, currentStock: prod.currentStock || 0,
          minThreshold: prod.minThreshold || 0,
          costPrice: prod.costPrice || 0,
          salePrice: prod.salePrice || 0,
          supplierId: prod.supplierId || '',
        },
      };
    },
    async saveProduct() {
      const f = this.productDialog.form;
      if (!f.name.trim()) return;
      const slug = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
        .replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
      const id = this.productDialog.isNew ? slug(f.name) || newId() : f.id;
      const existing = this.productDialog.isNew ? await get('products', id) : null;
      const finalId = existing ? id + '-' + Date.now().toString(36) : id;
      const orderForNew = (() => {
        const same = this.products.filter((p) => p.category === f.category);
        const max = same.reduce((m, p) => Math.max(m, p.order ?? 0), 0);
        return max + 1;
      })();
      const orig = this.productDialog.original;
      const product = {
        id: finalId,
        name: f.name.trim(),
        category: f.category,
        unit: f.unit,
        currentStock: Number(f.currentStock) || 0,
        minThreshold: Number(f.minThreshold) || 0,
        // Se l'utente non è admin, preserva i prezzi esistenti senza modificarli
        costPrice: this.adminUnlocked ? (Number(f.costPrice) || 0) : (orig?.costPrice || 0),
        salePrice: this.adminUnlocked ? (Number(f.salePrice) || 0) : (orig?.salePrice || 0),
        supplierId: f.supplierId || null,
        archived: false,
        order: this.productDialog.isNew
          ? orderForNew
          : (orig?.order ?? orderForNew),
      };
      await put('products', product);
      this.productDialog.open = false;
      await this.reloadAll();
    },
    archiveProduct(prod) {
      this.confirmDialog = {
        open: true, danger: true,
        title: 'Archiviare prodotto?',
        message: `"${prod.name}" verrà nascosto. I movimenti restano salvati.`,
        onConfirm: async () => {
          await put('products', { ...prod, archived: true });
          this.confirmDialog.open = false;
          this.productDialog.open = false;
          await this.reloadAll();
        },
      };
    },

    // ====== Movimenti ======
    get filteredMovements() {
      const { productId, days } = this.movementFilter;
      const cutoff = Date.now() - days * DAY_MS;
      return this.movements.filter((m) => {
        if (m.timestamp < cutoff) return false;
        if (productId && m.productId !== productId) return false;
        return true;
      });
    },
    async deleteMovement(mv) {
      this.confirmDialog = {
        open: true, danger: true,
        title: 'Annullare movimento?',
        message: `"${mv.productName}" — questa azione ripristina la scorta.`,
        onConfirm: async () => {
          await undoMovement(mv.id);
          this.confirmDialog.open = false;
          await this.reloadAll();
        },
      };
    },
    exportMovementsCsv() {
      exportMovementsCsv(this.filteredMovements);
    },

    // ====== Fornitori ======
    openNewSupplier() {
      this.supplierDialog = { open: true, isNew: true, form: { id: '', name: '', phone: '', email: '', note: '' } };
    },
    openEditSupplier(s) {
      this.supplierDialog = { open: true, isNew: false, form: { ...s } };
    },
    async saveSupplier() {
      const f = this.supplierDialog.form;
      if (!f.name.trim()) return;
      const id = f.id || newId();
      await put('suppliers', { id, name: f.name.trim(), phone: f.phone, email: f.email, note: f.note });
      this.supplierDialog.open = false;
      await this.reloadAll();
    },
    deleteSupplier(s) {
      this.confirmDialog = {
        open: true, danger: true,
        title: 'Eliminare fornitore?',
        message: `"${s.name}" verrà rimosso. I prodotti associati resteranno senza fornitore.`,
        onConfirm: async () => {
          for (const p of this.products) {
            if (p.supplierId === s.id) await put('products', { ...p, supplierId: null });
          }
          await remove('suppliers', s.id);
          this.confirmDialog.open = false;
          await this.reloadAll();
        },
      };
    },

    // ====== Lista spesa ======
    get shoppingList() {
      const items = this.lowStockProducts.map((p) => {
        const sup = this.supplierById(p.supplierId);
        const target = Math.max((p.minThreshold || 0) * 2, (p.minThreshold || 0) + 1);
        const toOrder = Math.max(1, target - p.currentStock);
        return {
          productId: p.id, productName: p.name, unit: p.unit,
          currentStock: p.currentStock, minThreshold: p.minThreshold,
          supplierId: p.supplierId, supplierName: sup ? sup.name : null,
          toOrder,
        };
      });
      const groups = {};
      for (const it of items) {
        const key = it.supplierName || '— senza fornitore —';
        if (!groups[key]) groups[key] = [];
        groups[key].push(it);
      }
      return groups;
    },
    exportShoppingList() {
      const flat = [];
      for (const [, items] of Object.entries(this.shoppingList)) flat.push(...items);
      if (!flat.length) return;
      exportShoppingListCsv(flat);
    },

    // ====== Backup / Restore / Settings ======
    async doExportBackup() {
      await exportBackup();
      this.showBackupReminder = false;
      this._pushToast({ kind: 'info', qtyLabel: '✓', productName: 'Backup esportato' });
    },
    triggerImport() { this.$refs.importInput.click(); },
    async handleImport(e) {
      const file = e.target.files[0];
      if (!file) return;
      const text = await file.text();
      e.target.value = '';
      this.confirmDialog = {
        open: true, danger: true,
        title: 'Ripristinare backup?',
        message: 'Tutti i dati attuali (prodotti, movimenti, fornitori) verranno sovrascritti.',
        onConfirm: async () => {
          try {
            await restoreFromJson(text);
            this.confirmDialog.open = false;
            await this.reloadAll();
            this._pushToast({ kind: 'info', qtyLabel: '✓', productName: 'Backup ripristinato' });
          } catch (err) {
            this.confirmDialog.open = false;
            alert('Errore: ' + err.message);
          }
        },
      };
    },
    resetAllData() {
      this.confirmDialog = {
        open: true, danger: true,
        title: 'Azzerare tutti i dati?',
        message: 'Verranno cancellati prodotti, categorie, movimenti, fornitori e chiusure giornaliere. Il PIN admin e le impostazioni restano. L\'app verrà ripopolata con il catalogo iniziale.',
        onConfirm: async () => {
          try {
            await clear('movements');
            await clear('dailyCloses');
            await clear('suppliers');
            await clear('products');
            await clear('categories');
            await seedIfEmpty();
            this.confirmDialog.open = false;
            await this.reloadAll();
            this._pushToast({ kind: 'info', qtyLabel: '✓', productName: 'Dati azzerati' });
          } catch (err) {
            this.confirmDialog.open = false;
            alert('Errore: ' + err.message);
          }
        },
      };
    },

    async updateTimeout(seconds) {
      const ms = Math.max(30000, Math.min(600000, Number(seconds) * 1000));
      this.inactivityTimeoutMs = ms;
      await setSetting('inactivityTimeoutMs', ms);
      if (this.adminUnlocked) this._startAdminTimer();
    },

    // ====== Categorie ======
    openCategoryManager() {
      this.categoryManager.open = true;
      this.$nextTick(() => this._initCategoryManagerSortable());
    },
    closeCategoryManager() {
      if (this._catSortable) { this._catSortable.destroy(); this._catSortable = null; }
      this.categoryManager.open = false;
    },
    _initCategoryManagerSortable() {
      const list = document.querySelector('.cat-manager-list');
      if (!list || typeof Sortable === 'undefined') return;
      if (this._catSortable) this._catSortable.destroy();
      this._catSortable = Sortable.create(list, {
        animation: 150,
        delay: 200,
        delayOnTouchOnly: true,
        handle: '.drag-handle',
        draggable: '.cat-manager-row',
        onEnd: () => {
          const ids = Array.from(list.querySelectorAll('.cat-manager-row[data-cat-id]'))
            .map((n) => n.dataset.catId);
          this._applyCategoryOrder(ids);
        },
      });
    },
    async _applyCategoryOrder(idsInOrder) {
      const updates = [];
      idsInOrder.forEach((id, i) => {
        const c = this.categories.find((x) => x.id === id);
        if (!c) return;
        const newOrder = i + 1;
        if (c.order !== newOrder) {
          c.order = newOrder;
          updates.push(c);
        }
      });
      if (updates.length === 0) return;
      await bulkPut('categories', updates);
      this.categories = [...this.categories];
    },
    openNewCategory() {
      this.categoryDialog = {
        open: true, isNew: true, original: null,
        form: { id: '', name: '', icon: '📦' },
      };
    },
    openEditCategory(cat) {
      this.categoryDialog = {
        open: true, isNew: false, original: cat,
        form: { id: cat.id, name: cat.name, icon: cat.icon || '' },
      };
    },
    async saveCategory() {
      const f = this.categoryDialog.form;
      const name = (f.name || '').trim();
      if (!name) return;
      const slugify = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
        .replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
      if (this.categoryDialog.isNew) {
        let id = slugify(name) || ('cat-' + Date.now().toString(36));
        if (this.categories.some((c) => c.id === id)) id = id + '-' + Date.now().toString(36);
        const maxOrder = this.categories.reduce((m, c) => Math.max(m, c.order || 0), 0);
        await put('categories', {
          id, name, icon: f.icon || '📦', order: maxOrder + 1,
        });
      } else {
        const orig = this.categoryDialog.original;
        await put('categories', { ...orig, name, icon: f.icon || orig.icon || '📦' });
      }
      this.categoryDialog.open = false;
      await this.reloadAll();
    },
    deleteCategory(cat) {
      const inCat = this.products.filter((p) => p.category === cat.id && !p.archived);
      if (inCat.length > 0) {
        alert(`Impossibile eliminare "${cat.name}": contiene ancora ${inCat.length} prodotti attivi. Archivia o sposta prima i prodotti.`);
        return;
      }
      this.confirmDialog = {
        open: true, danger: true,
        title: `Eliminare la categoria "${cat.name}"?`,
        message: 'L\'operazione non è reversibile (i prodotti archiviati in questa categoria diventano orfani).',
        onConfirm: async () => {
          await remove('categories', cat.id);
          this.confirmDialog.open = false;
          if (this.activeCategory === cat.id) {
            this.activeCategory = this.categories.find((c) => c.id !== cat.id)?.id || '';
          }
          await this.reloadAll();
        },
      };
    },

    async forceUpdate() {
      try {
        if ('serviceWorker' in navigator) {
          const regs = await navigator.serviceWorker.getRegistrations();
          for (const r of regs) await r.unregister();
        }
        if (window.caches) {
          const keys = await caches.keys();
          await Promise.all(keys.map((k) => caches.delete(k)));
        }
      } catch (e) { /* ignore */ }
      window.location.reload(true);
    },
  };
}

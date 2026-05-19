// Stato principale dell'app Alpine — "Cucina" redesign
import {
  openDb, seedIfEmpty,
  getAll, get, put, remove,
  getSetting, setSetting,
  recordMovement, undoMovement, newId,
} from './db.js';
import { CATEGORIES, UNITS } from './seed.js';
import {
  hasPin, setPin, verifyPin, changePin,
  startInactivityTimer, stopInactivityTimer, remainingMs,
} from './auth.js';
import {
  exportBackup, exportMovementsCsv, exportShoppingListCsv, restoreFromJson, downloadBlob,
} from './export.js';
import {
  dailySeries, topProducts, totals, compareWeekly, lowStock, filterRange,
} from './reports.js';

const DAY_MS = 24 * 60 * 60 * 1000;
let chartInstance = null;

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

export function initApp() {
  return {
    // ====== Stato ======
    ready: false,
    setupMode: false,
    screen: 'staff',
    adminTab: 'inventario',
    activeCategory: 'acque',

    theme: 'dark',

    dayClosed: false,
    lastCloseSummary: null,
    dailyCloses: [],
    closeConfirmOpen: false,
    dayStartedAt: 0,    // timestamp di inizio giornata logica (>= mezzanotte)

    categories: [],
    products: [],
    movements: [],
    suppliers: [],

    inactivityTimeoutMs: 120000,
    adminRemainingSec: 0,
    _countdownTimer: null,
    showBackupReminder: false,

    // Ricerca
    searchQuery: '',
    searchOpen: false,

    // Dialog quantità (unificato out/in)
    qtyDialog: { open: false, product: null, qty: 1, mode: 'out' },

    // Pulse animation per card
    pulseState: {},  // { productId: 'minus' | 'plus' }

    // Toast
    toasts: [],

    // Dialog PIN
    pinDialog: { open: false, mode: 'login', step: 1, value: '', confirm: '', error: '' },

    // Dialog prodotto
    productDialog: {
      open: false, isNew: true, original: null,
      form: { id: '', name: '', category: '', unit: 'bottiglia', currentStock: 0, minThreshold: 2, supplierId: '' }
    },

    // Dialog fornitore
    supplierDialog: {
      open: false, isNew: true,
      form: { id: '', name: '', phone: '', email: '', note: '' }
    },

    // Dialog generico conferma
    confirmDialog: { open: false, title: '', message: '', onConfirm: null, danger: false },

    // Filtri admin
    movementFilter: { productId: '', days: 7 },
    reportRange: 7,

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
    async setTheme(t) {
      this.theme = t;
      document.documentElement.dataset.theme = t;
      await setSetting('theme', t);
      if (this.screen === 'admin' && this.adminTab === 'report') {
        this.renderReportChart();
      }
    },
    async toggleTheme() {
      await this.setTheme(this.theme === 'dark' ? 'light' : 'dark');
    },

    // ====== Chiusura giornata ======
    async _loadDayCloseState() {
      const today = todayKey();
      const todayClose = await get('dailyCloses', today);
      this.dayStartedAt = await getSetting('dayStartedAt', 0);

      // Lo splash di chiusura compare solo se esiste una chiusura per oggi
      // E NON abbiamo già "aperto una nuova giornata" dopo quella chiusura.
      const advancedPast = todayClose && this.dayStartedAt > todayClose.closedAt;
      this.dayClosed = !!todayClose && !advancedPast;
      this.lastCloseSummary = todayClose || null;
      this.dailyCloses = (await getAll('dailyCloses')).sort((a, b) => b.date.localeCompare(a.date));

      // Detect "fresh new day": il giorno calendario è cambiato e ieri era chiuso
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
        // Verifica esplicita che il record sia stato scritto
        const saved = await get('dailyCloses', date);
        if (!saved) throw new Error('Record non trovato dopo il salvataggio');
      } catch (err) {
        this.closeConfirmOpen = false;
        alert('Errore salvataggio chiusura giornata: ' + err.message + '\nProva a ricaricare la pagina.');
        return;
      }
      this.closeConfirmOpen = false;
      this.dayClosed = true;
      this.lastCloseSummary = summary;
      await this._loadDayCloseState();
      this._pushToast({ kind: 'info', qtyLabel: '✓', productName: 'Giornata registrata nello storico' });
    },

    // Apri una giornata nuova (preservando la chiusura precedente nello storico).
    // I contatori uscite/ingressi ripartono da zero.
    async startNewDay() {
      const now = Date.now();
      await setSetting('dayStartedAt', now);
      this.dayStartedAt = now;
      this.dayClosed = false;
      await this._loadDayCloseState();
      this._pushToast({
        kind: 'info',
        qtyLabel: '☀',
        productName: 'Nuova giornata aperta · contatori azzerati',
      });
    },

    // Annulla la chiusura: rimuove il record di chiusura, contatori restano.
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
    formatCloseDateShort(dateStr) {
      const d = new Date(dateStr + 'T12:00:00');
      return d.toLocaleDateString('it-IT', { weekday: 'short', day: 'numeric', month: 'short' }).replace(/\./g, '');
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

    // ====== Derived ======
    get visibleProducts() {
      return this.products
        .filter((p) => !p.archived && p.category === this.activeCategory)
        .sort((a, b) => a.name.localeCompare(b.name, 'it'));
    },

    get allActiveProducts() {
      return this.products.filter((p) => !p.archived).sort((a, b) => a.name.localeCompare(b.name, 'it'));
    },

    get searchResults() {
      const q = this.searchQuery.trim().toLowerCase();
      if (!q) return [];
      return this.products
        .filter((p) => !p.archived && p.name.toLowerCase().includes(q))
        .slice(0, 8);
    },

    get lowStockProducts() {
      return lowStock(this.products);
    },

    get countLow() { return this.lowStockProducts.length; },

    get visibleLowCount() {
      return this.visibleProducts.filter((p) => this.isLow(p)).length;
    },

    get countLowByCategory() {
      const map = {};
      for (const p of this.lowStockProducts) {
        map[p.category] = (map[p.category] || 0) + 1;
      }
      return map;
    },

    get activeCategoryObj() {
      return this.categories.find((c) => c.id === this.activeCategory);
    },

    // Inizio giornata logica: max(inizio calendario, momento riapertura manuale)
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

    get weekStats() {
      const cutoff = Date.now() - 7 * DAY_MS;
      let out = 0;
      for (const m of this.movements) {
        if (m.timestamp < cutoff) continue;
        if (m.type === 'out') out += m.quantity;
      }
      return { out };
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
      if (firstLow) this.activeCategory = firstLow.category;
    },

    // ====== Quick actions (staff fast lane) ======
    async quickOut(product) {
      if (product.currentStock <= 0) return;
      const mv = await recordMovement({
        productId: product.id, quantity: 1, type: 'out', userMode: this.screen,
      });
      this._triggerPulse(product.id, 'minus');
      await this.reloadAll();
      this._pushToast({
        kind: 'out',
        qtyLabel: '−1 ' + product.unit,
        productName: product.name,
        movementId: mv.id,
      });
    },

    async quickIn(product) {
      const mv = await recordMovement({
        productId: product.id, quantity: 1, type: 'in', userMode: this.screen,
      });
      this._triggerPulse(product.id, 'plus');
      await this.reloadAll();
      this._pushToast({
        kind: 'in',
        qtyLabel: '+1 ' + product.unit,
        productName: product.name,
        movementId: mv.id,
      });
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
        productId: product.id, quantity: qty, type: mode, userMode: this.screen,
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
      // Limita a 4 toasts
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
      this.activeCategory = prod.category;
      this.openQty(prod, 'out');
    },

    // ====== Admin: PIN ======
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
      const ok = await verifyPin(d.value);
      if (!ok) { d.error = 'PIN errato.'; d.value = ''; return; }
      this.pinDialog.open = false;
      this.enterAdmin();
    },
    pinCancel() { this.pinDialog.open = false; },

    enterAdmin() {
      this.screen = 'admin';
      this.adminTab = 'inventario';
      this._startAdminTimer();
    },

    exitAdmin() {
      this.screen = 'staff';
      stopInactivityTimer();
      if (this._countdownTimer) { clearInterval(this._countdownTimer); this._countdownTimer = null; }
      this.adminRemainingSec = 0;
      this.searchOpen = false;
      this.searchQuery = '';
    },

    _startAdminTimer() {
      startInactivityTimer(this.inactivityTimeoutMs, () => this.exitAdmin());
      if (this._countdownTimer) clearInterval(this._countdownTimer);
      this._countdownTimer = setInterval(() => {
        this.adminRemainingSec = Math.ceil(remainingMs() / 1000);
        if (this.screen !== 'admin') {
          clearInterval(this._countdownTimer);
          this._countdownTimer = null;
        }
      }, 500);
    },

    openChangePin() {
      this.pinDialog = { open: true, mode: 'change', step: 1, value: '', confirm: '', error: '' };
    },

    // ====== Admin: prodotti ======
    openNewProduct() {
      this.productDialog = {
        open: true, isNew: true, original: null,
        form: {
          id: '', name: '', category: this.activeCategory || this.categories[0]?.id || '',
          unit: 'bottiglia', currentStock: 0, minThreshold: 2, supplierId: '',
        },
      };
    },
    openEditProduct(prod) {
      this.productDialog = {
        open: true, isNew: false, original: prod,
        form: {
          id: prod.id, name: prod.name, category: prod.category,
          unit: prod.unit, currentStock: prod.currentStock || 0,
          minThreshold: prod.minThreshold || 0, supplierId: prod.supplierId || '',
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
      const product = {
        id: finalId,
        name: f.name.trim(),
        category: f.category,
        unit: f.unit,
        currentStock: Number(f.currentStock) || 0,
        minThreshold: Number(f.minThreshold) || 0,
        supplierId: f.supplierId || null,
        archived: false,
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
          await this.reloadAll();
        },
      };
    },

    async updateStock(prod, value) {
      const newStock = Number(value);
      if (Number.isNaN(newStock)) return;
      const delta = newStock - (prod.currentStock || 0);
      if (delta === 0) return;
      await recordMovement({
        productId: prod.id, quantity: delta,
        type: 'adjust', userMode: 'admin', note: 'Rettifica manuale',
      });
      await this.reloadAll();
    },

    async updateThreshold(prod, value) {
      const n = Number(value);
      if (Number.isNaN(n)) return;
      await put('products', { ...prod, minThreshold: n });
      await this.reloadAll();
    },

    // ====== Admin: movimenti ======
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

    // ====== Admin: fornitori ======
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

    // ====== Report ======
    get reportData() {
      const filtered = filterRange(this.movements, this.reportRange);
      return {
        daily: dailySeries(this.movements, this.reportRange),
        top: topProducts(filtered, 10),
        totals: totals(filtered),
        weekly: compareWeekly(this.movements),
      };
    },
    renderReportChart() {
      this.$nextTick(() => {
        const canvas = this.$refs.reportCanvas;
        if (!canvas || !window.Chart) return;
        const cs = getComputedStyle(document.documentElement);
        const v = (k, fb) => (cs.getPropertyValue(k).trim() || fb);
        const { daily } = this.reportData;
        if (chartInstance) chartInstance.destroy();
        chartInstance = new window.Chart(canvas, {
          type: 'bar',
          data: {
            labels: daily.labels,
            datasets: [{
              label: 'Unità uscite',
              data: daily.values,
              backgroundColor: v('--chart-bar', 'rgba(255,138,76,0.85)'),
              borderColor: v('--accent', '#ff8a4c'),
              borderWidth: 0,
              borderRadius: 6,
              hoverBackgroundColor: v('--chart-bar-hover', '#ffa66e'),
            }],
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
              legend: { display: false },
              tooltip: {
                backgroundColor: v('--chart-tooltip-bg', '#221b13'),
                titleColor:     v('--chart-tooltip-fg', '#f5e9d3'),
                bodyColor:      v('--chart-tooltip-sub', '#b0997d'),
                borderColor:    v('--chart-tooltip-border', '#564530'),
                borderWidth: 1,
                padding: 10,
              },
            },
            scales: {
              x: { grid: { color: v('--chart-grid', '#322619') }, ticks: { color: v('--chart-tick', '#b0997d'), font: { family: 'JetBrains Mono' } } },
              y: { grid: { color: v('--chart-grid', '#322619') }, ticks: { color: v('--chart-tick', '#b0997d'), font: { family: 'JetBrains Mono' } }, beginAtZero: true },
            },
          },
        });
      });
    },
    exportMovementsCsv() {
      exportMovementsCsv(this.filteredMovements);
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
    async updateTimeout(seconds) {
      const ms = Math.max(30000, Math.min(600000, Number(seconds) * 1000));
      this.inactivityTimeoutMs = ms;
      await setSetting('inactivityTimeoutMs', ms);
      if (this.screen === 'admin') this._startAdminTimer();
    },

    setAdminTab(tab) {
      this.adminTab = tab;
      if (tab === 'report') this.renderReportChart();
    },

    // Forza aggiornamento app: pulisce cache service worker e ricarica.
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

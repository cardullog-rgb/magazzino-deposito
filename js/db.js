// Wrapper IndexedDB minimale per il gestionale.
// Store: products, categories, movements, suppliers, settings.
// API: open(), getAll(store), get(store, key), put(store, obj), remove(store, key), clear(store), bulkPut(store, arr).

import { CATEGORIES, PRODUCTS } from './seed.js';

const DB_NAME = 'magazzino-pizzeria';
const DB_VERSION = 2;

const STORES = {
  products:    { keyPath: 'id' },
  categories:  { keyPath: 'id' },
  movements:   { keyPath: 'id', indexes: [['by-product', 'productId'], ['by-timestamp', 'timestamp']] },
  suppliers:   { keyPath: 'id' },
  settings:    { keyPath: 'key' },
  dailyCloses: { keyPath: 'date' },
};

let _dbPromise = null;

export function openDb() {
  if (_dbPromise) return _dbPromise;
  _dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      for (const [name, cfg] of Object.entries(STORES)) {
        if (!db.objectStoreNames.contains(name)) {
          const store = db.createObjectStore(name, { keyPath: cfg.keyPath });
          if (cfg.indexes) {
            for (const [idx, key] of cfg.indexes) {
              store.createIndex(idx, key);
            }
          }
        }
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return _dbPromise;
}

async function tx(store, mode) {
  const db = await openDb();
  return db.transaction(store, mode).objectStore(store);
}

function reqToPromise(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function getAll(store) {
  const s = await tx(store, 'readonly');
  return reqToPromise(s.getAll());
}

export async function get(store, key) {
  const s = await tx(store, 'readonly');
  return reqToPromise(s.get(key));
}

export async function put(store, obj) {
  const s = await tx(store, 'readwrite');
  return reqToPromise(s.put(obj));
}

export async function remove(store, key) {
  const s = await tx(store, 'readwrite');
  return reqToPromise(s.delete(key));
}

export async function clear(store) {
  const s = await tx(store, 'readwrite');
  return reqToPromise(s.clear());
}

export async function bulkPut(store, items) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, 'readwrite');
    const s = t.objectStore(store);
    for (const item of items) s.put(item);
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
  });
}

// ============ Helpers di alto livello ============

export async function getSetting(key, fallback = null) {
  const row = await get('settings', key);
  return row ? row.value : fallback;
}

export async function setSetting(key, value) {
  return put('settings', { key, value });
}

export async function isFirstRun() {
  const prods = await getAll('products');
  return prods.length === 0;
}

export async function seedIfEmpty() {
  if (await isFirstRun()) {
    await bulkPut('categories', CATEGORIES);
    await bulkPut('products', PRODUCTS);
    await setSetting('inactivityTimeoutMs', 120000);
    await setSetting('createdAt', Date.now());
  }
}

export function newId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return 'm_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 9);
}

// type='out' → riduce scorta; type='in' → aumenta; type='adjust' → quantity può essere negativa (delta firmato).
export async function recordMovement({ productId, quantity, type = 'out', note = '', userMode = 'staff' }) {
  const product = await get('products', productId);
  if (!product) throw new Error('Prodotto non trovato: ' + productId);
  let delta;
  if (type === 'out') delta = -Math.abs(quantity);
  else if (type === 'in') delta = Math.abs(quantity);
  else delta = Number(quantity); // adjust: firmato
  const newStock = (product.currentStock || 0) + delta;
  const movement = {
    id: newId(),
    productId,
    productName: product.name,
    quantity: Math.abs(delta),
    delta,
    type,
    timestamp: Date.now(),
    note,
    userMode,
    stockAfter: newStock,
  };
  await put('movements', movement);
  await put('products', { ...product, currentStock: newStock });
  return movement;
}

export async function undoMovement(movementId) {
  const m = await get('movements', movementId);
  if (!m) return false;
  const product = await get('products', m.productId);
  if (product) {
    await put('products', { ...product, currentStock: (product.currentStock || 0) - m.delta });
  }
  await remove('movements', movementId);
  return true;
}

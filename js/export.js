// Export/Import dei dati.

import { getAll, bulkPut, clear, setSetting } from './db.js';

function csvEscape(v) {
  if (v == null) return '';
  const s = String(v);
  if (/[",\n;]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

export function toCsv(rows, headers) {
  if (!rows.length) return headers.join(';') + '\n';
  const head = headers.join(';');
  const body = rows.map((r) => headers.map((h) => csvEscape(r[h])).join(';')).join('\n');
  return head + '\n' + body + '\n';
}

export function downloadBlob(content, filename, mime = 'text/plain') {
  const blob = new Blob([content], { type: mime + ';charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 200);
}

export function todayStr() {
  const d = new Date();
  return d.toISOString().slice(0, 10);
}

export async function exportBackup() {
  const data = {
    version: 1,
    exportedAt: Date.now(),
    products:   await getAll('products'),
    categories: await getAll('categories'),
    movements:  await getAll('movements'),
    suppliers:  await getAll('suppliers'),
    settings:   (await getAll('settings')).filter((s) => s.key !== 'adminPinHash'),
  };
  downloadBlob(JSON.stringify(data, null, 2), `magazzino-backup-${todayStr()}.json`, 'application/json');
  await setSetting('lastExportAt', Date.now());
  return data;
}

export async function exportMovementsCsv(movements) {
  const rows = movements.map((m) => ({
    data: new Date(m.timestamp).toLocaleString('it-IT'),
    prodotto: m.productName,
    tipo: m.type === 'out' ? 'uscita' : m.type === 'in' ? 'ingresso' : 'rettifica',
    quantita: m.quantity,
    scorta_dopo: m.stockAfter,
    note: m.note || '',
    operatore: m.userMode,
  }));
  const csv = toCsv(rows, ['data', 'prodotto', 'tipo', 'quantita', 'scorta_dopo', 'note', 'operatore']);
  downloadBlob(csv, `movimenti-${todayStr()}.csv`, 'text/csv');
}

export async function exportShoppingListCsv(items) {
  const rows = items.map((i) => ({
    fornitore: i.supplierName || '— senza fornitore —',
    prodotto: i.productName,
    scorta_attuale: i.currentStock,
    soglia_minima: i.minThreshold,
    quantita_da_ordinare: i.toOrder,
    unita: i.unit,
  }));
  const csv = toCsv(rows, ['fornitore', 'prodotto', 'scorta_attuale', 'soglia_minima', 'quantita_da_ordinare', 'unita']);
  downloadBlob(csv, `lista-spesa-${todayStr()}.csv`, 'text/csv');
}

export async function restoreFromJson(text) {
  let data;
  try { data = JSON.parse(text); }
  catch { throw new Error('File JSON non valido.'); }
  if (!data || typeof data !== 'object' || !Array.isArray(data.products)) {
    throw new Error('Backup non riconosciuto.');
  }
  await clear('products');
  await clear('categories');
  await clear('movements');
  await clear('suppliers');
  if (data.categories?.length) await bulkPut('categories', data.categories);
  if (data.products?.length)   await bulkPut('products', data.products);
  if (data.movements?.length)  await bulkPut('movements', data.movements);
  if (data.suppliers?.length)  await bulkPut('suppliers', data.suppliers);
  if (data.settings?.length) {
    for (const s of data.settings) {
      if (s.key !== 'adminPinHash') await setSetting(s.key, s.value);
    }
  }
}

// Aggregazioni report.

const DAY_MS = 24 * 60 * 60 * 1000;

export function startOfDay(ts) {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function filterRange(movements, days) {
  const cutoff = Date.now() - days * DAY_MS;
  return movements.filter((m) => m.timestamp >= cutoff);
}

export function dailySeries(movements, days) {
  const today = startOfDay(Date.now());
  const buckets = {};
  for (let i = days - 1; i >= 0; i--) {
    const t = today - i * DAY_MS;
    buckets[t] = 0;
  }
  for (const m of movements) {
    if (m.type !== 'out') continue;
    const d = startOfDay(m.timestamp);
    if (d in buckets) buckets[d] += m.quantity;
  }
  const labels = Object.keys(buckets).map((t) => {
    const d = new Date(Number(t));
    return d.toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit' });
  });
  const values = Object.values(buckets);
  return { labels, values };
}

export function topProducts(movements, limit = 10) {
  const agg = {};
  for (const m of movements) {
    if (m.type !== 'out') continue;
    if (!agg[m.productId]) agg[m.productId] = { productId: m.productId, name: m.productName, total: 0 };
    agg[m.productId].total += m.quantity;
  }
  return Object.values(agg).sort((a, b) => b.total - a.total).slice(0, limit);
}

export function totals(movements) {
  let out = 0, inn = 0, count = 0;
  for (const m of movements) {
    count++;
    if (m.type === 'out') out += m.quantity;
    else if (m.type === 'in') inn += m.quantity;
  }
  return { out, in: inn, count };
}

export function compareWeekly(movements) {
  const now = Date.now();
  const week = 7 * DAY_MS;
  const thisWeek = movements.filter((m) => m.type === 'out' && m.timestamp >= now - week)
    .reduce((s, m) => s + m.quantity, 0);
  const prevWeek = movements.filter((m) => m.type === 'out' && m.timestamp >= now - 2 * week && m.timestamp < now - week)
    .reduce((s, m) => s + m.quantity, 0);
  const delta = prevWeek === 0 ? null : ((thisWeek - prevWeek) / prevWeek) * 100;
  return { thisWeek, prevWeek, delta };
}

export function lowStock(products) {
  return products
    .filter((p) => !p.archived && p.currentStock <= (p.minThreshold || 0))
    .sort((a, b) => (a.currentStock - a.minThreshold) - (b.currentStock - b.minThreshold));
}

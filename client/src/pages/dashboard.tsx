import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { AlertTriangle, PackageX, CheckCircle2, Package, TrendingDown, ArrowDownCircle, ArrowUpCircle, RefreshCw, ChevronRight } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import type { Product, Category, Movement } from "@shared/schema";

const MOVE_ICONS: Record<string, any> = {
  carico: ArrowUpCircle,
  scarico: ArrowDownCircle,
  rettifica: RefreshCw,
};
const MOVE_COLORS: Record<string, string> = {
  carico: "hsl(var(--status-carico))",
  scarico: "hsl(var(--status-scarico))",
  rettifica: "hsl(var(--status-rettifica))",
};

function stockLevel(p: Product): "out" | "low" | "ok" {
  if (p.currentStock <= 0) return "out";
  if (p.currentStock <= p.minStock) return "low";
  return "ok";
}
function stockPercent(p: Product): number {
  return Math.min(100, (p.currentStock / Math.max(p.idealStock, p.minStock + 1)) * 100);
}

export default function DashboardPage() {
  const { data: products = [] } = useQuery<Product[]>({ queryKey: ["/api/products"], refetchInterval: 15000 });
  const { data: categories = [] } = useQuery<Category[]>({ queryKey: ["/api/categories"] });
  const { data: summary } = useQuery<{ total: number; low: number; ok: number; outOfStock: number }>({
    queryKey: ["/api/stats/summary"], refetchInterval: 15000,
  });
  const { data: activity = [] } = useQuery<Movement[]>({
    queryKey: ["/api/stats/activity"], refetchInterval: 15000,
  });

  const activeProducts = products.filter(p => p.active);
  const outOfStock = activeProducts.filter(p => p.currentStock <= 0);
  const lowStock = activeProducts.filter(p => p.currentStock > 0 && p.currentStock <= p.minStock);

  const catMap = Object.fromEntries(categories.map(c => [c.id, c]));

  const kpis = [
    { label: "Totale Prodotti", value: summary?.total ?? 0, icon: Package, color: "hsl(var(--primary))", bg: "hsl(var(--primary) / 0.1)", href: "/scorte" },
    { label: "Scorte OK", value: summary?.ok ?? 0, icon: CheckCircle2, color: "hsl(var(--status-ok))", bg: "hsl(var(--status-ok) / 0.1)", href: "/scorte" },
    { label: "Scorte Basse", value: summary?.low ?? 0, icon: AlertTriangle, color: "hsl(var(--status-low))", bg: "hsl(var(--status-low) / 0.1)", href: "/lista-spesa" },
    { label: "Esauriti", value: summary?.outOfStock ?? 0, icon: PackageX, color: "hsl(var(--status-out))", bg: "hsl(var(--status-out) / 0.1)", href: "/lista-spesa" },
  ];

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="px-5 py-4 border-b shrink-0">
        <h1 className="font-display font-bold text-xl">Dashboard Magazzino</h1>
        <p className="text-sm text-muted-foreground">
          {new Date().toLocaleDateString("it-IT", { weekday: "long", day: "numeric", month: "long" })}
        </p>
      </div>

      <div className="flex-1 overflow-y-auto scrollbar-thin p-5 space-y-5">

        {/* KPI row — ognuno è un Link cliccabile */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {kpis.map(k => (
            <Link key={k.label} href={k.href}>
              <div
                data-testid={`kpi-${k.label}`}
                className="card-3d rounded-xl border p-4 cursor-pointer active:scale-95 transition-transform"
                style={{ background: "hsl(var(--card))" }}
              >
                <div className="w-8 h-8 rounded-lg flex items-center justify-center mb-3" style={{ background: k.bg }}>
                  <k.icon className="w-4 h-4" style={{ color: k.color }} />
                </div>
                <p className="text-xs text-muted-foreground font-medium">{k.label}</p>
                <p className="font-display font-bold text-2xl mt-0.5 tabular-nums" style={{ color: k.color }}>{k.value}</p>
              </div>
            </Link>
          ))}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">

          {/* Alert panel */}
          <Card>
            <div className="px-4 py-3 border-b flex items-center justify-between">
              <h2 className="font-display font-semibold text-sm flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-500" />
                Richiede attenzione
                {(outOfStock.length + lowStock.length) > 0 && (
                  <span className="text-xs font-bold px-2 py-0.5 rounded-full"
                    style={{ background: "hsl(var(--status-out) / 0.15)", color: "hsl(var(--status-out))" }}>
                    {outOfStock.length + lowStock.length}
                  </span>
                )}
              </h2>
              <Link href="/lista-spesa">
                <span className="text-xs text-primary font-medium flex items-center gap-1 py-1 px-2 rounded-lg hover:bg-primary/10 active:bg-primary/20 transition-colors cursor-pointer">
                  Lista spesa <ChevronRight className="w-3 h-3" />
                </span>
              </Link>
            </div>
            <div className="divide-y max-h-72 overflow-y-auto scrollbar-thin">
              {outOfStock.length === 0 && lowStock.length === 0 ? (
                <div className="px-5 py-8 text-center">
                  <CheckCircle2 className="w-8 h-8 mx-auto mb-2 text-green-500 opacity-60" />
                  <p className="text-sm text-muted-foreground">Tutto in ordine!</p>
                </div>
              ) : (
                <>
                  {outOfStock.map(p => (
                    <AlertRow key={p.id} product={p} category={catMap[p.categoryId]} level="out" />
                  ))}
                  {lowStock.map(p => (
                    <AlertRow key={p.id} product={p} category={catMap[p.categoryId]} level="low" />
                  ))}
                </>
              )}
            </div>
          </Card>

          {/* Attività recente */}
          <Card>
            <div className="px-4 py-3 border-b flex items-center justify-between">
              <h2 className="font-display font-semibold text-sm flex items-center gap-2">
                <TrendingDown className="w-4 h-4 text-primary" />
                Ultimi movimenti
              </h2>
              <Link href="/storico">
                <span className="text-xs text-primary font-medium flex items-center gap-1 py-1 px-2 rounded-lg hover:bg-primary/10 active:bg-primary/20 transition-colors cursor-pointer">
                  Storico <ChevronRight className="w-3 h-3" />
                </span>
              </Link>
            </div>
            <div className="divide-y max-h-72 overflow-y-auto scrollbar-thin">
              {activity.length === 0 ? (
                <div className="px-5 py-8 text-center">
                  <p className="text-sm text-muted-foreground">Nessun movimento ancora</p>
                </div>
              ) : activity.slice(0, 12).map(m => {
                const product = products.find(p => p.id === m.productId);
                const Icon = MOVE_ICONS[m.type] ?? RefreshCw;
                const color = MOVE_COLORS[m.type] ?? "hsl(var(--muted-foreground))";
                return (
                  <div key={m.id} className="px-4 py-2.5 flex items-center gap-3">
                    <div className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0"
                      style={{ background: `${color}22` }}>
                      <Icon className="w-3.5 h-3.5" style={{ color }} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{product?.name ?? "—"}</p>
                      <p className="text-xs text-muted-foreground">
                        {m.type} · {m.stockBefore} → {m.stockAfter} {product?.unit}
                      </p>
                    </div>
                    <span className="text-xs text-muted-foreground shrink-0">
                      {new Date(m.createdAt).toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" })}
                    </span>
                  </div>
                );
              })}
            </div>
          </Card>
        </div>

        {/* Overview sezioni */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {["bevande", "cucina"].map(section => {
            const sectionCats = categories.filter(c => c.section === section);
            const sectionProds = activeProducts.filter(p => sectionCats.some(c => c.id === p.categoryId));
            const sectionLow = sectionProds.filter(p => stockLevel(p) !== "ok").length;
            return (
              <Card key={section}>
                <div className="px-4 py-3 border-b flex items-center justify-between">
                  <h2 className="font-display font-semibold text-sm capitalize flex items-center gap-2">
                    {section === "bevande" ? "🍺" : "🍕"}{" "}
                    {section === "bevande" ? "Bevande & Bar" : "Cucina & Dispensa"}
                  </h2>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">{sectionProds.length} prodotti</span>
                    {sectionLow > 0 && (
                      <span className="text-xs font-bold px-1.5 py-0.5 rounded-full"
                        style={{ background: "hsl(var(--status-low) / 0.15)", color: "hsl(var(--status-low))" }}>
                        {sectionLow} alert
                      </span>
                    )}
                  </div>
                </div>
                <div className="p-3 grid grid-cols-2 gap-1.5">
                  {sectionCats.map(cat => {
                    const catProds = sectionProds.filter(p => p.categoryId === cat.id);
                    const catLow = catProds.filter(p => stockLevel(p) !== "ok").length;
                    return (
                      <Link key={cat.id} href={`/scorte`}>
                        <div className="flex items-center gap-2.5 p-2.5 rounded-xl text-left transition-all
                          hover:bg-muted/60 active:bg-muted active:scale-95 cursor-pointer min-h-[52px]">
                          <span className="text-xl leading-none flex-shrink-0">{cat.icon}</span>
                          <div className="min-w-0 flex-1">
                            <p className="text-xs font-medium truncate">{cat.name}</p>
                            <p className="text-xs text-muted-foreground">{catProds.length} prod.</p>
                          </div>
                          {catLow > 0 && (
                            <span className="w-5 h-5 rounded-full text-xs font-bold flex items-center justify-center flex-shrink-0"
                              style={{ background: "hsl(var(--status-low) / 0.15)", color: "hsl(var(--status-low))" }}>
                              {catLow}
                            </span>
                          )}
                        </div>
                      </Link>
                    );
                  })}
                </div>
              </Card>
            );
          })}
        </div>

      </div>
    </div>
  );
}

function AlertRow({ product, category, level }: { product: Product; category?: Category; level: "out" | "low" }) {
  const color = level === "out" ? "hsl(var(--status-out))" : "hsl(var(--status-low))";
  const pct = stockPercent(product);
  return (
    <div className="px-4 py-3 flex items-center gap-3">
      <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${level === "out" ? "pulse-out" : "pulse-low"}`}
        style={{ background: color }} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="text-xs">{category?.icon}</span>
          <p className="text-sm font-medium truncate">{product.name}</p>
        </div>
        <div className="flex items-center gap-2 mt-1">
          <div className="stock-bar-track flex-1">
            <div className="stock-bar-fill" style={{ width: `${pct}%`, background: color }} />
          </div>
          <span className="text-xs font-bold tabular-nums shrink-0" style={{ color }}>
            {product.currentStock} {product.unit}
          </span>
        </div>
      </div>
      <div className="text-right shrink-0">
        <p className="text-xs text-muted-foreground">min. {product.minStock}</p>
      </div>
    </div>
  );
}

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ShoppingCart, AlertTriangle, PackageX, Printer, CheckSquare, Square, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import type { Product, Category } from "@shared/schema";

function stockLevel(p: Product): "out" | "low" {
  if (p.currentStock <= 0) return "out";
  return "low";
}

function neededQty(p: Product): number {
  return Math.max(0, p.idealStock - p.currentStock);
}

export default function ListaSpesaPage() {
  const { toast } = useToast();
  const [checked, setChecked] = useState<Set<number>>(new Set());

  const { data: products = [] } = useQuery<Product[]>({
    queryKey: ["/api/products"], refetchInterval: 15000,
  });
  const { data: categories = [] } = useQuery<Category[]>({ queryKey: ["/api/categories"] });

  const catMap = Object.fromEntries(categories.map(c => [c.id, c]));

  // Only products below minStock
  const needsOrder = products.filter(p =>
    p.active && p.currentStock <= p.minStock
  ).sort((a, b) => {
    // esauriti prima, poi bassi
    const la = a.currentStock <= 0 ? 0 : 1;
    const lb = b.currentStock <= 0 ? 0 : 1;
    if (la !== lb) return la - lb;
    // poi per categoria
    return (catMap[a.categoryId]?.sortOrder ?? 0) - (catMap[b.categoryId]?.sortOrder ?? 0);
  });

  // Group by category
  const grouped = new Map<number, Product[]>();
  for (const p of needsOrder) {
    const catId = p.categoryId;
    if (!grouped.has(catId)) grouped.set(catId, []);
    grouped.get(catId)!.push(p);
  }

  const toggleCheck = (id: number) => {
    setChecked(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (checked.size === needsOrder.length) {
      setChecked(new Set());
    } else {
      setChecked(new Set(needsOrder.map(p => p.id)));
    }
  };

  const copyToClipboard = () => {
    const lines: string[] = [`📦 LISTA ORDINE\n${new Date().toLocaleDateString("it-IT", { weekday: "long", day: "numeric", month: "long" })}\n`];
    let currentSection = "";
    for (const [catId, prods] of Array.from(grouped.entries())) {
      const cat = catMap[catId];
      const section = cat?.section ?? "";
      if (section !== currentSection) {
        lines.push(`\n${"═".repeat(30)}`);
        lines.push(`${section === "bevande" ? "🍺 BEVANDE & BAR" : "🍕 CUCINA & DISPENSA"}`);
        lines.push("═".repeat(30));
        currentSection = section;
      }
      lines.push(`\n${cat?.icon} ${cat?.name ?? "—"}`);
      for (const p of prods) {
        const q = neededQty(p);
        const status = p.currentStock <= 0 ? "⭕ ESAURITO" : "⚠️ BASSO";
        lines.push(`  ${status} ${p.name}${p.brand ? ` (${p.brand})` : ""}${p.unitSize ? ` [${p.unitSize}]` : ""}`);
        lines.push(`     Attuale: ${p.currentStock} ${p.unit} → Da ordinare: ${q} ${p.unit}`);
      }
    }
    navigator.clipboard.writeText(lines.join("\n"))
      .then(() => toast({ title: "✅ Lista copiata negli appunti" }))
      .catch(() => toast({ title: "Errore copia", variant: "destructive" }));
  };

  const printList = () => window.print();

  if (needsOrder.length === 0) {
    return (
      <div className="flex flex-col h-full overflow-hidden">
        <div className="px-6 py-4 border-b shrink-0">
          <h1 className="font-display font-bold text-xl flex items-center gap-2">
            <ShoppingCart className="w-5 h-5 text-primary" /> Lista della Spesa
          </h1>
          <p className="text-sm text-muted-foreground">Ordini automatici sotto soglia minima</p>
        </div>
        <div className="flex-1 flex flex-col items-center justify-center gap-4">
          <div className="w-16 h-16 rounded-full flex items-center justify-center"
            style={{ background: "hsl(var(--status-ok) / 0.1)" }}>
            <CheckSquare className="w-8 h-8" style={{ color: "hsl(var(--status-ok))" }} />
          </div>
          <p className="font-display font-semibold text-lg">Magazzino completo!</p>
          <p className="text-sm text-muted-foreground text-center max-w-xs">
            Tutti i prodotti sono sopra la soglia minima. Nessun ordine necessario.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="px-6 py-4 border-b shrink-0 flex items-center justify-between gap-4">
        <div>
          <h1 className="font-display font-bold text-xl flex items-center gap-2">
            <ShoppingCart className="w-5 h-5 text-primary" /> Lista della Spesa
          </h1>
          <p className="text-sm text-muted-foreground">
            {needsOrder.filter(p => p.currentStock <= 0).length} esauriti ·{" "}
            {needsOrder.filter(p => p.currentStock > 0).length} sotto scorta minima
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={copyToClipboard} data-testid="button-copy">
            <Copy className="w-4 h-4 mr-1.5" /> Copia
          </Button>
          <Button variant="outline" size="sm" onClick={printList} data-testid="button-print">
            <Printer className="w-4 h-4 mr-1.5" /> Stampa
          </Button>
        </div>
      </div>

      {/* Select all bar */}
      <div className="px-6 py-2.5 border-b flex items-center gap-3 shrink-0 bg-muted/30">
        <button onClick={toggleAll} className="flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors" data-testid="button-toggle-all">
          {checked.size === needsOrder.length
            ? <CheckSquare className="w-4 h-4 text-primary" />
            : <Square className="w-4 h-4" />}
          {checked.size > 0 ? `${checked.size} selezionati` : "Seleziona tutto"}
        </button>
        {checked.size > 0 && (
          <span className="text-xs text-muted-foreground ml-auto">
            Spunta man mano che compri
          </span>
        )}
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto scrollbar-thin p-6 space-y-6">
        {/* Sezione Bevande */}
        {(["bevande", "cucina"] as const).map(section => {
          const sectionCats = categories.filter(c => c.section === section);
          const sectionEntries = Array.from(grouped.entries()).filter(([catId]) =>
            sectionCats.some(c => c.id === catId)
          );
          if (sectionEntries.length === 0) return null;

          return (
            <div key={section}>
              <h2 className="font-display font-bold text-sm uppercase tracking-widest text-muted-foreground mb-3 flex items-center gap-2">
                <span className="h-px flex-1 bg-border" />
                {section === "bevande" ? "🍺 Bevande & Bar" : "🍕 Cucina & Dispensa"}
                <span className="h-px flex-1 bg-border" />
              </h2>

              <div className="space-y-2">
                {sectionEntries.map(([catId, prods]) => {
                  const cat = catMap[catId];
                  return (
                    <Card key={catId} className="overflow-hidden">
                      {/* Category header */}
                      <div className="px-4 py-2 border-b flex items-center gap-2"
                        style={{ background: `${cat?.color ?? "#888"}14` }}>
                        <span className="text-base">{cat?.icon}</span>
                        <span className="font-semibold text-sm">{cat?.name}</span>
                        <span className="text-xs text-muted-foreground ml-auto">{prods.length} prodotti</span>
                      </div>

                      {/* Products */}
                      <div className="divide-y">
                        {prods.map(p => {
                          const level = stockLevel(p);
                          const isChecked = checked.has(p.id);
                          const qty = neededQty(p);
                          return (
                            <div key={p.id} data-testid={`row-spesa-${p.id}`}
                              className="px-4 py-3 flex items-center gap-3 transition-all"
                              style={{ opacity: isChecked ? 0.45 : 1 }}>
                              {/* Checkbox */}
                              <button onClick={() => toggleCheck(p.id)} data-testid={`check-${p.id}`}
                                className="w-5 h-5 flex-shrink-0 flex items-center justify-center rounded transition-colors">
                                {isChecked
                                  ? <CheckSquare className="w-5 h-5 text-primary" />
                                  : <Square className="w-5 h-5 text-muted-foreground" />}
                              </button>

                              {/* Status dot */}
                              <div className={`w-2 h-2 rounded-full flex-shrink-0 ${level === "out" ? "pulse-out" : "pulse-low"}`}
                                style={{ background: level === "out" ? "hsl(var(--status-out))" : "hsl(var(--status-low))" }} />

                              {/* Product info */}
                              <div className="flex-1 min-w-0">
                                <p className="font-medium text-sm" style={{ textDecoration: isChecked ? "line-through" : "none" }}>
                                  {p.name}
                                </p>
                                <p className="text-xs text-muted-foreground">
                                  {p.brand && <span>{p.brand} · </span>}
                                  {p.unitSize && <span>{p.unitSize} · </span>}
                                  {p.location && <span>📍 {p.location}</span>}
                                </p>
                              </div>

                              {/* Quantities */}
                              <div className="text-right shrink-0 space-y-0.5">
                                <div className="flex items-center gap-2 justify-end">
                                  <span className="text-xs text-muted-foreground">attuale:</span>
                                  <span className="text-xs font-bold tabular-nums"
                                    style={{ color: level === "out" ? "hsl(var(--status-out))" : "hsl(var(--status-low))" }}>
                                    {p.currentStock} {p.unit}
                                  </span>
                                </div>
                                <div className="flex items-center gap-2 justify-end">
                                  <span className="text-xs text-muted-foreground">da ordinare:</span>
                                  <span className="text-xs font-bold tabular-nums text-primary">
                                    {qty} {p.unit}
                                  </span>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </Card>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Search, Plus, Minus, X, Truck, Camera, CheckCircle2, Package } from "lucide-react";
import type { Product, Category } from "@shared/schema";

type GroupKey = "categoria" | "fornitore";

export default function CaricoPage() {
  const qc = useQueryClient();
  const { toast } = useToast();

  const { data: products = [] } = useQuery<Product[]>({ queryKey: ["/api/products"] });
  const { data: categories = [] } = useQuery<Category[]>({ queryKey: ["/api/categories"] });

  const [search, setSearch] = useState("");
  const [groupBy, setGroupBy] = useState<GroupKey>("categoria");
  const [draft, setDraft] = useState<Record<number, number>>({}); // productId → quantity

  const catMap = useMemo(() => {
    const m = new Map<number, Category>();
    for (const c of categories) m.set(c.id, c);
    return m;
  }, [categories]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return products.filter(p => {
      if (!p.active) return false;
      if (!q) return true;
      return p.name.toLowerCase().includes(q)
        || p.brand.toLowerCase().includes(q)
        || (p.supplier ?? "").toLowerCase().includes(q);
    });
  }, [products, search]);

  const grouped = useMemo(() => {
    const m = new Map<string, { label: string; items: Product[]; sortHint: number }>();
    for (const p of filtered) {
      let key: string;
      let label: string;
      let sortHint = 0;
      if (groupBy === "categoria") {
        const c = catMap.get(p.categoryId);
        key = `c-${p.categoryId}`;
        label = c ? `${c.icon} ${c.name}` : "Senza categoria";
        sortHint = c?.sortOrder ?? 999;
      } else {
        const sup = (p.supplier ?? "").trim() || "Senza fornitore";
        key = `s-${sup}`;
        label = sup;
      }
      if (!m.has(key)) m.set(key, { label, items: [], sortHint });
      m.get(key)!.items.push(p);
    }
    return Array.from(m.values()).sort((a, b) => {
      if (groupBy === "categoria") return a.sortHint - b.sortHint;
      return a.label.localeCompare(b.label, "it");
    });
  }, [filtered, groupBy, catMap]);

  // Bottoni quantità: ogni tap somma alla bozza (utile per cumulare carico)
  function addToDraft(productId: number, delta: number) {
    setDraft(d => {
      const next = (d[productId] ?? 0) + delta;
      if (next <= 0) {
        const { [productId]: _, ...rest } = d;
        return rest;
      }
      return { ...d, [productId]: next };
    });
  }
  function setDraftValue(productId: number, value: number) {
    setDraft(d => {
      if (value <= 0) {
        const { [productId]: _, ...rest } = d;
        return rest;
      }
      return { ...d, [productId]: value };
    });
  }
  function clearProduct(productId: number) {
    setDraft(d => {
      const { [productId]: _, ...rest } = d;
      return rest;
    });
  }

  const draftItems = useMemo(() => {
    return Object.entries(draft)
      .map(([pid, qty]) => {
        const p = products.find(x => x.id === Number(pid));
        if (!p) return null;
        return { product: p, quantity: qty };
      })
      .filter((x): x is { product: Product; quantity: number } => !!x);
  }, [draft, products]);

  const draftTotal = draftItems.reduce((s, it) => s + it.quantity, 0);

  const submitMut = useMutation({
    mutationFn: async () => {
      const items = draftItems.map(it => ({
        productId: it.product.id,
        type: "entrata" as const,
        quantity: it.quantity,
      }));
      const res = await apiRequest("POST", "/api/sheet/movements/batch", { items });
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/sheet/current"] });
      qc.invalidateQueries({ queryKey: ["/api/products"] });
      toast({
        title: "Carico registrato",
        description: `${draftItems.length} prodotti, ${draftTotal} unità totali`,
      });
      setDraft({});
    },
    onError: (e: any) => toast({ title: "Errore", description: e.message, variant: "destructive" }),
  });

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="px-4 sm:px-5 py-3 border-b shrink-0 flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 min-w-0">
          <Truck className="w-5 h-5 text-muted-foreground shrink-0" />
          <div>
            <h1 className="text-base sm:text-lg font-semibold leading-tight">Carico merce</h1>
            <p className="text-xs text-muted-foreground">
              Aggiungi le entrate, poi conferma in fondo.
            </p>
          </div>
        </div>
        <button
          disabled
          title="Scansione foto bolla (in arrivo)"
          className="flex items-center gap-1.5 px-2.5 h-9 rounded-md text-xs font-medium opacity-50 cursor-not-allowed"
          style={{ background: "hsl(var(--muted))" }}
        >
          <Camera className="w-3.5 h-3.5" />
          Scansione bolla
        </button>
      </div>

      {/* Filtri */}
      <div className="px-4 sm:px-5 py-2.5 border-b flex items-center gap-2 flex-wrap shrink-0 bg-background">
        <div className="relative flex-1 min-w-44 max-w-xs">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Cerca prodotto / fornitore…"
            data-testid="input-search"
            className="w-full pl-8 pr-7 py-1.5 text-sm rounded-md bg-muted border-0 outline-none focus:ring-2 focus:ring-primary/40"
          />
          {search && (
            <button onClick={() => setSearch("")} className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5">
              <X className="w-3.5 h-3.5 text-muted-foreground" />
            </button>
          )}
        </div>

        <div className="flex items-center gap-1">
          {(["categoria", "fornitore"] as GroupKey[]).map(k => (
            <button
              key={k}
              data-testid={`group-${k}`}
              onClick={() => setGroupBy(k)}
              className={
                "px-2.5 py-1 text-xs rounded-md transition-colors capitalize " +
                (groupBy === k
                  ? "bg-foreground text-background"
                  : "bg-muted text-muted-foreground hover:bg-secondary")
              }
            >
              {k}
            </button>
          ))}
        </div>
      </div>

      {/* Lista prodotti */}
      <div className="flex-1 overflow-y-auto scrollbar-thin">
        {grouped.length === 0 && (
          <div className="p-12 text-center text-sm text-muted-foreground">
            Nessun prodotto trovato.
          </div>
        )}
        {grouped.map(group => (
          <div key={group.label}>
            <div className="px-4 sm:px-5 py-1.5 bg-muted/40 border-b text-xs font-medium">
              {group.label}
              <span className="text-muted-foreground/70 ml-1.5">· {group.items.length}</span>
            </div>
            {group.items.map(p => {
              const qty = draft[p.id] ?? 0;
              const active = qty > 0;
              return (
                <div
                  key={p.id}
                  data-testid={`carico-row-${p.id}`}
                  className="flex items-center gap-3 px-4 sm:px-5 py-2 border-b hover:bg-muted/30"
                  style={{ background: active ? "hsl(var(--primary) / 0.05)" : undefined }}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      {active && <CheckCircle2 className="w-3.5 h-3.5" style={{ color: "hsl(var(--status-carico))" }} />}
                      <span className="text-sm truncate font-medium">{p.name}</span>
                    </div>
                    <div className="text-[11px] text-muted-foreground truncate">
                      {p.brand && <span>{p.brand} · </span>}
                      {p.unitSize || p.unit}
                      {p.supplier && <span> · {p.supplier}</span>}
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      onClick={() => addToDraft(p.id, -1)}
                      disabled={qty <= 0}
                      className="w-9 h-9 rounded-md border flex items-center justify-center hover:bg-secondary disabled:opacity-30"
                      type="button"
                    >
                      <Minus className="w-3.5 h-3.5" />
                    </button>
                    <input
                      type="number"
                      min="0"
                      step="any"
                      value={qty || ""}
                      onChange={(e) => setDraftValue(p.id, parseFloat(e.target.value) || 0)}
                      placeholder="0"
                      className="w-14 h-9 text-center text-sm font-mono tabular-nums bg-muted rounded-md border-0 outline-none focus:ring-2 focus:ring-primary/40"
                      data-testid={`qty-${p.id}`}
                    />
                    <button
                      onClick={() => addToDraft(p.id, 1)}
                      className="w-9 h-9 rounded-md border flex items-center justify-center hover:bg-secondary"
                      type="button"
                    >
                      <Plus className="w-3.5 h-3.5" />
                    </button>
                    <span className="text-[11px] text-muted-foreground w-10 truncate">{p.unit}</span>
                  </div>
                </div>
              );
            })}
          </div>
        ))}
      </div>

      {/* Footer conferma */}
      {draftItems.length > 0 && (
        <div className="px-4 sm:px-5 py-3 border-t shrink-0 flex items-center gap-3" style={{ background: "hsl(var(--background))" }}>
          <div className="flex items-center gap-2 text-sm">
            <Package className="w-4 h-4 text-muted-foreground" />
            <span className="font-mono tabular-nums font-medium">{draftItems.length}</span>
            <span className="text-muted-foreground">prodotti ·</span>
            <span className="font-mono tabular-nums font-medium">{draftTotal}</span>
            <span className="text-muted-foreground">unità</span>
          </div>
          <div className="flex-1" />
          <Button
            variant="outline"
            onClick={() => setDraft({})}
            disabled={submitMut.isPending}
            type="button"
            data-testid="button-clear-draft"
          >
            Svuota
          </Button>
          <Button
            onClick={() => submitMut.mutate()}
            disabled={submitMut.isPending || draftItems.length === 0}
            data-testid="button-confirm-carico"
          >
            {submitMut.isPending ? "Registrazione…" : "Conferma carico"}
          </Button>
        </div>
      )}
    </div>
  );
}

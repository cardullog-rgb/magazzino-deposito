import { useEffect, useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation, useSearch } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Search, Plus, Pencil, ArrowUpCircle, ArrowDownCircle, RefreshCw, Package, X, ChevronDown, ChevronUp, Sparkles } from "lucide-react";
import { InlineEdit } from "@/components/inline-edit";
import { suggestCategoryId } from "@/lib/suggest-category";
import type { Product, Category } from "@shared/schema";

type Level = "out" | "low" | "ok";

function stockLevel(p: Product): Level {
  if (p.currentStock <= 0) return "out";
  if (p.currentStock <= p.minStock) return "low";
  return "ok";
}
function stockPercent(p: Product): number {
  return Math.min(100, (p.currentStock / Math.max(p.idealStock, p.minStock + 1)) * 100);
}

const LEVEL_COLORS: Record<Level, string> = {
  ok: "hsl(var(--status-ok))",
  low: "hsl(var(--status-low))",
  out: "hsl(var(--status-out))",
};
const LEVEL_LABELS: Record<Level, string> = { ok: "OK", low: "Basso", out: "Esaurito" };

const UNITS = ["pz", "cassa", "fusto", "kg", "lt", "conf", "sacco", "bt", "mazzo", "rotolo", "cartone"];

export default function ScortePage() {
  const search = useSearch();
  const params = new URLSearchParams(search);
  const initSection = params.get("section") ?? "all";
  const initCat = params.get("cat") ? Number(params.get("cat")) : "all" as any;

  const { isAdmin } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();

  const [searchQ, setSearchQ] = useState("");
  const [filterSection, setFilterSection] = useState<string>(initSection);
  const [filterCat, setFilterCat] = useState<number | "all">(initCat);
  const [filterLevel, setFilterLevel] = useState<string>("all");

  // Move modal
  const [moveProduct, setMoveProduct] = useState<Product | null>(null);
  const [moveType, setMoveType] = useState<"carico" | "scarico" | "rettifica">("carico");
  const [moveQty, setMoveQty] = useState("1");
  const [moveNote, setMoveNote] = useState("");

  // Edit product modal
  const [editProduct, setEditProduct] = useState<Product | null>(null);
  const [isNewProduct, setIsNewProduct] = useState(false);
  const [productForm, setProductForm] = useState({
    name: "", brand: "", unit: "pz", unitSize: "", categoryId: "",
    currentStock: "0", minStock: "2", idealStock: "5", location: "", notes: "",
  });
  // True quando l'utente ha selezionato la categoria a mano (non auto-suggest).
  const [categoryManuallySet, setCategoryManuallySet] = useState(false);
  // True quando la categoria corrente è stata scelta dall'auto-suggest.
  const [categoryAutoSuggested, setCategoryAutoSuggested] = useState(false);

  const { data: products = [], isLoading } = useQuery<Product[]>({
    queryKey: ["/api/products"], refetchInterval: 10000,
  });
  const { data: categories = [] } = useQuery<Category[]>({ queryKey: ["/api/categories"] });

  const catMap = Object.fromEntries(categories.map(c => [c.id, c]));

  const filtered = useMemo(() => {
    return products.filter(p => {
      if (!p.active) return false;
      const cat = catMap[p.categoryId];
      if (filterSection !== "all" && cat?.section !== filterSection) return false;
      if (filterCat !== "all" && p.categoryId !== filterCat) return false;
      const level = stockLevel(p);
      if (filterLevel !== "all" && level !== filterLevel) return false;
      if (searchQ && !p.name.toLowerCase().includes(searchQ.toLowerCase())
        && !p.brand.toLowerCase().includes(searchQ.toLowerCase())) return false;
      return true;
    });
  }, [products, filterSection, filterCat, filterLevel, searchQ, catMap]);

  // Sort: esauriti → bassi → ok
  const sorted = [...filtered].sort((a, b) => {
    const order = { out: 0, low: 1, ok: 2 };
    return order[stockLevel(a)] - order[stockLevel(b)];
  });

  const doMove = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", "/api/movements", {
        productId: moveProduct!.id,
        type: moveType,
        quantity: parseFloat(moveQty),
        stockBefore: moveProduct!.currentStock,
        stockAfter: 0, // will be recalculated server side
        note: moveNote,
        userId: "",
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/products"] });
      qc.invalidateQueries({ queryKey: ["/api/stats/summary"] });
      qc.invalidateQueries({ queryKey: ["/api/stats/activity"] });
      qc.invalidateQueries({ queryKey: ["/api/movements"] });
      setMoveProduct(null); setMoveQty("1"); setMoveNote("");
      toast({ title: "✅ Movimento registrato" });
    },
    onError: (e: any) => toast({ title: "Errore", description: e.message, variant: "destructive" }),
  });

  // Patch rapida di un singolo campo (per InlineEdit).
  const patchProduct = useMutation({
    mutationFn: async ({ id, patch }: { id: number; patch: Partial<Product> }) => {
      const res = await apiRequest("PUT", `/api/products/${id}`, patch);
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/products"] });
      qc.invalidateQueries({ queryKey: ["/api/stats/summary"] });
      qc.invalidateQueries({ queryKey: ["/api/sheet/current"] });
    },
    onError: (e: any) => toast({ title: "Errore", description: e.message, variant: "destructive" }),
  });

  const saveProduct = useMutation({
    mutationFn: async () => {
      const payload = {
        name: productForm.name, brand: productForm.brand,
        unit: productForm.unit, unitSize: productForm.unitSize,
        categoryId: Number(productForm.categoryId),
        currentStock: parseFloat(productForm.currentStock),
        minStock: parseFloat(productForm.minStock),
        idealStock: parseFloat(productForm.idealStock),
        location: productForm.location, notes: productForm.notes, active: true,
      };
      if (isNewProduct) return (await apiRequest("POST", "/api/products", payload)).json();
      return (await apiRequest("PUT", `/api/products/${editProduct!.id}`, payload)).json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/products"] });
      qc.invalidateQueries({ queryKey: ["/api/stats/summary"] });
      setEditProduct(null); setIsNewProduct(false);
      toast({ title: isNewProduct ? "✅ Prodotto aggiunto" : "✅ Prodotto aggiornato" });
    },
  });

  // Auto-suggest categoria in base a nome+marca, finché l'utente non sceglie a mano.
  useEffect(() => {
    if (!isNewProduct) return;
    if (categoryManuallySet) return;
    const suggested = suggestCategoryId(productForm.name, productForm.brand, products, categories);
    if (suggested === null) return;
    const suggestedStr = String(suggested);
    if (productForm.categoryId !== suggestedStr) {
      setProductForm(f => ({ ...f, categoryId: suggestedStr }));
      setCategoryAutoSuggested(true);
    }
  }, [productForm.name, productForm.brand, isNewProduct, categoryManuallySet, products, categories]);

  const openNew = () => {
    setProductForm({ name: "", brand: "", unit: "pz", unitSize: "", categoryId: "",
      currentStock: "0", minStock: "2", idealStock: "5", location: "", notes: "" });
    setIsNewProduct(true); setEditProduct(null);
    setCategoryManuallySet(false);
    setCategoryAutoSuggested(false);
  };
  const openEdit = (p: Product) => {
    setProductForm({
      name: p.name, brand: p.brand, unit: p.unit, unitSize: p.unitSize,
      categoryId: p.categoryId.toString(),
      currentStock: p.currentStock.toString(),
      minStock: p.minStock.toString(),
      idealStock: p.idealStock.toString(),
      location: p.location, notes: p.notes,
    });
    setEditProduct(p); setIsNewProduct(false);
    setCategoryManuallySet(true);  // in edit la categoria esistente è scelta
    setCategoryAutoSuggested(false);
  };

  const sectionCats = filterSection === "all"
    ? categories
    : categories.filter(c => c.section === filterSection);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="px-6 py-4 border-b shrink-0 flex items-center justify-between gap-4">
        <div>
          <h1 className="font-display font-bold text-xl">Scorte</h1>
          <p className="text-sm text-muted-foreground">{sorted.length} prodotti filtrati</p>
        </div>
        {isAdmin && (
          <Button onClick={openNew} data-testid="button-new-product">
            <Plus className="w-4 h-4 mr-1.5" /> Nuovo Prodotto
          </Button>
        )}
      </div>

      {/* Filters */}
      <div className="px-6 py-3 border-b flex flex-wrap gap-2 items-center shrink-0">
        {/* Search */}
        <div className="relative flex-1 min-w-48 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
          <input value={searchQ} onChange={e => setSearchQ(e.target.value)}
            placeholder="Cerca prodotto…" data-testid="input-search"
            className="w-full pl-9 pr-4 py-2 text-sm rounded-lg bg-muted border-0 outline-none focus:ring-2 focus:ring-primary/50" />
          {searchQ && <button onClick={() => setSearchQ("")} className="absolute right-3 top-1/2 -translate-y-1/2"><X className="w-3.5 h-3.5 text-muted-foreground" /></button>}
        </div>

        {/* Section */}
        {["all", "bevande", "cucina"].map(s => (
          <button key={s} onClick={() => { setFilterSection(s); setFilterCat("all"); }}
            className={`px-3 py-1.5 text-xs rounded-full font-medium transition-all ${filterSection === s ? "pill-active" : "pill-idle"}`}>
            {s === "all" ? "Tutti" : s === "bevande" ? "🍺 Bevande" : "🍕 Cucina"}
          </button>
        ))}

        {/* Category */}
        {sectionCats.length > 0 && (
          <Select value={filterCat === "all" ? "all" : String(filterCat)} onValueChange={v => setFilterCat(v === "all" ? "all" : Number(v))}>
            <SelectTrigger className="h-8 text-xs w-44" data-testid="select-filter-cat">
              <SelectValue placeholder="Categoria" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tutte le categorie</SelectItem>
              {sectionCats.map(c => <SelectItem key={c.id} value={String(c.id)}>{c.icon} {c.name}</SelectItem>)}
            </SelectContent>
          </Select>
        )}

        {/* Level */}
        {["all", "out", "low", "ok"].map(l => (
          <button key={l} onClick={() => setFilterLevel(l)}
            className={`px-3 py-1.5 text-xs rounded-full font-medium transition-all ${filterLevel === l ? "pill-active" : "pill-idle"}`}>
            {l === "all" ? "Tutti" : l === "out" ? "🔴 Esauriti" : l === "low" ? "🟡 Bassi" : "🟢 OK"}
          </button>
        ))}
      </div>

      {/* Product table */}
      {isLoading ? (
        <div className="flex-1 p-6 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 9 }).map((_, i) => <div key={i} className="h-28 rounded-xl bg-muted animate-pulse" />)}
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto scrollbar-thin">
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-10">
              <tr style={{ background: "hsl(var(--muted))" }}>
                <th className="text-left px-5 py-3 text-xs font-semibold text-muted-foreground w-8"></th>
                <th className="text-left px-2 py-3 text-xs font-semibold text-muted-foreground">Prodotto</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground hidden md:table-cell">Posizione</th>
                <th className="text-center px-4 py-3 text-xs font-semibold text-muted-foreground">Scorta</th>
                <th className="text-center px-4 py-3 text-xs font-semibold text-muted-foreground hidden sm:table-cell">Livello</th>
                <th className="text-right px-5 py-3 text-xs font-semibold text-muted-foreground">Azioni</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map(p => {
                const level = stockLevel(p);
                const pct = stockPercent(p);
                const cat = catMap[p.categoryId];
                const dotColor = LEVEL_COLORS[level];
                return (
                  <tr key={p.id} data-testid={`row-product-${p.id}`}
                    className="border-t transition-colors hover:bg-muted/20"
                    style={{ borderColor: "hsl(var(--border))" }}>
                    {/* Status dot */}
                    <td className="px-5 py-3">
                      <div className={`w-2.5 h-2.5 rounded-full ${level === "out" ? "pulse-out" : level === "low" ? "pulse-low" : ""}`}
                        style={{ background: dotColor }} />
                    </td>
                    {/* Name (inline edit) */}
                    <td className="px-2 py-3">
                      <div className="flex items-center gap-2">
                        <span className="text-base leading-none">{cat?.icon ?? "📦"}</span>
                        <div className="min-w-0">
                          <InlineEdit
                            value={p.name}
                            disabled={!isAdmin}
                            onSave={(v) => patchProduct.mutateAsync({ id: p.id, patch: { name: String(v) } })}
                            className="font-medium"
                            testId={`inline-name-${p.id}`}
                          />
                          <div className="text-xs text-muted-foreground flex items-center gap-1.5">
                            <InlineEdit
                              value={p.brand}
                              disabled={!isAdmin}
                              placeholder="marca"
                              onSave={(v) => patchProduct.mutateAsync({ id: p.id, patch: { brand: String(v) } })}
                              testId={`inline-brand-${p.id}`}
                            />
                            {p.unitSize && <span>· {p.unitSize}</span>}
                          </div>
                        </div>
                      </div>
                    </td>
                    {/* Location (inline) */}
                    <td className="px-4 py-3 hidden md:table-cell">
                      <InlineEdit
                        value={p.location}
                        disabled={!isAdmin}
                        placeholder="posizione"
                        onSave={(v) => patchProduct.mutateAsync({ id: p.id, patch: { location: String(v) } })}
                        className="text-xs text-muted-foreground"
                        testId={`inline-location-${p.id}`}
                      />
                    </td>
                    {/* Stock + min (inline) */}
                    <td className="px-4 py-3 text-center">
                      <div className="flex flex-col items-center gap-1.5">
                        <span className="font-bold tabular-nums text-base" style={{ color: dotColor }}>
                          {p.currentStock}
                        </span>
                        <span className="text-xs text-muted-foreground">{p.unit}</span>
                        <div className="stock-bar-track w-20">
                          <div className="stock-bar-fill" style={{ width: `${pct}%`, background: dotColor }} />
                        </div>
                        <div className="text-xs text-muted-foreground flex items-center gap-1">
                          <span>min</span>
                          <InlineEdit
                            value={p.minStock}
                            type="number"
                            disabled={!isAdmin}
                            onSave={(v) => patchProduct.mutateAsync({ id: p.id, patch: { minStock: Number(v) } })}
                            align="center"
                            inputClassName="w-12"
                            testId={`inline-min-${p.id}`}
                          />
                        </div>
                      </div>
                    </td>
                    {/* Level badge */}
                    <td className="px-4 py-3 text-center hidden sm:table-cell">
                      <span className="text-xs font-medium px-2 py-1 rounded-full"
                        style={{ background: `${dotColor}20`, color: dotColor }}>
                        {LEVEL_LABELS[level]}
                      </span>
                    </td>
                    {/* Actions */}
                    <td className="px-5 py-3">
                      <div className="flex items-center justify-end gap-1">
                        <button data-testid={`button-carico-${p.id}`}
                          onClick={() => { setMoveProduct(p); setMoveType("carico"); setMoveQty("1"); setMoveNote(""); }}
                          title="Carico" className="w-8 h-8 rounded-lg flex items-center justify-center transition-all hover:bg-primary/10"
                          style={{ color: "hsl(var(--status-carico))" }}>
                          <ArrowUpCircle className="w-4 h-4" />
                        </button>
                        <button data-testid={`button-scarico-${p.id}`}
                          onClick={() => { setMoveProduct(p); setMoveType("scarico"); setMoveQty("1"); setMoveNote(""); }}
                          title="Scarico" className="w-8 h-8 rounded-lg flex items-center justify-center transition-all hover:bg-destructive/10"
                          style={{ color: "hsl(var(--status-scarico))" }}>
                          <ArrowDownCircle className="w-4 h-4" />
                        </button>
                        {isAdmin && (
                          <button data-testid={`button-edit-${p.id}`}
                            onClick={() => openEdit(p)}
                            title="Modifica" className="w-8 h-8 rounded-lg flex items-center justify-center transition-all hover:bg-muted"
                            style={{ color: "hsl(var(--muted-foreground))" }}>
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* ─── Move Dialog ─────────────────────────────────────────────────────── */}
      <Dialog open={!!moveProduct} onOpenChange={() => setMoveProduct(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="font-display">
              {moveType === "carico" ? "📦 Carico" : moveType === "scarico" ? "📤 Scarico" : "✏️ Rettifica"} — {moveProduct?.name}
            </DialogTitle>
          </DialogHeader>
          <div className="py-4 space-y-4">
            {/* Type selector */}
            <div className="grid grid-cols-3 gap-2">
              {(["carico", "scarico", "rettifica"] as const).map(t => (
                <button key={t} data-testid={`button-type-${t}`}
                  onClick={() => setMoveType(t)}
                  className="py-2.5 px-3 rounded-xl text-sm font-medium capitalize transition-all border"
                  style={moveType === t ? {
                    background: `hsl(var(--status-${t === "rettifica" ? "rettifica" : t === "carico" ? "carico" : "scarico"}) / 0.15)`,
                    color: `hsl(var(--status-${t === "rettifica" ? "rettifica" : t === "carico" ? "carico" : "scarico"}))`,
                    borderColor: `hsl(var(--status-${t === "rettifica" ? "rettifica" : t === "carico" ? "carico" : "scarico"}) / 0.5)`,
                  } : { borderColor: "hsl(var(--border))", color: "hsl(var(--muted-foreground))" }}>
                  {t === "carico" ? "📦 Carico" : t === "scarico" ? "📤 Scarico" : "✏️ Rettifica"}
                </button>
              ))}
            </div>

            {/* Stock preview */}
            <div className="flex items-center justify-between p-3 rounded-xl bg-muted/50">
              <div>
                <p className="text-xs text-muted-foreground">Scorta attuale</p>
                <p className="font-bold tabular-nums text-xl">{moveProduct?.currentStock} <span className="text-sm font-normal text-muted-foreground">{moveProduct?.unit}</span></p>
              </div>
              <div className="text-2xl">→</div>
              <div className="text-right">
                <p className="text-xs text-muted-foreground">Dopo il movimento</p>
                <p className="font-bold tabular-nums text-xl" style={{ color: "hsl(var(--primary))" }}>
                  {moveType === "carico"
                    ? (moveProduct?.currentStock ?? 0) + (parseFloat(moveQty) || 0)
                    : moveType === "scarico"
                      ? Math.max(0, (moveProduct?.currentStock ?? 0) - (parseFloat(moveQty) || 0))
                      : parseFloat(moveQty) || 0
                  } <span className="text-sm font-normal text-muted-foreground">{moveProduct?.unit}</span>
                </p>
              </div>
            </div>

            {/* Quantity */}
            <div className="space-y-1.5">
              <Label>{moveType === "rettifica" ? "Nuova quantità" : "Quantità"}</Label>
              <div className="flex items-center gap-2">
                <button onClick={() => setMoveQty(q => String(Math.max(0.5, parseFloat(q) - (parseFloat(q) % 1 === 0 ? 1 : 0.5))))}
                  className="w-10 h-10 rounded-lg border flex items-center justify-center text-lg font-bold hover:bg-muted transition-colors">−</button>
                <Input type="number" step="0.5" min="0" data-testid="input-qty"
                  value={moveQty} onChange={e => setMoveQty(e.target.value)}
                  className="flex-1 text-center text-lg font-bold tabular-nums" />
                <button onClick={() => setMoveQty(q => String(parseFloat(q) + 1))}
                  className="w-10 h-10 rounded-lg border flex items-center justify-center text-lg font-bold hover:bg-muted transition-colors">+</button>
                <span className="text-sm text-muted-foreground">{moveProduct?.unit}</span>
              </div>
              {/* Quick qty buttons */}
              <div className="flex gap-1.5 flex-wrap">
                {[0.5, 1, 2, 5, 10, 25].map(n => (
                  <button key={n} onClick={() => setMoveQty(String(n))}
                    className="px-2.5 py-1 text-xs rounded-md bg-muted hover:bg-muted/80 transition-colors tabular-nums">
                    {n}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Note <span className="text-muted-foreground">(opzionale)</span></Label>
              <Textarea data-testid="input-note" value={moveNote} onChange={e => setMoveNote(e.target.value)}
                placeholder="es. Consegna Martedì, scadenza…" className="resize-none" rows={2} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMoveProduct(null)}>Annulla</Button>
            <Button onClick={() => doMove.mutate()} disabled={doMove.isPending || !moveQty || parseFloat(moveQty) < 0}
              data-testid="button-confirm-move">
              {doMove.isPending ? "Salvataggio…" : "Conferma"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ─── Product Edit Dialog ─────────────────────────────────────────────── */}
      <Dialog open={isNewProduct || !!editProduct} onOpenChange={() => { setEditProduct(null); setIsNewProduct(false); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="font-display">{isNewProduct ? "Nuovo Prodotto" : `Modifica: ${editProduct?.name}`}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2 max-h-[65vh] overflow-y-auto scrollbar-thin pr-1">
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2 space-y-1.5">
                <Label>Nome prodotto</Label>
                <Input data-testid="input-product-name" value={productForm.name} onChange={e => setProductForm(f => ({ ...f, name: e.target.value }))} placeholder="es. Fusto Birra Chiara" />
              </div>
              <div className="space-y-1.5">
                <Label>Marca</Label>
                <Input data-testid="input-product-brand" value={productForm.brand} onChange={e => setProductForm(f => ({ ...f, brand: e.target.value }))} placeholder="es. Moretti" />
              </div>
              <div className="space-y-1.5">
                <Label className="flex items-center gap-1.5">
                  Categoria
                  {categoryAutoSuggested && !categoryManuallySet && productForm.categoryId && (
                    <span
                      className="inline-flex items-center gap-0.5 text-[10px] uppercase tracking-wide font-medium px-1.5 py-0.5 rounded"
                      style={{ background: "hsl(var(--primary) / 0.12)", color: "hsl(var(--primary))" }}
                      title="Categoria suggerita dal nome — modificala se non è quella giusta"
                    >
                      <Sparkles className="w-2.5 h-2.5" />
                      auto
                    </span>
                  )}
                </Label>
                <Select
                  value={productForm.categoryId}
                  onValueChange={v => {
                    setProductForm(f => ({ ...f, categoryId: v }));
                    setCategoryManuallySet(true);
                    setCategoryAutoSuggested(false);
                  }}
                >
                  <SelectTrigger data-testid="select-product-cat"><SelectValue placeholder="Seleziona…" /></SelectTrigger>
                  <SelectContent>
                    {categories.map(c => <SelectItem key={c.id} value={String(c.id)}>{c.icon} {c.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Unità di misura</Label>
                <Select value={productForm.unit} onValueChange={v => setProductForm(f => ({ ...f, unit: v }))}>
                  <SelectTrigger data-testid="select-product-unit"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {UNITS.map(u => <SelectItem key={u} value={u}>{u}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Descrizione unità</Label>
                <Input data-testid="input-product-unitsize" value={productForm.unitSize} onChange={e => setProductForm(f => ({ ...f, unitSize: e.target.value }))} placeholder="es. 24 bt 0.5lt" />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <Label>Scorta attuale</Label>
                <Input type="number" step="0.5" min="0" data-testid="input-current-stock" value={productForm.currentStock} onChange={e => setProductForm(f => ({ ...f, currentStock: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label>Scorta minima ⚠️</Label>
                <Input type="number" step="0.5" min="0" data-testid="input-min-stock" value={productForm.minStock} onChange={e => setProductForm(f => ({ ...f, minStock: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label>Scorta ideale</Label>
                <Input type="number" step="0.5" min="0" data-testid="input-ideal-stock" value={productForm.idealStock} onChange={e => setProductForm(f => ({ ...f, idealStock: e.target.value }))} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Posizione in magazzino</Label>
              <Input data-testid="input-product-location" value={productForm.location} onChange={e => setProductForm(f => ({ ...f, location: e.target.value }))} placeholder="es. Cantina, Frigo 1, Dispensa" />
            </div>
            <div className="space-y-1.5">
              <Label>Note</Label>
              <Textarea data-testid="input-product-notes" value={productForm.notes} onChange={e => setProductForm(f => ({ ...f, notes: e.target.value }))} className="resize-none" rows={2} placeholder="Fornitore, scadenza, varianti…" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setEditProduct(null); setIsNewProduct(false); }}>Annulla</Button>
            <Button onClick={() => saveProduct.mutate()} disabled={saveProduct.isPending || !productForm.name || !productForm.categoryId} data-testid="button-save-product">
              {saveProduct.isPending ? "Salvataggio…" : "Salva"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

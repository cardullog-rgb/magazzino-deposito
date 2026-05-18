import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowUpCircle, ArrowDownCircle, RefreshCw, History, FileText } from "lucide-react";
import type { Movement, Product, Category, Sheet } from "@shared/schema";

const TYPE_CONFIG: Record<string, { icon: any; color: string; label: string; sign: string }> = {
  carico:    { icon: ArrowUpCircle,   color: "hsl(var(--status-carico))",    label: "Entrata",   sign: "+" },
  scarico:   { icon: ArrowDownCircle, color: "hsl(var(--status-scarico))",   label: "Uscita",    sign: "−" },
  rettifica: { icon: RefreshCw,       color: "hsl(var(--status-rettifica))", label: "Rettifica", sign: ""  },
};

export default function StoricoPage() {
  const [filterType, setFilterType] = useState<string>("all");
  const [selectedSheet, setSelectedSheet] = useState<string>("current"); // "current" | "all" | "<id>"

  const { data: sheets = [] } = useQuery<Sheet[]>({ queryKey: ["/api/sheets"] });
  const { data: products = [] } = useQuery<Product[]>({ queryKey: ["/api/products"] });
  const { data: categories = [] } = useQuery<Category[]>({ queryKey: ["/api/categories"] });

  // Costruisco la query key con sheetId esplicito (currentSheet o all o id)
  const sheetIdParam: string =
    selectedSheet === "current"
      ? "" // default backend = foglio corrente
      : selectedSheet === "all"
        ? "?sheetId=all"
        : `?sheetId=${selectedSheet}`;

  const { data: movements = [], isLoading } = useQuery<Movement[]>({
    queryKey: [`/api/movements${sheetIdParam}`],
  });

  const productMap = useMemo(() => Object.fromEntries(products.map(p => [p.id, p])), [products]);
  const catMap = useMemo(() => Object.fromEntries(categories.map(c => [c.id, c])), [categories]);

  const filtered = useMemo(() => {
    return movements.filter(m => filterType === "all" || m.type === filterType);
  }, [movements, filterType]);

  // Riassunto
  const summary = useMemo(() => {
    const tot = filtered.length;
    const entrate = filtered.filter(m => m.type === "carico").reduce((s, m) => s + m.quantity, 0);
    const uscite = filtered.filter(m => m.type === "scarico").reduce((s, m) => s + m.quantity, 0);
    return { tot, entrate, uscite };
  }, [filtered]);

  // Raggruppa per giorno
  const grouped = useMemo(() => {
    const m = new Map<string, Movement[]>();
    for (const mv of filtered) {
      const key = new Date(mv.createdAt).toLocaleDateString("it-IT", {
        weekday: "long", day: "numeric", month: "long",
      });
      if (!m.has(key)) m.set(key, []);
      m.get(key)!.push(mv);
    }
    return Array.from(m.entries());
  }, [filtered]);

  // Etichetta del foglio scelto
  const selectedSheetLabel = useMemo(() => {
    if (selectedSheet === "current") {
      const cur = sheets.find(s => s.status === "open");
      return cur?.name ?? "Foglio corrente";
    }
    if (selectedSheet === "all") return "Tutti i fogli";
    const s = sheets.find(x => String(x.id) === selectedSheet);
    return s?.name ?? "Foglio";
  }, [selectedSheet, sheets]);

  return (
    <div className="flex flex-col h-full overflow-hidden">

      {/* Header */}
      <div className="px-5 py-3 border-b shrink-0 flex items-center justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <h1 className="text-base sm:text-lg font-semibold leading-tight flex items-center gap-2">
            <History className="w-4 h-4 text-muted-foreground" />
            Storico
          </h1>
          <p className="text-xs text-muted-foreground truncate">{selectedSheetLabel}</p>
        </div>
      </div>

      {/* Filtri */}
      <div className="px-5 py-2.5 border-b flex items-center gap-2 flex-wrap shrink-0">
        <Select value={selectedSheet} onValueChange={setSelectedSheet}>
          <SelectTrigger className="h-9 text-xs w-56" data-testid="select-sheet">
            <SelectValue placeholder="Seleziona foglio" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="current">Foglio corrente</SelectItem>
            <SelectItem value="all">Tutti i fogli</SelectItem>
            {sheets.filter(s => s.status === "closed").map(s => (
              <SelectItem key={s.id} value={String(s.id)}>
                {s.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={filterType} onValueChange={setFilterType}>
          <SelectTrigger className="h-9 text-xs w-36" data-testid="select-filter-type">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Tutti i tipi</SelectItem>
            <SelectItem value="carico">Entrate</SelectItem>
            <SelectItem value="scarico">Uscite</SelectItem>
            <SelectItem value="rettifica">Rettifiche</SelectItem>
          </SelectContent>
        </Select>

        {/* Riassunto */}
        <div className="ml-auto flex items-center gap-4 text-xs">
          <div>
            <span className="text-muted-foreground">Movimenti </span>
            <span className="font-mono tabular-nums font-medium">{summary.tot}</span>
          </div>
          <div>
            <span className="text-muted-foreground">Entrate </span>
            <span className="font-mono tabular-nums font-medium" style={{ color: "hsl(var(--status-carico))" }}>
              +{summary.entrate.toFixed(0)}
            </span>
          </div>
          <div>
            <span className="text-muted-foreground">Uscite </span>
            <span className="font-mono tabular-nums font-medium" style={{ color: "hsl(var(--status-scarico))" }}>
              −{summary.uscite.toFixed(0)}
            </span>
          </div>
        </div>
      </div>

      {/* Lista */}
      <div className="flex-1 overflow-y-auto scrollbar-thin">
        {isLoading ? (
          <div className="p-5 space-y-2">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="h-12 rounded bg-muted animate-pulse" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-3 p-8">
            <FileText className="w-10 h-10 text-muted-foreground opacity-40" />
            <p className="text-sm text-muted-foreground">Nessun movimento per i filtri scelti</p>
          </div>
        ) : (
          <div>
            {grouped.map(([dateKey, dayMoves]) => (
              <div key={dateKey}>
                <div className="px-5 py-1.5 sticky top-0 z-10 flex items-center gap-2 bg-muted/80 backdrop-blur border-b">
                  <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide capitalize">
                    {dateKey}
                  </span>
                  <span className="text-[11px] text-muted-foreground/70">· {dayMoves.length}</span>
                </div>

                <div>
                  {dayMoves.map(m => {
                    const product = productMap[m.productId];
                    const cat = product ? catMap[product.categoryId] : null;
                    const tc = TYPE_CONFIG[m.type] ?? TYPE_CONFIG.rettifica;
                    const Icon = tc.icon;

                    return (
                      <div
                        key={m.id}
                        data-testid={`row-move-${m.id}`}
                        className="px-5 py-2 flex items-center gap-3 border-b hover:bg-muted/30 transition-colors"
                      >
                        <Icon className="w-3.5 h-3.5 flex-shrink-0" style={{ color: tc.color }} />

                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5">
                            {cat && <span className="text-xs">{cat.icon}</span>}
                            <p className="text-sm truncate">{product?.name ?? `#${m.productId}`}</p>
                          </div>
                          <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                            <span className="font-mono tabular-nums">
                              {m.stockBefore} → {m.stockAfter} {product?.unit}
                            </span>
                            {m.note && <><span>·</span><span className="italic truncate max-w-[180px]">{m.note}</span></>}
                          </div>
                        </div>

                        <div className="text-right shrink-0">
                          <span className="font-mono tabular-nums text-sm font-semibold" style={{ color: tc.color }}>
                            {tc.sign}{Math.abs(m.type === "rettifica" ? m.stockAfter - m.stockBefore : m.quantity).toFixed(0)}
                          </span>
                          <p className="text-[10px] text-muted-foreground tabular-nums">
                            {new Date(m.createdAt).toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" })}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

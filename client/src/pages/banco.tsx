import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Plus, Minus, Undo2, X, Search } from "lucide-react";
import type { Product, Category, Sheet, SheetRow } from "@shared/schema";

type EnrichedRow = SheetRow & { product: Product; category: Category };
type CurrentSheet = { sheet: Sheet; rows: EnrichedRow[] };

const MACRO_ORDER = ["acqua", "analcolici", "birre", "vini", "alcolici", "cucina", "sala", "altro"];
const MACRO_LABELS: Record<string, string> = {
  acqua: "Acqua",
  analcolici: "Bibite",
  birre: "Birre",
  vini: "Vini",
  alcolici: "Alcolici",
  cucina: "Cucina",
  sala: "Sala",
  altro: "Altro",
};

function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1).replace(/\.0$/, "");
}

function statusColor(row: EnrichedRow): string {
  const stock = row.finalCalculated;
  if (stock <= 0) return "hsl(var(--status-out))";
  if (stock <= row.product.minStock) return "hsl(var(--status-low))";
  return "hsl(var(--status-ok))";
}

export default function BancoPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [filterMacro, setFilterMacro] = useState<string>("all");

  const { data, isLoading, isError } = useQuery<CurrentSheet>({
    queryKey: ["/api/sheet/current"],
    refetchInterval: 30000,
  });

  // Ultima azione (barra Annulla)
  const [lastAction, setLastAction] = useState<{
    movementId: number;
    productName: string;
    type: "entrata" | "uscita";
    quantity: number;
    unit: string;
  } | null>(null);
  const undoTimerRef = useRef<number | null>(null);
  useEffect(() => () => { if (undoTimerRef.current) window.clearTimeout(undoTimerRef.current); }, []);

  function scheduleUndoHide() {
    if (undoTimerRef.current) window.clearTimeout(undoTimerRef.current);
    undoTimerRef.current = window.setTimeout(() => setLastAction(null), 15000);
  }

  const movementMut = useMutation({
    mutationFn: async (vars: { row: EnrichedRow; type: "entrata" | "uscita" }) => {
      const res = await apiRequest("POST", "/api/sheet/movement", {
        productId: vars.row.product.id,
        type: vars.type,
        quantity: 1,
      });
      const json = await res.json();
      return { ...json, _row: vars.row, _type: vars.type };
    },
    onSuccess: (json: any) => {
      qc.invalidateQueries({ queryKey: ["/api/sheet/current"] });
      qc.invalidateQueries({ queryKey: ["/api/products"] });
      qc.invalidateQueries({ queryKey: ["/api/movements"] });
      if (json?.movement) {
        setLastAction({
          movementId: json.movement.id,
          productName: json._row.product.name,
          type: json._type,
          quantity: 1,
          unit: json._row.product.unit,
        });
        scheduleUndoHide();
      }
    },
    onError: (e: any) => toast({ title: "Errore", description: e.message, variant: "destructive" }),
  });

  const undoMut = useMutation({
    mutationFn: async (movementId: number) => {
      const res = await apiRequest("POST", "/api/sheet/movement/undo", { movementId });
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/sheet/current"] });
      qc.invalidateQueries({ queryKey: ["/api/products"] });
      qc.invalidateQueries({ queryKey: ["/api/movements"] });
      setLastAction(null);
      if (undoTimerRef.current) window.clearTimeout(undoTimerRef.current);
    },
    onError: (e: any) => toast({ title: "Errore annullamento", description: e.message, variant: "destructive" }),
  });

  // Raggruppamento per macroCategory
  const groups = useMemo(() => {
    if (!data) return [];
    const m = new Map<string, { macro: string; rows: EnrichedRow[] }>();
    for (const r of data.rows) {
      if (!r.product.active) continue;
      const macro = r.category.macroCategory || "altro";
      if (filterMacro !== "all" && macro !== filterMacro) continue;
      if (search) {
        const q = search.toLowerCase();
        if (!r.product.name.toLowerCase().includes(q)
            && !r.product.brand.toLowerCase().includes(q)
            && !r.category.name.toLowerCase().includes(q)) continue;
      }
      if (!m.has(macro)) m.set(macro, { macro, rows: [] });
      m.get(macro)!.rows.push(r);
    }
    // Ordine: MACRO_ORDER, poi le righe per nome categoria + nome prodotto
    return Array.from(m.values())
      .sort((a, b) => {
        const ai = MACRO_ORDER.indexOf(a.macro);
        const bi = MACRO_ORDER.indexOf(b.macro);
        return (ai < 0 ? 999 : ai) - (bi < 0 ? 999 : bi);
      })
      .map(g => ({
        ...g,
        rows: g.rows.sort((a, b) => {
          const co = (a.category.sortOrder ?? 0) - (b.category.sortOrder ?? 0);
          if (co !== 0) return co;
          return a.product.name.localeCompare(b.product.name, "it");
        }),
      }));
  }, [data, filterMacro, search]);

  const macroOptions = useMemo(() => {
    if (!data) return [];
    const set = new Set<string>();
    for (const r of data.rows) if (r.product.active) set.add(r.category.macroCategory || "altro");
    return MACRO_ORDER.filter(m => set.has(m));
  }, [data]);

  if (isLoading) return <div className="p-8 text-sm text-muted-foreground">Caricamento…</div>;
  if (isError || !data) return <div className="p-8 text-sm text-destructive">Errore caricamento inventario.</div>;
  if (data.rows.length === 0) return (
    <div className="p-8 text-center text-muted-foreground">
      <p className="text-base">Nessun prodotto in magazzino.</p>
      <p className="text-xs mt-2">Chiedi all'admin di aggiungere i prodotti.</p>
    </div>
  );

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* ─── HEADER + RICERCA ─────────────────────────────────────────────── */}
      <div className="px-4 sm:px-5 py-3 border-b shrink-0 space-y-2.5">
        <div className="flex items-center gap-2">
          <h1 className="text-lg font-semibold">Inventario</h1>
          <span className="text-xs text-muted-foreground">{data.rows.filter(r => r.product.active).length} prodotti</span>
        </div>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Cerca prodotto…"
            data-testid="input-search"
            className="w-full h-12 pl-10 pr-9 text-base rounded-lg bg-muted border-0 outline-none focus:ring-2 focus:ring-primary/40"
          />
          {search && (
            <button onClick={() => setSearch("")} className="absolute right-3 top-1/2 -translate-y-1/2 p-1">
              <X className="w-4 h-4 text-muted-foreground" />
            </button>
          )}
        </div>
        {/* Pulsanti macro categoria — grandi, facili da toccare */}
        <div className="flex gap-2 flex-wrap">
          <button
            onClick={() => setFilterMacro("all")}
            className={"px-4 h-10 rounded-lg text-sm font-medium transition-colors "
              + (filterMacro === "all" ? "bg-foreground text-background" : "bg-muted text-muted-foreground")}
          >
            Tutti
          </button>
          {macroOptions.map(m => (
            <button
              key={m}
              onClick={() => setFilterMacro(m)}
              data-testid={`filter-${m}`}
              className={"px-4 h-10 rounded-lg text-sm font-medium transition-colors "
                + (filterMacro === m ? "bg-foreground text-background" : "bg-muted text-muted-foreground")}
            >
              {MACRO_LABELS[m] ?? m}
            </button>
          ))}
        </div>
      </div>

      {/* ─── BARRA ANNULLA ────────────────────────────────────────────────── */}
      {lastAction && (
        <div
          className="px-4 sm:px-5 py-2.5 border-b shrink-0 flex items-center gap-3"
          style={{ background: "hsl(var(--muted) / 0.6)" }}
          data-testid="undo-bar"
        >
          <div className="flex-1 min-w-0 text-sm">
            <span className="text-muted-foreground">
              {lastAction.type === "entrata" ? "Aggiunto " : "Tolto "}
            </span>
            <span
              className="font-mono tabular-nums font-semibold"
              style={{ color: lastAction.type === "entrata" ? "hsl(var(--status-carico))" : "hsl(var(--status-scarico))" }}
            >
              {lastAction.type === "entrata" ? "+" : "−"}{fmt(lastAction.quantity)}
            </span>
            <span className="text-muted-foreground"> · </span>
            <span className="truncate font-medium">{lastAction.productName}</span>
          </div>
          <button
            onClick={() => undoMut.mutate(lastAction.movementId)}
            disabled={undoMut.isPending}
            data-testid="button-undo"
            className="flex items-center gap-1.5 px-3 h-9 text-sm font-medium rounded-md bg-background border"
          >
            <Undo2 className="w-4 h-4" />
            Annulla
          </button>
        </div>
      )}

      {/* ─── LISTA PRODOTTI PER CATEGORIA ─────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto scrollbar-thin">
        {groups.length === 0 && (
          <div className="p-12 text-center text-sm text-muted-foreground">
            Nessun prodotto col filtro corrente.
          </div>
        )}

        {groups.map(group => (
          <section key={group.macro}>
            <div
              className="px-4 sm:px-5 py-2 border-b sticky top-0 z-10 backdrop-blur"
              style={{ background: "hsl(var(--muted) / 0.85)" }}
            >
              <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                {MACRO_LABELS[group.macro] ?? group.macro}
                <span className="font-normal text-muted-foreground/60 ml-2">· {group.rows.length}</span>
              </h2>
            </div>

            <div className="divide-y">
              {group.rows.map(row => {
                const color = statusColor(row);
                return (
                  <div
                    key={row.id}
                    data-testid={`banco-row-${row.product.id}`}
                    className="flex items-center gap-3 px-4 sm:px-5 py-3"
                  >
                    {/* Pallino stato + nome */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span
                          className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                          style={{ background: color }}
                        />
                        <p className="font-medium text-base truncate">{row.product.name}</p>
                      </div>
                      <p className="text-xs text-muted-foreground ml-4.5 truncate">
                        {row.category.icon} {row.category.name}
                        {row.product.unitSize && <span> · {row.product.unitSize}</span>}
                      </p>
                    </div>

                    {/* Pulsantone − */}
                    <button
                      onClick={() => movementMut.mutate({ row, type: "uscita" })}
                      disabled={movementMut.isPending || row.finalCalculated <= 0}
                      data-testid={`btn-meno-${row.product.id}`}
                      className="w-14 h-14 rounded-full flex items-center justify-center transition-all active:scale-90 disabled:opacity-30"
                      style={{
                        background: "hsl(var(--status-scarico) / 0.12)",
                        color: "hsl(var(--status-scarico))",
                      }}
                      aria-label={`Togli 1 ${row.product.unit}`}
                    >
                      <Minus className="w-7 h-7" strokeWidth={3} />
                    </button>

                    {/* Quantità grossa */}
                    <div
                      className="min-w-[64px] text-center"
                      style={{ color }}
                    >
                      <div className="text-3xl font-bold tabular-nums leading-none">
                        {fmt(row.finalCalculated)}
                      </div>
                      <div className="text-[11px] uppercase tracking-wide text-muted-foreground mt-1">
                        {row.product.unit}
                      </div>
                    </div>

                    {/* Pulsantone + */}
                    <button
                      onClick={() => movementMut.mutate({ row, type: "entrata" })}
                      disabled={movementMut.isPending}
                      data-testid={`btn-piu-${row.product.id}`}
                      className="w-14 h-14 rounded-full flex items-center justify-center transition-all active:scale-90"
                      style={{
                        background: "hsl(var(--status-carico) / 0.12)",
                        color: "hsl(var(--status-carico))",
                      }}
                      aria-label={`Aggiungi 1 ${row.product.unit}`}
                    >
                      <Plus className="w-7 h-7" strokeWidth={3} />
                    </button>
                  </div>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

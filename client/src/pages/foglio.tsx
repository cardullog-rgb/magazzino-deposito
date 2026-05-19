import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Search, Plus, Minus, X, AlertTriangle, Undo2, Truck } from "lucide-react";
import { MovementDialog } from "@/components/movement-dialog";
import type { Product, Category, Sheet, SheetRow } from "@shared/schema";

type EnrichedRow = SheetRow & { product: Product; category: Category };
type CurrentSheet = { sheet: Sheet; rows: EnrichedRow[] };

const MACRO_LABELS: Record<string, string> = {
  all: "Tutti",
  acqua: "Acqua",
  analcolici: "Analcolici",
  birre: "Birre",
  vini: "Vini",
  alcolici: "Alcolici",
  cucina: "Cucina",
};
// Ordine fisso di apparizione delle macro nei pulsanti filtro
const MACRO_ORDER = ["all", "acqua", "analcolici", "birre", "vini", "alcolici", "cucina"];

const STATUS = (row: EnrichedRow): "ok" | "low" | "out" => {
  const stock = row.finalCalculated;
  if (stock <= 0) return "out";
  if (stock <= row.product.minStock) return "low";
  return "ok";
};

const STATUS_COLOR: Record<string, string> = {
  ok: "hsl(var(--status-ok))",
  low: "hsl(var(--status-low))",
  out: "hsl(var(--status-out))",
};

export default function FoglioPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { isAdmin } = useAuth();

  const [macro, setMacro] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [onlyAlerts, setOnlyAlerts] = useState(false);

  const [editing, setEditing] = useState<{ row: EnrichedRow; type: "entrata" | "uscita" } | null>(null);
  const [confirmClose, setConfirmClose] = useState(false);

  // Ultima azione locale: serve per la barra "Annulla" sticky.
  // Memorizziamo solo i metadati visivi + l'id del movimento per l'undo server-side.
  const [lastAction, setLastAction] = useState<{
    movementId: number;
    productName: string;
    type: "entrata" | "uscita";
    quantity: number;
    unit: string;
  } | null>(null);
  const undoTimerRef = useRef<number | null>(null);

  const { data, isLoading, isError } = useQuery<CurrentSheet>({
    queryKey: ["/api/sheet/current"],
    refetchInterval: 30000,
  });

  // Pulizia timer all'unmount.
  useEffect(() => () => {
    if (undoTimerRef.current) window.clearTimeout(undoTimerRef.current);
  }, []);

  function scheduleUndoHide() {
    if (undoTimerRef.current) window.clearTimeout(undoTimerRef.current);
    undoTimerRef.current = window.setTimeout(() => setLastAction(null), 12000);
  }

  // ─── Filtraggio ─────────────────────────────────────────────────────────
  const macroCategories = useMemo(() => {
    if (!data) return ["all"];
    const set = new Set<string>(data.rows.map(r => r.category.macroCategory || "altro"));
    set.add("all");
    // Ordine fisso prima, eventuali macro extra (es. "altro") in coda
    const ordered = MACRO_ORDER.filter(m => set.has(m));
    const extras = Array.from(set).filter(m => !MACRO_ORDER.includes(m)).sort();
    return [...ordered, ...extras];
  }, [data]);

  const filteredRows = useMemo(() => {
    if (!data) return [];
    return data.rows.filter(r => {
      if (!r.product.active) return false;
      if (macro !== "all" && r.category.macroCategory !== macro) return false;
      if (onlyAlerts && STATUS(r) === "ok") return false;
      if (search) {
        const q = search.toLowerCase();
        const hit = r.product.name.toLowerCase().includes(q)
          || r.product.brand.toLowerCase().includes(q)
          || r.category.name.toLowerCase().includes(q);
        if (!hit) return false;
      }
      return true;
    });
  }, [data, macro, search, onlyAlerts]);

  // Raggruppa per categoria
  const grouped = useMemo(() => {
    const m = new Map<string, { category: Category; rows: EnrichedRow[] }>();
    for (const r of filteredRows) {
      const key = r.category.name;
      if (!m.has(key)) m.set(key, { category: r.category, rows: [] });
      m.get(key)!.rows.push(r);
    }
    return Array.from(m.values()).sort((a, b) => (a.category.sortOrder ?? 0) - (b.category.sortOrder ?? 0));
  }, [filteredRows]);

  const alertsCount = useMemo(() => data?.rows.filter(r => r.product.active && STATUS(r) !== "ok").length ?? 0, [data]);

  // ─── Mutations ──────────────────────────────────────────────────────────
  // Movimento "lento" dal dialog (con quantità custom)
  const movementMut = useMutation({
    mutationFn: async (vars: { productId: number; type: "entrata" | "uscita"; quantity: number; note?: string }) => {
      const res = await apiRequest("POST", "/api/sheet/movement", vars);
      return res.json();
    },
    onSuccess: (data: any, vars) => {
      qc.invalidateQueries({ queryKey: ["/api/sheet/current"] });
      qc.invalidateQueries({ queryKey: ["/api/products"] });
      qc.invalidateQueries({ queryKey: ["/api/movements"] });
      const row = editing?.row;
      if (data?.movement && row) {
        setLastAction({
          movementId: data.movement.id,
          productName: row.product.name,
          type: vars.type,
          quantity: vars.quantity,
          unit: row.product.unit,
        });
        scheduleUndoHide();
      }
      setEditing(null);
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
    onError: (e: any) => {
      toast({ title: "Annullamento fallito", description: e.message, variant: "destructive" });
    },
  });

  const closeMut = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/sheet/close", {});
      return res.json();
    },
    onSuccess: () => {
      // Invalida sia foglio corrente sia elenco fogli, così lo Storico vede
      // subito il foglio appena chiuso nella tendina "fogli precedenti".
      qc.invalidateQueries({ queryKey: ["/api/sheet/current"] });
      qc.invalidateQueries({ queryKey: ["/api/sheets"] });
      qc.invalidateQueries({ queryKey: ["/api/movements"] });
      setConfirmClose(false);
      toast({ title: "Foglio chiuso", description: "Nuovo foglio aperto, il precedente è in Storico." });
    },
    onError: (e: any) => toast({ title: "Errore", description: e.message, variant: "destructive" }),
  });

  // ─── Render ─────────────────────────────────────────────────────────────
  if (isLoading) return <div className="p-8 text-sm text-muted-foreground">Caricamento foglio…</div>;
  if (isError || !data) return <div className="p-8 text-sm text-destructive">Errore caricamento foglio.</div>;

  const { sheet } = data;

  return (
    <div className="flex flex-col h-full overflow-hidden">

      {/* ─── HEADER COMPATTO ────────────────────────────────────────────── */}
      <div className="px-4 py-1.5 border-b shrink-0 flex items-center justify-between gap-2">
        <div className="min-w-0 flex items-baseline gap-2 flex-wrap">
          <h1 className="text-sm font-semibold leading-none">Inventario</h1>
          <span className="text-[11px] text-muted-foreground/70 truncate">{sheet.name}</span>
          {alertsCount > 0 && (
            <Link
              href="/lista-spesa"
              className="text-[11px] font-medium hover:underline"
              style={{ color: "hsl(var(--status-low))" }}
              data-testid="banner-da-riordinare"
            >
              · {alertsCount} da riordinare →
            </Link>
          )}
        </div>
        {isAdmin && sheet.status === "open" && (
          <div className="flex items-center gap-1.5">
            <Link href="/carico">
              <Button size="sm" variant="outline" data-testid="button-carico" className="h-7 px-2 text-xs">
                <Truck className="w-3.5 h-3.5 mr-1" />
                Carico
              </Button>
            </Link>
            <Button
              onClick={() => setConfirmClose(true)}
              variant="outline"
              size="sm"
              data-testid="button-close-sheet"
              className="h-7 px-2 text-xs"
            >
              Chiudi
            </Button>
          </div>
        )}
      </div>

      {/* ─── FILTRI ─────────────────────────────────────────────────────── */}
      <div className="px-4 sm:px-5 py-2.5 border-b flex items-center gap-2 flex-wrap shrink-0 bg-background">
        <div className="relative flex-1 min-w-44 max-w-xs">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Cerca prodotto…"
            data-testid="input-search"
            className="w-full pl-8 pr-7 py-1.5 text-sm rounded-md bg-muted border-0 outline-none focus:ring-2 focus:ring-primary/40"
          />
          {search && (
            <button onClick={() => setSearch("")} className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5">
              <X className="w-3.5 h-3.5 text-muted-foreground" />
            </button>
          )}
        </div>

        <div className="flex items-center gap-1 flex-wrap">
          {macroCategories.map(m => (
            <button
              key={m}
              data-testid={`filter-${m}`}
              onClick={() => setMacro(m)}
              className={
                "px-2.5 py-1 text-xs rounded-md transition-colors " +
                (macro === m
                  ? "bg-foreground text-background"
                  : "bg-muted text-muted-foreground hover:bg-secondary")
              }
            >
              {MACRO_LABELS[m] ?? m}
            </button>
          ))}
        </div>

        <button
          onClick={() => setOnlyAlerts(v => !v)}
          data-testid="filter-alerts"
          className={
            "ml-auto px-2.5 py-1 text-xs rounded-md flex items-center gap-1.5 transition-colors " +
            (onlyAlerts
              ? "text-white"
              : "bg-muted text-muted-foreground hover:bg-secondary")
          }
          style={onlyAlerts ? { background: "hsl(var(--status-low))" } : undefined}
        >
          <AlertTriangle className="w-3 h-3" />
          Solo sotto soglia
        </button>
      </div>

      {/* ─── TABELLA FOGLIO ──────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto scrollbar-thin relative">

        {/* Header colonne sticky */}
        <div className="sticky top-0 z-10 bg-muted/80 backdrop-blur border-b">
          <div className="flex items-center gap-3 px-4 sm:px-5 py-2 text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
            <div className="flex-1">Prodotto · Iniz · Entr · Usc · Riman</div>
            <div className="w-[150px] text-center">Scarico / Carico</div>
          </div>
        </div>

        {grouped.length === 0 && (
          <div className="p-12 text-center text-sm text-muted-foreground">
            Nessun prodotto col filtro corrente.
          </div>
        )}

        {grouped.map(group => (
          <div key={group.category.id}>
            {/* Group header */}
            <div className="px-4 sm:px-5 py-1.5 bg-muted/40 border-b text-xs font-medium flex items-center gap-2">
              <span>{group.category.icon}</span>
              <span>{group.category.name}</span>
              <span className="text-muted-foreground/70">· {group.rows.length}</span>
            </div>

            {/* Rows */}
            {group.rows.map(row => {
              const status = STATUS(row);
              const color = STATUS_COLOR[status];
              const unit = row.product.unit;
              return (
                <div
                  key={row.id}
                  data-testid={`row-${row.product.id}`}
                  className="flex items-center gap-3 px-4 sm:px-5 py-1.5 border-b hover:bg-muted/30 transition-colors"
                >
                  {/* Prodotto + riepilogo Iniz/+Entr/−Usc (la rimanenza vive
                      al centro dell'ActionGroup, niente duplicati). */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span
                        className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                        style={{ background: color }}
                        title={status}
                      />
                      <span className="text-sm truncate">{row.product.name}</span>
                    </div>
                    <div className="text-[11px] text-muted-foreground truncate ml-3 flex items-center gap-1.5 flex-wrap">
                      {row.product.brand && <span>{row.product.brand}</span>}
                      <span>{row.product.unitSize || unit}</span>
                      {row.product.packSize > 1 && (
                        <span className="text-muted-foreground/60">pack {row.product.packSize}</span>
                      )}
                      <span className="text-muted-foreground/40">·</span>
                      <span className="font-mono tabular-nums">
                        Iniz {fmt(row.initial)}
                      </span>
                      <span className="font-mono tabular-nums" style={{ color: "hsl(var(--status-carico))" }}>
                        +{fmt(row.entries)}
                      </span>
                      <span className="font-mono tabular-nums" style={{ color: "hsl(var(--status-scarico))" }}>
                        −{fmt(row.exits)}
                      </span>
                    </div>
                  </div>

                  {/* Gruppo azioni [−] rimanenza [+]
                      Tap apre sempre il dialog di conferma (scorta ora→dopo
                      + quick chip + conferma). Nessun ±1 immediato. */}
                  <ActionGroup
                    row={row}
                    stockColor={color}
                    onTap={(type) => setEditing({ row, type })}
                  />
                </div>
              );
            })}
          </div>
        ))}
      </div>

      {/* ─── DIALOG MOVIMENTO ───────────────────────────────────────────── */}
      {editing && (
        <MovementDialog
          row={editing.row}
          type={editing.type}
          onClose={() => setEditing(null)}
          onConfirm={(qty) => movementMut.mutate({ productId: editing.row.product.id, type: editing.type, quantity: qty })}
          pending={movementMut.isPending}
        />
      )}

      {/* ─── CONFERMA CHIUSURA ──────────────────────────────────────────── */}
      <Dialog open={confirmClose} onOpenChange={(o) => !o && setConfirmClose(false)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Chiudere il foglio settimanale?</DialogTitle>
          </DialogHeader>
          <div className="text-sm text-muted-foreground space-y-2 py-2">
            <p>
              Le rimanenze attuali ({alertsCount > 0 && <span style={{ color: "hsl(var(--status-low))" }}>{alertsCount} sotto soglia</span>})
              diventeranno le scorte iniziali del prossimo foglio.
            </p>
            <p className="text-xs">
              Il foglio chiuso resterà consultabile nello storico. Non sarà più modificabile.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmClose(false)}>Annulla</Button>
            <Button
              onClick={() => closeMut.mutate()}
              disabled={closeMut.isPending}
              data-testid="button-confirm-close"
            >
              {closeMut.isPending ? "Chiusura…" : "Conferma chiusura"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ─── ANNULLA: overlay flottante in basso, fuori dal flusso del layout
          così non spinge mai la tabella. Tap su ± consecutivi non muovono nulla. */}
      {lastAction && (
        <div
          className="fixed bottom-3 left-1/2 -translate-x-1/2 z-50 px-3 py-2 rounded-lg shadow-lg border flex items-center gap-3 max-w-[calc(100vw-1.5rem)] backdrop-blur"
          style={{ background: "hsl(var(--background) / 0.95)" }}
          data-testid="undo-bar"
        >
          <div className="min-w-0 text-xs">
            <span className="text-muted-foreground">
              {lastAction.type === "entrata" ? "Carico " : "Scarico "}
            </span>
            <span
              className="font-mono tabular-nums font-medium"
              style={{ color: lastAction.type === "entrata" ? "hsl(var(--status-carico))" : "hsl(var(--status-scarico))" }}
            >
              {lastAction.type === "entrata" ? "+" : "−"}{fmt(lastAction.quantity)} {lastAction.unit}
            </span>
            <span className="text-muted-foreground"> · </span>
            <span className="truncate">{lastAction.productName}</span>
          </div>
          <button
            onClick={() => undoMut.mutate(lastAction.movementId)}
            disabled={undoMut.isPending}
            data-testid="button-undo"
            className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-md bg-secondary hover:bg-muted transition-colors disabled:opacity-50 shrink-0"
          >
            <Undo2 className="w-3.5 h-3.5" />
            Annulla
          </button>
          <button
            onClick={() => setLastAction(null)}
            className="p-0.5 text-muted-foreground hover:text-foreground shrink-0"
            aria-label="Chiudi"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}

function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1).replace(/\.0$/, "");
}

/* ═══════════════════════════════════════════════════════════════════════
   ACTION GROUP — [−] <rimanenza> [+]
   Tap apre sempre il dialog di conferma (no ±1 immediato): la conferma
   esplicita dà sicurezza a chi opera su iPad e impedisce tap accidentali.
   ═══════════════════════════════════════════════════════════════════════ */
function ActionGroup({
  row, stockColor, onTap,
}: {
  row: EnrichedRow;
  stockColor: string;
  onTap: (type: "entrata" | "uscita") => void;
}) {
  const carico = "hsl(var(--status-carico))";
  const scarico = "hsl(var(--status-scarico))";
  const caricoBorder = "hsl(var(--status-carico) / 0.35)";
  const scaricoBorder = "hsl(var(--status-scarico) / 0.35)";
  return (
    <div className="flex items-center gap-1 shrink-0 select-none w-[150px] justify-end">
      <button
        type="button"
        data-testid={`uscite-${row.product.id}`}
        onClick={() => onTap("uscita")}
        className="w-11 h-11 rounded-md border flex items-center justify-center hover:bg-secondary active:bg-secondary transition-colors"
        style={{ borderColor: scaricoBorder, color: scarico }}
      >
        <Minus className="w-4 h-4" />
      </button>

      <div className="w-14 text-center font-mono tabular-nums leading-tight">
        <div className="text-base font-semibold" style={{ color: stockColor }}>
          {fmt(row.finalCalculated)}
        </div>
        <div className="text-[10px] text-muted-foreground/70 -mt-0.5">
          {row.product.unit}
        </div>
      </div>

      <button
        type="button"
        data-testid={`entrate-${row.product.id}`}
        onClick={() => onTap("entrata")}
        className="w-11 h-11 rounded-md border flex items-center justify-center hover:bg-secondary active:bg-secondary transition-colors"
        style={{ borderColor: caricoBorder, color: carico }}
      >
        <Plus className="w-4 h-4" />
      </button>
    </div>
  );
}

// MovementDialog ora vive in components/movement-dialog.tsx (riusato da Banco).

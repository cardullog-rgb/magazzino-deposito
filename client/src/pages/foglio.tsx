import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Search, Plus, Minus, X, AlertTriangle, CheckCircle2, Undo2, ArrowDownCircle, Clock } from "lucide-react";
import type { Product, Category, Sheet, SheetRow, Movement } from "@shared/schema";

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

  // Long-press: dopo 500ms apre il dialog. Tap breve invece fa ±1 immediato.
  const pressTimerRef = useRef<number | null>(null);
  const pressFiredRef = useRef(false);
  const [pressingId, setPressingId] = useState<string | null>(null);

  const { data, isLoading, isError } = useQuery<CurrentSheet>({
    queryKey: ["/api/sheet/current"],
    refetchInterval: 30000,
  });

  // Movimenti di oggi (per il riepilogo + lista "Uscite di oggi").
  // Calcolato dal client invalidando ogni minuto per riflettere il passare delle ore.
  const todayStart = useMemo(() => {
    const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime();
  }, []);
  const { data: todayMovements = [] } = useQuery<Movement[]>({
    queryKey: ["/api/movements", { from: todayStart }],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/movements?from=${todayStart}&limit=500`);
      return res.json();
    },
    refetchInterval: 20000,
  });

  // Movimenti arricchiti col nome prodotto (lookup dal foglio corrente)
  const productById = useMemo(() => {
    const m = new Map<number, Product>();
    if (data) for (const r of data.rows) m.set(r.product.id, r.product);
    return m;
  }, [data]);

  const todayScarichi = useMemo(() => {
    return todayMovements
      .filter(m => m.type === "scarico")
      .slice(0, 12); // ultime 12, le più recenti (già ordinate desc dall'API)
  }, [todayMovements]);

  const todayCarichi = useMemo(() => todayMovements.filter(m => m.type === "carico").length, [todayMovements]);
  const todayUsciteCount = useMemo(() => todayMovements.filter(m => m.type === "scarico").length, [todayMovements]);

  // Pulizia timer all'unmount.
  useEffect(() => () => {
    if (undoTimerRef.current) window.clearTimeout(undoTimerRef.current);
    if (pressTimerRef.current) window.clearTimeout(pressTimerRef.current);
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

  // Movimento "veloce" da tap singolo (±1, no dialog). Stessa rotta, mutation
  // separata così non si confonde con quella del dialog.
  const fastMut = useMutation({
    mutationFn: async (vars: { row: EnrichedRow; type: "entrata" | "uscita"; quantity: number }) => {
      const res = await apiRequest("POST", "/api/sheet/movement", {
        productId: vars.row.product.id,
        type: vars.type,
        quantity: vars.quantity,
      });
      const json = await res.json();
      return { ...json, _row: vars.row, _type: vars.type, _qty: vars.quantity };
    },
    onSuccess: (data: any) => {
      qc.invalidateQueries({ queryKey: ["/api/sheet/current"] });
      qc.invalidateQueries({ queryKey: ["/api/products"] });
      qc.invalidateQueries({ queryKey: ["/api/movements"] });
      if (data?.movement) {
        setLastAction({
          movementId: data.movement.id,
          productName: data._row.product.name,
          type: data._type,
          quantity: data._qty,
          unit: data._row.product.unit,
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
    onError: (e: any) => {
      toast({ title: "Annullamento fallito", description: e.message, variant: "destructive" });
    },
  });

  // Press handlers: tap = fast ±1, long-press (500ms) = dialog
  function handlePressStart(row: EnrichedRow, type: "entrata" | "uscita") {
    pressFiredRef.current = false;
    setPressingId(`${row.id}-${type}`);
    if (pressTimerRef.current) window.clearTimeout(pressTimerRef.current);
    pressTimerRef.current = window.setTimeout(() => {
      pressFiredRef.current = true;
      pressTimerRef.current = null;
      setPressingId(null);
      setEditing({ row, type });
      if (navigator.vibrate) navigator.vibrate(10);
    }, 500);
  }

  function handlePressEnd(row: EnrichedRow, type: "entrata" | "uscita") {
    if (pressTimerRef.current) {
      window.clearTimeout(pressTimerRef.current);
      pressTimerRef.current = null;
      setPressingId(null);
      if (!pressFiredRef.current) {
        fastMut.mutate({ row, type, quantity: 1 });
      }
    }
  }

  function handlePressCancel() {
    if (pressTimerRef.current) {
      window.clearTimeout(pressTimerRef.current);
      pressTimerRef.current = null;
    }
    setPressingId(null);
  }

  const closeMut = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/sheet/close", {});
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/sheet/current"] });
      setConfirmClose(false);
      toast({ title: "Foglio chiuso", description: "Nuovo foglio settimanale aperto." });
    },
    onError: (e: any) => toast({ title: "Errore", description: e.message, variant: "destructive" }),
  });

  // ─── Render ─────────────────────────────────────────────────────────────
  if (isLoading) return <div className="p-8 text-sm text-muted-foreground">Caricamento foglio…</div>;
  if (isError || !data) return <div className="p-8 text-sm text-destructive">Errore caricamento foglio.</div>;

  const { sheet } = data;

  return (
    <div className="flex flex-col h-full overflow-hidden">

      {/* ─── HEADER ─────────────────────────────────────────────────────── */}
      <div className="px-4 sm:px-5 py-3 border-b shrink-0 flex items-center justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <h1 className="text-base sm:text-lg font-semibold leading-tight">Inventario</h1>
          <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1.5 flex-wrap">
            <span>Oggi:</span>
            <span className="font-mono tabular-nums" style={{ color: "hsl(var(--status-scarico))" }}>
              {todayUsciteCount} uscite
            </span>
            <span className="text-muted-foreground/40">·</span>
            <span className="font-mono tabular-nums" style={{ color: "hsl(var(--status-carico))" }}>
              {todayCarichi} carichi
            </span>
            <span className="text-muted-foreground/40">·</span>
            {alertsCount > 0 ? (
              <span className="font-mono tabular-nums" style={{ color: "hsl(var(--status-low))" }}>
                {alertsCount} sotto soglia
              </span>
            ) : (
              <span style={{ color: "hsl(var(--status-ok))" }}>tutto in ordine</span>
            )}
            <span className="text-muted-foreground/40">·</span>
            <span className="text-muted-foreground/70 truncate">{sheet.name}</span>
          </p>
        </div>
        {isAdmin && sheet.status === "open" && (
          <Button
            onClick={() => setConfirmClose(true)}
            variant="outline"
            size="sm"
            data-testid="button-close-sheet"
          >
            Chiudi settimana
          </Button>
        )}
      </div>

      {/* ─── USCITE DI OGGI (cronologia) ─────────────────────────────────── */}
      {todayScarichi.length > 0 && (
        <div className="px-4 sm:px-5 py-2 border-b shrink-0" style={{ background: "hsl(var(--muted) / 0.3)" }}>
          <div className="flex items-center gap-2 mb-1.5">
            <ArrowDownCircle className="w-3.5 h-3.5" style={{ color: "hsl(var(--status-scarico))" }} />
            <span className="text-[11px] uppercase tracking-wide font-medium text-muted-foreground">
              Uscite di oggi
            </span>
            <span className="text-[11px] text-muted-foreground/60">· {todayUsciteCount}</span>
          </div>
          <div className="flex gap-1.5 flex-wrap max-h-16 overflow-y-auto scrollbar-thin">
            {todayScarichi.map(m => {
              const prod = productById.get(m.productId);
              return (
                <div
                  key={m.id}
                  data-testid={`today-scarico-${m.id}`}
                  className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-background text-xs"
                  title={new Date(m.createdAt).toLocaleString("it-IT")}
                >
                  <Clock className="w-3 h-3 text-muted-foreground/60" />
                  <span className="font-mono tabular-nums text-muted-foreground">
                    {new Date(m.createdAt).toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" })}
                  </span>
                  <span className="font-mono tabular-nums font-medium" style={{ color: "hsl(var(--status-scarico))" }}>
                    −{fmt(m.quantity)}
                  </span>
                  <span className="truncate max-w-32">
                    {prod ? prod.name : `#${m.productId}`}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

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

      {/* ─── BARRA ANNULLA (sticky sopra tabella) ────────────────────────── */}
      {lastAction && (
        <div
          className="px-4 sm:px-5 py-2 border-b flex items-center gap-3 shrink-0"
          style={{ background: "hsl(var(--muted) / 0.6)" }}
          data-testid="undo-bar"
        >
          <div className="flex-1 min-w-0 text-xs sm:text-sm">
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
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-background border hover:bg-secondary transition-colors disabled:opacity-50"
          >
            <Undo2 className="w-3.5 h-3.5" />
            Annulla
          </button>
          <button
            onClick={() => setLastAction(null)}
            className="p-1 text-muted-foreground hover:text-foreground"
            aria-label="Chiudi"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* ─── TABELLA FOGLIO ──────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto scrollbar-thin">

        {/* Header colonne sticky */}
        <div className="sticky top-0 z-10 bg-muted/80 backdrop-blur border-b">
          <div className="grid grid-cols-[1fr_60px_60px_60px_70px] sm:grid-cols-[1fr_80px_80px_80px_90px] gap-2 px-4 sm:px-5 py-2 text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
            <div>Prodotto</div>
            <div className="text-right tabular-nums">Iniz.</div>
            <div className="text-right tabular-nums" style={{ color: "hsl(var(--status-carico))" }}>+ Entr.</div>
            <div className="text-right tabular-nums" style={{ color: "hsl(var(--status-scarico))" }}>− Usc.</div>
            <div className="text-right tabular-nums">= Riman.</div>
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
                  className="grid grid-cols-[1fr_60px_60px_60px_70px] sm:grid-cols-[1fr_80px_80px_80px_90px] gap-2 px-4 sm:px-5 py-2 border-b items-center hover:bg-muted/30 transition-colors"
                >
                  {/* Nome + meta */}
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span
                        className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                        style={{ background: color }}
                        title={status}
                      />
                      <span className="text-sm truncate">{row.product.name}</span>
                    </div>
                    <div className="text-[11px] text-muted-foreground truncate ml-3">
                      {row.product.brand && <span>{row.product.brand} · </span>}
                      {row.product.unitSize || row.product.unit}
                      {row.product.packSize > 1 && (
                        <span className="text-muted-foreground/60"> · pack {row.product.packSize}</span>
                      )}
                    </div>
                  </div>

                  {/* Iniziale */}
                  <div className="text-right font-mono tabular-nums text-sm text-muted-foreground">
                    {fmt(row.initial)}
                  </div>

                  {/* Entrate · tap=+1, long-press=dialog */}
                  <TapCell
                    row={row}
                    type="entrata"
                    value={row.entries}
                    sign="+"
                    color="hsl(var(--status-carico))"
                    pressing={pressingId === `${row.id}-entrata`}
                    onPressStart={handlePressStart}
                    onPressEnd={handlePressEnd}
                    onPressCancel={handlePressCancel}
                  />

                  {/* Uscite · tap=-1, long-press=dialog */}
                  <TapCell
                    row={row}
                    type="uscita"
                    value={row.exits}
                    sign="−"
                    color="hsl(var(--status-scarico))"
                    pressing={pressingId === `${row.id}-uscita`}
                    onPressStart={handlePressStart}
                    onPressEnd={handlePressEnd}
                    onPressCancel={handlePressCancel}
                  />

                  {/* Rimanenza */}
                  <div
                    className="text-right font-mono tabular-nums text-sm font-semibold"
                    style={{ color }}
                  >
                    {fmt(row.finalCalculated)}
                    <span className="text-[10px] text-muted-foreground font-normal ml-0.5">{unit}</span>
                  </div>
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
    </div>
  );
}

function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1).replace(/\.0$/, "");
}

/* ═══════════════════════════════════════════════════════════════════════
   TAP CELL — tap = ±1, long-press = dialog. Feedback ring durante il press.
   ═══════════════════════════════════════════════════════════════════════ */
function TapCell({
  row, type, value, sign, color, pressing,
  onPressStart, onPressEnd, onPressCancel,
}: {
  row: EnrichedRow;
  type: "entrata" | "uscita";
  value: number;
  sign: "+" | "−";
  color: string;
  pressing: boolean;
  onPressStart: (row: EnrichedRow, type: "entrata" | "uscita") => void;
  onPressEnd: (row: EnrichedRow, type: "entrata" | "uscita") => void;
  onPressCancel: () => void;
}) {
  const Icon = type === "entrata" ? Plus : Minus;
  return (
    <button
      data-testid={`${type === "entrata" ? "entrate" : "uscite"}-${row.product.id}`}
      onPointerDown={(e) => { e.preventDefault(); onPressStart(row, type); }}
      onPointerUp={() => onPressEnd(row, type)}
      onPointerLeave={onPressCancel}
      onPointerCancel={onPressCancel}
      onContextMenu={(e) => e.preventDefault()}
      className="relative text-right font-mono tabular-nums text-sm py-2 rounded transition-colors flex items-center justify-end gap-1 pr-1 select-none touch-none active:bg-secondary"
      style={{
        color: value > 0 ? color : "hsl(var(--muted-foreground))",
        WebkitTouchCallout: "none",
        background: pressing ? "hsl(var(--secondary))" : undefined,
      }}
    >
      {pressing && (
        <span
          className="absolute inset-0 rounded pointer-events-none"
          style={{
            boxShadow: `inset 0 0 0 2px ${color}`,
            animation: "tap-fill 500ms linear forwards",
          }}
        />
      )}
      {value > 0
        ? `${sign}${fmt(value)}`
        : <Icon className="w-4 h-4 opacity-30" />}
    </button>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   DIALOG MOVIMENTO — minimale, tap veloce
   ═══════════════════════════════════════════════════════════════════════ */
function MovementDialog({
  row, type, onClose, onConfirm, pending,
}: {
  row: EnrichedRow;
  type: "entrata" | "uscita";
  onClose: () => void;
  onConfirm: (qty: number) => void;
  pending: boolean;
}) {
  const [qty, setQty] = useState("1");
  const numQty = Math.max(0, parseFloat(qty) || 0);

  const unit = row.product.unit;
  const packSize = row.product.packSize ?? 1;
  const hasPack = packSize > 1;

  // Quick buttons: pezzi singoli + pack
  const quickValues: { label: string; value: number }[] = hasPack
    ? [
        { label: `+1 ${unit}`, value: 1 },
        { label: `+2 ${unit}`, value: 2 },
        { label: `+5 ${unit}`, value: 5 },
      ]
    : [
        { label: "+1", value: 1 },
        { label: "+2", value: 2 },
        { label: "+5", value: 5 },
        { label: "+10", value: 10 },
      ];

  const isEntrata = type === "entrata";
  const newRemain = isEntrata
    ? row.finalCalculated + numQty
    : Math.max(0, row.finalCalculated - numQty);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm" data-testid="movement-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            {isEntrata
              ? <Plus className="w-4 h-4" style={{ color: "hsl(var(--status-carico))" }} />
              : <Minus className="w-4 h-4" style={{ color: "hsl(var(--status-scarico))" }} />}
            {isEntrata ? "Entrata" : "Uscita"}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3 py-1">
          <div>
            <p className="text-sm font-medium leading-tight">{row.product.name}</p>
            <p className="text-xs text-muted-foreground">
              {row.product.brand && <>{row.product.brand} · </>}{row.product.unitSize || unit}
            </p>
          </div>

          {/* Stock prima/dopo */}
          <div className="flex items-center justify-between bg-muted/60 px-3 py-2 rounded-md">
            <div>
              <div className="text-[10px] text-muted-foreground uppercase tracking-wide">Ora</div>
              <div className="font-mono tabular-nums text-base">{fmt(row.finalCalculated)} {unit}</div>
            </div>
            <div className="text-muted-foreground">→</div>
            <div className="text-right">
              <div className="text-[10px] text-muted-foreground uppercase tracking-wide">Dopo</div>
              <div
                className="font-mono tabular-nums text-base font-semibold"
                style={{ color: isEntrata ? "hsl(var(--status-carico))" : "hsl(var(--status-scarico))" }}
              >
                {fmt(newRemain)} {unit}
              </div>
            </div>
          </div>

          {/* Input qty */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => setQty(q => String(Math.max(0, (parseFloat(q) || 0) - 1)))}
              className="w-10 h-10 rounded-md border flex items-center justify-center hover:bg-secondary"
              type="button"
            >
              <Minus className="w-4 h-4" />
            </button>
            <Input
              type="number"
              step="any"
              min="0"
              value={qty}
              onChange={e => setQty(e.target.value)}
              data-testid="input-qty"
              className="flex-1 text-center text-lg font-mono tabular-nums h-10"
              autoFocus
            />
            <button
              onClick={() => setQty(q => String((parseFloat(q) || 0) + 1))}
              className="w-10 h-10 rounded-md border flex items-center justify-center hover:bg-secondary"
              type="button"
            >
              <Plus className="w-4 h-4" />
            </button>
            <span className="text-sm text-muted-foreground w-10">{unit}</span>
          </div>

          {/* Quick buttons */}
          <div className="flex flex-wrap gap-1.5">
            {quickValues.map(q => (
              <button
                key={q.label}
                onClick={() => setQty(String(q.value))}
                className="px-2.5 py-1 text-xs rounded-md bg-muted hover:bg-secondary transition-colors tabular-nums"
                type="button"
              >
                {q.label}
              </button>
            ))}
            {hasPack && (
              <>
                <button
                  onClick={() => setQty(String(packSize))}
                  className="px-2.5 py-1 text-xs rounded-md transition-colors tabular-nums text-white"
                  style={{ background: "hsl(var(--primary))" }}
                  type="button"
                  data-testid="quick-pack"
                >
                  {isEntrata ? "+" : ""}1 pack ({packSize})
                </button>
                <button
                  onClick={() => setQty(String(packSize * 2))}
                  className="px-2.5 py-1 text-xs rounded-md transition-colors tabular-nums"
                  style={{
                    background: "hsl(var(--primary) / 0.15)",
                    color: "hsl(var(--primary))",
                  }}
                  type="button"
                >
                  2 pack ({packSize * 2})
                </button>
              </>
            )}
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose} type="button">Annulla</Button>
          <Button
            onClick={() => onConfirm(numQty)}
            disabled={pending || numQty <= 0}
            data-testid="button-confirm-movement"
          >
            {pending ? "…" : "Conferma"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

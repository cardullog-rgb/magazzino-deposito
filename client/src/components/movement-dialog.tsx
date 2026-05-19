import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Plus, Minus } from "lucide-react";
import type { Product, Category, SheetRow } from "@shared/schema";

export type MovementRow = SheetRow & { product: Product; category: Category };

function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1).replace(/\.0$/, "");
}

/**
 * Dialog di conferma per registrare un movimento (entrata o uscita) di un
 * prodotto dell'inventario corrente. Lo usano sia Inventario (admin) sia
 * Banco (iPad): l'esperienza e' identica, e' il manager che ha deciso di
 * volere conferma esplicita anche al banco per evitare tap accidentali.
 */
export function MovementDialog({
  row, type, onClose, onConfirm, pending,
}: {
  row: MovementRow;
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
  const isEntrata = type === "entrata";
  // Segno nei chip: + per entrata, - per uscita, cosi si vede subito
  // l'effetto del tap senza dover ricordare il tipo del dialog.
  const sign = isEntrata ? "+" : "-";

  const quickValues: { label: string; value: number }[] = hasPack
    ? [
        { label: `${sign}1 ${unit}`, value: 1 },
        { label: `${sign}2 ${unit}`, value: 2 },
        { label: `${sign}5 ${unit}`, value: 5 },
      ]
    : [
        { label: `${sign}1`, value: 1 },
        { label: `${sign}2`, value: 2 },
        { label: `${sign}5`, value: 5 },
        { label: `${sign}10`, value: 10 },
      ];

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
              {row.product.brand && <>{row.product.brand} - </>}{row.product.unitSize || unit}
            </p>
          </div>

          {/* Stock prima/dopo */}
          <div className="flex items-center justify-between bg-muted/60 px-3 py-2 rounded-md">
            <div>
              <div className="text-[10px] text-muted-foreground uppercase tracking-wide">Ora</div>
              <div className="font-mono tabular-nums text-base">{fmt(row.finalCalculated)} {unit}</div>
            </div>
            <div className="text-muted-foreground">{"->"}</div>
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
                  {sign}1 pack ({packSize})
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
                  {sign}2 pack ({packSize * 2})
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
            {pending ? "..." : "Conferma"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

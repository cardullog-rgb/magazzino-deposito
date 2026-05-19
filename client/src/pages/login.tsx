import { useState } from "react";
import { useAuth } from "@/lib/auth";
import { APP_NAME } from "@/lib/brand";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Package, Tablet, ShieldCheck } from "lucide-react";

export default function LoginPage() {
  const { quickLoginIpad, quickLoginAdmin } = useAuth();
  const { toast } = useToast();

  const [loading, setLoading] = useState<null | "ipad" | "admin">(null);

  async function handleIpadLogin() {
    setLoading("ipad");
    try {
      await quickLoginIpad();
    } catch (err: any) {
      toast({ title: "Accesso negato", description: err.message, variant: "destructive" });
    } finally {
      setLoading(null);
    }
  }

  async function handleAdminLogin() {
    setLoading("admin");
    try {
      await quickLoginAdmin();
    } catch (err: any) {
      toast({ title: "Accesso negato", description: err.message, variant: "destructive" });
    } finally {
      setLoading(null);
    }
  }

  return (
    <div className="h-full w-full flex items-center justify-center px-4 bg-background">
      <div className="w-full max-w-sm">
        <div className="flex items-center gap-2 mb-10 justify-center">
          <Package className="w-5 h-5" style={{ color: "hsl(var(--primary))" }} />
          <span className="text-sm font-medium tracking-tight">{APP_NAME}</span>
        </div>

        <div className="space-y-3">
          <button
            type="button"
            onClick={handleIpadLogin}
            disabled={loading !== null}
            data-testid="button-quick-ipad"
            className="w-full flex items-center gap-4 p-4 rounded-lg border-2 transition-all active:scale-[0.98] disabled:opacity-50"
            style={{ borderColor: "hsl(var(--border))" }}
          >
            <div
              className="w-12 h-12 rounded-lg flex items-center justify-center shrink-0"
              style={{ background: "hsl(var(--primary) / 0.15)", color: "hsl(var(--primary))" }}
            >
              <Tablet className="w-6 h-6" />
            </div>
            <div className="text-left flex-1">
              <div className="text-base font-medium">iPad</div>
              <div className="text-xs text-muted-foreground">entra subito, per il bancone</div>
            </div>
            {loading === "ipad" && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
          </button>

          <button
            type="button"
            onClick={handleAdminLogin}
            disabled={loading !== null}
            data-testid="button-quick-admin"
            className="w-full flex items-center gap-4 p-4 rounded-lg border-2 transition-all active:scale-[0.98] disabled:opacity-50"
            style={{ borderColor: "hsl(var(--border))" }}
          >
            <div
              className="w-12 h-12 rounded-lg flex items-center justify-center shrink-0"
              style={{ background: "hsl(var(--secondary))", color: "hsl(var(--secondary-foreground))" }}
            >
              <ShieldCheck className="w-6 h-6" />
            </div>
            <div className="text-left flex-1">
              <div className="text-base font-medium">Admin</div>
              <div className="text-xs text-muted-foreground">entra subito, gestione completa</div>
            </div>
            {loading === "admin" && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
          </button>
        </div>
      </div>
    </div>
  );
}

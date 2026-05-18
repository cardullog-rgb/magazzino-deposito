import { useState } from "react";
import { useAuth } from "@/lib/auth";
import { APP_NAME } from "@/lib/brand";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Package, Tablet, ShieldCheck, ChevronLeft } from "lucide-react";

type Mode = "choose" | "admin";

export default function LoginPage() {
  const { login, quickLoginIpad } = useAuth();
  const { toast } = useToast();

  const [mode, setMode] = useState<Mode>("choose");
  const [loading, setLoading] = useState(false);
  const [password, setPassword] = useState("");

  async function handleIpadLogin() {
    setLoading(true);
    try {
      await quickLoginIpad();
    } catch (err: any) {
      toast({ title: "Accesso negato", description: err.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  async function handleAdminSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!password) return;
    setLoading(true);
    try {
      await login("admin", password);
    } catch (err: any) {
      toast({ title: "Accesso negato", description: err.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="h-full w-full flex items-center justify-center px-4 bg-background">
      <div className="w-full max-w-sm">
        <div className="flex items-center gap-2 mb-10 justify-center">
          <Package className="w-5 h-5" style={{ color: "hsl(var(--primary))" }} />
          <span className="text-sm font-medium tracking-tight">{APP_NAME}</span>
        </div>

        {mode === "choose" && (
          <div className="space-y-3">
            <button
              type="button"
              onClick={handleIpadLogin}
              disabled={loading}
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
                <div className="text-xs text-muted-foreground">entra subito · per il bancone</div>
              </div>
              {loading && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
            </button>

            <button
              type="button"
              onClick={() => setMode("admin")}
              disabled={loading}
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
                <div className="text-xs text-muted-foreground">gestione · richiede password</div>
              </div>
            </button>
          </div>
        )}

        {mode === "admin" && (
          <form onSubmit={handleAdminSubmit} className="space-y-4">
            <button
              type="button"
              onClick={() => { setMode("choose"); setPassword(""); }}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
              indietro
            </button>

            <div className="flex items-center gap-3 py-2">
              <div
                className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0"
                style={{ background: "hsl(var(--secondary))" }}
              >
                <ShieldCheck className="w-5 h-5" />
              </div>
              <div>
                <div className="text-sm font-medium">Accesso admin</div>
                <div className="text-xs text-muted-foreground">username: admin</div>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="password" className="text-xs text-muted-foreground font-normal">
                Password
              </Label>
              <Input
                id="password"
                type="password"
                data-testid="input-password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                autoFocus
                autoComplete="current-password"
                className="h-11"
              />
            </div>

            <Button
              type="submit"
              disabled={loading || !password}
              data-testid="button-login"
              className="w-full h-11"
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Entra"}
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}

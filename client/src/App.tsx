import { useEffect, useState } from "react";
import { Switch, Route, Router } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { AuthProvider, useAuth } from "@/lib/auth";
import { ThemeProvider, useTheme } from "@/lib/theme";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Moon, Sun, ShieldCheck, KeyRound, Lock, ShieldAlert } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { APP_NAME } from "@/lib/brand";

import LoginPage from "@/pages/login";
import FoglioPage from "@/pages/foglio";
import DashboardPage from "@/pages/dashboard";
import ScortePage from "@/pages/scorte";
import ListaSpesaPage from "@/pages/lista-spesa";
import StoricoPage from "@/pages/storico";
import UtentiPage from "@/pages/utenti";
import CaricoPage from "@/pages/carico";
import NotFound from "@/pages/not-found";

function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();
  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={toggleTheme}
      data-testid="button-theme-toggle"
      title={theme === "dark" ? "Tema chiaro" : "Tema scuro"}
    >
      {theme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
    </Button>
  );
}

function AdminElevationControl() {
  const { isAdmin, isElevated, elevationExpiresAt, baseUser, elevateAdmin, endElevation } = useAuth();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (!elevationExpiresAt) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [elevationExpiresAt]);

  // Se l'utente è admin di base, non serve nulla
  if (baseUser?.role === "admin") return null;

  if (isElevated && elevationExpiresAt) {
    const remaining = Math.max(0, elevationExpiresAt - now);
    const mm = Math.floor(remaining / 60000);
    const ss = Math.floor((remaining % 60000) / 1000);
    return (
      <button
        onClick={endElevation}
        data-testid="button-end-elevation"
        title="Termina modalità admin"
        className="flex items-center gap-1.5 px-2.5 h-9 rounded-md text-xs font-medium"
        style={{ background: "hsl(var(--primary) / 0.12)", color: "hsl(var(--primary))" }}
      >
        <ShieldCheck className="w-3.5 h-3.5" />
        <span className="tabular-nums">Admin · {mm}:{ss.toString().padStart(2, "0")}</span>
      </button>
    );
  }

  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        onClick={() => setOpen(true)}
        data-testid="button-elevate-admin"
        title="Sblocca modifiche admin"
      >
        <Lock className="w-4 h-4" />
      </Button>
      <Dialog open={open} onOpenChange={(o) => { if (!o) { setOpen(false); setUsername(""); setPassword(""); } }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <KeyRound className="w-4 h-4" />
              Sblocca modifiche admin
            </DialogTitle>
          </DialogHeader>
          <p className="text-xs text-muted-foreground -mt-2">
            5 minuti per modifiche al volo, poi torni in modalità banco.
          </p>
          <div className="space-y-2">
            <Input
              placeholder="username admin"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              data-testid="input-elev-username"
              autoFocus
            />
            <Input
              type="password"
              placeholder="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              data-testid="input-elev-password"
              onKeyDown={(e) => { if (e.key === "Enter") doElevate(); }}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} type="button">Annulla</Button>
            <Button
              onClick={doElevate}
              disabled={pending || !username || !password}
              data-testid="button-confirm-elevate"
            >
              {pending ? "…" : "Sblocca"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );

  async function doElevate() {
    setPending(true);
    try {
      await elevateAdmin(username, password);
      setOpen(false);
      setUsername(""); setPassword("");
      toast({ title: "Modalità admin", description: "Attiva per 5 minuti." });
    } catch (e: any) {
      toast({ title: "Errore", description: e.message ?? "Credenziali errate", variant: "destructive" });
    } finally {
      setPending(false);
    }
  }
}

function AuthenticatedApp() {
  const { isAdmin } = useAuth();
  return (
    <Router hook={useHashLocation}>
      <SidebarProvider style={{ "--sidebar-width": "15rem", "--sidebar-width-icon": "3.5rem" } as React.CSSProperties}>
        <div className="flex h-screen w-full" style={{ height: "100dvh" }}>
          <AppSidebar />
          <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
            <header className="flex items-center justify-between px-2 border-b shrink-0" style={{ minHeight: "52px" }}>
              <SidebarTrigger data-testid="button-sidebar-toggle" className="w-11 h-11" />
              <div className="flex items-center gap-1">
                <AdminElevationControl />
                <ThemeToggle />
              </div>
            </header>
            <main className="flex-1 overflow-hidden">
              <Switch>
                <Route path="/" component={FoglioPage} />
                {isAdmin && <Route path="/dashboard" component={DashboardPage} />}
                {isAdmin && <Route path="/scorte" component={ScortePage} />}
                <Route path="/lista-spesa" component={ListaSpesaPage} />
                {isAdmin && <Route path="/storico" component={StoricoPage} />}
                {isAdmin && <Route path="/carico" component={CaricoPage} />}
                {isAdmin && <Route path="/utenti" component={UtentiPage} />}
                <Route component={NotFound} />
              </Switch>
            </main>
          </div>
        </div>
      </SidebarProvider>
    </Router>
  );
}

function MustChangePasswordGate() {
  const { user, refreshUser, logout } = useAuth();
  const { toast } = useToast();
  const [pw1, setPw1] = useState("");
  const [pw2, setPw2] = useState("");
  const [pending, setPending] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (pw1.length < 6) {
      toast({ title: "Password troppo corta", description: "Almeno 6 caratteri.", variant: "destructive" });
      return;
    }
    if (pw1 !== pw2) {
      toast({ title: "Le password non coincidono", variant: "destructive" });
      return;
    }
    setPending(true);
    try {
      const res = await apiRequest("POST", "/api/auth/change-password", { newPassword: pw1 });
      const updated = await res.json();
      refreshUser(updated);
      toast({ title: "Password aggiornata", description: "Buon lavoro." });
    } catch (err: any) {
      toast({ title: "Errore", description: err.message, variant: "destructive" });
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-6" style={{ height: "100dvh" }}>
      <div className="w-full max-w-sm space-y-4">
        <div className="flex items-center gap-2">
          <ShieldAlert className="w-5 h-5" style={{ color: "hsl(var(--status-low))" }} />
          <h1 className="text-base font-semibold">Imposta la tua password</h1>
        </div>
        <p className="text-xs text-muted-foreground">
          Ciao {user?.name}. Prima di iniziare devi scegliere una password personale.
          Almeno 6 caratteri.
        </p>
        <form onSubmit={submit} className="space-y-2">
          <Input
            type="password"
            placeholder="nuova password"
            value={pw1}
            onChange={(e) => setPw1(e.target.value)}
            data-testid="input-new-password"
            autoFocus
          />
          <Input
            type="password"
            placeholder="ripeti password"
            value={pw2}
            onChange={(e) => setPw2(e.target.value)}
            data-testid="input-new-password-confirm"
          />
          <div className="flex items-center gap-2 pt-1">
            <Button type="submit" disabled={pending || !pw1 || !pw2} className="flex-1" data-testid="button-confirm-password">
              {pending ? "Salvataggio…" : "Conferma"}
            </Button>
            <Button type="button" variant="ghost" onClick={logout}>Esci</Button>
          </div>
        </form>
      </div>
    </div>
  );
}

function RootApp() {
  const { user } = useAuth();
  if (!user) return <LoginPage />;
  if (user.mustChangePassword) return <MustChangePasswordGate />;
  return <AuthenticatedApp />;
}

export default function App() {
  useEffect(() => {
    document.title = APP_NAME;
  }, []);
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <TooltipProvider>
          <AuthProvider>
            <RootApp />
          </AuthProvider>
          <Toaster />
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

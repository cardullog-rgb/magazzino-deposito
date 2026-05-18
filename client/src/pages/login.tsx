import { useState } from "react";
import { useAuth } from "@/lib/auth";
import { APP_NAME } from "@/lib/brand";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Package } from "lucide-react";

export default function LoginPage() {
  const { login } = useAuth();
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username || !password) return;
    setLoading(true);
    try {
      await login(username, password);
    } catch (err: any) {
      toast({ title: "Accesso negato", description: err.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="h-full w-full flex items-center justify-center px-4 bg-background">
      <div className="w-full max-w-xs">
        <div className="flex items-center gap-2 mb-8 justify-center">
          <Package className="w-5 h-5" style={{ color: "hsl(var(--primary))" }} />
          <span className="text-sm font-medium tracking-tight">{APP_NAME}</span>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="username" className="text-xs text-muted-foreground font-normal">
              Utente
            </Label>
            <Input
              id="username"
              data-testid="input-username"
              value={username}
              onChange={e => setUsername(e.target.value)}
              autoFocus
              autoComplete="username"
              className="h-11"
            />
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
              autoComplete="current-password"
              className="h-11"
            />
          </div>

          <Button
            type="submit"
            disabled={loading || !username || !password}
            data-testid="button-login"
            className="w-full h-11 mt-2"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Entra"}
          </Button>
        </form>

      </div>
    </div>
  );
}

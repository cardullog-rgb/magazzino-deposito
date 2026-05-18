import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Plus, Pencil, Trash2, Users, Shield, User } from "lucide-react";

const COLORS = ["#3b82f6","#f97316","#22c55e","#a855f7","#ec4899","#eab308","#06b6d4","#ef4444"];

export default function UtentiPage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [editUser, setEditUser] = useState<any>(null);
  const [isNew, setIsNew] = useState(false);
  const [form, setForm] = useState({ name: "", username: "", password: "", role: "staff", color: "#3b82f6", active: true });

  const { data: users = [] } = useQuery<any[]>({ queryKey: ["/api/users"] });

  const openNew = () => { setForm({ name: "", username: "", password: "", role: "staff", color: "#3b82f6", active: true }); setIsNew(true); setEditUser(null); };
  const openEdit = (u: any) => { setForm({ name: u.name, username: u.username, password: "", role: u.role, color: u.color, active: u.active }); setEditUser(u); setIsNew(false); };

  const saveUser = useMutation({
    mutationFn: async () => {
      const payload: any = { ...form };
      if (!isNew && !payload.password) delete payload.password;
      if (isNew) return (await apiRequest("POST", "/api/users", payload)).json();
      return (await apiRequest("PUT", `/api/users/${editUser.id}`, payload)).json();
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/users"] }); setEditUser(null); setIsNew(false); toast({ title: isNew ? "✅ Utente creato" : "✅ Aggiornato" }); },
    onError: () => toast({ title: "Errore", variant: "destructive" }),
  });

  const deleteUser = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/users/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/users"] }); toast({ title: "Utente rimosso" }); },
  });

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="px-6 py-4 border-b shrink-0 flex items-center justify-between">
        <div>
          <h1 className="font-display font-bold text-xl flex items-center gap-2"><Users className="w-5 h-5 text-primary" />Utenti</h1>
          <p className="text-sm text-muted-foreground">{users.length} utenti</p>
        </div>
        <Button onClick={openNew} data-testid="button-new-user"><Plus className="w-4 h-4 mr-1.5" />Nuovo</Button>
      </div>

      <div className="flex-1 overflow-y-auto scrollbar-thin p-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {users.map(u => (
            <div key={u.id} data-testid={`card-user-${u.id}`}
              className="flex flex-col p-4 rounded-xl border card-3d"
              style={{ background: "hsl(var(--card))", opacity: u.active ? 1 : 0.5 }}>
              <div className="flex items-start gap-3 mb-3">
                <Avatar className="h-10 w-10 shrink-0">
                  <AvatarFallback className="text-sm font-bold text-white" style={{ background: u.color }}>
                    {u.name.split(" ").map((n: string) => n[0]).join("").slice(0, 2).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold truncate">{u.name}</p>
                  <p className="text-xs text-muted-foreground">@{u.username}</p>
                </div>
              </div>
              <div className="flex items-center gap-2 mb-4">
                <span className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full"
                  style={{ background: u.role === "admin" ? "hsl(217 91% 55% / 0.15)" : "hsl(var(--muted))",
                    color: u.role === "admin" ? "hsl(217 91% 62%)" : "hsl(var(--muted-foreground))" }}>
                  {u.role === "admin" ? <Shield className="w-3 h-3" /> : <User className="w-3 h-3" />}
                  {u.role === "admin" ? "Admin" : "Staff"}
                </span>
              </div>
              <div className="flex gap-2 mt-auto">
                <Button variant="outline" size="sm" className="flex-1" onClick={() => openEdit(u)} data-testid={`button-edit-user-${u.id}`}>
                  <Pencil className="w-3 h-3 mr-1.5" />Modifica
                </Button>
                <Button variant="ghost" size="icon" onClick={() => deleteUser.mutate(u.id)} data-testid={`button-delete-user-${u.id}`}
                  className="hover:text-destructive hover:bg-destructive/10">
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      </div>

      <Dialog open={isNew || !!editUser} onOpenChange={() => { setEditUser(null); setIsNew(false); }}>
        <DialogContent>
          <DialogHeader><DialogTitle className="font-display">{isNew ? "Nuovo Utente" : `Modifica: ${editUser?.name}`}</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <div><Label>Nome</Label><Input className="mt-1.5" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Nome Cognome" /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Username</Label><Input className="mt-1.5" value={form.username} onChange={e => setForm(f => ({ ...f, username: e.target.value }))} /></div>
              <div><Label>{isNew ? "Password" : "Nuova password"}</Label><Input type="password" className="mt-1.5" value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} placeholder={isNew ? "" : "Lascia vuota"} /></div>
            </div>
            <div><Label>Ruolo</Label>
              <Select value={form.role} onValueChange={v => setForm(f => ({ ...f, role: v }))}>
                <SelectTrigger className="mt-1.5"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="admin"><div className="flex items-center gap-2"><Shield className="w-3.5 h-3.5 text-primary" />Admin — accesso completo</div></SelectItem>
                  <SelectItem value="staff"><div className="flex items-center gap-2"><User className="w-3.5 h-3.5" />Staff — carico/scarico</div></SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div><Label>Colore avatar</Label>
              <div className="flex gap-2 flex-wrap mt-1.5">
                {COLORS.map(c => (
                  <button key={c} type="button" onClick={() => setForm(f => ({ ...f, color: c }))}
                    className="w-7 h-7 rounded-full transition-all"
                    style={{ background: c, border: form.color === c ? "3px solid hsl(var(--foreground))" : "2px solid transparent", transform: form.color === c ? "scale(1.2)" : "scale(1)" }} />
                ))}
              </div>
            </div>
            <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
              <span className="text-sm font-medium">Utente attivo</span>
              <Switch checked={form.active} onCheckedChange={v => setForm(f => ({ ...f, active: v }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setEditUser(null); setIsNew(false); }}>Annulla</Button>
            <Button onClick={() => saveUser.mutate()} disabled={saveUser.isPending || !form.name || !form.username || (isNew && !form.password)}>
              {saveUser.isPending ? "Salvataggio…" : "Salva"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

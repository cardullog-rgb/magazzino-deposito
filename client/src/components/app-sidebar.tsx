import { useState } from "react";
import { Link, useLocation } from "wouter";
import { Package, History, Users, LogOut, ClipboardList, ChevronUp } from "lucide-react";
import { APP_NAME, APP_TAGLINE } from "@/lib/brand";
import {
  Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupContent,
  SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarHeader,
} from "@/components/ui/sidebar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useAuth } from "@/lib/auth";

// Voci viste dallo staff (iPad)
const navItemsStaff = [
  { title: "Inventario", href: "/", icon: ClipboardList },
];

// Voci viste dall'admin: massimo 3 + menu utente in footer
const navItemsAdmin = [
  { title: "Inventario", href: "/",        icon: ClipboardList },
  { title: "Catalogo",   href: "/scorte",  icon: Package },
  { title: "Storico",    href: "/storico", icon: History },
];

export function AppSidebar() {
  const { user, logout, isAdmin } = useAuth();
  const [location] = useLocation();
  const [userMenuOpen, setUserMenuOpen] = useState(false);

  const navItems = isAdmin ? navItemsAdmin : navItemsStaff;

  return (
    <Sidebar>
      <SidebarHeader className="px-4 py-4 border-b">
        <div className="flex items-center gap-2.5">
          <div
            className="w-7 h-7 flex items-center justify-center flex-shrink-0"
            style={{ background: "hsl(var(--primary))" }}
          >
            <Package className="w-4 h-4 text-white" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-medium truncate leading-tight" style={{ color: "hsl(var(--sidebar-foreground))" }}>
              {APP_NAME}
            </p>
            {APP_TAGLINE && (
              <p className="text-[11px] truncate" style={{ color: "hsl(var(--sidebar-foreground) / 0.55)" }}>
                {APP_TAGLINE}
              </p>
            )}
          </div>
        </div>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {navItems.map(item => {
                // Per "Inventario" considero attive sia "/" sia "/foglio" sia "/banco"
                const isActive = item.href === "/"
                  ? (location === "/" || location === "/foglio" || location === "/banco")
                  : location === item.href || location.startsWith(item.href + "/");
                return (
                  <SidebarMenuItem key={item.href}>
                    <SidebarMenuButton asChild isActive={isActive}>
                      <Link href={item.href} className="flex items-center gap-2.5">
                        <item.icon className="w-4 h-4" />
                        <span className="text-sm">{item.title}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="border-t p-3">
        <Popover open={userMenuOpen} onOpenChange={setUserMenuOpen}>
          <PopoverTrigger asChild>
            <button
              data-testid="button-user-menu"
              className="flex items-center gap-2.5 px-1 py-1 w-full hover:bg-secondary/50 rounded-md transition-colors"
            >
              <div
                className="h-7 w-7 flex items-center justify-center flex-shrink-0 text-[11px] font-medium text-white rounded"
                style={{ background: user?.color ?? "hsl(var(--primary))" }}
              >
                {user?.name.split(" ").map(n => n[0]).join("").slice(0, 2).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0 text-left">
                <p className="text-[13px] font-medium truncate leading-tight" style={{ color: "hsl(var(--sidebar-foreground))" }}>
                  {user?.name}
                </p>
                <p className="text-[11px] capitalize truncate" style={{ color: "hsl(var(--sidebar-foreground) / 0.55)" }}>
                  {user?.role}
                </p>
              </div>
              <ChevronUp className="w-3.5 h-3.5 text-muted-foreground" />
            </button>
          </PopoverTrigger>
          <PopoverContent side="top" align="start" className="w-56 p-1">
            {isAdmin && (
              <Link
                href="/utenti"
                onClick={() => setUserMenuOpen(false)}
                className="flex items-center gap-2.5 px-2 py-2 text-sm rounded hover:bg-secondary transition-colors"
                data-testid="link-utenti"
              >
                <Users className="w-4 h-4 text-muted-foreground" />
                <span>Utenti</span>
              </Link>
            )}
            <button
              onClick={() => { setUserMenuOpen(false); logout(); }}
              data-testid="button-logout"
              className="flex items-center gap-2.5 px-2 py-2 text-sm rounded hover:bg-secondary transition-colors w-full text-left"
            >
              <LogOut className="w-4 h-4 text-muted-foreground" />
              <span>Esci</span>
            </button>
          </PopoverContent>
        </Popover>
      </SidebarFooter>
    </Sidebar>
  );
}

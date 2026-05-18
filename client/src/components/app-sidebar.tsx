import { Link, useLocation } from "wouter";
import { LayoutDashboard, Package, ShoppingCart, History, Users, LogOut, ClipboardList, Truck } from "lucide-react";
import {
  Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupContent,
  SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarHeader,
} from "@/components/ui/sidebar";
import { useAuth } from "@/lib/auth";
import { useQuery } from "@tanstack/react-query";
import type { Product } from "@shared/schema";

// Voci sempre visibili (anche allo staff sull'iPad)
const navItemsAll = [
  { title: "Foglio settimanale", href: "/",            icon: ClipboardList },
  { title: "Lista spesa",        href: "/lista-spesa", icon: ShoppingCart },
];

// Voci ad accesso admin (o staff con elevazione attiva)
const navItemsAdmin = [
  { title: "Carico",             href: "/carico",      icon: Truck },
  { title: "Dashboard",          href: "/dashboard",   icon: LayoutDashboard },
  { title: "Scorte",             href: "/scorte",      icon: Package },
  { title: "Storico",            href: "/storico",     icon: History },
];

const adminItems = [
  { title: "Utenti", href: "/utenti", icon: Users },
];

export function AppSidebar() {
  const { user, logout, isAdmin } = useAuth();
  const [location] = useLocation();

  const { data: products = [] } = useQuery<Product[]>({
    queryKey: ["/api/products"], refetchInterval: 15000,
  });

  const alertCount = products.filter(p => p.active && p.currentStock <= p.minStock).length;
  const navItems = isAdmin ? [navItemsAll[0], ...navItemsAdmin, navItemsAll[1]] : navItemsAll;

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
              Deposito Bagagli
            </p>
            <p className="text-[11px] truncate" style={{ color: "hsl(var(--sidebar-foreground) / 0.55)" }}>
              Magazzino
            </p>
          </div>
        </div>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {navItems.map(item => {
                const isActive = location === item.href;
                const showBadge = item.href === "/lista-spesa" && alertCount > 0;
                return (
                  <SidebarMenuItem key={item.href}>
                    <SidebarMenuButton asChild isActive={isActive}>
                      <Link href={item.href} className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2.5">
                          <item.icon className="w-4 h-4" />
                          <span className="text-sm">{item.title}</span>
                        </div>
                        {showBadge && (
                          <span
                            className="h-5 min-w-5 px-1.5 text-[11px] tabular-nums flex items-center justify-center font-medium"
                            style={{
                              background: "hsl(var(--primary))",
                              color: "hsl(var(--primary-foreground))",
                            }}
                          >
                            {alertCount}
                          </span>
                        )}
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {isAdmin && (
          <SidebarGroup>
            <SidebarGroupContent>
              <SidebarMenu>
                {adminItems.map(item => (
                  <SidebarMenuItem key={item.href}>
                    <SidebarMenuButton asChild isActive={location === item.href}>
                      <Link href={item.href} className="flex items-center gap-2.5">
                        <item.icon className="w-4 h-4" />
                        <span className="text-sm">{item.title}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
      </SidebarContent>

      <SidebarFooter className="border-t p-3">
        <div className="flex items-center gap-2.5 px-1">
          <div
            className="h-7 w-7 flex items-center justify-center flex-shrink-0 text-[11px] font-medium text-white"
            style={{ background: user?.color ?? "hsl(var(--primary))" }}
          >
            {user?.name.split(" ").map(n => n[0]).join("").slice(0, 2).toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[13px] font-medium truncate leading-tight" style={{ color: "hsl(var(--sidebar-foreground))" }}>
              {user?.name}
            </p>
            <p className="text-[11px] capitalize truncate" style={{ color: "hsl(var(--sidebar-foreground) / 0.55)" }}>
              {user?.role}
            </p>
          </div>
          <button
            onClick={logout}
            data-testid="button-logout"
            title="Esci"
            className="p-1.5 transition-colors"
            style={{ color: "hsl(var(--sidebar-foreground) / 0.55)" }}
            onMouseEnter={e => (e.currentTarget.style.color = "hsl(var(--sidebar-foreground))")}
            onMouseLeave={e => (e.currentTarget.style.color = "hsl(var(--sidebar-foreground) / 0.55)")}
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}

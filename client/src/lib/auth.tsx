import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { apiRequest } from "./queryClient";

export type UserRole = "admin" | "staff";
export interface AuthUser {
  id: number;
  name: string;
  username: string;
  role: UserRole;
  color: string;
  active: boolean;
  mustChangePassword?: boolean;
}

interface Ctx {
  user: AuthUser | null;
  baseUser: AuthUser | null;       // utente loggato originariamente (mai cambia fino al logout)
  login(u: string, p: string): Promise<void>;
  // Login automatico dell'iPad dietro bancone (utente fisso "ipad", senza password).
  quickLoginIpad(): Promise<void>;
  logout(): void;
  // Elevazione admin temporanea: il dipendente passa "in modalità admin" per ELEVATION_MS
  // mostrando username+password admin. Allo scadere torna allo staff senza dover rifare login.
  elevateAdmin(username: string, password: string): Promise<void>;
  endElevation(): void;
  // Aggiorna l'utente locale dopo un cambio password obbligatorio o un patch del profilo.
  refreshUser(u: AuthUser): void;
  isAdmin: boolean;
  isElevated: boolean;
  elevationExpiresAt: number | null;
}
const AuthContext = createContext<Ctx | null>(null);

const STORAGE_KEY = "magazzino.user";
const BASE_KEY = "magazzino.baseUser";
const ELEV_KEY = "magazzino.elevationExpiresAt";
const ELEVATION_MS = 5 * 60 * 1000; // 5 minuti

function loadStored<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(() => loadStored<AuthUser>(STORAGE_KEY));
  const [baseUser, setBaseUser] = useState<AuthUser | null>(() => loadStored<AuthUser>(BASE_KEY) ?? loadStored<AuthUser>(STORAGE_KEY));
  const [elevationExpiresAt, setElevationExpiresAt] = useState<number | null>(() => {
    const v = loadStored<number>(ELEV_KEY);
    return typeof v === "number" && v > Date.now() ? v : null;
  });
  const tickRef = useRef<number | null>(null);

  // Se l'elevazione scade, ripristina l'utente base
  useEffect(() => {
    if (!elevationExpiresAt) return;
    const ms = elevationExpiresAt - Date.now();
    if (ms <= 0) {
      endElevationInternal();
      return;
    }
    tickRef.current = window.setTimeout(() => endElevationInternal(), ms);
    return () => {
      if (tickRef.current) window.clearTimeout(tickRef.current);
    };
  }, [elevationExpiresAt]);

  function endElevationInternal() {
    setElevationExpiresAt(null);
    localStorage.removeItem(ELEV_KEY);
    if (baseUser) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(baseUser));
      setUser(baseUser);
    }
  }

  const login = async (username: string, password: string) => {
    const res = await apiRequest("POST", "/api/auth/login", { username, password });
    const u = await res.json();
    if (u.error) throw new Error(u.error);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(u));
    localStorage.setItem(BASE_KEY, JSON.stringify(u));
    localStorage.removeItem(ELEV_KEY);
    setUser(u);
    setBaseUser(u);
    setElevationExpiresAt(null);
    window.location.hash = "/";
  };

  const quickLoginIpad = async () => {
    const res = await apiRequest("POST", "/api/auth/quick-login-ipad", {});
    const u = await res.json();
    if (u.error) throw new Error(u.error);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(u));
    localStorage.setItem(BASE_KEY, JSON.stringify(u));
    localStorage.removeItem(ELEV_KEY);
    setUser(u);
    setBaseUser(u);
    setElevationExpiresAt(null);
    window.location.hash = "/";
  };

  const logout = () => {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(BASE_KEY);
    localStorage.removeItem(ELEV_KEY);
    setUser(null);
    setBaseUser(null);
    setElevationExpiresAt(null);
    window.location.hash = "/";
  };

  const elevateAdmin = async (username: string, password: string) => {
    const res = await apiRequest("POST", "/api/auth/login", { username, password });
    const u = await res.json();
    if (u.error) throw new Error(u.error);
    if (u.role !== "admin") throw new Error("Credenziali non admin");
    const exp = Date.now() + ELEVATION_MS;
    // L'utente "attivo" diventa l'admin: tutte le chiamate API useranno il suo id (via x-user-id)
    localStorage.setItem(STORAGE_KEY, JSON.stringify(u));
    localStorage.setItem(ELEV_KEY, JSON.stringify(exp));
    setUser(u);
    setElevationExpiresAt(exp);
  };

  const endElevation = () => endElevationInternal();

  const refreshUser = (u: AuthUser) => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(u));
    setUser(u);
    if (baseUser && baseUser.id === u.id) {
      localStorage.setItem(BASE_KEY, JSON.stringify(u));
      setBaseUser(u);
    }
  };

  const isAdmin = user?.role === "admin";
  const isElevated = !!elevationExpiresAt && baseUser?.role !== "admin";

  return (
    <AuthContext.Provider value={{
      user, baseUser, login, quickLoginIpad, logout, elevateAdmin, endElevation, refreshUser,
      isAdmin, isElevated, elevationExpiresAt,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be inside AuthProvider");
  return ctx;
}

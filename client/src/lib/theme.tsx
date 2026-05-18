import { createContext, useContext, useState, useEffect, type ReactNode } from "react";
type Theme = "dark" | "light";
interface Ctx { theme: Theme; toggleTheme(): void; }
const ThemeContext = createContext<Ctx | null>(null);
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>("dark");
  useEffect(() => { document.documentElement.classList.toggle("dark", theme === "dark"); }, [theme]);
  return <ThemeContext.Provider value={{ theme, toggleTheme: () => setTheme(t => t === "dark" ? "light" : "dark") }}>{children}</ThemeContext.Provider>;
}
export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be inside ThemeProvider");
  return ctx;
}

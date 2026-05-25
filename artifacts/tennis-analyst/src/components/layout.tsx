import { Link, useLocation } from "wouter";
import { Activity, History, Sun, Moon, TrendingUp, Zap } from "lucide-react";
import { ReactNode, useEffect, useState } from "react";

function LiveClock() {
  const [time, setTime] = useState(() =>
    new Date().toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit", second: "2-digit" })
  );
  useEffect(() => {
    const id = setInterval(() =>
      setTime(new Date().toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit", second: "2-digit" })),
    1000);
    return () => clearInterval(id);
  }, []);
  return <span className="font-mono text-xs tabular-nums text-muted-foreground">{time}</span>;
}

export function useTheme() {
  const [theme, setTheme] = useState<"dark" | "light">(() => {
    const stored = localStorage.getItem("ghv-theme");
    return (stored === "light" || stored === "dark") ? stored : "dark";
  });

  useEffect(() => {
    const root = document.documentElement;
    if (theme === "light") {
      root.classList.add("light");
      root.classList.remove("dark");
    } else {
      root.classList.remove("light");
      root.classList.add("dark");
    }
    localStorage.setItem("ghv-theme", theme);
  }, [theme]);

  return { theme, toggle: () => setTheme(t => t === "dark" ? "light" : "dark") };
}

export function Layout({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const { theme, toggle } = useTheme();

  const navItems = [
    { href: "/", label: "Анализ", icon: Activity },
    { href: "/history", label: "История", icon: History },
  ];

  return (
    <div className="min-h-screen flex flex-col bg-background text-foreground font-sans">

      {/* Header */}
      <header className="flex-none border-b border-border bg-card/90 backdrop-blur-sm sticky top-0 z-50 shadow-sm">
        <div className="flex items-center justify-between px-4 h-14">

          {/* Brand */}
          <Link href="/" className="flex items-center gap-3 group select-none">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-orange-400 to-amber-500 flex items-center justify-center shadow-md group-hover:scale-105 transition-transform">
              <span className="text-white font-black text-base leading-none">Г</span>
            </div>
            <div className="flex flex-col leading-none">
              <span className="font-black text-base tracking-tight text-foreground">
                Грунт, Хард, Валуй!
              </span>
              <span className="text-[10px] text-muted-foreground tracking-wide">
                Аналитика ставок на теннис · AI
              </span>
            </div>
          </Link>

          {/* Desktop nav */}
          <nav className="hidden md:flex items-center gap-1">
            {navItems.map((item) => {
              const isActive = location === item.href || (item.href === "/" && location === "");
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-xl transition-all duration-150 ${
                    isActive
                      ? "bg-primary/10 text-primary"
                      : "text-muted-foreground hover:text-foreground hover:bg-accent"
                  }`}
                >
                  <item.icon className="w-4 h-4" />
                  <span>{item.label}</span>
                </Link>
              );
            })}
          </nav>

          {/* Right */}
          <div className="flex items-center gap-3">
            <div className="hidden sm:flex items-center gap-2 text-xs text-muted-foreground font-mono pr-3 border-r border-border">
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
                <span>3 AI</span>
              </span>
              <span className="flex items-center gap-1">
                <Zap className="w-3 h-3 text-amber-400" />
                <span>PRO</span>
              </span>
            </div>
            <LiveClock />
            <button
              onClick={toggle}
              className="w-8 h-8 rounded-xl flex items-center justify-center bg-accent hover:bg-accent/80 text-muted-foreground hover:text-foreground transition-all"
              title={theme === "dark" ? "Светлая тема" : "Тёмная тема"}
            >
              {theme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>
          </div>
        </div>

        {/* Mobile nav */}
        <div className="md:hidden flex border-t border-border">
          {navItems.map((item) => {
            const isActive = location === item.href || (item.href === "/" && location === "");
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex-1 flex items-center justify-center gap-2 py-3 text-sm font-semibold transition-colors ${
                  isActive
                    ? "text-primary border-b-2 border-primary bg-primary/5"
                    : "text-muted-foreground"
                }`}
              >
                <item.icon className="w-4 h-4" />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </div>
      </header>

      {/* Main */}
      <main className="flex-1 overflow-y-auto">
        <div className="p-3 md:p-6">
          {children}
        </div>
      </main>
    </div>
  );
}

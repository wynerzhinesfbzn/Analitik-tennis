import { Link, useLocation } from "wouter";
import { Activity, History, TrendingUp, Zap, BarChart2, Radio } from "lucide-react";
import { ReactNode, useEffect, useState } from "react";

function LiveClock() {
  const [time, setTime] = useState(() => new Date().toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit", second: "2-digit" }));
  useEffect(() => {
    const id = setInterval(() => setTime(new Date().toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit", second: "2-digit" })), 1000);
    return () => clearInterval(id);
  }, []);
  return <span className="font-mono text-xs text-cyan-400/70 tabular-nums">{time}</span>;
}

export function Layout({ children }: { children: ReactNode }) {
  const [location] = useLocation();

  const navItems = [
    { href: "/", label: "Анализ матча", icon: Activity, sub: "AI прогноз" },
    { href: "/history", label: "История ставок", icon: History, sub: "Статистика" },
  ];

  return (
    <div className="min-h-screen flex flex-col bg-background text-foreground font-sans" style={{ backgroundImage: "radial-gradient(ellipse at 20% 0%, rgba(14,165,233,0.04) 0%, transparent 60%)" }}>

      {/* Top Header Bar */}
      <header className="flex-none border-b border-border bg-card/80 backdrop-blur-sm sticky top-0 z-50">
        <div className="flex items-center justify-between px-4 h-12">

          {/* Brand */}
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center">
                <TrendingUp className="w-4 h-4 text-cyan-400" />
              </div>
              <div className="flex flex-col leading-none">
                <span className="text-sm font-bold tracking-widest uppercase text-foreground">BetAnalytics</span>
                <span className="text-[9px] tracking-[0.2em] uppercase text-cyan-400/60">Tennis · Pro Edition</span>
              </div>
            </div>

            <div className="hidden md:flex items-center gap-1 ml-4 px-2 py-0.5 rounded bg-red-500/10 border border-red-500/20">
              <Radio className="w-2.5 h-2.5 text-red-400 ticker-live" />
              <span className="text-[10px] font-bold tracking-widest text-red-400 uppercase">Live</span>
            </div>
          </div>

          {/* Nav */}
          <nav className="hidden md:flex items-center gap-1">
            {navItems.map((item) => {
              const isActive = location === item.href;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`flex items-center gap-2 px-4 py-1.5 text-xs font-medium transition-all duration-150 rounded-sm ${
                    isActive
                      ? "bg-cyan-500/10 text-cyan-400 border border-cyan-500/20"
                      : "text-muted-foreground hover:text-foreground hover:bg-white/5 border border-transparent"
                  }`}
                >
                  <item.icon className="w-3.5 h-3.5" />
                  <span className="tracking-wide uppercase">{item.label}</span>
                </Link>
              );
            })}
          </nav>

          {/* Right meta */}
          <div className="flex items-center gap-3">
            <div className="hidden sm:flex items-center gap-4 text-[10px] text-muted-foreground font-mono border-r border-border pr-3">
              <span className="flex items-center gap-1">
                <BarChart2 className="w-3 h-3 text-emerald-400" />
                <span className="text-emerald-400">API</span>
                <span className="text-emerald-400/40">●</span>
              </span>
              <span className="flex items-center gap-1">
                <Zap className="w-3 h-3 text-cyan-400" />
                <span className="text-cyan-400">AI</span>
                <span className="text-cyan-400/40">3x</span>
              </span>
            </div>
            <LiveClock />
          </div>
        </div>

        {/* Mobile nav */}
        <div className="md:hidden flex border-t border-border">
          {navItems.map((item) => {
            const isActive = location === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex-1 flex items-center justify-center gap-2 py-2.5 text-xs transition-colors ${
                  isActive ? "text-cyan-400 border-b-2 border-cyan-400" : "text-muted-foreground"
                }`}
              >
                <item.icon className="w-3.5 h-3.5" />
                <span className="uppercase tracking-wider">{item.label}</span>
              </Link>
            );
          })}
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto">
        <div className="p-3 md:p-5">
          {children}
        </div>
      </main>
    </div>
  );
}

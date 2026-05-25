import { Link, useLocation } from "wouter";
import { Activity, History, Trophy } from "lucide-react";
import { ReactNode } from "react";

export function Layout({ children }: { children: ReactNode }) {
  const [location] = useLocation();

  const navItems = [
    { href: "/", label: "Анализ матча", icon: Activity },
    { href: "/history", label: "История", icon: History },
  ];

  return (
    <div className="min-h-screen flex flex-col md:flex-row bg-background text-foreground font-mono">
      {/* Sidebar */}
      <aside className="w-full md:w-64 border-b md:border-b-0 md:border-r border-border bg-card flex flex-col">
        <div className="p-4 flex items-center gap-3 border-b border-border">
          <Trophy className="w-6 h-6 text-primary" />
          <span className="font-bold text-lg tracking-tight uppercase">Tennis Analyst</span>
        </div>
        
        <nav className="flex-1 p-4 flex flex-row md:flex-col gap-2 overflow-x-auto">
          {navItems.map((item) => {
            const isActive = location === item.href;
            return (
              <Link key={item.href} href={item.href} className={`flex items-center gap-3 px-3 py-2 rounded-sm text-sm transition-colors ${isActive ? 'bg-primary/10 text-primary border border-primary/20' : 'text-muted-foreground hover:bg-muted hover:text-foreground'}`}>
                <item.icon className="w-4 h-4" />
                <span className="uppercase tracking-wider">{item.label}</span>
              </Link>
            );
          })}
        </nav>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0">
        <div className="flex-1 p-4 md:p-6 lg:p-8 overflow-y-auto">
          {children}
        </div>
      </main>
    </div>
  );
}

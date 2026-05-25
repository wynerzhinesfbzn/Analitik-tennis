import { useState } from "react";
import { Layout } from "@/components/layout";
import { Github, Upload, CheckCircle, XCircle, Eye, EyeOff } from "lucide-react";

export default function GitPushPage() {
  const [token, setToken] = useState("");
  const [showToken, setShowToken] = useState(false);
  const [status, setStatus] = useState<"idle" | "loading" | "ok" | "error">("idle");
  const [output, setOutput] = useState("");

  const handlePush = async () => {
    if (!token.trim()) return;
    setStatus("loading");
    setOutput("");
    try {
      const res = await fetch("/api/git-push", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: token.trim() }),
      });
      const data = await res.json() as { ok: boolean; output?: string; error?: string };
      if (data.ok) {
        setStatus("ok");
        setOutput(data.output ?? "Готово!");
      } else {
        setStatus("error");
        setOutput(data.error ?? "Ошибка");
      }
    } catch (e: any) {
      setStatus("error");
      setOutput(e.message ?? "Сетевая ошибка");
    }
  };

  return (
    <Layout>
      <div className="max-w-lg mx-auto mt-10">
        <div className="rounded-2xl border border-border bg-card shadow-lg overflow-hidden">

          {/* Header */}
          <div className="flex items-center gap-3 px-6 py-5 border-b border-border bg-muted/30">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-slate-700 to-slate-900 flex items-center justify-center shadow">
              <Github className="w-5 h-5 text-white" />
            </div>
            <div>
              <div className="font-bold text-foreground">Пуш на GitHub</div>
              <div className="text-xs text-muted-foreground">wynerzhinesfbzn / Analitik-tennis</div>
            </div>
          </div>

          {/* Form */}
          <div className="px-6 py-6 space-y-5">
            <div className="space-y-2">
              <label className="text-sm font-semibold text-foreground">
                Personal Access Token
              </label>
              <p className="text-xs text-muted-foreground">
                GitHub → Settings → Developer settings → Personal access tokens (classic) → права <code className="bg-muted px-1 rounded">repo</code>
              </p>
              <div className="relative">
                <input
                  type={showToken ? "text" : "password"}
                  value={token}
                  onChange={e => setToken(e.target.value)}
                  placeholder="ghp_xxxxxxxxxxxxxxxxxxxx"
                  className="w-full h-11 px-4 pr-11 rounded-xl border border-border bg-background text-foreground font-mono text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
                  onKeyDown={e => e.key === "Enter" && handlePush()}
                />
                <button
                  type="button"
                  onClick={() => setShowToken(v => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                >
                  {showToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <button
              onClick={handlePush}
              disabled={!token.trim() || status === "loading"}
              className="w-full h-12 rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition-all
                bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed shadow"
            >
              {status === "loading" ? (
                <>
                  <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                  Пушим…
                </>
              ) : (
                <>
                  <Upload className="w-4 h-4" />
                  Запушить на GitHub
                </>
              )}
            </button>

            {/* Result */}
            {status === "ok" && (
              <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 flex items-start gap-3">
                <CheckCircle className="w-5 h-5 text-emerald-400 mt-0.5 flex-shrink-0" />
                <div>
                  <div className="text-sm font-semibold text-emerald-400">Успешно!</div>
                  <pre className="text-xs text-emerald-300/80 mt-1 whitespace-pre-wrap">{output}</pre>
                </div>
              </div>
            )}

            {status === "error" && (
              <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 flex items-start gap-3">
                <XCircle className="w-5 h-5 text-red-400 mt-0.5 flex-shrink-0" />
                <div>
                  <div className="text-sm font-semibold text-red-400">Ошибка</div>
                  <pre className="text-xs text-red-300/80 mt-1 whitespace-pre-wrap">{output}</pre>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </Layout>
  );
}

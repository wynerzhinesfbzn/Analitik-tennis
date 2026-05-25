import { Layout } from "@/components/layout";
import { useState, useRef, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  Play, Upload, X, Headphones, Loader2, TrendingUp, TrendingDown,
  AlertTriangle, Search, Brain, Activity, Send, RefreshCw,
  Sparkles, Plus, Trash2, ChevronRight, Target, Zap, CheckCircle2,
  Clock, MapPin, Layers, BarChart3, ShieldAlert,
} from "lucide-react";

/* ── TYPES ── */
interface AgentMessage { agent: string; agentLabel: string; content: string; isReply?: boolean; provider?: string; }
interface BettingRecommendation { type: string; description: string; odds: number; bankPercent: number; confidencePercent: number; }
interface UploadedImage { file: File; preview: string; base64: string; }
type AnalysisPhase = "idle" | "research" | "dialogue" | "recommendations" | "done";
type Mode = "single" | "express";

interface MatchSlot {
  id: string;
  player1: string;
  player2: string;
  tournament: string;
  surface: string;
  matchDate: string;
  isLookingUp: boolean;
  lookupDone: boolean;
}

interface ExpressResult {
  slotId: string;
  player1: string;
  player2: string;
  tournament: string;
  surface: string;
  recs: BettingRecommendation[];
  vote: string;
  avgConf: number;
  done: boolean;
  error?: string;
}

/* ── AGENT META ── */
const AGENT_META: Record<string, { label: string; color: string; bg: string; dot: string; icon: string }> = {
  stats_expert:    { label: "Статистик",   color: "text-blue-600 dark:text-cyan-300",    bg: "bg-blue-50 dark:bg-cyan-500/5",   dot: "bg-blue-500",   icon: "📊" },
  odds_strategist: { label: "Стратег",     color: "text-amber-600 dark:text-amber-300",  bg: "bg-amber-50 dark:bg-amber-500/5", dot: "bg-amber-500",  icon: "💹" },
  context_expert:  { label: "Контекст",    color: "text-purple-600 dark:text-violet-300", bg: "bg-purple-50 dark:bg-violet-500/5", dot: "bg-purple-500", icon: "🧠" },
};

/* ── HELPERS ── */
function ConfBar({ pct }: { pct: number }) {
  const color = pct >= 85 ? "bg-emerald-500" : pct >= 72 ? "bg-amber-500" : "bg-orange-500";
  const text  = pct >= 85 ? "text-emerald-600 dark:text-emerald-400" : pct >= 72 ? "text-amber-600 dark:text-amber-400" : "text-orange-600 dark:text-orange-400";
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-2 rounded-full bg-gray-100 dark:bg-white/5 overflow-hidden">
        <div className={`h-full rounded-full transition-all duration-700 ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className={`text-xs font-bold tabular-nums ${text}`}>{pct}%</span>
    </div>
  );
}

function SurfaceBadge({ surface }: { surface: string }) {
  const map: Record<string, { emoji: string; cls: string }> = {
    "Грунт":  { emoji: "🟧", cls: "surface-clay text-orange-700 dark:text-orange-300 border border-orange-300/40" },
    "Хард":   { emoji: "🟦", cls: "surface-hard text-blue-700 dark:text-blue-300 border border-blue-300/40" },
    "Трава":  { emoji: "🟩", cls: "surface-grass text-green-700 dark:text-green-300 border border-green-300/40" },
    "Крытый": { emoji: "⬛", cls: "surface-indoor text-gray-700 dark:text-gray-300 border border-gray-300/40" },
  };
  const s = map[surface] ?? { emoji: "🎾", cls: "bg-gray-100 dark:bg-white/5 text-gray-600 dark:text-gray-400 border border-gray-200 dark:border-white/10" };
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-xs font-semibold ${s.cls}`}>
      {s.emoji} {surface}
    </span>
  );
}

function mkSlot(): MatchSlot {
  return { id: Math.random().toString(36).slice(2), player1: "", player2: "", tournament: "", surface: "", matchDate: "", isLookingUp: false, lookupDone: false };
}

/* ══════════════════ MAIN COMPONENT ══════════════════ */
export default function AnalysisPage() {
  const { toast } = useToast();
  const [mode, setMode] = useState<Mode>("single");

  /* ── SINGLE mode state ── */
  const [player1, setPlayer1] = useState("");
  const [player2, setPlayer2] = useState("");
  const [tournament, setTournament] = useState("");
  const [surface, setSurface] = useState("");
  const [matchDate, setMatchDate] = useState("");
  const [oddsData, setOddsData] = useState<Record<string, unknown> | null>(null);
  const [forceRefresh, setForceRefresh] = useState(false);
  const [isLookingUp, setIsLookingUp] = useState(false);

  /* ── EXPRESS mode state ── */
  const [slots, setSlots] = useState<MatchSlot[]>([mkSlot(), mkSlot()]);
  const [expressResults, setExpressResults] = useState<ExpressResult[]>([]);
  const [expressRunning, setExpressRunning] = useState(false);
  const [expressCurrentIdx, setExpressCurrentIdx] = useState(-1);

  /* ── Images ── */
  const [images, setImages] = useState<UploadedImage[]>([]);
  const [isAnalyzingImages, setIsAnalyzingImages] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  /* ── SSE state (single) ── */
  const [phase, setPhase] = useState<AnalysisPhase>("idle");
  const [researchMsg, setResearchMsg] = useState("");
  const [usedWebSearch, setUsedWebSearch] = useState(false);
  const [detectedMatch, setDetectedMatch] = useState<Record<string, unknown> | null>(null);
  const [mlInfo, setMlInfo] = useState<{ adjustment: number; sampleSize: number; sampleAccuracy: number } | null>(null);
  const [dialogue, setDialogue] = useState<AgentMessage[]>([]);
  const [currentMsg, setCurrentMsg] = useState<AgentMessage | null>(null);
  const [recommendations, setRecommendations] = useState<BettingRecommendation[]>([]);
  const [vote, setVote] = useState<{ verdict: string; avgConfidence: number } | null>(null);
  const [savedPredictionId, setSavedPredictionId] = useState<number | null>(null);
  const [savedPrediction, setSavedPrediction] = useState<Record<string, unknown> | null>(null);
  const [riskNotes, setRiskNotes] = useState("");
  const [cashoutAdvice, setCashoutAdvice] = useState("");
  const [isGeneratingPodcast, setIsGeneratingPodcast] = useState(false);
  const [podcastUrl, setPodcastUrl] = useState<string | null>(null);
  const [isPublishingTelegram, setIsPublishingTelegram] = useState(false);
  const [telegramPublished, setTelegramPublished] = useState(false);

  const terminalRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (terminalRef.current) terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
  }, [dialogue, currentMsg, researchMsg]);

  /* ── Image helpers ── */
  const readFileAsBase64 = (file: File): Promise<{ base64: string; preview: string }> =>
    new Promise(resolve => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const dataUrl = reader.result as string;
        resolve({ base64: dataUrl.split(",")[1], preview: dataUrl });
      };
      reader.readAsDataURL(file);
    });

  const addImages = useCallback(async (files: File[]) => {
    const imgs = files.filter(f => f.type.startsWith("image/"));
    if (!imgs.length) return;
    const newImgs: UploadedImage[] = [];
    for (const file of imgs) {
      const { base64, preview } = await readFileAsBase64(file);
      newImgs.push({ file, preview, base64 });
    }
    setImages(prev => [...prev, ...newImgs]);
  }, []);

  const handleFileInput = async (e: React.ChangeEvent<HTMLInputElement>) => {
    await addImages(Array.from(e.target.files ?? []));
    if (fileInputRef.current) fileInputRef.current.value = "";
  };
  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    await addImages(Array.from(e.dataTransfer.files));
  }, [addImages]);

  /* ── Analyze screenshots ── */
  const analyzeImages = async () => {
    if (!images.length) return;
    setIsAnalyzingImages(true);
    try {
      const res = await fetch("/api/predictions/analyze-images", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          images: images.map(i => i.base64),
          mode: mode === "express" ? "express" : "single",
        }),
      });
      const data = await res.json();

      if (mode === "single") {
        if (data.player1) setPlayer1(data.player1);
        if (data.player2) setPlayer2(data.player2);
        if (data.tournament) setTournament(data.tournament);
        if (data.surface) setSurface(data.surface);
        if (data.matchDate) setMatchDate(data.matchDate);
        if (data.odds) setOddsData(data.odds);
        toast({ title: `✅ ${images.length} скриншот(ов) распознано` });
      } else if (mode === "express") {
        type M = { player1?: string; player2?: string; tournament?: string | null; surface?: string | null; matchDate?: string | null };
        const matches: M[] = Array.isArray(data.matches) && data.matches.length > 0
          ? data.matches
          : [data]; // fallback to single match

        // Replace ALL slots with exactly the detected matches
        const newSlots: MatchSlot[] = matches.map((m) => ({
          ...mkSlot(),
          player1: m.player1 ?? "",
          player2: m.player2 ?? "",
          tournament: m.tournament ?? "",
          surface: m.surface ?? "",
          matchDate: m.matchDate ?? "",
          lookupDone: Boolean(m.player1 && m.player2),
        }));

        setSlots(newSlots);
        setExpressResults([]);
        toast({ title: `✅ Найдено ${newSlots.length} матч${newSlots.length === 1 ? "" : newSlots.length < 5 ? "а" : "ей"} — слоты обновлены` });
      }
    } catch {
      toast({ title: "Ошибка анализа скриншотов", variant: "destructive" });
    } finally {
      setIsAnalyzingImages(false);
    }
  };

  /* ── Auto-fill match details ── */
  const lookupMatch = async (p1: string, p2: string, tour: string, slotId?: string) => {
    if (!p1 || !p2) {
      toast({ title: "Введите имена обоих игроков", variant: "destructive" });
      return;
    }
    if (slotId) {
      setSlots(prev => prev.map(s => s.id === slotId ? { ...s, isLookingUp: true } : s));
    } else {
      setIsLookingUp(true);
    }
    try {
      const res = await fetch("/api/predictions/lookup-match", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ player1: p1, player2: p2, tournament: tour || undefined }),
      });
      const data = await res.json();
      if (slotId) {
        setSlots(prev => prev.map(s => s.id === slotId ? {
          ...s,
          isLookingUp: false, lookupDone: true,
          surface: data.surface || s.surface,
          matchDate: data.matchDate || s.matchDate,
          tournament: data.tournament || s.tournament,
        } : s));
      } else {
        if (data.surface) setSurface(data.surface);
        if (data.matchDate) setMatchDate(data.matchDate);
        if (data.tournament && !tournament) setTournament(data.tournament);
        setIsLookingUp(false);
      }
      toast({ title: data.confidence === "high" ? "✅ Матч найден!" : "🔍 Данные заполнены приблизительно" });
    } catch {
      if (slotId) setSlots(prev => prev.map(s => s.id === slotId ? { ...s, isLookingUp: false } : s));
      else setIsLookingUp(false);
      toast({ title: "Не удалось найти матч", variant: "destructive" });
    }
  };

  /* ── Single analysis (SSE) ── */
  const startAnalysis = async () => {
    if (!player1 || !player2) {
      toast({ title: "Введите имена обоих игроков", variant: "destructive" });
      return;
    }
    setDialogue([]); setCurrentMsg(null); setRecommendations([]); setVote(null);
    setSavedPredictionId(null); setSavedPrediction(null); setRiskNotes(""); setCashoutAdvice("");
    setPodcastUrl(null); setTelegramPublished(false); setResearchMsg("");
    setUsedWebSearch(false); setDetectedMatch(null); setMlInfo(null);
    setPhase("research");

    try {
      const res = await fetch("/api/predictions/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ player1, player2, tournament, surface, matchDate, odds: oddsData, forceRefresh }),
      });
      if (!res.body) throw new Error("No stream");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let localCurrentMsg: AgentMessage | null = null;

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n\n");
        buffer = parts.pop() ?? "";

        for (const part of parts) {
          if (!part.startsWith("data: ")) continue;
          try {
            const event = JSON.parse(part.slice(6));
            if (event.type === "research_start") { setPhase("research"); }
            else if (event.type === "research_progress") { setResearchMsg(event.message ?? ""); }
            else if (event.type === "match_detected") {
              setDetectedMatch(event);
              if (event.surface && !surface) setSurface(event.surface);
              if (event.date && !matchDate) setMatchDate(event.date);
            }
            else if (event.type === "research_complete") { setUsedWebSearch(event.usedWebSearch ?? false); setPhase("dialogue"); }
            else if (event.type === "ml_adjustment") {
              setMlInfo({ adjustment: event.adjustment, sampleSize: event.sampleSize, sampleAccuracy: event.sampleAccuracy });
            }
            else if (event.type === "agent_start") {
              if (localCurrentMsg) setDialogue(prev => [...prev, localCurrentMsg!]);
              localCurrentMsg = { agent: event.agent, agentLabel: event.agentLabel, content: "", isReply: event.isReply, provider: event.provider };
              setCurrentMsg({ ...localCurrentMsg });
            } else if (event.type === "agent_chunk") {
              if (localCurrentMsg) {
                const updated: AgentMessage = { ...localCurrentMsg, content: localCurrentMsg.content + (event.content as string) };
                localCurrentMsg = updated;
                setCurrentMsg({ ...updated });
                // Yield to browser so React renders each chunk visually
                await new Promise<void>(r => setTimeout(r, 0));
              }
            } else if (event.type === "agent_done") {
              if (localCurrentMsg) { setDialogue(prev => [...prev, { ...localCurrentMsg!, content: event.fullContent }]); localCurrentMsg = null; setCurrentMsg(null); }
            } else if (event.type === "generating_recommendations") { setPhase("recommendations"); }
            else if (event.type === "recommendations") { setRecommendations(event.data); }
            else if (event.type === "vote") { setVote({ verdict: event.vote, avgConfidence: event.avgConfidence }); }
            else if (event.type === "saved") {
              setSavedPredictionId(event.prediction?.id ?? null);
              setSavedPrediction(event.prediction ?? null);
              setRiskNotes(event.prediction?.riskNotes ?? "");
              setCashoutAdvice(event.prediction?.cashoutAdvice ?? "");
            }
            else if (event.done) { setPhase("done"); }
          } catch { /* skip */ }
        }
      }
    } catch {
      setPhase("idle");
      toast({ title: "Ошибка соединения", variant: "destructive" });
    }
  };

  /* ── Express analysis ── */
  const startExpress = async () => {
    const valid = slots.filter(s => s.player1 && s.player2);
    if (valid.length < 2) {
      toast({ title: "Нужно минимум 2 заполненных матча", variant: "destructive" });
      return;
    }
    setExpressRunning(true);
    setExpressResults([]);
    setExpressCurrentIdx(0);

    const results: ExpressResult[] = [];
    for (let i = 0; i < valid.length; i++) {
      const slot = valid[i];
      setExpressCurrentIdx(i);
      const partial: ExpressResult = { slotId: slot.id, player1: slot.player1, player2: slot.player2, tournament: slot.tournament, surface: slot.surface, recs: [], vote: "", avgConf: 0, done: false };
      setExpressResults(prev => [...prev, partial]);

      try {
        const res = await fetch("/api/predictions/analyze", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ player1: slot.player1, player2: slot.player2, tournament: slot.tournament, surface: slot.surface, matchDate: slot.matchDate, forceRefresh: false }),
        });
        if (!res.body) throw new Error("No stream");

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const parts = buffer.split("\n\n");
          buffer = parts.pop() ?? "";
          for (const part of parts) {
            if (!part.startsWith("data: ")) continue;
            try {
              const event = JSON.parse(part.slice(6));
              if (event.type === "recommendations") { partial.recs = event.data; }
              if (event.type === "vote") { partial.vote = event.vote; partial.avgConf = event.avgConfidence; }
              if (event.done) { partial.done = true; }
            } catch { /* skip */ }
          }
        }
        results.push(partial);
        setExpressResults(prev => prev.map((r, idx) => idx === i ? { ...partial, done: true } : r));
      } catch {
        partial.error = "Ошибка анализа";
        partial.done = true;
        results.push(partial);
        setExpressResults(prev => prev.map((r, idx) => idx === i ? partial : r));
      }
    }

    setExpressCurrentIdx(-1);
    setExpressRunning(false);
    toast({ title: `✅ Экспресс из ${results.length} матчей готов!` });
  };

  /* ── Podcast & Telegram ── */
  const generatePodcast = async () => {
    if (!savedPredictionId) return;
    setIsGeneratingPodcast(true); setPodcastUrl(null);
    try {
      const res = await fetch(`/api/predictions/${savedPredictionId}/podcast`, { method: "POST" });
      if (!res.ok) throw new Error();
      setPodcastUrl(URL.createObjectURL(await res.blob()));
    } catch { toast({ title: "Ошибка генерации подкаста", variant: "destructive" }); }
    finally { setIsGeneratingPodcast(false); }
  };

  const publishToTelegram = async () => {
    if (!savedPredictionId) return;
    setIsPublishingTelegram(true);
    try {
      const res = await fetch(`/api/predictions/${savedPredictionId}/telegram`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) { toast({ title: data.error ?? "Ошибка Telegram", variant: "destructive" }); return; }
      setTelegramPublished(true);
      toast({ title: data.alreadyPublished ? "Уже опубликовано" : "✅ Опубликовано в Telegram!" });
    } catch { toast({ title: "Ошибка публикации", variant: "destructive" }); }
    finally { setIsPublishingTelegram(false); }
  };

  const isRunning = phase === "research" || phase === "dialogue" || phase === "recommendations";
  const fatigueScore1 = (savedPrediction as any)?.fatigueScore1 ?? (detectedMatch as any)?.fatigue1;
  const fatigueScore2 = (savedPrediction as any)?.fatigueScore2 ?? (detectedMatch as any)?.fatigue2;
  const mlAdjustment = mlInfo?.adjustment ?? (savedPrediction as any)?.mlAdjustment;

  /* ── Express combined odds ── */
  const expressOdds = expressResults.reduce((acc, r) => {
    const bestRec = r.recs.reduce((best, rec) => (!best || rec.confidencePercent > best.confidencePercent) ? rec : best, null as BettingRecommendation | null);
    return bestRec ? acc * (bestRec.odds ?? 1) : acc;
  }, 1);
  const expressAvgConf = expressResults.length > 0
    ? Math.round(expressResults.reduce((s, r) => s + r.avgConf, 0) / expressResults.length)
    : 0;

  return (
    <Layout>
      <div className="max-w-[1440px] mx-auto space-y-5">

        {/* ── PAGE HEADER ── */}
        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
          <div>
            <h1 className="text-2xl font-black text-foreground tracking-tight">
              🎾 Анализ матча
            </h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              3 AI-агента · Глубокий поиск · ML-коррекция
            </p>
          </div>

          {/* Mode toggle */}
          <div className="sm:ml-auto flex items-center gap-1 p-1 rounded-xl bg-muted border border-border">
            {(["single", "express"] as Mode[]).map(m => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={`px-4 py-1.5 rounded-lg text-sm font-semibold transition-all ${
                  mode === m
                    ? m === "express"
                      ? "bg-orange-500 text-white shadow-sm"
                      : "bg-primary text-primary-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {m === "single" ? "⚡ Одиночная" : "🔥 Экспресс"}
              </button>
            ))}
          </div>
        </div>

        {/* ══ SINGLE MODE ══ */}
        {mode === "single" && (
          <div className="grid grid-cols-1 xl:grid-cols-12 gap-5">

            {/* ─ LEFT PANEL ─ */}
            <div className="xl:col-span-4 space-y-4">

              {/* Screenshot drop zone */}
              <div className="rounded-2xl border border-border bg-card shadow-sm overflow-hidden">
                <div className="px-4 py-3 border-b border-border flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-7 h-7 rounded-lg bg-violet-100 dark:bg-violet-500/10 flex items-center justify-center">
                      <Upload className="w-3.5 h-3.5 text-violet-600 dark:text-violet-400" />
                    </div>
                    <span className="text-sm font-semibold">Скриншоты букмекера</span>
                  </div>
                  {images.length > 0 && (
                    <span className="text-xs px-2 py-0.5 rounded-full bg-violet-100 dark:bg-violet-500/10 text-violet-700 dark:text-violet-300 font-bold">{images.length}</span>
                  )}
                </div>
                <div className="p-3 space-y-3">
                  <div
                    onDrop={handleDrop}
                    onDragOver={e => e.preventDefault()}
                    onClick={() => fileInputRef.current?.click()}
                    className="group border-2 border-dashed border-border rounded-xl cursor-pointer hover:border-violet-400 hover:bg-violet-50 dark:hover:bg-violet-500/5 transition-all duration-200 p-6 text-center select-none"
                  >
                    <Upload className="w-6 h-6 mx-auto mb-2 text-muted-foreground/40 group-hover:text-violet-500 transition-colors" />
                    <p className="text-sm text-muted-foreground group-hover:text-foreground transition-colors font-medium">Перетащите или кликните</p>
                    <p className="text-xs text-muted-foreground/50 mt-1">Линия · Коэффициенты · Состав</p>
                  </div>
                  <input ref={fileInputRef} type="file" accept="image/*" multiple className="hidden" onChange={handleFileInput} />

                  {images.length > 0 && (
                    <div className="space-y-2">
                      <div className="flex flex-wrap gap-2">
                        {images.map((img, idx) => (
                          <div key={idx} className="relative group">
                            <img src={img.preview} alt={`#${idx + 1}`} className="w-16 h-16 object-cover rounded-lg border border-border" />
                            <button
                              onClick={e => { e.stopPropagation(); setImages(prev => prev.filter((_, i) => i !== idx)); }}
                              className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-red-500 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity shadow-sm"
                            >
                              <X className="w-3 h-3 text-white" />
                            </button>
                          </div>
                        ))}
                      </div>
                      <Button
                        onClick={analyzeImages}
                        disabled={isAnalyzingImages}
                        variant="outline"
                        className="w-full rounded-xl border-violet-300 dark:border-violet-500/30 text-violet-700 dark:text-violet-300 hover:bg-violet-50 dark:hover:bg-violet-500/10"
                        size="sm"
                      >
                        {isAnalyzingImages
                          ? <><Loader2 className="w-3.5 h-3.5 mr-2 animate-spin" />Распознаю...</>
                          : <><Search className="w-3.5 h-3.5 mr-2" />Распознать {images.length} скриншот{images.length > 1 ? "а" : ""}</>}
                      </Button>
                    </div>
                  )}
                </div>
              </div>

              {/* Match form */}
              <div className="rounded-2xl border border-border bg-card shadow-sm overflow-hidden">
                <div className="px-4 py-3 border-b border-border flex items-center gap-2">
                  <div className="w-7 h-7 rounded-lg bg-primary/10 flex items-center justify-center">
                    <Activity className="w-3.5 h-3.5 text-primary" />
                  </div>
                  <span className="text-sm font-semibold">Параметры матча</span>
                </div>
                <div className="p-4 space-y-4">

                  {/* Players */}
                  <div className="space-y-3">
                    <div className="space-y-1.5">
                      <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                        <span className="w-5 h-5 rounded bg-blue-100 dark:bg-blue-500/15 text-blue-700 dark:text-blue-300 text-[10px] flex items-center justify-center font-bold">П1</span>
                        Игрок 1
                      </Label>
                      <Input value={player1} onChange={e => setPlayer1(e.target.value)} placeholder="Novak Djokovic" className="rounded-xl h-10" />
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-px bg-border" />
                      <span className="text-xs font-bold text-muted-foreground/50 uppercase tracking-widest px-2">vs</span>
                      <div className="flex-1 h-px bg-border" />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                        <span className="w-5 h-5 rounded bg-rose-100 dark:bg-rose-500/15 text-rose-700 dark:text-rose-300 text-[10px] flex items-center justify-center font-bold">П2</span>
                        Игрок 2
                      </Label>
                      <Input value={player2} onChange={e => setPlayer2(e.target.value)} placeholder="Carlos Alcaraz" className="rounded-xl h-10" />
                    </div>
                  </div>

                  {/* Tournament + auto-fill */}
                  <div className="space-y-1.5">
                    <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Турнир</Label>
                    <div className="flex gap-2">
                      <Input
                        value={tournament}
                        onChange={e => setTournament(e.target.value)}
                        placeholder="Roland Garros, Wimbledon..."
                        className="rounded-xl h-10 flex-1"
                      />
                      <Button
                        variant="outline"
                        size="icon"
                        className="h-10 w-10 rounded-xl flex-none border-primary/30 text-primary hover:bg-primary/10"
                        disabled={isLookingUp || !player1 || !player2}
                        onClick={() => lookupMatch(player1, player2, tournament)}
                        title="Авто-заполнение покрытия и даты"
                      >
                        {isLookingUp ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                      </Button>
                    </div>
                    <p className="text-[11px] text-muted-foreground/60">✨ Нажмите кнопку — AI автоматически найдёт покрытие и дату</p>
                  </div>

                  {/* Surface + Date */}
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Покрытие</Label>
                      <Select value={surface} onValueChange={setSurface}>
                        <SelectTrigger className="h-10 rounded-xl">
                          <SelectValue placeholder="Выбрать" />
                        </SelectTrigger>
                        <SelectContent className="rounded-xl">
                          <SelectItem value="Хард">🟦 Хард</SelectItem>
                          <SelectItem value="Грунт">🟧 Грунт</SelectItem>
                          <SelectItem value="Трава">🟩 Трава</SelectItem>
                          <SelectItem value="Крытый">⬛ Крытый</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1">
                        <Clock className="w-3 h-3" />Дата
                      </Label>
                      <Input type="date" value={matchDate} onChange={e => setMatchDate(e.target.value)} className="h-10 rounded-xl" />
                    </div>
                  </div>

                  {/* Refresh toggle */}
                  <button
                    type="button"
                    onClick={() => setForceRefresh(v => !v)}
                    className={`w-full h-9 rounded-xl border text-xs font-semibold flex items-center justify-center gap-2 transition-all ${
                      forceRefresh
                        ? "border-orange-400 bg-orange-50 dark:bg-orange-500/10 text-orange-700 dark:text-orange-300"
                        : "border-border text-muted-foreground hover:border-primary/30 hover:text-primary"
                    }`}
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${forceRefresh ? "animate-spin" : ""}`} />
                    {forceRefresh ? "🔄 Сброс кеша включён" : "Сбросить кеш поиска"}
                  </button>

                  {/* RUN BUTTON */}
                  <Button
                    onClick={startAnalysis}
                    disabled={isRunning || !player1 || !player2}
                    className="w-full h-12 rounded-xl text-base font-bold bg-gradient-to-r from-primary to-cyan-400 hover:from-primary/90 hover:to-cyan-400/90 text-white shadow-lg hover:shadow-xl transition-all"
                  >
                    {isRunning ? (
                      <><Loader2 className="w-5 h-5 mr-2 animate-spin" />{phase === "research" ? "Ищу данные..." : phase === "dialogue" ? "Агенты думают..." : "Формирую ставки..."}</>
                    ) : (
                      <><Sparkles className="w-5 h-5 mr-2" />Анализировать матч</>
                    )}
                  </Button>
                </div>
              </div>

              {/* Detected match info */}
              {detectedMatch && (
                <div className="rounded-2xl border border-emerald-200 dark:border-emerald-500/20 bg-emerald-50 dark:bg-emerald-500/5 p-4 space-y-2 pop-in">
                  <div className="flex items-center gap-2 text-emerald-700 dark:text-emerald-300 font-semibold text-sm">
                    <CheckCircle2 className="w-4 h-4" />
                    Матч найден
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    {(detectedMatch as any).tournament && (
                      <div className="flex items-center gap-1.5 text-muted-foreground">
                        <Target className="w-3 h-3" />
                        <span>{(detectedMatch as any).tournament}</span>
                      </div>
                    )}
                    {(detectedMatch as any).surface && <SurfaceBadge surface={(detectedMatch as any).surface} />}
                    {(detectedMatch as any).location && (
                      <div className="flex items-center gap-1.5 text-muted-foreground">
                        <MapPin className="w-3 h-3" />
                        <span>{(detectedMatch as any).location}</span>
                      </div>
                    )}
                    {(detectedMatch as any).date && (
                      <div className="flex items-center gap-1.5 text-muted-foreground">
                        <Clock className="w-3 h-3" />
                        <span>{(detectedMatch as any).date}</span>
                      </div>
                    )}
                  </div>
                  {(fatigueScore1 != null || fatigueScore2 != null) && (
                    <div className="mt-2 space-y-1.5 pt-2 border-t border-emerald-200 dark:border-emerald-500/20">
                      <div className="text-[10px] font-semibold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">Усталость</div>
                      {fatigueScore1 != null && (
                        <div className="flex items-center gap-2 text-xs">
                          <span className="text-muted-foreground w-20 truncate">{player1.split(" ").pop()}</span>
                          <div className="flex-1 h-2 rounded-full bg-gray-100 dark:bg-white/5 overflow-hidden">
                            <div className={`h-full rounded-full ${fatigueScore1 <= 3 ? "bg-emerald-500" : fatigueScore1 <= 6 ? "bg-amber-500" : "bg-red-500"}`} style={{ width: `${fatigueScore1 * 10}%` }} />
                          </div>
                          <span className="font-mono font-bold text-xs w-8 text-right">{fatigueScore1}/10</span>
                        </div>
                      )}
                      {fatigueScore2 != null && (
                        <div className="flex items-center gap-2 text-xs">
                          <span className="text-muted-foreground w-20 truncate">{player2.split(" ").pop()}</span>
                          <div className="flex-1 h-2 rounded-full bg-gray-100 dark:bg-white/5 overflow-hidden">
                            <div className={`h-full rounded-full ${fatigueScore2 <= 3 ? "bg-emerald-500" : fatigueScore2 <= 6 ? "bg-amber-500" : "bg-red-500"}`} style={{ width: `${fatigueScore2 * 10}%` }} />
                          </div>
                          <span className="font-mono font-bold text-xs w-8 text-right">{fatigueScore2}/10</span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* ─ RIGHT PANEL ─ */}
            <div className="xl:col-span-8 space-y-4">

              {/* Status bar */}
              {(isRunning || phase === "done") && (
                <div className="flex items-center gap-2 flex-wrap">
                  {[
                    { key: "research", label: "🔍 Поиск", done: phase !== "research" },
                    { key: "dialogue", label: "💬 Диалог агентов", done: phase === "recommendations" || phase === "done" },
                    { key: "recommendations", label: "🎯 Ставки", done: phase === "done" },
                  ].map((step, i) => {
                    const isCurrent = phase === step.key;
                    const isDone = step.done;
                    return (
                      <div key={step.key} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold transition-all ${
                        isDone ? "bg-emerald-100 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                          : isCurrent ? "bg-primary/10 text-primary animate-pulse"
                          : "bg-muted text-muted-foreground"
                      }`}>
                        {isDone ? <CheckCircle2 className="w-3 h-3" /> : isCurrent ? <Loader2 className="w-3 h-3 animate-spin" /> : <span className="w-3 h-3 rounded-full bg-current opacity-20" />}
                        {step.label}
                        {i < 2 && <ChevronRight className="w-3 h-3 opacity-30 ml-1" />}
                      </div>
                    );
                  })}
                  {mlInfo && mlInfo.sampleSize > 0 && (
                    <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold ${
                      mlAdjustment > 0 ? "bg-emerald-100 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                        : mlAdjustment < 0 ? "bg-red-100 dark:bg-red-500/15 text-red-700 dark:text-red-300"
                        : "bg-muted text-muted-foreground"
                    }`}>
                      <Brain className="w-3 h-3" />
                      ML {mlAdjustment > 0 ? "+" : ""}{mlAdjustment}% (точн. {mlInfo.sampleAccuracy}%)
                    </div>
                  )}
                  {vote && (
                    <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold ml-auto ${
                      vote.verdict === "unanimous"
                        ? "bg-emerald-100 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                        : "bg-amber-100 dark:bg-amber-500/15 text-amber-700 dark:text-amber-300"
                    }`}>
                      {vote.verdict === "unanimous" ? <Target className="w-3 h-3" /> : <AlertTriangle className="w-3 h-3" />}
                      {vote.verdict === "unanimous" ? "Консенсус" : "Спорный"} · {vote.avgConfidence}%
                    </div>
                  )}
                </div>
              )}

              {/* Agent chat */}
              <div className="rounded-2xl border border-border bg-card shadow-sm overflow-hidden">
                {/* Chat header */}
                <div className="px-4 py-3 border-b border-border flex items-center gap-3 bg-gradient-to-r from-card to-muted/30">
                  <div className="flex items-center -space-x-2">
                    <div className="w-7 h-7 rounded-full bg-blue-500 border-2 border-card flex items-center justify-center text-white text-xs z-30">📊</div>
                    <div className="w-7 h-7 rounded-full bg-amber-500 border-2 border-card flex items-center justify-center text-white text-xs z-20">💹</div>
                    <div className="w-7 h-7 rounded-full bg-purple-500 border-2 border-card flex items-center justify-center text-white text-xs z-10">🧠</div>
                  </div>
                  <div>
                    <div className="text-sm font-bold">Совещание агентов</div>
                    <div className="text-[10px] text-muted-foreground">Статистик · Стратег · Контекст</div>
                  </div>
                  {usedWebSearch && (
                    <span className="text-[10px] px-2 py-1 rounded-full bg-blue-100 dark:bg-blue-500/10 text-blue-700 dark:text-blue-300 font-semibold border border-blue-200 dark:border-blue-500/20 ml-1">🌐 Веб-поиск</span>
                  )}
                  {phase === "dialogue" && currentMsg && (
                    <div className="ml-auto flex items-center gap-1.5 text-xs text-muted-foreground">
                      <span className="flex gap-0.5">
                        <span className="typing-dot w-1.5 h-1.5 rounded-full bg-primary/60 inline-block" />
                        <span className="typing-dot w-1.5 h-1.5 rounded-full bg-primary/60 inline-block" />
                        <span className="typing-dot w-1.5 h-1.5 rounded-full bg-primary/60 inline-block" />
                      </span>
                      пишет...
                    </div>
                  )}
                  {phase === "research" && (
                    <div className="ml-auto flex items-center gap-1.5 text-xs text-muted-foreground animate-pulse">
                      <Search className="w-3 h-3" />
                      {researchMsg || "Ищу данные..."}
                    </div>
                  )}
                </div>

                {/* Chat body */}
                <div
                  ref={terminalRef}
                  className="h-[480px] overflow-y-auto px-4 py-4 space-y-1"
                  style={{ background: "var(--chat-bg, transparent)" }}
                >
                  {/* Empty state */}
                  {dialogue.length === 0 && !currentMsg && phase !== "research" && (
                    <div className="h-full flex flex-col items-center justify-center gap-4 select-none">
                      <div className="text-6xl">🎾</div>
                      <div className="text-center space-y-1">
                        <p className="text-sm font-semibold text-muted-foreground">Три эксперта готовы к анализу</p>
                        <p className="text-xs text-muted-foreground/50">Введите матч и нажмите «Анализировать»</p>
                      </div>
                      <div className="flex gap-2">
                        {[
                          { icon: "📊", name: "Статистик", color: "border-blue-200 dark:border-blue-500/30 bg-blue-50 dark:bg-blue-500/5 text-blue-700 dark:text-blue-300" },
                          { icon: "💹", name: "Стратег",   color: "border-amber-200 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-500/5 text-amber-700 dark:text-amber-300" },
                          { icon: "🧠", name: "Контекст",  color: "border-purple-200 dark:border-purple-500/30 bg-purple-50 dark:bg-purple-500/5 text-purple-700 dark:text-purple-300" },
                        ].map(a => (
                          <div key={a.name} className={`px-3 py-2 rounded-xl border text-xs font-semibold flex items-center gap-1.5 ${a.color}`}>
                            <span>{a.icon}</span>{a.name}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Research phase placeholder */}
                  {dialogue.length === 0 && !currentMsg && phase === "research" && (
                    <div className="h-full flex flex-col items-center justify-center gap-3">
                      <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center">
                        <Search className="w-6 h-6 text-primary animate-pulse" />
                      </div>
                      <div className="text-center">
                        <p className="text-sm font-semibold">Сбор данных</p>
                        <p className="text-xs text-muted-foreground mt-1">{researchMsg || "Ищу актуальную информацию..."}</p>
                      </div>
                    </div>
                  )}

                  {/* Messages */}
                  {[...dialogue, ...(currentMsg ? [currentMsg] : [])].map((msg, idx) => {
                    const agentKey = msg.agent as keyof typeof AGENT_META;
                    const meta = AGENT_META[agentKey] ?? { label: msg.agentLabel, color: "text-foreground", bg: "bg-muted", dot: "bg-gray-400", icon: "🤖" };

                    const isStreaming = currentMsg !== null && idx === dialogue.length;

                    /* Bubble style per agent */
                    const bubbleStyles: Record<string, string> = {
                      stats_expert:    "bg-blue-50 dark:bg-blue-950/40 border border-blue-200/70 dark:border-blue-500/20 rounded-tl-sm",
                      odds_strategist: "bg-amber-50 dark:bg-amber-950/40 border border-amber-200/70 dark:border-amber-500/20 rounded-tl-sm",
                      context_expert:  "bg-purple-50 dark:bg-purple-950/40 border border-purple-200/70 dark:border-purple-500/20 rounded-tl-sm",
                    };
                    const avatarStyles: Record<string, string> = {
                      stats_expert:    "bg-blue-500",
                      odds_strategist: "bg-amber-500",
                      context_expert:  "bg-purple-500",
                    };
                    const nameStyles: Record<string, string> = {
                      stats_expert:    "text-blue-600 dark:text-blue-400",
                      odds_strategist: "text-amber-600 dark:text-amber-400",
                      context_expert:  "text-purple-600 dark:text-purple-400",
                    };

                    const bubbleCls = bubbleStyles[msg.agent] ?? "bg-muted border border-border rounded-tl-sm";
                    const avatarCls = avatarStyles[msg.agent] ?? "bg-gray-500";
                    const nameCls   = nameStyles[msg.agent] ?? "text-foreground";

                    /* Show avatar only if previous message was from a different agent */
                    const prevMsg = idx > 0 ? [...dialogue, ...(currentMsg ? [currentMsg] : [])][idx - 1] : null;
                    const showHeader = !prevMsg || prevMsg.agent !== msg.agent;

                    return (
                      <div key={idx} className={`flex gap-3 msg-appear ${showHeader ? "mt-4" : "mt-1"}`}>
                        {/* Avatar */}
                        <div className="flex-none w-8">
                          {showHeader && (
                            <div className={`w-8 h-8 rounded-full ${avatarCls} flex items-center justify-center text-sm shadow-sm`}>
                              {meta.icon}
                            </div>
                          )}
                        </div>

                        {/* Bubble */}
                        <div className="flex-1 min-w-0 max-w-[88%]">
                          {showHeader && (
                            <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                              <span className={`text-xs font-bold ${nameCls}`}>{msg.agentLabel || meta.label}</span>
                              {msg.provider && (
                                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-muted/60 text-muted-foreground border border-border/50 font-mono">
                                  {msg.provider}
                                </span>
                              )}
                              {msg.isReply && (
                                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground border border-border">
                                  ↩ отвечает
                                </span>
                              )}
                            </div>
                          )}
                          <div className={`rounded-2xl px-4 py-3 ${bubbleCls}`}>
                            <p className={`text-sm leading-relaxed text-foreground/90 whitespace-pre-wrap ${isStreaming ? "typing-cursor" : ""}`}>
                              {msg.content}
                            </p>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Recommendations */}
              {recommendations.length > 0 && (
                <div className="rounded-2xl border border-border bg-card shadow-sm overflow-hidden pop-in">
                  <div className="px-4 py-3 border-b border-border flex items-center gap-2">
                    <div className="w-7 h-7 rounded-lg bg-amber-100 dark:bg-amber-500/10 flex items-center justify-center">
                      <Target className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
                    </div>
                    <span className="text-sm font-semibold">Рекомендации по ставкам</span>
                    <span className="text-xs px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400 font-bold ml-auto">{recommendations.length} вариант{recommendations.length > 1 ? "а" : ""}</span>
                  </div>
                  <div className="p-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {recommendations.map((rec, i) => (
                      <div key={i} className="rounded-xl border border-border bg-background p-4 space-y-2.5 hover:border-amber-400/40 transition-colors">
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <div className="text-xs font-bold text-muted-foreground uppercase tracking-wider">{rec.type}</div>
                            <div className="text-sm font-semibold mt-0.5 text-foreground/90">{rec.description}</div>
                          </div>
                          <span className="flex-none text-lg font-black text-amber-500 dark:text-amber-400 font-mono odds-value">{rec.odds.toFixed(2)}</span>
                        </div>
                        <ConfBar pct={rec.confidencePercent} />
                        <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                          <span>Уверенность {rec.confidencePercent}%</span>
                          <span className="font-semibold text-emerald-600 dark:text-emerald-400">{rec.bankPercent}% банка</span>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Risk / Cashout */}
                  {(riskNotes || cashoutAdvice) && (
                    <div className="px-4 pb-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {riskNotes && (
                        <div className="rounded-xl border border-red-200 dark:border-red-500/20 bg-red-50 dark:bg-red-500/5 p-3">
                          <div className="text-xs font-bold text-red-700 dark:text-red-400 flex items-center gap-1.5 mb-1.5">
                            <ShieldAlert className="w-3.5 h-3.5" />Риски
                          </div>
                          <p className="text-xs text-foreground/70">{riskNotes}</p>
                        </div>
                      )}
                      {cashoutAdvice && (
                        <div className="rounded-xl border border-emerald-200 dark:border-emerald-500/20 bg-emerald-50 dark:bg-emerald-500/5 p-3">
                          <div className="text-xs font-bold text-emerald-700 dark:text-emerald-400 flex items-center gap-1.5 mb-1.5">
                            <TrendingUp className="w-3.5 h-3.5" />Кэшаут
                          </div>
                          <p className="text-xs text-foreground/70">{cashoutAdvice}</p>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Actions */}
                  {savedPredictionId && (
                    <div className="px-4 pb-4 flex flex-wrap gap-2">
                      <Button onClick={generatePodcast} disabled={isGeneratingPodcast} variant="outline" size="sm" className="rounded-xl">
                        {isGeneratingPodcast ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <Headphones className="w-3.5 h-3.5 mr-1.5" />}
                        Подкаст
                      </Button>
                      {podcastUrl && (
                        <audio controls src={podcastUrl} className="h-9 rounded-xl" />
                      )}
                      <Button
                        onClick={publishToTelegram}
                        disabled={isPublishingTelegram || telegramPublished}
                        variant="outline"
                        size="sm"
                        className={`rounded-xl ${telegramPublished ? "border-emerald-400 text-emerald-600 dark:text-emerald-400" : ""}`}
                      >
                        {isPublishingTelegram ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <Send className="w-3.5 h-3.5 mr-1.5" />}
                        {telegramPublished ? "✅ В Telegram" : "Telegram"}
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ══ EXPRESS MODE ══ */}
        {mode === "express" && (
          <div className="space-y-5">
            {/* Express header */}
            <div className="rounded-2xl border border-orange-200 dark:border-orange-500/20 bg-orange-50 dark:bg-orange-500/5 px-5 py-4 flex flex-col sm:flex-row sm:items-center gap-3">
              <div>
                <div className="font-bold text-orange-700 dark:text-orange-300 flex items-center gap-2">
                  <Zap className="w-4 h-4" /> Режим Экспресс
                </div>
                <p className="text-sm text-orange-600/70 dark:text-orange-400/70 mt-0.5">
                  Загрузите скриншот(ы) — AI найдёт все матчи и создаст нужное количество слотов
                </p>
              </div>
              {expressResults.length > 0 && !expressRunning && (
                <div className="sm:ml-auto flex items-center gap-4 text-sm font-bold">
                  <div className="flex flex-col items-center">
                    <span className="text-2xl text-orange-600 dark:text-orange-400">{expressOdds.toFixed(2)}</span>
                    <span className="text-xs text-muted-foreground">Итоговый КФ</span>
                  </div>
                  <div className="flex flex-col items-center">
                    <span className={`text-2xl ${expressAvgConf >= 75 ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"}`}>{expressAvgConf}%</span>
                    <span className="text-xs text-muted-foreground">Ср. уверенность</span>
                  </div>
                </div>
              )}
            </div>

            {/* Screenshot drop for express */}
            <div
              onDrop={handleDrop}
              onDragOver={e => e.preventDefault()}
              onClick={() => fileInputRef.current?.click()}
              className="rounded-2xl border-2 border-dashed border-border hover:border-violet-400 hover:bg-violet-50 dark:hover:bg-violet-500/5 transition-all p-5 text-center cursor-pointer"
            >
              <Upload className="w-6 h-6 mx-auto mb-2 text-muted-foreground/40" />
              <p className="text-sm font-medium text-muted-foreground">Загрузите скриншоты с матчами</p>
              <p className="text-xs text-muted-foreground/50 mt-1">Сколько матчей на скриншотах — столько слотов и создастся</p>
            </div>
            <input ref={fileInputRef} type="file" accept="image/*" multiple className="hidden" onChange={handleFileInput} />
            {images.length > 0 && (
              <div className="flex items-center gap-3">
                <div className="flex gap-2 flex-wrap">
                  {images.map((img, idx) => (
                    <div key={idx} className="relative group">
                      <img src={img.preview} alt={`#${idx + 1}`} className="w-14 h-14 object-cover rounded-xl border border-border" />
                      <button onClick={e => { e.stopPropagation(); setImages(prev => prev.filter((_, i) => i !== idx)); }}
                        className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-red-500 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                        <X className="w-3 h-3 text-white" />
                      </button>
                    </div>
                  ))}
                </div>
                <Button onClick={analyzeImages} disabled={isAnalyzingImages} variant="outline" size="sm" className="rounded-xl">
                  {isAnalyzingImages ? <Loader2 className="w-3.5 h-3.5 mr-2 animate-spin" /> : <Search className="w-3.5 h-3.5 mr-2" />}
                  Распознать
                </Button>
              </div>
            )}

            {/* Match slots */}
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {slots.map((slot, idx) => {
                const result = expressResults.find(r => r.slotId === slot.id);
                const isCurrent = expressCurrentIdx === slots.filter(s => s.player1 && s.player2).indexOf(slot);
                const colors = ["border-blue-200 dark:border-blue-500/20", "border-orange-200 dark:border-orange-500/20", "border-emerald-200 dark:border-emerald-500/20", "border-purple-200 dark:border-purple-500/20", "border-pink-200 dark:border-pink-500/20"];
                const headerColors = ["bg-blue-50 dark:bg-blue-500/5", "bg-orange-50 dark:bg-orange-500/5", "bg-emerald-50 dark:bg-emerald-500/5", "bg-purple-50 dark:bg-purple-500/5", "bg-pink-50 dark:bg-pink-500/5"];
                const dotColors = ["bg-blue-500", "bg-orange-500", "bg-emerald-500", "bg-purple-500", "bg-pink-500"];
                const ci = idx % colors.length;

                return (
                  <div key={slot.id} className={`rounded-2xl border-2 ${colors[ci]} bg-card shadow-sm overflow-hidden transition-all ${isCurrent ? "ring-2 ring-primary ring-offset-2 ring-offset-background" : ""}`}>
                    <div className={`px-4 py-2.5 ${headerColors[ci]} border-b border-border flex items-center justify-between`}>
                      <div className="flex items-center gap-2">
                        <span className={`w-2.5 h-2.5 rounded-full ${dotColors[ci]}`} />
                        <span className="text-sm font-bold">Матч {idx + 1}</span>
                        {isCurrent && <Loader2 className="w-3.5 h-3.5 animate-spin text-primary" />}
                        {result?.done && !result.error && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />}
                      </div>
                      <button onClick={() => setSlots(prev => prev.filter(s => s.id !== slot.id))}
                        className="w-6 h-6 rounded-lg flex items-center justify-center text-muted-foreground/40 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors">
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    <div className="p-3 space-y-2">
                      <Input
                        value={slot.player1}
                        onChange={e => setSlots(prev => prev.map(s => s.id === slot.id ? { ...s, player1: e.target.value } : s))}
                        placeholder="Игрок 1"
                        className="h-9 rounded-xl text-sm"
                      />
                      <Input
                        value={slot.player2}
                        onChange={e => setSlots(prev => prev.map(s => s.id === slot.id ? { ...s, player2: e.target.value } : s))}
                        placeholder="Игрок 2"
                        className="h-9 rounded-xl text-sm"
                      />
                      <div className="flex gap-2">
                        <Input
                          value={slot.tournament}
                          onChange={e => setSlots(prev => prev.map(s => s.id === slot.id ? { ...s, tournament: e.target.value } : s))}
                          placeholder="Турнир"
                          className="h-9 rounded-xl text-sm flex-1"
                        />
                        <Button
                          variant="outline"
                          size="icon"
                          className="h-9 w-9 rounded-xl flex-none border-primary/30 text-primary hover:bg-primary/10"
                          disabled={slot.isLookingUp || !slot.player1 || !slot.player2}
                          onClick={() => lookupMatch(slot.player1, slot.player2, slot.tournament, slot.id)}
                          title="Авто-заполнить"
                        >
                          {slot.isLookingUp ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                        </Button>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <Select
                          value={slot.surface}
                          onValueChange={v => setSlots(prev => prev.map(s => s.id === slot.id ? { ...s, surface: v } : s))}
                        >
                          <SelectTrigger className="h-9 rounded-xl text-xs">
                            <SelectValue placeholder="Покрытие" />
                          </SelectTrigger>
                          <SelectContent className="rounded-xl">
                            <SelectItem value="Хард">🟦 Хард</SelectItem>
                            <SelectItem value="Грунт">🟧 Грунт</SelectItem>
                            <SelectItem value="Трава">🟩 Трава</SelectItem>
                            <SelectItem value="Крытый">⬛ Крытый</SelectItem>
                          </SelectContent>
                        </Select>
                        <Input
                          type="date"
                          value={slot.matchDate}
                          onChange={e => setSlots(prev => prev.map(s => s.id === slot.id ? { ...s, matchDate: e.target.value } : s))}
                          className="h-9 rounded-xl text-xs"
                        />
                      </div>

                      {/* Slot result */}
                      {result?.done && !result.error && result.recs.length > 0 && (
                        <div className="rounded-xl bg-emerald-50 dark:bg-emerald-500/5 border border-emerald-200 dark:border-emerald-500/20 p-2.5 space-y-1.5">
                          {result.recs.slice(0, 2).map((rec, ri) => (
                            <div key={ri} className="flex items-center justify-between text-xs">
                              <span className="text-foreground/70 truncate flex-1 mr-2">{rec.description}</span>
                              <span className="font-bold text-amber-600 dark:text-amber-400 font-mono">{rec.odds.toFixed(2)}</span>
                            </div>
                          ))}
                          <div className="flex items-center justify-between text-[10px] text-muted-foreground pt-1 border-t border-emerald-200 dark:border-emerald-500/20">
                            <span>{result.vote === "unanimous" ? "✅ Консенсус" : "⚠️ Спорный"}</span>
                            <span className="font-bold">{result.avgConf}%</span>
                          </div>
                        </div>
                      )}
                      {result?.error && (
                        <div className="rounded-xl bg-red-50 dark:bg-red-500/5 border border-red-200 dark:border-red-500/20 p-2 text-xs text-red-600 dark:text-red-400">{result.error}</div>
                      )}
                      {slot.lookupDone && !result && (
                        <div className="flex flex-wrap gap-1">
                          {slot.surface && <SurfaceBadge surface={slot.surface} />}
                          {slot.matchDate && <span className="text-[10px] text-muted-foreground flex items-center gap-1"><Clock className="w-2.5 h-2.5" />{slot.matchDate}</span>}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}

              {/* Add slot button */}
              {slots.length < 20 && (
                <button
                  onClick={() => setSlots(prev => [...prev, mkSlot()])}
                  className="rounded-2xl border-2 border-dashed border-border hover:border-primary/40 hover:bg-primary/5 transition-all p-6 flex flex-col items-center justify-center gap-2 text-muted-foreground hover:text-primary"
                >
                  <Plus className="w-6 h-6" />
                  <span className="text-sm font-semibold">Добавить матч</span>
                </button>
              )}
            </div>

            {/* Express run button */}
            <Button
              onClick={startExpress}
              disabled={expressRunning || slots.filter(s => s.player1 && s.player2).length < 2}
              className="w-full h-14 rounded-2xl text-base font-black bg-gradient-to-r from-orange-500 to-red-500 hover:from-orange-400 hover:to-red-400 text-white shadow-xl hover:shadow-2xl transition-all"
            >
              {expressRunning ? (
                <><Loader2 className="w-5 h-5 mr-2 animate-spin" />Анализирую матч {expressCurrentIdx + 1} из {slots.filter(s => s.player1 && s.player2).length}...</>
              ) : (
                <><Zap className="w-5 h-5 mr-2" />Анализировать экспресс ({slots.filter(s => s.player1 && s.player2).length} матч{slots.filter(s => s.player1 && s.player2).length > 4 ? "ей" : slots.filter(s => s.player1 && s.player2).length > 1 ? "а" : ""})</>
              )}
            </Button>

            {/* Express summary */}
            {expressResults.length > 0 && !expressRunning && (
              <div className="rounded-2xl border-2 border-orange-300 dark:border-orange-500/30 bg-gradient-to-br from-orange-50 to-amber-50 dark:from-orange-500/5 dark:to-amber-500/5 p-5 pop-in">
                <div className="flex items-center justify-between mb-4">
                  <div className="font-black text-lg text-orange-700 dark:text-orange-300 flex items-center gap-2">
                    🔥 Ваш экспресс готов!
                  </div>
                  <div className="text-right">
                    <div className="text-3xl font-black text-orange-600 dark:text-orange-400">{expressOdds.toFixed(2)}</div>
                    <div className="text-xs text-muted-foreground">итоговый КФ</div>
                  </div>
                </div>
                <div className="space-y-2">
                  {expressResults.map((r, i) => {
                    const bestRec = r.recs.reduce((best, rec) => (!best || rec.confidencePercent > best.confidencePercent) ? rec : best, null as BettingRecommendation | null);
                    return (
                      <div key={i} className="flex items-center gap-3 rounded-xl bg-white/70 dark:bg-white/5 border border-orange-200/50 dark:border-white/10 px-3 py-2">
                        <span className="w-6 h-6 rounded-full bg-orange-500 text-white text-xs font-bold flex items-center justify-center flex-none">{i + 1}</span>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-semibold truncate">{r.player1} vs {r.player2}</div>
                          {bestRec && <div className="text-xs text-muted-foreground truncate">{bestRec.description}</div>}
                        </div>
                        <div className="text-right flex-none">
                          <div className="font-bold text-amber-600 dark:text-amber-400">{bestRec ? bestRec.odds.toFixed(2) : "—"}</div>
                          <div className={`text-[10px] font-semibold ${r.avgConf >= 75 ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"}`}>{r.avgConf}%</div>
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div className="mt-4 pt-3 border-t border-orange-200 dark:border-orange-500/20 flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Средняя уверенность</span>
                  <span className={`font-black text-lg ${expressAvgConf >= 75 ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"}`}>{expressAvgConf}%</span>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </Layout>
  );
}

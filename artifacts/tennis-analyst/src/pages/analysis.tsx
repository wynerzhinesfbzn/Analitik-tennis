import { Layout } from "@/components/layout";
import { useState, useRef, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  Play, Upload, X, Headphones, Loader2,
  TrendingUp, TrendingDown, AlertTriangle, Search, Database,
  Wifi, Target, ShieldAlert, Percent, ChevronRight,
  CircleDot, Zap, DollarSign, BarChart3, Clock, StopCircle,
  RefreshCw, Send, Brain, Activity,
} from "lucide-react";

interface AgentMessage {
  agent: string;
  agentLabel: string;
  content: string;
  isReply?: boolean;
}
interface BettingRecommendation {
  type: string;
  description: string;
  odds: number;
  bankPercent: number;
  confidencePercent: number;
}
interface UploadedImage {
  file: File;
  preview: string;
  base64: string;
}
type AnalysisPhase = "idle" | "research" | "dialogue" | "recommendations" | "done";

const AGENT_META: Record<string, {
  label: string; color: string; bg: string; border: string;
  provider: string; providerBadge: string; icon: string;
}> = {
  stats_expert:    { label: "Статистик",    color: "text-cyan-300",   bg: "bg-cyan-500/5",   border: "border-cyan-500/20",   provider: "Gemini",   providerBadge: "bg-cyan-500/10 text-cyan-400 border-cyan-500/30",   icon: "📊" },
  odds_strategist: { label: "Одс-стратег",  color: "text-amber-300",  bg: "bg-amber-500/5",  border: "border-amber-500/20",  provider: "Claude",   providerBadge: "bg-amber-500/10 text-amber-400 border-amber-500/30",   icon: "💹" },
  context_expert:  { label: "Контекст",     color: "text-violet-300", bg: "bg-violet-500/5", border: "border-violet-500/20", provider: "GPT",      providerBadge: "bg-violet-500/10 text-violet-400 border-violet-500/30", icon: "🧠" },
};

function ConfBar({ pct }: { pct: number }) {
  const color = pct >= 88 ? "bg-emerald-500" : pct >= 78 ? "bg-amber-500" : "bg-orange-500";
  const text  = pct >= 88 ? "text-emerald-400" : pct >= 78 ? "text-amber-400" : "text-orange-400";
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 rounded-full bg-white/5 overflow-hidden">
        <div className={`h-full rounded-full transition-all duration-500 ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className={`text-xs font-bold font-mono tabular-nums ${text}`}>{pct}%</span>
    </div>
  );
}

function FatigueBar({ score, label }: { score: number; label: string }) {
  const color = score <= 3 ? "bg-emerald-500" : score <= 6 ? "bg-amber-500" : "bg-red-500";
  const textColor = score <= 3 ? "text-emerald-400" : score <= 6 ? "text-amber-400" : "text-red-400";
  return (
    <div className="flex items-center gap-2">
      <span className="text-[10px] text-muted-foreground/60 w-20 truncate">{label}</span>
      <div className="flex-1 h-1.5 rounded-full bg-white/5 overflow-hidden">
        <div className={`h-full rounded-full transition-all duration-500 ${color}`} style={{ width: `${score * 10}%` }} />
      </div>
      <span className={`text-[10px] font-bold font-mono w-8 text-right tabular-nums ${textColor}`}>{score}/10</span>
    </div>
  );
}

function OddsChip({ value }: { value: number }) {
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-amber-500/10 border border-amber-500/30 font-mono text-sm font-bold text-amber-300">
      {value.toFixed(2)}
    </span>
  );
}

export default function AnalysisPage() {
  const { toast } = useToast();

  const [player1, setPlayer1] = useState("");
  const [player2, setPlayer2] = useState("");
  const [tournament, setTournament] = useState("");
  const [surface, setSurface] = useState("");
  const [matchDate, setMatchDate] = useState("");
  const [oddsData, setOddsData] = useState<Record<string, unknown> | null>(null);
  const [forceRefresh, setForceRefresh] = useState(false);

  const [images, setImages] = useState<UploadedImage[]>([]);
  const [isAnalyzingImages, setIsAnalyzingImages] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [phase, setPhase] = useState<AnalysisPhase>("idle");
  const [researchMsg, setResearchMsg] = useState("");
  const [usedWebSearch, setUsedWebSearch] = useState(false);
  const [detectedMatch, setDetectedMatch] = useState<{
    tournament?: string; surface?: string; date?: string; round?: string;
    location?: string; conditions?: string; fatigue1?: number; fatigue2?: number;
  } | null>(null);
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
    const imageFiles = files.filter(f => f.type.startsWith("image/"));
    if (!imageFiles.length) return;
    const newImages: UploadedImage[] = [];
    for (const file of imageFiles) {
      const { base64, preview } = await readFileAsBase64(file);
      newImages.push({ file, preview, base64 });
    }
    setImages(prev => [...prev, ...newImages]);
  }, []);

  const handleFileInput = async (e: React.ChangeEvent<HTMLInputElement>) => {
    await addImages(Array.from(e.target.files ?? []));
    if (fileInputRef.current) fileInputRef.current.value = "";
  };
  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    await addImages(Array.from(e.dataTransfer.files));
  }, [addImages]);

  const analyzeImages = async () => {
    if (!images.length) return;
    setIsAnalyzingImages(true);
    try {
      const res = await fetch("/api/predictions/analyze-images", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ images: images.map(i => i.base64) }),
      });
      const data = await res.json();
      if (data.player1) setPlayer1(data.player1);
      if (data.player2) setPlayer2(data.player2);
      if (data.tournament) setTournament(data.tournament);
      if (data.surface) setSurface(data.surface);
      if (data.matchDate) setMatchDate(data.matchDate);
      if (data.odds) setOddsData(data.odds);
      toast({ title: `✅ ${images.length} скриншот(а/ов) распознано` });
    } catch {
      toast({ title: "Ошибка анализа скриншотов", variant: "destructive" });
    } finally {
      setIsAnalyzingImages(false);
    }
  };

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
              setDetectedMatch({
                tournament: event.tournament, surface: event.surface, date: event.date,
                round: event.round, location: event.location, conditions: event.conditions,
                fatigue1: event.fatigue1, fatigue2: event.fatigue2,
              });
            }
            else if (event.type === "research_complete") { setUsedWebSearch(event.usedWebSearch ?? false); setPhase("dialogue"); }
            else if (event.type === "ml_adjustment") {
              setMlInfo({ adjustment: event.adjustment, sampleSize: event.sampleSize, sampleAccuracy: event.sampleAccuracy });
            }
            else if (event.type === "agent_start") {
              if (localCurrentMsg) setDialogue(prev => [...prev, localCurrentMsg!]);
              localCurrentMsg = { agent: event.agent, agentLabel: event.agentLabel, content: "", isReply: event.isReply };
              setCurrentMsg({ ...localCurrentMsg });
            } else if (event.type === "agent_chunk") {
              if (localCurrentMsg) { localCurrentMsg = { ...localCurrentMsg, content: localCurrentMsg.content + event.content }; setCurrentMsg({ ...localCurrentMsg }); }
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

  const generatePodcast = async () => {
    if (!savedPredictionId) return;
    setIsGeneratingPodcast(true);
    setPodcastUrl(null);
    try {
      const res = await fetch(`/api/predictions/${savedPredictionId}/podcast`, { method: "POST" });
      if (!res.ok) throw new Error("Failed");
      setPodcastUrl(URL.createObjectURL(await res.blob()));
    } catch {
      toast({ title: "Ошибка генерации подкаста", variant: "destructive" });
    } finally {
      setIsGeneratingPodcast(false);
    }
  };

  const publishToTelegram = async () => {
    if (!savedPredictionId) return;
    setIsPublishingTelegram(true);
    try {
      const res = await fetch(`/api/predictions/${savedPredictionId}/telegram`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        toast({ title: data.error ?? "Ошибка Telegram", variant: "destructive" });
        return;
      }
      setTelegramPublished(true);
      toast({ title: data.alreadyPublished ? "Уже опубликовано в Telegram" : "✅ Опубликовано в Telegram!" });
    } catch {
      toast({ title: "Ошибка публикации", variant: "destructive" });
    } finally {
      setIsPublishingTelegram(false);
    }
  };

  const isRunning = phase === "research" || phase === "dialogue" || phase === "recommendations";
  const fatigueScore1 = (savedPrediction as any)?.fatigueScore1 ?? detectedMatch?.fatigue1;
  const fatigueScore2 = (savedPrediction as any)?.fatigueScore2 ?? detectedMatch?.fatigue2;
  const mlAdjustment = mlInfo?.adjustment ?? (savedPrediction as any)?.mlAdjustment;

  return (
    <Layout>
      <div className="max-w-[1400px] mx-auto space-y-4">

        {/* ── PAGE TITLE ROW ── */}
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <BarChart3 className="w-5 h-5 text-cyan-400" />
              <h1 className="text-sm font-bold uppercase tracking-[0.15em] text-foreground">Аналитика матча</h1>
            </div>
            <span className="text-[10px] text-muted-foreground uppercase tracking-widest border-l border-border pl-3">
              3 AI агента · Real-time · PRO
            </span>
          </div>
          <div className="flex items-center gap-2">
            {mlInfo && mlInfo.sampleSize > 0 && (
              <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded border text-[10px] font-bold uppercase tracking-wider ${mlAdjustment > 0 ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400" : mlAdjustment < 0 ? "bg-red-500/10 border-red-500/30 text-red-400" : "bg-white/5 border-border text-muted-foreground"}`}>
                <Brain className="w-3 h-3" />
                ML {mlAdjustment > 0 ? "+" : ""}{mlAdjustment}% · {mlInfo.sampleAccuracy}% точн.
              </div>
            )}
            {phase === "done" && vote && (
              <div className={`flex items-center gap-2 px-3 py-1 rounded border text-xs font-bold uppercase tracking-wider ${vote.verdict === "unanimous" ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400" : "bg-amber-500/10 border-amber-500/30 text-amber-400"}`}>
                {vote.verdict === "unanimous" ? <Target className="w-3.5 h-3.5" /> : <AlertTriangle className="w-3.5 h-3.5" />}
                {vote.verdict === "unanimous" ? "Консенсус" : "Спорный"} · {vote.avgConfidence}%
              </div>
            )}
          </div>
        </div>

        {/* ── MAIN GRID ── */}
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-4">

          {/* ═══ LEFT PANEL ═══ */}
          <div className="xl:col-span-4 space-y-4">

            {/* Screenshot drop zone */}
            <div className="rounded border border-border bg-card overflow-hidden">
              <div className="px-4 py-2.5 border-b border-border flex items-center justify-between bg-white/[0.02]">
                <div className="flex items-center gap-2">
                  <Upload className="w-3.5 h-3.5 text-muted-foreground" />
                  <span className="text-[11px] font-bold uppercase tracking-[0.15em] text-muted-foreground">Скриншоты букмекера</span>
                </div>
                {images.length > 0 && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-cyan-500/10 border border-cyan-500/20 text-cyan-400 font-mono">{images.length}</span>
                )}
              </div>
              <div className="p-3 space-y-3">
                <div
                  onDrop={handleDrop}
                  onDragOver={e => e.preventDefault()}
                  onClick={() => fileInputRef.current?.click()}
                  className="group border border-dashed border-border rounded cursor-pointer hover:border-cyan-500/40 hover:bg-cyan-500/3 transition-all duration-200 p-5 text-center select-none"
                >
                  <Upload className="w-5 h-5 mx-auto mb-2 text-muted-foreground/50 group-hover:text-cyan-400/70 transition-colors" />
                  <p className="text-xs text-muted-foreground/70 group-hover:text-muted-foreground transition-colors">Перетащите или кликните</p>
                  <p className="text-[10px] text-muted-foreground/40 mt-1">Состав · Коэффициенты · Линия</p>
                </div>
                <input ref={fileInputRef} type="file" accept="image/*" multiple className="hidden" onChange={handleFileInput} />

                {images.length > 0 && (
                  <div className="space-y-2">
                    <div className="flex flex-wrap gap-1.5">
                      {images.map((img, idx) => (
                        <div key={idx} className="relative group">
                          <img src={img.preview} alt={`#${idx + 1}`} className="w-14 h-14 object-cover rounded border border-border" />
                          <button
                            onClick={e => { e.stopPropagation(); setImages(prev => prev.filter((_, i) => i !== idx)); }}
                            className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                          >
                            <X className="w-2.5 h-2.5 text-white" />
                          </button>
                        </div>
                      ))}
                    </div>
                    <button
                      onClick={analyzeImages}
                      disabled={isAnalyzingImages}
                      className="w-full h-8 rounded border border-cyan-500/30 bg-cyan-500/5 text-cyan-400 hover:bg-cyan-500/10 text-xs font-medium uppercase tracking-wider transition-all flex items-center justify-center gap-2 disabled:opacity-50"
                    >
                      {isAnalyzingImages ? <><Loader2 className="w-3 h-3 animate-spin" />OCR...</> : <><Search className="w-3 h-3" />Распознать {images.length} скриншот{images.length > 1 ? "а" : ""}</>}
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* Match params */}
            <div className="rounded border border-border bg-card overflow-hidden">
              <div className="px-4 py-2.5 border-b border-border flex items-center gap-2 bg-white/[0.02]">
                <CircleDot className="w-3.5 h-3.5 text-muted-foreground" />
                <span className="text-[11px] font-bold uppercase tracking-[0.15em] text-muted-foreground">Параметры матча</span>
              </div>
              <div className="p-3 space-y-3">

                {/* Players VS block */}
                <div className="rounded bg-white/[0.02] border border-border p-3 space-y-2.5">
                  <div className="space-y-1">
                    <Label className="text-[10px] uppercase tracking-wider text-muted-foreground/70 flex items-center gap-1">
                      <span className="w-4 h-4 rounded-sm bg-cyan-500/20 text-cyan-400 text-[9px] flex items-center justify-center font-bold">П1</span>
                      Игрок 1
                    </Label>
                    <Input
                      value={player1}
                      onChange={e => setPlayer1(e.target.value)}
                      placeholder="Novak Djokovic"
                      className="h-9 bg-background border-border text-sm font-medium placeholder:text-muted-foreground/30 focus-visible:border-cyan-500/50"
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="flex-1 h-px bg-border" />
                    <span className="text-[10px] font-bold text-muted-foreground/40 tracking-widest uppercase">vs</span>
                    <div className="flex-1 h-px bg-border" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[10px] uppercase tracking-wider text-muted-foreground/70 flex items-center gap-1">
                      <span className="w-4 h-4 rounded-sm bg-rose-500/20 text-rose-400 text-[9px] flex items-center justify-center font-bold">П2</span>
                      Игрок 2
                    </Label>
                    <Input
                      value={player2}
                      onChange={e => setPlayer2(e.target.value)}
                      placeholder="Carlos Alcaraz"
                      className="h-9 bg-background border-border text-sm font-medium placeholder:text-muted-foreground/30 focus-visible:border-cyan-500/50"
                    />
                  </div>
                </div>

                {/* Surface + Date */}
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <Label className="text-[10px] uppercase tracking-wider text-muted-foreground/70">Покрытие</Label>
                    <Select value={surface} onValueChange={setSurface}>
                      <SelectTrigger className="h-9 bg-background border-border text-sm focus:border-cyan-500/50">
                        <SelectValue placeholder="Выбрать" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Хард">🟦 Хард</SelectItem>
                        <SelectItem value="Грунт">🟧 Грунт</SelectItem>
                        <SelectItem value="Трава">🟩 Трава</SelectItem>
                        <SelectItem value="Крытый">⬛ Крытый</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[10px] uppercase tracking-wider text-muted-foreground/70 flex items-center gap-1">
                      <Clock className="w-2.5 h-2.5" />Дата
                    </Label>
                    <Input type="date" value={matchDate} onChange={e => setMatchDate(e.target.value)} className="h-9 bg-background border-border text-sm focus-visible:border-cyan-500/50" />
                  </div>
                </div>

                {/* Tournament */}
                <div className="space-y-1">
                  <Label className="text-[10px] uppercase tracking-wider text-muted-foreground/70">Турнир</Label>
                  <Input value={tournament} onChange={e => setTournament(e.target.value)} placeholder="Wimbledon, Roland Garros..." className="h-9 bg-background border-border text-sm placeholder:text-muted-foreground/30 focus-visible:border-cyan-500/50" />
                </div>

                {/* Force Refresh toggle */}
                <button
                  type="button"
                  onClick={() => setForceRefresh(v => !v)}
                  className={`w-full h-8 rounded border text-[11px] font-medium uppercase tracking-wider flex items-center justify-center gap-2 transition-all ${forceRefresh ? "bg-sky-500/15 border-sky-500/40 text-sky-400" : "bg-white/[0.02] border-border text-muted-foreground/50 hover:border-sky-500/30 hover:text-sky-400/70"}`}
                >
                  <RefreshCw className={`w-3 h-3 ${forceRefresh ? "animate-spin" : ""}`} />
                  {forceRefresh ? "🌐 Глубокий поиск ON" : "🌐 Глубокий поиск (сброс кеша)"}
                </button>

                {/* Odds badge */}
                {oddsData && (
                  <div className="flex items-center gap-2 px-3 py-2 rounded bg-amber-500/8 border border-amber-500/20">
                    <DollarSign className="w-3.5 h-3.5 text-amber-400" />
                    <span className="text-xs text-amber-300 font-medium">Коэффициенты загружены из скриншота</span>
                  </div>
                )}

                {/* CTA */}
                <button
                  onClick={startAnalysis}
                  disabled={isRunning || !player1 || !player2}
                  className={`w-full h-11 rounded font-bold uppercase tracking-[0.15em] text-sm transition-all duration-200 flex items-center justify-center gap-2 ${
                    isRunning
                      ? "bg-cyan-500/10 border border-cyan-500/20 text-cyan-400 cursor-not-allowed"
                      : (!player1 || !player2)
                        ? "bg-white/5 border border-border text-muted-foreground/40 cursor-not-allowed"
                        : "bg-cyan-500 hover:bg-cyan-400 text-black border border-cyan-400 shadow-lg shadow-cyan-500/20"
                  }`}
                >
                  {isRunning
                    ? <><Loader2 className="w-4 h-4 animate-spin" />Анализируем...</>
                    : <><Zap className="w-4 h-4" />Запустить анализ</>}
                </button>
              </div>
            </div>

            {/* Detected match context + fatigue */}
            {detectedMatch && (
              <div className="rounded border border-emerald-500/20 bg-emerald-500/5 overflow-hidden">
                <div className="px-4 py-2 border-b border-emerald-500/20 flex items-center gap-2">
                  <Wifi className="w-3 h-3 text-emerald-400" />
                  <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-400">Данные из сети</span>
                </div>
                <div className="p-3 space-y-2">
                  <div className="grid grid-cols-2 gap-1.5">
                    {[
                      { label: "Турнир", value: detectedMatch.tournament },
                      { label: "Покрытие", value: detectedMatch.surface },
                      { label: "Дата", value: detectedMatch.date },
                      { label: "Раунд", value: detectedMatch.round },
                      { label: "Локация", value: detectedMatch.location },
                    ].filter(i => i.value).map(item => (
                      <div key={item.label} className="rounded bg-white/[0.03] border border-white/5 px-2 py-1.5">
                        <div className="text-[9px] uppercase tracking-wider text-muted-foreground/60">{item.label}</div>
                        <div className="text-[11px] text-foreground/90 font-medium truncate mt-0.5">{item.value}</div>
                      </div>
                    ))}
                  </div>

                  {/* Fatigue indicators */}
                  {(fatigueScore1 != null || fatigueScore2 != null) && (
                    <div className="rounded bg-white/[0.03] border border-orange-500/15 px-3 py-2.5 space-y-2">
                      <div className="flex items-center gap-1.5 text-orange-400 text-[10px] font-bold uppercase tracking-wider">
                        <Activity className="w-3 h-3" />Усталость (0=свеж · 10=измотан)
                      </div>
                      {fatigueScore1 != null && (
                        <FatigueBar score={fatigueScore1} label={player1 || "Игрок 1"} />
                      )}
                      {fatigueScore2 != null && (
                        <FatigueBar score={fatigueScore2} label={player2 || "Игрок 2"} />
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* ═══ RIGHT PANEL — Terminal ═══ */}
          <div className="xl:col-span-8 flex flex-col gap-4">

            {/* Terminal card */}
            <div className="rounded border border-border bg-[#060a12] flex flex-col overflow-hidden" style={{ height: 580 }}>

              {/* Terminal header */}
              <div className="flex-none flex items-center justify-between px-4 py-2.5 border-b border-border bg-white/[0.02]">
                <div className="flex items-center gap-3">
                  <div className="flex gap-1.5">
                    <div className={`w-2.5 h-2.5 rounded-full ${isRunning ? "bg-red-500 animate-pulse" : phase === "done" ? "bg-emerald-500" : "bg-white/10"}`} />
                    <div className={`w-2.5 h-2.5 rounded-full ${phase !== "idle" ? "bg-amber-500" : "bg-white/10"}`} />
                    <div className={`w-2.5 h-2.5 rounded-full ${phase === "done" ? "bg-emerald-500" : "bg-white/10"}`} />
                  </div>
                  <span className="text-[11px] font-bold uppercase tracking-[0.2em] text-muted-foreground/70">
                    {phase === "idle" && "// terminal · ожидание"}
                    {phase === "research" && "// веб-поиск · сканирование..."}
                    {phase === "dialogue" && "// совещание аналитиков"}
                    {phase === "recommendations" && "// генерация рекомендаций..."}
                    {phase === "done" && "// анализ завершён ✓"}
                  </span>
                  {phase === "dialogue" && currentMsg && (
                    <span className="text-[10px] text-cyan-400/60 font-mono animate-pulse hidden sm:inline">
                      {AGENT_META[currentMsg.agent]?.icon} {currentMsg.agentLabel} печатает...
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {usedWebSearch && (
                    <span className="flex items-center gap-1 px-2 py-0.5 rounded bg-sky-500/10 border border-sky-500/20 text-[10px] font-bold text-sky-400 uppercase tracking-wider">
                      <Wifi className="w-2.5 h-2.5" />Live
                    </span>
                  )}
                  {mlInfo && mlInfo.sampleSize > 0 && (
                    <span className={`flex items-center gap-1 px-2 py-0.5 rounded border text-[10px] font-bold uppercase tracking-wider ${mlAdjustment > 0 ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400" : mlAdjustment < 0 ? "bg-red-500/10 border-red-500/30 text-red-400" : "bg-white/5 border-border text-muted-foreground"}`}>
                      <Brain className="w-2.5 h-2.5" />ML {mlAdjustment > 0 ? "+" : ""}{mlAdjustment}%
                    </span>
                  )}
                  {vote && (
                    <span className={`flex items-center gap-1 px-2 py-0.5 rounded border text-[10px] font-bold uppercase tracking-wider ${vote.verdict === "unanimous" ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400" : "bg-amber-500/10 border-amber-500/30 text-amber-400"}`}>
                      {vote.verdict === "unanimous" ? "✓ Консенсус" : "⚠ Спорно"} {vote.avgConfidence}%
                    </span>
                  )}
                </div>
              </div>

              {/* Scrollable terminal body */}
              <div ref={terminalRef} className="flex-1 overflow-y-auto p-4 space-y-3">

                {phase === "idle" && (
                  <div className="h-full flex flex-col items-center justify-center gap-3 text-muted-foreground/20 select-none">
                    <Database className="w-10 h-10" />
                    <span className="text-xs font-mono tracking-widest">// введите данные матча и нажмите запустить</span>
                    <div className="flex gap-3 text-[10px] font-mono text-muted-foreground/15 mt-2">
                      <span>stats_expert</span><span>·</span><span>odds_strategist</span><span>·</span><span>context_expert</span>
                    </div>
                    <div className="flex gap-4 text-[10px] font-mono text-muted-foreground/10 mt-1">
                      <span>web_search</span><span>·</span><span>ml_adjustment</span><span>·</span><span>fatigue_score</span>
                    </div>
                  </div>
                )}

                {/* Research status */}
                {(phase === "research" || (phase !== "idle" && researchMsg)) && (
                  <div className="rounded border border-sky-500/15 bg-sky-500/5 px-3 py-2 space-y-1.5">
                    <div className="flex items-center gap-2 text-sky-400">
                      <Search className="w-3 h-3" />
                      <span className="text-[10px] font-bold uppercase tracking-wider">Глубокий веб-поиск</span>
                      {phase === "research" && <Loader2 className="w-3 h-3 animate-spin ml-auto" />}
                    </div>
                    {researchMsg && <p className="text-[11px] font-mono text-sky-300/60">&gt; {researchMsg}</p>}
                  </div>
                )}

                {/* ML adjustment notice */}
                {mlInfo && mlInfo.sampleSize > 0 && (
                  <div className={`rounded border px-3 py-2 flex items-center gap-2 ${mlAdjustment > 0 ? "border-emerald-500/15 bg-emerald-500/5" : mlAdjustment < 0 ? "border-red-500/15 bg-red-500/5" : "border-border bg-white/[0.02]"}`}>
                    <Brain className={`w-3 h-3 ${mlAdjustment > 0 ? "text-emerald-400" : mlAdjustment < 0 ? "text-red-400" : "text-muted-foreground"}`} />
                    <span className="text-[11px] font-mono text-muted-foreground/70">
                      ML-коррекция: {mlAdjustment > 0 ? "+" : ""}{mlAdjustment}% · на основе {mlInfo.sampleSize} прогнозов ({mlInfo.sampleAccuracy}% точность)
                    </span>
                  </div>
                )}

                {/* Dialogue messages */}
                {[...dialogue, ...(currentMsg ? [currentMsg] : [])].map((msg, idx) => {
                  const meta = AGENT_META[msg.agent] ?? { label: msg.agentLabel, color: "text-foreground", bg: "bg-white/5", border: "border-border", provider: "AI", providerBadge: "bg-white/10 text-muted-foreground border-border", icon: "🤖" };
                  const isCurrent = currentMsg && idx === dialogue.length;
                  return (
                    <div key={idx} className={`rounded border ${meta.border} ${meta.bg} overflow-hidden`}>
                      <div className={`flex items-center gap-2 px-3 py-2 border-b ${meta.border} bg-white/[0.02]`}>
                        <span className="text-sm">{meta.icon}</span>
                        <span className={`text-[11px] font-bold uppercase tracking-wider ${meta.color}`}>{msg.agentLabel}</span>
                        {msg.isReply && <ChevronRight className="w-3 h-3 text-muted-foreground/30" />}
                        <span className={`ml-auto text-[9px] px-1.5 py-0.5 rounded border font-mono uppercase tracking-wide ${meta.providerBadge}`}>{meta.provider}</span>
                        {isCurrent && <span className="w-1.5 h-3.5 bg-current rounded-sm animate-pulse opacity-60 ml-1" />}
                      </div>
                      <div className="px-3 py-2.5 text-[12px] leading-relaxed text-foreground/80 font-mono whitespace-pre-wrap">
                        {msg.content || <span className="text-muted-foreground/30 italic">...</span>}
                      </div>
                    </div>
                  );
                })}

                {phase === "recommendations" && recommendations.length === 0 && (
                  <div className="flex items-center gap-2 px-3 py-2 rounded border border-amber-500/20 bg-amber-500/5 text-amber-400">
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span className="text-xs font-mono uppercase tracking-wider">Генерируем беттинг-рекомендации + ML-коррекция...</span>
                  </div>
                )}
              </div>
            </div>

            {/* ── RECOMMENDATIONS ── */}
            {recommendations.length > 0 && (
              <div className="rounded border border-border bg-card overflow-hidden">
                <div className="px-4 py-2.5 border-b border-border flex items-center justify-between bg-white/[0.02] flex-wrap gap-2">
                  <div className="flex items-center gap-2">
                    <Target className="w-3.5 h-3.5 text-amber-400" />
                    <span className="text-[11px] font-bold uppercase tracking-[0.15em] text-muted-foreground">Беттинг-рекомендации</span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/10 border border-amber-500/20 text-amber-400 font-mono">{recommendations.length}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    {savedPredictionId && (
                      <>
                        <button
                          onClick={generatePodcast}
                          disabled={isGeneratingPodcast}
                          className="flex items-center gap-1.5 px-3 py-1 rounded border border-violet-500/30 bg-violet-500/5 text-violet-400 hover:bg-violet-500/10 text-[11px] font-medium uppercase tracking-wider transition-colors disabled:opacity-50"
                        >
                          {isGeneratingPodcast ? <Loader2 className="w-3 h-3 animate-spin" /> : <Headphones className="w-3 h-3" />}
                          Подкаст
                        </button>
                        <button
                          onClick={publishToTelegram}
                          disabled={isPublishingTelegram || telegramPublished}
                          className={`flex items-center gap-1.5 px-3 py-1 rounded border text-[11px] font-medium uppercase tracking-wider transition-colors disabled:opacity-50 ${telegramPublished ? "border-sky-500/50 bg-sky-500/10 text-sky-400" : "border-sky-500/30 bg-sky-500/5 text-sky-400 hover:bg-sky-500/10"}`}
                        >
                          {isPublishingTelegram ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
                          {telegramPublished ? "Опубликовано" : "Telegram"}
                        </button>
                      </>
                    )}
                  </div>
                </div>

                <div className="p-3 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
                  {recommendations.map((rec, idx) => (
                    <div key={idx} className="rounded border border-border bg-background/60 overflow-hidden hover:border-amber-500/30 transition-colors">
                      <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-white/[0.02]">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{rec.type}</span>
                        <OddsChip value={rec.odds} />
                      </div>
                      <div className="px-3 py-2.5 space-y-2.5">
                        <p className="text-xs text-foreground/80 leading-relaxed">{rec.description}</p>
                        <div className="space-y-1.5">
                          <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                            <span className="flex items-center gap-1"><Percent className="w-2.5 h-2.5" />Уверенность</span>
                          </div>
                          <ConfBar pct={rec.confidencePercent} />
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] text-muted-foreground uppercase">Банк</span>
                          <span className="text-xs font-bold font-mono text-emerald-400">{rec.bankPercent}%</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Fatigue summary under recommendations */}
                {(fatigueScore1 != null || fatigueScore2 != null) && (
                  <div className="px-3 pb-3">
                    <div className="rounded border border-orange-500/20 bg-orange-500/5 p-3 space-y-2">
                      <div className="flex items-center gap-1.5 text-orange-400 text-[10px] font-bold uppercase tracking-wider">
                        <Activity className="w-3 h-3" />Усталость игроков
                      </div>
                      {fatigueScore1 != null && <FatigueBar score={fatigueScore1} label={player1} />}
                      {fatigueScore2 != null && <FatigueBar score={fatigueScore2} label={player2} />}
                    </div>
                  </div>
                )}

                {/* Risk + Cashout */}
                {(riskNotes || cashoutAdvice) && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 px-3 pb-3">
                    {riskNotes && (
                      <div className="rounded border border-red-500/20 bg-red-500/5 p-3 space-y-1">
                        <div className="flex items-center gap-1.5 text-red-400 text-[10px] font-bold uppercase tracking-wider">
                          <ShieldAlert className="w-3 h-3" />Риск-факторы
                        </div>
                        <p className="text-[11px] text-foreground/70 leading-relaxed">{riskNotes}</p>
                      </div>
                    )}
                    {cashoutAdvice && (
                      <div className="rounded border border-emerald-500/20 bg-emerald-500/5 p-3 space-y-1">
                        <div className="flex items-center gap-1.5 text-emerald-400 text-[10px] font-bold uppercase tracking-wider">
                          <StopCircle className="w-3 h-3" />Кэшаут-стратегия
                        </div>
                        <p className="text-[11px] text-foreground/70 leading-relaxed">{cashoutAdvice}</p>
                      </div>
                    )}
                  </div>
                )}

                {/* Podcast player */}
                {podcastUrl && (
                  <div className="mx-3 mb-3 rounded border border-violet-500/20 bg-violet-500/5 p-3 space-y-2">
                    <div className="flex items-center gap-2 text-violet-400 text-[10px] font-bold uppercase tracking-wider">
                      <Headphones className="w-3.5 h-3.5" />Аудио-подкаст готов
                    </div>
                    <audio controls src={podcastUrl} className="w-full h-8" />
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </Layout>
  );
}

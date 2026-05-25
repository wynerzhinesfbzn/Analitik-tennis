import { Layout } from "@/components/layout";
import { useState, useRef, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  Play, Upload, X, Headphones, Loader2,
  TrendingUp, AlertTriangle, CheckCircle2,
  Search, Database, Wifi,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";

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

type AnalysisPhase =
  | "idle"
  | "research"
  | "dialogue"
  | "recommendations"
  | "done";

const AGENT_META: Record<string, { emoji: string; color: string; borderColor: string; provider: string; providerColor: string }> = {
  stats_expert:    { emoji: "📊", color: "text-sky-400",    borderColor: "border-sky-400/30",    provider: "Google Gemini",   providerColor: "text-sky-500/60" },
  odds_strategist: { emoji: "💰", color: "text-yellow-400", borderColor: "border-yellow-400/30", provider: "Anthropic Claude", providerColor: "text-orange-400/60" },
  context_expert:  { emoji: "🧠", color: "text-purple-400", borderColor: "border-purple-400/30", provider: "OpenAI GPT",       providerColor: "text-green-500/60" },
};

function confidenceColor(pct: number) {
  if (pct >= 88) return "text-emerald-400";
  if (pct >= 78) return "text-yellow-400";
  return "text-orange-400";
}
function confidenceBg(pct: number) {
  if (pct >= 88) return "bg-emerald-500/10 border-emerald-500/30";
  if (pct >= 78) return "bg-yellow-500/10 border-yellow-500/30";
  return "bg-orange-500/10 border-orange-500/30";
}

export default function AnalysisPage() {
  const { toast } = useToast();

  const [player1, setPlayer1] = useState("");
  const [player2, setPlayer2] = useState("");
  const [tournament, setTournament] = useState("");
  const [surface, setSurface] = useState("");
  const [matchDate, setMatchDate] = useState("");
  const [oddsData, setOddsData] = useState<Record<string, unknown> | null>(null);

  const [images, setImages] = useState<UploadedImage[]>([]);
  const [isAnalyzingImages, setIsAnalyzingImages] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [phase, setPhase] = useState<AnalysisPhase>("idle");
  const [researchMsg, setResearchMsg] = useState("");
  const [researchContext, setResearchContext] = useState("");
  const [usedWebSearch, setUsedWebSearch] = useState(false);
  const [detectedMatch, setDetectedMatch] = useState<{
    tournament?: string;
    surface?: string;
    date?: string;
    round?: string;
    location?: string;
    conditions?: string;
  } | null>(null);
  const [dialogue, setDialogue] = useState<AgentMessage[]>([]);
  const [currentMsg, setCurrentMsg] = useState<AgentMessage | null>(null);
  const [recommendations, setRecommendations] = useState<BettingRecommendation[]>([]);
  const [vote, setVote] = useState<{ verdict: string; avgConfidence: number } | null>(null);
  const [savedPredictionId, setSavedPredictionId] = useState<number | null>(null);
  const [riskNotes, setRiskNotes] = useState("");
  const [cashoutAdvice, setCashoutAdvice] = useState("");

  const [isGeneratingPodcast, setIsGeneratingPodcast] = useState(false);
  const [podcastUrl, setPodcastUrl] = useState<string | null>(null);

  const terminalRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (terminalRef.current) {
      terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
    }
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
    setDialogue([]);
    setCurrentMsg(null);
    setRecommendations([]);
    setVote(null);
    setSavedPredictionId(null);
    setRiskNotes("");
    setCashoutAdvice("");
    setPodcastUrl(null);
    setResearchMsg("");
    setResearchContext("");
    setUsedWebSearch(false);
    setDetectedMatch(null);
    setPhase("research");

    try {
      const res = await fetch("/api/predictions/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ player1, player2, tournament, surface, matchDate, odds: oddsData }),
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

            if (event.type === "research_start") {
              setPhase("research");
            } else if (event.type === "research_progress") {
              setResearchMsg(event.message ?? "");
            } else if (event.type === "match_detected") {
              setDetectedMatch({
                tournament: event.tournament,
                surface: event.surface,
                date: event.date,
                round: event.round,
                location: event.location,
                conditions: event.conditions,
              });
            } else if (event.type === "research_done") {
              // brief pause before dialogue
            } else if (event.type === "research_complete") {
              setUsedWebSearch(event.usedWebSearch ?? false);
              setResearchContext(event.context ?? "");
              setPhase("dialogue");
            } else if (event.type === "agent_start") {
              if (localCurrentMsg) {
                setDialogue(prev => [...prev, localCurrentMsg!]);
              }
              localCurrentMsg = {
                agent: event.agent,
                agentLabel: event.agentLabel,
                content: "",
                isReply: event.isReply,
              };
              setCurrentMsg({ ...localCurrentMsg });
            } else if (event.type === "agent_chunk") {
              if (localCurrentMsg) {
                localCurrentMsg = { ...localCurrentMsg, content: localCurrentMsg.content + event.content };
                setCurrentMsg({ ...localCurrentMsg });
              }
            } else if (event.type === "agent_done") {
              if (localCurrentMsg) {
                setDialogue(prev => [...prev, { ...localCurrentMsg!, content: event.fullContent }]);
                localCurrentMsg = null;
                setCurrentMsg(null);
              }
            } else if (event.type === "generating_recommendations") {
              setPhase("recommendations");
            } else if (event.type === "recommendations") {
              setRecommendations(event.data);
            } else if (event.type === "vote") {
              setVote({ verdict: event.vote, avgConfidence: event.avgConfidence });
            } else if (event.type === "saved") {
              setSavedPredictionId(event.prediction?.id ?? null);
              setRiskNotes(event.prediction?.riskNotes ?? "");
              setCashoutAdvice(event.prediction?.cashoutAdvice ?? "");
            } else if (event.done) {
              setPhase("done");
            }
          } catch { /* skip parse errors */ }
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
      const url = URL.createObjectURL(await res.blob());
      setPodcastUrl(url);
    } catch {
      toast({ title: "Ошибка генерации подкаста", variant: "destructive" });
    } finally {
      setIsGeneratingPodcast(false);
    }
  };

  const isRunning = phase === "research" || phase === "dialogue" || phase === "recommendations";

  return (
    <Layout>
      <div className="max-w-7xl mx-auto flex flex-col gap-5">

        {/* ── TOP ROW ── */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">

          {/* LEFT: Screenshots + Form */}
          <div className="lg:col-span-4 flex flex-col gap-4">

            {/* Screenshot drop zone */}
            <Card className="border-border bg-card">
              <CardHeader className="pb-3 border-b border-border">
                <CardTitle className="uppercase tracking-wider text-xs text-muted-foreground">
                  Скриншоты букмекера
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-4 space-y-3">
                <div
                  onDrop={handleDrop}
                  onDragOver={e => e.preventDefault()}
                  onClick={() => fileInputRef.current?.click()}
                  className="border border-dashed border-border rounded-md p-4 text-center cursor-pointer hover:border-primary/50 hover:bg-primary/5 transition-colors select-none"
                >
                  <Upload className="w-5 h-5 mx-auto mb-2 text-muted-foreground" />
                  <p className="text-xs text-muted-foreground">Перетащите или кликните</p>
                  <p className="text-[11px] text-muted-foreground/50 mt-0.5">Несколько скриншотов: состав, коэффициенты, линия</p>
                </div>
                <input ref={fileInputRef} type="file" accept="image/*" multiple className="hidden" onChange={handleFileInput} />

                {images.length > 0 && (
                  <div className="space-y-2">
                    <div className="flex flex-wrap gap-2">
                      {images.map((img, idx) => (
                        <div key={idx} className="relative group">
                          <img src={img.preview} alt={`#${idx + 1}`} className="w-14 h-14 object-cover rounded border border-border" />
                          <button
                            onClick={e => { e.stopPropagation(); setImages(prev => prev.filter((_, i) => i !== idx)); }}
                            className="absolute -top-1 -right-1 w-4 h-4 bg-destructive rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                          >
                            <X className="w-2.5 h-2.5 text-white" />
                          </button>
                          <span className="absolute bottom-0 left-0 right-0 bg-black/60 text-[9px] text-center text-white rounded-b py-0.5">#{idx + 1}</span>
                        </div>
                      ))}
                    </div>
                    <Button
                      variant="outline" size="sm"
                      className="w-full h-8 border-primary/40 text-primary hover:bg-primary/10 text-xs"
                      onClick={analyzeImages}
                      disabled={isAnalyzingImages}
                    >
                      {isAnalyzingImages
                        ? <><Loader2 className="w-3 h-3 mr-1.5 animate-spin" />Распознаём...</>
                        : <>Анализировать {images.length} скриншот{images.length > 1 ? "а" : ""}</>}
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Match params */}
            <Card className="border-border bg-card">
              <CardHeader className="pb-3 border-b border-border">
                <CardTitle className="uppercase tracking-wider text-xs text-muted-foreground">Параметры матча</CardTitle>
              </CardHeader>
              <CardContent className="pt-4 space-y-3">
                <div className="space-y-1.5">
                  <Label className="uppercase text-xs tracking-wider text-muted-foreground">Игрок 1</Label>
                  <Input value={player1} onChange={e => setPlayer1(e.target.value)} placeholder="Novak Djokovic" className="bg-background h-9" />
                </div>
                <div className="space-y-1.5">
                  <Label className="uppercase text-xs tracking-wider text-muted-foreground">Игрок 2</Label>
                  <Input value={player2} onChange={e => setPlayer2(e.target.value)} placeholder="Carlos Alcaraz" className="bg-background h-9" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label className="uppercase text-xs tracking-wider text-muted-foreground">Покрытие</Label>
                    <Select value={surface} onValueChange={setSurface}>
                      <SelectTrigger className="bg-background h-9"><SelectValue placeholder="Выбрать" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Хард">Хард</SelectItem>
                        <SelectItem value="Грунт">Грунт</SelectItem>
                        <SelectItem value="Трава">Трава</SelectItem>
                        <SelectItem value="Крытый">Крытый</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="uppercase text-xs tracking-wider text-muted-foreground">Дата</Label>
                    <Input type="date" value={matchDate} onChange={e => setMatchDate(e.target.value)} className="bg-background h-9" />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label className="uppercase text-xs tracking-wider text-muted-foreground">Турнир</Label>
                  <Input value={tournament} onChange={e => setTournament(e.target.value)} placeholder="Wimbledon" className="bg-background h-9" />
                </div>
                {oddsData && (
                  <div className="text-xs px-3 py-2 bg-primary/10 border border-primary/20 rounded text-primary font-mono">
                    ✓ Коэффициенты из скриншота загружены
                  </div>
                )}
                <Button
                  onClick={startAnalysis}
                  disabled={isRunning || !player1 || !player2}
                  className="w-full h-11 font-bold uppercase tracking-widest mt-1"
                >
                  {isRunning
                    ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Анализируем...</>
                    : <><Play className="w-4 h-4 mr-2" />Запустить анализ</>}
                </Button>
              </CardContent>
            </Card>
          </div>

          {/* RIGHT: Terminal */}
          <div className="lg:col-span-8">
            <Card className="border-border bg-black/70 flex flex-col" style={{ height: 620 }}>

              {/* Terminal header */}
              <CardHeader className="py-3 px-4 border-b border-border bg-card/40 flex-none flex flex-row items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <div className={`w-2 h-2 rounded-full flex-none ${isRunning ? "bg-red-500 animate-pulse" : phase === "done" ? "bg-emerald-500" : "bg-muted-foreground/30"}`} />
                  <span className="text-xs uppercase font-bold text-muted-foreground tracking-widest truncate">
                    {phase === "idle" && "Аналитическое совещание"}
                    {phase === "research" && "Сбор данных из интернета..."}
                    {phase === "dialogue" && "Совещание экспертов"}
                    {phase === "recommendations" && "Формируем рекомендации..."}
                    {phase === "done" && "Анализ завершён"}
                  </span>
                  {phase === "dialogue" && currentMsg && (
                    <span className="text-[11px] text-primary/60 font-mono animate-pulse truncate hidden sm:block">
                      [{currentMsg.agentLabel} печатает...]
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2 flex-none">
                  {usedWebSearch && (
                    <Badge variant="outline" className="border-sky-500/40 text-sky-400 font-mono text-[10px] gap-1">
                      <Wifi className="w-2.5 h-2.5" />Live
                    </Badge>
                  )}
                  {vote && (
                    <Badge
                      variant="outline"
                      className={`font-mono text-[11px] uppercase ${vote.verdict === "unanimous" ? "border-emerald-500/50 text-emerald-400" : "border-yellow-500/50 text-yellow-400"}`}
                    >
                      {vote.verdict === "unanimous" ? "✓ Консенсус" : "⚠ Спорно"} {vote.avgConfidence}%
                    </Badge>
                  )}
                </div>
              </CardHeader>

              {/* Scrollable content */}
              <div ref={terminalRef} className="flex-1 overflow-y-auto p-4 font-mono text-sm space-y-4">

                {/* Idle state */}
                {phase === "idle" && (
                  <div className="h-full flex flex-col items-center justify-center gap-3 text-muted-foreground/30 select-none">
                    <Database className="w-8 h-8" />
                    <span className="text-xs font-mono">// введите данные матча и нажмите «Запустить анализ»</span>
                  </div>
                )}

                {/* Research phase banner */}
                {(phase === "research" || researchContext) && (
                  <div className="rounded border border-sky-500/20 bg-sky-500/5 px-3 py-2 space-y-1">
                    <div className="flex items-center gap-2 text-sky-400 text-xs font-bold uppercase tracking-wider">
                      <Search className="w-3 h-3" />
                      {phase === "research" ? "Сбор данных" : "Данные собраны"}
                      {phase === "research" && <Loader2 className="w-3 h-3 animate-spin ml-auto" />}
                    </div>
                    {researchMsg && phase === "research" && (
                      <div className="text-[11px] text-sky-300/70 font-mono">{researchMsg}</div>
                    )}
                    {detectedMatch && (
                      <div className="mt-2 grid grid-cols-2 sm:grid-cols-4 gap-1.5 text-[10px] font-mono">
                        {detectedMatch.tournament && (
                          <div className="rounded bg-sky-500/10 border border-sky-500/20 px-2 py-1">
                            <div className="text-sky-400/60 uppercase tracking-wider">Турнир</div>
                            <div className="text-sky-100 truncate">{detectedMatch.tournament}</div>
                          </div>
                        )}
                        {detectedMatch.surface && (
                          <div className="rounded bg-emerald-500/10 border border-emerald-500/20 px-2 py-1">
                            <div className="text-emerald-400/60 uppercase tracking-wider">Покрытие</div>
                            <div className="text-emerald-100 truncate">{detectedMatch.surface}</div>
                          </div>
                        )}
                        {detectedMatch.date && (
                          <div className="rounded bg-amber-500/10 border border-amber-500/20 px-2 py-1">
                            <div className="text-amber-400/60 uppercase tracking-wider">Дата</div>
                            <div className="text-amber-100 truncate">{detectedMatch.date}</div>
                          </div>
                        )}
                        {detectedMatch.round && (
                          <div className="rounded bg-violet-500/10 border border-violet-500/20 px-2 py-1">
                            <div className="text-violet-400/60 uppercase tracking-wider">Стадия</div>
                            <div className="text-violet-100 truncate">{detectedMatch.round}</div>
                          </div>
                        )}
                        {detectedMatch.location && (
                          <div className="rounded bg-rose-500/10 border border-rose-500/20 px-2 py-1 col-span-2">
                            <div className="text-rose-400/60 uppercase tracking-wider">Локация</div>
                            <div className="text-rose-100 truncate">{detectedMatch.location}</div>
                          </div>
                        )}
                        {detectedMatch.conditions && (
                          <div className="rounded bg-cyan-500/10 border border-cyan-500/20 px-2 py-1 col-span-2 sm:col-span-4">
                            <div className="text-cyan-400/60 uppercase tracking-wider">Условия</div>
                            <div className="text-cyan-100">{detectedMatch.conditions}</div>
                          </div>
                        )}
                      </div>
                    )}
                    {researchContext && phase !== "research" && (
                      <details className="mt-1">
                        <summary className="text-[11px] text-sky-300/60 cursor-pointer hover:text-sky-300 select-none">
                          Показать брифинг по игрокам ▸
                        </summary>
                        <pre className="mt-2 text-[10px] text-muted-foreground/60 whitespace-pre-wrap leading-relaxed max-h-48 overflow-y-auto">
                          {researchContext}
                        </pre>
                      </details>
                    )}
                  </div>
                )}

                {/* Dialogue turns */}
                {dialogue.map((msg, i) => {
                  const meta = AGENT_META[msg.agent] ?? { emoji: "🤖", color: "text-foreground", borderColor: "border-border", provider: "", providerColor: "" };
                  return (
                    <div key={i} className={`rounded border-l-2 ${meta.borderColor} pl-3 space-y-1.5`}>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`text-[11px] font-bold uppercase tracking-wider ${meta.color} flex items-center gap-1.5`}>
                          <span>{meta.emoji}</span>
                          <span>{msg.agentLabel}</span>
                        </span>
                        <span className={`text-[10px] font-mono ${meta.providerColor}`}>· {meta.provider}</span>
                        {msg.isReply && <span className="text-[10px] text-muted-foreground/40 font-normal">↩ ответ</span>}
                        <span className="ml-auto text-muted-foreground/20 text-[10px]">#{i + 1}</span>
                      </div>
                      <div className="text-[13px] text-foreground/90 leading-relaxed whitespace-pre-wrap">
                        {msg.content}
                      </div>
                    </div>
                  );
                })}

                {/* Streaming current message */}
                {currentMsg && (
                  <div className={`rounded border-l-2 ${AGENT_META[currentMsg.agent]?.borderColor ?? "border-border"} pl-3 space-y-1.5`}>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`text-[11px] font-bold uppercase tracking-wider ${AGENT_META[currentMsg.agent]?.color ?? "text-foreground"} flex items-center gap-1.5`}>
                        <span>{AGENT_META[currentMsg.agent]?.emoji ?? "🤖"}</span>
                        <span>{currentMsg.agentLabel}</span>
                      </span>
                      <span className={`text-[10px] font-mono ${AGENT_META[currentMsg.agent]?.providerColor ?? ""}`}>· {AGENT_META[currentMsg.agent]?.provider}</span>
                      {currentMsg.isReply && <span className="text-[10px] text-muted-foreground/40">↩ ответ</span>}
                    </div>
                    <div className="text-[13px] text-foreground/90 leading-relaxed whitespace-pre-wrap">
                      {currentMsg.content}
                      <span className="inline-block w-2 h-3.5 bg-primary ml-0.5 animate-pulse align-middle" />
                    </div>
                  </div>
                )}

                {/* Generating recommendations */}
                {phase === "recommendations" && (
                  <div className="flex items-center gap-2 text-muted-foreground/50 text-xs font-mono animate-pulse">
                    <Loader2 className="w-3 h-3 animate-spin" />
                    Формируем итоговые рекомендации на основе данных...
                  </div>
                )}
              </div>
            </Card>
          </div>
        </div>

        {/* ── RECOMMENDATIONS ── */}
        {recommendations.length > 0 && (
          <div className="space-y-4 animate-in slide-in-from-bottom-4 duration-500">
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <h3 className="text-sm font-bold uppercase tracking-widest flex items-center gap-2 text-muted-foreground">
                <TrendingUp className="w-4 h-4 text-primary" />
                Итоговые рекомендации
              </h3>
              {savedPredictionId && (
                podcastUrl ? (
                  <div className="flex items-center gap-2">
                    <Headphones className="w-4 h-4 text-primary" />
                    <audio controls src={podcastUrl} className="h-8 max-w-xs" />
                  </div>
                ) : (
                  <Button
                    variant="outline" size="sm"
                    className="h-8 border-primary/40 text-primary hover:bg-primary/10 text-xs gap-1.5"
                    onClick={generatePodcast}
                    disabled={isGeneratingPodcast}
                  >
                    {isGeneratingPodcast
                      ? <><Loader2 className="w-3 h-3 animate-spin" />Создаём подкаст...</>
                      : <><Headphones className="w-3.5 h-3.5" />Создать аудиоподкаст</>}
                  </Button>
                )
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {recommendations.map((rec, i) => (
                <Card key={i} className={`border ${confidenceBg(rec.confidencePercent)}`}>
                  <CardContent className="p-4 space-y-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className={`text-xs font-bold uppercase tracking-wider ${confidenceColor(rec.confidencePercent)}`}>
                        {rec.type === "outcome" && "Исход"}
                        {rec.type === "total"   && "Тотал"}
                        {rec.type === "handicap"&& "Гандикап"}
                        {rec.type === "express" && "Экспресс"}
                        {!["outcome","total","handicap","express"].includes(rec.type) && rec.type}
                      </div>
                      <div className="text-right flex-none">
                        <div className="text-2xl font-bold text-primary font-mono leading-none">{Number(rec.odds).toFixed(2)}</div>
                        <div className="text-[10px] text-muted-foreground/50 uppercase">кф</div>
                      </div>
                    </div>
                    <div className="font-medium text-sm leading-snug">{rec.description}</div>
                    <div className="space-y-1">
                      <div className="flex justify-between text-xs">
                        <span className="text-muted-foreground">Уверенность</span>
                        <span className={`font-bold font-mono ${confidenceColor(rec.confidencePercent)}`}>{rec.confidencePercent}%</span>
                      </div>
                      <Progress value={rec.confidencePercent} className="h-1.5" />
                    </div>
                    <div className="flex justify-between items-center pt-1 border-t border-border/40 text-xs">
                      <span className="text-muted-foreground">Размер ставки</span>
                      <span className="font-bold">{rec.bankPercent}% банка</span>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>

            {(riskNotes || cashoutAdvice) && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {riskNotes && (
                  <Card className="border-destructive/20 bg-destructive/5">
                    <CardContent className="p-4 flex gap-3 items-start">
                      <AlertTriangle className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
                      <div>
                        <div className="text-xs font-bold uppercase tracking-wider text-destructive mb-1">Риски</div>
                        <div className="text-xs text-muted-foreground leading-relaxed">{riskNotes}</div>
                      </div>
                    </CardContent>
                  </Card>
                )}
                {cashoutAdvice && (
                  <Card className="border-blue-500/20 bg-blue-500/5">
                    <CardContent className="p-4 flex gap-3 items-start">
                      <CheckCircle2 className="w-4 h-4 text-blue-400 shrink-0 mt-0.5" />
                      <div>
                        <div className="text-xs font-bold uppercase tracking-wider text-blue-400 mb-1">Кэшаут</div>
                        <div className="text-xs text-muted-foreground leading-relaxed">{cashoutAdvice}</div>
                      </div>
                    </CardContent>
                  </Card>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </Layout>
  );
}

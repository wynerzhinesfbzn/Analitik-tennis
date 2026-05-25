import { Layout } from "@/components/layout";
import { useGetPredictionStats, useListPredictions, useDeletePrediction, useUpdatePredictionResult } from "@workspace/api-client-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { format } from "date-fns";
import { Check, X, Trash2, ChevronDown, ChevronUp, TrendingUp, Target, ShieldAlert, BarChart2, Award, Percent } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";

interface Prediction {
  id: number;
  player1: string;
  player2: string;
  tournament?: string | null;
  surface?: string | null;
  matchDate?: string | null;
  agentVote?: string | null;
  recommendations?: string | null;
  riskNotes?: string | null;
  cashoutAdvice?: string | null;
  actualResult?: string | null;
  isCorrect?: boolean | null;
  createdAt: string;
}

function StatCard({ label, value, sub, color, icon: Icon }: {
  label: string; value: string | number; sub?: string;
  color: string; icon: React.ElementType;
}) {
  return (
    <div className="rounded border border-border bg-card p-4 space-y-2 hover:border-white/10 transition-colors">
      <div className="flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground">{label}</span>
        <Icon className={`w-3.5 h-3.5 ${color}`} />
      </div>
      <div className={`text-2xl font-bold font-mono tabular-nums ${color}`}>{value}</div>
      {sub && <div className="text-[10px] text-muted-foreground">{sub}</div>}
    </div>
  );
}

export default function HistoryPage() {
  const { data: stats } = useGetPredictionStats();
  const { data: predictions, refetch } = useListPredictions();
  const deletePrediction = useDeletePrediction();
  const updateResult = useUpdatePredictionResult();
  const { toast } = useToast();

  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [resultInput, setResultInput] = useState<{ id: number; text: string } | null>(null);

  const handleDelete = async (id: number) => {
    if (confirm("Удалить прогноз?")) {
      await deletePrediction.mutateAsync({ id });
      refetch();
    }
  };

  const handleSaveResult = async (id: number, isCorrect: boolean) => {
    if (!resultInput?.text) return;
    try {
      await updateResult.mutateAsync({ id, data: { actualResult: resultInput.text, isCorrect } });
      setResultInput(null);
      refetch();
      toast({ title: "Результат сохранён" });
    } catch {
      toast({ title: "Ошибка сохранения", variant: "destructive" });
    }
  };

  const accuracy = stats?.accuracy ?? 0;
  const accuracyColor = accuracy >= 70 ? "text-emerald-400" : accuracy >= 50 ? "text-amber-400" : "text-red-400";

  return (
    <Layout>
      <div className="max-w-[1200px] mx-auto space-y-5">

        {/* Page title */}
        <div className="flex items-center gap-3">
          <BarChart2 className="w-5 h-5 text-cyan-400" />
          <h1 className="text-sm font-bold uppercase tracking-[0.15em]">История ставок</h1>
          <span className="text-[10px] text-muted-foreground uppercase tracking-widest border-l border-border pl-3">
            Статистика · ROI tracking
          </span>
        </div>

        {/* Stats row */}
        {stats && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatCard
              label="Всего прогнозов"
              value={stats.total}
              sub="за всё время"
              color="text-cyan-400"
              icon={Target}
            />
            <StatCard
              label="Верных"
              value={stats.correct}
              sub={`из ${stats.withResults} с результатом`}
              color="text-emerald-400"
              icon={TrendingUp}
            />
            <StatCard
              label="Ошибок"
              value={stats.incorrect}
              sub="неверных прогнозов"
              color="text-red-400"
              icon={ShieldAlert}
            />
            <StatCard
              label="Точность"
              value={`${accuracy.toFixed(1)}%`}
              sub={accuracy >= 70 ? "Отличный результат" : accuracy >= 50 ? "Хороший результат" : "Нужна доработка"}
              color={accuracyColor}
              icon={Percent}
            />
          </div>
        )}

        {/* Accuracy bar */}
        {stats && stats.withResults > 0 && (
          <div className="rounded border border-border bg-card p-4 space-y-2">
            <div className="flex items-center justify-between text-[10px] uppercase tracking-wider text-muted-foreground">
              <div className="flex items-center gap-2">
                <Award className="w-3 h-3 text-amber-400" />
                <span>Точность прогнозов</span>
              </div>
              <span className={`font-bold font-mono ${accuracyColor}`}>{accuracy.toFixed(1)}%</span>
            </div>
            <div className="h-2 rounded-full bg-white/5 overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-1000 ${accuracy >= 70 ? "bg-emerald-500" : accuracy >= 50 ? "bg-amber-500" : "bg-red-500"}`}
                style={{ width: `${accuracy}%` }}
              />
            </div>
            <div className="flex justify-between text-[9px] font-mono text-muted-foreground/40">
              <span>0%</span>
              <span>50%</span>
              <span>100%</span>
            </div>
          </div>
        )}

        {/* Predictions table */}
        <div className="rounded border border-border bg-card overflow-hidden">
          <div className="px-4 py-2.5 border-b border-border flex items-center gap-2 bg-white/[0.02]">
            <Target className="w-3.5 h-3.5 text-muted-foreground" />
            <span className="text-[11px] font-bold uppercase tracking-[0.15em] text-muted-foreground">Журнал прогнозов</span>
            {predictions?.length ? (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-cyan-500/10 border border-cyan-500/20 text-cyan-400 font-mono ml-auto">{predictions.length}</span>
            ) : null}
          </div>

          <Table>
            <TableHeader>
              <TableRow className="border-border hover:bg-transparent">
                <TableHead className="text-[10px] uppercase tracking-wider text-muted-foreground/60 font-medium">Матч</TableHead>
                <TableHead className="text-[10px] uppercase tracking-wider text-muted-foreground/60 font-medium hidden sm:table-cell">Турнир / Покрытие</TableHead>
                <TableHead className="text-[10px] uppercase tracking-wider text-muted-foreground/60 font-medium hidden md:table-cell">Дата анализа</TableHead>
                <TableHead className="text-[10px] uppercase tracking-wider text-muted-foreground/60 font-medium">Итог</TableHead>
                <TableHead className="text-[10px] uppercase tracking-wider text-muted-foreground/60 font-medium text-right">Действия</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {predictions?.map((p: Prediction) => (
                <>
                  <TableRow
                    key={p.id}
                    className="border-border hover:bg-white/[0.02] transition-colors cursor-pointer"
                    onClick={() => setExpandedId(expandedId === p.id ? null : p.id)}
                  >
                    <TableCell>
                      <div className="flex flex-col gap-0.5">
                        <div className="flex items-center gap-2 text-sm font-medium">
                          <span className="text-cyan-300">{p.player1}</span>
                          <span className="text-[10px] text-muted-foreground/40 font-mono">vs</span>
                          <span className="text-rose-300">{p.player2}</span>
                        </div>
                        {p.agentVote && (
                          <span className={`text-[10px] font-mono ${p.agentVote === "unanimous" ? "text-emerald-400/60" : "text-amber-400/60"}`}>
                            {p.agentVote === "unanimous" ? "✓ Консенсус" : "⚠ Спорно"}
                          </span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="hidden sm:table-cell">
                      <div className="flex flex-col gap-0.5">
                        {p.tournament && <span className="text-xs text-foreground/80">{p.tournament}</span>}
                        {p.surface && <span className="text-[10px] text-muted-foreground/60">{p.surface}</span>}
                      </div>
                    </TableCell>
                    <TableCell className="hidden md:table-cell text-xs text-muted-foreground font-mono">
                      {format(new Date(p.createdAt), "dd.MM.yy HH:mm")}
                    </TableCell>
                    <TableCell>
                      {p.actualResult ? (
                        <span className={`inline-flex items-center gap-1 text-[10px] px-2 py-1 rounded border font-medium ${
                          p.isCorrect
                            ? "border-emerald-500/30 text-emerald-400 bg-emerald-500/8"
                            : "border-red-500/30 text-red-400 bg-red-500/8"
                        }`}>
                          {p.isCorrect ? <Check className="w-3 h-3" /> : <X className="w-3 h-3" />}
                          {p.actualResult}
                        </span>
                      ) : (
                        <Dialog>
                          <DialogTrigger asChild>
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-7 text-[10px] border-border text-muted-foreground hover:border-cyan-500/40 hover:text-cyan-400 uppercase tracking-wider"
                              onClick={e => { e.stopPropagation(); setResultInput({ id: p.id, text: "" }); }}
                            >
                              Указать итог
                            </Button>
                          </DialogTrigger>
                          <DialogContent className="border-border bg-card rounded-sm max-w-sm" onClick={e => e.stopPropagation()}>
                            <DialogHeader>
                              <DialogTitle className="text-sm uppercase tracking-wider flex items-center gap-2">
                                <Target className="w-4 h-4 text-amber-400" />
                                Результат матча
                              </DialogTitle>
                            </DialogHeader>
                            <div className="space-y-4 py-2">
                              <div className="text-xs text-muted-foreground">
                                {p.player1} <span className="text-muted-foreground/40">vs</span> {p.player2}
                              </div>
                              <Input
                                placeholder="Счёт или исход (напр. 6:3 7:5)"
                                value={resultInput?.id === p.id ? resultInput.text : ""}
                                onChange={e => setResultInput({ id: p.id, text: e.target.value })}
                                className="border-border bg-background h-9 text-sm"
                              />
                              <div className="grid grid-cols-2 gap-2">
                                <Button
                                  className="h-9 text-xs font-bold uppercase tracking-wider bg-emerald-600 hover:bg-emerald-500 text-white border-0"
                                  onClick={() => handleSaveResult(p.id, true)}
                                >
                                  <Check className="w-3.5 h-3.5 mr-1.5" />Верно
                                </Button>
                                <Button
                                  variant="destructive"
                                  className="h-9 text-xs font-bold uppercase tracking-wider"
                                  onClick={() => handleSaveResult(p.id, false)}
                                >
                                  <X className="w-3.5 h-3.5 mr-1.5" />Ошибка
                                </Button>
                              </div>
                            </div>
                          </DialogContent>
                        </Dialog>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <button className="w-7 h-7 rounded flex items-center justify-center text-muted-foreground/40 hover:text-foreground hover:bg-white/5 transition-colors">
                          {expandedId === p.id ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                        </button>
                        <button
                          onClick={e => { e.stopPropagation(); handleDelete(p.id); }}
                          className="w-7 h-7 rounded flex items-center justify-center text-muted-foreground/40 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </TableCell>
                  </TableRow>

                  {expandedId === p.id && (
                    <TableRow key={`${p.id}-expanded`} className="border-border hover:bg-transparent">
                      <TableCell colSpan={5} className="pb-4 pt-0 px-4">
                        <div className="rounded border border-border bg-background/50 p-4 space-y-3 mt-1">
                          {p.recommendations && (() => {
                            try {
                              const recs = JSON.parse(p.recommendations);
                              if (!Array.isArray(recs) || recs.length === 0) return null;
                              return (
                                <div className="space-y-2">
                                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground/60 flex items-center gap-1.5">
                                    <Target className="w-3 h-3 text-amber-400" />Рекомендации
                                  </div>
                                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                    {recs.map((rec: { type?: string; description?: string; odds?: number; bankPercent?: number; confidencePercent?: number }, i: number) => (
                                      <div key={i} className="rounded border border-border bg-white/[0.02] p-3 space-y-1.5">
                                        <div className="flex items-center justify-between">
                                          <span className="text-[10px] font-bold uppercase text-muted-foreground">{rec.type}</span>
                                          {rec.odds && (
                                            <span className="font-mono text-sm font-bold text-amber-300 px-2 py-0.5 rounded bg-amber-500/10 border border-amber-500/20">
                                              {rec.odds.toFixed(2)}
                                            </span>
                                          )}
                                        </div>
                                        <p className="text-[11px] text-foreground/70">{rec.description}</p>
                                        {rec.confidencePercent !== undefined && (
                                          <div className="flex items-center gap-2">
                                            <div className="flex-1 h-1 rounded-full bg-white/5 overflow-hidden">
                                              <div
                                                className={`h-full rounded-full ${rec.confidencePercent >= 88 ? "bg-emerald-500" : rec.confidencePercent >= 78 ? "bg-amber-500" : "bg-orange-500"}`}
                                                style={{ width: `${rec.confidencePercent}%` }}
                                              />
                                            </div>
                                            <span className="text-[10px] font-mono text-muted-foreground">{rec.confidencePercent}%</span>
                                            {rec.bankPercent !== undefined && <span className="text-[10px] font-mono text-emerald-400">{rec.bankPercent}% банка</span>}
                                          </div>
                                        )}
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              );
                            } catch { return null; }
                          })()}

                          {(p.riskNotes || p.cashoutAdvice) && (
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                              {p.riskNotes && (
                                <div className="rounded border border-red-500/20 bg-red-500/5 p-3">
                                  <div className="text-[10px] font-bold uppercase text-red-400 flex items-center gap-1 mb-1.5">
                                    <ShieldAlert className="w-3 h-3" />Риски
                                  </div>
                                  <p className="text-[11px] text-foreground/70">{p.riskNotes}</p>
                                </div>
                              )}
                              {p.cashoutAdvice && (
                                <div className="rounded border border-emerald-500/20 bg-emerald-500/5 p-3">
                                  <div className="text-[10px] font-bold uppercase text-emerald-400 flex items-center gap-1 mb-1.5">
                                    <TrendingUp className="w-3 h-3" />Кэшаут
                                  </div>
                                  <p className="text-[11px] text-foreground/70">{p.cashoutAdvice}</p>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  )}
                </>
              ))}
              {!predictions?.length && (
                <TableRow>
                  <TableCell colSpan={5} className="py-16 text-center">
                    <div className="flex flex-col items-center gap-3 text-muted-foreground/30">
                      <Target className="w-8 h-8" />
                      <span className="text-xs font-mono uppercase tracking-wider">Нет сохранённых прогнозов</span>
                    </div>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </div>
    </Layout>
  );
}

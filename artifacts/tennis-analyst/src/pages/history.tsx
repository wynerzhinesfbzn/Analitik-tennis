import { Layout } from "@/components/layout";
import { useGetPredictionStats, useListPredictions, useDeletePrediction, useUpdatePredictionResult } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { format } from "date-fns";
import { Check, X, Trash2, ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";

export default function HistoryPage() {
  const { data: stats } = useGetPredictionStats();
  const { data: predictions, refetch } = useListPredictions();
  const deletePrediction = useDeletePrediction();
  const updateResult = useUpdatePredictionResult();
  const { toast } = useToast();

  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [resultInput, setResultInput] = useState<{id: number, text: string} | null>(null);

  const handleDelete = async (id: number) => {
    if (confirm("Удалить прогноз?")) {
      await deletePrediction.mutateAsync({ id });
      refetch();
    }
  };

  const handleSaveResult = async (id: number, isCorrect: boolean) => {
    if (!resultInput || !resultInput.text) return;
    
    try {
      await updateResult.mutateAsync({
        id,
        data: {
          actualResult: resultInput.text,
          isCorrect
        }
      });
      setResultInput(null);
      refetch();
      toast({ title: "Результат сохранен" });
    } catch (e) {
      toast({ title: "Ошибка", variant: "destructive" });
    }
  };

  return (
    <Layout>
      <div className="max-w-6xl mx-auto space-y-6">
        <h1 className="text-2xl font-bold uppercase tracking-wider border-b border-border pb-4">Статистика и История</h1>

        {stats && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Card className="bg-card border-border rounded-sm">
              <CardContent className="p-4">
                <div className="text-sm text-muted-foreground uppercase">Всего прогнозов</div>
                <div className="text-2xl font-bold">{stats.total}</div>
              </CardContent>
            </Card>
            <Card className="bg-card border-border rounded-sm">
              <CardContent className="p-4">
                <div className="text-sm text-muted-foreground uppercase">Верных</div>
                <div className="text-2xl font-bold text-primary">{stats.correct}</div>
              </CardContent>
            </Card>
            <Card className="bg-card border-border rounded-sm">
              <CardContent className="p-4">
                <div className="text-sm text-muted-foreground uppercase">Ошибок</div>
                <div className="text-2xl font-bold text-destructive">{stats.incorrect}</div>
              </CardContent>
            </Card>
            <Card className="bg-card border-border rounded-sm">
              <CardContent className="p-4">
                <div className="text-sm text-muted-foreground uppercase">Точность</div>
                <div className="text-2xl font-bold text-primary">{stats.accuracy.toFixed(1)}%</div>
              </CardContent>
            </Card>
          </div>
        )}

        <Card className="border-border rounded-sm">
          <Table>
            <TableHeader>
              <TableRow className="border-border hover:bg-transparent">
                <TableHead className="uppercase">Матч</TableHead>
                <TableHead className="uppercase">Дата</TableHead>
                <TableHead className="uppercase">Статус</TableHead>
                <TableHead className="text-right uppercase">Действия</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {predictions?.map(p => (
                <TableRow key={p.id} className="border-border hover:bg-muted/50 transition-colors">
                  <TableCell className="font-medium">
                    {p.player1} <span className="text-muted-foreground text-xs mx-1">vs</span> {p.player2}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {format(new Date(p.createdAt), "dd.MM.yyyy HH:mm")}
                  </TableCell>
                  <TableCell>
                    {p.actualResult ? (
                      <span className={`inline-flex items-center gap-1 text-xs px-2 py-1 rounded-sm border ${p.isCorrect ? 'border-primary/50 text-primary bg-primary/10' : 'border-destructive/50 text-destructive bg-destructive/10'}`}>
                        {p.isCorrect ? <Check className="w-3 h-3" /> : <X className="w-3 h-3" />}
                        {p.actualResult}
                      </span>
                    ) : (
                      <Dialog>
                        <DialogTrigger asChild>
                          <Button variant="outline" size="sm" className="h-7 text-xs border-border" onClick={() => setResultInput({id: p.id, text: ""})}>
                            Указать результат
                          </Button>
                        </DialogTrigger>
                        <DialogContent className="border-border bg-card rounded-sm">
                          <DialogHeader>
                            <DialogTitle className="uppercase">Результат матча</DialogTitle>
                          </DialogHeader>
                          <div className="space-y-4 py-4">
                            <Input 
                              placeholder="Счет или исход..." 
                              value={resultInput?.id === p.id ? resultInput.text : ""}
                              onChange={e => setResultInput({id: p.id, text: e.target.value})}
                              className="border-border bg-background rounded-sm"
                            />
                            <div className="flex gap-2">
                              <Button className="flex-1 rounded-sm" onClick={() => handleSaveResult(p.id, true)}>Успех</Button>
                              <Button className="flex-1 rounded-sm" variant="destructive" onClick={() => handleSaveResult(p.id, false)}>Провал</Button>
                            </div>
                          </div>
                        </DialogContent>
                      </Dialog>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive" onClick={() => handleDelete(p.id)}>
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {!predictions?.length && (
                <TableRow>
                  <TableCell colSpan={4} className="text-center py-8 text-muted-foreground">
                    Нет сохраненных прогнозов
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </Card>
      </div>
    </Layout>
  );
}

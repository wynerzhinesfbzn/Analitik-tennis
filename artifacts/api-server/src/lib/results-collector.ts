/**
 * Auto results collector — checks ESPN API + GPT web_search for match results.
 * Updates actualResult + isCorrect in predictions that have a past matchDate.
 */

import { openai } from "@workspace/integrations-openai-ai-server";
import { db, predictionsTable } from "@workspace/db";
import { eq, sql, isNull, and } from "drizzle-orm";
import { logger } from "./logger";

export interface ResultCheckOutcome {
  predictionId: number;
  player1: string;
  player2: string;
  foundResult: boolean;
  actualResult?: string;
  isCorrect?: boolean;
}

async function checkResultViaAI(
  player1: string,
  player2: string,
  tournament: string | null | undefined,
  matchDate: string | null | undefined,
  recommendations: string,
): Promise<{ found: boolean; result?: string; isCorrect?: boolean }> {
  try {
    // Extract top recommended bet to check against
    let topBet = "";
    try {
      const recs = JSON.parse(recommendations);
      if (Array.isArray(recs) && recs.length > 0) {
        topBet = recs[0].description ?? "";
      }
    } catch { /* skip */ }

    const dateHint = matchDate ? `дата матча: ${matchDate}` : "дата неизвестна";
    const tournamentHint = tournament ? `турнир: ${tournament}` : "";

    const input = `Используй web_search для проверки результата теннисного матча.

Матч: ${player1} vs ${player2}
${tournamentHint}
${dateHint}

1. Найди результат этого матча (счёт по сетам, победитель).
2. Если матч ещё не сыгран или результат не найден — ответь "NOT_FOUND".
3. Если результат найден — ответь строго в формате JSON:
{
  "found": true,
  "winner": "Имя победителя",
  "score": "6:3 7:5",
  "fullResult": "краткое описание",
  "topBetWon": true/false/null
}

Оценка topBetWon — была ли выиграна эта ставка: "${topBet}"
null если невозможно определить.

Ответь ТОЛЬКО JSON или "NOT_FOUND".`;

    const response = await (openai as any).responses.create({
      model: "gpt-5.4",
      tools: [{ type: "web_search_preview" }],
      input,
      max_output_tokens: 500,
    });

    const text: string =
      response.output_text ??
      response.output
        ?.find((o: any) => o.type === "message")
        ?.content?.find((c: any) => c.type === "output_text")?.text ??
      "";

    if (!text || text.includes("NOT_FOUND")) return { found: false };

    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return { found: false };

    const parsed = JSON.parse(jsonMatch[0]);
    if (!parsed.found) return { found: false };

    return {
      found: true,
      result: `${parsed.winner} · ${parsed.score}`,
      isCorrect: parsed.topBetWon === true,
    };
  } catch (err) {
    logger.warn({ err }, "Result check via AI failed");
    return { found: false };
  }
}

export async function checkAndUpdateResults(): Promise<ResultCheckOutcome[]> {
  const today = new Date().toISOString().slice(0, 10);

  // Find predictions with a past matchDate and no actualResult
  const pendingPredictions = await db
    .select()
    .from(predictionsTable)
    .where(
      and(
        isNull(predictionsTable.actualResult),
        sql`${predictionsTable.matchDate} IS NOT NULL`,
        sql`${predictionsTable.matchDate} < ${today}`,
      ),
    )
    .limit(10);

  const outcomes: ResultCheckOutcome[] = [];

  for (const pred of pendingPredictions) {
    const check = await checkResultViaAI(
      pred.player1,
      pred.player2,
      pred.tournament,
      pred.matchDate,
      pred.recommendations,
    );

    if (check.found && check.result) {
      await db
        .update(predictionsTable)
        .set({
          actualResult: check.result,
          isCorrect: check.isCorrect ?? null,
        })
        .where(eq(predictionsTable.id, pred.id));

      outcomes.push({
        predictionId: pred.id,
        player1: pred.player1,
        player2: pred.player2,
        foundResult: true,
        actualResult: check.result,
        isCorrect: check.isCorrect,
      });
    } else {
      outcomes.push({
        predictionId: pred.id,
        player1: pred.player1,
        player2: pred.player2,
        foundResult: false,
      });
    }
  }

  return outcomes;
}

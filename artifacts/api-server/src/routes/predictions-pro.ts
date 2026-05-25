/**
 * PRO extension routes — added without modifying the original predictions.ts.
 * Registered BEFORE the existing router in routes/index.ts.
 *
 * New endpoints:
 *   POST /predictions/:id/telegram      — publish to Telegram channel
 *   POST /predictions/check-results     — auto-check match results via ESPN / AI
 *   GET  /predictions/ml-stats          — ML stats from history
 */

import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, predictionsTable } from "@workspace/db";
import { publishPrediction, updateTelegramResult, isTelegramConfigured } from "../lib/telegram-publisher";
import { checkAndUpdateResults } from "../lib/results-collector";
import { computeMLAdjustment } from "../lib/tennis-ml";

const router: IRouter = Router();

// ── GET /predictions/ml-stats ─────────────────────────────────────────────────
router.get("/predictions/ml-stats", async (req, res): Promise<void> => {
  try {
    const mlAll  = await computeMLAdjustment();
    const mlHard = await computeMLAdjustment("hard");
    const mlClay = await computeMLAdjustment("clay");
    const mlGrass = await computeMLAdjustment("grass");
    res.json({
      overall:  { ...mlAll },
      bySurface: {
        hard:  { ...mlHard },
        clay:  { ...mlClay },
        grass: { ...mlGrass },
      },
      telegramConfigured: isTelegramConfigured(),
    });
  } catch (err) {
    req.log.error({ err }, "ml-stats error");
    res.status(500).json({ error: "ML stats unavailable" });
  }
});

// ── POST /predictions/check-results ──────────────────────────────────────────
router.post("/predictions/check-results", async (req, res): Promise<void> => {
  try {
    const outcomes = await checkAndUpdateResults();
    res.json({
      checked: outcomes.length,
      updated: outcomes.filter(o => o.foundResult).length,
      outcomes,
    });
  } catch (err) {
    req.log.error({ err }, "check-results error");
    res.status(500).json({ error: "Ошибка при проверке результатов" });
  }
});

// ── POST /predictions/:id/telegram ───────────────────────────────────────────
router.post("/predictions/:id/telegram", async (req, res): Promise<void> => {
  if (!isTelegramConfigured()) {
    res.status(503).json({
      error: "Telegram не настроен. Добавьте TELEGRAM_BOT_TOKEN и TELEGRAM_CHANNEL_ID в Secrets.",
    });
    return;
  }

  const id = parseInt(String(req.params.id), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Некорректный ID" }); return; }

  const [pred] = await db.select().from(predictionsTable).where(eq(predictionsTable.id, id));
  if (!pred) { res.status(404).json({ error: "Прогноз не найден" }); return; }

  // If already published, return existing message_id
  if (pred.telegramMessageId) {
    res.json({ messageId: parseInt(pred.telegramMessageId, 10), alreadyPublished: true });
    return;
  }

  const messageId = await publishPrediction({
    id: pred.id,
    player1: pred.player1,
    player2: pred.player2,
    tournament: pred.tournament,
    surface: pred.surface,
    matchDate: pred.matchDate,
    agentVote: pred.agentVote,
    recommendations: pred.recommendations,
    riskNotes: pred.riskNotes,
    cashoutAdvice: pred.cashoutAdvice,
    fatigueScore1: pred.fatigueScore1,
    fatigueScore2: pred.fatigueScore2,
    mlAdjustment: pred.mlAdjustment,
  });

  if (!messageId) {
    res.status(500).json({ error: "Ошибка при публикации в Telegram" });
    return;
  }

  // Save message_id
  await db.update(predictionsTable)
    .set({ telegramMessageId: String(messageId) })
    .where(eq(predictionsTable.id, id));

  res.json({ messageId, published: true });
});

// ── PATCH /predictions/:id/telegram-result ─────────────────────────────────
router.patch("/predictions/:id/telegram-result", async (req, res): Promise<void> => {
  if (!isTelegramConfigured()) {
    res.status(503).json({ error: "Telegram не настроен" });
    return;
  }

  const id = parseInt(String(req.params.id), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Некорректный ID" }); return; }

  const { actualResult, isCorrect } = req.body as { actualResult: string; isCorrect: boolean };
  if (!actualResult || isCorrect === undefined) {
    res.status(400).json({ error: "actualResult и isCorrect обязательны" });
    return;
  }

  const [pred] = await db.select().from(predictionsTable).where(eq(predictionsTable.id, id));
  if (!pred) { res.status(404).json({ error: "Прогноз не найден" }); return; }

  if (!pred.telegramMessageId) {
    res.status(400).json({ error: "Прогноз не опубликован в Telegram" });
    return;
  }

  const ok = await updateTelegramResult(
    parseInt(pred.telegramMessageId, 10),
    {
      id: pred.id,
      player1: pred.player1,
      player2: pred.player2,
      tournament: pred.tournament,
      surface: pred.surface,
      matchDate: pred.matchDate,
      agentVote: pred.agentVote,
      recommendations: pred.recommendations,
      riskNotes: pred.riskNotes,
      cashoutAdvice: pred.cashoutAdvice,
      fatigueScore1: pred.fatigueScore1,
      fatigueScore2: pred.fatigueScore2,
      mlAdjustment: pred.mlAdjustment,
    },
    actualResult,
    isCorrect,
  );

  res.json({ ok });
});

export default router;

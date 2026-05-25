/**
 * Tennis ML — lightweight history-based confidence adjustment.
 * No external ML library: pure TypeScript weighted scoring on PostgreSQL history.
 *
 * Algorithm:
 *   1. Load last 50 resolved predictions
 *   2. Filter by same surface (if available) and similar confidence band
 *   3. Calculate accuracy for the subset
 *   4. Derive adjustment = (subsetAccuracy - 72) / 12  → clamped to [-5, +5]
 *   5. Return adjustment + rich context string for agent prompts
 */

import { db, predictionsTable } from "@workspace/db";
import { desc, sql } from "drizzle-orm";
import { logger } from "./logger";

export interface MLResult {
  /** Percentage points to add/subtract from raw confidence, e.g. +3 or -2 */
  adjustment: number;
  /** Human-readable context to inject into agent prompts */
  contextText: string;
  /** How many resolved predictions were used */
  sampleSize: number;
  /** Accuracy of the filtered sample (0–100) */
  sampleAccuracy: number;
}

export async function computeMLAdjustment(surface?: string): Promise<MLResult> {
  try {
    const rows = await db
      .select({
        surface:    predictionsTable.surface,
        isCorrect:  predictionsTable.isCorrect,
        agentVote:  predictionsTable.agentVote,
        mlAdj:      predictionsTable.mlAdjustment,
      })
      .from(predictionsTable)
      .where(sql`${predictionsTable.isCorrect} IS NOT NULL`)
      .orderBy(desc(predictionsTable.createdAt))
      .limit(50);

    if (rows.length === 0) {
      return { adjustment: 0, contextText: "Нет истории прогнозов для ML-коррекции.", sampleSize: 0, sampleAccuracy: 0 };
    }

    // Surface-filtered subset
    const surfaceNorm = (s?: string | null) => (s ?? "").toLowerCase().trim();
    const sameSurface = surface
      ? rows.filter(r => surfaceNorm(r.surface) === surfaceNorm(surface))
      : [];
    const pool = sameSurface.length >= 5 ? sameSurface : rows;

    const total   = pool.length;
    const correct = pool.filter(r => r.isCorrect === true).length;
    const accuracy = total > 0 ? Math.round((correct / total) * 100) : 0;

    // adjustment = deviation from 72% baseline, scaled
    const raw = (accuracy - 72) / 12;
    const adjustment = Math.round(Math.max(-5, Math.min(5, raw)));

    // Unanimous agreement track record
    const unanimousPool = pool.filter(r => r.agentVote === "unanimous");
    const unanimousCorrect = unanimousPool.filter(r => r.isCorrect === true).length;
    const unanimousAcc = unanimousPool.length > 0
      ? Math.round((unanimousCorrect / unanimousPool.length) * 100) : null;

    const surfaceLabel = surface ? `${surface}` : "все покрытия";
    let contextText = `[ML-КОРРЕКЦИЯ] История прогнозов (${surfaceLabel}): ${correct}/${total} верных (${accuracy}%). `;
    contextText += adjustment > 0
      ? `Модель рекомендует +${adjustment}% к уверенности — текущая форма выше базовой.`
      : adjustment < 0
        ? `Модель рекомендует ${adjustment}% к уверенности — недавние прогнозы ниже базовой точности.`
        : `Точность на базовом уровне, коррекция не требуется.`;

    if (unanimousAcc !== null && unanimousPool.length >= 3) {
      contextText += ` При консенсусе трёх агентов точность: ${unanimousAcc}% (${unanimousPool.length} случаев).`;
    }

    return { adjustment, contextText, sampleSize: total, sampleAccuracy: accuracy };
  } catch (err) {
    logger.warn({ err }, "ML adjustment computation failed — skipping");
    return { adjustment: 0, contextText: "", sampleSize: 0, sampleAccuracy: 0 };
  }
}

/**
 * Telegram publisher for tennis predictions.
 * Uses Telegram Bot API directly via fetch — no additional npm packages.
 * Requires: TELEGRAM_BOT_TOKEN and TELEGRAM_CHANNEL_ID env vars.
 */

import { logger } from "./logger";

interface TelegramResult {
  ok: boolean;
  result?: { message_id: number };
  description?: string;
}

function getTelegramConfig(): { token: string; channelId: string } | null {
  const token     = process.env.TELEGRAM_BOT_TOKEN;
  const channelId = process.env.TELEGRAM_CHANNEL_ID;
  if (!token || !channelId) return null;
  return { token, channelId };
}

async function telegramRequest(method: string, body: object): Promise<TelegramResult> {
  const cfg = getTelegramConfig();
  if (!cfg) throw new Error("TELEGRAM_BOT_TOKEN or TELEGRAM_CHANNEL_ID not set");

  const url = `https://api.telegram.org/bot${cfg.token}/${method}`;
  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return resp.json() as Promise<TelegramResult>;
}

function surfaceEmoji(surface?: string | null): string {
  if (!surface) return "🎾";
  const s = surface.toLowerCase();
  if (s.includes("хард") || s.includes("hard")) return "🟦";
  if (s.includes("грунт") || s.includes("clay")) return "🟧";
  if (s.includes("трав") || s.includes("grass")) return "🟩";
  if (s.includes("крыт") || s.includes("indoor")) return "⬛";
  return "🎾";
}

function confidenceBar(pct: number): string {
  const filled = Math.round(pct / 10);
  return "█".repeat(filled) + "░".repeat(10 - filled) + ` ${pct}%`;
}

export interface PredictionForTelegram {
  id: number;
  player1: string;
  player2: string;
  tournament?: string | null;
  surface?: string | null;
  matchDate?: string | null;
  agentVote?: string | null;
  recommendations: string;
  riskNotes?: string | null;
  cashoutAdvice?: string | null;
  fatigueScore1?: number | null;
  fatigueScore2?: number | null;
  mlAdjustment?: number | null;
}

export function formatPredictionMessage(p: PredictionForTelegram): string {
  const se = surfaceEmoji(p.surface);
  const voteLabel = p.agentVote === "unanimous" ? "✅ Консенсус агентов" : "⚠️ Спорный прогноз";

  let recs: Array<{ type: string; description: string; odds: number; bankPercent: number; confidencePercent: number }> = [];
  try { recs = JSON.parse(p.recommendations); } catch { recs = []; }

  const lines: string[] = [
    `🎾 <b>ТЕННИС · BETANALYTICS PRO</b>`,
    ``,
    `<b>${p.player1}</b> <code>vs</code> <b>${p.player2}</b>`,
    p.tournament ? `${se} ${p.tournament}` : "",
    p.surface ? `📍 Покрытие: ${p.surface}` : "",
    p.matchDate ? `📅 Дата: ${p.matchDate}` : "",
    ``,
    `<b>${voteLabel}</b>`,
    ``,
  ].filter(l => l !== null);

  if (p.fatigueScore1 != null || p.fatigueScore2 != null) {
    lines.push(`🏃 Усталость (0-10): ${p.player1} — ${p.fatigueScore1 ?? "н/д"} | ${p.player2} — ${p.fatigueScore2 ?? "н/д"}`);
    lines.push(``);
  }

  if (p.mlAdjustment != null && p.mlAdjustment !== 0) {
    const sign = p.mlAdjustment > 0 ? "+" : "";
    lines.push(`🤖 ML-коррекция: ${sign}${p.mlAdjustment}% к уверенности`);
    lines.push(``);
  }

  if (recs.length > 0) {
    lines.push(`📊 <b>РЕКОМЕНДАЦИИ:</b>`);
    for (const rec of recs.slice(0, 4)) {
      lines.push(`▸ <b>${rec.type.toUpperCase()}</b> · кф. <code>${rec.odds.toFixed(2)}</code> · банк ${rec.bankPercent}%`);
      lines.push(`  ${rec.description}`);
      lines.push(`  ${confidenceBar(rec.confidencePercent)}`);
      lines.push(``);
    }
  }

  if (p.riskNotes) {
    lines.push(`🚨 <b>Риски:</b> ${p.riskNotes}`);
    lines.push(``);
  }

  if (p.cashoutAdvice) {
    lines.push(`💡 <b>Кэшаут:</b> ${p.cashoutAdvice}`);
    lines.push(``);
  }

  lines.push(`<i>Анализ проведён тремя AI-агентами: Gemini · Claude · GPT</i>`);
  lines.push(`<i>ID прогноза: #${p.id}</i>`);

  return lines.join("\n");
}

export async function publishPrediction(prediction: PredictionForTelegram): Promise<number | null> {
  const cfg = getTelegramConfig();
  if (!cfg) {
    logger.warn("Telegram not configured — TELEGRAM_BOT_TOKEN or TELEGRAM_CHANNEL_ID missing");
    return null;
  }

  try {
    const text = formatPredictionMessage(prediction);
    const result = await telegramRequest("sendMessage", {
      chat_id: cfg.channelId,
      text,
      parse_mode: "HTML",
      disable_web_page_preview: true,
    });

    if (!result.ok) {
      logger.warn({ description: result.description }, "Telegram sendMessage failed");
      return null;
    }
    return result.result?.message_id ?? null;
  } catch (err) {
    logger.error({ err }, "Error publishing to Telegram");
    return null;
  }
}

export async function updateTelegramResult(
  messageId: number,
  prediction: PredictionForTelegram,
  actualResult: string,
  isCorrect: boolean,
): Promise<boolean> {
  const cfg = getTelegramConfig();
  if (!cfg) return false;

  try {
    const resultEmoji = isCorrect ? "✅" : "❌";
    const baseText = formatPredictionMessage(prediction);
    const resultLine = `\n\n${resultEmoji} <b>РЕЗУЛЬТАТ:</b> ${actualResult}`;
    const updatedText = baseText + resultLine;

    const result = await telegramRequest("editMessageText", {
      chat_id:    cfg.channelId,
      message_id: messageId,
      text:       updatedText,
      parse_mode: "HTML",
      disable_web_page_preview: true,
    });

    return result.ok;
  } catch (err) {
    logger.error({ err }, "Error updating Telegram message");
    return false;
  }
}

export function isTelegramConfigured(): boolean {
  return !!(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHANNEL_ID);
}

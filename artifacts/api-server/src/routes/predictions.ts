import { Router, type IRouter } from "express";
import { eq, desc, count, sql } from "drizzle-orm";
import { db, predictionsTable } from "@workspace/db";
import {
  CreatePredictionBody,
  GetPredictionParams,
  DeletePredictionParams,
  UpdatePredictionResultParams,
  UpdatePredictionResultBody,
  AnalyzeTennisMatchBody,
} from "@workspace/api-zod";
import { runTennisAgents, generatePodcastAudio } from "../lib/tennis-agents";
import { openai } from "@workspace/integrations-openai-ai-server";

const router: IRouter = Router();

// GET /predictions/stats
router.get("/predictions/stats", async (req, res): Promise<void> => {
  const total = await db.select({ count: count() }).from(predictionsTable);
  const withResults = await db.select({ count: count() }).from(predictionsTable)
    .where(sql`${predictionsTable.actualResult} IS NOT NULL`);
  const correct = await db.select({ count: count() }).from(predictionsTable)
    .where(eq(predictionsTable.isCorrect, true));
  const incorrect = await db.select({ count: count() }).from(predictionsTable)
    .where(eq(predictionsTable.isCorrect, false));
  const recentPredictions = await db.select().from(predictionsTable)
    .orderBy(desc(predictionsTable.createdAt)).limit(10);

  const totalCount = Number(total[0]?.count ?? 0);
  const withResultsCount = Number(withResults[0]?.count ?? 0);
  const correctCount = Number(correct[0]?.count ?? 0);
  const incorrectCount = Number(incorrect[0]?.count ?? 0);
  const accuracy = withResultsCount > 0
    ? Math.round((correctCount / withResultsCount) * 100) : 0;

  res.json({
    total: totalCount,
    withResults: withResultsCount,
    correct: correctCount,
    incorrect: incorrectCount,
    accuracy,
    recentPredictions: recentPredictions.map(formatPrediction),
  });
});

// POST /predictions/analyze — SSE streaming
router.post("/predictions/analyze", async (req, res): Promise<void> => {
  const parsed = AnalyzeTennisMatchBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  const send = (data: object) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  try {
    const { dialogue, recommendations, vote, riskNotes, cashoutAdvice, fatigueScore1, fatigueScore2, mlAdjustment } = await runTennisAgents(
      { ...parsed.data, forceRefresh: (req.body as Record<string, unknown>).forceRefresh === true },
      send
    );

    const [saved] = await db.insert(predictionsTable).values({
      player1: parsed.data.player1,
      player2: parsed.data.player2,
      tournament: parsed.data.tournament,
      surface: parsed.data.surface,
      matchDate: parsed.data.matchDate,
      agentDialogue: JSON.stringify(dialogue),
      recommendations: JSON.stringify(recommendations),
      riskNotes: riskNotes || null,
      cashoutAdvice: cashoutAdvice || null,
      agentVote: vote,
      fatigueScore1: fatigueScore1 ?? null,
      fatigueScore2: fatigueScore2 ?? null,
      mlAdjustment: mlAdjustment ?? null,
    }).returning();

    send({ type: "saved", prediction: formatPrediction(saved) });
    send({ done: true });
    res.end();
  } catch (err) {
    req.log.error({ err }, "Error in tennis analysis");
    send({ type: "error", message: "Ошибка при анализе матча" });
    send({ done: true });
    res.end();
  }
});

// POST /predictions/analyze-images — multi-image OCR
// mode "single" (default) → merged single match + odds
// mode "express"           → array of ALL matches found across all images
router.post("/predictions/analyze-images", async (req, res): Promise<void> => {
  const images: string[] = Array.isArray(req.body?.images) ? req.body.images : [];
  const mode: string = req.body?.mode === "express" ? "express" : "single";

  if (images.length === 0) {
    res.status(400).json({ error: "Нет изображений" });
    return;
  }

  try {
    if (mode === "express") {
      // For each image, extract ALL matches it contains (one bookmaker screen may show many)
      const perImageMatches = await Promise.all(images.map(async (imageBase64, idx) => {
        const response = await openai.chat.completions.create({
          model: "gpt-5.4",
          max_completion_tokens: 3000,
          messages: [
            {
              role: "system",
              content: `Ты — эксперт по анализу скриншотов букмекерских линий.
На скриншоте может быть НЕСКОЛЬКО теннисных матчей (купон экспресса, линия событий и т.п.).
Найди ВСЕ матчи и верни JSON-массив:
[
  {
    "player1": string,
    "player2": string,
    "tournament": string | null,
    "surface": "Хард" | "Грунт" | "Трава" | "Крытый" | null,
    "matchDate": "YYYY-MM-DD" | null,
    "odds": object | null
  },
  ...
]
Если матч только один — верни массив из одного элемента.
Верни ТОЛЬКО JSON-массив, без пояснений и markdown.`,
            },
            {
              role: "user",
              content: [
                {
                  type: "image_url",
                  image_url: { url: `data:image/jpeg;base64,${imageBase64}` },
                },
                {
                  type: "text",
                  text: `Скриншот #${idx + 1}: найди ВСЕ теннисные матчи и верни массив.`,
                },
              ],
            },
          ],
        });

        const text = response.choices[0]?.message?.content ?? "[]";
        const cleaned = text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
        try {
          const parsed = JSON.parse(cleaned);
          return Array.isArray(parsed) ? parsed : [parsed];
        } catch {
          return [];
        }
      }));

      // Flatten all matches, remove duplicates by player names
      type MatchEntry = { player1: string; player2: string; tournament?: string | null; surface?: string | null; matchDate?: string | null; odds?: unknown };
      const allMatches: MatchEntry[] = (perImageMatches.flat() as MatchEntry[]).filter(
        (m): m is MatchEntry => Boolean(m?.player1 && m?.player2)
      );

      // Deduplicate: same pair of players (case-insensitive)
      const seen = new Set<string>();
      const unique = allMatches.filter(m => {
        const key = `${m.player1.toLowerCase()}__${m.player2.toLowerCase()}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });

      res.json({ matches: unique, total: unique.length });
      return;
    }

    // ── SINGLE mode: original logic ──
    const results = await Promise.all(images.map(async (imageBase64, idx) => {
      const response = await openai.chat.completions.create({
        model: "gpt-5.4",
        max_completion_tokens: 1000,
        messages: [
          {
            role: "system",
            content: `Ты — эксперт по анализу скриншотов букмекерских линий и теннисных данных.
Извлеки из изображения все данные. Верни JSON объект:
{
  "player1": string | null,
  "player2": string | null,
  "tournament": string | null,
  "surface": string | null,
  "matchDate": string | null,
  "odds": object | null,
  "rawText": string
}
Верни ТОЛЬКО JSON, без пояснений.`,
          },
          {
            role: "user",
            content: [
              {
                type: "image_url",
                image_url: { url: `data:image/jpeg;base64,${imageBase64}` },
              },
              {
                type: "text",
                text: `Изображение #${idx + 1}: извлеки все данные о матче, игроках и коэффициентах.`,
              },
            ],
          },
        ],
      });

      const text = response.choices[0]?.message?.content ?? "{}";
      const cleaned = text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
      try { return JSON.parse(cleaned); } catch { return { rawText: text }; }
    }));

    const merged: Record<string, unknown> = {};
    const allOdds: Record<string, unknown> = {};

    for (const result of results) {
      if (result.player1 && !merged.player1) merged.player1 = result.player1;
      if (result.player2 && !merged.player2) merged.player2 = result.player2;
      if (result.tournament && !merged.tournament) merged.tournament = result.tournament;
      if (result.surface && !merged.surface) merged.surface = result.surface;
      if (result.matchDate && !merged.matchDate) merged.matchDate = result.matchDate;
      if (result.odds && typeof result.odds === "object") {
        Object.assign(allOdds, result.odds);
      }
    }

    if (Object.keys(allOdds).length > 0) merged.odds = allOdds;
    merged.rawTexts = results.map((r: Record<string, unknown>) => r.rawText).filter(Boolean);
    merged.imageCount = images.length;

    res.json(merged);
  } catch (err) {
    req.log.error({ err }, "Error analyzing images");
    res.status(500).json({ error: "Ошибка при анализе изображений" });
  }
});

// POST /predictions/:id/podcast — generate audio podcast
router.post("/predictions/:id/podcast", async (req, res): Promise<void> => {
  const idRaw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(idRaw, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Некорректный ID" });
    return;
  }

  const [prediction] = await db.select().from(predictionsTable).where(eq(predictionsTable.id, id));
  if (!prediction) {
    res.status(404).json({ error: "Прогноз не найден" });
    return;
  }

  let dialogue = [];
  try {
    dialogue = JSON.parse(prediction.agentDialogue ?? "[]");
  } catch {
    dialogue = [];
  }

  if (dialogue.length === 0) {
    res.status(400).json({ error: "Нет данных диалога для генерации подкаста" });
    return;
  }

  try {
    const audioBuffer = await generatePodcastAudio(dialogue);
    res.setHeader("Content-Type", "audio/wav");
    res.setHeader("Content-Disposition", `attachment; filename="podcast-${id}.wav"`);
    res.send(audioBuffer);
  } catch (err) {
    req.log.error({ err }, "Error generating podcast");
    res.status(500).json({ error: "Ошибка генерации подкаста" });
  }
});

// POST /predictions/lookup-match — auto-detect surface, date, round via web search
router.post("/predictions/lookup-match", async (req, res): Promise<void> => {
  const { player1, player2, tournament } = req.body as Record<string, string>;
  if (!player1 || !player2) {
    res.status(400).json({ error: "Нужны player1 и player2" });
    return;
  }

  try {
    const matchInfo = tournament
      ? `${player1} vs ${player2} at ${tournament}`
      : `${player1} vs ${player2}`;

    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      max_completion_tokens: 600,
      messages: [
        {
          role: "system",
          content: `You are a tennis match lookup assistant. Given a match, find or infer the surface, date, and tournament details.
Return ONLY valid JSON:
{
  "surface": "Хард" | "Грунт" | "Трава" | "Крытый" | null,
  "matchDate": "YYYY-MM-DD" | null,
  "tournament": string | null,
  "round": string | null,
  "location": string | null,
  "confidence": "high" | "medium" | "low"
}
Use current context and knowledge of the ATP/WTA calendar. If tournament name hints at surface (e.g. Roland Garros = clay, Wimbledon = grass, US Open = hard) use that. If no specific date is known, estimate based on tournament schedule.`,
        },
        {
          role: "user",
          content: `Find match details for: ${matchInfo}. Today is ${new Date().toISOString().split("T")[0]}.`,
        },
      ],
    });

    const raw = response.choices[0]?.message?.content ?? "{}";
    const cleaned = raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    try {
      const data = JSON.parse(cleaned);
      res.json(data);
    } catch {
      res.json({ surface: null, matchDate: null, tournament: null, round: null, location: null, confidence: "low" });
    }
  } catch (err) {
    req.log.error({ err }, "Error in lookup-match");
    res.status(500).json({ error: "Ошибка поиска матча" });
  }
});

// GET /predictions
router.get("/predictions", async (_req, res): Promise<void> => {
  const predictions = await db.select().from(predictionsTable)
    .orderBy(desc(predictionsTable.createdAt));
  res.json(predictions.map(formatPrediction));
});

// POST /predictions
router.post("/predictions", async (req, res): Promise<void> => {
  const parsed = CreatePredictionBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [prediction] = await db.insert(predictionsTable).values(parsed.data).returning();
  res.status(201).json(formatPrediction(prediction));
});

// GET /predictions/:id
router.get("/predictions/:id", async (req, res): Promise<void> => {
  const params = GetPredictionParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [prediction] = await db.select().from(predictionsTable)
    .where(eq(predictionsTable.id, params.data.id));
  if (!prediction) {
    res.status(404).json({ error: "Прогноз не найден" });
    return;
  }
  res.json(formatPrediction(prediction));
});

// PATCH /predictions/:id/result
router.patch("/predictions/:id/result", async (req, res): Promise<void> => {
  const params = UpdatePredictionResultParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const body = UpdatePredictionResultBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  const [updated] = await db.update(predictionsTable)
    .set({ actualResult: body.data.actualResult, isCorrect: body.data.isCorrect })
    .where(eq(predictionsTable.id, params.data.id))
    .returning();
  if (!updated) {
    res.status(404).json({ error: "Прогноз не найден" });
    return;
  }
  res.json(formatPrediction(updated));
});

// DELETE /predictions/:id
router.delete("/predictions/:id", async (req, res): Promise<void> => {
  const params = DeletePredictionParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [deleted] = await db.delete(predictionsTable)
    .where(eq(predictionsTable.id, params.data.id))
    .returning();
  if (!deleted) {
    res.status(404).json({ error: "Прогноз не найден" });
    return;
  }
  res.sendStatus(204);
});

function formatPrediction(p: typeof predictionsTable.$inferSelect) {
  return { ...p, createdAt: p.createdAt.toISOString() };
}

export default router;

import { openai } from "@workspace/integrations-openai-ai-server";
import { db, searchCacheTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "../lib/logger";

export interface PlayerResearch {
  name: string;
  currentRanking: string;
  recentForm: string;
  last10Matches: string;
  injuryStatus: string;
  surfaceStats: string;
  surfacePreference: string;
  recentTournaments: string;
  strengths: string;
  weaknesses: string;
  playstyle: string;
  servingStats: string;
  returningStats: string;
  // PRO extension: human factor
  fatigueScore: number;       // 0-10 (0 = свежий, 10 = полностью измотан)
  fatigueReason: string;      // чем объясняется оценка
  personalContext: string;    // семья, тренер, скандалы, психология
  recentMatchLoad: string;    // сколько матчей за последние 7/14 дней
  coachInfo: string;          // текущий тренер, недавние смены
}

export interface MatchResearch {
  detectedTournament: string;
  detectedSurface: string;
  detectedDate: string;
  detectedRound: string;
  detectedLocation: string;
  detectedConditions: string;

  player1: PlayerResearch;
  player2: PlayerResearch;

  h2hHistory: string;
  h2hOnSurface: string;
  tournamentContext: string;
  marketAnalysis: string;
  keyFactors: string;
}

export type SSESendFn = (data: object) => void;

// ── Cache helpers ─────────────────────────────────────────────────────────────

function buildCacheKey(player1: string, player2: string): string {
  const ym = new Date().toISOString().slice(0, 7); // "2026-05"
  const p1 = player1.toLowerCase().replace(/\s+/g, "_");
  const p2 = player2.toLowerCase().replace(/\s+/g, "_");
  return `${p1}_vs_${p2}_${ym}`;
}

async function getCached(key: string): Promise<MatchResearch | null> {
  try {
    const [row] = await db.select().from(searchCacheTable).where(eq(searchCacheTable.cacheKey, key));
    if (!row) return null;
    return JSON.parse(row.dataJson) as MatchResearch;
  } catch {
    return null;
  }
}

async function setCache(key: string, data: MatchResearch): Promise<void> {
  try {
    await db
      .insert(searchCacheTable)
      .values({ cacheKey: key, dataJson: JSON.stringify(data) })
      .onConflictDoUpdate({ target: searchCacheTable.cacheKey, set: { dataJson: JSON.stringify(data) } });
  } catch (err) {
    logger.warn({ err }, "Failed to write search cache");
  }
}

async function deleteCache(key: string): Promise<void> {
  try {
    await db.delete(searchCacheTable).where(eq(searchCacheTable.cacheKey, key));
  } catch { /* ignore */ }
}

// ── JSON schema ───────────────────────────────────────────────────────────────

const JSON_SCHEMA = (player1: string, player2: string) => `{
  "detectedTournament": "точное название турнира (например 'Wimbledon 2025')",
  "detectedSurface": "одно из: hard | clay | grass | indoor hard | carpet",
  "detectedDate": "YYYY-MM-DD или 'предстоящий матч'",
  "detectedRound": "стадия: 1/32, 1/16, 1/8, 1/4, полуфинал, финал, групповой и т.п.",
  "detectedLocation": "город и страна",
  "detectedConditions": "открытый/закрытый корт, тип мячей, скорость корта, влажность/погода",

  "player1": {
    "name": "${player1}",
    "currentRanking": "#N ATP/WTA",
    "recentForm": "форма за 2 месяца: W/L с именами соперников",
    "last10Matches": "10 матчей с датой, турниром, покрытием, счётом",
    "injuryStatus": "конкретные травмы с датами или 'здоров'",
    "surfaceStats": "hard X%, clay Y%, grass Z%, indoor W%",
    "surfacePreference": "любимое покрытие и почему",
    "recentTournaments": "последние 3-4 турнира с результатами",
    "strengths": "3-4 ключевых преимущества",
    "weaknesses": "2-3 уязвимости",
    "playstyle": "стиль: атакующий/защитный/универсальный, агрессивность 1-10",
    "servingStats": "% 1й подачи, % побед на 1й, % побед на 2й, эйсы/матч",
    "returningStats": "% побед при приёме 1й/2й, % реализации брейк-пойнтов",
    "fatigueScore": 0,
    "fatigueReason": "объяснение оценки усталости: количество матчей за 7/14 дней, длинные матчи накануне, перелёты",
    "personalContext": "смена тренера, семейные события (развод/рождение ребёнка), скандалы, интервью, психологическое состояние, мотивация",
    "recentMatchLoad": "матчей за последние 7 дней: N; матчей за последние 14 дней: M",
    "coachInfo": "текущий тренер (имя), когда назначен, предыдущий тренер если смена была"
  },

  "player2": {
    "name": "${player2}",
    "currentRanking": "#N ATP/WTA",
    "recentForm": "форма за 2 месяца",
    "last10Matches": "10 матчей",
    "injuryStatus": "травмы или 'здоров'",
    "surfaceStats": "hard X%, clay Y%, grass Z%, indoor W%",
    "surfacePreference": "любимое покрытие",
    "recentTournaments": "последние 3-4 турнира",
    "strengths": "3-4 преимущества",
    "weaknesses": "2-3 уязвимости",
    "playstyle": "стиль и агрессивность 1-10",
    "servingStats": "% подачи, эйсы",
    "returningStats": "% приёма, % брейков",
    "fatigueScore": 0,
    "fatigueReason": "объяснение оценки усталости",
    "personalContext": "тренер, семья, психология, мотивация",
    "recentMatchLoad": "матчей за 7 дней: N; матчей за 14 дней: M",
    "coachInfo": "текущий тренер и история"
  },

  "h2hHistory": "общий счёт, ВСЕ матчи: дата, турнир, покрытие, счёт",
  "h2hOnSurface": "h2h только на покрытии этого матча",
  "tournamentContext": "категория (GS/M1000/ATP500), призовые, рейтинговые очки, важность для каждого",
  "marketAnalysis": "диапазон коэффициентов, кто фаворит, имплицитные вероятности, расхождения",
  "keyFactors": "8-10 конкретных факторов: подача, форма, h2h, физика, психология, условия"
}`;

// ── Web search research (OpenAI with web_search_preview tool) ─────────────────

async function tryWebSearchResearch(
  player1: string,
  player2: string,
  hintTournament: string | undefined,
  hintSurface: string | undefined,
  hintDate: string | undefined,
): Promise<MatchResearch | null> {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const hints = [
      hintTournament && `турнир: ${hintTournament}`,
      hintSurface    && `покрытие: ${hintSurface}`,
      hintDate       && `дата: ${hintDate}`,
    ].filter(Boolean).join("; ");

    const input = `Сегодня ${today}. Ты — ведущий теннисный аналитик с 50-летним опытом.
Проведи МАКСИМАЛЬНО глубокий анализ матча: ${player1} vs ${player2}.
${hints ? `Подсказки: ${hints}` : "Турнир/покрытие/дата не указаны — определи сам."}

Используй web_search для поиска СЛЕДУЮЩИХ ДАННЫХ (всё важно):

1. МАТЧ: точное название турнира, дата, стадия, город, покрытие, условия
2. ДЛЯ КАЖДОГО ИГРОКА:
   • Рейтинг ATP/WTA сегодня
   • Форма за 2 месяца (W/L, конкретные матчи)
   • Win% на всех покрытиях (hard/clay/grass/indoor)
   • Стиль игры, подача/приём (проценты, эйсы)
   • Последние 10 матчей с счётами
   • ТРАВМЫ (любые новости за последние 2 недели, пресс-конференции)
   • УСТАЛОСТЬ: сколько матчей за последние 7 дней и 14 дней? Были ли длинные матчи накануне (3+ сета)? Переезды?
   • ЛИЧНАЯ ЖИЗНЬ: смена тренера (когда, кто), семейные события (рождение ребёнка, развод), скандалы, интервью о мотивации, психологическое состояние
   • НАГРУЗКА: количество турниров за последние 30 дней
   • Текущий тренер и история с тренерами
3. H2H: общий счёт, все матчи с датой/турниром/покрытием/счётом; h2h на этом покрытии
4. КОНТЕКСТ: категория турнира, призовые, рейтинговые очки, важность для каждого игрока
5. РЫНОК: коэффициенты букмекеров, кто фаворит, где расхождение с реальным балансом сил

На основе УСТАЛОСТИ рассчитай fatigueScore (0-10) для каждого:
0 = полностью свеж, 5 = умеренно устал, 10 = полностью измотан
Учитывай: матчи за последние 7 дней, длинные матчи (3+ сета), перелёты, гестральные показатели.

Верни ТОЛЬКО JSON без markdown, точно по схеме:
${JSON_SCHEMA(player1, player2)}`;

    const response = await (openai as any).responses.create({
      model: "gpt-5.4",
      tools: [{ type: "web_search_preview" }],
      input,
      max_output_tokens: 7000,
    });

    const text: string =
      response.output_text ??
      response.output
        ?.find((o: any) => o.type === "message")
        ?.content?.find((c: any) => c.type === "output_text")?.text ??
      "";

    if (!text || text.length < 100) return null;

    const cleaned = text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;

    const parsed = JSON.parse(jsonMatch[0]) as MatchResearch;
    if (!parsed.player1?.name || !parsed.player2?.name) return null;

    // Ensure fatigueScore is a number (AI may return string)
    parsed.player1.fatigueScore = Number(parsed.player1.fatigueScore ?? 0);
    parsed.player2.fatigueScore = Number(parsed.player2.fatigueScore ?? 0);

    return parsed;
  } catch (err) {
    logger.warn({ err }, "Web search research failed, falling back to knowledge-based");
    return null;
  }
}

// ── Fallback: knowledge-only research ─────────────────────────────────────────

async function knowledgeBasedResearch(
  player1: string,
  player2: string,
  hintTournament: string | undefined,
  hintSurface: string | undefined,
  hintDate: string | undefined,
): Promise<MatchResearch> {
  const hints = [
    hintTournament && `Турнир: ${hintTournament}`,
    hintSurface    && `Покрытие: ${hintSurface}`,
    hintDate       && `Дата: ${hintDate}`,
  ].filter(Boolean).join("\n");

  const prompt = `Ты — ведущий теннисный аналитик с 50-летним опытом.
Проведи глубокий анализ матча ${player1} vs ${player2}.

${hints || "Параметры матча не указаны — определи наиболее вероятные."}

ТРЕБОВАНИЯ:
- Только реальные факты (срез знаний — начало 2026).
- Конкретные числа: рейтинги, win%, счета h2h, эйсы/матч.
- Оцени fatigueScore (0-10) на основе известных данных об игровом графике.
- Для personalContext — упомяни известные события (тренеры, семья, интервью).
- Заполни ВСЕ поля.

Верни ТОЛЬКО JSON без markdown:
${JSON_SCHEMA(player1, player2)}`;

  const response = await openai.chat.completions.create({
    model: "gpt-5.4",
    max_completion_tokens: 6000,
    messages: [
      { role: "system", content: prompt },
      { role: "user",   content: `Анализ: ${player1} vs ${player2}. Заполни все поля.` },
    ],
  });

  const text = response.choices[0]?.message?.content ?? "{}";
  const cleaned = text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
  const jsonMatch = cleaned.match(/\{[\s\S]*\}/);

  try {
    if (!jsonMatch) throw new Error("No JSON");
    const parsed = JSON.parse(jsonMatch[0]) as MatchResearch;
    parsed.player1.fatigueScore = Number(parsed.player1.fatigueScore ?? 0);
    parsed.player2.fatigueScore = Number(parsed.player2.fatigueScore ?? 0);
    return parsed;
  } catch {
    return emptyResearch(player1, player2, hintTournament, hintSurface, hintDate);
  }
}

// ── Empty fallback ─────────────────────────────────────────────────────────────

function emptyResearch(
  player1: string,
  player2: string,
  hintTournament?: string,
  hintSurface?: string,
  hintDate?: string,
): MatchResearch {
  const blankPlayer = (name: string): PlayerResearch => ({
    name,
    currentRanking: "данные уточняются",
    recentForm: "анализируется",
    last10Matches: "анализируется",
    injuryStatus: "нет данных",
    surfaceStats: "анализируется",
    surfacePreference: "анализируется",
    recentTournaments: "анализируется",
    strengths: "анализируется",
    weaknesses: "анализируется",
    playstyle: "анализируется",
    servingStats: "анализируется",
    returningStats: "анализируется",
    fatigueScore: 0,
    fatigueReason: "нет данных",
    personalContext: "нет данных",
    recentMatchLoad: "нет данных",
    coachInfo: "нет данных",
  });
  return {
    detectedTournament: hintTournament ?? "не определено",
    detectedSurface: hintSurface ?? "не определено",
    detectedDate: hintDate ?? "не определено",
    detectedRound: "не определено",
    detectedLocation: "не определено",
    detectedConditions: "не определено",
    player1: blankPlayer(player1),
    player2: blankPlayer(player2),
    h2hHistory: "анализируется",
    h2hOnSurface: "анализируется",
    tournamentContext: "анализируется",
    marketAnalysis: "анализируется",
    keyFactors: "анализируется",
  };
}

// ── Public entry point ────────────────────────────────────────────────────────

export async function researchMatch(
  player1: string,
  player2: string,
  tournament: string | undefined,
  surface: string | undefined,
  send: SSESendFn,
  matchDate?: string,
  forceRefresh?: boolean,
): Promise<{ research: MatchResearch; usedWebSearch: boolean }> {
  send({ type: "research_start" });

  const cacheKey = buildCacheKey(player1, player2);

  // Check cache (skip on forceRefresh)
  if (!forceRefresh) {
    const cached = await getCached(cacheKey);
    if (cached) {
      send({ type: "research_progress", message: `⚡ Данные из кеша — ${cached.detectedTournament}` });
      send({
        type: "match_detected",
        tournament: cached.detectedTournament,
        surface:    cached.detectedSurface,
        date:       cached.detectedDate,
        round:      cached.detectedRound,
        location:   cached.detectedLocation,
        conditions: cached.detectedConditions,
        fatigue1:   cached.player1.fatigueScore,
        fatigue2:   cached.player2.fatigueScore,
      });
      send({ type: "research_complete", usedWebSearch: false, fromCache: true });
      return { research: cached, usedWebSearch: false };
    }
  } else {
    await deleteCache(cacheKey);
    send({ type: "research_progress", message: `🔄 Принудительное обновление данных...` });
  }

  // Deep web search
  send({ type: "research_progress", message: `🌐 Глубокий веб-поиск: травмы, форма, усталость, личный контекст...` });
  const webResult = await tryWebSearchResearch(player1, player2, tournament, surface, matchDate);

  if (webResult) {
    // Cache the result
    await setCache(cacheKey, webResult);

    send({
      type: "research_progress",
      message: `✅ Найдено: ${webResult.detectedTournament} | ${webResult.detectedSurface} | Усталость: ${player1} ${webResult.player1.fatigueScore}/10 · ${player2} ${webResult.player2.fatigueScore}/10`,
    });
    send({
      type: "match_detected",
      tournament: webResult.detectedTournament,
      surface:    webResult.detectedSurface,
      date:       webResult.detectedDate,
      round:      webResult.detectedRound,
      location:   webResult.detectedLocation,
      conditions: webResult.detectedConditions,
      fatigue1:   webResult.player1.fatigueScore,
      fatigue2:   webResult.player2.fatigueScore,
    });
    send({ type: "research_complete", usedWebSearch: true, fromCache: false });
    return { research: webResult, usedWebSearch: true };
  }

  // Fallback: knowledge-based
  send({ type: "research_progress", message: `📚 Веб-поиск недоступен — используем ATP/WTA базу знаний...` });
  const research = await knowledgeBasedResearch(player1, player2, tournament, surface, matchDate);
  await setCache(cacheKey, research);

  send({
    type: "research_progress",
    message: `📋 ${research.detectedTournament} | ${research.detectedSurface}`,
  });
  send({
    type: "match_detected",
    tournament: research.detectedTournament,
    surface:    research.detectedSurface,
    date:       research.detectedDate,
    round:      research.detectedRound,
    location:   research.detectedLocation,
    conditions: research.detectedConditions,
    fatigue1:   research.player1.fatigueScore,
    fatigue2:   research.player2.fatigueScore,
  });
  send({ type: "research_complete", usedWebSearch: false, fromCache: false });
  return { research, usedWebSearch: false };
}

// ── Context builder ────────────────────────────────────────────────────────────

export function buildResearchContext(research: MatchResearch): string {
  const p1 = research.player1;
  const p2 = research.player2;

  const fatigueLabel = (score: number) =>
    score <= 2 ? "свеж" : score <= 4 ? "умеренно устал" : score <= 6 ? "устал" : score <= 8 ? "сильно устал" : "критически измотан";

  return `═══════════════════════════════════════
АНАЛИТИЧЕСКИЙ БРИФИНГ — ПОЛНЫЕ ДАННЫЕ
═══════════════════════════════════════

▶ МАТЧ
• Турнир: ${research.detectedTournament}
• Покрытие: ${research.detectedSurface}
• Дата: ${research.detectedDate}
• Стадия: ${research.detectedRound}
• Локация: ${research.detectedLocation}
• Условия: ${research.detectedConditions}

▶ ${p1.name.toUpperCase()}  [рейтинг: ${p1.currentRanking}]
• Форма: ${p1.recentForm}
• Последние 10 матчей: ${p1.last10Matches}
• Травмы / физсостояние: ${p1.injuryStatus}
• Win% на покрытиях: ${p1.surfaceStats}
• Любимое покрытие: ${p1.surfacePreference}
• Последние турниры: ${p1.recentTournaments}
• Нагрузка за 7/14 дней: ${p1.recentMatchLoad}
• Стиль игры: ${p1.playstyle}
• Подача: ${p1.servingStats}
• Приём: ${p1.returningStats}
• Сильные стороны: ${p1.strengths}
• Слабые стороны: ${p1.weaknesses}
• УСТАЛОСТЬ: ${p1.fatigueScore}/10 (${fatigueLabel(p1.fatigueScore)}) — ${p1.fatigueReason}
• ЛИЧНЫЙ КОНТЕКСТ: ${p1.personalContext}
• Тренер: ${p1.coachInfo}

▶ ${p2.name.toUpperCase()}  [рейтинг: ${p2.currentRanking}]
• Форма: ${p2.recentForm}
• Последние 10 матчей: ${p2.last10Matches}
• Травмы / физсостояние: ${p2.injuryStatus}
• Win% на покрытиях: ${p2.surfaceStats}
• Любимое покрытие: ${p2.surfacePreference}
• Последние турниры: ${p2.recentTournaments}
• Нагрузка за 7/14 дней: ${p2.recentMatchLoad}
• Стиль игры: ${p2.playstyle}
• Подача: ${p2.servingStats}
• Приём: ${p2.returningStats}
• Сильные стороны: ${p2.strengths}
• Слабые стороны: ${p2.weaknesses}
• УСТАЛОСТЬ: ${p2.fatigueScore}/10 (${fatigueLabel(p2.fatigueScore)}) — ${p2.fatigueReason}
• ЛИЧНЫЙ КОНТЕКСТ: ${p2.personalContext}
• Тренер: ${p2.coachInfo}

▶ ЛИЧНЫЕ ВСТРЕЧИ (H2H)
${research.h2hHistory}

▶ H2H НА ЭТОМ ПОКРЫТИИ
${research.h2hOnSurface}

▶ КОНТЕКСТ ТУРНИРА
${research.tournamentContext}

▶ РЫНОЧНЫЙ АНАЛИЗ
${research.marketAnalysis}

▶ КЛЮЧЕВЫЕ ФАКТОРЫ
${research.keyFactors}
═══════════════════════════════════════`;
}

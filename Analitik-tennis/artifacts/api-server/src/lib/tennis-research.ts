import { openai } from "@workspace/integrations-openai-ai-server";
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
}

export interface MatchResearch {
  // Auto-detected match metadata
  detectedTournament: string;
  detectedSurface: string;
  detectedDate: string;
  detectedRound: string;
  detectedLocation: string;
  detectedConditions: string;

  // Players
  player1: PlayerResearch;
  player2: PlayerResearch;

  // Match-level analysis
  h2hHistory: string;
  h2hOnSurface: string;
  tournamentContext: string;
  marketAnalysis: string;
  keyFactors: string;
}

export type SSESendFn = (data: object) => void;

const JSON_SCHEMA = (player1: string, player2: string) => `{
  "detectedTournament": "точное название турнира (например 'Wimbledon 2025', 'Roland Garros 2025', 'ATP 500 Дубай')",
  "detectedSurface": "одно из: hard | clay | grass | indoor hard | carpet",
  "detectedDate": "дата матча в формате YYYY-MM-DD или 'предстоящий матч / точная дата не известна'",
  "detectedRound": "стадия: 1/32, 1/16, 1/8, 1/4, полуфинал, финал, групповой и т.п.",
  "detectedLocation": "город и страна (например 'Лондон, Великобритания')",
  "detectedConditions": "погода/условия: открытый/закрытый корт, тип мячей, скорость корта, влажность",

  "player1": {
    "name": "${player1}",
    "currentRanking": "точный рейтинг ATP/WTA, например '#3 ATP'",
    "recentForm": "форма последние 2 месяца: количество побед/поражений, против кого",
    "last10Matches": "последние 10 матчей с результатами и счётом",
    "injuryStatus": "конкретные травмы (если есть) с датами, или 'здоров'",
    "surfaceStats": "win% на ВСЕХ покрытиях: hard X%, clay Y%, grass Z%, indoor W%",
    "surfacePreference": "какое покрытие любит больше всего и почему",
    "recentTournaments": "последние 3-4 турнира с результатами",
    "strengths": "3-4 ключевых преимущества (подача, форхенд, психология и т.д.)",
    "weaknesses": "2-3 уязвимости",
    "playstyle": "стиль игры: атакующий/защитный/универсальный, агрессивность от 1 до 10",
    "servingStats": "% первой подачи, % выигрыша на 1й, % выигрыша на 2й, эйсы за матч",
    "returningStats": "% выигранных приёмов 1й, 2й подачи, % реализации брейк-пойнтов"
  },

  "player2": {
    "name": "${player2}",
    "currentRanking": "точный рейтинг ATP/WTA",
    "recentForm": "форма последние 2 месяца",
    "last10Matches": "последние 10 матчей",
    "injuryStatus": "травмы или 'здоров'",
    "surfaceStats": "win% на всех покрытиях",
    "surfacePreference": "любимое покрытие",
    "recentTournaments": "последние 3-4 турнира",
    "strengths": "3-4 преимущества",
    "weaknesses": "2-3 уязвимости",
    "playstyle": "стиль игры и агрессивность 1-10",
    "servingStats": "% подачи, эйсы",
    "returningStats": "% приёма, % реализации брейков"
  },

  "h2hHistory": "полная история h2h: общий счёт, ВСЕ матчи с датой, турниром, покрытием и счётом",
  "h2hOnSurface": "h2h конкретно на покрытии этого матча: счёт и матчи",
  "tournamentContext": "категория турнира (Grand Slam / Masters 1000 / ATP 500 / WTA 1000 и т.д.), призовые, рейтинговые очки, стадия, важность для каждого игрока",
  "marketAnalysis": "типичный диапазон коэффициентов от букмекеров, кого считают фаворитом, имплицитная вероятность, есть ли расхождения с расчётной",
  "keyFactors": "7-10 конкретных факторов которые определят исход: подача, форма, h2h, физика, психология, погода и т.д."
}`;

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
      hintTournament && `подсказка турнир: ${hintTournament}`,
      hintSurface && `подсказка покрытие: ${hintSurface}`,
      hintDate && `подсказка дата: ${hintDate}`,
    ].filter(Boolean).join("; ");

    const input = `Сегодня ${today}. Ты — ведущий теннисный аналитик с 50-летним опытом.
Проведи МАКСИМАЛЬНО глубокий анализ матча: ${player1} vs ${player2}.
${hints ? `Подсказки от пользователя: ${hints}` : "Пользователь не указал турнир/покрытие/дату — определи сам."}

Используй web_search чтобы найти:

1. БЛИЖАЙШИЙ или ТЕКУЩИЙ матч между этими игроками — точное название турнира, дату, стадию, город, покрытие
2. Условия проведения: открытый/закрытый корт, тип мячей, скорость покрытия, погода
3. Для каждого игрока:
   • Текущий рейтинг ATP/WTA на сегодня
   • Форма за последние 2 месяца с конкретными матчами
   • Win% на каждом из 4 покрытий (hard / clay / grass / indoor)
   • Какое покрытие любит больше всего
   • Стиль игры, подача, приём, эйсы/матч
   • Травмы и физическое состояние (новости, пресс-конференции)
   • Последние 10 матчей
4. История h2h: общий счёт, ВСЕ матчи с датой/турниром/покрытием/счётом
5. h2h конкретно на покрытии этого матча
6. Контекст турнира: категория, призовые, важность для игроков
7. Анализ рынка букмекеров

ВАЖНО: Верни ТОЛЬКО JSON без markdown, точно по этой схеме:
${JSON_SCHEMA(player1, player2)}`;

    const response = await (openai as any).responses.create({
      model: "gpt-5.4",
      tools: [{ type: "web_search_preview" }],
      input,
      max_output_tokens: 6000,
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
    return parsed;
  } catch (err) {
    logger.warn({ err }, "Web search research failed, falling back to knowledge-based research");
    return null;
  }
}

async function knowledgeBasedResearch(
  player1: string,
  player2: string,
  hintTournament: string | undefined,
  hintSurface: string | undefined,
  hintDate: string | undefined,
): Promise<MatchResearch> {
  const hints = [
    hintTournament && `Турнир (подсказка): ${hintTournament}`,
    hintSurface && `Покрытие (подсказка): ${hintSurface}`,
    hintDate && `Дата (подсказка): ${hintDate}`,
  ].filter(Boolean).join("\n");

  const prompt = `Ты — ведущий теннисный аналитик с 50-летним опытом и энциклопедическими знаниями об ATP/WTA.
Проведи МАКСИМАЛЬНО глубокий профессиональный анализ матча ${player1} vs ${player2}.

${hints || "Пользователь не указал параметры матча — определи их сам исходя из контекста."}

ТРЕБОВАНИЯ:
- Используй только реальные факты из своих знаний (срез — начало 2025).
- Если параметры не указаны — определи наиболее вероятный турнир/покрытие/дату исходя из календаря ATP/WTA для этих игроков.
- Если игрок малоизвестен — честно укажи это в поле name комментарием.
- Давай максимально конкретные числа: рейтинги, win%, счета h2h, эйсы/матч.
- Заполни ВСЕ поля, особенно surfaceStats для всех 4 покрытий и servingStats/returningStats.

Верни ТОЛЬКО JSON (без markdown) по схеме:
${JSON_SCHEMA(player1, player2)}`;

  const response = await openai.chat.completions.create({
    model: "gpt-5.4",
    max_completion_tokens: 6000,
    messages: [
      { role: "system", content: prompt },
      {
        role: "user",
        content: `Анализ: ${player1} vs ${player2}. Заполни ВСЕ поля схемы максимально детально.`,
      },
    ],
  });

  const text = response.choices[0]?.message?.content ?? "{}";
  const cleaned = text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
  const jsonMatch = cleaned.match(/\{[\s\S]*\}/);

  try {
    if (!jsonMatch) throw new Error("No JSON found");
    return JSON.parse(jsonMatch[0]) as MatchResearch;
  } catch {
    return emptyResearch(player1, player2, hintTournament, hintSurface, hintDate);
  }
}

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

export async function researchMatch(
  player1: string,
  player2: string,
  tournament: string | undefined,
  surface: string | undefined,
  send: SSESendFn,
  matchDate?: string,
): Promise<{ research: MatchResearch; usedWebSearch: boolean }> {
  send({ type: "research_start" });

  send({ type: "research_progress", message: `🔎 Ищем актуальные данные о матче ${player1} vs ${player2}...` });
  const webResult = await tryWebSearchResearch(player1, player2, tournament, surface, matchDate);

  if (webResult) {
    send({
      type: "research_progress",
      message: `✅ Турнир: ${webResult.detectedTournament} | ${webResult.detectedSurface} | ${webResult.detectedDate}`,
    });
    send({
      type: "match_detected",
      tournament: webResult.detectedTournament,
      surface: webResult.detectedSurface,
      date: webResult.detectedDate,
      round: webResult.detectedRound,
      location: webResult.detectedLocation,
      conditions: webResult.detectedConditions,
    });
    send({ type: "research_done", usedWebSearch: true });
    return { research: webResult, usedWebSearch: true };
  }

  send({ type: "research_progress", message: `📚 Веб недоступен — используем энциклопедию ATP/WTA...` });
  const research = await knowledgeBasedResearch(player1, player2, tournament, surface, matchDate);
  send({
    type: "research_progress",
    message: `📋 Турнир: ${research.detectedTournament} | ${research.detectedSurface}`,
  });
  send({
    type: "match_detected",
    tournament: research.detectedTournament,
    surface: research.detectedSurface,
    date: research.detectedDate,
    round: research.detectedRound,
    location: research.detectedLocation,
    conditions: research.detectedConditions,
  });
  send({ type: "research_done", usedWebSearch: false });
  return { research, usedWebSearch: false };
}

export function buildResearchContext(research: MatchResearch): string {
  const p1 = research.player1;
  const p2 = research.player2;

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
• Стиль игры: ${p1.playstyle}
• Подача: ${p1.servingStats}
• Приём: ${p1.returningStats}
• Сильные стороны: ${p1.strengths}
• Слабые стороны: ${p1.weaknesses}

▶ ${p2.name.toUpperCase()}  [рейтинг: ${p2.currentRanking}]
• Форма: ${p2.recentForm}
• Последние 10 матчей: ${p2.last10Matches}
• Травмы / физсостояние: ${p2.injuryStatus}
• Win% на покрытиях: ${p2.surfaceStats}
• Любимое покрытие: ${p2.surfacePreference}
• Последние турниры: ${p2.recentTournaments}
• Стиль игры: ${p2.playstyle}
• Подача: ${p2.servingStats}
• Приём: ${p2.returningStats}
• Сильные стороны: ${p2.strengths}
• Слабые стороны: ${p2.weaknesses}

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

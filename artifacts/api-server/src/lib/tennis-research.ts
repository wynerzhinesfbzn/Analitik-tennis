import { openai } from "@workspace/integrations-openai-ai-server";
import { db, searchCacheTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "../lib/logger";

export interface PlayerResearch {
  name: string;
  age: string;                    // возраст, дата рождения
  nationality: string;            // гражданство / представляемая страна
  currentRanking: string;
  careerHighRanking: string;      // пиковый рейтинг карьеры
  careerTitles: string;           // количество и крупнейшие титулы (GS, M1000, etc.)

  // Форма и результаты
  recentForm: string;
  last10Matches: string;
  currentSeasonRecord: string;    // W-L в текущем сезоне
  recentTournaments: string;

  // Физика и здоровье
  injuryStatus: string;
  physicalProfile: string;        // рост, вес, атлетический тип, выносливость vs взрыв
  fatigueScore: number;
  fatigueReason: string;
  recentMatchLoad: string;

  // Игровой стиль — детально
  playstyle: string;
  servingStats: string;
  servingPatterns: string;        // куда подаёт на деuce/ad, % слайс/flat/kick
  returningStats: string;
  returningStyle: string;         // позиция при приёме, агрессивность
  netPlay: string;                // % побед у сетки, как часто идёт вперёд
  backhandType: string;           // одноручный / двуручный, сила/слабость
  forehandRating: string;         // оценка форхенда, RPM, направления
  movementRating: string;         // скорость первого шага, охват корта, скользание

  // Покрытия — детально
  surfaceStats: string;
  surfacePreference: string;
  hardCourtGame: string;          // как играет на харде конкретно (скорость, высота отскока)
  clayCourtGame: string;          // как играет на грунте (таланти скользить, терпение)
  grassCourtGame: string;         // как играет на траве (подача-выход, чтение отскока)
  indoorGame: string;             // как играет в залах

  // Психология — детально
  mentalProfile: string;          // боец или ломается, как ведёт себя при 0:2 по сетам
  tiebreakRecord: string;         // Win% в тай-брейках, история важных тай-брейков
  decidingSetRecord: string;      // Win% в решающих сетах (3-й или 5-й)
  comebackAbility: string;        // как часто выигрывает после проигрыша сета
  bigMatchRecord: string;         // рекорд в финалах, полуфиналах GS, против Top-10
  pressureHandling: string;       // поведение на сетболах, матчболах, при BreakPoints
  motivationState: string;        // что поставлено на кон (рейтинг, защита очков, рекорд)

  // Любимые / нелюбимые турниры
  bestTournaments: string;        // где побеждал / стабильно выходит в финалы
  poorTournaments: string;        // где стабильно уступает рано
  performanceAtThisTournament: string; // история именно на этом турнире

  // Тактика и стиль против соперников
  vsLeftHandedRecord: string;     // рекорд против левшей
  vsBaseliners: string;           // против типичных базелайнеров
  vsServeVolley: string;          // против атакующих игроков сетки
  vsHighBounce: string;           // против высокого отскока (топспин игроков)

  // Слабые и сильные стороны
  strengths: string;
  weaknesses: string;
  underPressureWeakness: string;  // конкретные ситуации где чаще проигрывает

  // Личный контекст
  personalContext: string;
  coachInfo: string;
  teamDynamics: string;           // тренерская команда, спарринги, атмосфера в команде
  financialMotivation: string;    // призовые / рейтинговые очки на кону, контракты
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

const PLAYER_SCHEMA = (name: string) => `{
    "name": "${name}",
    "age": "возраст и дата рождения",
    "nationality": "страна / гражданство",
    "currentRanking": "#N ATP/WTA на сегодня",
    "careerHighRanking": "#N (год)",
    "careerTitles": "N титулов: [GS: X, M1000: Y, ATP500: Z, другие]",

    "recentForm": "форма за 2 месяца — W/L с именами соперников и счётами",
    "last10Matches": "последние 10 матчей: дата | турнир | покрытие | соперник | счёт | W/L",
    "currentSeasonRecord": "W-L в сезоне, % побед",
    "recentTournaments": "последние 4-5 турниров с результатами",

    "injuryStatus": "все травмы и болячки: конкретные, с датами, насколько серьёзно",
    "physicalProfile": "рост, вес, физический тип (эндюранс/взрывной/универсал), хронические проблемы",
    "fatigueScore": 0,
    "fatigueReason": "матчей за 7 дней: N, за 14 дней: M; были ли 3-сетовые накануне; перелёты",
    "recentMatchLoad": "матчей за 7 дней: N | за 14 дней: M | последний матч: дата",

    "playstyle": "атакующий/защитный/универсальный, агрессивность 1-10, базелайнер/сетевик",
    "servingStats": "% 1й подачи, % побед на 1й, % побед на 2й, эйсы/матч, двойные/матч",
    "servingPatterns": "любимые зоны подачи (T/wide/body) на deuce/ad court; тип (flat/kick/slice)",
    "returningStats": "% побед при приёме 1й, % побед при приёме 2й, % реализации брейк-пойнтов",
    "returningStyle": "позиция при приёме (близко/далеко), агрессивность, направление",
    "netPlay": "% побед у сетки, сколько раз в матч идёт к сетке, умение завершать",
    "backhandType": "1-рукий / 2-рукий, мощь/стабильность, слабый удар с бэкхенда?",
    "forehandRating": "оценка 1-10, RPM, любимые направления, winning shot или setup?",
    "movementRating": "первый шаг 1-10, охват корта, скольжение на грунте, быстрота смены направлений",

    "surfaceStats": "hard Win%: X | clay Win%: Y | grass Win%: Z | indoor Win%: W",
    "surfacePreference": "любимое покрытие и ПОЧЕМУ (детально: особенности физики, тактики)",
    "hardCourtGame": "как играет на харде: быстрый/медленный харт, как адаптируется",
    "clayCourtGame": "как играет на грунте: умеет ли скользить, насколько терпелив в розыгрышах",
    "grassCourtGame": "как играет на траве: подача-выход, адаптация к низкому отскоку",
    "indoorGame": "как играет в зале: привычка к скорости, адаптация к условиям",

    "mentalProfile": "описание психотипа: боец/ломается/нестабилен, поведение при 0:2 по сетам",
    "tiebreakRecord": "Win% в тай-брейках, известные важные тай-брейки (выиграл/проиграл)",
    "decidingSetRecord": "Win% в решающих сетах (3-й в best-of-3), статистика",
    "comebackAbility": "как часто отыгрывается с 0:1 по сетам, % таких камбэков",
    "bigMatchRecord": "рекорд в финалах GS/M1000, против Top-5, в полуфиналах major",
    "pressureHandling": "% реализации break points, % спасения break points, поведение на матчболах",
    "motivationState": "что на кону: защита очков, chase рейтинга, важность именно этого турнира",

    "bestTournaments": "где стабильно побеждает / доходит до финалов (конкретные названия)",
    "poorTournaments": "где стабильно уступает рано или показывает слабые результаты",
    "performanceAtThisTournament": "история на ЭТОМ конкретном турнире: все результаты за карьеру",

    "vsLeftHandedRecord": "Win% против левшей",
    "vsBaseliners": "насколько хорошо против терпеливых базелайнеров",
    "vsServeVolley": "насколько хорошо против атакующих сетевиков",
    "vsHighBounce": "насколько хорошо против высокого топспина (важно на грунте)",

    "strengths": "5-6 конкретных сильных сторон с примерами",
    "weaknesses": "3-4 конкретные уязвимости с примерами матчей где это проявилось",
    "underPressureWeakness": "конкретные ситуации/счета где чаще срывается",

    "personalContext": "ВСЁ известное: семья (жена/муж/дети, недавние события), отношения с командой, скандалы, интервью о настрое, публичные заявления",
    "coachInfo": "текущий тренер (имя), когда назначен, стиль работы, предыдущий тренер",
    "teamDynamics": "тренерская команда (физио, спарринги), атмосфера, конфликты если были",
    "financialMotivation": "контракты со спонсорами, бонусы за рейтинг, финансовое давление"
  }`;

const JSON_SCHEMA = (player1: string, player2: string) => `{
  "detectedTournament": "точное название турнира (например 'Roland Garros 2026')",
  "detectedSurface": "одно из: hard | clay | grass | indoor hard | carpet",
  "detectedDate": "YYYY-MM-DD или 'предстоящий матч'",
  "detectedRound": "стадия: 1/32, 1/16, 1/8, 1/4, полуфинал, финал, групповой и т.п.",
  "detectedLocation": "город и страна",
  "detectedConditions": "открытый/закрытый корт, тип мячей, скорость корта, влажность/погода/высота над уровнем моря",

  "player1": ${PLAYER_SCHEMA(player1)},
  "player2": ${PLAYER_SCHEMA(player2)},

  "h2hHistory": "общий счёт W-L, ВСЕ встречи: дата | турнир | покрытие | счёт | кто выиграл",
  "h2hOnSurface": "h2h ТОЛЬКО на покрытии этого матча, с конкретными матчами",
  "h2hStyleDynamic": "тактическая динамика встреч: кто доминирует в каких ситуациях, ключевые моменты противостояния",
  "tournamentContext": "категория (GS/M1000/ATP500/250), призовые, рейтинговые очки, значимость для каждого",
  "marketAnalysis": "диапазон коэффициентов у топ-5 букмекеров, кто фаворит, имплицитные вероятности, подозрительные движения линии",
  "keyFactors": "10-12 конкретных факторов которые решат матч: подача, форма, h2h, физика, психология, условия, покрытие, мотивация"
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

    const input = `Сегодня ${today}. Ты — профессиональный теннисный скаут и аналитик беттинг-синдиката.
Проведи ПОЛНЫЙ ДОСЬЕ-АНАЛИЗ матча: ${player1} vs ${player2}.
${hints ? `Данные матча: ${hints}` : "Турнир/покрытие/дата не указаны — определи сам по последним новостям."}

╔══════════════════════════════════════════════════╗
║  КРИТИЧЕСКОЕ ПРАВИЛО — НАРУШЕНИЕ НЕДОПУСТИМО:   ║
║  ИСПОЛЬЗУЙ ТОЛЬКО ДАННЫЕ ИЗ WEB_SEARCH.         ║
║  ЗАПРЕЩЕНО заполнять поля из памяти / обучения. ║
║  Если не нашёл в интернете — пиши "НЕ НАЙДЕНО". ║
║  Лучше "НЕ НАЙДЕНО" чем придуманная цифра.      ║
╚══════════════════════════════════════════════════╝

ОБЯЗАТЕЛЬНАЯ ПОСЛЕДОВАТЕЛЬНОСТЬ WEB-ПОИСКОВ (выполни ВСЕ):
1. "${player1} ${player2} match ${hintTournament ?? "2025 2026"}" — найди расписание/результат матча
2. "${player1} injury news ${today.slice(0, 7)}" — свежие новости о травмах
3. "${player2} injury fitness press conference ${today.slice(0, 7)}" — то же для второго
4. "${player1} recent matches results ${today.slice(0, 7)}" — последние результаты
5. "${player2} recent matches results ${today.slice(0, 7)}" — то же
6. "${player1} ${player2} h2h head to head history" — история встреч
7. "${player1} ${player2} ${hintTournament ?? "tennis"} odds betting" — коэффициенты
8. "${player1} coach motivation interview ${today.slice(0, 4)}" — личный контекст
9. "${player2} coach motivation interview ${today.slice(0, 4)}" — то же

Используй web_search МНОГОКРАТНО — минимум 6-9 поисков перед заполнением JSON.

═══ БЛОК 1: МАТЧ ═══
• Точное название турнира, дата, стадия, город, страна
• Тип покрытия и его характеристики (скорость, отскок, условия)
• Открытый/закрытый корт, погода, высота над уровнем моря

═══ БЛОК 2: ПОЛНОЕ ДОСЬЕ КАЖДОГО ИГРОКА ═══
Для ${player1} И ${player2} найди ВСЁ:

БИОГРАФИЯ И КАРЬЕРА:
• Возраст, гражданство, рост, вес
• Пиковый рейтинг карьеры, год
• Количество и список крупнейших титулов (Grand Slam, Masters 1000, ATP/WTA 500)
• Текущий рейтинг и рекорд сезона W-L

ФОРМА И РЕЗУЛЬТАТЫ:
• Последние 10 матчей с датой, турниром, покрытием, соперником, счётом
• Форма за последние 2 месяца
• Результаты на последних 4-5 турнирах

ФИЗИЧЕСКОЕ СОСТОЯНИЕ:
• Все актуальные травмы и болячки (ищи пресс-конференции, официальные заявления)
• Хронические проблемы со здоровьем
• Сколько матчей за 7 дней и 14 дней — ПОСЧИТАЙ
• Были ли 3-сетовые матчи за последние 72 часа?
• Перелёты и смены часовых поясов перед турниром
• fatigueScore (0-10): 0=свеж, 10=измотан

ИГРОВОЙ СТИЛЬ — ДЕТАЛЬНО:
• Стиль: атакующий/защитный/универсальный
• Подача: % попадания 1-й, % побед на 1-й/2-й, эйсы/матч, двойные/матч
• Паттерны подачи: куда подаёт на deuce court (T/wide/body), на ad court
• Приём: позиция, % побед при приёме 1-й/2-й, % конвертации брейк-пойнтов
• Бэкхенд: одноручный/двуручный, сила/уязвимость
• Форхенд: оценка, RPM, победный удар или setup?
• Игра у сетки: как часто идёт, % побед
• Передвижение: первый шаг, охват, скольжение

ПОКРЫТИЯ — ДЕТАЛЬНО:
• Win% на hard/clay/grass/indoor (последние 2-3 года)
• Любимое покрытие и почему тактически
• Как конкретно играет на каждом покрытии

ПСИХОЛОГИЯ — ДЕТАЛЬНО:
• Win% в тай-брейках
• Win% в решающих сетах
• Как ведёт себя при 0:1 по сетам (камбэк или сдаётся)
• Рекорд в финалах / полуфиналах GS и M1000
• Поведение на матчболах и сетболах против него
• Психотип: боец, стабильный, нервный

ЛЮБИМЫЕ И НЕЛЮБИМЫЕ ТУРНИРЫ:
• Где стабильно побеждает / доходит до поздних стадий (конкретные турниры)
• Где стабильно уступает рано
• История именно на ЭТОМ турнире за карьеру

ДОПОЛНИТЕЛЬНЫЕ ФАКТОРЫ:
• Win% против левшей / правшей
• Против каких стилей игры проигрывает чаще
• Текущий тренер (имя, когда назначен, предыдущий тренер)
• Семья: супруга/партнёр, дети, недавние семейные события
• Психологическое состояние: интервью, заявления, мотивация
• Финансовая мотивация: защита очков, гонка за рейтингом, спонсорские бонусы

═══ БЛОК 3: ПРОТИВОСТОЯНИЕ (H2H) ═══
• Общий счёт W-L, все встречи: дата | турнир | покрытие | счёт | победитель
• H2H только на данном покрытии
• Тактическая динамика: кто доминирует в каких ситуациях

═══ БЛОК 4: КОНТЕКСТ И РЫНОК ═══
• Категория и важность турнира для каждого (защита очков, рейтинг, мотивация)
• Коэффициенты у ведущих букмекеров, имплицитные вероятности

Верни ТОЛЬКО JSON без markdown, точно по схеме:
${JSON_SCHEMA(player1, player2)}`;

    const response = await (openai as any).responses.create({
      model: "gpt-5.4",
      tools: [{ type: "web_search_preview" }],
      input,
      max_output_tokens: 10000,
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

  const prompt = `Ты — профессиональный теннисный скаут с 25-летним опытом работы в беттинг-синдикатах.
Составь ПОЛНОЕ ДОСЬЕ на матч ${player1} vs ${player2}.

${hints || "Параметры матча не указаны — определи наиболее вероятные по известным данным."}

ТРЕБОВАНИЯ (срез знаний — начало 2026, используй всё что знаешь):
• Биография, возраст, физический профиль каждого
• Рейтинг, пиковый рейтинг, карьерные титулы — с конкретными числами
• W-L на каждом покрытии (hard/clay/grass/indoor)
• Стиль игры в деталях: подача, приём, бэкхенд/форхенд, сетка, движение
• Психология: тай-брейки, решающие сеты, камбэки, большие матчи — все Win%
• Лучшие и худшие турниры в карьере
• История на этом конкретном турнире
• H2H: все матчи с датами и счётами
• Тренер, семья, известные события из личной жизни
• Мотивация: что поставлено на кон в этом матче
• Заполни КАЖДОЕ поле конкретными данными, не пиши "нет данных"

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
    age: "—",
    nationality: "—",
    currentRanking: "уточняется",
    careerHighRanking: "—",
    careerTitles: "—",
    recentForm: "анализируется",
    last10Matches: "анализируется",
    currentSeasonRecord: "—",
    recentTournaments: "анализируется",
    injuryStatus: "нет данных",
    physicalProfile: "—",
    fatigueScore: 0,
    fatigueReason: "нет данных",
    recentMatchLoad: "нет данных",
    playstyle: "анализируется",
    servingStats: "анализируется",
    servingPatterns: "—",
    returningStats: "анализируется",
    returningStyle: "—",
    netPlay: "—",
    backhandType: "—",
    forehandRating: "—",
    movementRating: "—",
    surfaceStats: "анализируется",
    surfacePreference: "анализируется",
    hardCourtGame: "—",
    clayCourtGame: "—",
    grassCourtGame: "—",
    indoorGame: "—",
    mentalProfile: "—",
    tiebreakRecord: "—",
    decidingSetRecord: "—",
    comebackAbility: "—",
    bigMatchRecord: "—",
    pressureHandling: "—",
    motivationState: "—",
    bestTournaments: "—",
    poorTournaments: "—",
    performanceAtThisTournament: "—",
    vsLeftHandedRecord: "—",
    vsBaseliners: "—",
    vsServeVolley: "—",
    vsHighBounce: "—",
    strengths: "анализируется",
    weaknesses: "анализируется",
    underPressureWeakness: "—",
    personalContext: "нет данных",
    coachInfo: "нет данных",
    teamDynamics: "—",
    financialMotivation: "—",
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

export function buildResearchContext(research: MatchResearch, dataSource: "web_search" | "ai_knowledge" = "ai_knowledge"): string {
  const p1 = research.player1;
  const p2 = research.player2;

  const sourceLabel = dataSource === "web_search"
    ? "🌐 ИСТОЧНИК: ЖИВОЙ ВЕБ-ПОИСК (данные актуальны на дату запроса)"
    : "🧠 ИСТОЧНИК: БАЗА ЗНАНИЙ AI (данные до начала 2026 — могут быть устаревшими!)";

  const sourceWarning = dataSource === "ai_knowledge"
    ? "\n⚠️  ВНИМАНИЕ АГЕНТАМ: данные из базы знаний AI. Травмы, форма, расписание — могут быть устаревшими.\n    Поля с '—' или 'НЕ НАЙДЕНО' = данных нет, НЕ додумывать!"
    : "\n✅ АГЕНТАМ: данные получены через живой поиск интернета. Поля 'НЕ НАЙДЕНО' = информация реально отсутствует в открытых источниках.";

  const fatigueLabel = (score: number) =>
    score <= 2 ? "🟢 свеж" : score <= 4 ? "🟡 умеренно устал" : score <= 6 ? "🟠 устал" : score <= 8 ? "🔴 сильно устал" : "🚨 критически измотан";

  const playerBlock = (p: PlayerResearch) => `
  ━━━ ДОСЬЕ: ${p.name.toUpperCase()} ━━━
  Возраст/гражданство: ${p.age} | ${p.nationality}
  Рейтинг: ${p.currentRanking} | Пиковый: ${p.careerHighRanking}
  Карьерные титулы: ${p.careerTitles}
  Рекорд сезона: ${p.currentSeasonRecord}
  Физический профиль: ${p.physicalProfile}

  📊 ФОРМА И РЕЗУЛЬТАТЫ
  Форма (2 мес): ${p.recentForm}
  Последние 10 матчей:
  ${p.last10Matches}
  Последние турниры: ${p.recentTournaments}

  🏥 ФИЗИЧЕСКОЕ СОСТОЯНИЕ
  Травмы: ${p.injuryStatus}
  Нагрузка: ${p.recentMatchLoad}
  ⚡ УСТАЛОСТЬ: ${p.fatigueScore}/10 (${fatigueLabel(p.fatigueScore)})
  Причина: ${p.fatigueReason}

  🎾 ИГРОВОЙ СТИЛЬ
  Стиль: ${p.playstyle}
  Подача: ${p.servingStats}
  Паттерны подачи: ${p.servingPatterns}
  Приём: ${p.returningStats}
  Стиль приёма: ${p.returningStyle}
  Игра у сетки: ${p.netPlay}
  Бэкхенд: ${p.backhandType}
  Форхенд: ${p.forehandRating}
  Передвижение: ${p.movementRating}

  🏟️ ПОКРЫТИЯ
  Win% по покрытиям: ${p.surfaceStats}
  Любимое покрытие: ${p.surfacePreference}
  На харде: ${p.hardCourtGame}
  На грунте: ${p.clayCourtGame}
  На траве: ${p.grassCourtGame}
  В зале: ${p.indoorGame}

  🧠 ПСИХОЛОГИЯ
  Психотип: ${p.mentalProfile}
  Тай-брейки: ${p.tiebreakRecord}
  Решающие сеты: ${p.decidingSetRecord}
  Камбэки (после потери сета): ${p.comebackAbility}
  В больших матчах (финалы/GS/vs Top-10): ${p.bigMatchRecord}
  Под давлением (BP/сетболы): ${p.pressureHandling}
  Мотивация сейчас: ${p.motivationState}
  Слабости под давлением: ${p.underPressureWeakness}

  🏆 ТУРНИРНАЯ ИСТОРИЯ
  Лучшие турниры: ${p.bestTournaments}
  Слабые турниры: ${p.poorTournaments}
  На ЭТОМ турнире: ${p.performanceAtThisTournament}

  🔄 ПРОТИВ РАЗНЫХ СТИЛЕЙ
  Vs левши: ${p.vsLeftHandedRecord}
  Vs базелайнеры: ${p.vsBaseliners}
  Vs атакующие/сетевики: ${p.vsServeVolley}
  Vs высокий топспин: ${p.vsHighBounce}

  ✅ СИЛЬНЫЕ СТОРОНЫ: ${p.strengths}
  ❌ СЛАБЫЕ СТОРОНЫ: ${p.weaknesses}

  👤 ЛИЧНЫЙ КОНТЕКСТ
  Тренер: ${p.coachInfo}
  Команда: ${p.teamDynamics}
  Личная жизнь: ${p.personalContext}
  Финансовая мотивация: ${p.financialMotivation}`;

  return `
${sourceLabel}${sourceWarning}

╔══════════════════════════════════════════════════════╗
║         ПОЛНЫЙ ДОСЬЕ-БРИФИНГ ДЛЯ СОВЕЩАНИЯ          ║
╚══════════════════════════════════════════════════════╝

📍 МАТЧ
  Турнир: ${research.detectedTournament}
  Покрытие: ${research.detectedSurface}
  Дата: ${research.detectedDate}  |  Стадия: ${research.detectedRound}
  Локация: ${research.detectedLocation}
  Условия: ${research.detectedConditions}

${playerBlock(p1)}

${playerBlock(p2)}

⚔️ H2H — ЛИЧНЫЕ ВСТРЕЧИ
  Общий счёт: ${research.h2hHistory}

  На этом покрытии:
  ${research.h2hOnSurface}

  Тактическая динамика:
  ${"h2hStyleDynamic" in research ? (research as any).h2hStyleDynamic : "—"}

🏟️ КОНТЕКСТ ТУРНИРА
  ${research.tournamentContext}

📈 РЫНОЧНЫЙ АНАЛИЗ
  ${research.marketAnalysis}

🔑 КЛЮЧЕВЫЕ ФАКТОРЫ МАТЧА
  ${research.keyFactors}

══════════════════════════════════════════════════════`.trim();
}

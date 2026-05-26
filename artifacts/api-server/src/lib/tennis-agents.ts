/**
 * ЭКОНОМИЧНАЯ АРХИТЕКТУРА (≤2 руб / прогноз):
 *  Один комбинированный вызов GPT-4o-mini ($0.15/M in, $0.60/M out)
 *  с тремя секциями [ВИКТОР]/[СЕРЖ]/[МАРИНА] + [СТАВКИ] JSON.
 *  Веб-поиск: DuckDuckGo бесплатно (7 запросов через tennis-research.ts).
 *  Итого: ~$0.005 ≈ 0.45 руб за один прогноз.
 */
import { openai } from "@workspace/integrations-openai-ai-server";
import { textToSpeech } from "@workspace/integrations-openai-ai-server/audio";
import { logger } from "../lib/logger";
import { researchMatch, buildResearchContext, type MatchResearch } from "./tennis-research";
import { computeMLAdjustment } from "./tennis-ml";

export interface AgentMessage {
  agent: string;
  agentLabel: string;
  content: string;
  isReply?: boolean;
  provider: string;
}

export interface BettingRecommendation {
  type: "outcome" | "total" | "handicap" | "express";
  description: string;
  odds: number;
  bankPercent: number;
  confidencePercent: number;
}

export interface MatchData {
  player1: string;
  player2: string;
  tournament?: string;
  surface?: string;
  matchDate?: string;
  odds?: Record<string, unknown>;
  forceRefresh?: boolean;
}

export type SSESendFn = (data: object) => void;

const AGENTS = [
  {
    agent: "stats_expert",
    agentLabel: "Виктор · Статистик",
    provider: "Google Gemini",
    providerModel: "gemini-3.1-pro-preview",
    emoji: "📊",
  },
  {
    agent: "odds_strategist",
    agentLabel: "Серж · Беттор",
    provider: "Anthropic Claude",
    providerModel: "claude-opus-4-7",
    emoji: "💰",
  },
  {
    agent: "context_expert",
    agentLabel: "Марина · Инсайдер",
    provider: "OpenAI GPT",
    providerModel: "gpt-5.4",
    emoji: "🧠",
  },
];

function buildSystemPrompt(
  agent: string,
  match: MatchData,
  researchContext: string,
  mlContext: string,
): string {
  const base = `ЗАКРЫТОЕ СОВЕЩАНИЕ ТРЁХ НЕЗАВИСИМЫХ ЭКСПЕРТОВ ПО ТЕННИСНОМУ БЕТТИНГУ.

Матч: ${match.player1} vs ${match.player2}${match.tournament ? ` | ${match.tournament}` : ""}${match.surface ? ` | ${match.surface}` : ""}

╔══════════════════════════════════════════════════════════╗
║  ЖЕЛЕЗНЫЕ ПРАВИЛА — НАРУШЕНИЕ = ПОТЕРЯ ДЕНЕГ КЛИЕНТА   ║
╠══════════════════════════════════════════════════════════╣
║  1. ТОЛЬКО БРИФИНГ. Никакой "памяти", никаких           ║
║     домыслов. Каждый факт — из брифинга ниже.           ║
║  2. ПОЛЕ "—" или "НЕ НАЙДЕНО" в брифинге =              ║
║     говори "данных нет" вслух. НЕ придумывай цифры.     ║
║  3. НАЗЫВАЙ ИСТОЧНИК: "по данным брифинга: [факт]"      ║
║     Не говори вещи которых нет в брифинге.              ║
║  4. Усталость ≥7/10 или травма = красный флаг,          ║
║     снижай уверенность прямо в тексте.                  ║
║  5. Если не хватает данных для вывода — скажи об этом   ║
║     явно: "недостаточно данных по [аспект]".            ║
║  6. Без вводных фраз, без воды. Только факты + выводы.  ║
╚══════════════════════════════════════════════════════════╝

${mlContext ? `📊 ИСТОРИЯ НАШИХ ПРОГНОЗОВ (ML-система):\n${mlContext}\n` : ""}

═══ БРИФИНГ — ВЕРИФИЦИРОВАННЫЕ ДАННЫЕ ═══
${researchContext}
═══════════════════════════════════════════

ЛИНИЯ БУКМЕКЕРОВ: ${match.odds ? JSON.stringify(match.odds) : "коэффициенты не загружены"}`;

  const roleSpecific: Record<string, string> = {

    stats_expert: `
═══════════════════════════════════════════
РОЛЬ: ВИКТОР — СТАТИСТИЧЕСКИЙ АНАЛИТИК
Провайдер: Google Gemini | Специализация: количественный анализ теннисных данных
═══════════════════════════════════════════

Ты — Виктор, бывший аналитик данных ATP-тура, 20 лет строил вероятностные модели для профессиональных беттинг-синдикатов. Ты разговариваешь как эксперт на закрытом совещании — называешь вещи своими именами, без «полей» и «параметров».

КАК ТЫ ГОВОРИШЬ (примеры речи настоящего аналитика):
— "Надаль — левша, и его форхенд кросс-корт бьёт прямо в бэкхенд правши — это ловушка."
— "На грунте у него 81% побед, а у соперника 59% — это пропасть на этом покрытии."
— "Его двуручный бэкхенд держит высокий топспин нормально, а вот одноручник Тима — вопрос."
— "Три матча за пять дней, один из них трёхсетовый — в третьем сете подача просядет."

ЧТО АНАЛИЗИРУЕШЬ (говори это своими словами, не списком):

• ТАКТИЧЕСКИЙ МАТЧАП: кто правша, кто левша, как это меняет розыгрыши. Чей форхенд бьёт в слабую руку соперника. Кто агрессор, кто будет защищаться. Как столкнутся стили — например, агрессор против защитника, или два базелайнера.

• ОРУЖИЕ И УЯЗВИМОСТИ: у кого подача — оружие (куда бьёт, flat/kick/slice), у кого она слабое место. Чей бэкхенд сломается под высоким топспином. Кто у сетки — профи или теряется.

• ПОКРЫТИЕ: кто здесь в своей стихии и ПОЧЕМУ — тактически (скольжение, скорость мяча, отскок под бэкхенд). Win% на этом покрытии с цифрами.

• ПОДАЧА И ПРИЁМ: конкретные цифры. Кто выиграет геймы на своей подаче, у кого есть шанс на брейки.

• H2H: не просто счёт — кто доминировал тактически, на каком покрытии, почему.

• УСТАЛОСТЬ: точный fatigueScore. Что конкретно просядет — подача, первый шаг, ошибки в 3-м сете.

• ИТОГ: вероятность победы каждого в % с обоснованием. Два фактора, которые решат матч.

Открывай совещание первым. Говори живо, как эксперт коллегам — не докладчик аудитории. Максимум 270 слов. Заканчивай острым вопросом Сержу о линии.`,

    odds_strategist: `
═══════════════════════════════════════════
РОЛЬ: СЕРЖ — ПРОФЕССИОНАЛЬНЫЙ ШАРП / БЕТТИНГ-СТРАТЕГ
Провайдер: Anthropic Claude | Специализация: беттинг-рынки, поиск value, управление банком
═══════════════════════════════════════════

Ты — Серж, профессиональный шарп с 15 годами в беттинг-синдикатах. Тебя банят в половине букмекеров. Ты видишь ошибки рынка — и умеешь переводить тактический матчап в конкретные ставки.

КАК ТЫ ГОВОРИШЬ (примеры):
— "Рынок не учёл что он левша — против правшей у него +8% к win rate на грунте."
— "Его kick-подача на высоте 800м над уровнем моря даст на 30% больше отскока — рынок это игнорирует."
— "Агрессор против защитника на медленном грунте — это длинные розыгрыши, тоталы вверх."

ЧТО ДЕЛАЕШЬ:

• ТАКТИКА → РЫНОК: берёшь наблюдения Виктора (левша/правша, стиль, оружие, покрытие) и переводишь в конкретный беттинг-edge. Где рынок не учёл тактические нюансы?

• КОЭФФИЦИЕНТЫ: переводи в имплицитную вероятность (маржа ~5%). КФ 1.75 = ~54% реальная. Сравниваешь с вероятностью Виктора.

• РЫНКИ КРОМЕ ПОБЕДИТЕЛЯ: тоталы геймов (длинные розыгрыши = больше геймов?), гандикап сетов, тотал 1-го сета — где рынок слабее всего?

• КОРРЕКТИРОВКА НА РИСКИ: усталость, травма, левша vs правша на конкретном покрытии — всё это двигает вероятность. Если Виктор дал 68%, а усталость 8/10 — корректируй до 58-62%.

• КОНКРЕТНЫЕ СТАВКИ (2-3 позиции):
  "Рынок [название] @ КФ [x.xx] | Наша вероятность [Y%] vs имплицитная [Z%] | Edge: +[N%] | Размер: [1-4]% банка"

• ОСТРЫЙ ВОПРОС Марине: про психологию, голову или физику — то что влияет на твои edge-расчёты.

Реагируй прямо на тезисы Виктора — подхватывай его тактические выводы и монетизируй их. Максимум 270 слов.`,

    context_expert: `
═══════════════════════════════════════════
РОЛЬ: МАРИНА — ИНСАЙДЕР / ПСИХОЛОГ / ФИЗИОТЕРАПЕВТ
Провайдер: OpenAI GPT | Специализация: психология, физика, личный контекст игроков
═══════════════════════════════════════════

Ты — Марина, бывший физиотерапевт WTA-тура и спортивный психолог, 10+ лет с Top-50. Ты знаешь игроков изнутри — как тело реагирует на усталость, как голова ломается под давлением, что происходит за кулисами.

КАК ТЫ ГОВОРИШЬ (примеры):
— "Его одноручный бэкхенд — это красиво, но когда он устаёт, амплитуда замаха сокращается и мяч летит в сетку."
— "Левша с kick-подачей в 3-м сете на ad court — это nightmare для правши с двуручником, потому что мяч уходит за плечо."
— "Он агрессор, но когда проигрывает первый сет — перестаёт идти к сетке и начинает ждать ошибки. Это не его игра."
— "После смены тренера три месяца назад — паттерны подачи поменялись, он ещё не устаканился."

ЧТО АНАЛИЗИРУЕШЬ:

• ФИЗИКА И УСТАЛОСТЬ: как конкретно усталость ломает технику ЭТОГО игрока. Его доминантный удар — форхенд? При усталости он начнёт срезать замах. Подача — kick? В 3-м сете потеряет вращение. Движение главное? Первый шаг замедлится на 15-20%.

• ТАКТИЧЕСКИЙ ПСИХОТИП: агрессор под давлением — продолжает атаковать или сжимается? Защитник когда горит — поднимается или уходит в себя? История решающих сетов, тай-брейков говорит о характере.

• РУКА И ПСИХОЛОГИЯ: как левша влияет на голову соперника — непривычные углы, нестандартная подача на ad court. Кто из них имеет опыт против левшей, кто теряется.

• ЭТОТ ТУРНИР, ЭТА СТАДИЯ: как конкретно ведёт себя каждый в этих условиях исторически. Есть проклятые четвертьфиналы? Финалы даются?

• ЛИЧНЫЙ КОНТЕКСТ: тренер, семья, события — как это реально влияет на концентрацию во время матча.

• ВЕРДИКТ по ставкам Сержа:
  ✅ СТАВИТЬ | ⚠️ С ОСТОРОЖНОСТЬЮ | 🚫 ПРОПУСТИТЬ — с конкретным обоснованием

• КЭШАУТ-ТРИГГЕР: при каком счёте фиксировать.

Отвечай на вопрос Сержа напрямую. Говори как эксперт коллегам, не читай лекцию. Максимум 290 слов.`,
  };

  return base + "\n\n" + (roleSpecific[agent] ?? "");
}

// ── Section definitions for combined single-call parsing ──────────────────────
interface AgentSection {
  agent: string;
  agentLabel: string;
  openTag: string;
  closeTag: string;
}

const AGENT_SECTIONS: AgentSection[] = [
  { agent: "stats_expert",    agentLabel: "Виктор · Статистик",  openTag: "[ВИКТОР]",  closeTag: "[/ВИКТОР]"  },
  { agent: "odds_strategist", agentLabel: "Серж · Беттор-шарп",  openTag: "[СЕРЖ]",    closeTag: "[/СЕРЖ]"    },
  { agent: "context_expert",  agentLabel: "Марина · Инсайдер",   openTag: "[МАРИНА]",  closeTag: "[/МАРИНА]"  },
];

// ── Single combined GPT-4o-mini call (replaces 6 expensive rounds) ────────────
async function runCombinedAgents(
  match: MatchData,
  researchContext: string,
  mlContextText: string,
  send: SSESendFn,
): Promise<{
  dialogue: AgentMessage[];
  recommendations: BettingRecommendation[];
  vote: string;
  riskNotes: string;
  cashoutAdvice: string;
}> {
  const startMs = Date.now();

  const systemPrompt = `Ты — закрытое совещание трёх профессиональных теннисных аналитиков. Каждый анализирует матч со своей специализации. Говори как живой эксперт коллегам — конкретные цифры, живая речь, никаких шаблонных фраз.

ВИКТОР — статистик и тактик (📊): рейтинг, форма, H2H, покрытие, матчап, вероятности победы в %.
СЕРЖ — беттор-шарп (💹): edge у букмекеров, конкретные ставки с KF и % банка.
МАРИНА — психолог и физиотерапевт (🧠): усталость, психотип, личный контекст, вердикт по ставкам Сержа (✅⚠️🚫), кэшаут-триггер.

СТРОГИЙ ФОРМАТ (теги ОБЯЗАТЕЛЬНЫ, никаких отклонений):

[ВИКТОР]
...Виктор говорит 120-150 слов: ключевая статистика, вероятности...
[/ВИКТОР]

[СЕРЖ]
...Серж говорит 120-150 слов: ставки с KF и % банка...
[/СЕРЖ]

[МАРИНА]
...Марина говорит 120-150 слов: физика, психология, вердикт по ставкам...
[/МАРИНА]

[СТАВКИ]
[{"type":"outcome","description":"...","odds":1.85,"bankPercent":3,"confidencePercent":82},{"type":"total","description":"...","odds":1.90,"bankPercent":2,"confidencePercent":76},{"type":"handicap","description":"...","odds":1.75,"bankPercent":1,"confidencePercent":70}]
[/СТАВКИ]

ВАЖНО: секция [СТАВКИ] ОБЯЗАТЕЛЬНА — без неё ответ неполный. Всегда минимум 2 ставки.`;

  const userPrompt = `Матч: ${match.player1} vs ${match.player2}${match.tournament ? ` | ${match.tournament}` : ""}${match.surface ? ` | покрытие: ${match.surface}` : ""}${match.matchDate ? ` | дата: ${match.matchDate}` : ""}
ML-коррекция истории ставок: ${mlContextText || "данных нет"}

${researchContext}`;

  const stream = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    max_tokens: 4096,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user",   content: userPrompt },
    ],
    stream: true,
  });

  let accumulated = "";
  let emittedUpTo = 0;
  let activeSectionIdx = -1;
  let activeSectionContent = "";
  const dialogue: AgentMessage[] = [];
  let betsJson = "";

  function processBuffer(): void {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      if (activeSectionIdx === -1) {
        let found = false;
        for (let i = 0; i < AGENT_SECTIONS.length; i++) {
          const tag = AGENT_SECTIONS[i].openTag;
          const idx = accumulated.indexOf(tag, Math.max(0, emittedUpTo - tag.length));
          if (idx !== -1) {
            emittedUpTo = idx + tag.length;
            activeSectionIdx = i;
            activeSectionContent = "";
            const sec = AGENT_SECTIONS[i];
            send({ type: "agent_start", agent: sec.agent, agentLabel: sec.agentLabel, provider: "OpenAI GPT", providerModel: "gpt-4o-mini", isReply: false });
            found = true;
            break;
          }
        }
        const betsOpenIdx = accumulated.indexOf("[СТАВКИ]", Math.max(0, emittedUpTo - 8));
        if (!found && betsOpenIdx !== -1) {
          emittedUpTo = betsOpenIdx + "[СТАВКИ]".length;
          activeSectionIdx = 99;
          found = true;
        }
        if (!found) break;
      }

      if (activeSectionIdx >= 0 && activeSectionIdx < AGENT_SECTIONS.length) {
        const sec = AGENT_SECTIONS[activeSectionIdx];
        const closeIdx = accumulated.indexOf(sec.closeTag, emittedUpTo);
        if (closeIdx !== -1) {
          const content = accumulated.slice(emittedUpTo, closeIdx);
          if (content) {
            send({ type: "agent_chunk", agent: sec.agent, content });
            activeSectionContent += content;
          }
          const trimmed = activeSectionContent.trim();
          dialogue.push({ agent: sec.agent, agentLabel: sec.agentLabel, content: trimmed, isReply: false, provider: "OpenAI GPT-4o-mini" });
          send({ type: "agent_done", agent: sec.agent, fullContent: trimmed, agentLabel: sec.agentLabel });
          emittedUpTo = closeIdx + sec.closeTag.length;
          activeSectionIdx = -1;
          activeSectionContent = "";
        } else {
          const safeUpTo = accumulated.length - sec.closeTag.length;
          if (safeUpTo > emittedUpTo) {
            const chunk = accumulated.slice(emittedUpTo, safeUpTo);
            if (chunk) {
              send({ type: "agent_chunk", agent: sec.agent, content: chunk });
              activeSectionContent += chunk;
            }
            emittedUpTo = safeUpTo;
          }
          break;
        }
      } else if (activeSectionIdx === 99) {
        const closeIdx = accumulated.indexOf("[/СТАВКИ]", emittedUpTo);
        if (closeIdx !== -1) {
          betsJson = accumulated.slice(emittedUpTo, closeIdx).trim();
          emittedUpTo = closeIdx + "[/СТАВКИ]".length;
          activeSectionIdx = -2;
          break;
        } else {
          break;
        }
      } else {
        break;
      }
    }
  }

  for await (const chunk of stream) {
    const text = chunk.choices[0]?.delta?.content ?? "";
    if (!text) continue;
    accumulated += text;
    processBuffer();
  }
  processBuffer();

  // Parse [СТАВКИ] JSON — with progressively relaxed fallbacks
  let recommendations: BettingRecommendation[] = [];
  const jsonSources = [betsJson, accumulated].filter(Boolean);
  outer: for (const src of jsonSources) {
    // 1. Direct parse
    try { recommendations = JSON.parse(src) as BettingRecommendation[]; if (recommendations.length) break outer; } catch { /* next */ }
    // 2. Extract first [...] block
    const m = src.match(/\[[\s\S]*?\]/g);
    if (m) {
      for (const candidate of m) {
        try { const parsed = JSON.parse(candidate); if (Array.isArray(parsed) && parsed.length) { recommendations = parsed; break outer; } } catch { /* next */ }
      }
    }
  }

  const durationMs = Date.now() - startMs;
  const estInTokens  = Math.ceil((systemPrompt.length + userPrompt.length) / 3.8);
  const estOutTokens = Math.ceil(accumulated.length / 3.8);
  const costUsd = (estInTokens * 0.15 + estOutTokens * 0.60) / 1_000_000;
  const costRub = costUsd * 90;
  logger.info({ player1: match.player1, player2: match.player2, estInTokens, estOutTokens, costUsd: `$${costUsd.toFixed(5)}`, costRub: `${costRub.toFixed(2)} руб`, durationMs: `${durationMs}ms`, model: "gpt-4o-mini" }, "💰 COST LOG agents");
  send({ type: "cost_log", phase: "agents", costUsd, costRub, durationMs, model: "gpt-4o-mini" });

  const avg = recommendations.length > 0
    ? recommendations.reduce((s, r) => s + r.confidencePercent, 0) / recommendations.length : 0;
  const vote = avg >= 82 ? "unanimous" : "disputed";
  const allText = dialogue.map(d => d.content).join(" ");
  const riskNotes = extractByKeywords(allText, ["риск", "осторожно", "опасность", "нестабил", "травм", "устал", "семей", "тренер"]);
  const cashoutAdvice = extractByKeywords(allText, ["кэшаут", "cashout", "зафиксир", "при счёте", "выйти"]);

  return { dialogue, recommendations, vote, riskNotes, cashoutAdvice };
}

// ── Main entry point ──────────────────────────────────────────────────────────
export async function runTennisAgents(
  match: MatchData,
  send: SSESendFn,
): Promise<{
  dialogue: AgentMessage[];
  recommendations: BettingRecommendation[];
  vote: string;
  riskNotes: string;
  cashoutAdvice: string;
  research: MatchResearch;
  fatigueScore1: number;
  fatigueScore2: number;
  mlAdjustment: number;
}> {
  // Phase 1: Deep research with optional force refresh
  const { research, usedWebSearch } = await researchMatch(
    match.player1, match.player2, match.tournament, match.surface, send, match.matchDate, match.forceRefresh,
  );
  const researchContext = buildResearchContext(research, usedWebSearch ? "web_search" : "ai_knowledge");
  send({ type: "research_complete", usedWebSearch, context: researchContext });

  // Phase 1b: ML adjustment from history
  const ml = await computeMLAdjustment(research.detectedSurface || match.surface);
  if (ml.sampleSize > 0) {
    send({ type: "ml_adjustment", adjustment: ml.adjustment, sampleSize: ml.sampleSize, sampleAccuracy: ml.sampleAccuracy });
  }

  // Phase 2: Single combined GPT-4o-mini call (all three agents in one request)
  // Cost: ~$0.003 vs old ~$0.48 with 6 rounds of Claude+Gemini+GPT
  send({ type: "research_progress", message: "🤝 Совещание экспертов (GPT-4o-mini, 1 запрос)..." });
  const { dialogue, recommendations: rawRecs, vote, riskNotes, cashoutAdvice } = await runCombinedAgents(
    match, researchContext, ml.contextText, send,
  );

  // Apply ML adjustment from betting history
  let recommendations = rawRecs;
  if (ml.adjustment !== 0 && recommendations.length > 0) {
    recommendations = recommendations.map(r => ({
      ...r,
      confidencePercent: Math.max(50, Math.min(97, r.confidencePercent + ml.adjustment)),
    }));
  }

  const avg = recommendations.length > 0
    ? recommendations.reduce((s, r) => s + r.confidencePercent, 0) / recommendations.length : 0;

  send({ type: "generating_recommendations" });
  send({ type: "recommendations", data: recommendations });
  send({ type: "vote", vote, avgConfidence: Math.round(avg) });

  return {
    dialogue,
    recommendations,
    vote,
    riskNotes,
    cashoutAdvice,
    research,
    fatigueScore1: research.player1.fatigueScore,
    fatigueScore2: research.player2.fatigueScore,
    mlAdjustment: ml.adjustment,
  };
}

function extractByKeywords(text: string, keywords: string[]): string {
  const sentences = text.split(/(?<=[.!?])\s+/);
  return sentences.filter(s => keywords.some(kw => s.toLowerCase().includes(kw))).slice(0, 3).join(" ").trim();
}

export async function generatePodcastAudio(dialogue: AgentMessage[]): Promise<Buffer> {
  const dialogueSummary = dialogue.map(msg => {
    const info = AGENTS.find(a => a.agent === msg.agent);
    const label = info?.agentLabel ?? msg.agentLabel;
    const excerpt = msg.content.slice(0, 250).replace(/\n+/g, " ").trim();
    return `${label}: ${excerpt}`;
  }).join(". ");

  const scriptResp = await openai.chat.completions.create({
    model: "gpt-5.4",
    max_completion_tokens: 600,
    messages: [
      {
        role: "system",
        content: `Ты — радиоведущий подкаста "Tennis Analyst AI PRO".
Напиши короткий (300-400 слов) аудиоскрипт для подкаста на основе аналитического совещания трёх AI-агентов.
Скрипт должен быть живым, энергичным, на русском языке. Структура:
1. Приветствие (2 предложения)
2. Ключевые тезисы каждого эксперта — включая данные об усталости и личном контексте (1-2 предложения на каждого)
3. Главная рекомендация по ставке с коэффициентом и % банка
4. Предупреждение о рисках (если есть)
5. Прощание (1 предложение)
Не используй заголовки и маркеры — только живая речь.`,
      },
      {
        role: "user",
        content: `Совещание аналитиков:\n${dialogueSummary}`,
      },
    ],
  });

  const podcastScript = scriptResp.choices[0]?.message?.content ?? "Добро пожаловать в Tennis Analyst AI PRO Podcast. Наши три эксперта провели глубокий анализ. Ставьте ответственно.";

  return await textToSpeech(podcastScript, "alloy", "wav");
}

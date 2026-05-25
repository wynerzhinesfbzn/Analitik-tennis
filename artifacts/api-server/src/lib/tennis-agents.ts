/**
 * Three agents, three different AI providers:
 *  📊 Аналитик Статистики  → Google Gemini  (gemini-3.1-pro-preview)
 *  💰 Беттинг-стратег      → Anthropic Claude (claude-opus-4-7)
 *  🧠 Контекстный эксперт  → OpenAI GPT      (gpt-5.4)
 */
import { openai } from "@workspace/integrations-openai-ai-server";
import { textToSpeech } from "@workspace/integrations-openai-ai-server/audio";
import { anthropic } from "@workspace/integrations-anthropic-ai";
import { ai as gemini } from "@workspace/integrations-gemini-ai";
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

АБСОЛЮТНЫЕ ПРАВИЛА:
1. Опирайся ИСКЛЮЧИТЕЛЬНО на факты из брифинга. Никаких домыслов и галлюцинаций.
2. Каждый тезис — либо цифра из брифинга, либо явный логический вывод из неё.
3. Ты НЕ повторяешь то, что уже сказали коллеги — только развиваешь или оспариваешь.
4. Усталость ≥7/10 — красный флаг. Явная травма — считай ставку недоступной.
5. Говори жёстко, прямо, как профессионал — без вводных фраз, без воды.

${mlContext ? `ИСТОРИЯ НАШИХ ПРОГНОЗОВ (ML):\n${mlContext}\n` : ""}

БРИФИНГ (актуальные данные):
${researchContext}

ЛИНИЯ БУКМЕКЕРОВ: ${match.odds ? JSON.stringify(match.odds) : "коэффициенты не загружены"}`;

  const roleSpecific: Record<string, string> = {

    stats_expert: `
═══════════════════════════════════════════
РОЛЬ: ВИКТОР — СТАТИСТИЧЕСКИЙ АНАЛИТИК
Провайдер: Google Gemini | Специализация: количественный анализ теннисных данных
═══════════════════════════════════════════

Ты — Виктор, бывший аналитик данных ATP-тура, 20 лет строил вероятностные модели для профессиональных беттинг-синдикатов. Ты мыслишь числами. Для тебя матч — это набор измеримых переменных.

ЧТО ТЫ ДЕЛАЕШЬ (строго по брифингу):

1. ПОДАЧА: % попадания 1-го мяча, % выигрыша на 1-м мяче, % выигрыша на 2-м мяче, эйсы, двойные. Кто из двоих подаёт агрессивнее на этом покрытии?

2. ПРИЁМ: % выигрыша при приёме на 1-м мяче, % конвертации брейк-пойнтов. Кто лучше читает подачу соперника?

3. ПОКРЫТИЕ: Win% каждого на данном типе покрытия за последние 2 года. Кто в своей стихии?

4. H2H: сколько матчей, на каких покрытиях, при каком счёте заканчивались, есть ли психологическое доминирование.

5. УСТАЛОСТЬ (из брифинга): называй точный fatigueScore каждого. Объясняй механику: усталость 7+/10 = падение % первой подачи в 3-м сете, рост двойных ошибок, потеря взрывных качеств на задней линии.

6. ИТОГ: вероятность победы каждого в %, с обоснованием через конкретные метрики.

7. Выдели 2 ключевых статистических фактора, которые РЕШАТ этот матч.

Открывай совещание первым. Начни с фразы вида "Смотрим на цифры по [Игрок1] vs [Игрок2]." Максимум 250 слов. Заканчивай вопросом к Сержу — что рынок говорит по этим вероятностям.`,

    odds_strategist: `
═══════════════════════════════════════════
РОЛЬ: СЕРЖ — ПРОФЕССИОНАЛЬНЫЙ БЕТTOR / ЛИНЕЙНЫЙ АНАЛИТИК
Провайдер: Anthropic Claude | Специализация: беттинг-рынки, поиск value, управление банком
═══════════════════════════════════════════

Ты — Серж, профессиональный шарп с 15 годами работы в беттинг-синдикатах. Тебя банят в половине букмекеров планеты. Ты живёшь в мире closing line value, азиатских гандикапов, движения линий. Твоя работа — найти где букмекер ошибся.

ЧТО ТЫ ДЕЛАЕШЬ:

1. КОНВЕРТАЦИЯ КОЭФФИЦИЕНТОВ: переводи линию в имплицитную вероятность (с учётом маржи букмекера ~5-6%). Пример: "КФ 1.75 = 57% имплицитная вероятность за вычетом маржи ~54% реальная."

2. ПОИСК VALUE: сравниваешь реальную вероятность Виктора с имплицитной. Разница ≥5% в пользу игрока = value bet. Разница ≥3% = смотреть внимательно.

3. РЫНКИ: не только победитель матча. Анализируй тоталы геймов (больше/меньше), гандикап по сетам, тоталы первого сета. Где рынок тупее всего?

4. КРАСНЫЕ ФЛАГИ: травма, усталость 7+/10, смена тренера, семейные проблемы — всё это двигает реальную вероятность вниз. Если Виктор дал 68% победы, а у игрока усталость 8/10 — ты корректируешь до 58-62% и пересчитываешь value.

5. КОНКРЕТНЫЕ СТАВКИ: предлагай 2-3 позиции с форматом:
   "Рынок [название] @ КФ [x.xx] | Наша вероятность [Y%] vs имплицитная [Z%] | Edge: +[N%] | Размер: [1-4]% банка"

6. ЗАДАЙ ОДИН острый вопрос Марине — про психологию или личный контекст игрока.

Реагируй напрямую на тезисы Виктора. Максимум 260 слов.`,

    context_expert: `
═══════════════════════════════════════════
РОЛЬ: МАРИНА — ИНСАЙДЕР / ЭКСПЕРТ ПО ИГРОКАМ
Провайдер: OpenAI GPT | Специализация: психология игроков, физическое состояние, инсайдерский контекст
═══════════════════════════════════════════

Ты — Марина, бывший физиотерапевт WTA-тура и спортивный психолог, работала с Top-50 более 10 лет. Знаешь каждого игрока изнутри: как они готовятся, как реагируют на давление, что происходит вне корта. Ты видишь то, чего нет в официальной статистике.

ЧТО ТЫ ДЕЛАЕШЬ:

1. ФИЗИЧЕСКОЕ СОСТОЯНИЕ: расшифровывай ustalost из брифинга как медицинский эксперт.
   - 7+/10: высокая вероятность укорочения амплитуды подачи, провалы во 2-3 сете, риск мышечных судорог.
   - 5-6/10: снижение первого шага, замедление реакции на сетбол, тай-брейки становятся лотереей.
   - Называй КОНКРЕТНЫЕ последствия для тактики игрока.

2. ПСИХОЛОГИЧЕСКИЙ ПРОФИЛЬ: 
   - Как этот игрок исторически ведёт себя в этом турнире / на этой стадии?
   - Кто "матч-плеер", а кто теряется под давлением?
   - Есть ли история "упускания матчей" (3-й сет, тай-брейки решающего сета)?
   - Смена тренера: новая тактика = нестабильность первые 3-4 турнира.

3. ЛИЧНЫЙ КОНТЕКСТ (из брифинга): семья, публичные заявления, соцсети, события вокруг турнира. Как это реально влияет на голову игрока во время матча?

4. ОТВЕТ НА СТАВКИ СЕРЖА: есть ли психологический/физический риск в его позициях, который он не учёл? Подтверждай или снижай его оценку edge.

5. ФИНАЛЬНЫЙ ВЕРДИКТ по каждой ставке Сержа:
   ✅ СТАВИТЬ — данные согласованы, нет скрытых рисков
   ⚠️ С ОСТОРОЖНОСТЬЮ — есть 1-2 неопределённых фактора
   🚫 ПРОПУСТИТЬ — слишком много психологических/физических неизвестных

6. КЭШАУТ-ТРИГГЕР: при каком счёте в матче фиксировать прибыль.

Отвечай на вопрос Сержа. Реагируй на тезисы обоих коллег. Максимум 280 слов.`,
  };

  return base + "\n\n" + (roleSpecific[agent] ?? "");
}

// ── Gemini streaming ──────────────────────────────────────────────────────────
async function callGemini(systemPrompt: string, userPrompt: string, send: SSESendFn, agentKey: string): Promise<string> {
  const stream = await gemini.models.generateContentStream({
    model: "gemini-3.1-pro-preview",
    config: { maxOutputTokens: 8192, systemInstruction: systemPrompt },
    contents: [{ role: "user", parts: [{ text: userPrompt }] }],
  });

  let full = "";
  for await (const chunk of stream) {
    const text = chunk.text ?? "";
    if (text) {
      full += text;
      send({ type: "agent_chunk", agent: agentKey, content: text });
    }
  }
  return full;
}

// ── Anthropic streaming ───────────────────────────────────────────────────────
async function callClaude(systemPrompt: string, userPrompt: string, send: SSESendFn, agentKey: string): Promise<string> {
  const stream = anthropic.messages.stream({
    model: "claude-opus-4-7",
    max_tokens: 8192,
    system: systemPrompt,
    messages: [{ role: "user", content: userPrompt }],
  });

  let full = "";
  for await (const event of stream) {
    if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
      const text = event.delta.text;
      full += text;
      send({ type: "agent_chunk", agent: agentKey, content: text });
    }
  }
  return full;
}

// ── OpenAI streaming ──────────────────────────────────────────────────────────
async function callGPT(systemPrompt: string, userPrompt: string, send: SSESendFn, agentKey: string): Promise<string> {
  const stream = await openai.chat.completions.create({
    model: "gpt-5.4",
    max_completion_tokens: 8192,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user",   content: userPrompt },
    ],
    stream: true,
  });

  let full = "";
  for await (const chunk of stream) {
    const text = chunk.choices[0]?.delta?.content ?? "";
    if (text) {
      full += text;
      send({ type: "agent_chunk", agent: agentKey, content: text });
    }
  }
  return full;
}

// ── Route each agent to its provider ─────────────────────────────────────────
async function callAgent(
  agentKey: string,
  systemPrompt: string,
  userPrompt: string,
  send: SSESendFn,
): Promise<string> {
  switch (agentKey) {
    case "stats_expert":    return callGemini(systemPrompt, userPrompt, send, agentKey);
    case "odds_strategist": return callClaude(systemPrompt, userPrompt, send, agentKey);
    case "context_expert":  return callGPT(systemPrompt, userPrompt, send, agentKey);
    default:                return callGPT(systemPrompt, userPrompt, send, agentKey);
  }
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
  const researchContext = buildResearchContext(research);
  send({ type: "research_complete", usedWebSearch, context: researchContext });

  // Phase 1b: ML adjustment from history
  const ml = await computeMLAdjustment(research.detectedSurface || match.surface);
  if (ml.sampleSize > 0) {
    send({ type: "ml_adjustment", adjustment: ml.adjustment, sampleSize: ml.sampleSize, sampleAccuracy: ml.sampleAccuracy });
  }

  // Phase 2: Dialogue (5 turns)
  const dialogue: AgentMessage[] = [];

  const rounds: Array<{ agentIndex: number; isReply?: boolean }> = [
    { agentIndex: 0 },
    { agentIndex: 1 },
    { agentIndex: 2 },
    { agentIndex: 0, isReply: true },
    { agentIndex: 1, isReply: true },
  ];

  for (const round of rounds) {
    const { agentIndex, isReply } = round;
    const agentInfo = AGENTS[agentIndex];

    send({
      type: "agent_start",
      agent: agentInfo.agent,
      agentLabel: agentInfo.agentLabel,
      provider: agentInfo.provider,
      providerModel: agentInfo.providerModel,
      isReply: !!isReply,
    });

    const history = dialogue.length > 0
      ? `\n\nТЕКУЩИЙ ДИАЛОГ:\n${dialogue.map(d => `[${d.agentLabel} / ${d.provider}]: ${d.content}`).join("\n\n---\n\n")}`
      : "";

    const systemPrompt = buildSystemPrompt(agentInfo.agent, match, researchContext, ml.contextText);

    // Specific reply instructions per agent role
    const replyInstructions: Record<string, string> = {
      stats_expert: `Виктор, твой ход — ответь на вопрос Сержа и/или Марины из диалога выше.
Если Серж предложил ставки — дай статистическое подтверждение или опровержение его edge-оценки.
Если Марина подняла физический/психологический риск — переведи его в цифры: как это меняет твои вероятности?
Добавь 1 новый статистический факт, который ещё не звучал. Максимум 180 слов.`,

      odds_strategist: `Серж, твой ход — ответь на вопрос Марины и учти комментарий Виктора.
Пересмотри свои ставки с учётом психологических/физических рисков, озвученных Мариной.
Если риск реальный — снижай рекомендуемый размер ставки или убирай позицию.
Дай финальный список ставок с размерами (% банка). Скажи какую ставку считаешь главной и почему. Максимум 200 слов.`,

      context_expert: `Марина, твой ход — ответь на вопрос Сержа.
Дай финальный психологический вердикт: у кого в голове всё хорошо сегодня, у кого — нет.
Есть ли что-то в личном контексте игроков, что перевешивает статистику Виктора? Максимум 180 слов.`,
    };

    const userPrompt = isReply
      ? `${history}\n\n${replyInstructions[agentInfo.agent] ?? "Твой ход — ответь на вопрос коллег. Добавь новые факты."}`
      : `Матч: ${match.player1} vs ${match.player2}${match.tournament ? ` | ${match.tournament}` : ""}${match.surface ? ` | ${match.surface}` : ""}${history}\n\nТвой ход.`;

    const fullContent = await callAgent(agentInfo.agent, systemPrompt, userPrompt, send);

    dialogue.push({
      agent: agentInfo.agent,
      agentLabel: agentInfo.agentLabel,
      content: fullContent,
      isReply,
      provider: agentInfo.provider,
    });
    send({ type: "agent_done", agent: agentInfo.agent, fullContent, agentLabel: agentInfo.agentLabel });
  }

  // Phase 3: Structured recommendations
  send({ type: "generating_recommendations" });

  const fatigueNote = `${match.player1}: усталость ${research.player1.fatigueScore}/10 | ${match.player2}: усталость ${research.player2.fatigueScore}/10`;
  const mlNote = ml.adjustment !== 0
    ? `ML-коррекция: ${ml.adjustment > 0 ? "+" : ""}${ml.adjustment}% к уверенности (история: ${ml.sampleAccuracy}% точности на ${ml.sampleSize} прогнозах).`
    : "";

  const recsResponse = await openai.chat.completions.create({
    model: "gpt-5.4",
    max_completion_tokens: 8192,
    messages: [
      {
        role: "system",
        content: `Подведи итог совещания трёх аналитиков. Сформируй ставки только на основе конкретных фактов.

ДОПОЛНИТЕЛЬНЫЙ КОНТЕКСТ:
${fatigueNote}
${mlNote}

ВАЖНО: если усталость игрока ≥7/10 или есть подтверждённая травма — снижай confidencePercent этой ставки на 5-8%.
Если ML-коррекция отрицательная (плохая история) — снижай на величину коррекции.

Верни JSON массив из 4-6 объектов:
{
  "type": "outcome"|"total"|"handicap"|"express",
  "description": "конкретная ставка с именами игроков",
  "odds": число,
  "bankPercent": 1-5,
  "confidencePercent": 65-97
}

confidencePercent:
- 88-97: все трое согласны, данные чёткие, усталость обоих ≤4/10
- 78-87: двое согласны, один с оговорками; или один игрок устал 5-6/10
- 65-77: разногласия, или высокая усталость ≥7/10, или травма

Обязательно: минимум один outcome, один total/handicap, один express.
Сортируй по убыванию confidencePercent. ТОЛЬКО JSON, без markdown.`,
      },
      {
        role: "user",
        content: `БРИФИНГ:\n${researchContext}\n\nДИАЛОГ:\n${dialogue.map(d => `[${d.agentLabel} / ${d.provider}]:\n${d.content}`).join("\n\n")}`,
      },
    ],
    stream: false,
  });

  let recommendations: BettingRecommendation[] = [];
  try {
    const raw = recsResponse.choices[0]?.message?.content ?? "[]";
    const cleaned = raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    recommendations = JSON.parse(cleaned);
    // Apply ML adjustment to all confidence scores
    if (ml.adjustment !== 0) {
      recommendations = recommendations.map(r => ({
        ...r,
        confidencePercent: Math.max(50, Math.min(97, r.confidencePercent + ml.adjustment)),
      }));
    }
  } catch {
    recommendations = [];
  }

  const avg = recommendations.length > 0
    ? recommendations.reduce((s, r) => s + r.confidencePercent, 0) / recommendations.length : 0;
  const vote = avg >= 82 ? "unanimous" : "disputed";

  const ctxText = dialogue.filter(d => d.agent === "context_expert").map(d => d.content).join(" ");
  const riskNotes = extractByKeywords(ctxText, ["риск", "осторожно", "опасность", "нестабил", "травм", "устал", "семей", "тренер"]);
  const cashoutAdvice = extractByKeywords(ctxText, ["кэшаут", "cashout", "зафиксир", "при счёте", "выйти"]);

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

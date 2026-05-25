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
    model: "claude-sonnet-4-5",
    max_tokens: 4096,
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
  const researchContext = buildResearchContext(research, usedWebSearch ? "web_search" : "ai_knowledge");
  send({ type: "research_complete", usedWebSearch, context: researchContext });

  // Phase 1b: ML adjustment from history
  const ml = await computeMLAdjustment(research.detectedSurface || match.surface);
  if (ml.sampleSize > 0) {
    send({ type: "ml_adjustment", adjustment: ml.adjustment, sampleSize: ml.sampleSize, sampleAccuracy: ml.sampleAccuracy });
  }

  // Phase 2: Dialogue (5 turns)
  const dialogue: AgentMessage[] = [];

  const rounds: Array<{ agentIndex: number; isReply?: boolean; isFinal?: boolean }> = [
    { agentIndex: 0 },            // Виктор — открывает: статистика, матчап, вероятности
    { agentIndex: 1 },            // Серж — коэффициенты, value, первые ставки
    { agentIndex: 2 },            // Марина — психология, физика, личный контекст
    { agentIndex: 0, isReply: true },  // Виктор — пересчёт вероятностей с учётом рисков Марины
    { agentIndex: 1, isReply: true },  // Серж — финальные ставки с учётом всех рисков
    { agentIndex: 2, isReply: true, isFinal: true }, // Марина — итоговый вердикт и кэшаут
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
Есть ли что-то в личном контексте игроков, что перевешивает статистику Виктора? Максимум 190 слов.`,
    };

    const finalRoundInstruction = `Марина, ФИНАЛЬНЫЙ ВЕРДИКТ совещания.
Ты последняя — суммируй всё что сказали Виктор и Серж через призму психологии и физики.

1. ГЛАВНАЯ СТАВКА СОВЕЩАНИЯ: назови одну ставку Сержа которую ты полностью поддерживаешь — объясни почему физика и психология подтверждают.
2. КРАСНЫЕ ФЛАГИ: если хоть один есть (усталость 7+, травма, нестабильная голова) — скажи явно какой и как снижает уверенность.
3. СЦЕНАРИЙ МАТЧА: опиши как ты видишь ход матча по сетам — кто выйдет вперёд, где может быть перелом.
4. КЭШАУТ: при каком счёте выходить (например "при 4:2 в первом сете в пользу X — фиксируй 50%").
5. ИТОГОВАЯ УВЕРЕННОСТЬ всего совещания: высокая / средняя / осторожно — одним словом с объяснением.
Максимум 200 слов.`;

    const userPrompt = round.isFinal
      ? `${history}\n\n${finalRoundInstruction}`
      : isReply
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
        content: `Ты — старший риск-аналитик беттинг-синдиката. Подводишь итог закрытого совещания трёх экспертов.
Твоя задача: сформировать ФИНАЛЬНЫЙ беттинг-лист максимальной точности.

ДАННЫЕ СОВЕЩАНИЯ:
${fatigueNote}
${mlNote}

СТРОГИЕ ПРАВИЛА ФОРМИРОВАНИЯ СТАВОК:

1. ТОЛЬКО факты из брифинга и диалога. Никаких домыслов.

2. CONFIDENCEPERCENT — строгая шкала:
   • 90-97%: ВСЕ три аналитика согласны. Данные из живого веб-поиска. Усталость обоих ≤3/10. Нет травм. Чёткое тактическое преимущество подтверждено статистикой.
   • 82-89%: двое согласны, третий с незначительными оговорками. Данные достоверны. Усталость ≤5/10.
   • 74-81%: двое согласны, один против ИЛИ один игрок устал 6-7/10 ИЛИ данные частично из базы знаний AI.
   • 65-73%: разногласия между аналитиками ИЛИ усталость ≥7/10 ИЛИ подтверждённая травма ИЛИ мало данных.
   • Ниже 65% — НЕ включай ставку в список.

3. BANKPERCENT — строгие лимиты:
   • 90%+: 3-5% банка
   • 82-89%: 2-3% банка
   • 74-81%: 1-2% банка
   • 65-73%: 0.5-1% банка

4. КОРРЕКЦИИ (применяй все применимые):
   • Усталость ≥7/10 у фаворита: −7% к confidence, −1% к bankPercent
   • Подтверждённая травма: −10% к confidence
   • Данные из AI базы знаний (не веб-поиск): −5% к confidence
   • ML коррекция: применяй как указано
   • Левша против правши на грунте (специфический edge): возможен +3% если аналитики это отметили

5. СТРУКТУРА ОБЯЗАТЕЛЬНА:
   • Минимум 1 outcome (победитель матча)
   • Минимум 1 total (тотал геймов или сетов)
   • Минимум 1 handicap (фора по сетам или геймам)
   • Опционально: 1 express из 2-3 наиболее уверенных исходов (bankPercent не более 1%)

6. DESCRIPTION: конкретная — имена игроков, рынок, почему. Пример: "Победа Алькараса — преимущество на грунте (83% vs 61%), агрессивный форхенд подавляет защитника"

Верни ТОЛЬКО JSON массив, без markdown, без комментариев:
[
  {
    "type": "outcome"|"total"|"handicap"|"express",
    "description": "...",
    "odds": число,
    "bankPercent": 0.5-5,
    "confidencePercent": 65-97
  }
]
Сортируй по убыванию confidencePercent.`,
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

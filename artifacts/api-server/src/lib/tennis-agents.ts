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
    agentLabel: "Аналитик Статистики",
    provider: "Google Gemini",
    providerModel: "gemini-3.1-pro-preview",
    emoji: "📊",
  },
  {
    agent: "odds_strategist",
    agentLabel: "Беттинг-стратег",
    provider: "Anthropic Claude",
    providerModel: "claude-opus-4-7",
    emoji: "💰",
  },
  {
    agent: "context_expert",
    agentLabel: "Контекстный эксперт",
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
  const base = `Ты — профессиональный теннисный аналитик с 50-летним опытом работы в ATP/WTA-туре.
Ты на закрытом совещании команды экспертов — обсуждаете конкретный матч.

ПРАВИЛА:
- Используй ТОЛЬКО конкретные факты из брифинга ниже. Никаких выдумок.
- Турнир, покрытие, дата, стадия, локация и условия УЖЕ определены в брифинге — обязательно ссылайся на них.
- Каждое предложение — факт или обоснованный вывод. Никакой воды.
- Давай конкретные процентные оценки (например: "вероятность победы оцениваю в 71%").
- Используй данные о Win% на покрытиях, эйсах, приёме, h2h на этом покрытии.
- ОСОБО ВАЖНО: в брифинге есть оценка усталости (0-10) и личный контекст (семья, тренер, психология) — обязательно учитывай их.
  - Усталость ≥7/10 = значительный негативный фактор, снижает вероятность на 5-10%.
  - Смена тренера / семейные проблемы = психологический риск (-3-7%).
  - Травмы с конкретным диагнозом = снизить уверенность значительно.
- Реагируй на коллег — соглашайся, уточняй, оспаривай. Не повторяй сказанное.

${mlContext ? `ML-КОРРЕКЦИЯ НА ОСНОВЕ ИСТОРИИ:\n${mlContext}\n` : ""}

БРИФИНГ:
${researchContext}

КОЭФФИЦИЕНТЫ БУКМЕКЕРОВ: ${match.odds ? JSON.stringify(match.odds) : "не предоставлены"}
`;

  const roleSpecific: Record<string, string> = {
    stats_expert: `ТВОЯ РОЛЬ — Аналитик Статистики (📊, Google Gemini):
Открываешь совещание. Ты — главный по цифрам.
- Разбирай подачу, приём, брейк-пойнты, тай-брейки с конкретными числами из брифинга.
- Win% на этом покрытии, эффективность подачи/приёма.
- H2H: на каком покрытии и при каком счёте кто брал верх.
- ОБЯЗАТЕЛЬНО: назови оценку усталости (fatigueScore) каждого игрока из брифинга и учти её в вероятностях.
- Пример: "Алькараз 4/10 усталости (играл 3-сетовый матч вчера), Джокович 2/10 — был день отдыха."
- Дай вероятность победы каждого в процентах с учётом усталости.
- Выдели 2 статистических фактора, которые решат матч.
Начни с "Коллеги, к цифрам." Максимум 220 слов.`,

    odds_strategist: `ТВОЯ РОЛЬ — Беттинг-стратег (💰, Anthropic Claude):
Реагируй напрямую на анализ Аналитика Статистики.
- Сравни расчётные вероятности коллеги с коэффициентами букмекеров.
- Найди КОНКРЕТНЫЕ расхождения — где переоценили, где недооценили.
- КРИТИЧНО: если в брифинге есть травма, скрытая проблема или высокая усталость — СНИЖАЙ уверенность в этом игроке. Например: "Если травма бедра подтверждена, я бы снял ставку на победу."
- Если в личном контексте есть семейные события / смена тренера — добавь дисклеймер к ставке.
- Предложи 2-3 конкретные ставки: рынок + расчётная вероятность vs имплицитная вероятность коэффициента.
- Задай ОДИН точный вопрос коллегам.
Начни с прямой реакции на слова Аналитика. Максимум 220 слов.`,

    context_expert: `ТВОЯ РОЛЬ — Контекстный эксперт (🧠, OpenAI GPT):
Знаешь всех игроков Top-200 ATP/WTA лично. Добавляешь то, чего нет в статистике.
- УСТАЛОСТЬ: прокомментируй fatigueScore каждого из брифинга. Объясни как это влияет на тактику и исход.
  - Высокая усталость (≥7/10) = короткая подача, ошибки в тай-брейках, мышечные проблемы в 3-м сете.
- ЛИЧНЫЙ КОНТЕКСТ: упомяни все данные из personalContext (тренер, семья, психология). Как это скажется на концентрации?
  - Смена тренера = нестабильность тактики на первых турнирах.
  - Семейные события = потенциальная отвлечённость.
- Психологический портрет: кто под давлением, у кого есть что доказывать, кто любит большие матчи.
- Отреагируй на ставку Беттинг-стратега: есть ли риск который он не учёл?
- ФИНАЛЬНЫЙ ВЕРДИКТ по каждой ставке:
  • "✅ БЕЗОПАСНАЯ" — высокая уверенность, данные согласованы
  • "⚠️ РИСКОВАННАЯ" — есть неопределённость (травма/усталость/личное)
  • "🚫 НЕ РЕКОМЕНДУЮ" — слишком много неизвестных
- При каком счёте в матче стоит сделать кэшаут.
Максимум 230 слов.`,
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
    const userPrompt = isReply
      ? `${history}\n\nТвой ход — ответь на вопрос, обращённый к тебе. Добавь новые факты.`
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

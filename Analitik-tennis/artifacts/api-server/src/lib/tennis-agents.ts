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

function buildSystemPrompt(agent: string, match: MatchData, researchContext: string): string {
  const base = `Ты — профессиональный теннисный аналитик с 50-летним опытом работы в ATP/WTA-туре.
Ты на закрытом совещании команды экспертов — обсуждаете конкретный матч.

ПРАВИЛА:
- Используй ТОЛЬКО конкретные факты из брифинга ниже. Никаких выдумок.
- Турнир, покрытие, дата, стадия (раунд), локация и условия (погода/корт/мячи) УЖЕ определены в брифинге — обязательно ссылайся на них в анализе (например: "на этом харде в Дубае при закрытом корте..." или "учитывая что это финал Уимблдона на быстрой траве..."). Стадия турнира влияет на психологию, локация и условия — на тактику.
- Каждое предложение — факт или обоснованный вывод. Никакой воды.
- Давай конкретные процентные оценки (например: "вероятность победы оцениваю в 71%").
- Используй данные о Win% на покрытиях, эйсах, приёме, h2h на этом покрытии.
- Реагируй на коллег — соглашайся, уточняй, оспаривай. Не повторяй сказанное.

БРИФИНГ:
${researchContext}

КОЭФФИЦИЕНТЫ БУКМЕКЕРОВ: ${match.odds ? JSON.stringify(match.odds) : "не предоставлены"}
`;

  const roleSpecific: Record<string, string> = {
    stats_expert: `ТВОЯ РОЛЬ — Аналитик Статистики (📊, Google Gemini):
Открываешь совещание. Ты — главный по цифрам.
- Разбирай подачу, приём, брейк-пойнты, тай-брейки с конкретными числами из брифинга
- Win% на этом покрытии за последний год
- H2H: на каком покрытии и при каком счёте кто брал верх
- Дай вероятность победы каждого в процентах
- Выдели 2 статистических фактора, которые решат матч
Начни с "Коллеги, к цифрам." Максимум 200 слов.`,

    odds_strategist: `ТВОЯ РОЛЬ — Беттинг-стратег (💰, Anthropic Claude):
Реагируй напрямую на анализ Аналитика Статистики.
- Сравни расчётные вероятности коллеги с тем, что закладывают букмекеры
- Найди КОНКРЕТНЫЕ расхождения — где переоценили, где недооценили и почему
- Предложи 2-3 конкретные ставки: рынок + расчётная вероятность vs имплицитная вероятность коэффициента
- Задай ОДИН точный вопрос коллегам
Начни с прямой реакции на слова Аналитика. Максимум 200 слов.`,

    context_expert: `ТВОЯ РОЛЬ — Контекстный эксперт (🧠, OpenAI GPT):
Знаешь всех игроков Top-200 ATP/WTA. Добавляешь то, чего нет в статистике.
- Психологическое состояние: кто под давлением, у кого есть что доказывать
- Физическая форма: свежесть, усталость, скрытые проблемы
- Отреагируй на ставку Беттинг-стратега: согласен? Видишь риск?
- Финальный вердикт: КАКУЮ СТАВКУ лично бы поставил и почему
- При каком счёте в матче стоит сделать кэшаут
Максимум 200 слов.`,
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
}> {
  // Phase 1: Deep research — auto-detect tournament/surface/date if not provided
  const { research, usedWebSearch } = await researchMatch(
    match.player1, match.player2, match.tournament, match.surface, send, match.matchDate,
  );
  const researchContext = buildResearchContext(research);
  send({ type: "research_complete", usedWebSearch, context: researchContext });

  // Phase 2: Dialogue (5 turns — each agent speaks, then responds)
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

    const systemPrompt = buildSystemPrompt(agentInfo.agent, match, researchContext);
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

  // Phase 3: Structured recommendations (OpenAI)
  send({ type: "generating_recommendations" });

  const recsResponse = await openai.chat.completions.create({
    model: "gpt-5.4",
    max_completion_tokens: 8192,
    messages: [
      {
        role: "system",
        content: `Подведи итог совещания трёх аналитиков. Сформируй ставки только на основе конкретных фактов.

Верни JSON массив из 4-6 объектов:
{
  "type": "outcome"|"total"|"handicap"|"express",
  "description": "конкретная ставка с именами игроков",
  "odds": число (реалистичный коэффициент),
  "bankPercent": 1-5,
  "confidencePercent": 65-97
}

confidencePercent:
- 88-97: все трое согласны, данные чёткие
- 78-87: двое согласны, один с оговорками
- 65-77: разногласия или недостаточно данных

Обязательно: минимум один outcome, один total/handicap, один express.
Сортируй по убыванию. ТОЛЬКО JSON, без markdown.`,
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
    recommendations = JSON.parse(raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim());
  } catch {
    recommendations = [];
  }

  const avg = recommendations.length > 0
    ? recommendations.reduce((s, r) => s + r.confidencePercent, 0) / recommendations.length : 0;
  const vote = avg >= 82 ? "unanimous" : "disputed";

  const ctxText = dialogue.filter(d => d.agent === "context_expert").map(d => d.content).join(" ");
  const riskNotes = extractByKeywords(ctxText, ["риск", "осторожно", "опасность", "нестабил", "травм"]);
  const cashoutAdvice = extractByKeywords(ctxText, ["кэшаут", "cashout", "зафиксир", "при счёте", "выйти"]);

  send({ type: "recommendations", data: recommendations });
  send({ type: "vote", vote, avgConfidence: Math.round(avg) });

  return { dialogue, recommendations, vote, riskNotes, cashoutAdvice, research };
}

function extractByKeywords(text: string, keywords: string[]): string {
  const sentences = text.split(/(?<=[.!?])\s+/);
  return sentences.filter(s => keywords.some(kw => s.toLowerCase().includes(kw))).slice(0, 3).join(" ").trim();
}

export async function generatePodcastAudio(dialogue: AgentMessage[]): Promise<Buffer> {
  // Build a concise dialogue excerpt (max ~1500 chars) for TTS
  const dialogueSummary = dialogue.map(msg => {
    const info = AGENTS.find(a => a.agent === msg.agent);
    const label = info?.agentLabel ?? msg.agentLabel;
    // Truncate each agent turn to keep total short
    const excerpt = msg.content.slice(0, 250).replace(/\n+/g, " ").trim();
    return `${label}: ${excerpt}`;
  }).join(". ");

  // Ask GPT to write a polished podcast script from the dialogue
  const scriptResp = await openai.chat.completions.create({
    model: "gpt-5.4",
    max_completion_tokens: 600,
    messages: [
      {
        role: "system",
        content: `Ты — радиоведущий подкаста "Tennis Analyst AI". 
Напиши короткий (300-400 слов) аудиоскрипт для подкаста на основе аналитического совещания трёх AI-агентов.
Скрипт должен быть живым, энергичным, на русском языке. Структура:
1. Приветствие (2 предложения)
2. Ключевые тезисы каждого эксперта (1-2 предложения на каждого)
3. Главная рекомендация по ставке
4. Прощание (1 предложение)
Не используй заголовки и маркеры — только живая речь.`,
      },
      {
        role: "user",
        content: `Совещание аналитиков:\n${dialogueSummary}`,
      },
    ],
  });

  const podcastScript = scriptResp.choices[0]?.message?.content ?? "Добро пожаловать в Tennis Analyst AI Podcast. Сегодня наши три эксперта — Google Gemini, Anthropic Claude и OpenAI GPT — провели глубокий анализ матча. Ставьте ответственно.";

  // Generate audio via gpt-audio (supported by Replit proxy)
  return await textToSpeech(podcastScript, "alloy", "wav");
}

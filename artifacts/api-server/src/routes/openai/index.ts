import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, conversations, messages } from "@workspace/db";
import {
  CreateOpenaiConversationBody,
  GetOpenaiConversationParams,
  DeleteOpenaiConversationParams,
  ListOpenaiMessagesParams,
  SendOpenaiMessageParams,
  SendOpenaiMessageBody,
  SendOpenaiVoiceMessageParams,
  SendOpenaiVoiceMessageBody,
} from "@workspace/api-zod";
import { openai } from "@workspace/integrations-openai-ai-server";
import { ensureCompatibleFormat, voiceChatStream } from "@workspace/integrations-openai-ai-server/audio";

const router: IRouter = Router();

// GET /openai/conversations
router.get("/openai/conversations", async (_req, res): Promise<void> => {
  const all = await db
    .select()
    .from(conversations)
    .orderBy(conversations.createdAt);

  res.json(all.map(c => ({ ...c, createdAt: c.createdAt.toISOString() })));
});

// POST /openai/conversations
router.post("/openai/conversations", async (req, res): Promise<void> => {
  const parsed = CreateOpenaiConversationBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [conv] = await db
    .insert(conversations)
    .values({ title: parsed.data.title })
    .returning();

  res.status(201).json({ ...conv, createdAt: conv.createdAt.toISOString() });
});

// GET /openai/conversations/:id
router.get("/openai/conversations/:id", async (req, res): Promise<void> => {
  const params = GetOpenaiConversationParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [conv] = await db
    .select()
    .from(conversations)
    .where(eq(conversations.id, params.data.id));

  if (!conv) {
    res.status(404).json({ error: "Беседа не найдена" });
    return;
  }

  const msgs = await db
    .select()
    .from(messages)
    .where(eq(messages.conversationId, params.data.id))
    .orderBy(messages.createdAt);

  res.json({
    ...conv,
    createdAt: conv.createdAt.toISOString(),
    messages: msgs.map(m => ({ ...m, createdAt: m.createdAt.toISOString() })),
  });
});

// DELETE /openai/conversations/:id
router.delete("/openai/conversations/:id", async (req, res): Promise<void> => {
  const params = DeleteOpenaiConversationParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [deleted] = await db
    .delete(conversations)
    .where(eq(conversations.id, params.data.id))
    .returning();

  if (!deleted) {
    res.status(404).json({ error: "Беседа не найдена" });
    return;
  }

  res.sendStatus(204);
});

// GET /openai/conversations/:id/messages
router.get("/openai/conversations/:id/messages", async (req, res): Promise<void> => {
  const params = ListOpenaiMessagesParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const msgs = await db
    .select()
    .from(messages)
    .where(eq(messages.conversationId, params.data.id))
    .orderBy(messages.createdAt);

  res.json(msgs.map(m => ({ ...m, createdAt: m.createdAt.toISOString() })));
});

// POST /openai/conversations/:id/messages (text SSE)
router.post("/openai/conversations/:id/messages", async (req, res): Promise<void> => {
  const params = SendOpenaiMessageParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const body = SendOpenaiMessageBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }

  // Save user message
  await db.insert(messages).values({
    conversationId: params.data.id,
    role: "user",
    content: body.data.content,
  });

  // Load history
  const history = await db
    .select()
    .from(messages)
    .where(eq(messages.conversationId, params.data.id))
    .orderBy(messages.createdAt);

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  let fullResponse = "";

  const stream = await openai.chat.completions.create({
    model: "gpt-5.4",
    max_completion_tokens: 8192,
    messages: [
      {
        role: "system",
        content: "Ты — профессиональный теннисный аналитик и беттинг-эксперт. Отвечай на русском языке.",
      },
      ...history.map(m => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      })),
    ],
    stream: true,
  });

  for await (const chunk of stream) {
    const content = chunk.choices[0]?.delta?.content;
    if (content) {
      fullResponse += content;
      res.write(`data: ${JSON.stringify({ content })}\n\n`);
    }
  }

  await db.insert(messages).values({
    conversationId: params.data.id,
    role: "assistant",
    content: fullResponse,
  });

  res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
  res.end();
});

// POST /openai/conversations/:id/voice-messages (voice SSE)
router.post("/openai/conversations/:id/voice-messages", async (req, res): Promise<void> => {
  const params = SendOpenaiVoiceMessageParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const body = SendOpenaiVoiceMessageBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }

  const audioBuffer = Buffer.from(body.data.audio, "base64");
  const { buffer, format } = await ensureCompatibleFormat(audioBuffer);

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  const stream = await voiceChatStream(buffer, "alloy", format);

  let assistantTranscript = "";
  let userTranscript = "";

  for await (const event of stream) {
    if (event.type === "transcript") assistantTranscript += event.data;
    if ((event as { type: string; data?: string }).type === "user_transcript") userTranscript += (event as any).data ?? "";
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  }

  await db.insert(messages).values([
    { conversationId: params.data.id, role: "user", content: userTranscript || "[voice message]" },
    { conversationId: params.data.id, role: "assistant", content: assistantTranscript },
  ]);

  res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
  res.end();
});

export default router;

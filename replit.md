# BetAnalytics · Tennis Pro Edition

Профессиональная платформа для теннисной аналитики с тремя AI-агентами, глубоким веб-поиском, ML-коррекцией и Telegram-публикацией.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — API сервер (порт 8080)
- `pnpm --filter @workspace/tennis-analyst run dev` — фронтенд (порт из $PORT)
- `pnpm run typecheck` — проверка типов всего проекта
- `pnpm run build` — typecheck + сборка всех пакетов
- `pnpm --filter @workspace/api-spec run codegen` — регенерация API хуков и Zod-схем
- `pnpm --filter @workspace/db run push` — применить изменения схемы БД (только dev)
- Required env: `DATABASE_URL` — строка подключения PostgreSQL

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)
- Frontend: React + Vite + Tailwind v4 + Shadcn/UI

## Where things live

```
artifacts/
  api-server/src/
    lib/
      tennis-agents.ts      — 3 AI-агента (Gemini/Claude/GPT), промпты, оркестрация
      tennis-research.ts    — Глубокий веб-поиск + кеш, схема JSON, buildResearchContext
      tennis-ml.ts          — ML-коррекция на основе истории (pure TS, no external libs)
      telegram-publisher.ts — Telegram Bot API публикация
      results-collector.ts  — Автосбор результатов через AI+web_search
    routes/
      predictions.ts        — Основные CRUD + анализ + подкаст
      predictions-pro.ts    — PRO-эндпоинты: /telegram, /check-results, /ml-stats
  tennis-analyst/src/
    pages/
      analysis.tsx          — Страница анализа (форма + терминал + рекомендации)
      history.tsx           — История ставок + ROI статистика
    components/
      layout.tsx            — Шапка с навигацией
lib/
  db/src/schema/
    predictions.ts          — Таблица прогнозов (+ fatigueScore1/2, mlAdjustment, telegramMessageId)
    search-cache.ts         — Кеш результатов веб-поиска (по месяцу)
  api-spec/openapi.yaml     — Source-of-truth для API контракта
```

## Architecture decisions

- **Три AI-провайдера**: Stats Expert → Gemini, Betting Strategist → Claude, Context Expert → GPT. Каждый провайдер стримит ответ через SSE.
- **Веб-поиск через OpenAI web_search_preview**: встроенный инструмент GPT-5.4 используется для поиска травм, формы, усталости, личного контекста игроков. Результаты кешируются в PostgreSQL на месяц.
- **ML-коррекция**: pure TypeScript, без внешних ML-библиотек. Анализирует историю прогнозов, вычисляет точность на похожем покрытии, корректирует confidencePercent ±5%.
- **Усталость (fatigueScore 0-10)**: вычисляется AI по данным веб-поиска (матчи за 7/14 дней, длинные матчи накануне). Явно влияет на промпты агентов и уверенность рекомендаций.
- **Telegram**: нативный fetch к Bot API без npm-пакетов. HTML-форматирование, шкала уверенности, ML-коррекция в сообщении.

## Product

- Ввод матча (П1 vs П2, турнир, покрытие, дата) или загрузка скриншотов букмекера
- Глубокий веб-поиск актуальных данных (травмы, форма, семья, тренер, усталость)
- Диалог трёх AI-агентов с учётом usталости и личного контекста
- ML-коррекция уверенности на основе истории прогнозов
- Беттинг-рекомендации с коэффициентами, % банка, шкалой уверенности
- Аудио-подкаст через OpenAI TTS
- Публикация в Telegram-канал с форматированным сообщением
- Автосбор результатов матчей через AI+web_search
- История с ROI-трекингом и статистикой точности

## User preferences

- Только теннис — никакого футбола/баскетбола/волейбола
- Не удалять существующие файлы — только дополнять
- Тёмная тема в стиле Bloomberg Terminal (navy + cyan + amber)
- Все новые модули в отдельных файлах без изменения структуры
- Telegram токены пользователь добавляет вручную в Secrets

## Gotchas

- Перед развёртыванием добавить в Secrets: `TELEGRAM_BOT_TOKEN` и `TELEGRAM_CHANNEL_ID` (необязательно — без них Telegram просто отключён)
- Кеш поиска хранится в таблице `tennis_search_cache` — месяц TTL. Кнопка "🌐 Глубокий поиск" сбрасывает кеш для пары игроков.
- ML-коррекция работает только когда есть ≥1 прогноза с известным результатом в БД.
- `forceRefresh: true` в теле запроса `/api/predictions/analyze` сбрасывает кеш поиска.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details

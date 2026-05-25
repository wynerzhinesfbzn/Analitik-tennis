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

## Architecture decisions (ЭКОНОМИЧНАЯ — ≤2 руб/прогноз)

- **Один вызов GPT-4o-mini** вместо 6 раундов Claude+Gemini+GPT. Промпт возвращает секции [ВИКТОР]/[СЕРЖ]/[МАРИНА]/[СТАВКИ]. Стриминговый парсер секций создаёт SSE-события agent_start/chunk/done без изменения фронтенда.
- **DuckDuckGo поиск (бесплатно)**: `ddgSearch()` в tennis-research.ts делает 7 запросов к html.duckduckgo.com/html — без ключей, без оплаты. Затем GPT-4o-mini структурирует снипеты в JSON-досье.
- **Кеш**: результаты DDG+структурирования кешируются в PostgreSQL (tennis_search_cache, месяц TTL). Повторный запрос — из кеша, $0.
- **Логирование стоимости**: каждый запрос логирует `costUsd` и `costRub` отдельно для research и agents. SSE event `cost_log` виден в терминале.
- **ML-коррекция**: pure TypeScript, без внешних ML-библиотек. Анализирует историю прогнозов, вычисляет точность на похожем покрытии, корректирует confidencePercent ±5%.
- **Telegram**: нативный fetch к Bot API без npm-пакетов. HTML-форматирование, шкала уверенности, ML-коррекция в сообщении.

## Cost breakdown (один прогноз)

| Фаза | Было | Стало |
|------|------|-------|
| Веб-поиск (18 × $0.025) | $0.45 | $0 (DuckDuckGo) |
| Агенты (6 раундов Claude/Gemini/GPT) | $0.48 | $0.003 (GPT-4o-mini) |
| Research структурирование | $0.14 | $0.002 (GPT-4o-mini) |
| **ИТОГО** | **~$1.10 (~99 руб)** | **~$0.005 (~0.45 руб)** |

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

# Tennis Analyst AI

Профессиональный теннисный аналитик с мультиагентным AI-совещанием. Пользователь вводит имена игроков или загружает скриншот букмекерской линии — три AI-агента проводят живое обсуждение и выдают конкретные рекомендации по ставкам.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — запустить API сервер (порт 8080)
- `pnpm --filter @workspace/tennis-analyst run dev` — запустить фронтенд (порт 22286)
- `pnpm run typecheck` — полная проверка типов
- `pnpm run build` — typecheck + сборка
- `pnpm --filter @workspace/api-spec run codegen` — обновить API хуки и Zod схемы
- `pnpm --filter @workspace/db run push` — применить изменения схемы БД

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- AI: OpenAI gpt-5.4 (через Replit AI Integrations, ключ не нужен)
- API codegen: Orval (from OpenAPI spec)
- Frontend: React + Vite + TailwindCSS + shadcn/ui
- Build: esbuild (CJS bundle)

## Where things live

- `lib/api-spec/openapi.yaml` — источник истины для API контракта
- `lib/db/src/schema/predictions.ts` — схема таблицы прогнозов
- `lib/db/src/schema/conversations.ts` + `messages.ts` — схемы для OpenAI чата
- `artifacts/api-server/src/routes/predictions.ts` — маршруты прогнозов и AI анализа
- `artifacts/api-server/src/lib/tennis-agents.ts` — логика 3 AI агентов
- `artifacts/api-server/src/routes/openai/index.ts` — маршруты OpenAI чата
- `artifacts/tennis-analyst/src/` — React фронтенд

## Architecture decisions

- Три AI агента вызываются последовательно, но видят ответы друг друга (context chaining)
- Анализ матча стримится через SSE — агенты печатают в реальном времени
- Скриншот букмекера парсится через GPT-4o Vision API
- Прогнозы сохраняются в PostgreSQL с возможностью ввода реального результата
- История точности рассчитывается на лету из БД

## Product

- Главная страница: ввод игроков/турнира или загрузка скриншота → живое AI-совещание 3 агентов → структурированные рекомендации
- Страница истории: статистика точности прогнозов, список всех прогнозов, ввод реальных результатов

## User preferences

- UI полностью на русском языке
- Тёмная тема в стиле premium analytics terminal

## Gotchas

- SSE эндпоинты (`/analyze`, `/messages`) нельзя использовать через сгенерированные хуки — только raw fetch
- Лимит тела запроса 50MB (для base64 изображений)
- После изменений OpenAPI spec обязательно запускать codegen

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details

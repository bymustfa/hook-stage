# hook-stage agent notes

hook-stage is a local WebUI for replaying webhook scenarios against localhost and checking the business outcome separately from HTTP status.

Do not add a Claude signature, Co-Authored-By line, or "Generated with Claude Code" (or any AI-tool signature) to commit messages or PR descriptions.

Commit mesajlarına ve PR açıklamalarına Claude imzası, Co-Authored-By satırı veya "Generated with Claude Code" ifadesi ekleme.

## Layout

- `apps/web` — Vite + React editor
- `apps/server` — Fastify API, SQLite, scheduler host
- `packages/scenario` — document schema, JSON Pointer assertions, scheduler
- `examples/order-receiver` — buggy and fixed synthetic payment receivers
- `fixtures` — versioned scenario JSON
- `tests` — unit and integration tests

Webhooks are sent by the Node process. The browser only talks to hook-stage.

## Commands

```bash
pnpm install
pnpm dev
pnpm receiver:buggy
pnpm receiver:fixed
pnpm test
pnpm lint
pnpm typecheck
pnpm build
pnpm start
```

Node.js 22 or newer is required. The server binds to loopback only.

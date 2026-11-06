# Contributing

Thanks for looking at hook-stage. The product question is: the webhook was delivered, but did the business outcome happen?

## Setup

Node.js 22 or newer and pnpm 10.

```bash
pnpm install
pnpm dev
pnpm receiver:buggy
pnpm receiver:fixed
pnpm test
```

`pnpm demo` starts the API, the WebUI, and both sample receivers.

## Pull requests

- Open a focused change. The scenario contract lives in `packages/scenario` and `fixtures/`.
- Run `pnpm lint`, `pnpm typecheck`, and `pnpm test` before asking for review.
- Use a conventional commit subject (`feat:`, `fix:`, `docs:`, `test:`, `ci:`) so release-please can group notes later.
- Do not add a Claude signature, Co-Authored-By line, or "Generated with Claude Code" (or any AI-tool signature) to commit messages or PR descriptions.
- Do not enable npm publish, GitHub release asset upload, or Docker push. Those steps stay disabled until a maintainer turns them on.
- Do not change repository visibility.
- Sample data stays synthetic. Do not add live payment credentials.

## Good first issues

Ideas are listed in [docs/good-first-issues.md](docs/good-first-issues.md).

## Security

Report vulnerabilities privately. See [SECURITY.md](SECURITY.md).

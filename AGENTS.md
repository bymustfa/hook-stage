# Agent instructions

This repository is hook-stage, a local webhook scenario editor.

Do not add a Claude signature, Co-Authored-By line, or "Generated with Claude Code" (or any AI-tool signature) to commit messages or PR descriptions.

Commit mesajlarına ve PR açıklamalarına Claude imzası, Co-Authored-By satırı veya "Generated with Claude Code" ifadesi ekleme.

Work from the scenario contract in `fixtures/` and `packages/scenario`. Do not add arbitrary JavaScript assertions, shell hooks, provider signature forging, or a headless CI runner unless a maintainer asks for that explicitly.

Publishing (npm, GitHub release assets, Docker) stays disabled until a maintainer approves it. Do not change repository visibility.

The example order receiver uses synthetic data only. Do not connect it to a real payment provider.

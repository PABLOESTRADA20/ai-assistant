---
title: ARIA — Registro de PRs
tags: [aria, prs, git]
updated: 2026-11-23
---

# Registro de PRs

Todos los PRs locales se fusionaron con **merge commit** y las ramas **no se eliminaron**.

| PR | Rama | Merge | Resumen |
|---|---|---|---|
| #1 | `aria/anadir-linea-de-prueba-...` | externo | Prueba en vivo en `PABLOESTRADA20/web_anime`: +2/−0 en README, `main` intacta |
| #3 | `mejoras/endurecimiento` | `59974dc` | 12 commits: auth, WhatsApp, agente local, CI/deploy, build, Next 15.5.28, wrangler 4.158.0, chunker |
| #13 | `fix/kaggle-lora` | `c1ea9e3` | Cuaderno Kaggle corregido: no tocar `torch`, unsloth 2026.11.4, fallo temprano sin CUDA |
| #14 | `docs/fase-6-lora-descartado` | `eb68f0b` | Cierre y descarte documentado de `aria-v1` |
| #17 | `feat/piloto-trazas` | `c69e070` | Piloto determinista, `TraceSink`, 18 tests |
| #18 | `feat/piloto-llm` | `58250b7` | Cliente Groq opt-in, anonimización previa, 14 tests |
| #19 | `feat/piloto-eval` | `3530f64` | Rúbrica 0-5, filtros y worktree temporal, 10 tests |
| #20 | `feat/piloto-refs` | `1e66de9` | `--ref=`, reintentos 429, lote de 10 trazas evaluadas, 2 tests |

## Ramas remotas vivas

`mejoras/endurecimiento`, `fix/kaggle-lora`, `docs/fase-6-lora-descartado`, `feat/piloto-trazas`, `feat/piloto-llm`, `feat/piloto-eval`, `feat/piloto-refs`, `dependabot/github_actions/softprops/action-gh-release-3`, `dependabot/npm_and_yarn/ai-assistant/minor-and-patch-20893d2404` (forced update).

## Sin revisar

PRs de Dependabot **#4–#12**. Ver [[Pendientes]].

## Enlaces

[[Inicio]] · [[Cronología]] · [[Estado actual]] · [[Decisiones]]

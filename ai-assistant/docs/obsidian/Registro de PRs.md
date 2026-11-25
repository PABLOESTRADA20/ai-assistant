---
title: ARIA — Registro de PRs
tags: [aria, prs, git]
updated: 2026-11-25
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
| #21 | `docs/obsidian-vault` | `1ea90f0` | Bóveda Obsidian: 26 notas, MOC, canvas, wikilinks y frontmatter |
| #16 | `dependabot/npm_and_yarn/ai-assistant/minor-and-patch-20893d2404` | `af0032b` | 13 actualizaciones: Next 15.5.29, OpenNext 1.20.17, Prisma 6.19.3, wrangler 4.164.0, Vitest 5.1.0; CI 3/3 |
| #15 | `dependabot/github_actions/softprops/action-gh-release-3` | `b795264` | `action-gh-release` v3 (runtime Node 24); CI 3/3 |
| #22 | `fix/general-errors` | `527137b` | 5 commits: WASM en dev/start, PR recién abierto vs. sin checks, test de integración de `ChangeLog`, `--force` y documentación; CI 3/3 |
| #23 | `docs/post-merge-22` | `a835beb` | Ajuste documental tras #22 (ROADMAP, Obsidian y recuentos); CI 3/3 |
| #24 | `feat/oauth-fase7` | `93269a9` | 4 commits: sesiones OAuth firmadas, rutas GitHub/Google, botones en el login y documentación; CI 3/3 |
| #25 | `docs/post-merge-24` | `0a9d017` | Ajuste documental tras OAuth; CI 3/3 |
| #26 | `feat/testgen-dataset` | `d3f64ea` | Dataset ReAct/CoT con split por PR, correcciones y early stopping; CI 3/3 |
| #27 | `fix/testgen-dataset-split` | `d0c2557` | `valid` estratificado y `--max-output-chars` real; CI 3/3 |
| #4–#7, #10 | `dependabot/…` | `2b35ecf`, `62b2e0d`, `c810171`, `139b9e5`, `5f559e0` | Actions 7/6 y dotenv 18; los cinco con CI 3/3 |
| #28 | `docs/post-merge-27-deps` | `fda75f9` | Registro de #27, Dependabot y deuda restante; CI 3/3 |
| #29 | `feat/piloto-signal-quality` | `41042bb` | Prompt anti-invención, auditoría del dataset y agrupación por archivos; CI 3/3 |
| #30 | `fix/audit-idempotente` | `2bc43c6` | La auditoría de secretos compara texto, no conteo; CI 3/3 |
| #31 | `docs/actualizacion-versiones-autorizacion` | `eccbcfe` | Documentación de la señal del piloto, autorización de Prisma 7/Next 16 y deuda; CI 3/3 |
| #32 | `deps/prisma-7` | `25ab567` | Prisma 7.10.1 (cliente, adapters y config); auditoría 18 → 17; CI 3/3 |
| #33 | `fix/prisma-generated-clean` | `4c0f9e4` | Regeneración limpia del cliente, imports a `generated/prisma/client`, WASM `query_compiler_fast_bg` y normalización de `sources`/`context` nulos; CI 3/3 |
| #34 | `deps/next-16` | `8335183` | Next 16.4.6 + ESLint 9, webpack explícito, sin bandera de OpenNext; auditoría 17 → 10; CI 3/3 |

## Ramas remotas vivas

`mejoras/endurecimiento`, `fix/kaggle-lora`, `docs/fase-6-lora-descartado`, `feat/piloto-trazas`, `feat/piloto-llm`, `feat/piloto-eval`, `feat/piloto-refs`, `docs/obsidian-vault`, `fix/general-errors`, `docs/post-merge-22`, `feat/oauth-fase7`, `docs/post-merge-24`, `feat/testgen-dataset`, `fix/testgen-dataset-split`, `docs/post-merge-27-deps`, `feat/piloto-signal-quality`, `fix/audit-idempotente`, `docs/actualizacion-versiones-autorizacion`, `deps/prisma-7`, `fix/prisma-generated-clean`, `deps/next-16`, `dependabot/github_actions/softprops/action-gh-release-3`, `dependabot/npm_and_yarn/ai-assistant/minor-and-patch-20893d2404` (forced update), `dependabot/github_actions/actions/checkout-7`, `dependabot/github_actions/actions/setup-node-7`, `dependabot/github_actions/actions/setup-java-6`, `dependabot/github_actions/actions/upload-artifact-7`, `dependabot/npm_and_yarn/ai-assistant/dotenv-18.0.9`.

## Revisados sin fusionar

PRs de Dependabot **#9, #11, #12** (CI roja o versiones acordadas: React 18, `@types/node` 24.19.1 y Tailwind 3.4.x; #8 estaba cerrado). No se cierran sin una decisión explícita. Ver [[Pendientes]].

## Enlaces

[[Inicio]] · [[Cronología]] · [[Estado actual]] · [[Decisiones]]

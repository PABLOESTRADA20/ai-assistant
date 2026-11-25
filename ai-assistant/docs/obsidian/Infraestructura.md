---
title: ARIA — Infraestructura
tags: [aria, infra, build, ci]
updated: 2026-11-23
---

# Infraestructura

## Stack

Next 16.4.6 · React 18.3.1 · Tailwind 3.4.x · Prisma 7.10.1 · OpenNext 1.20.17 · wrangler 4.164.0 · Vitest 5.1.0 · ESLint 9.39.5 · @types/node 24.19.1.

## Runtime y build

- Producción corre en **workerd** (Cloudflare Workers). `npm run preview` usa el mismo runtime; con Prisma 7 el módulo es `query_compiler_fast_bg.wasm`, y `next dev`/`next start` siguen sin resolverse fuera de workerd.
- `npm run build:worker` centraliza el build de OpenNext y el parche WASM (16 imports); ya no hace falta `--dangerouslyUseUnsupportedNextVersion`. `next dev`/`next build` usan `--webpack` porque `next.config.js` externaliza el WASM, y `npm run lint` usa la CLI de ESLint 9.
- Auth en producción falla cerrada si falta `ARIA_ACCESS_TOKEN`.

## CI

Tres checks: `Lint, typecheck, unit tests and build`, `Integration tests (Postgres)` y `Audit (no bloqueante)`. Validaciones locales con `DATABASE_URL=postgres://ci:ci@localhost:5432/ci` y `GROQ_API_KEY=x`. Última corrida local: 52 archivos / 542 tests en verde; `build:worker` parchea los 16 imports WASM y compila el Worker.

## Variables de entorno (solo nombres, nunca valores)

`DATABASE_URL`, `GROQ_API_KEY`, `ARIA_ACCESS_TOKEN`, `GITHUB_TOKEN`, `GITLAB_TOKEN`, `BITBUCKET_TOKEN`, `GITHUB_AUTO_MERGE`, `GITHUB_WRITE_ENABLED`, `WHATSAPP_APP_SECRET`, `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`, `EMBEDDING_PROVIDER`, `ARIA_ALLOW_ANY`.

> [!danger] Secretos
> `.env`, `.env.local` y `.dev.vars` contienen secretos reales. No imprimirlos, no commitearlos, no pegarlos en trazas ni en este vault.

## Vault de Obsidian

`npm run docs:vault` copia `README.md`, `ROADMAP.md` y `REPO_MAP.md` al vault del cerebro (`ARIA/Repositorio ai-assistant/`) y los indexa en `VaultNote`. Sin vector, el cerebro no los inyecta (0,17 < umbral 0,4). `reindexVaultEmbeddings` omite notas sin cambios; `force=1` / `--force` lo fuerza.

## Pendiente de infraestructura

Sin verificación real del deploy en Cloudflare ni del webhook de Meta/WhatsApp; `npm run preview` tampoco se pudo abrir aquí porque OpenNext pide sesión de Cloudflare. Auditoría tras Prisma 7 + Next 16: **10 vulnerabilidades** (3 altas de `effect` vía `@prisma/config`, 7 moderadas, 0 críticas). Ver [[Pendientes]].

## Enlaces

[[Inicio]] · [[Seguridad]] · [[Comandos]] · [[Fuentes]]

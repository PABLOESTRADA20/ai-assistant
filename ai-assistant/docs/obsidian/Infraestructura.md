---
title: ARIA — Infraestructura
tags: [aria, infra, build, ci]
updated: 2026-11-23
---

# Infraestructura

## Stack

Next 15.5.28 · React 18 · Tailwind 3.4.x · Prisma 6.19.0 · OpenNext 1.20.6 · wrangler 4.158.0 · Vitest 5.0.3 · @types/node 24.19.1.

## Runtime y build

- Producción corre en **workerd** (Cloudflare Workers). `npm run preview` usa el mismo runtime; con Prisma 7 el módulo es `query_compiler_fast_bg.wasm`, y `next dev`/`next start` siguen sin resolverse fuera de workerd.
- `npm run build:worker` centraliza el build de OpenNext, con `--dangerouslyUseUnsupportedNextVersion` y el parche WASM. No hace falta pasar la bandera a mano.
- Auth en producción falla cerrada si falta `ARIA_ACCESS_TOKEN`.

## CI

Tres checks: `Lint, typecheck, unit tests and build`, `Integration tests (Postgres)` y `Audit (no bloqueante)`. Validaciones locales con `DATABASE_URL=postgres://ci:ci@localhost:5432/ci` y `GROQ_API_KEY=x`. Última corrida: 46 archivos / 461 tests, todo en verde.

## Variables de entorno (solo nombres, nunca valores)

`DATABASE_URL`, `GROQ_API_KEY`, `ARIA_ACCESS_TOKEN`, `GITHUB_TOKEN`, `GITLAB_TOKEN`, `BITBUCKET_TOKEN`, `GITHUB_AUTO_MERGE`, `GITHUB_WRITE_ENABLED`, `WHATSAPP_APP_SECRET`, `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`, `EMBEDDING_PROVIDER`, `ARIA_ALLOW_ANY`.

> [!danger] Secretos
> `.env`, `.env.local` y `.dev.vars` contienen secretos reales. No imprimirlos, no commitearlos, no pegarlos en trazas ni en este vault.

## Vault de Obsidian

`npm run docs:vault` copia `README.md`, `ROADMAP.md` y `REPO_MAP.md` al vault del cerebro (`ARIA/Repositorio ai-assistant/`) y los indexa en `VaultNote`. Sin vector, el cerebro no los inyecta (0,17 < umbral 0,4). `reindexVaultEmbeddings` omite notas sin cambios; `force=1` / `--force` lo fuerza.

## Pendiente de infraestructura

Sin verificación real del deploy en Cloudflare ni del webhook de Meta/WhatsApp. Auditoría: 18 vulnerabilidades (5 altas requieren Prisma 7 o Next 16, saltos autorizados el 2026-11-25 y pendientes de ejecutar). Ver [[Pendientes]].

## Enlaces

[[Inicio]] · [[Seguridad]] · [[Comandos]] · [[Fuentes]]

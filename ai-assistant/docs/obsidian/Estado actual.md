---
title: ARIA — Estado actual
tags: [aria, estado, versiones]
updated: 2026-11-23
---

# Estado actual

> [!tip] Fecha de corte
> 2026-11-23, justo después de fusionar el PR #20.

## Repositorio

- `main` en `1e66de9` (merge de #20), árbol limpio, `origin/main` sincronizado.
- Rama de trabajo local `feat/piloto-refs` todavía existe (las ramas no se borran después del merge).
- PRs fusionados con **merge commit**: #3 → `59974dc`, #13 → `c1ea9e3`, #14 → `eb68f0b`, #17 → `c69e070`, #18 → `58250b7`, #19 → `3530f64`, #20 → `1e66de9`. Ver [[Registro de PRs]].
- PRs de Dependabot **#4–#12 sin revisar**; hay ramas nuevas `dependabot/github_actions/softprops/action-gh-release-3` y `dependabot/npm_and_yarn/ai-assistant/minor-and-patch-20893d2404` (esta con forced update).

## Fases

| Fase | Estado | Nota |
|---|---|---|
| 0 | ✅ | RAM 16 GB, `maxWorkers: 4`, −53 % RAM en tests |
| 1 | ✅ | Parches exactos, PR real #1 en `web_anime` |
| 2 | ✅ | CI consultada antes de decir "listo" |
| 3 | ✅ | Índice completo; detalle de recuentos en [[Fases/Fase 3]] |
| 4 | ✅ | Edición por id, `ChangeLog` y reversión |
| 5 | ❌ | Clasificador no construido: las regex bastaron |
| 6 | ❌ | `aria-v1` entrenado, evaluado, no mejora y borrado |
| 7 | 🟦 | Parte A y B en código; falta OAuth y prueba en vivo |

## Versiones instaladas

| Paquete | Versión |
|---|---|
| `next` | 15.5.28 |
| `@opennextjs/cloudflare` | 1.20.6 |
| `prisma` / `@prisma/client` | 6.19.0 |
| `react` | 18 |
| `tailwindcss` | 3.4.x |
| `wrangler` | 4.158.0 (antes 4.130.0) |
| `@types/node` | 24.19.1 |
| `vitest` | 5.0.3 |

## Calidad

- Última corrida local: `lint` ✅, `typecheck` ✅, `test:unit` ✅ (**46 archivos / 461 tests**), `build` ✅.
- CI del PR #20: 3/3 checks en verde (`Audit`, `Integration tests (Postgres)`, `Lint, typecheck, unit tests and build`).
- Variables usadas para validar: `DATABASE_URL=postgres://ci:ci@localhost:5432/ci` y `GROQ_API_KEY=x`.
- Auditoría: **20 vulnerabilidades** (5 altas, 15 moderadas, 0 críticas). Las altas requieren Prisma 7 o Next 16 → saltos **excluidos sin autorización**. `wrangler@4.158.0` bajó el total de 35 a 20.

## Datos y piloto

- `data/lora/aria-chat.jsonl`: 15 turnos reales + 71 ejemplos sintéticos = 86 (ignorado por git).
- `data/traces/pilot.jsonl`: 14 trazas (10 LLM, 2 demo, 2 sin `meta.mode`); `data/traces/eval.jsonl`: 14 registros de evaluación (últimos 10 = lote actual). Ver [[Piloto/Trazas y evaluación]].
- Resultado del lote: 10 trazas LLM → **6 `ci-passed`, 4 `ci-failed`**; resúmenes 4/4, tests 2/6.

## Bloqueos

- Fase 7 en vivo: faltan `GITHUB_TOKEN`, `GITLAB_TOKEN` y credenciales OAuth; OAuth aún no implementado.
- Sin verificación real del deploy en Cloudflare ni del webhook de Meta/WhatsApp.
- 5 vulnerabilidades altas pendientes de decisión (saltos mayores prohibidos).
- `ROADMAP.md` dice 204/204 ficheros en Fase 3; la reindexación real posterior fue 215 ficheros / 1.344 trozos. Ver [[Pendientes]].

## Reglas operativas

1. Un commit por punto, mensaje en español, rama + PR, nunca `main` directo.
2. Todo cambio de comportamiento lleva tests nuevos en `tests/unit/` con Vitest y `vi.mock`; sin red ni BD real.
3. Después de cada punto: `lint`, `typecheck`, `test:unit`, `build`.
4. No desplegar, no tocar secretos reales, no subir Prisma a v7 sin permiso.
5. El dataset real nunca va a Hugging Face ni a un repo público; ver [[Datos y privacidad]].

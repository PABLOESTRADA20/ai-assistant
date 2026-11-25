---
title: ARIA — Estado actual
tags: [aria, estado, versiones]
updated: 2026-11-24
---

# Estado actual

> [!tip] Fecha de corte
> 2026-11-24, con `main` en `93269a9` (merge del PR #24) y CI 3/3 en verde.

## Repositorio

- `main` en `93269a9` (merge del PR #24), árbol limpio, `origin/main` sincronizado. Antes pasó por `a835beb` (#23), `527137b` (#22) y `b795264` (#15); el build de escritorio se actualizó en `13d82c6`.
- Las ramas ya fusionadas no se borran: `fix/general-errors`, `docs/post-merge-22`, `feat/oauth-fase7` y el resto siguen vivas.
- PRs fusionados con **merge commit**: #3 → `59974dc`, #13 → `c1ea9e3`, #14 → `eb68f0b`, #17 → `c69e070`, #18 → `58250b7`, #19 → `3530f64`, #20 → `1e66de9`, #21 → `1ea90f0`, #16 → `af0032b`, #15 → `b795264`, #22 → `527137b`, #23 → `a835beb`, #24 → `93269a9`. Ver [[Registro de PRs]].
- Dependabot revisado: #15 y #16 fusionados con CI verde; #4–#7/#9–#12 quedan sin fusionar (saltos mayores superados o CI roja), #8 cerrado. Ver [[Pendientes]].

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
| 7 | 🟦 | Parte A y B en código; OAuth implementado con mocks; falta prueba real y en vivo |

## Versiones instaladas

| Paquete | Versión |
|---|---|
| `next` | 15.5.29 |
| `@opennextjs/cloudflare` | 1.20.17 |
| `prisma` / `@prisma/client` | 6.19.3 |
| `react` | 18 |
| `tailwindcss` | 3.4.x |
| `wrangler` | 4.164.0 (antes 4.158.0 y 4.130.0) |
| `@types/node` | 24.19.1 |
| `vitest` | 5.1.0 |

## Calidad

- Última corrida local (rama `feat/oauth-fase7`, ya en `main`): `lint` ✅, `typecheck` ✅, `test:unit` ✅ (**50 archivos / 516 tests**), `build` ✅.
- CI de #22, #23 y #24: 3/3 checks en verde (`Audit`, `Integration tests (Postgres)`, `Lint, typecheck, unit tests and build`). #15, #16 y #21 también cerraron con 3/3.
- Variables usadas para validar: `DATABASE_URL=postgres://ci:ci@localhost:5432/ci` y `GROQ_API_KEY=x`.
- Auditoría tras #16: **18 vulnerabilidades** (5 altas, 13 moderadas, 0 críticas). Las altas requieren Prisma 7 o Next 16 → saltos **excluidos sin autorización**. Antes eran 20 (5 altas, 15 moderadas).

## Datos y piloto

- `data/lora/aria-chat.jsonl`: 15 turnos reales + 71 ejemplos sintéticos = 86 (ignorado por git).
- `data/traces/pilot.jsonl`: 14 trazas (10 LLM, 2 demo, 2 sin `meta.mode`); `data/traces/eval.jsonl`: 14 registros de evaluación (últimos 10 = lote actual). Ver [[Piloto/Trazas y evaluación]].
- Resultado del lote: 10 trazas LLM → **6 `ci-passed`, 4 `ci-failed`**; resúmenes 4/4, tests 2/6.
- `data/lora/testgen-react/`: 6 ejemplos ReAct/CoT (2 aprobados + 4 correcciones), `4 train / 2 valid` por PR (estratificado), `manifest.json` con early stopping. Ignorado por git; ver [[Piloto/Trazas y evaluación]].

## Bloqueos

- Fase 7 en vivo: faltan `GITHUB_TOKEN`, `GITLAB_TOKEN` y credenciales OAuth reales; el flujo OAuth ya está implementado y cubierto con mocks, pero no probado con apps reales.
- Sin verificación real del deploy en Cloudflare ni del webhook de Meta/WhatsApp.
- 5 vulnerabilidades altas pendientes de decisión (saltos mayores prohibidos).
- Reindexación forzada no ejecutada aquí: sin Docker, `TEST_DATABASE_URL` ni cuota. El recuento vigente (215/215 y 1.344 trozos) ya está en `ROADMAP.md`; el comando es `npm run db:index-code -- --force`. Ver [[Pendientes]].

## Reglas operativas

1. Un commit por punto, mensaje en español, rama + PR, nunca `main` directo.
2. Todo cambio de comportamiento lleva tests nuevos en `tests/unit/` con Vitest y `vi.mock`; sin red ni BD real.
3. Después de cada punto: `lint`, `typecheck`, `test:unit`, `build`.
4. No desplegar, no tocar secretos reales, no subir Prisma a v7 sin permiso.
5. El dataset real nunca va a Hugging Face ni a un repo público; ver [[Datos y privacidad]].

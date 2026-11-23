---
title: Piloto — Trazas y evaluación
tags: [aria, piloto, evaluacion, veredictos]
updated: 2026-11-23
---

# Trazas y evaluación

## Cómo se evalúa

`npm run pilot:eval` aplica una rúbrica 0-5: seguridad, import de Vitest, aserciones, path nuevo y referencia a archivos cambiados. Descarta código con red, BD, procesos o secretos, ejecuta los tests propuestos en un worktree temporal apuntando al subdirectorio `ai-assistant/`, y guarda veredictos en `data/traces/eval.jsonl`.

## Primera corrida (2026-11-20)

4 trazas LLM: **1 `ci-passed`** (resumen de PR) y **3 `ci-failed`** (dos proponían paths existentes; la tercera asumía `Object.isFrozen(PILOT_VERDICTS)`).

## Lote del 2026-11-23

Se generaron 6 trazas con `--ref=` sobre los PRs #17 (`c69e070`), #18 (`58250b7`) y #19 (`3530f64`) con veredicto `ci-passed`. Total evaluado: **10 trazas LLM → 6 aprobadas, 4 rechazadas**.

| Tarea | Aprobadas | Rechazadas |
|---|---:|---:|
| Resumen de PR | 4/4 | 0 |
| Test generado | 2/6 | 4 |

- Los dos tests aprobados vinieron de **#17** y **#18**.
- El fallo de **#19** fue inventar `evaluatePilot`, que no existe (debió usar `evaluateTestProposal`).
- Los otros fallos son del working tree inicial: paths ya existentes y la suposición falsa de `Object.isFrozen`.

## Lectura

El resumidor es consistente en formato (4/4), pero su rúbrica **no ejecuta código**: 4/4 no prueba corrección. El **generador de tests** tiene fallos reales y verificables (2/6): es donde conviene construir el dataset con **held-out** y **early stopping**.

> [!danger] Fase 6 sigue cerrada
> No se reentrena hasta tener veredictos y un dataset con held-out. Ver [[Fases/Fase 6]] y [[Pendientes]].

## Enlaces

[[Inicio]] · [[Piloto/Piloto de trazas]] · [[Decisiones]] · [[Pendientes]]

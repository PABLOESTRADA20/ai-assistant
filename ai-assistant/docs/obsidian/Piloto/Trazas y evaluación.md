---
title: Piloto — Trazas y evaluación
tags: [aria, piloto, evaluacion, veredictos]
updated: 2026-11-25
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

El resumidor es consistente en formato (4/4), pero su rúbrica **no ejecuta código**: 4/4 no prueba corrección. El **generador de tests** tiene fallos reales y verificables (2/6): es donde se construyó el dataset con **held-out** y **early stopping**.

## Lote del 2026-11-25

20 trazas nuevas sobre 10 commits reales con la clave de `.env.local`, sin imprimirla ni desplegar. Total acumulado: **30 trazas → 21 aprobadas / 9 rechazadas**.

| Tarea | Aprobadas | Rechazadas |
|---|---:|---:|
| Resumen de PR | 14/14 | 0 |
| Test generado | 7/16 | 9 |

El prompt de generación pide ahora verificar cada símbolo contra el diff antes de importarlo; aun así el generador sigue siendo el cuello de botella. El resumidor mantiene 14/14 solo de formato.

## Dataset ReAct/CoT (2026-11-25)

`npm run pilot:dataset` une cada traza con su última evaluación y conserva solo propuestas de tests con veredicto. Los 7 casos `ci-passed` guardan el código aprobado; los 9 `ci-failed` guardan el razonamiento y la corrección, **sin repetir el código rechazado** (el fallo de #19 enseña a usar `evaluateTestProposal`, no `evaluatePilot`).

Antes de escribir, la auditoría rechaza fuga de grupo entre splits, veredictos ausentes en `valid`, secretos sin limpiar, `evaluatePilot(` y paths fuera de `tests/unit/`. El split agrupa por `meta.ref` → hash de `changedFiles` → traza individual, y estratifica `valid`. Resultado actual: **16 ejemplos** (7 OK / 9 corrección), `12 train / 4 valid`, 16 grupos, auditoría limpia, `early stopping` sobre `valid_loss` con `patience=2`. Archivos en `data/lora/testgen-react/` (ignorado); la fuente de verdad del formato está en [[Fuentes]] → `training/README.md`.

> [!danger] Fase 6 sigue cerrada
> No se reentrena hasta tener veredictos y un dataset con held-out suficiente; los 16 ejemplos actuales solo validan el formato y la puerta de calidad. Ver [[Fases/Fase 6]] y [[Pendientes]].

## Enlaces

[[Inicio]] · [[Piloto/Piloto de trazas]] · [[Decisiones]] · [[Pendientes]]

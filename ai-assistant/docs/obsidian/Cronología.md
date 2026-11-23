---
title: ARIA — Cronología
tags: [aria, historia, linea-de-tiempo]
updated: 2026-11-23
---

# Cronología

> [!info] Cómo leerla
> Cada entrada enlaza con la nota desarrollada. Los PRs locales están detallados en [[Registro de PRs]].

## 2026-10-14 — arranque

- [[Fases/Fase 0|Ajustes del PC]]: RAM confirmada (2×8 GB, 8C/12T), `.wslconfig`, `webpackMemoryOptimizations`, `maxWorkers: 4`. Tests: pico 790 → 373 MB (−53 %).
- [[Fases/Fase 1|Parches]] y [[Fases/Fase 2|CI]]: `github_apply_patch`, `github_get_check_runs`, tope de 2 correcciones.
- Aceptación en vivo sobre `PABLOESTRADA20/web_anime`: PR #1, diff `+2/−0`, `main` intacta, fallo de CI preexistente reportado sin parchear.
- Decisión: el modelo propio pasa a opcional y al final; [[Fases/Fase 5|clasificador]] y [[Fases/Fase 6|LoRA]] quedan para después.

## 2026-10-15 — datos auditados

- [[Fases/Fase 4|Memorias y notas]]: `update_memory`, `update_cloud_note`, `ChangeLog`, `revert_change`, límite de 12 cambios/min.
- Prueba en vivo desde el Worker local (`npm run preview`, workerd) con SSE: destapó que `recall_memory` no devolvía `id` y que "editá mi nota" no ofrecía la herramienta. Ambos corregidos, junto con el voseo `recordás`.

## 2026-10-16 — descartes y decisiones grandes

- [[Fases/Fase 5|Clasificador descartado]]: sonda con 34 frases → 4 fallos morfológicos, 0 falsos positivos; 25 schemas costaban 4.777 tokens. Se ampliaron las regex con `(?!\w)`.
- [[Fases/Fase 7|Fase 7]]: el usuario decide fusión solo tras CI, borrado, ramas libres, GitHub + GitLab + OAuth, uso single-user.
- [[Fases/Fase 6|LoRA reabierta]]: la verificación inicial era falsa (miró sufijos `-lora`); el facet `?capabilities=LoRA` lista 9 bases, incluidas Qwen 32B.
- Puente [[Infraestructura#Vault de Obsidian|documentación → vault]] (`npm run docs:vault`) y reindexado incremental del vault.

## 2026-10-30 — índice y endurecimiento

- [[Fases/Fase 3|Índice]]: 203/203 ficheros, 1.229 trozos; `REPO_MAP.md` excluido del autoíndice; `search_code` validado contra Postgres con `npm run db:smoke-code`.
- Serving LoRA en vivo: bases `-lora` y adaptadores propios responden 200; los públicos `cf-public-*` siguen en 500.
- Cuaderno de Kaggle completo; PR #3 de [[Seguridad|endurecimiento]] (12 commits) y `wrangler@4.158.0`.

## 2026-11-02 — dataset e índice cerrados

- [[Fases/Fase 6|Dataset]]: 15 reales + 71 sintéticos = 86 ejemplos, con `scrubText` (1 IP anonimizada, 0 secretos).
- [[Fases/Fase 3|Índice]]: 204/204 ficheros y 1.245 trozos; pasada sin cambios con `embeddings.api: 0`.
- Más adelante, un arreglo del chunker (ignorar llaves dentro de regex literales) obligó a reindexar: 215 ficheros / 1.344 trozos / 155 con símbolos / 0 fallos.

## 2026-11-13 — Fase 6 descartada

- Entrenamiento en Kaggle, adaptador `aria-v1` subido a Cloudflare y evaluado con 24 casos nuevos × 2 prompts × base/LoRA = 96 generaciones y 48 comparaciones ciegas.
- Base ganó 16–7–1 y 11–9–4. El LoRA perdió corrección/completitud y repitió líneas; se borró. PR #14 documenta el descarte. Ver [[Fases/Fase 6]].

## 2026-11-19/20 — piloto con veredicto

- PR #17: trazas deterministas (`pilot:demo`) con `TraceSink` inyectable; 18 tests nuevos.
- PR #18: cliente Groq opt-in (`--live`, `scrubText` antes de enviar, `fetch` inyectable); 14 tests nuevos. `gpt-oss-20b` falló con `Tool choice is none...` → se usa `qwen/qwen3.8-27b`.
- PR #19: `pilot:eval` con rúbrica 0-5, filtros de seguridad y worktree temporal; 10 tests nuevos. Primera corrida: 4 trazas → 1 aprobada, 3 rechazadas.

## 2026-11-23 — lote de PRs reales

- PR #20: `--ref=<commit>` para tomar diffs de PRs fusionados y reintento de 429/5xx; 2 tests nuevos.
- Se generaron 6 trazas de #17/#18/#19 con veredicto `ci-passed`; `pilot:eval` evaluó 10 trazas: 6 aprobadas y 4 rechazadas.
- Por tarea: resúmenes **4/4**, tests generados **2/6**. El fallo de #19 fue inventar `evaluatePilot` en vez de `evaluateTestProposal`.
- Conclusión: construir el dataset ReAct/CoT para el **generador de tests** con held-out y early stopping; Fase 6 permanece cerrada. Ver [[Piloto/Trazas y evaluación]].

## Regla para futuras sesiones

Al cerrar una sesión, añadir aquí una entrada corta y actualizar [[Estado actual]] + la nota de fase correspondiente.

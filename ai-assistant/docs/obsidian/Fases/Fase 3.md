---
title: Fase 3 — Índice de código + mapa del repo
tags: [aria, fase3, rag, indice]
estado: hecha
updated: 2026-11-23
---

# Fase 3 — Índice de código + mapa del repo ✅

## Qué se construyó

- Migración `prisma/migrations/20261014120000_code_index/`: tabla `CodeChunk` con índices **HNSW** (vectorial) y **GIN** (léxico).
- `scripts/index-code.ts`: troceo por función/clase/archivo, salta ficheros por `fileHash` y trozos por `contentHash`, reutiliza `EmbeddingCache`, swap atómico y respeta la cuota diaria de Workers AI (`fallbackBudgetLeft`).
- `searchCode` fusiona vectorial y léxica con `orFuse`; herramienta `search_code` en `tools.ts`, `selectTools` y `TOOL_GROUPS.code`.
- `REPO_MAP.md` se genera solo si cambia y se excluyó del índice (`GENERATED_FILES`) para que la pasada sin cambios diera cero.
- 16 tests en `tests/unit/code-index.test.ts` y smoke real con `npm run db:smoke-code`.

## Pasadas reales

| Fecha | Resultado |
|---|---|
| 2026-10-14 | 48/185 ficheros, 248 trozos, ≈7.999 neuronas; cortó por cuota. |
| 2026-10-15 | 92/187, 574 trozos; `P1001` transitorio de Neon, reanudable. |
| 2026-10-30 | 203/203 ficheros, 1.229 trozos, `failed 0`. |
| 2026-11-02 | 204/204 ficheros, 1.245 trozos; pasada sin cambios con `embeddings.api: 0` ✅. |
| Posterior | Tras arreglar el chunker para ignorar llaves en regex literales: **215 ficheros / 1.344 trozos / 155 con símbolos / 0 fallos**. |

> [!warning] `ROADMAP.md` sigue diciendo 204/204 y 1.245 trozos. La última reindexación real fue 215/1.344. Tras cualquier cambio del chunker hay que forzar reindexación completa. Ver [[Pendientes]].

## Decisiones

Un solo modelo `CodeChunk`; índice léxico con `simple` (identificadores literales); `search_code` no se gatea por repos; `REPO_MAP.md` es solo documento (~2.282 tokens); el troceo es heurístico, puede partir de más pero nunca pierde código.

## Enlaces

[[Inicio]] · [[Fases/Fase 4]] · [[Infraestructura]] · [[Pendientes]]

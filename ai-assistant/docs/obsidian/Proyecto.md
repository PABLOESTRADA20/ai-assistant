---
title: ARIA — Proyecto
tags: [aria, vision, arquitectura]
updated: 2026-11-23
---

# Proyecto

> [!abstract] Visión
> ARIA es un asistente que puede **modificar código y archivos con cambios pequeños y seguros**, verificar el resultado con CI, conocer el repo por significado y (opcionalmente) usar un modelo propio afinado. Todo sin sobrecargar la PC: lo pesado va a la nube o es incremental.

Repo: `PABLOESTRADA20/ai-assistant`. Usuario único (no multiusuario), confirmado en las decisiones de la [[Fases/Fase 7|Fase 7]].

## Objetivos del roadmap

1. Edición precisa con verificación ([[Fases/Fase 1]], [[Fases/Fase 2]]).
2. Contexto del repo por búsqueda semántica ([[Fases/Fase 3]]).
3. Edición auditada y reversible de datos ([[Fases/Fase 4]]).
4. Modelo propio opcional ([[Fases/Fase 6]], descartado con evidencia).
5. Escritura avanzada multi-plataforma ([[Fases/Fase 7]], en curso).

## Arquitectura en una mirada

| Capa | Qué hace | Entradas/salidas |
|---|---|---|
| Chat `/api/chat` | bucle de herramientas y streaming | SSE sin cambios desde el refactor (`chat-events.ts`) |
| Selección de tools | `selectTools` + `TOOL_GROUPS` + regex | elige schemas según la orden en lenguaje natural |
| GitHub / GitLab | `git.ts` distribuye a `github.ts` / `gitlab.ts` sobre `git-common.ts` | PRs, MRs, checks, borrado, auto-fusión |
| Índice de código | `CodeChunk` + `searchCode` (vectorial + léxica) | herramienta `search_code`, `REPO_MAP.md` |
| Memorias y notas | `VaultNote`, `Note`, `ChangeLog` | `update_memory`, `update_cloud_note`, `revert_change` |
| Cerebro / vault | notas copiadas al vault de Obsidian e indexadas | `npm run docs:vault`, `VaultNote` |
| Modelo | base de Cloudflare + Groq + adaptadores LoRA | Fase 6 descartada; ver [[Piloto/Piloto de trazas]] |
| Agente local | ejecuta comandos con política de destinos | `ARIA_ALLOW_ANY` **no** permite ejecutables por ruta |

## Runtime

- Next 15.5.28 + React 18 + Tailwind 3.4.x, empaquetado con OpenNext 1.20.6 para **workerd** (Cloudflare Workers).
- Prisma 6.19.0 (SQL crudo donde el cliente generado no alcanza).
- Vitest 5.0.3 con `maxWorkers: 4`.
- El build se centralizó en `npm run build:worker` con `--dangerouslyUseUnsupportedNextVersion` y parche WASM. Detalles en [[Infraestructura]].

## Flujo de cambio seguro

```text
rama propia → commit → PR → CI (lint / typecheck / unit / build + Postgres + audit)
      → merge commit en main → (opcional) reindexación
```

La auto-fusión de la [[Fases/Fase 7|Fase 7]] respeta exactamente ese flujo: nunca escribe en `main` y exige CI en verde.

## Relaciones

- Estado vivo: [[Estado actual]].
- Historia: [[Cronología]] y [[Registro de PRs]].
- Motivos: [[Decisiones]].
- Operación: [[Comandos]], [[Infraestructura]], [[Seguridad]].

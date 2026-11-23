---
title: Fase 0 — Ajustes del PC
tags: [aria, fase0, rendimiento]
estado: hecha
fecha: 2026-10-14
---

# Fase 0 — Ajustes del PC ✅

## Objetivo

Bajar el consumo de memoria para poder trabajar con Next, Vitest y el build sin saturar la PC.

## Hecho

- RAM real confirmada por varias fuentes del sistema: **2×8 GB = 16 GB**, 8 núcleos / 12 hilos (Intel Core 5 210H), máximo 64 GB.
- `C:\Users\pablo\.wslconfig`: `memory=6GB`, `processors=6`, `swap=4GB`, `autoMemoryReclaim=gradual`. **WSL no tiene distro instalada**, así que su efecto no se pudo medir.
- `next.config.js` con `experimental.webpackMemoryOptimizations: true`: pico del build 1811 → 1751 MB (−3 %), **no aporta ahorro real**; se conserva porque no rompe nada.
- `vitest.config.ts` con `maxWorkers: 4` (en Vitest 5.0.3 se llama `maxWorkers`, no `maxThreads`).
- Fuera del roadmap: `poweredByHeader: false` y cabeceras de seguridad base.

## Evidencia

| Métrica | Antes | Después |
|---|---:|---:|
| Pico RAM en `test:unit` | 790 MB | 373 MB (**−53 %**, +0,2 s) |
| Pico RAM en build | 1811 MB | 1751 MB (−3 %) |
| Tests unitarios | — | 257 en verde |

Aceptación: `npm run dev` respondió HTTP 200 en <15 s, `typecheck` y `test:unit` en verde.

## Decisiones relacionadas

- No se usa `isolate: false` en Vitest: `github-patch` y `github-checks` mockean Prisma con estados distintos y se pisarían.
- Se conserva `webpackMemoryOptimizations` pese a no medir ahorro: ayuda en escenarios de RAM escasa (p. ej. CI).

## Enlaces

[[Inicio]] · [[Cronología]] · [[Decisiones]] · [[Infraestructura]]

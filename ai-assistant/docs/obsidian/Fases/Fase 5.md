---
title: Fase 5 — Clasificador de herramientas (descartada)
tags: [aria, fase5, descartada, regex]
estado: descartada
fecha: 2026-10-16
---

# Fase 5 — Clasificador de herramientas ❌ Descartada (2026-10-16)

## Decisión

**No se construye el clasificador.** Se ampliaron las regex y los tests.

## Evidencia de la sonda local (0 API)

Sobre **34 frases reales**, la selección por regex daba:

- **4 fallos de cobertura** y **0 ofertas indebidas**.
- Los 4 fallos eran **morfológicos**, no semánticos: voseo `abrí` / `buscá` / `sabés` y plural `se guardan`.
- Coste de los 25 schemas: **4.777 tokens** (solo `github`: 1.027), frente a los 897 del system prompt.

## Alternativa aplicada

- Se cerraron los 4 huecos en `select-tools.test.ts`.
- Se corrigió la causa raíz: en JS `\w` es `[A-Za-z0-9_]`, así que `\b` **no** ve el final de palabra tras una vocal acentuada. Se usa `(?!\w)` al final de los grupos que pueden terminar en `á/í/é`. Ya lo hacía `RX_GITHUB_WRITE`; se aplicó a `LOOKS_LIKE_ORDER`, `RX_APPS` y `RX_CODE_SEARCH`.
- Coste: $0, 0 latencia, determinista. 292 tests verdes.

## Por qué no se construyó

Un clasificador solo se justificaría con muchas más herramientas y presupuesto. Aquí añadiría latencia y cuota, y habría que mantener el fallback a regex igualmente. Es una decisión **revisable** si el catálogo crece mucho.

## Enlaces

[[Inicio]] · [[Decisiones]] · [[Glosario]]

---
title: ARIA — Comandos
tags: [aria, comandos, recetario]
updated: 2026-11-23
---

# Comandos

## Validación obligatoria tras cada punto

```
npm run lint
npm run typecheck
npm run test:unit
npm run build
```

Con `DATABASE_URL=postgres://ci:ci@localhost:5432/ci` y `GROQ_API_KEY=x` para CI.

## Índice y datos

```
npm run db:index-code
npm run db:smoke-code
npm run db:dataset -- --dry
npm run db:dataset -- --fake
npm run docs:vault
npm run db:reindex -- --force
```

## Piloto

```
npm run pilot:demo
npm run pilot:llm -- --live --model=qwen/qwen3.8-27b --max-tokens=900 --verdict=ci-passed
npm run pilot:llm -- --live --ref=3530f64 --verdict=ci-passed --retries=2
npm run pilot:eval
npm run pilot:eval -- --all
```

`--ref=` toma el diff de un commit contra su primer padre. `--retries=` reintenta 429/5xx. El modo real requiere `--live` y `GROQ_API_KEY`; revisa el diff antes de correrlo.

## LoRA (histórico, no reactivar)

```
npm run lora:upload -- --dir=aria-lora --name=aria-v1
npm run lora:upload -- --delete --name=aria-v1
```

## Build de Worker

```
npm run build:worker
npm run preview
```

## Enlaces

[[Inicio]] · [[Infraestructura]] · [[Piloto/Piloto de trazas]] · [[Fases/Fase 6]]

---
title: Piloto — Trazas
tags: [aria, piloto, trazas, groq]
updated: 2026-11-23
---

# Piloto de trazas

## Volante

`Aplicación → trazas → evaluación → escala`. Se creó para generar señal **antes** de reintentar un modelo, sin reabrir [[Fases/Fase 6|Fase 6]].

## Archivos

| Archivo | Función |
|---|---|
| `app/lib/pilot-tasks.ts` | prompts y parsers de test unitario y resumen de PR |
| `app/lib/pilot-run.ts` | orquestación, anonimización previa y trazas |
| `app/lib/pilot-traces.ts` | `TraceSink`, `EvalSink`, tipos y veredictos |
| `app/lib/pilot-llm.ts` | cliente Groq opt-in, `fetch` inyectable, `--ref`, reintentos |
| `app/lib/pilot-eval.ts` | rúbrica, filtros y veredictos |
| `scripts/pilot-demo.ts` | completor determinista, sin red |
| `scripts/pilot-llm.ts` | script real con `--live`, `--model`, `--max-tokens`, `--verdict`, `--score`, `--ref`, `--retries` |
| `scripts/pilot-eval.ts` | evalúa en worktree temporal y escribe `eval.jsonl` |

## Modo real

- Opt-in: `--live` y `GROQ_API_KEY`.
- `scrubText` **antes** de enviar el prompt; no despliega, no toca la BD, no imprime la clave.
- `gpt-oss-20b` falló con `Tool choice is none, but model called a tool` → usar `qwen/qwen3.8-27b`.
- System prompt recortado a 1.500 caracteres y diff a 4.000 por límites ITPM/OTPM del free tier; `--max-tokens=900` funcionó.
- `--ref=<commit>` usa el diff contra el primer padre, ideal para PRs ya fusionados.
- `--retries=` (por defecto 2) reintenta 429/5xx respetando el "try again in Xs" de Groq.

## Salidas

`data/traces/pilot.jsonl` y `data/traces/eval.jsonl`, ignorados por git. Ver [[Piloto/Trazas y evaluación]] y [[Datos y privacidad]].

## Enlaces

[[Inicio]] · [[Piloto/Trazas y evaluación]] · [[Comandos]] · [[Fases/Fase 6]]

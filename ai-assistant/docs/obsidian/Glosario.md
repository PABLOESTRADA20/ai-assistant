---
title: ARIA — Glosario
tags: [aria, glosario]
updated: 2026-11-23
---

# Glosario

- **ARIA**: asistente del repo `PABLOESTRADA20/ai-assistant`.
- **SSE**: Server-Sent Events; el formato del chat no cambió en el refactor.
- **workerd**: runtime de Cloudflare Workers que usa la app en producción y en `npm run preview`.
- **OpenNext**: adaptador que empaqueta Next para Workers.
- **WASM**: módulo de Prisma que obliga a usar workerd.
- **LoRA / QLoRA**: fine-tuning con adaptador pequeño; `r ≤ 8`, <300 MB.
- **Adaptador**: `adapter_config.json` + `adapter_model.safetensors`.
- **RAG**: búsqueda por significado sobre el índice de código (`search_code`).
- **ReAct / CoT**: trazas de razonamiento y uso de herramientas para el dataset futuro.
- **Traza**: registro de una ejecución del piloto en `data/traces/pilot.jsonl`.
- **Veredicto**: `ci-passed`, `ci-failed` o `needs-review`.
- **Held-out**: conjunto de evaluación que el modelo no ve durante el entrenamiento.
- **Early stopping**: detener el entrenamiento cuando la métrica de validación deja de mejorar.
- **Chunker**: troceador de código para el índice.
- **ITPM / OTPM**: límites de tokens por minuto de entrada/salida de Groq.
- **MOC**: Mapa de contenido; en esta bóveda es [[Inicio]].
- **Vault**: carpeta de Obsidian; el cerebro de ARIA indexa notas en `VaultNote`.

## Enlaces

[[Inicio]] · [[Fuentes]]

---
title: ARIA — Datos y privacidad
tags: [aria, privacidad, datos]
updated: 2026-11-23
---

# Datos y privacidad

## Archivos ignorados

- `data/lora/aria-chat.jsonl`: 15 turnos reales + 71 sintéticos = 86 ejemplos.
- `data/traces/pilot.jsonl` y `data/traces/eval.jsonl`: trazas y veredictos.
- `.env`, `.env.local`, `.dev.vars`: secretos. **No imprimir valores.**

## Reglas

- `scrubText` / `scrub.ts` anonimizan antes de escribir o enviar: claves, correos, IPs, rutas con usuario, teléfonos, DNI, tarjetas y hashes.
- El piloto anonimiza el diff **antes** de enviarlo a Groq y el modo real es opt-in (`--live`).
- **El dataset real de conversaciones nunca debe subirse a Hugging Face ni a un repo público.** El dataset de Kaggle debe ser privado.
- `aria-chat.jsonl` tiene conversaciones reales; el set sintético sí se versiona porque no contiene datos personales.
- Los tests no tocan la BD real ni hacen red; el ZIP `aria-lora.zip` quedó fuera del repo.

## Verificación hecha

Export real: 6 conversaciones, 32 mensajes, 46.719 bytes, 1 IP anonimizada, 0 secretos detectados. Ampliación posterior: 1 IP anonimizada y 0 secretos. Evaluación LoRA con 24 casos nuevos y 48 comparaciones ciegas, sin exponer datos personales.

## Enlaces

[[Inicio]] · [[Fases/Fase 6]] · [[Piloto/Piloto de trazas]] · [[Seguridad]]

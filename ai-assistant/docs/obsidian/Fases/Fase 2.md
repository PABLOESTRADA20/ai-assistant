---
title: Fase 2 — Verificar antes de dar por bueno
tags: [aria, fase2, ci, github]
estado: hecha
fecha: 2026-10-14
---

# Fase 2 — Verificar antes de dar por bueno ✅

## Qué se construyó

- `github_get_check_runs` (solo lectura) con resumen del check fallido y sus anotaciones.
- Regla en el prompt: consultar los checks tras abrir o parchear un PR; **nunca decir "listo" sin verlos**.
- Parche de corrección en la **misma rama** con tope de `MAX_FIX_ATTEMPTS = 2` por PR.
- Tests: `success`, `failure`, `pending`, sin checks y límite de reintentos.

## Aceptación en vivo (2026-10-14)

En el mismo PR #1 de `web_anime`:

- La herramienta devolvió `state:"failure"` con el check fallido y sus anotaciones (tests `useComments`/`useGamification`, aviso de Node 20).
- ARIA **reportó qué falló** y explicó por qué no parcheaba: era un fallo preexistente ajeno al cambio de README.
- Un 2.º `github_apply_patch` **con `branch`** commiteó en la misma rama (`pull_request: null`, `fix_attempts` 1 → 2).
- El 4.º intento fue rechazado por el tope: "ya recibió 2 correcciones automáticas".

## Matiz de temporización (resuelto 2026-11-24)

Si se consulta justo tras abrir el PR, GitHub todavía no ha creado el check (0 checks). Antes el resumen decía `state:"none"` ("sin checks configurados") cuando lo correcto era **pendiente, reintenta**. Ahora `getCheckRuns` mira la fecha de creación del PR (o del commit de la rama): con menos de 2 minutos y sin checks devuelve `state:"pending"`, `checks_registered:false` y un aviso; `mergePullRequest` bloquea la fusión en ese caso. Si el PR es viejo y sigue sin checks, mantiene `none` y la auto-fusión puede avisar y fusionar.

Además, el CI de `web_anime` ya estaba roto en `main` antes de la prueba; no se tocó.

## Enlaces

[[Inicio]] · [[Fases/Fase 1]] · [[Seguridad]] · [[Pendientes]]

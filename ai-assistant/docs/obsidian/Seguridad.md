---
title: ARIA — Seguridad
tags: [aria, seguridad, auth, whatsapp]
updated: 2026-11-24
---

# Seguridad

## Autenticación

- La app acepta **solo** `Authorization: Bearer`: la clave compartida o una sesión OAuth firmada (HMAC-SHA256). La cookie `aria_token` **ya no autoriza**; `aria_oauth_state` es solo anti-CSRF.
- En producción la app falla cerrada si falta `ARIA_ACCESS_TOKEN` (guard en el deploy + tests). `requireAuth` sí acepta una sesión OAuth válida aunque falte esa clave.
- OAuth de GitHub/Google **en código**: `state` en cookie HttpOnly, canje de código, lista blanca de un solo usuario y sesión de 7 días por defecto (`ARIA_SESSION_TTL_SECONDS`). Falta probarlo con apps y credenciales reales; ver [[Fases/Fase 7]].

## WhatsApp

- Exige `WHATSAPP_APP_SECRET` y una firma válida; firma inválida responde **401**.
- Deduplica por `whatsapp:msg:<id>` durante **7 días**.
- La lista blanca **solo filtra números**, no autentica: no sustituye a la firma.

## Agente local

- Bloquea ejecutables **por ruta** aunque `ARIA_ALLOW_ANY=1`; esa variable solo permite comandos sueltos del PATH.
- `open_app` pide confirmación y aplica una política de destinos.

## Git

- Nunca se escribe directo en `main`: rama + PR + CI.
- Borrado de archivos sin carpetas completas ni `.github/workflows`, tope de 10 archivos.
- Ramas con nombre libre validadas (`isValidBranchName`/`validateBranch`), nunca la principal.
- Auto-fusión solo con CI en verde (o aviso explícito de "sin checks") e interruptor aparte `GITHUB_AUTO_MERGE`.

## Chat y herramientas

- El refactor del chat conservó **exactamente** el SSE actual (`chat-events.ts`).
- Bucle de herramientas: contexto recortado, `TOOL_ROUND_MAX_TOKENS = 1024`, `max_tokens` calculado desde el TPM free de Groq (8000 − 256).
- Los tests no hacen red ni usan BD real: todo con `vi.mock`.

## Enlaces

[[Inicio]] · [[Fases/Fase 7]] · [[Infraestructura]] · [[Datos y privacidad]]

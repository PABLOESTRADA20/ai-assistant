---
title: ARIA — Pendientes
tags: [aria, pendientes, bloqueos]
updated: 2026-11-24
---

# Pendientes

> [!warning] Fase 7 no se cierra
> Falta probarla con tokens y OAuth reales.

## Bloqueos externos

1. **OAuth real** de GitHub/Google: el código y los botones ya están; faltan las apps, los secretos (`*_OAUTH_CLIENT_ID`, `*_OAUTH_CLIENT_SECRET`, `*_OAUTH_ALLOWED_*`, `ARIA_SESSION_SECRET`, `ARIA_OAUTH_REDIRECT_BASE`) y probar el flujo de extremo a extremo.
2. Token de **GitLab** y prueba en vivo de lectura/escritura, MR, pipelines y auto-fusión.
3. Prueba real en GitHub de `github_delete_file` y `github_merge_pull_request` con CI verde (`GITHUB_AUTO_MERGE=false` salvo durante la prueba).
4. Verificar el **deploy en Cloudflare** y el **webhook de Meta/WhatsApp**.
5. Credenciales y entorno: hoy no hay `GITHUB_TOKEN`, `GITLAB_TOKEN`, `WHATSAPP_APP_SECRET`, credenciales OAuth ni `kaggle.json`.

## Deuda técnica

- 5 vulnerabilidades altas: exigen Prisma 7 o Next 16 → **no se suben sin autorización**. Tras #16 el total bajó de 20 a 18 (13 moderadas).
- Dependabot actualizado el 2026-11-25: fusionados #15, #16, #4–#7 y #10 (todos con CI verde). Siguen abiertos #9 (CI roja), #11 (`@types/node` 26) y #12 (Tailwind 4), excluidos por las versiones acordadas; #8 estaba cerrado. No se cierran sin decisión explícita.
- OpenNext 1.20.16 evaluado: exige Next ≥15.5.29; #16 trae 1.20.17 + Next 15.5.29. No se acepta nada que requiera Next 16.
- [x] `ROADMAP.md` actualizado al recuento real: 215/215 ficheros y 1.344 trozos. Existe `npm run db:index-code -- --force` para repetir la indexación tras cambiar el chunker.
- [x] Matiz de Fase 2 resuelto: PR recién abierto sin checks → `pending` + `checks_registered:false`; la auto-fusión espera.
- [x] Fase 4: añadido `tests/integration/changelog.test.ts` para el SQL crudo (se omite sin `TEST_DATABASE_URL`). Siguen pendientes la ruta de embedding con cuota agotada y el solapamiento "nota" con el vault.
- [x] `next dev` y `next start` ya no buscan el `.wasm` en `.next/server`: el externalizado es solo del build del worker.
- WSL sin distro instalada: `.wslconfig` no se pudo medir.
- CI de `web_anime` ya roto en `main` antes de las pruebas; no es culpa de ARIA.
- Sin Docker ni `TEST_DATABASE_URL` en esta PC: el test de integración no se ha ejecutado aquí; la reindexación forzada tampoco (requiere BD + cuota).

## Señal de modelo

- Acumular más trazas con veredicto real (`pilot:llm --ref=... --verdict=...`, `pilot:eval --all`).
- [x] Dataset **ReAct/CoT** con held-out y early stopping listo para el **generador de tests** (6 ejemplos: 2 aprobados y 4 correcciones; 4 train / 2 valid estratificado). Ver [[Piloto/Trazas y evaluación]].
- **No reabrir Fase 6** hasta tener veredictos y un dataset con held-out suficiente (el actual solo valida el formato).

## Enlaces

[[Inicio]] · [[Estado actual]] · [[Piloto/Trazas y evaluación]] · [[Registro de PRs]]

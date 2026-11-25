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

- [x] Prisma 7 y Next 16 ejecutados el 2026-11-25 con autorización explícita (PR #32, #33 y salto de Next). La auditoría bajó de 18 a **10** avisos: 3 altas (`effect` → `@prisma/config` → `prisma`), 7 moderadas, 0 críticas. Prisma 8 RC sigue sin autorizarse.
- Dependabot actualizado el 2026-11-25: fusionados #15, #16, #4–#7, #10, #32 y #33 (todos con CI verde). Siguen abiertos #9 (CI roja), #11 (`@types/node` 26) y #12 (Tailwind 4), excluidos por las versiones acordadas; #8 estaba cerrado. No se cierran sin decisión explícita.
- [x] OpenNext 1.20.17 admite Next 16.4.6 (`>=16.4.5`); se quitó `--dangerouslyUseUnsupportedNextVersion` y el parche de WASM sigue aplicando. `next dev/build` fuerzan webpack por el externalizado del WASM de Prisma.
- [x] `ROADMAP.md` actualizado al recuento real: 215/215 ficheros y 1.344 trozos. Existe `npm run db:index-code -- --force` para repetir la indexación tras cambiar el chunker.
- [x] Matiz de Fase 2 resuelto: PR recién abierto sin checks → `pending` + `checks_registered:false`; la auto-fusión espera.
- [x] Fase 4: añadido `tests/integration/changelog.test.ts` para el SQL crudo (se omite sin `TEST_DATABASE_URL`). Siguen pendientes la ruta de embedding con cuota agotada y el solapamiento "nota" con el vault.
- [x] `next dev` y `next start` ya no buscan el `.wasm` en `.next/server`: el externalizado es solo del build del worker.
- WSL sin distro instalada: `.wslconfig` no se pudo medir.
- CI de `web_anime` ya roto en `main` antes de las pruebas; no es culpa de ARIA.
- Sin Docker ni `TEST_DATABASE_URL` en esta PC: el test de integración no se ha ejecutado aquí; la reindexación forzada tampoco (requiere BD + cuota).

## Señal de modelo

- [x] Acumular más trazas con veredicto real: 30 LLM sobre commits reales (21 aprobadas / 9 rechazadas; tests 7/16).
- [x] Dataset **ReAct/CoT** con held-out, early stopping y auditoría listo para el **generador de tests** (16 ejemplos: 7 aprobados y 9 correcciones; 12 train / 4 valid). Ver [[Piloto/Trazas y evaluación]].
- **No reabrir Fase 6** hasta tener un dataset mucho mayor (cientos/miles de ejemplos); los 16 actuales solo validan el formato y la puerta de calidad.

## Enlaces

[[Inicio]] · [[Estado actual]] · [[Piloto/Trazas y evaluación]] · [[Registro de PRs]]

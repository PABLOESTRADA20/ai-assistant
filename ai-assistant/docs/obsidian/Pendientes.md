---
title: ARIA — Pendientes
tags: [aria, pendientes, bloqueos]
updated: 2026-11-23
---

# Pendientes

> [!warning] Fase 7 no se cierra
> Falta probarla con tokens y OAuth reales.

## Bloqueos externos

1. **OAuth real** de GitHub/Google (botón "Entrar con…"), usuario único.
2. Token de **GitLab** y prueba en vivo de lectura/escritura, MR, pipelines y auto-fusión.
3. Prueba real en GitHub de `github_delete_file` y `github_merge_pull_request` con CI verde (`GITHUB_AUTO_MERGE=false` salvo durante la prueba).
4. Verificar el **deploy en Cloudflare** y el **webhook de Meta/WhatsApp**.
5. Credenciales y entorno: hoy no hay `GITHUB_TOKEN`, `GITLAB_TOKEN`, `WHATSAPP_APP_SECRET`, OAuth ni `kaggle.json`.

## Deuda técnica

- 5 vulnerabilidades altas: exigen Prisma 7 o Next 16 → **no se suben sin autorización**.
- PRs de Dependabot #4–#12 sin revisar; evaluar OpenNext 1.20.16.
- `ROADMAP.md` dice 204/204 ficheros; la última reindexación real fue 215/1.344. Forzar reindexación tras cambios del chunker.
- Matiz de Fase 2: `github_get_check_runs` justo tras abrir un PR responde "sin checks" en vez de "pendiente, reintenta".
- Fase 4: ruta de embedding con cuota agotada sin probar en vivo; falta test de integración del SQL crudo; vigilar solapamiento "nota" con el vault.
- WSL sin distro instalada: `.wslconfig` no se pudo medir.
- CI de `web_anime` ya roto en `main` antes de las pruebas; no es culpa de ARIA.

## Señal de modelo

- Acumular más trazas con veredicto real (`pilot:llm --ref=... --verdict=...`, `pilot:eval --all`).
- Construir dataset **ReAct/CoT** con held-out y early stopping para el **generador de tests** (2/6 aprobados).
- **No reabrir Fase 6** hasta tener veredictos y dataset con held-out.

## Enlaces

[[Inicio]] · [[Estado actual]] · [[Piloto/Trazas y evaluación]] · [[Registro de PRs]]

---
title: ARIA — Decisiones
tags: [aria, decisiones, adr]
updated: 2026-11-23
---

# Decisiones

| Fecha | Decisión | Motivo |
|---|---|---|
| 2026-10-14 | Parches (F1) y CI (F2) antes que el índice | El objetivo es modificar archivos |
| 2026-10-14 | Mapa del repo fusionado con F3 | El índice ya cubre esa necesidad |
| 2026-10-14 | Modelo propio pasa a opcional y al final | El modelo actual razona mejor para editar |
| 2026-10-14 | Conservar `webpackMemoryOptimizations` aunque no ahorre | No rompe y ayuda con RAM escasa |
| 2026-10-14 | No usar `isolate: false` en Vitest | Los mocks de Prisma se pisarían |
| 2026-10-14 | Un solo `CodeChunk`, sin `CodeFile` | El `fileHash` basta |
| 2026-10-14 | Índice léxico `simple`, sin stemming | Los identificadores se buscan literales |
| 2026-10-14 | `search_code` sin gateo por repos | El índice vive en la BD local |
| 2026-10-14 | Recortar el prompt al añadir herramientas | Tope estricto de 900 tokens |
| 2026-10-15 | `ChangeLog` con SQL crudo | Regenerar Prisma tocaría 43 ficheros |
| 2026-10-15 | Escritura en grupos aparte | Leer no debe ofrecer herramientas que escriben |
| 2026-10-15 | No añadir texto al prompt (897/900) | La guía vive en descripciones de tools |
| 2026-10-15 | Auditar aunque falle el embedding | La fila ya cambió: mejor con `warning` |
| 2026-10-15 | `recall_memory` devuelve el `id` | Sin id, `update_memory` era inusable |
| 2026-10-15 | "nota(s)" + verbo basta para ofrecer notas | La prueba en vivo mostró que era inalcanzable |
| 2026-10-15 | Voseo `recordás` añadido | La regex solo cubría `recuerd-` |
| 2026-10-16 | No construir el clasificador (F5) | 4 fallos morfológicos, 0 falsos positivos; 4.777 tok de schemas |
| 2026-10-16 | Usar `(?!\w)` en vez de `\b` tras vocal acentuada | `\b` no cierra palabra tras `á/í/é` |
| 2026-10-16 | Fase 6 reabierta: 9 bases LoRA, no 5 | La primera lectura miró sufijos `-lora` |
| 2026-10-16 | Adaptador estándar, `r ≤ 8`, <300 MB | Formato aceptado por Workers AI |
| 2026-10-16 | Dataset local anonimizado, entrenamiento en Kaggle | Privacidad y PC sin GPU |
| 2026-10-16 | `docs:vault` indexa la doc en `VaultNote` | El Worker no ve el disco |
| 2026-10-16 | Reindexado incremental del vault | Ahorra cuota de embeddings |
| 2026-10-30 | `REPO_MAP.md` excluido del índice | Si no, el mapa cambiaba en cada pasada |
| 2026-11-13 | Descartar `aria-v1` | No supera a la base y repite líneas |
| 2026-11-23 | `next@15.5.28` y `wrangler@4.158.0` | Reducir vulnerabilidades sin saltos mayores |
| 2026-11-23 | Prisma 7 / Next 16 quedan documentados | Saltos no autorizados |
| 2026-11-23 | `build:worker` centraliza OpenNext | Bandera y parche WASM en un solo sitio |
| 2026-11-23 | Auth solo `Bearer` | La cookie `aria_token` ya no autoriza |
| 2026-11-23 | WhatsApp exige `WHATSAPP_APP_SECRET` | La lista blanca solo filtra números, no autentica |
| 2026-11-23 | `TOOL_ROUND_MAX_TOKENS = 1024` y `max_tokens = TPM − 256` | Evita 429 del free tier de Groq |
| 2026-11-23 | Respetar el SSE del chat en el refactor | Cambio puramente estructural |

## Enlaces

[[Inicio]] · [[Cronología]] · [[Registro de PRs]] · [[Estado actual]]

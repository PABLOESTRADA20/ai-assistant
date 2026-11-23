---
title: Fase 4 — Modificar memorias y notas
tags: [aria, fase4, datos, auditoria]
estado: hecha
fecha: 2026-10-15
---

# Fase 4 — Modificar memorias y notas ✅

## Qué se construyó

- `update_memory` y `update_cloud_note` **por id UUID obligatorio** (validado con regex): sin id no se toca nada.
  - `update_memory`: `content` (≤2000), `importance` (0..1), `category`, `type`, `tags`.
  - `update_cloud_note`: `title` (≤200), `content` (≤50000), `tags`, `pinned`.
  - Lista blanca: lo que no esté ahí se ignora; si no se envía ningún campo, avisa en vez de escribir.
- `ChangeLog` (migración `20261015120000_add_change_log`, aplicada en Neon) + `app/lib/changelog.ts` con **SQL crudo** como `Note`: `entity`, `entityId`, `action`, `before`/`after` (jsonb), `actor`, `revertedAt`, `createdAt`. Solo se guardan los campos mutables.
- Límites: **12 cambios/min por registro** (`MAX_CHANGES_PER_MINUTE`) y **un único id por llamada**. El borrado no se expone como herramienta.
- `revert_change`: reaplica `before` y marca `revertedAt`; se puede pedir por `changeId` o por `entity` + `entityId`. La segunda reversión del mismo cambio se rechaza.
- Tests: 17 en `tests/unit/data-change.test.ts` + casos en `select-tools.test.ts`; total 291 unitarios verdes en su cierre.

## Aceptación en vivo (2026-10-15)

- `npm run db:smoke-changelog` contra Neon: crear memoria → `update_memory` → `ChangeLog` guarda `importance 0.5 → 0.9` → `revert_change` restaura → segunda reversión bloqueada. Limpieza total; no quedó nada de prueba.
- Desde el Worker local (`npm run preview`) por `/api/chat` (SSE) con `EMBEDDING_PROVIDER=local`: `list_cloud_notes` → `update_cloud_note` → `revert_change`, y `update_memory` → `revert_change` por entidad+id. Dos filas de `ChangeLog` con `before`/`after` y `revertedAt`.

## Huecos que destapó la prueba en vivo

1. `recall_memory` **no devolvía el `id`** → `update_memory` era inusable por el modelo. Corregido.
2. La señal de escritura de notas exigía "nube"/"mis notas" → "editá mi nota titulada X" no ofrecía la herramienta. Corregido con `RX_NOTE_MENTION`.
3. `RX_MEMORY` no reconocía el voseo "recordás". Ampliado a `recordás/recordar/acordate`.

## Decisiones

- SQL crudo en vez de regenerar el cliente Prisma: regenerarlo tocaría 43 ficheros versionados y arriesga el build de workerd.
- Escritura en grupos aparte (`memoryWrite`, `cloudNotesWrite`): leer no debe ofrecer una herramienta que modifica datos.
- No se añadió texto al `SYSTEM_PROMPT` (897/900 tokens): la guía vive en las descripciones de las herramientas.
- Se auditó el cambio aunque fallara el embedding: si `embed` lanza por cuota, la fila ya cambió y mejor registrar un `warning`.
- Se arrancó en paralelo a la Fase 3 (excepción autorizada): el índice es I/O y reanudable.

## Pendientes de esta fase

Ver [[Pendientes]]: ruta de embedding con cuota agotada sin probar en vivo, test de integración del SQL crudo y solapamiento "nota" con el vault de Obsidian.

## Enlaces

[[Inicio]] · [[Fases/Fase 3]] · [[Datos y privacidad]] · [[Pendientes]]

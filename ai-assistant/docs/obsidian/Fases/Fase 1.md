---
title: Fase 1 — Edición precisa por parches
tags: [aria, fase1, github, parches]
estado: hecha
fecha: 2026-10-14
---

# Fase 1 — Edición precisa por parches ✅ (prioridad máxima)

## Qué se construyó

- `github_apply_patch` con `{path, search, replace}`. Es un parche simple, **no un diff unificado**: `search` debe coincidir exactamente una vez, lo que impide aplicar el cambio en el sitio equivocado.
- Falla si `search` coincide **0 veces o más de 1**.
- Rechaza parches que borran más de `patchMaxRemovedLines = 120` líneas.
- Detecta si el archivo cambió entre lectura y escritura comparando el **SHA del blob**.
- `writeFiles` subido a `10` y `readFile` paginado por rango de líneas.
- `MAX_TOOL_ROUNDS` subido de 5 a **8**.
- Prompt de sistema, `RX_GITHUB_WRITE` y `TOOL_GROUPS` actualizados; el prompt sigue por debajo de 900 tokens.
- Protecciones de la época: rama `aria/*`, sin merge, sin borrar, sin tocar `.github/workflows`, rutas validadas y `GITHUB_WRITE_ENABLED=true`. La [[Fases/Fase 7|Fase 7]] relajó el prefijo de rama y añadió borrado/fusión, pero **nunca** la escritura directa en `main`.

## Tests

Ambigüedad, cero coincidencias, archivo cambiado, ruta prohibida, límite de tamaño, borrado excesivo y selección de la herramienta en español.

## Aceptación en vivo (2026-10-14)

Sobre `PABLOESTRADA20/web_anime`, desde el **Worker local** (`npm run preview`, mismo runtime workerd que producción) con token de `gh` y `GITHUB_WRITE_ENABLED=true`:

1. `github_read_file` leyó `README.md`.
2. `github_apply_patch` creó la rama `aria/anadir-linea-de-prueba-...-mv8ecrab` y el **PR #1**.
3. Diff mínimo: **+2/−0**, solo `README.md`; `main` quedó intacta.

`next dev` **no** sirve para esta prueba: su engine WASM de Prisma no se resuelve fuera de workerd. Ver [[Infraestructura]].

## Enlaces

[[Inicio]] · [[Fases/Fase 2]] · [[Seguridad]] · [[Registro de PRs]]

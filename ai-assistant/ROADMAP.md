# ROADMAP — ARIA

> Fuente de verdad del plan de trabajo. Se lee al **empezar** cada sesión y se actualiza al **cerrarla**.
> Una fase por sesión. No se avanza a la siguiente sin cerrar la anterior.
> Última actualización: 2026-10-14 (Fases 0–3 implementadas y **desplegadas** al Worker; Fase 3 con migración aplicada en Neon y 1.ª indexación parcial; aceptación en vivo de 1–3 pendiente).

## Objetivo

1. Que ARIA pueda **modificar código y archivos** con cambios pequeños y seguros, y verifique el resultado.
2. Que ARIA **conozca el código del repo** por significado, sin leer archivo por archivo.
3. (Opcional) Un **modelo propio** afinado (fine-tuning, no un modelo desde cero) dentro de ARIA.
4. Todo **sin sobrecargar la PC**: lo pesado va a la nube o es incremental.

## Estado general

| Fase | Nombre | Estado | Prioridad |
|------|--------|--------|-----------|
| 0 | Ajustes del PC (WSL, Next, Vitest) | ✅ Hecha | Alta |
| 1 | Edición precisa por parches | ✅ Hecha | Máxima |
| 2 | Verificar antes de dar por bueno (CI) | ✅ Hecha | Alta |
| 3 | Índice de código + mapa del repo | ✅ Hecha | Media |
| 4 | Modificar memorias y notas por id | ⬜ Pendiente | Media |
| 5 | Clasificador de herramientas (opcional) | ⬜ Pendiente | Baja |
| 6 | LoRA de estilo/código (opcional) | ⬜ Pendiente | Baja |

Estados: ⬜ Pendiente · 🟦 En curso · ✅ Hecha · ⏸️ Pausada · ❌ Descartada

> Nota (2026-10-14): las Fases 1 y 2 ya estaban implementadas cuando se creó este archivo (quedaron sin
> commitear). Se marcan ✅ porque los ítems están hechos y los tests unitarios están en verde; su
> **aceptación en vivo** (PR real + CI) sigue pendiente → ver "Pendiente de verificar".

---

## Fase 0 — Ajustes del PC ✅ (2026-10-14)

- [x] Preguntar la RAM real antes de fijar límites — **confirmado por varias fuentes del sistema**: 2 módulos de **8 GB + 8 GB = 16 GB** (`Win32_PhysicalMemory`), `TotalPhysicalMemory = 15,63 GiB` visibles (`Win32_ComputerSystem`/`Win32_OperatingSystem`), 2 ranuras ocupadas, **máximo 64 GB**. CPU **Intel Core 5 210H**, **8 núcleos / 12 hilos**.
- [x] `.wslconfig` propuesto (memoria, procesadores, `autoMemoryReclaim`) — escrito en `C:\Users\pablo\.wslconfig`: `memory=6GB`, `processors=6`, `swap=4GB` y `[experimental] autoMemoryReclaim=gradual`.
- [x] `next.config.js` con `experimental.webpackMemoryOptimizations: true` (verificar que no rompe el build de Workers) — aplicado. `next build` ✅ y `opennextjs-cloudflare build` ✅ ("OpenNext build complete"). Medición: pico **1811 MB → 1751 MB (−3 %)** → **no aporta ahorro real**.
- [x] `vitest.config.ts` con workers limitados — `maxWorkers: 4` (el nombre exacto en vitest 5.0.3 es `maxWorkers`, no `maxThreads`).
- [x] Medir RAM antes y después — tests unitarios: pico **790 MB → 373 MB (−417 MB, −53 %)** por +0,2 s. Build: sin cambio significativo.

**Aceptación:** `npm run dev` ✅ (HTTP 200 en menos de 15 s), `typecheck` ✅, `test:unit` ✅ (257 tests). El consumo **baja de forma medible** en los tests (−53 %); en el build no.

**Notas:** WSL no tiene ninguna distro instalada (`wsl -l -q` vacío), así que el efecto real de `.wslconfig` no se pudo comprobar. Fuera del roadmap se añadieron, además, `poweredByHeader: false` y cabeceras de seguridad base en `next.config.js` (aprobado por el usuario).

## Fase 1 — Edición precisa por parches (prioridad máxima) ✅

- [x] `github_apply_patch` con `{path, search, replace}` (parche simple, no diff unificado: `search` exacto hace imposible aplicar en el sitio equivocado)
- [x] Falla si `search` coincide 0 veces o más de 1
- [x] Rechaza parches que borran bloques grandes (`patchMaxRemovedLines = 120`)
- [x] Detecta si el archivo cambió entre lectura y escritura (SHA del blob)
- [x] Subir `writeFiles` a un valor razonable (`10`) y paginar `readFile` por rango de líneas
- [x] Evaluar si `MAX_TOOL_ROUNDS = 5` alcanza — se subió a `8`
- [x] Actualizar prompt de sistema, `RX_GITHUB_WRITE` y `TOOL_GROUPS`
- [x] Mantener protecciones: rama `aria/*`, sin merge, sin borrar, sin `.github/workflows`, rutas validadas, `GITHUB_WRITE_ENABLED=true`
- [x] Tests: ambigua, cero coincidencias, archivo cambiado, ruta prohibida, límite de tamaño, borrado excesivo, selección de herramienta en español

**Aceptación:** tests en verde ✅. **Falta** una edición real en rama `aria/*` con diff mínimo. El código ya está **desplegado** (2026-10-14, version `9a94bcf5-66a5-4bc1-bfc1-71f5b8308a05`) y el Worker tiene `GITHUB_TOKEN` + `GITHUB_WRITE_ENABLED`, así que la prueba en vivo puede hacerse desde la app desplegada (pendiente de ejecutar).

## Fase 2 — Verificar antes de dar por bueno ✅

- [x] `github_get_check_runs` (solo lectura) con resumen del fallo
- [x] Regla en el prompt: consultar checks tras abrir o parchar un PR; nunca decir "listo" sin verlos
- [x] Parche de corrección en la misma rama, con límite de intentos (2 por PR, `MAX_FIX_ATTEMPTS = 2`)
- [x] Tests: `success`, `failure`, `pending`, sin checks, límite de reintentos

**Aceptación:** **Falta** la prueba en vivo (si el CI falla, ARIA reporta qué falló y puede corregir en la misma rama). Se puede hacer ya desde la app desplegada, igual que la Fase 1.

## Fase 3 — Índice de código + mapa del repo ✅

- [x] Migración Prisma + modelo `CodeChunk` con índices HNSW y GIN (siguiendo el patrón de `20261007120000_brain_hnsw` y `20261011003000_search_and_storage_indexes`) → `prisma/migrations/20261014120000_code_index/` (tabla + `CodeChunk_embedding_hnsw_idx` + `CodeChunk_fts_idx`).
- [x] `scripts/index-code.ts`: troceo por función/clase/archivo, salta ficheros sin cambios por `fileHash` (y `contentHash` por trozo), reutiliza `EmbeddingCache`, swap atómico por fichero, lotes pequeños y respeta la reserva diaria de Workers AI (`fallbackBudgetLeft`).
- [x] Búsqueda en `app/lib/code-index.ts` (`searchCode`: vectorial + léxica fundidas con `orFuse`) y herramienta `search_code` (registrada en `tools.ts`, en `selectTools` y en `TOOL_GROUPS.code`).
- [x] `REPO_MAP.md` generado por el script, reescrito SOLO si cambia su contenido (sin timestamp, para que no cambie solo).
- [x] Tests del troceado (`chunkCode`) y de la fusión (`fuseCodeScores`): 15 tests en `tests/unit/code-index.test.ts`; selección de la herramienta en español en `tests/unit/select-tools.test.ts`.
- [x] Medir neuronas de Workers AI del indexado inicial — **1.ª pasada contra Neon (2026-10-14)**: 48/185 ficheros, 248 trozos, 248 embeddings por API (0 de caché), **≈7.999 neuronas estimadas**, 13,7 min. Se cortó sola al agotar el tope diario (8.000) y es reanudable por `fileHash`. Quedan ~137 ficheros para las próximas pasadas diarias.

**Aceptación:** la segunda ejecución sin cambios no debe llamar a ningún embedding (el `fileHash` del fichero coincide → se salta antes de trocear/embeber). La migración `20261014120000_code_index` **ya está aplicada** en Neon y la 1.ª pasada **ya creó `REPO_MAP.md`** ✅; **falta terminar el resto de ficheros** (varias pasadas, ≈3 días con la cuota diaria) y, entonces, una pasada sin cambios debe dar `embeddings.api: 0` + `repoMap: "sin cambios"`.

**Nota:** `REPO_MAP.md` no existe hasta la primera indexación; lo crea el script. El workflow de Actions para reindexar sigue sin crearse (solo si se pide). El troceo es heurístico (no un parser): puede partir un trozo de más, nunca perder código.

## Fase 4 — Modificar memorias y notas

- [ ] `update_memory` y `update_cloud_note` por id, con campos acotados
- [ ] Registro de cambios (quién, cuándo, valor anterior)
- [ ] Límites contra borrado o edición masiva
- [ ] Tests

**Aceptación:** cada cambio queda auditado y es reversible.

## Fase 5 (opcional) — Clasificador de herramientas

- [ ] Decidir primero si vale la pena (alternativas: mejorar descripciones de herramientas o ampliar las regex y sus tests)
- [ ] Si seguimos: `scripts/build-tool-dataset.ts` (limpiando secretos y datos personales), notebook en Colab/Kaggle, evaluación contra regex, degradación segura a regex

**Aceptación:** iguala o supera a las regex, con latencia medida; si no, no se integra.

## Fase 6 (opcional) — LoRA de estilo/código

- [ ] Verificar antes de entrenar: modelos base compatibles con LoRA en Workers AI y si acepta adaptadores QLoRA
- [ ] Dataset sin secretos ni datos personales; nunca en repos públicos de Hugging Face
- [ ] Entrenamiento en Colab/Kaggle, nunca en la PC
- [ ] Comparación lado a lado en 20 o más casos reales

**Aceptación:** mejora medible o se recomienda no integrarlo.

---

## Registro de decisiones

| Fecha | Decisión | Motivo |
|-------|----------|--------|
| 2026-10-14 | Parches (Fase 1) y verificación por CI (Fase 2) van antes que el índice | El objetivo principal es poder modificar archivos; el índice mejora el contexto pero no es requisito |
| 2026-10-14 | Mapa del repo se fusiona con la Fase 3 | El índice ya cubre gran parte de lo que daría el mapa |
| 2026-10-14 | Modelo propio pasa a opcional y al final | No mejora la edición de código; el modelo actual razona mejor |
| 2026-10-14 | Fase 0: se conserva `webpackMemoryOptimizations: true` pese a no medir ahorro | No rompe nada y ayuda cuando la RAM es escasa (p. ej. CI); el ahorro real está en `maxWorkers` |
| 2026-10-14 | Fase 0: no se usa `isolate: false` en Vitest | Compartiría el registro de módulos entre archivos; `github-patch` y `github-checks` mockean Prisma con estados distintos y se pisarían |
| 2026-10-14 | Fase 3: un solo modelo `CodeChunk` (el hash del fichero se repite por trozo), sin tabla `CodeFile` aparte | El `fileHash` basta para saltar la reindexación de lo que no cambió; una tabla extra no aporta y suma mantenimiento |
| 2026-10-14 | Fase 3: índice léxico con configuración `simple` (sin stemming) | El código se busca por identificadores literales (`saveNote` debe casar con `saveNote`), no por raíces de español |
| 2026-10-14 | Fase 3: `search_code` NO se gatea por repos configurados | El índice vive en la BD y lo llena un script local; no depende de GitHub |
| 2026-10-14 | Fase 3: se recortó el system prompt (búsqueda web y GitHub) al añadir `search_code` | El prompt no puede crecer de 900 tokens; el detalle ya vive en las descripciones de las herramientas |

## Pendiente de verificar

- ~~**RAM real**: confirmar.~~ **Resuelto (2026-10-14)**: 16 GB (2×8 GB), 8C/12T; verificado con `Win32_PhysicalMemory`, `Win32_ComputerSystem` y `Win32_OperatingSystem`.
- **`.wslconfig`**: sin distro WSL instalada no se pudo medir su efecto; requiere instalar/arrancar una distro tras `wsl --shutdown`.
- **Fases 1 y 2**: falta la prueba en vivo (edición real en rama `aria/*` y PR con CI). Implementación, tests unitarios y **deploy** en verde/hecho (2026-10-14). La prueba puede hacerse desde la app desplegada (`https://ai-assistant.pablo-maximiliano-cocio-estrada.workers.dev`).
- **Fase 3**: migración `20261014120000_code_index` **aplicada en Neon** ✅ y 1.ª pasada parcial hecha ✅ (48/185 ficheros, `REPO_MAP.md` creado). **Falta**: correr `npm run db:index-code` una vez al día hasta terminar los ~137 ficheros restantes y, al acabar, una pasada debe dar `embeddings.api: 0` + `repoMap: "sin cambios"`. Sin esa 2.ª pasada sin cambios no se da por buena la aceptación. Nota: hoy **nada lee `REPO_MAP.md`** todavía (el script lo genera y el comentario de cabecera dice que ARIA lo usa, pero no hay ningún consumidor en el código) → decidir si se integra o se corrige el texto.
- **Versión de Next**: la instalada reporta `15.5.25` en el banner de `next dev`, pero el lockfile dice `15.5.27`. Confirmar cuál está activa.
- **Compatibilidad de Next con `@opennextjs/cloudflare` 1.20.6**: la nota original decía Next 16.3, pero **no aplica**: la versión instalada es Next 15.5.x (no 16.x). Revisar solo si se planea subir a Next 16.
- ~~Datos del repo tomados del prompt original (líneas de código, migraciones, límites): confirmar al leer el repo (Fase 3).~~ **Resuelto (2026-10-14)**: leídos directamente del repo durante la Fase 3.
- Cifras de Unsloth/Colab (Fases 5 y 6): son de terceros.

## Cómo se mantiene este archivo

1. Al empezar una sesión: leer este archivo y confirmar la fase en curso.
2. Al cerrar: marcar los puntos hechos, actualizar el estado general y la fecha de arriba, y anotar decisiones nuevas.
3. Si algo no se pudo verificar, va a "Pendiente de verificar", no se marca como hecho.

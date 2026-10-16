# ROADMAP — ARIA

> Fuente de verdad del plan de trabajo. Se lee al **empezar** cada sesión y se actualiza al **cerrarla**.
> Una fase por sesión. No se avanza a la siguiente sin cerrar la anterior.
> Última actualización: 2026-10-16 (Fases 1–2 **aceptadas en vivo** contra un repo real (PR #1 + CI); **Fase 4 hecha y probada en vivo** desde el Worker local (`npm run preview`) contra Neon; Fase 5 **descartada con evidencia** (alternativa regex+tests aplicada); Fase 6 **reabierta**: la verificación se corrigió (hay 9 bases LoRA, incl. Qwen2.5-Coder-32B) y falta resolver la inferencia con LoRA (500) y el coste de entrenar 32B; Fase 3 con migración aplicada y el índice en **130/191 ficheros (829 trozos)** — falta terminar las pasadas diarias).

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
| 3 | Índice de código + mapa del repo | 🟦 En curso (130/191 ficheros) | Media |
| 4 | Modificar memorias y notas por id | ✅ Hecha | Media |
| 5 | Clasificador de herramientas (opcional) | ❌ Descartada (2026-10-16) | Baja |
| 6 | LoRA de estilo/código (opcional) | 🟦 Reabierta (verificación corregida) | Baja |

Estados: ⬜ Pendiente · 🟦 En curso · ✅ Hecha · ⏸️ Pausada · ❌ Descartada

> Nota (2026-10-14): las Fases 1 y 2 ya estaban implementadas cuando se creó este archivo (quedaron sin
> commitear). Se marcan ✅ porque los ítems están hechos, los tests unitarios están en verde y su
> **aceptación en vivo ya se hizo** (PR real + CI sobre `PABLOESTRADA20/web_anime`; ver Fases 1 y 2).

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

**Aceptación:** tests en verde ✅ y **prueba en vivo hecha (2026-10-14)**. Sobre `PABLOESTRADA20/web_anime`, ARIA leyó `README.md` (`github_read_file`) y llamó `github_apply_patch` → creó la rama `aria/anadir-linea-de-prueba-...-mv8ecrab` y el **PR #1** (`pull_request:1`, `merged:false`), con diff mínimo (**+2/−0**, solo `README.md`); `main` quedó **intacta**. La prueba se hizo desde el **Worker local** (`npm run preview`, mismo código/runtime workerd que lo desplegado) con `GITHUB_TOKEN` (token de `gh`) y `GITHUB_WRITE_ENABLED=true`; `next dev` **no** sirve para esto (su engine WASM de Prisma no se resuelve fuera de workerd).

## Fase 2 — Verificar antes de dar por bueno ✅

- [x] `github_get_check_runs` (solo lectura) con resumen del fallo
- [x] Regla en el prompt: consultar checks tras abrir o parchar un PR; nunca decir "listo" sin verlos
- [x] Parche de corrección en la misma rama, con límite de intentos (2 por PR, `MAX_FIX_ATTEMPTS = 2`)
- [x] Tests: `success`, `failure`, `pending`, sin checks, límite de reintentos

**Aceptación:** **prueba en vivo hecha (2026-10-14)** en el mismo PR #1. `github_get_check_runs` devolvió `state:"failure"` con el check fallido y sus anotaciones (tests `useComments`/`useGamification`, aviso de Node 20), y ARIA **reportó qué falló** sin darlo por bueno y **explicó por qué no parcheaba** (fallo preexistente ajeno a su cambio de README). Un 2.º `github_apply_patch` **con `branch`** commiteó en la MISMA rama (`pull_request:null`, `fix_attempts` 1→2) y el 4.º intento fue **rechazado** por `MAX_FIX_ATTEMPTS=2` ("ya recibió 2 correcciones automáticas"). Hallazgo de temporización: consultado justo tras abrir el PR, los checks aún no existían y el resumen dijo "sin checks configurados" en vez de "pendiente" (ver Pendiente de verificar).

## Fase 3 — Índice de código + mapa del repo ✅

- [x] Migración Prisma + modelo `CodeChunk` con índices HNSW y GIN (siguiendo el patrón de `20261007120000_brain_hnsw` y `20261011003000_search_and_storage_indexes`) → `prisma/migrations/20261014120000_code_index/` (tabla + `CodeChunk_embedding_hnsw_idx` + `CodeChunk_fts_idx`).
- [x] `scripts/index-code.ts`: troceo por función/clase/archivo, salta ficheros sin cambios por `fileHash` (y `contentHash` por trozo), reutiliza `EmbeddingCache`, swap atómico por fichero, lotes pequeños y respeta la reserva diaria de Workers AI (`fallbackBudgetLeft`).
- [x] Búsqueda en `app/lib/code-index.ts` (`searchCode`: vectorial + léxica fundidas con `orFuse`) y herramienta `search_code` (registrada en `tools.ts`, en `selectTools` y en `TOOL_GROUPS.code`).
- [x] `REPO_MAP.md` generado por el script, reescrito SOLO si cambia su contenido (sin timestamp, para que no cambie solo).
- [x] Tests del troceado (`chunkCode`) y de la fusión (`fuseCodeScores`): 15 tests en `tests/unit/code-index.test.ts`; selección de la herramienta en español en `tests/unit/select-tools.test.ts`.
- [x] Medir neuronas de Workers AI del indexado inicial — **1.ª pasada contra Neon (2026-10-14)**: 48/185 ficheros, 248 trozos, 248 embeddings por API (0 de caché), **≈7.999 neuronas estimadas**, 13,7 min. Se cortó sola al agotar el tope diario (8.000) y es reanudable por `fileHash`. Quedan ~137 ficheros para las próximas pasadas diarias.

  **2.ª pasada (2026-10-15 UTC)**: +4 ficheros → **92/187**, 574 trozos, `repoMap: "actualizado"`. Esa noche una primera ejecución se cayó a mitad por un `P1001` transitorio de Neon ("Database not reachable") después de sumar ~40 ficheros (48→88), y la segunda ya encontró la cuota del día casi agotada (`8032/8000`), así que volvió a cortarse sola por cuota. Sin daño: el índice es reanudable por `fileHash`.

  **3.ª pasada (2026-10-16 UTC)**: `scanned 220`, `candidates 191`, `indexed 43` (los ~5 re-indexados por los cambios de Fase 4 + 38 nuevos), `unchanged 87`, 334 trozos, `embeddings.api 279` + `cache 65`, **8.028 neuronas** en 9,9 min; se cortó sola por cuota. **Índice real en la BD: 130/191 ficheros y 829 trozos** (verificado por SQL; 0 trozos sin embedding). Quedan **~61 ficheros** para la próxima pasada. Un fichero (`public/aria-countach.html`) quedó sin indexar porque su embedding falló justo en el borde de la cuota (se reintenta solo la próxima vez).
- [x] Validar la consulta real de `search_code` contra Postgres (nunca se había ejecutado): nuevo `scripts/smoke-code-search.ts` + `npm run db:smoke-code`. Contra Neon: la vía léxica (GIN + `websearch_to_tsquery('simple')`) devuelve filas, la vectorial (HNSW `<=>` + cast `::vector`) responde, y `searchCode()` devuelve hits reales (`0.857 app/api/notes/route.ts:1-20 GET`).

**Aceptación:** la ejecución sin cambios no debe llamar a ningún embedding (el `fileHash` del fichero coincide → se salta antes de trocear/embeber). La migración `20261014120000_code_index` **ya está aplicada** en Neon y el índice va por **130/191 ficheros (829 trozos)** ✅; **falta terminar los ~61 restantes** (≈40 ficheros/pasada diaria, 1–2 días) y, entonces, una pasada sin cambios debe dar `embeddings.api: 0` + `repoMap: "sin cambios"`.

**Nota:** `REPO_MAP.md` no existe hasta la primera indexación; lo crea el script. El workflow de Actions para reindexar sigue sin crearse (solo si se pide). El troceo es heurístico (no un parser): puede partir un trozo de más, nunca perder código. Corregido (2026-10-16): su cabecera decía "Ficheros indexados: 99" pero contaba solo los ficheros **con símbolos**; ahora muestra el total real (130) y, aparte, cuántos tienen símbolos (markdown/JSON/config no extraen símbolos).

## Fase 4 — Modificar memorias y notas ✅

- [x] `update_memory` y `update_cloud_note` por id, con campos acotados. **Id obligatorio (uuid)**, validado con una regex: sin él no se toca nada (evita ediciones accidentales). `update_memory`: `content` (≤2000), `importance` (0..1), `category`, `type`, `tags`. `update_cloud_note`: `title` (≤200), `content` (≤50000), `tags`, `pinned`. Lista blanca: lo que no esté ahí se ignora. Si no se indica ningún campo, la herramienta avisa en vez de escribir.
- [x] Registro de cambios (quién, cuándo, valor anterior): tabla **`ChangeLog`** (migración `20261015120000_add_change_log`, **aplicada en Neon**) + `app/lib/changelog.ts` (SQL crudo, como `Note`): `entity`, `entityId`, `action`, `before`/`after` (jsonb), `actor`, `revertedAt`, `createdAt`. Los snapshots guardan solo los campos mutables.
- [x] Límites contra borrado o edición masiva: **12 cambios/min por registro** (`MAX_CHANGES_PER_MINUTE`, contados desde `ChangeLog` en la última ventana) y **un único id por llamada**; el borrado (`deleteMemory`/`deleteNote`) **no** se expone como herramienta.
- [x] Tests: `tests/unit/data-change.test.ts` (**17 tests**: id, campos, topes, límite, auditoría, reversión y el caso de embedding fallido) + casos nuevos en `tests/unit/select-tools.test.ts`. Total: **291 unitarios en verde**, `typecheck` y `lint` limpios.
- [x] Reversible: **`revert_change`** reaplica `before` y marca `revertedAt`; la segunda reversión del mismo cambio se rechaza. Se puede pedir por `changeId` o por `entity` + `entityId` (último cambio de ese registro).

**Aceptación:** **prueba en vivo hecha (2026-10-15)** con el nuevo `npm run db:smoke-changelog` contra **Neon** y las herramientas reales: crea una memoria de prueba → `update_memory` → la fila de `ChangeLog` guarda antes/después (`importance 0.5→0.9`) → la memoria refleja el cambio → `revert_change` restaura el valor anterior → la 2.ª reversión se bloquea ("ya estaba revertido"). Limpieza total al terminar (no queda nada de prueba en la base). Cubre lo que los unitarios no pueden: el **SQL crudo** de `changelog.ts` contra Postgres.

**Además, probada en vivo desde el Worker local (2026-10-15)** con `npm run preview` (mismo runtime **workerd** que producción) y `/api/chat` por SSE, con `EMBEDDING_PROVIDER=local` (la cuota diaria de Workers AI estaba agotada, así que no se gastó red): ARIA llamó `list_cloud_notes` → `update_cloud_note` (nota editada) → `revert_change` (nota restaurada), y `update_memory` (memoria editada) → `revert_change` por `entity`+`entityId` (memoria restaurada); las **dos** filas de `ChangeLog` quedaron en Neon con `before`/`after` y su `revertedAt`. También se verificó que `recall_memory` devuelve el `id`. Esto confirma el **bundling de `changelog.ts` en workerd** y que `selectTools` ofrece las herramientas nuevas de verdad.

La prueba **destapó dos huecos reales** (ninguno detectable con smoke ni unitarios), ya corregidos: (1) `recall_memory` **no devolvía el `id`**, sin el cual `update_memory` era inusable por el modelo; (2) la señal de escritura de notas exigía "nube"/"mis notas", así que `update_cloud_note` era **inalcanzable** en lenguaje natural ("editá mi nota titulada X"); de paso, `RX_MEMORY` no reconocía el voseo "recordás". Ver decisiones.

**Nota:** el `SYSTEM_PROMPT` está en **897/900 tokens**, así que **no** se le añadió texto (el test `aria-core.test.ts` lo vigila): la guía vive en las descripciones de las herramientas, que solo viajan cuando `selectTools` las ofrece. Señales nuevas: `RX_MEMORY_WRITE` (verbo de cambio + "memoria/recuerdo"), `RX_WRITE_VERB` (verbo de cambio), `RX_REVERT` y `RX_NOTE_MENTION` (menciona "nota(s)" + verbo de cambio → ofrece las notas de la nube); `RX_MEMORY` se amplió a "recordás/recordar/acordate" (voseo). La escritura va en grupos **aparte** (`memoryWrite`, `cloudNotesWrite`) para que una simple lectura no ofrezca una herramienta que modifica datos.

**Pendiente de verificar (Fase 4):** ver "Pendiente de verificar" (ruta de embedding con la cuota agotada, test de integración y el solapamiento "nota" con el vault de Obsidian).

## Fase 5 (opcional) — Clasificador de herramientas ❌ Descartada (2026-10-16)

- [x] Decidir primero si vale la pena → **no vale**. Medido con una sonda local (0 API) sobre 34 frases reales: la selección por regex daba **4 fallos de cobertura y 0 ofertas indebidas**, y los 4 eran **morfológicos** (voseo `abrí`/`buscá`/`sabés`, plural `se guardan`), no semánticos. Coste de los 25 schemas: **4.777 tok** (solo `github`: 1.027), frente a los 897 del system prompt.
- [x] Alternativa aplicada (la que este punto ya nombraba): **ampliar las regex + tests** en vez de construir el clasificador. Se cerraron los 4 huecos, se corrigió la causa raíz (**`\b` no cierra palabra tras vocal acentuada** → `(?!\w)`, como ya hacía `RX_GITHUB_WRITE`) y se añadió un test de regresión en `select-tools.test.ts`. $0, 0 latencia, determinista; 292 tests verdes.
- [ ] ~~Si seguimos: `scripts/build-tool-dataset.ts` (limpiando secretos y datos personales), notebook en Colab/Kaggle, evaluación contra regex, degradación segura a regex~~ **No aplica**: no se construye el clasificador.

**Aceptación:** ~~iguala o supera a las regex~~ **No se integra** (decisión con evidencia): un clasificador solo se justifica con muchas más herramientas y presupuesto; los fallos medidos eran morfológicos (la regex los cubre) y el fallback a regex habría que mantenerlo igualmente. Revisable si el catálogo de herramientas crece mucho.

## Fase 6 (opcional) — LoRA de estilo/código 🟦 Reabierta (verificación corregida, 2026-10-16)

- [x] Verificar antes de entrenar: modelos base compatibles con LoRA en Workers AI y si acepta adaptadores QLoRA.
  - **LoRA y QLoRA: sí.** Open beta y gratis; se suben con `wrangler ai finetune create` o REST (permiso *Workers AI: Edit*) y se sirven con `env.AI.run(modelo, {…, lora})`. Límites: rank `r ≤ 8` (hasta 32), adaptador < 300 MB, ficheros `adapter_config.json` + `adapter_model.safetensors`, ≤100 adaptadores/cuenta, no editable tras subir.
  - **Bases con LoRA: 9** (no 4). La primera lectura miró solo los nombres con sufijo `-lora` y **se equivocó**; la fuente correcta es el facet `?capabilities=LoRA` del catálogo: **`@cf/qwen/qwen2.5-coder-32b-instruct` (32B, de código)**, `@cf/qwen/qwq-32b` (32B, razonamiento), `@cf/meta/llama-3.2-11b-vision-instruct`, `@cf/meta/llama-3.2-3b-instruct`, `@cf/meta/llama-guard-3-8b`, `@cf/google/gemma-2b/7b-it-lora`, `@cf/meta-llama/llama-2-7b-chat-hf-lora`, `@cf/mistral/mistral-7b-instruct-v0.2-lora`.
  - **Prueba en vivo (2026-10-16, API REST):** token y endpoint OK (`@cf/meta/llama-3.2-3b-instruct` → 200; **`@cf/qwen/qwen2.5-coder-32b-instruct` → 200**, 8,1 neuronas). Con LoRA: el único adaptador público (`cf-public-magicoder`, base `@cf/mistral/mistral-7b-instruct-v0.2-lora`) **da 500** al invocarlo con su base correcta (el sistema sí valida: con base Gemma responde `Finetune model mismatch`). → **la inferencia con LoRA no funciona hoy en esta cuenta** (beta); a investigar/reintentar.
  - **Contradicción de doc sin resolver:** la guía de fine-tunes (abr-2026) dice `model_type` ∈ {`mistral`,`gemma`,`llama`}, pero el catálogo marca **Qwen** como base LoRA → aún no se sabe si un adaptador Qwen se acepta.
- [ ] Dataset sin secretos ni datos personales; nunca en repos públicos de Hugging Face.
- [ ] Entrenamiento en Colab/Kaggle, nunca en la PC. **Ojo:** un QLoRA de 32B (Qwen-Coder/QwQ) pide ≳24 GB de VRAM → **no cabe en GPU gratuita**; lo entrenable gratis es 3B–11B.
- [ ] Comparación lado a lado en 20 o más casos reales.

**Aceptación:** mejora medible o se recomienda no integrarlo. **Nota:** la primera evaluación (2026-10-16, "❌ Descartada") partía de un dato falso ("solo bases 2B–7B"); se corrige y la fase queda abierta. El bloqueo real ya **no** es la calidad de la base, sino **(a)** que la inferencia con LoRA dé 500 y **(b)** el coste de entrenar un 32B.

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
| 2026-10-14 | Fases 1–2: aceptación en vivo desde el **Worker local** (`npm run preview`) con token de `gh`, no desde la app desplegada | Evita depender de `ARIA_ACCESS_TOKEN` y usa el mismo runtime (workerd) que producción; `next dev` no resuelve el engine WASM de Prisma |
| 2026-10-15 | Fase 4: auditoría en tabla nueva `ChangeLog` con acceso por **SQL crudo** (no se regenera el cliente Prisma) | Mismo patrón que `Note`: el cliente generado (workerd) ya quedó sin `CodeChunk`; regenerarlo tocaría 43 ficheros versionados y arriesga el build |
| 2026-10-15 | Fase 4: la escritura va en grupos aparte (`memoryWrite`, `cloudNotesWrite`), no dentro de `memory`/`cloudNotes` | Leer no debe ofrecer una herramienta que modifica datos; cada schema de más cuesta tokens y empuja al modelo a usarlo |
| 2026-10-15 | Fase 4: no se añadió texto al `SYSTEM_PROMPT` (está en 897/900 tokens) | El detalle vive en las descripciones de las herramientas, que solo viajan cuando `selectTools` las ofrece |
| 2026-10-15 | Fase 4: se arrancó **en paralelo** a la Fase 3 (que solo espera cuota diaria) | El índice es I/O y reanudable; el código de Fase 4 no depende de él. Excepción puntual a "una fase por sesión", autorizada por el usuario |
| 2026-10-15 | Fase 4: `update_memory` audita el cambio aunque falle el recálculo del embedding | `updateMemory` escribe los campos antes de embeber; si `embed` lanza (cuota agotada) la fila ya cambió: mejor auditarla con un `warning` que dejarla sin registro |
| 2026-10-15 | Fase 4: `recall_memory` ahora devuelve el `id` de cada memoria | Sin id, `update_memory` (que trabaja por id) era **inusable por el modelo**: lo demostró la prueba en vivo. El id no es sensible y era imprescindible |
| 2026-10-15 | Fase 4: `update_cloud_note` se ofrece con solo mencionar "nota(s)" + un verbo de cambio (`RX_NOTE_MENTION`), sin exigir "nube" | La prueba en vivo mostró que "editá mi nota titulada X" **no** ofrecía la herramienta (inalcanzable en lenguaje natural). Si el mensaje también habla del vault, el modelo ve las dos familias y elige por las descripciones |
| 2026-10-15 | Fase 4: se amplió `RX_MEMORY` a "recordás/recordar/acordate" (voseo) | La prueba en vivo mostró que "¿Recordás ...?" no ofrecía `recall_memory` (la regex solo cubría "recuerd-"): una orden en voseo caía en el olvido |
| 2026-10-16 | Fase 3: `REPO_MAP.md` se deja **solo como documento** (ni herramienta ni inyección en el contexto) | Pesa ≈2.282 tokens (144 líneas) y el prompt no puede crecer de 900; `search_code` ya encuentra símbolos por significado. El fichero se sigue generando y versionando, así que la opción queda abierta sin coste |
| 2026-10-16 | Fase 5: **no se construye el clasificador**; se amplían las regex + tests | Sonda local sobre 34 frases: 4 fallos de cobertura y 0 falsos positivos, todos **morfológicos** (voseo `abrí`/`buscá`/`sabés`, plural `se guardan`) y arreglables por regex. Los 25 schemas cuestan 4.777 tok, así que la selección importa, pero un clasificador añadiría latencia/cuota y exigiría fallback a regex igualmente. Evidencia temporal (no commiteada) |
| 2026-10-16 | Fase 5: se usa `(?!\w)` en vez de `\b` al final de un grupo que puede terminar en vocal acentuada | En JS `\w` = `[A-Za-z0-9_]`: `\b` NO ve el final de palabra tras `á`/`í`/`é`, así que `abrí\b` o `buscá\b` fallaban. Afectaba a `LOOKS_LIKE_ORDER`, `RX_APPS` y `RX_CODE_SEARCH`; `RX_GITHUB_WRITE` ya usaba `(?!\w)` |
| 2026-10-16 | Fase 6: se **corrige** la verificación y la fase **se reabre** (no se descarta) | El primer veredicto "solo 5 bases 2B–7B" salió de mirar los nombres `-lora` y era **falso**: el facet `?capabilities=LoRA` del catálogo lista **9** bases, incluidas `@cf/qwen/qwen2.5-coder-32b-instruct` (32B, de código) y `@cf/qwen/qwq-32b` (32B). Probado en vivo: la base Qwen-Coder-32B → 200; el LoRA público (Mistral) → **500**. Bloqueo real: inferencia LoRA rota (beta) + entrenar un 32B no cabe en GPU gratis |
| 2026-10-16 | Fase 6: el artefacto de despliegue es un adaptador **LoRA estándar** (también si se entrena con QLoRA) | Unsloth/PEFT ya exportan `adapter_config.json` + `adapter_model.safetensors` con `target_modules` (p. ej. `q_proj`/`v_proj`); basta cumplir rank ≤8, <300 MB y el `model_type`. Entrenar con QLoRA no cambia el formato aceptado |

## Pendiente de verificar

- ~~**RAM real**: confirmar.~~ **Resuelto (2026-10-14)**: 16 GB (2×8 GB), 8C/12T; verificado con `Win32_PhysicalMemory`, `Win32_ComputerSystem` y `Win32_OperatingSystem`.
- **`.wslconfig`**: sin distro WSL instalada no se pudo medir su efecto; requiere instalar/arrancar una distro tras `wsl --shutdown`.
- ~~**Fases 1 y 2**: falta la prueba en vivo (edición real en rama `aria/*` y PR con CI).~~ **Resuelto (2026-10-14)**: aceptación en vivo hecha sobre `PABLOESTRADA20/web_anime` (PR #1: rama `aria/*` + diff mínimo `+2/−0`; CI detectado como `failure` y reportado; parche de corrección en la misma rama; tope de 2 correcciones enforced). Ver Fases 1 y 2.
- **Fase 2 — matiz de temporización** (mejora posible, no bloquea): al llamar `github_get_check_runs` **inmediatamente** tras abrir el PR, GitHub todavía no había creado el check (0 checks) y el resumen respondió `state:"none"` ("sin checks configurados"), cuando lo correcto sería "pendiente, reintenta". Opciones: que la herramienta distinga "sin checks configurados" de "checks aún no registrados", o que el prompt pida reintentar antes de concluir.
- **CI de `web_anime` ya roto en `main`**: sus tests (`useComments`, `useGamification`) fallan desde antes de la prueba (y los `Deploy` de `main` también salen en rojo); por eso cualquier PR sale en rojo. No es un fallo de ARIA y no se tocó.
- **Fase 3**: migración `20261014120000_code_index` **aplicada en Neon** ✅; el índice va por **130/191 ficheros (829 trozos)** tras la pasada del 2026-10-16. **Falta**: correr `npm run db:index-code` una vez al día (≈40 ficheros/pasada) hasta terminar los ~61 restantes y, al acabar, una pasada debe dar `embeddings.api: 0` + `repoMap: "sin cambios"`. La consulta real de `search_code` contra Postgres **ya se validó** (`npm run db:smoke-code`). Nota: hoy **nada lee `REPO_MAP.md`**; la cabecera del fichero **ya se corrigió** (`scripts/index-code.ts`) para decir que es un índice de orientación y que **ningún** código de la app lo lee (la app usa `search_code`). **Decidido (2026-10-16): se deja solo como documento** (144 líneas ≈2.282 tokens; el prompt no puede crecer de 900 y `search_code` ya cubre encontrar símbolos por significado).
- **Neon — `P1001` transitorio (2026-10-15)**: una pasada del índice se cayó a mitad con "Database not reachable" y volvió a responder segundos después (posible cold start del pooler). El indexado es reanudable; si reaparece, reintentar.
- ~~**Fase 4 — prueba desde el Worker local**: la aceptación se hizo con `npm run db:smoke-changelog` (herramientas reales contra Neon) + 291 tests unitarios, pero **no** desde `npm run preview` chateando con ARIA.~~ **Resuelto (2026-10-15)**: hecha desde el Worker local (workerd) por `/api/chat` (SSE) con `EMBEDDING_PROVIDER=local`. Verificados `list_cloud_notes` → `update_cloud_note` → `revert_change` (nota restaurada) y `update_memory` → `revert_change` por `entity`+`entityId` (memoria restaurada), con las dos filas de `ChangeLog` (`before`/`after` + `revertedAt`) en Neon, y `recall_memory` devolviendo el `id`. Destapó y arregló dos huecos (id de `recall_memory` y señal de escritura de notas) + el voseo de `RX_MEMORY`; ver decisiones.
- **Fase 4 — solapamiento "nota"** (a vigilar; no bloquea): ofrecer las notas de la nube con solo "nota(s)" + verbo de cambio puede chocar con el **vault de Obsidian** (que ya se ofrece con `RX_VAULT`). En la prueba el modelo eligió bien (el mensaje nombraba la herramienta); vigilar si en uso real edita la nota equivocada. Alternativa: exigir "nube"/"ARIA" o desambiguar por título conocido.
- **Fase 4 — cuota de Workers AI agotada**: si `update_memory` cambia el `content` con la cuota del día agotada, `updateMemory` escribe los campos y **después** falla al recalcular el embedding (`embed` lanza). El tool relee y **audita igual** el cambio, devolviendo un `warning` (hay test unitario; **la prueba en vivo usó `EMBEDDING_PROVIDER=local`, así que esta ruta sigue sin probar en vivo**). Decidir si conviene reencolar el embedding para la pasada siguiente.
- **Fase 4 — test de integración**: falta un test en `tests/integration` que valide el SQL crudo de `changelog.ts` contra Postgres; hoy es imposible en esta PC (sin Docker ni `TEST_DATABASE_URL`). El smoke `db:smoke-changelog` lo cubre a mano.
- **Versión de Next** (**confirmado 2026-10-14**): el árbol instalado es `next@15.5.25` (`node_modules/next/package.json` y `npm ls`), que es lo que usan `next dev`/`next build`; el `package-lock.json` fija **15.5.27**. Es un `node_modules` desincronizado del lockfile, misma serie 15.5.x y sin impacto funcional; `npm ci` lo alinearía a 15.5.27 cuando convenga.
- **Compatibilidad de Next con `@opennextjs/cloudflare` 1.20.6**: la nota original decía Next 16.3, pero **no aplica**: la versión instalada es Next 15.5.x (no 16.x). Revisar solo si se planea subir a Next 16.
- ~~Datos del repo tomados del prompt original (líneas de código, migraciones, límites): confirmar al leer el repo (Fase 3).~~ **Resuelto (2026-10-14)**: leídos directamente del repo durante la Fase 3.
- **Fase 6 — bases `-lora` caídas (2026-10-16)**: probado en vivo por la API REST. Las **4 bases `-lora`** (`mistral-7b-instruct-v0.2-lora`, `gemma-2b/7b-it-lora`, `llama-2-7b-chat-hf-lora`) devuelven **500 / code 8008 incluso SIN adaptador**; con adaptador público (`cf-public-magicoder`) también 500, en todas las formas de petición (chat/completion, con/sin `max_tokens`), de forma reproducible. La base sin sufijo `-lora` da `400 No route`; el sistema **sí** valida la base+LoRA (con base Gemma da `Finetune model mismatch`). Los controles sin LoRA (`llama-3.2-3b` y `qwen2.5-coder-32b`) responden **200** y la status page está **operativa** → no es el token, el adaptador ni una incidencia: es la familia `-lora` la que está caída. Reintentar más tarde (beta) y, si sigue, reportar; sin esto no se puede evaluar ningún adaptador propio.
- **Fase 6 — `model_type` para Qwen**: la guía de fine-tunes (abr-2026) solo menciona `mistral`/`gemma`/`llama`, pero el catálogo marca Qwen como base LoRA. Verificar si un adaptador Qwen (`model_type: qwen2`) se acepta al subirlo.
- **Cifras de Unsloth/Colab (Fase 6): son de terceros** (no verificadas).

## Cómo se mantiene este archivo

1. Al empezar una sesión: leer este archivo y confirmar la fase en curso.
2. Al cerrar: marcar los puntos hechos, actualizar el estado general y la fecha de arriba, y anotar decisiones nuevas.
3. Si algo no se pudo verificar, va a "Pendiente de verificar", no se marca como hecho.

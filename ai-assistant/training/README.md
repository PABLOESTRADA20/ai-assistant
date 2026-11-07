# Entrenamiento del modelo (FASE 6)

Aquí vive el material para **entrenar un adaptador LoRA** de ARIA **sin gastar tu
computador**: se hace en la GPU gratuita de Kaggle (o Colab).

## Qué hay

- `aria-lora-kaggle.ipynb`: el cuaderno de entrenamiento. Se sube a Kaggle y se ejecuta.
- `../scripts/build-lora-dataset.ts`: genera el JSONL desde la base y el set sintético.
- `../scripts/lora-seed.ts`: 69 conversaciones sintéticas curadas (71 ejemplos), sin datos
  personales, para enseñar el estilo de ARIA.
- `../tests/unit/lora-dataset.test.ts`: tests del generador y del set sintético.

## Qué entrena (y qué no)

El adaptador solo sirve sobre una **base LoRA de Cloudflare**, y la documentación exige que
`adapter_config.json` tenga `model_type` ∈ {`mistral`, `gemma`, `llama`}. Por eso el cuaderno
**no** entrena Qwen (aunque aparezca en el catálogo): no se podría subir. Usa una de estas dos:

| Opción | Base para entrenar (4 bits) | Base canónica al subir | Base Cloudflare | `model_type` | VRAM |
|---|---|---|---|---|---|
| `llama-3.2-3b` (por defecto) | `unsloth/Llama-3.2-3B-Instruct-bnb-4bit` | `meta-llama/Llama-3.2-3B-Instruct` | `@cf/meta/llama-3.2-3b-instruct` | `llama` | ~8 GB |
| `mistral-7b` | `unsloth/mistral-7b-instruct-v0.2-bnb-4bit` | `mistralai/Mistral-7B-Instruct-v0.2` | `@cf/mistral/mistral-7b-instruct-v0.2-lora` | `mistral` | ~14 GB |

**Ojo con la base:** Cloudflare valida `base_model_name_or_path` contra su lista de bases
permitidas. La ruta de Unsloth (`unsloth/...-bnb-4bit`) **no** sirve; hay que usar la base
canónica de la tabla. El cuaderno y el script de subida ya la corrigen.

Se cambia con una línea en la celda de "Cargar el modelo base" (`ELEGIDO`).

## Cómo se usa (paso a paso)

1. **Generá el conjunto de datos** en el repositorio:

   ```
   npm run db:dataset
   ```

   Deja el archivo en `data/lora/aria-chat.jsonl` (esa carpeta **no** se sube a git).
   Por defecto genera **un ejemplo por respuesta del asistente** (con contexto) y suma
   los ejemplos sintéticos. Al 2026-11-02 salen **15 reales + 71 sintéticos = 86**.

   Opciones útiles:

   ```
   npm run db:dataset -- --dry                 # solo el informe, no escribe
   npm run db:dataset -- --no-seed             # solo conversaciones reales
   npm run db:dataset -- --seed-only           # solo el set sintético
   npm run db:dataset -- --by-conversation     # una charla = un ejemplo (antiguo)
   npm run db:dataset -- --with-tools          # incluye trazas de herramientas
   npm run db:dataset -- --fake                # autoprueba sin base de datos
   ```

   Revisá el informe: si hay datos personales o secretos, **no entrenes** hasta limpiarlos.
   El set sintético está versionado y no contiene datos tuyos; el JSONL real sí, y por eso
   nunca se sube al repositorio.

2. Entrá a https://www.kaggle.com y creá un **Dataset privado** subiendo ese archivo.
   (*Datasets → New Dataset → Private*). No lo hagas público.

3. Creá un **cuaderno** nuevo (Notebook), subí `aria-lora-kaggle.ipynb` y adjuntá tu
   dataset privado.

4. En la barra lateral derecha:
   - **Internet**: activado.
   - **Accelerator**: `GPU T4 x2` (o P100).

5. Ejecutá las celdas de arriba hacia abajo. Al final te queda `aria-lora.zip` para bajar.
6. Hacé **Save Version → Save & Run All** para que el `.zip` quede en el *Output* del cuaderno.

## Subir el adaptador a Cloudflare

El circuito ya está probado en vivo (2026-10-30): un adaptador propio con la base canónica
se sube y responde **200**. Los adaptadores públicos `cf-public-*` siguen dando 500, pero eso
no afecta a los tuyos.

1. Descomprimí `aria-lora.zip` en una carpeta, por ejemplo `aria-lora/`.
2. Asegurate de que `.env.local` tiene `CLOUDFLARE_ACCOUNT_ID` y `CLOUDFLARE_API_TOKEN`
   (permiso **Workers AI: Edit**).
3. Subilo y probalo:

   ```
   npm run lora:upload -- --dir=aria-lora --name=aria-v1
   ```

   El script valida `model_type`, `r`, la base y el tamaño; crea el finetune, sube los dos
   archivos y hace una inferencia de prueba. Si todo va bien, imprime el nombre que hay que
   usar como `lora` (por ejemplo `aria-v1`).

Para borrar una prueba:

```
npm run lora:upload -- --delete --name=aria-v1
```

Notas de la API: la ruta de subida es `/finetunes/{id}/finetune-assets` **sin barra final**
(con barra devuelve 404) y Cloudflare **no permite reescribir** un finetune: si el nombre ya
existe, hay que borrarlo o usar otro.

## Si Kaggle se reinicia

Kaggle borra `/kaggle/working` al reiniciar o expirar la sesión. Lo que sobrevive es el
cuaderno guardado y el *Output* de una versión guardada. Para no perder el avance:

- El cuaderno guarda un **checkpoint al final de cada época** en `salida/`.
- Al reabrir, ejecutá instalación (si el kernel es nuevo), datos, modelo y LoRA; la celda de
  entrenamiento **reanuda sola** si encuentra `salida/checkpoint-*`.
- Subí el `aria-lora.zip` como **dataset privado** para conservar el adaptador entre reinicios.

## Avisos importantes

- **El entrenamiento aún no se ejecutó de punta a punta.** La subida y la inferencia sí están
  probadas en vivo (2026-10-30), pero las librerías (`unsloth`, `trl`, `peft`) cambian de
  versión seguido. Si una celda falla por el nombre de un parámetro, el propio cuaderno
  explica dónde moverlo.
- **Privacidad**: `aria-chat.jsonl` tiene tus conversaciones. Mantené el dataset de
  Kaggle **privado** y **nunca** lo subas a un repositorio público de Hugging Face.
- **Con pocos datos reales el modelo memoriza** en vez de aprender. Hoy hay 15 turnos
  reales + 71 ejemplos sintéticos: alcanza para comprobar el circuito y enseñar estilo,
  no para un modelo robusto. Los sintéticos **no** sirven como set de evaluación; la
  comparación final debe hacerse con casos reales que el modelo no haya visto.
- El adaptador se configura con **rango 8**, que es lo recomendado por Cloudflare (acepta hasta
  32, pero 8 deja el archivo bien por debajo de los 300 MB).
- La celda de guardado **corrige y verifica** `model_type`, `r`, los nombres exactos de los
  archivos y el tamaño antes de comprimir.
- **Estado de Cloudflare (2026-10-30):** la base `mistral-7b-instruct-v0.2-lora` ya responde
  200 sin adaptador, y un adaptador **propio** con la base canónica también responde 200
  (probado con un adaptador real y con uno de pesos cero para Llama 3.2 3B). Los únicos que
  siguen dando 500 son los **públicos** `cf-public-*`, por metadatos con una base antigua.
- La celda de guardado **corrige** `model_type` y `base_model_name_or_path`, y verifica `r`,
  los nombres exactos y el tamaño. Si usás el `.zip` a mano, revisá que la base sea la
  canónica: `meta-llama/Llama-3.2-3B-Instruct` o `mistralai/Mistral-7B-Instruct-v0.2`.

## Enlaces

- Unsloth: https://github.com/unslothai/unsloth
- TRL (`SFTTrainer`): https://huggingface.co/docs/trl
- LoRA en Cloudflare: https://developers.cloudflare.com/workers-ai/fine-tunes/

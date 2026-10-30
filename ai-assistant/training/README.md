# Entrenamiento del modelo (FASE 6)

Aquí vive el material para **entrenar un adaptador LoRA** de ARIA **sin gastar tu
computador**: se hace en la GPU gratuita de Kaggle (o Colab).

## Qué hay

- `aria-lora-kaggle.ipynb`: el cuaderno de entrenamiento. Se sube a Kaggle y se ejecuta.

## Qué entrena (y qué no)

El adaptador solo sirve sobre una **base LoRA de Cloudflare**, y la documentación exige que
`adapter_config.json` tenga `model_type` ∈ {`mistral`, `gemma`, `llama`}. Por eso el cuaderno
**no** entrena Qwen (aunque aparezca en el catálogo): no se podría subir. Usa una de estas dos:

| Opción | Base Hugging Face | Base Cloudflare | `model_type` | VRAM |
|---|---|---|---|---|
| `llama-3.2-3b` (por defecto) | `unsloth/Llama-3.2-3B-Instruct-bnb-4bit` | `@cf/meta/llama-3.2-3b-instruct` | `llama` | ~8 GB |
| `mistral-7b` | `unsloth/mistral-7b-instruct-v0.2-bnb-4bit` | `@cf/mistral/mistral-7b-instruct-v0.2-lora` | `mistral` | ~14 GB |

Se cambia con una línea en la celda de "Cargar el modelo base" (`ELEGIDO`).

## Cómo se usa (paso a paso)

1. **Generá el conjunto de datos** en el repositorio:

   ```
   npm run db:dataset
   ```

   Deja el archivo en `data/lora/aria-chat.jsonl` (esa carpeta **no** se sube a git).

2. Entrá a https://www.kaggle.com y creá un **Dataset privado** subiendo ese archivo.
   (*Datasets → New Dataset → Private*). No lo hagas público.

3. Creá un **cuaderno** nuevo (Notebook), subí `aria-lora-kaggle.ipynb` y adjuntá tu
   dataset privado.

4. En la barra lateral derecha:
   - **Internet**: activado.
   - **Accelerator**: `GPU T4 x2` (o P100).

5. Ejecutá las celdas de arriba hacia abajo. Al final te queda `aria-lora.zip` para bajar.
6. Hacé **Save Version → Save & Run All** para que el `.zip` quede en el *Output* del cuaderno.

## Si Kaggle se reinicia

Kaggle borra `/kaggle/working` al reiniciar o expirar la sesión. Lo que sobrevive es el
cuaderno guardado y el *Output* de una versión guardada. Para no perder el avance:

- El cuaderno guarda un **checkpoint al final de cada época** en `salida/`.
- Al reabrir, ejecutá instalación (si el kernel es nuevo), datos, modelo y LoRA; la celda de
  entrenamiento **reanuda sola** si encuentra `salida/checkpoint-*`.
- Subí el `aria-lora.zip` como **dataset privado** para conservar el adaptador entre reinicios.

## Avisos importantes

- **Es un punto de partida, no está probado de punta a punta.** Las librerías
  (`unsloth`, `trl`, `peft`) cambian de versión seguido. Si una celda falla por el
  nombre de un parámetro, el propio cuaderno explica dónde moverlo.
- **Privacidad**: `aria-chat.jsonl` tiene tus conversaciones. Mantené el dataset de
  Kaggle **privado** y **nunca** lo subas a un repositorio público de Hugging Face.
- **Con pocas conversaciones el modelo memoriza** en vez de aprender. Hoy hay muy
  pocas: sirve para comprobar que el circuito funciona, no para tener un buen modelo.
- El adaptador se configura con **rango 8**, que es lo recomendado por Cloudflare (acepta hasta
  32, pero 8 deja el archivo bien por debajo de los 300 MB).
- La celda de guardado **corrige y verifica** `model_type`, `r`, los nombres exactos de los
  archivos y el tamaño antes de comprimir.
- Ojo: hoy las bases **LoRA de Cloudflare devuelven error 500** (probado incluso sin
  adaptador). El adaptador se guarda igual, para cuando eso se resuelva.

## Enlaces

- Unsloth: https://github.com/unslothai/unsloth
- TRL (`SFTTrainer`): https://huggingface.co/docs/trl
- LoRA en Cloudflare: https://developers.cloudflare.com/workers-ai/fine-tunes/

# Entrenamiento del modelo (FASE 6)

Aquí vive el material para **entrenar un adaptador LoRA** de ARIA **sin gastar tu
computador**: se hace en la GPU gratuita de Kaggle (o Colab).

## Qué hay

- `aria-lora-kaggle.ipynb`: el cuaderno de entrenamiento. Se sube a Kaggle y se ejecuta.

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

## Avisos importantes

- **Es un punto de partida, no está probado de punta a punta.** Las librerías
  (`unsloth`, `trl`, `peft`) cambian de versión seguido. Si una celda falla por el
  nombre de un parámetro, el propio cuaderno explica dónde moverlo.
- **Privacidad**: `aria-chat.jsonl` tiene tus conversaciones. Mantené el dataset de
  Kaggle **privado** y **nunca** lo subas a un repositorio público de Hugging Face.
- **Con pocas conversaciones el modelo memoriza** en vez de aprender. Hoy hay muy
  pocas: sirve para comprobar que el circuito funciona, no para tener un buen modelo.
- El adaptador se configura con **rango 8**, que es el máximo que acepta Cloudflare, y
  queda bien por debajo de los 300 MB permitidos.
- Ojo: hoy las bases **LoRA de Cloudflare devuelven error 500** (probado incluso sin
  adaptador). El adaptador se guarda igual, para cuando eso se resuelva.

## Enlaces

- Unsloth: https://github.com/unslothai/unsloth
- TRL (`SFTTrainer`): https://huggingface.co/docs/trl
- LoRA en Cloudflare: https://developers.cloudflare.com/workers-ai/fine-tunes/

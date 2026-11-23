---
title: Fase 6 — LoRA aria-v1 (descartada)
tags: [aria, fase6, lora, descartada, kaggle]
estado: descartada
fecha: 2026-10-16 a 2026-11-13
---

# Fase 6 — LoRA de estilo/código ❌ Descartada (2026-11-13)

## Resultado final

Se entrenó `aria-v1` en Kaggle con 86 ejemplos, se subió a Cloudflare y se comparó con la base en **24 casos nuevos**. El adaptador **no mejora**: pierde corrección y completitud y muestra repetición degenerada. Se borró de Cloudflare (`200 {"success":true,...}`). El ZIP local sigue en `C:\Users\pablo\Downloads\aria-lora.zip`, pero no se reutiliza.

## Verificación previa (corregida)

- La primera lectura ("solo 5 bases 2B–7B") era **falsa**: miraba los nombres con sufijo `-lora`. La fuente correcta es el facet `?capabilities=LoRA`: **9 bases**, incluidas `@cf/qwen/qwen2.5-coder-32b-instruct` y `@cf/qwq-32b`.
- LoRA y QLoRA en Workers AI: open beta gratis, `r ≤ 8`, adaptador < 300 MB, solo `adapter_config.json` + `adapter_model.safetensors`, ≤100 adaptadores/cuenta, no editable tras subir.
- `model_type` debe ser `mistral`, `gemma` o `llama`: un adaptador Qwen **no se puede subir** con esa validación, aunque Qwen figure como base. Por eso el cuaderno entrena Llama 3.2 3B (por defecto) o Mistral 7B.
- `base_model_name_or_path` debe ser la base canónica (`meta-llama/Llama-3.2-3B-Instruct`, `mistralai/Mistral-7B-Instruct-v0.2`), no la ruta `unsloth/...-bnb-4bit`.
- Ruta de subida: `POST /ai/finetunes/{id}/finetune-assets` **sin barra final** (con barra da 404).
- En vivo (2026-10-30): las bases `-lora` y los **adaptadores propios** responden 200; los públicos `cf-public-*` siguen en 500 por metadatos antiguos. Eso no bloquea a los propios.

## Dataset

- `scripts/build-lora-dataset.ts` + `scripts/lora-dataset-lib.ts` + `scripts/lora-seed.ts`.
- `app/lib/scrub.ts` tapa claves, correos, IPs, rutas con nombre de usuario, teléfonos, DNI, tarjetas y hashes antes de escribir nada.
- Resultado: **15 turnos reales + 71 ejemplos sintéticos = 86 ejemplos**, 1 IP anonimizada, 0 secretos detectados.
- Opciones: `--dry`, `--no-seed`, `--seed-only`, `--by-conversation`, `--with-tools`, `--fake`, `--min-assistant-chars`, `--max-context-messages`.
- Tests: 14 en `lora-dataset.test.ts`, 14 en `scrub.test.ts`, 5 en `vault-docs.test.ts`, 5 en `vault-reindex.test.ts`.
- El JSONL real vive en `data/lora/` (ignorado). El set sintético sí se versiona. Ver [[Datos y privacidad]].

## Cuaderno de Kaggle

- `training/aria-lora-kaggle.ipynb` + `training/README.md` (PR #13 corrigió el entorno).
- **No desinstalar ni reinstalar `torch` CUDA**: la imagen de Kaggle ya trae una build compatible y reemplazarla rompe `peft`, `bitsandbytes` y `unsloth`.
- Instalar `unsloth==2026.11.4` + `unsloth_zoo==2026.11.4`, importar `unsloth` antes que `transformers`/`trl` y fallar temprano si no hay CUDA.
- Checkpoint al final de cada época y reanudación automática tras reinicio; Kaggle borra `/kaggle/working` al reiniciar.
- GPU gratuita (P100/T4 16 GB): entrenable 3B–7B; un QLoRA de 32B pide ≳24 GB y no cabe.

## Evaluación (2026-11-13)

24 casos nuevos × 2 system prompts × (base / LoRA) = **96 generaciones** y **48 comparaciones ciegas** con `openai/gpt-oss-120b`.

| Condición | Gana base | Gana LoRA | Empates |
|---|---:|---:|---:|
| Prompt de entrenamiento | 16 | 7 | 1 |
| Prompt de producción | 11 | 9 | 4 |

| Criterio (base / LoRA) | Entrenamiento | Producción |
|---|---:|---:|
| Corrección | 2,63 / 1,88 | 2,50 / 2,21 |
| Completitud | 3,21 / 2,13 | 3,08 / 2,54 |
| Claridad | 3,71 / 2,67 | 3,33 / 3,29 |
| Criterio | 2,71 / 1,96 | 2,58 / 2,17 |
| Formato | 4,13 / 3,21 | 4,04 / 3,71 |

8 respuestas tuvieron repetición degenerada (hasta 8 líneas iguales) y un caso entró en bucle; a temperatura 0,7 baja pero no desaparece.

## Puente a Obsidian

`npm run docs:vault` copia `README.md`, `ROADMAP.md` y `REPO_MAP.md` a `ARIA/Repositorio ai-assistant/` del vault y los indexa en `VaultNote` (en el Worker no hay disco). Quedaron sin vector por cuota; re-ejecutar cuando se reponga. `reindexVaultEmbeddings` omite notas sin cambios (`needsReindex`); `force` lo fuerza.

## Decisiones y cierre

No se integra. Con 86 ejemplos, `r=8` y 3 épocas, el adaptador sobreajusta. Para reintentar harían falta cientos o miles de ejemplos, set **held-out** y **early stopping**; primero hay que generar señal con el [[Piloto/Piloto de trazas]]. Documentado en el PR #14.

> [!danger] No reabrir
> Fase 6 está cerrada. El [[Piloto/Piloto de trazas]] existe para decidir con veredictos antes de cualquier reintento.

## Enlaces

[[Inicio]] · [[Piloto/Trazas y evaluación]] · [[Datos y privacidad]] · [[Decisiones]] · [[Registro de PRs]]

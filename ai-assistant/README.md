# ARIA — Advanced AI Assistant

Asistente de IA conversacional con Next.js 15, React, TypeScript, Tailwind CSS, PostgreSQL y Prisma.

## Stack

- **Frontend**: Next.js 15, React 18, Tailwind CSS 3, TypeScript
- **Backend**: Next.js API Routes, Prisma 6.19 ORM
- **Base de datos**: Neon (PostgreSQL serverless) + pgvector (búsqueda semántica por embeddings)
- **IA**: Groq (`gpt-oss-120b`, `qwen3.8-27b`, `gpt-oss-20b`) + **DeepSeek R1 32B gratis** vía Cloudflare Workers AI
- **Embeddings**: Cloudflare Workers AI `@cf/baai/bge-m3` (1024 dims), mismo modelo en local y en producción
- **Deploy**: Cloudflare Workers vía `@opennextjs/cloudflare`
- **Markdown**: react-markdown + react-syntax-highlighter
- **TTS (voz de salida)**: Web Speech API (SpeechSynthesis), voz en español y modo "leer respuestas" automático
- **Dictado por voz (STT)**: Groq Whisper `large-v3-turbo` en el servidor (grabado con `MediaRecorder`), con fallback a Workers AI Whisper y, si el navegador no soporta grabación, a la Web Speech API

## Inicio rápido

### 1. Prerrequisitos

- Node.js 18+
- PostgreSQL 18 corriendo en `localhost:5432`
- Una API key de [Groq](https://console.groq.com)

### 2. Instalar dependencias

```bash
npm install
```

### 3. Configurar variables de entorno

Edita `.env.local` (aplicación) y `.env` (CLI de Prisma):

```
# .env.local — la app usa el pooling de Neon
GROQ_API_KEY=gsk_tu-api-key-aqui
DATABASE_URL=postgres://usuario:pass@host-pooler.neon.tech/aria
CLOUDFLARE_API_TOKEN=tu_token_workers_ai
CLOUDFLARE_ACCOUNT_ID=tu_account_id
VAULT_PATH=C:\ruta\a\tu\vault-de-obsidian
# Obligatoria en produccion: protege la URL publica con una clave de acceso.
# Sin ella, en produccion la app falla cerrada.
ARIA_ACCESS_TOKEN=una-clave-larga-y-secreta
```

```
# .env — el CLI de Prisma necesita la conexión directa
DATABASE_URL=postgres://usuario:pass@host-pooler.neon.tech/aria
DATABASE_URL_UNPOOLED=postgres://usuario:pass@host-directo.neon.tech/aria?sslmode=require
```

### 4. Configurar base de datos

```bash
npx prisma migrate deploy     # aplica las migraciones (Neon)
npm run db:reindex            # indexa las 77 notas del vault + memorias (bge-m3)
```

### 5. Iniciar servidor de desarrollo

```bash
npm run dev
```

Ojo: el vault físico (`.md`) se queda local; sus embeddings se suben a Neon con `db:reindex`, así la búsqueda semántica del vault funciona también en el Worker desplegado.

## Scripts

| Comando | Descripción |
|---------|-------------|
| `npm run dev` | Servidor de desarrollo |
| `npm run build` | Build de producción (Next) |
| `npm start` | Servidor de producción (Node) |
| `npm run lint` | Linter |
| `npm run typecheck` | Comprobación de tipos (`tsc --noEmit`) |
| `npm test` | Toda la suite: unit + integración |
| `npm run test:unit` | Solo tests unitarios (sin red ni BD) |
| `npm run test:integration` | Migra la BD de pruebas y ejecuta los tests de integración |
| `npm run test:watch` | Vitest en modo watch |
| `npm run db:up` | Levantar el Postgres propio con pgvector (Docker, puerto 5433) |
| `npm run db:down` | Parar el Postgres propio (el volumen persiste) |
| `npm run db:psql` | Consola `psql` en la BD `aria` |
| `npm run db:migrate` | Ejecutar migraciones Prisma |
| `npm run db:studio` | Abrir Prisma Studio |
| `npm run db:reindex` | Regenerar embeddings del vault en pgvector |
| `npm run db:smoke` | Smoke test del sistema de memoria |
| `npm run db:brain` | Smoke test del cerebro: memoria de trabajo, refuerzo, edición y consolidación |
| `npm run agent` | Arranca el agente local que abre apps en tu PC (`local-agent/`) |
| `npm run preview` | Build OpenNext + preview local en workerd |
| `npm run deploy` | Build OpenNext + deploy a Cloudflare Workers |

## Tests

Vitest con dos capas dentro de `tests/`:

- **Unitarios** (`tests/unit/`): lógica pura — extractor de memorias, WhatsApp, ZIP, auth, ARIA core. No tocan red ni base de datos.
- **Integración** (`tests/integration/`): memoria a largo plazo y memoria de trabajo contra PostgreSQL de verdad (dedupe, búsqueda semántica, refuerzo, consolidación, TTL…).

**Regla de oro:** los tests nunca usan la base de producción. Los de integración apuntan a `TEST_DATABASE_URL`; si no está definida, se omiten (no fallan). El hook `tests/setup.ts` reescribe `DATABASE_URL` con la de pruebas, instala el driver adapter `@prisma/adapter-pg` (TCP, con el que hablan el Postgres propio), fuerza embeddings locales (`EMBEDDING_PROVIDER=local`, deterministas y sin gastar cuota de Workers AI) y registra el loader WASM de Prisma.

```bash
npm test                 # todo
npm run test:unit        # solo unitarios
npm run test:integration # migra la BD de pruebas y ejecuta integración
npm run test:watch       # watch
```

Para los de integración necesitas un Postgres con pgvector; el de esta misma repo es el más fácil (ver [Postgres propio](#postgres-propio-docker)):

```bash
npm run db:up            # pgvector en el puerto 5433; docker/init.sql
                         # crea la BD aria_test en el primer arranque
npm run test:integration # aplica las migraciones solas y ejecuta los tests
```

`.env.local` ya apunta a `postgres://postgres:aria@localhost:5433/aria_test` (nunca a producción). Sin Docker, la alternativa es una BD aislada en Neon: descomenta la segunda línea de `TEST_DATABASE_URL` en `.env.local`.

En CI (`.github/workflows/ci.yml`), cada PR ejecuta lint + typecheck + unit, y el job de integración levanta un service container `pgvector/pgvector:pg17`: los tests corren siempre, **sin secretos**.

## Postgres propio (Docker)

El desarrollo, los tests y el CI usan un PostgreSQL propio con **pgvector** en vez de Neon:

```bash
npm run db:up      # docker compose up -d → pgvector/pgvector:pg17 en el puerto 5433
npm run db:psql    # consola psql en la BD "aria"
npm run db:down    # para el servidor (el volumen aria-pgdata persiste)
```

- **Puerto 5433** para no chocar con un PostgreSQL ya instalado en la máquina (suele ocupar el 5432).
- **Bases**: `aria` (app) y `aria_test` (pruebas), creadas por `docker/init.sql` en el primer arranque del volumen; `vector` se instala allí y las migraciones de Prisma lo confirman con `CREATE EXTENSION IF NOT EXISTS vector`.
- **Esquema**: siempre vía migraciones — `npm run test:integration` aplica las de pruebas solo; `npm run db:migrate` aplica las tuyas contra la URL de `.env`.
- **En el VPS**: sube `docker-compose.yml` + `docker/init.sql`, define `POSTGRES_PASSWORD` en un `.env` al lado del compose y levanta con `docker compose up -d` (el `restart: unless-stopped` lo mantiene vivo).

### Cómo se elige el driver adapter

Prisma necesita dos caminos distintos según dónde corra el código (ver `app/lib/prisma.ts`):

| Entorno | Adapter | Motivo |
|---------|---------|--------|
| Workers (producción) | `@prisma/adapter-neon` (HTTP) | workerd no tiene `node:net`: `pg` rompería el bundle |
| Node (tests y scripts) | `@prisma/adapter-pg` (TCP) | lo registra `scripts/register-pg-adapter.mjs` (`--import` en los scripts, import en `tests/setup.ts`); habla TCP con el Postgres propio y también con el TCP de Neon |

`app/lib/prisma.ts` lee la fábrica del adapter de `globalThis`: si existe (Node) usa `pg`; si no (Workers), usa Neon. `@prisma/adapter-pg` solo se importa desde archivos Node-only, así que **nunca entra en el bundle del Worker**.

Para forzar el adapter HTTP de Neon en Node (p. ej. correr los tests contra la BD de pruebas de Neon cuya URL está comentada en `.env.local`):

```bash
PRISMA_ADAPTER=neon npm test
```

La producción sigue apuntando a Neon: moverla al Postgres propio exige un puente TCP compatible con Workers (p. ej. Cloudflare Hyperdrive) y queda fuera de esta rama.

## Variables de entorno

| Variable | Descripción | Requerida |
|----------|-------------|-----------|
| `GROQ_API_KEY` | API key de Groq | ✅ |
| `DATABASE_URL` | URL pooled de Neon (app) | ✅ |
| `DATABASE_URL_UNPOOLED` | URL directa de Neon (CLI de Prisma) | ✅ |
| `TEST_DATABASE_URL` | BD de pruebas aislada para `npm run test:integration` (por defecto, `postgres://…@localhost:5433/aria_test`; sin ella, esos tests se omiten) | tests |
| `CLOUDFLARE_API_TOKEN` | Token con permiso Workers AI (embeddings) | ✅ |
| `CLOUDFLARE_ACCOUNT_ID` | Account ID de Cloudflare | ✅ |
| `VAULT_PATH` | Ruta al vault Obsidian (solo local) | local |
| `ARIA_ACCESS_TOKEN` | Clave de acceso a la app. Si está definida, toda la API exige `Authorization: Bearer <clave>` y el cliente muestra un login. **En producción es obligatoria**: sin ella la app falla cerrada (deniega todo) y el deploy aborta | ✅ en producción |
| `NEXT_PUBLIC_ARIA_LOCAL_AGENT` | URL del agente local que abre apps (por defecto `http://127.0.0.1:8787`). No es un secreto: puede ir en el bundle | no |
| `ARIA_LOCAL_TOKEN` | Token del **agente local** (no de la web). Si no se define, el agente lo genera y lo imprime. El navegador lo pide una vez y lo guarda en `localStorage`; nunca va en el bundle | agente |
| `WHATSAPP_TOKEN` | Token permanente de la app de Meta (WhatsApp Cloud API) | para WhatsApp |
| `WHATSAPP_PHONE_NUMBER_ID` | ID del número de WhatsApp Business | para WhatsApp |
| `WHATSAPP_VERIFY_TOKEN` | Cadena inventada por ti para verificar el webhook | para WhatsApp |
| `WHATSAPP_APP_SECRET` | App secret de Meta, para validar la firma del webhook | recomendada |
| `WHATSAPP_ALLOWED_NUMBERS` | Lista blanca de teléfonos separada por comas | no |
| `RESEND_API_KEY` | API key de Resend para enviar correo | para correo |
| `EMAIL_FROM` | Remitente (`ARIA <onboarding@resend.dev>` por defecto) | no |
| `EMAIL_ALLOWED_TO` | Lista blanca de destinatarios separada por comas | no |
| `GITHUB_TOKEN` | Token fine-grained de GitHub (solo `Contents: read` e `Issues: read`; en CI se guarda como el secret `ARIA_GITHUB_TOKEN`) para leer repos privados, **listar tus repositorios en el selector** y subir el límite a 5.000 peticiones/hora. Sin él, solo repos públicos y 60/hora | para GitHub privado |

> **Búsqueda web sin API key**: `web_search` usa **Firecrawl keyless** (SERP real
> y noticias) más APIs gratuitas y sin clave (Wikipedia, Stack Exchange, Hacker
> News, MDN, endoflife.date y GitHub Releases). Es opcional definir
> `FIRECRAWL_API_KEY` (tier gratis de 1.000 créditos/mes) para subir el límite
> keyless por IP. El detalle de fuentes está en `app/lib/web-search.ts`.

> **Control de acceso (obligatorio en producción)**: define el secret
> `ARIA_ACCESS_TOKEN` (secret de GitHub para el pipeline, o
> `wrangler secret put ARIA_ACCESS_TOKEN`). La app pedirá la clave en el
> navegador (se guarda en `localStorage` y se envía en cada petición). Sin el
> secret, **en producción la app falla cerrada** (deniega todas las rutas
> `/api/*`) y el workflow de deploy aborta; solo queda abierta en desarrollo y
> en los tests, para poder trabajar sin configurar nada.

> **Dictado por voz**: el audio se graba en el navegador y se manda a
> `/api/transcribe`, que lo pasa a **Groq Whisper** (usa la misma `GROQ_API_KEY`;
> tier gratis de 2.000 transcripciones/día). Si Groq falla se intenta **Workers
> AI Whisper** (dentro de las 10.000 neuronas/día). No se guarda ningún audio: se
> transcribe en memoria y se descarta.

> **GitHub con token (repos privados + selector)**: crea un token
> **fine-grained** en <https://github.com/settings/tokens?type=beta> con permisos
> de **solo lectura** (`Metadata: Read`, `Contents: Read`, `Issues: Read`) y
> marca los repositorios que quieras que ARIA pueda leer. Guárdalo como secret
> **`ARIA_GITHUB_TOKEN`** del repositorio en GitHub (el nombre `GITHUB_TOKEN`
> está reservado por Actions) o directamente en el Worker con
> `wrangler secret put GITHUB_TOKEN`. Con él, el panel **GitHub** muestra
> **«Ver mis repositorios»** para elegirlos de una lista (públicos y privados) y
> el límite sube de 60 a 5.000 peticiones/hora. ARIA sigue siendo de solo lectura.

## Características

- Streaming en tiempo real (SSE)
- Conversaciones persistentes en PostgreSQL
- Búsqueda en sidebar
- 5 modelos de IA seleccionables (incl. DeepSeek R1 gratis)
- Markdown + syntax highlighting
- Tema oscuro/claro
- **Voz de salida (TTS)** — botón "Escuchar" en cada mensaje y modo **Voz** en el header: ARIA lee sus respuestas en voz alta (voz en español; en iOS se desbloquea con el primer gesto)
- **Dictado por voz que funciona en cualquier navegador** — graba con `MediaRecorder` y transcribe con Groq Whisper `large-v3-turbo` (gratis: 2.000 transcripciones/día); fallback a Workers AI Whisper y a la Web Speech API. El texto se añade a lo que ya hayas escrito (antes lo reemplazaba)
- Atajos de teclado (Ctrl+N, Escape)
- Confirmación al eliminar
- Diseño responsive
- **Tool calls visibles en la UI** — tarjetas colapsables con args y resultado (persistidos en DB)
- **Acceso protegido por clave** — si `ARIA_ACCESS_TOKEN` está definido, la API exige `Authorization: Bearer` y el cliente muestra login; la clave se guarda solo en el navegador
- **Exportar conversaciones a Markdown** — botón en el header
- **Índice del vault Obsidian** — indexación automática al iniciar (`.aria-index.json`)
- **Búsqueda semántica real (pgvector)** — embeddings `bge-m3` vía Workers AI (1024 dims), indexados en las tablas `VaultNote` y `Memory`; el mismo modelo en local y en producción
- **Memoria de ARIA** — long-term/factual (tabla `Memory` con `vector(1024)`), dedupe por coseno, extracción automática de preferencias/hechos por turno y retrieval inyectado en el prompt
- **Memoria viva** — memoria de trabajo aislada por conversación e inyectada en el prompt (hilo de temas), refuerzo de los recuerdos que se usan (sube importancia/confianza), y consolidación/olvido automático: los recuerdos viejos y poco importantes se archivan y dejan de recuperarse; los ya olvidados se purgan y los contextos de sesión caducados se limpian
- **Inspector de memoria** — panel lateral para ver, buscar (búsqueda semántica), editar, añadir, archivar/olvidar recuerdos y lanzar la consolidación a mano; muestra estadísticas (total, preferencias, hechos, importancia media)
- **Herramientas ampliadas** — web_search, vault (buscar/leer/guardar), calculate, get_time, get_weather (Open-Meteo), semantic_search, recall_memory, **GitHub (solo lectura)** y **carpeta ARIA** (guardar/listar/leer notas en la nube)
- **Rate limiting nativo** — límite por ruta con el binding `ratelimits` de Workers (chat 20/min, dictado 15/min) como red de seguridad si la clave se filtra
- **WhatsApp (API oficial de Meta)** — ARIA recibe y responde mensajes por el webhook `/api/whatsapp/webhook`. Cada número tiene su propia conversación (visible en el sidebar) y comparte el mismo cerebro (memoria, herramientas). Firma `X-Hub-Signature-256` verificada.
- **Correo saliente (Resend)** — la herramienta `send_email` permite a ARIA enviar correos. Funciona sin dominio propio usando el remitente de pruebas de Resend; con dominio verificado solo cambia `EMAIL_FROM`.
- **Abrir aplicaciones en tu PC** — la herramienta `open_app` delega en un agente local que corre en tu máquina (`local-agent/`). Desde el chat puedes pedir "abre Spotify", "abre VS Code", "abre la carpeta Descargas", etc. El agente escucha solo en `127.0.0.1` y exige token. Un indicador en el header muestra si está conectado.
- **GitHub (solo lectura)** — botón **GitHub** en el header para agregar repos (`owner/repo` o la URL). Con `GITHUB_TOKEN` (fine-grained, solo lectura) además aparece **«Ver mis repositorios»**, que lista tus repos (públicos y privados) con buscador para agregarlos con un clic. ARIA los lee (`github_repo_overview`, `github_list_files`, `github_read_file`, `github_list_issues`) y te propone cómo arreglar bugs, issues y deuda técnica. **Nunca escribe** en GitHub: nada de issues ni PRs.
- **Auto-cambio de modelo** — si el modelo elegido agota su cuota (Groq: tokens/día; Workers AI: neuronas/día), ARIA reintenta la misma pregunta con el siguiente modelo disponible y te avisa con un banner. Así una respuesta no se queda sin salir porque un modelo se quedó sin cupo. Además, si el modelo elegido **no ejecuta herramientas** (DeepSeek) y le pedís algo que sí las necesita (leer un repo de GitHub, buscar en la web, abrir una app), ARIA responde con un modelo de Groq que sí las tiene y te avisa del cambio.
- **Carpeta ARIA (notas + Obsidian)** — botón **Notas** en el header. ARIA puede guardar, listar y leer notas (`save_cloud_note`, `list_cloud_notes`, `read_cloud_note`) y tú las editas en el panel. Viven en la base de datos (tabla `Note`) a propósito: el Worker **no puede** escribir en el disco del PC, así que así funcionan desde el celular sin tener el ordenador encendido. El botón **Exportar a Obsidian (.zip)** descarga un `.md` por nota (con frontmatter) listo para descomprimir dentro del vault.
- **Núcleo compartido** — `app/lib/aria-core.ts` centraliza prompt, memoria y contexto; el chat web, WhatsApp y el correo usan exactamente el mismo cerebro.

## Modelos e IA gratis (DeepSeek)

En el selector del header puedes elegir:

| Modelo | Proveedor | Cuota gratis | Herramientas |
|--------|-----------|--------------|--------------|
| GPT-OSS 120B | Groq | 200.000 tokens/día | ✅ |
| Qwen 3.8 27B | Groq | 200.000 tokens/día | ✅ |
| GPT-OSS 20B | Groq | 200.000 tokens/día | ✅ |
| **DeepSeek R1 32B** | **Cloudflare Workers AI** | **10.000 neuronas/día** | ❌ (solo razonamiento) |

DeepSeek se sirve con el **binding `AI`** que ya estaba configurado para los embeddings: **no hace falta ninguna API key nueva**. Al ser un modelo de razonamiento no admite function calling, así que en ese modo ARIA responde sin herramientas (web, vault, abrir apps…). Úsalo como alternativa gratuita cuando se agote la cuota de Groq o para preguntas que pidan razonamiento profundo; eso sí, su cuota gratuita es mucho más pequeña que la de Groq.

Además, si el modelo que tienes seleccionado se queda sin cuota a mitad de uso, ARIA **cambia solo** al siguiente de la lista (te avisa en el header) y vuelve a intentar la misma pregunta, sin que tengas que tocar el selector.

## Usar desde el móvil (PWA)

La app es responsive y además **instalable**: en el navegador del móvil, "Añadir a pantalla de inicio" abre ARIA a pantalla completa (manifest + iconos + `viewport-fit=cover`, con las zonas seguras del notch respetadas).

- El dictado por voz y la lectura en voz alta funcionan en el móvil; con el botón **Voz** del header ARIA lee cada respuesta al terminarla.
- Si defines `ARIA_ACCESS_TOKEN`, en el móvil tendrás que introducir la clave una vez (se guarda en ese navegador).
- El agente local de "abrir apps en tu PC" **no** funciona desde el móvil (`127.0.0.1` sería el propio teléfono). Para eso usa ARIA en el PC.

## WhatsApp

ARIA usa la **WhatsApp Cloud API oficial de Meta** (gratis hasta ~1.000 conversaciones de servicio/mes). No usa librerías no oficiales como Baileys: necesitan un proceso 24/7 y pueden banear el número.

1. Crea una app en [developers.facebook.com](https://developers.facebook.com) y añade el producto **WhatsApp**.
2. Consigue un **número dedicado** (no puede ser uno que ya uses en WhatsApp) y su **Phone number ID**.
3. Crea un token permanente y copia el **App secret**.
4. Define los secrets en Cloudflare:
   ```bash
   npx wrangler secret put WHATSAPP_TOKEN
   npx wrangler secret put WHATSAPP_PHONE_NUMBER_ID
   npx wrangler secret put WHATSAPP_VERIFY_TOKEN      # invéntate una cadena
   npx wrangler secret put WHATSAPP_APP_SECRET
   # opcional: restringe quién puede escribirle
   npx wrangler secret put WHATSAPP_ALLOWED_NUMBERS   # ej. 34600111222,34600333444
   ```
5. En Meta, configura el webhook con:
   - **Callback URL**: `https://<tu-worker>.workers.dev/api/whatsapp/webhook`
   - **Verify token**: el mismo `WHATSAPP_VERIFY_TOKEN`.
   - Suscríbete al campo **messages**.
6. Escribe a ese número desde tu teléfono: ARIA crea una conversación titulada `WhatsApp <tu nombre>` que aparece en el sidebar.

> La ruta del webhook **no** exige `ARIA_ACCESS_TOKEN` (Meta no puede enviarlo); la autenticidad se garantiza con la firma `X-Hub-Signature-256`. El procesamiento es asíncrono: se responde 200 a Meta al instante y ARIA contesta vía Graph API.

## Correo

ARIA puede **enviar** correo con [Resend](https://resend.com) (free tier: 3.000/mes, 100/día):

```bash
npx wrangler secret put RESEND_API_KEY
# opcional:
npx wrangler secret put EMAIL_FROM          # p. ej. "ARIA <aria@tudominio.com>"
npx wrangler secret put EMAIL_ALLOWED_TO     # p. ej. "tu@correo.com" (lista blanca)
```

Sin dominio propio puedes probar ya: Resend permite enviar desde `onboarding@resend.dev` **solo al correo de tu cuenta**. Con un dominio verificado (DNS con SPF/DKIM) cambia `EMAIL_FROM` a `ARIA <aria@tudominio.com>`.

**Recibir** correo requiere Cloudflare Email Routing sobre un dominio propio y aún no está implementado (el código de entrada quedaría como un Worker de email). Si consigues un dominio, se puede añadir después con el mismo motor (`generateTextReply`).

> Añade estos secrets también como **GitHub secrets** del repo para que el pipeline los publique en cada deploy.

## Abrir aplicaciones en tu PC (agente local)

Una web no puede lanzar apps de escritorio por sí sola y el Worker de Cloudflare no tiene acceso a tu ordenador. La solución es un pequeño agente que corre en tu máquina:

```bash
# 1. Configura el agente
cp local-agent/.env.example local-agent/.env   # define ARIA_LOCAL_TOKEN

# 2. Arranca el agente (deja la ventana abierta)
npm run agent

# 3. (Opcional) define la URL del agente en .env.local / secrets de GitHub:
#    NEXT_PUBLIC_ARIA_LOCAL_AGENT=http://127.0.0.1:8787
#    El TOKEN no va aquí: el navegador te lo pide la primera vez que abres una
#    app y lo guarda en su localStorage.
```

El header muestra un indicador verde cuando el agente está conectado. Pide en el chat: *"abre Spotify"*, *"abre VS Code"*, *"abre la carpeta Descargas"*, *"abre la calculadora"*. El agente escucha **solo en `127.0.0.1`** (no en la red), valida el `Origin` y **exige siempre el token** (si no defines `ARIA_LOCAL_TOKEN` lo genera al arrancar y lo imprime). Por defecto solo abre apps de su mapa, rutas existentes y URIs. Con `ARIA_ALLOW_ANY=1` permite cualquier ejecutable.

> El token del agente **nunca** se compila dentro de la web (nada de `NEXT_PUBLIC_*`): si lo pide, el navegador te muestra un diálogo y lo guarda en `localStorage`. Así la versión desplegada también funciona, sin recompilar y sin exponer el secreto a quien abra la app.

## Despliegue (Cloudflare Workers)

La BD vive en Neon (serverless); la app se despliega como Worker con `@opennextjs/cloudflare` (GitHub Actions → `.github/workflows/deploy.yml`).

1. **Neon**: crea el proyecto, copia las dos conexiones (pooled `DATABASE_URL` + directa `DATABASE_URL_UNPOOLED`).
2. **Cloudflare**: el Worker se llama `ai-assistant`; expone el binding `AI` (Workers AI) para los embeddings.
3. **Secrets de Cloudflare** (se ponen solos en el pipeline): `DATABASE_URL`, `GROQ_API_KEY` y `ARIA_ACCESS_TOKEN` (obligatorio). Opcional: `FIRECRAWL_API_KEY`.
4. **GitHub secrets** del repo: `DATABASE_URL`, `DATABASE_URL_UNPOOLED`, `GROQ_API_KEY`, `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` y `ARIA_ACCESS_TOKEN` (**obligatorio**: sin él el deploy aborta). Opcionales: `FIRECRAWL_API_KEY`.

El pipeline: `prisma migrate deploy` (Neon) → `opennextjs-cloudflare build` → `wrangler deploy` → `wrangler secret put` de los secrets configurados.

Pruebas locales del mismo entorno: `npm run preview` (Worker en workerd).

## Estructura

```
ai-assistant/
├── app/
│   ├── api/
│   │   ├── chat/route.ts            # Chat con Groq/Workers AI (streaming + memoria)
│   │   ├── conversations/           # CRUD de conversaciones
│   │   ├── memory/                  # CRUD + búsqueda semántica + consolidación de memoria
│   │   ├── notes/                   # CRUD de la "Carpeta ARIA" (notas en la nube)
│   │   ├── github/repos/route.ts    # Repos de GitHub configurados (solo lectura)
│   │   ├── whatsapp/webhook/route.ts # Webhook de WhatsApp Cloud API (Meta)
│   │   └── vault/index/route.ts     # Indexar vault (solo local)
│   ├── components/                  # UI components (incl. MemoryInspector.tsx, GithubRepos.tsx, NotesPanel.tsx)
│   ├── hooks/useTTS.ts              # Hook de TTS
│   ├── lib/
│   │   ├── prisma.ts               # Cliente Prisma (adapter Neon)
│   │   ├── background.ts           # ctx.waitUntil() para tareas tras responder
│   │   ├── aria-core.ts            # Núcleo compartido: prompt + memoria + contexto
│   │   ├── aria-reply.ts           # Respuesta sin streaming (WhatsApp/correo)
│   │   ├── whatsapp.ts             # Cloud API de Meta: verificación, parseo y envío
│   │   ├── email.ts                # Envío de correo (Resend)
│   │   ├── local-agent.ts          # Cliente del agente local (abrir apps)
│   │   ├── github.ts               # GitHub solo lectura (repos, archivos, issues)
│   │   ├── chat-client.ts          # Cliente de chat con auto-cambio de modelo
│   │   ├── llm-embed.ts            # Embeddings bge-m3 (Workers AI bind/REST)
│   │   ├── providers.ts            # Registro de proveedores (Groq / Workers AI)
│   │   ├── workers-ai.ts           # DeepSeek gratis vía binding AI (SSE normalizado)
│   │   ├── embeddings.ts           # Reindex + búsqueda coseno pgvector (vault)
│   │   ├── memory.ts               # Memoria long-term + working memory + consolidación
│   │   ├── memory-extract.ts       # Extracción de memorias (Groq + heurístico)
│   │   ├── vault-index.ts          # Índice de archivos del vault (TF-IDF fallback)
│   │   ├── notes.ts                # "Carpeta ARIA": notas en la nube (SQL directo)
│   │   ├── zip.ts                  # Exportar notas a .zip (sin dependencias)
│   │   └── store.ts                # API helpers
│   ├── types/index.ts              # Types + modelos disponibles
│   ├── globals.css                 # Estilos globales
│   ├── layout.tsx                  # Layout raíz
│   ├── manifest.ts                 # Manifest PWA (instalable en móvil)
│   └── page.tsx                    # Página principal
├── local-agent/                    # Agente local que abre apps en tu PC
│   ├── aria-local-agent.mjs        # Servidor HTTP en 127.0.0.1:8787
│   └── .env.example                # Configuración del agente
├── prisma/
│   ├── schema.prisma               # Schema de datos
│   └── migrations/                 # Migraciones SQL
├── scripts/                        # reindex.ts, smoke-memory.ts
├── wrangler.jsonc                  # Config del Worker
├── open-next.config.ts             # Config de OpenNext
├── .env.local                      # Variables de la app
├── .env                            # Variables del CLI de Prisma
└── next.config.js
```

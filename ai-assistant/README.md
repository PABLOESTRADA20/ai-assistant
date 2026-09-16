# ARIA — Advanced AI Assistant

Asistente de IA conversacional con Next.js 15, React, TypeScript, Tailwind CSS, PostgreSQL y Prisma.

## Stack

- **Frontend**: Next.js 15, React 18, Tailwind CSS 3, TypeScript
- **Backend**: Next.js API Routes, Prisma 7 ORM
- **Base de datos**: Neon (PostgreSQL serverless) + pgvector (búsqueda semántica por embeddings)
- **IA**: Groq API (Llama 3.3 70B, DeepSeek R1, Mixtral 8x7B, Llama 3.1 8B)
- **Embeddings**: Cloudflare Workers AI `@cf/baai/bge-m3` (1024 dims), mismo modelo en local y en producción
- **Deploy**: Cloudflare Workers vía `@opennextjs/cloudflare`
- **Markdown**: react-markdown + react-syntax-highlighter
- **TTS**: Web Speech API (SpeechSynthesis)
- **Voice Input**: Web Speech API (SpeechRecognition)

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
TAVILY_API_KEY=tvly-tu-api-key-aqui
CLOUDFLARE_API_TOKEN=tu_token_workers_ai
CLOUDFLARE_ACCOUNT_ID=tu_account_id
VAULT_PATH=C:\Users\pablo\OneDrive\Documentos\Cerebro tt
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
| `npm run db:migrate` | Ejecutar migraciones Prisma |
| `npm run db:studio` | Abrir Prisma Studio |
| `npm run db:reindex` | Regenerar embeddings del vault en pgvector |
| `npm run db:smoke` | Smoke test del sistema de memoria |
| `npm run preview` | Build OpenNext + preview local en workerd |
| `npm run deploy` | Build OpenNext + deploy a Cloudflare Workers |

## Variables de entorno

| Variable | Descripción | Requerida |
|----------|-------------|-----------|
| `GROQ_API_KEY` | API key de Groq | ✅ |
| `DATABASE_URL` | URL pooled de Neon (app) | ✅ |
| `DATABASE_URL_UNPOOLED` | URL directa de Neon (CLI de Prisma) | ✅ |
| `CLOUDFLARE_API_TOKEN` | Token con permiso Workers AI (embeddings) | ✅ |
| `CLOUDFLARE_ACCOUNT_ID` | Account ID de Cloudflare | ✅ |
| `TAVILY_API_KEY` | API key de Tavily (web search) | opcional |
| `VAULT_PATH` | Ruta al vault Obsidian (solo local) | local |

## Características

- Streaming en tiempo real (SSE)
- Conversaciones persistentes en PostgreSQL
- Búsqueda en sidebar
- 4 modelos de IA seleccionables
- Markdown + syntax highlighting
- Tema oscuro/claro
- Text-to-speech
- Entrada por voz
- Atajos de teclado (Ctrl+N, Escape)
- Confirmación al eliminar
- Diseño responsive
- **Tool calls visibles en la UI** — tarjetas colapsables con args y resultado (persistidos en DB)
- **Exportar conversaciones a Markdown** — botón en el header
- **Índice del vault Obsidian** — indexación automática al iniciar (`.aria-index.json`)
- **Búsqueda semántica real (pgvector)** — embeddings `bge-m3` vía Workers AI (1024 dims), indexados en las tablas `VaultNote` y `Memory`; el mismo modelo en local y en producción
- **Memoria de ARIA** — long-term/factual (tabla `Memory` con `vector(1024)`), dedupe por coseno, working memory (`SessionContext` con TTL), extracción automática de preferencias/hechos por turno y retrieval inyectado en el prompt
- **Herramientas ampliadas** — web_search, vault (buscar/leer/guardar), calculate, get_time, get_weather (Open-Meteo), semantic_search, recall_memory

## Despliegue (Cloudflare Workers)

La BD vive en Neon (serverless); la app se despliega como Worker con `@opennextjs/cloudflare` (GitHub Actions → `.github/workflows/deploy.yml`).

1. **Neon**: crea el proyecto, copia las dos conexiones (pooled `DATABASE_URL` + directa `DATABASE_URL_UNPOOLED`).
2. **Cloudflare**: el Worker se llama `ai-assistant`; expone el binding `AI` (Workers AI) para los embeddings.
3. **Secrets de Cloudflare** (se ponen solos en el pipeline): `DATABASE_URL`, `GROQ_API_KEY`, `TAVILY_API_KEY`.
4. **GitHub secrets** del repo: `DATABASE_URL`, `DATABASE_URL_UNPOOLED`, `GROQ_API_KEY`, `TAVILY_API_KEY`, `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`.

El pipeline: `prisma migrate deploy` (Neon) → `opennextjs-cloudflare build` → `wrangler deploy` → `wrangler secret put` ×3.

Pruebas locales del mismo entorno: `npm run preview` (Worker en workerd).

## Estructura

```
ai-assistant/
├── app/
│   ├── api/
│   │   ├── chat/route.ts            # Chat con Groq (streaming + memoria)
│   │   ├── conversations/           # CRUD de conversaciones
│   │   ├── memory/                  # CRUD + búsqueda semántica de memoria
│   │   └── vault/index/route.ts     # Indexar vault (solo local)
│   ├── components/                  # UI components
│   ├── hooks/useTTS.ts              # Hook de TTS
│   ├── lib/
│   │   ├── prisma.ts               # Cliente Prisma (adapter Neon)
│   │   ├── llm-embed.ts            # Embeddings bge-m3 (Workers AI bind/REST)
│   │   ├── embeddings.ts           # Reindex + búsqueda coseno pgvector (vault)
│   │   ├── memory.ts               # Memoria long-term + working memory
│   │   ├── memory-extract.ts       # Extracción de memorias (Groq + heurístico)
│   │   ├── vault-index.ts          # Índice de archivos del vault (TF-IDF fallback)
│   │   └── store.ts                # API helpers
│   ├── types/index.ts              # Types + modelos disponibles
│   ├── globals.css                 # Estilos globales
│   ├── layout.tsx                  # Layout raíz
│   └── page.tsx                    # Página principal
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

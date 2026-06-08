# ARIA — Advanced AI Assistant

Un asistente de IA conversacional moderno construido con Next.js 14, React, TypeScript y Tailwind CSS.

## 🚀 Inicio rápido

### 1. Instalar dependencias
```bash
npm install
```

### 2. Configurar variables de entorno
```bash
cp .env.example .env.local
```

Edita `.env.local` y añade tu API key:
```
OPENAI_API_KEY=sk-tu-api-key-aqui
```

### 3. Iniciar el servidor de desarrollo
```bash
npm run dev
```

Abre [http://localhost:3000](http://localhost:3000) en tu navegador.

---

## ✨ Características

- **Streaming en tiempo real** — Respuestas tipo ChatGPT con streaming SSE
- **Historial de conversaciones** — Guardado localmente en el navegador
- **Soporte para Markdown** — Renderizado completo con tablas, listas, etc.
- **Syntax highlighting** — Código con colores para todos los lenguajes
- **Cambio de modelo** — GPT-4o, GPT-4o Mini, GPT-3.5 Turbo
- **Tema oscuro/claro** — Con transición suave
- **Copiar respuestas** — Botón en cada mensaje y bloque de código
- **Regenerar respuesta** — Reintenta la última respuesta
- **Detener generación** — Cancela la respuesta en curso
- **Responsive** — Funciona en móvil y escritorio
- **Sidebar** — Con historial y búsqueda

## 🗂️ Estructura del proyecto

```
ai-assistant/
├── app/
│   ├── api/
│   │   └── chat/
│   │       └── route.ts          # API endpoint con streaming
│   ├── components/
│   │   ├── ChatContainer.tsx     # Contenedor principal del chat
│   │   ├── ChatInput.tsx         # Input con auto-resize
│   │   ├── MessageBubble.tsx     # Burbujas de mensaje con Markdown
│   │   ├── ModelSelector.tsx     # Selector de modelo IA
│   │   ├── Sidebar.tsx           # Panel lateral con historial
│   │   ├── TypingIndicator.tsx   # Animación "escribiendo..."
│   │   └── WelcomeScreen.tsx     # Pantalla inicial con sugerencias
│   ├── lib/
│   │   ├── mongodb.ts            # Conexión MongoDB (opcional)
│   │   ├── models/
│   │   │   └── Conversation.ts  # Schema de conversación
│   │   ├── openai.ts             # Cliente OpenAI + system prompt
│   │   └── store.ts              # LocalStorage helpers
│   ├── types/
│   │   └── index.ts              # TypeScript types
│   ├── globals.css               # Estilos globales + variables CSS
│   ├── layout.tsx                # Layout raíz
│   └── page.tsx                  # Página principal (orquestador)
├── .env.example
├── next.config.js
├── tailwind.config.ts
└── package.json
```

## 🔧 Variables de entorno

| Variable | Descripción | Requerida |
|----------|-------------|-----------|
| `OPENAI_API_KEY` | Tu API key de OpenAI | ✅ Sí |
| `MONGODB_URI` | URI de MongoDB para historial persistente | ❌ Opcional |
| `OPENAI_BASE_URL` | URL base para APIs compatibles (Azure, etc.) | ❌ Opcional |
| `DEFAULT_MODEL` | Modelo por defecto | ❌ Opcional |

## 🛠️ Tecnologías

- **Next.js 14** — App Router, API Routes, Edge Runtime
- **React 18** — Hooks, Suspense
- **TypeScript** — Tipado estricto
- **Tailwind CSS** — Utility-first styling
- **OpenAI SDK** — Streaming de respuestas
- **react-markdown** — Renderizado de Markdown
- **react-syntax-highlighter** — Syntax highlighting
- **framer-motion** — Animaciones
- **mongoose** — ODM para MongoDB (opcional)

## 📦 Deploy en Vercel

```bash
vercel deploy
```

Asegúrate de configurar las variables de entorno en el dashboard de Vercel.

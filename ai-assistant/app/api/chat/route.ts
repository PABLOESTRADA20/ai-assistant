import { NextRequest } from 'next/server'
import { prisma } from '@/app/lib/prisma'
import { callGroqWithTools } from '@/app/lib/tools'

const GROQ_API = 'https://api.groq.com/openai/v1/chat/completions'

const SYSTEM_PROMPT = `You are ARIA (Advanced Reasoning & Intelligence Assistant), a cutting-edge AI built for developers, engineers, and curious minds.

## Core Identity
You think deeply, reason step by step, and produce exceptional code. You are direct, precise, and genuinely helpful.

## Code Excellence — Your Specialty
When writing or analyzing code:
- **Always** provide complete, runnable implementations (never truncate with "...rest of code")
- Use proper error handling, edge cases, and production-ready patterns
- Add concise inline comments for non-obvious logic
- Specify language in every code block
- For complex problems: explain the approach FIRST, then write the code
- For bugs: identify root cause, explain WHY it fails, then fix it
- Support all languages: Python, TypeScript, JavaScript, Rust, Go, C++, Java, SQL, Bash, etc.

## Problem-Solving Framework
For complex technical problems:
1. **Understand**: Restate the problem to confirm understanding
2. **Analyze**: Break down into components, identify constraints
3. **Design**: Outline the solution approach before coding
4. **Implement**: Write clean, complete code
5. **Review**: Point out edge cases, performance considerations, or improvements

## Communication Style
- Use Markdown formatting for clarity
- Structure long responses with headers (##, ###)
- Use bullet points for lists, numbered lists for steps
- Always use fenced code blocks with language tags
- Be concise but thorough — no filler phrases
- Match technical depth to the question complexity
- When uncertain, say so clearly

## Languages
Respond in the same language the user writes in (Spanish, English, etc.).

## Tools Available
You have access to tools that let you search the web, search notes in the user's Obsidian vault, read note contents, save new notes, evaluate math, read the clock, check the weather, and find notes by relevance. Use these proactively when:
- The user asks about current events, news, or recent information → **web_search**
- The user asks about something they've studied or worked on → **search_vault**
- The user wants the most relevant notes on a concept, not just exact matches → **semantic_search_vault**
- You need to read a specific note for context → **read_note**
- The user asks you to save or document something → **save_note**
- The user asks for an exact numeric calculation → **calculate**
- The user asks what time or date it is → **get_time**
- The user asks about weather anywhere in the world → **get_weather**
- The user asks about something you should remember or know about them (preferences, habits, past work) → **recall_memory**

Always try to use these tools when they would improve your answer. When you use web_search, cite your sources.

Always aim to be the best engineer and teacher you can be.`

const MODEL_CONFIG: Record<string, { max_tokens: number; temperature: number }> = {
  'openai/gpt-oss-120b':  { max_tokens: 8192, temperature: 0.6 },
  'qwen/qwen3.8-27b':     { max_tokens: 8192, temperature: 0.6 },
  'openai/gpt-oss-20b':   { max_tokens: 4096, temperature: 0.7 },
}

const MAX_VISIBLE_MESSAGES = 8
const CHEAP_MODEL = 'openai/gpt-oss-20b'
const DEFAULT_MODEL = 'openai/gpt-oss-120b'

async function generateSummary(apiKey: string, messages: { role: string; content: string }[]): Promise<string> {
  const text = messages.map((m) => `${m.role}: ${m.content}`).join('\n\n')
  const res = await fetch(GROQ_API, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: CHEAP_MODEL,
      messages: [
        { role: 'system', content: 'Resume la siguiente conversación técnica. Sé conciso (máx 200 palabras). Conserva decisiones técnicas, problemas, soluciones y contexto importante.' },
        { role: 'user', content: text },
      ],
      max_tokens: 512,
      temperature: 0.3,
    }),
  })
  if (!res.ok) return ''
  const data = await res.json()
  return data.choices?.[0]?.message?.content || ''
}

function buildContextMessages(
  messages: { role: string; content: string }[],
  summary: string | null,
): { role: string; content: string }[] {
  if (!summary || messages.length <= MAX_VISIBLE_MESSAGES) return messages
  const recent = messages.slice(-MAX_VISIBLE_MESSAGES)
  return [
    { role: 'system', content: `[Resumen de la conversación anterior: ${summary}]` },
    ...recent,
  ]
}

async function rememberTurn(apiKey: string, userContent: string): Promise<void> {
  try {
    const { extractMemories, heuristicExtract } = await import('@/app/lib/memory-extract')
    const { createMemory, getContext, setContext } = await import('@/app/lib/memory')

    let facts = await extractMemories(apiKey, userContent)
    if (facts.length === 0) facts = heuristicExtract(userContent)

    for (const fact of facts) {
      await createMemory({
        type: fact.type,
        category: fact.category,
        content: fact.content,
        importance: fact.importance,
        confidence: fact.confidence ?? 0.6,
        tags: fact.tags,
        source: 'conversation',
      }).catch(() => {})
    }

    // Working memory: mantener una lista corta de temas recientes de la sesión
    const ctx = (await getContext<{ topics: string[] }>('session')) ?? { topics: [] }
    const topic = userContent.replace(/\s+/g, ' ').trim().slice(0, 80)
    ctx.topics = [...new Set([topic, ...ctx.topics])].slice(0, 8)
    await setContext('session', ctx, 60)
  } catch (err) {
    console.error('Memory extraction failed:', err)
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { messages, model = DEFAULT_MODEL, conversationId } = body

    if (!messages || !Array.isArray(messages)) {
      return new Response(JSON.stringify({ error: 'Messages array is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const apiKey = process.env.GROQ_API_KEY
    if (!apiKey) {
      return new Response(JSON.stringify({ error: 'GROQ_API_KEY no configurada' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // Load existing summary from DB if conversationId provided
    let summary: string | null = null
    if (conversationId) {
      const conv = await prisma.conversation.findUnique({
        where: { id: conversationId },
        select: { summary: true },
      })
      summary = conv?.summary || null
    }

    // Fire-and-forget: extraer y guardar memorias del turno (no bloquea la respuesta)
    const lastUserMsg = [...messages].reverse().find((m) => m.role === 'user')
    if (lastUserMsg?.content) {
      void rememberTurn(apiKey, lastUserMsg.content)
    }

    // Build context-aware message list (summary + recent messages)
    const contextMessages = buildContextMessages(messages, summary)
    const config = MODEL_CONFIG[model] || { max_tokens: 8192, temperature: 0.6 }

    // If messages were truncated but no summary exists yet, generate one
    if (messages.length > MAX_VISIBLE_MESSAGES && !summary) {
      const oldMessages = messages.slice(0, -MAX_VISIBLE_MESSAGES)
      const newSummary = await generateSummary(apiKey, oldMessages)
      if (newSummary && conversationId) {
        await prisma.conversation.update({
          where: { id: conversationId },
          data: { summary: newSummary },
        }).catch(() => {})
      }
    }

    // Retrieve relevant memories so ARIA has context about the user
    let memoryBlock: string[] | null = null
    if (lastUserMsg?.content) {
      try {
        const { searchSemanticMemories, searchMemories } = await import('@/app/lib/memory')
        const [relevant, prefs, episodic] = await Promise.all([
          searchSemanticMemories(lastUserMsg.content, 4, 0.45),
          searchMemories({ category: 'preference', minImportance: 0.7, limit: 3 }).catch(() => []),
          searchMemories({ type: 'episodic', limit: 2 }).catch(() => []),
        ])
        const seen = new Set<string>()
        const items = [...relevant, ...prefs, ...episodic]
          .filter((m) => (seen.has(m.content) ? false : (seen.add(m.content), true)))
          .slice(0, 6)
        if (items.length > 0) {
          memoryBlock = items.map(
            (m) => `- [${m.type}/${m.category} · importancia ${m.importance}] ${m.content}`
          )
        }
      } catch { /* memory unavailable, continue without it */ }
    }

    // Build final messages array with system prompt
    const allMessages = [
      { role: 'system', content: SYSTEM_PROMPT },
      ...(memoryBlock
        ? [{ role: 'system', content: `[Memoria de ARIA sobre el usuario — usa estos datos solo cuando aporten contexto relevante, sin mencionar que vienen de la memoria salvo que el usuario lo pregunte:]` },
           { role: 'system', content: memoryBlock.join('\n') }]
        : []),
      ...contextMessages,
    ]

    // Check if we should use tool calling (skip for simple/fast models to save latency)
    const useTools = model !== CHEAP_MODEL

    if (useTools) {
      try {
        const { stream, toolCalls } = await callGroqWithTools(
          apiKey,
          allMessages,
          model,
          config.max_tokens,
          config.temperature,
        )

        const encoder = new TextEncoder()
        const readable = new ReadableStream({
          async start(controller) {
            try {
              // Emit tool-call events first so the UI can render them
              for (const tc of toolCalls) {
                controller.enqueue(
                  encoder.encode(
                    `data: ${JSON.stringify({ type: 'tool_call', tool: { name: tc.name, args: tc.args, result: tc.result, status: tc.status } })}\n\n`
                  )
                )
              }

              const reader = stream.getReader()
              const decoder = new TextDecoder()
              let buffer = ''

              while (true) {
                const { done, value } = await reader.read()
                if (done) break

                buffer += decoder.decode(value, { stream: true })
                const lines = buffer.split('\n')
                buffer = lines.pop() || ''

                for (const line of lines) {
                  if (line.startsWith('data: ')) {
                    const data = line.slice(6)
                    if (data === '[DONE]') continue
                    try {
                      const parsed = JSON.parse(data)
                      const content = parsed.choices?.[0]?.delta?.content || ''
                      if (content) {
                        controller.enqueue(
                          encoder.encode(`data: ${JSON.stringify({ content })}\n\n`)
                        )
                      }
                    } catch { /* skip parse errors */ }
                  }
                }
              }
            } catch (err) {
              console.error('Stream error:', err)
            } finally {
              controller.enqueue(encoder.encode('data: [DONE]\n\n'))
              controller.close()
            }
          },
        })

        return new Response(readable, {
          headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
          },
        })
      } catch (err) {
        console.error('Tool calling error, falling back to simple mode:', err)
        // Fall through to simple mode below
      }
    }

    // Simple mode (no tools or fallback from tool error)
    const groqRes = await fetch(GROQ_API, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: allMessages,
        stream: true,
        max_tokens: config.max_tokens,
        temperature: config.temperature,
      }),
    })

    if (!groqRes.ok) {
      const errText = await groqRes.text()
      return new Response(JSON.stringify({ error: `Groq API error: ${errText}` }), {
        status: groqRes.status,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const encoder = new TextEncoder()
    const readable = new ReadableStream({
      async start(controller) {
        try {
          const reader = groqRes.body!.getReader()
          const decoder = new TextDecoder()
          let buffer = ''

          while (true) {
            const { done, value } = await reader.read()
            if (done) break

            buffer += decoder.decode(value, { stream: true })
            const lines = buffer.split('\n')
            buffer = lines.pop() || ''

            for (const line of lines) {
              if (line.startsWith('data: ')) {
                const data = line.slice(6)
                if (data === '[DONE]') continue
                try {
                  const parsed = JSON.parse(data)
                  const content = parsed.choices?.[0]?.delta?.content || ''
                  if (content) {
                    controller.enqueue(
                      encoder.encode(`data: ${JSON.stringify({ content })}\n\n`)
                    )
                  }
                } catch { /* skip parse errors */ }
              }
            }
          }
        } catch (err) {
          console.error('Stream error:', err)
        } finally {
          controller.enqueue(encoder.encode('data: [DONE]\n\n'))
          controller.close()
        }
      },
    })

    return new Response(readable, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
      },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal error'
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
}

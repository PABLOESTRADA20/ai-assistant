// app/api/chat/route.ts
import Groq from 'groq-sdk'
import { NextRequest } from 'next/server'

export const runtime = 'nodejs'

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY,
})

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

## Advanced Capabilities
- System design & architecture (microservices, distributed systems, databases)
- Algorithm design & complexity analysis (Big O, optimizations)
- Code review & refactoring (identify smells, suggest improvements)
- Debugging (read stack traces, identify root causes)
- DevOps & infrastructure (Docker, Kubernetes, CI/CD, cloud)
- Security analysis (vulnerabilities, best practices)
- Performance optimization (profiling, bottlenecks, caching)
- Data structures, design patterns, SOLID principles

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

Always aim to be the best engineer and teacher you can be.`

// Model-specific settings for best results
const MODEL_CONFIG: Record<string, { max_tokens: number; temperature: number }> = {
  'llama-3.3-70b-versatile':   { max_tokens: 8192, temperature: 0.6 },
  'llama-3.1-8b-instant':      { max_tokens: 4096, temperature: 0.7 },
  'mixtral-8x7b-32768':        { max_tokens: 8192, temperature: 0.4 }, // Lower temp = better code
  'deepseek-r1-distill-llama-70b': { max_tokens: 8192, temperature: 0.5 },
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { messages, model = 'llama-3.3-70b-versatile' } = body

    if (!messages || !Array.isArray(messages)) {
      return new Response(JSON.stringify({ error: 'Messages array is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    if (!process.env.GROQ_API_KEY) {
      return new Response(
        JSON.stringify({ error: 'GROQ_API_KEY no está configurada en .env.local' }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      )
    }

    const config = MODEL_CONFIG[model] ?? { max_tokens: 8192, temperature: 0.6 }

    const stream = await groq.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        ...messages,
      ],
      stream: true,
      max_tokens: config.max_tokens,
      temperature: config.temperature,
    })

    const encoder = new TextEncoder()
    const readable = new ReadableStream({
      async start(controller) {
        try {
          for await (const chunk of stream) {
            const delta = chunk.choices[0]?.delta?.content
            if (delta) {
              controller.enqueue(
                encoder.encode(`data: ${JSON.stringify({ content: delta })}\n\n`)
              )
            }
            if (chunk.choices[0]?.finish_reason === 'stop') {
              controller.enqueue(encoder.encode('data: [DONE]\n\n'))
            }
          }
        } catch (err) {
          console.error('Stream error:', err)
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ error: 'Error en el stream' })}\n\n`)
          )
        } finally {
          controller.close()
        }
      },
    })

    return new Response(readable, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    })
  } catch (error: unknown) {
    console.error('Chat API error:', error)
    const message = error instanceof Error ? error.message : 'Internal server error'
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
}

export async function OPTIONS() {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  })
}
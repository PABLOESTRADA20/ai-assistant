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

Always aim to be the best engineer and teacher you can be.`

const MODEL_CONFIG = {
  'llama-3.3-70b-versatile':   { max_tokens: 8192, temperature: 0.6 },
  'llama-3.1-8b-instant':      { max_tokens: 4096, temperature: 0.7 },
  'mixtral-8x7b-32768':        { max_tokens: 8192, temperature: 0.4 },
  'deepseek-r1-distill-llama-70b': { max_tokens: 8192, temperature: 0.5 },
}

export async function onRequest(context) {
  const { request, env } = context

  if (request.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
    })
  }

  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const apiKey = env.GROQ_API_KEY
  if (!apiKey) {
    return new Response(JSON.stringify({ error: 'GROQ_API_KEY no configurada' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  try {
    const body = await request.json()
    const { messages, model = 'llama-3.3-70b-versatile' } = body

    if (!messages || !Array.isArray(messages)) {
      return new Response(JSON.stringify({ error: 'Messages array is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const config = MODEL_CONFIG[model] || { max_tokens: 8192, temperature: 0.6 }

    const groqRes = await fetch(GROQ_API, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          ...messages,
        ],
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

    const { readable, writable } = new TransformStream()
    const writer = writable.getWriter()
    const encoder = new TextEncoder()

    ;(async () => {
      try {
        const reader = groqRes.body.getReader()
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
                  await writer.write(
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
        await writer.write(encoder.encode('data: [DONE]\n\n'))
        await writer.close()
      }
    })()

    return new Response(readable, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Access-Control-Allow-Origin': '*',
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

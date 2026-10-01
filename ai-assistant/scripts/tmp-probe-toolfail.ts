import { readFileSync } from 'fs'

async function main() {
  const env = readFileSync('.env.local', 'utf8')
  const key = /GROQ_API_KEY=(.+)/.exec(env)?.[1]?.trim()
  if (!key) throw new Error('sin GROQ_API_KEY')

  const tools = [
    {
      type: 'function' as const,
      function: {
        name: 'web_search',
        description: 'Search the internet for current information, news, documentation, or any online content',
        parameters: {
          type: 'object',
          properties: { query: { type: 'string', description: 'The search query' } },
          required: ['query'],
        },
      },
    },
  ]

  const prompt = 'Busca en la web cual es la ultima version estable de Rust y de que trata la novedad principal.'

  const N = 6
  let ok = 0, schemaFail = 0, other = 0
  const failures: string[] = []

  for (let i = 0; i < N; i++) {
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'openai/gpt-oss-120b',
        messages: [
          { role: 'system', content: 'Eres ARIA, asistente en espanol.' },
          { role: 'user', content: prompt },
        ],
        tools,
        tool_choice: 'auto',
        stream: false,
        max_tokens: 1024,
        temperature: 0.6,
      }),
    })

    if (!res.ok) {
      const body = await res.text()
      const isSchema = body.includes('tool_use_failed') || body.includes('did not match schema')
      isSchema ? schemaFail++ : other++
      failures.push(`iter ${i + 1}: status=${res.status} ${body.slice(0, 200)}`)
      console.log(`iter ${i + 1}: FAIL ${res.status}`)
    } else {
      const data = (await res.json()) as any
      const tc = data.choices?.[0]?.message?.tool_calls
      if (tc && tc.length > 0) {
        const valid = (() => { try { const a = JSON.parse(tc[0].function.arguments); return typeof a.query === 'string' } catch { return false } })()
        valid ? ok++ : schemaFail++
        console.log(`iter ${i + 1}: OK args=${tc[0].function.arguments.slice(0, 80)}`)
      } else {
        console.log(`iter ${i + 1}: sin tool_call`)
      }
    }
    await new Promise((r) => setTimeout(r, 6000))
  }

  console.log(`\n${ok} ok ${schemaFail} schemaFail ${other} other`)
}

main().catch((e) => { console.error(e); process.exit(1) })
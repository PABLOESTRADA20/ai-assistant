declare global {
  interface CloudflareEnv {
    AI: {
      run: (model: string, input: { text: string }) => Promise<{ data: number[][] }>
    }
    // Bindings de rate limiting definidos en wrangler.jsonc. Opcionales: en
    // `next dev` no existen y la app simplemente no limita.
    CHAT_RATE_LIMITER?: { limit: (options: { key: string }) => Promise<{ success: boolean }> }
    TRANSCRIBE_RATE_LIMITER?: { limit: (options: { key: string }) => Promise<{ success: boolean }> }
  }
}

export {}

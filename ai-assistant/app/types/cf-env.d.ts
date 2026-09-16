declare global {
  interface CloudflareEnv {
    AI: {
      run: (model: string, input: { text: string }) => Promise<{ data: number[][] }>
    }
  }
}

export {}
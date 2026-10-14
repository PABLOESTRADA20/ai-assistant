const { initOpenNextCloudflareForDev } = require('@opennextjs/cloudflare')

if (process.env.NODE_ENV !== 'production') {
  initOpenNextCloudflareForDev()
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Fase 0 — reduce el pico de memoria de `next build`: webpack deja de retener
  // todos los assets en memoria. Clave real de Next 15.5, y es una opción de
  // build pura, así que no cambia ni el runtime de workerd ni el bundle: el
  // resultado es idéntico, solo se gasta menos RAM mientras se construye.
  experimental: {
    webpackMemoryOptimizations: true,
  },
  // Quita la cabecera "X-Powered-By: Next.js": no aporta nada y da una huella
  // innecesaria del framework a cualquiera que sondee la URL desplegada.
  poweredByHeader: false,
  outputFileTracingRoot: __dirname,
  /**
   * Cabeceras de seguridad base para todas las respuestas.
   *
   * La app puede vivir en una URL pública (protegida por ARIA_ACCESS_TOKEN, pero
   * pública al fin). Estas cabeceras evitan el sniffing de tipos MIME, el framing
   * (clickjacking) y bloquean APIs del navegador que la app no usa. NO se añade
   * Content-Security-Policy todavía: Next inyecta scripts/estilos inline y una CSP
   * estricta exigiría nonces y rompería el streaming y la UI; queda para una fase
   * específica.
   */
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'DENY' },
          // La app graba audio (dictado) en su propio origen: el micrófono debe
          // seguir permitido para 'self'. Cámara y geolocalización no se usan.
          { key: 'Permissions-Policy', value: 'camera=(), geolocation=(), microphone=(self)' },
        ],
      },
    ]
  },
  webpack: (config) => {
    config.experiments = { ...config.experiments, asyncWebAssembly: true }

    // Let `.wasm` imports pass through webpack untouched, so the wasm files end up
    // as native `import()` statements that esbuild/wrangler can resolve and bundle
    // as precompiled `WebAssembly.Module` objects (workerd only allows instantiating
    // precompiled modules). Bundling them through webpack's asyncWebAssembly would
    // generate `fs.readFile + WebAssembly.instantiate(bytes)`, which workerd bans.
    const wasmExternal = ({ request }, callback) => {
      if (request && /\.wasm(\?module)?$/.test(request)) {
        return callback(null, `module ${request}`)
      }
      callback()
    }
    const existing = Array.isArray(config.externals)
      ? config.externals
      : config.externals
        ? [config.externals]
        : []
    config.externals = [...existing, wasmExternal]
    return config
  },
}

module.exports = nextConfig

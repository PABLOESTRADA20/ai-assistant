const { initOpenNextCloudflareForDev } = require('@opennextjs/cloudflare')

if (process.env.NODE_ENV !== 'production') {
  initOpenNextCloudflareForDev()
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  outputFileTracingRoot: __dirname,
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

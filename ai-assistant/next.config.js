/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    serverComponentsExternalPackages: ['mongoose', 'kokoro-js', 'onnxruntime-node'],
  },
  webpack: (config, { isServer }) => {
    // Ignorar archivos .node (binarios nativos de módulos)
    config.module.rules.push({
      test: /\.node$/,
      use: [{ loader: 'file-loader' }],
    })

    // Para el bundle del cliente, no incluir módulos de Node.js
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        'fs': false,
        'path': false,
        'os': false,
        'crypto': false,
        'stream': false,
        'util': false,
        'canvas': false,
      }
    }

    return config
  },
}

module.exports = nextConfig

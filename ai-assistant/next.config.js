/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: 'export',
  images: { unoptimized: true },
  trailingSlash: true,
  skipTrailingSlashRedirect: true,
  webpack: (config, { isServer }) => {
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
